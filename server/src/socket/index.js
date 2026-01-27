/**
 * Socket.io Configuration and Event Handling
 * Optimized for Fly.io deployment with WebSocket transport
 */

const { Server } = require('socket.io');
const { createAdapter } = require('@socket.io/redis-adapter');
const { getPubSubClients, isUsingMemoryMode } = require('../config/redis');
const logger = require('../utils/logger');
const { authenticateSocket } = require('../middleware/socketAuth');
const timerService = require('../services/timerService');
const eventLogService = require('../services/eventLogService');
const { SOCKET } = require('../config/constants');
const {
    socketRateLimiter,
    createRateLimitedHandler,
    getSocketRateLimiter,
    startRateLimitCleanup,
    stopRateLimitCleanup
} = require('./rateLimitHandler');
const { registerSocketFunctions } = require('./socketFunctionProvider');

// Import handlers AFTER rate limiter is set up to avoid circular dependency issues
const roomHandlers = require('./handlers/roomHandlers');
const gameHandlers = require('./handlers/gameHandlers');
const playerHandlers = require('./handlers/playerHandlers');
const chatHandlers = require('./handlers/chatHandlers');
const timerHandlers = require('./handlers/timerHandlers');

let io = null;
let app = null; // Reference to Express app for socket count updates
let inactivityCheckInterval = null; // Sprint 19: Interval for checking idle sockets

// Track connections per IP for DoS protection
const connectionsPerIP = new Map();

function initializeSocket(server, expressApp = null) {
    app = expressApp;
    const isProduction = process.env.NODE_ENV === 'production';
    const corsOrigin = process.env.CORS_ORIGIN || '*';

    // SECURITY FIX: Block wildcard CORS in production for Socket.io
    // This matches the validation in app.js for Express CORS
    if (isProduction && corsOrigin === '*') {
        logger.error('FATAL: CORS_ORIGIN cannot be wildcard (*) in production for Socket.io');
        logger.error('Set CORS_ORIGIN to your domain(s), e.g., CORS_ORIGIN=https://yourdomain.com');
        process.exit(1);
    }

    io = new Server(server, {
        cors: {
            origin: corsOrigin === '*' ? true : corsOrigin.split(',').map(s => s.trim()),
            methods: ['GET', 'POST'],
            credentials: true
        },
        // Use WebSocket only in production for better Fly.io compatibility
        // Polling can have issues with Fly.io's proxy and load balancing
        transports: isProduction ? ['websocket'] : ['polling', 'websocket'],
        // Allow upgrades in development
        allowUpgrades: !isProduction,
        // Increase timeouts for better stability on Fly.io (from centralized constants)
        pingTimeout: SOCKET.PING_TIMEOUT_MS,
        pingInterval: SOCKET.PING_INTERVAL_MS,
        // SECURITY FIX: Limit max message size to prevent memory exhaustion
        maxHttpBufferSize: SOCKET.MAX_HTTP_BUFFER_SIZE,
        // Connection state recovery for reconnections
        connectionStateRecovery: {
            // Maximum duration a connection can be offline
            maxDisconnectionDuration: SOCKET.MAX_DISCONNECTION_DURATION_MS,
            // Skip middlewares on reconnection
            skipMiddlewares: false
        },
        // Allow EIO4 for older clients
        allowEIO3: true,
        // US-16.4: Enable per-message deflate compression for reduced bandwidth
        perMessageDeflate: {
            threshold: 1024, // Only compress messages larger than 1KB
            zlibDeflateOptions: {
                chunkSize: 16 * 1024 // 16KB chunks
            },
            zlibInflateOptions: {
                chunkSize: 16 * 1024
            },
            clientNoContextTakeover: true, // Don't keep compression context between messages
            serverNoContextTakeover: true
        }
    });

    // Use Redis adapter for horizontal scaling (skip in memory mode)
    if (isUsingMemoryMode()) {
        logger.info('Using Socket.io in-memory adapter (single-instance mode)');
    } else {
        try {
            const { pubClient, subClient } = getPubSubClients();
            io.adapter(createAdapter(pubClient, subClient));
            logger.info('Socket.io Redis adapter configured for horizontal scaling');
        } catch (error) {
            logger.warn('Redis adapter not available, using in-memory adapter (single instance only):', error.message);
        }
    }

    // Connection limits middleware - check before authentication
    io.use((socket, next) => {
        const clientIP = socket.handshake.headers['x-forwarded-for']?.split(',')[0]?.trim()
            || socket.handshake.address
            || 'unknown';

        const currentCount = connectionsPerIP.get(clientIP) || 0;

        if (currentCount >= SOCKET.MAX_CONNECTIONS_PER_IP) {
            logger.warn('Connection limit exceeded', { ip: clientIP, count: currentCount });
            return next(new Error('Too many connections from this IP'));
        }

        // Store IP on socket for tracking
        socket.clientIP = clientIP;
        connectionsPerIP.set(clientIP, currentCount + 1);
        next();
    });

    // Authentication middleware
    io.use(authenticateSocket);

    // Connection handling
    io.on('connection', (socket) => {
        logger.info(`Client connected: ${socket.id} (session: ${socket.sessionId})`);

        // Update cached socket count for fast health checks
        if (app && typeof app.updateSocketCount === 'function') {
            app.updateSocketCount(1);
        }

        // Store the Fly.io instance ID for debugging multi-instance issues
        if (process.env.FLY_ALLOC_ID) {
            socket.flyInstanceId = process.env.FLY_ALLOC_ID;
        }

        // Sprint 19: Track activity for inactivity timeout
        socket.lastActivity = Date.now();

        // Attach rate limiter to socket for use in handlers
        socket.rateLimiter = socketRateLimiter;

        // Sprint 19: Update activity timestamp on any incoming event
        socket.onAny(() => {
            socket.lastActivity = Date.now();
        });

        // Register all event handlers
        roomHandlers(io, socket);
        gameHandlers(io, socket);
        playerHandlers(io, socket);
        chatHandlers(io, socket);
        timerHandlers(io, socket);

        // Handle disconnection
        // ISSUE #9 FIX: Wrap disconnect handler in timeout to prevent hangs
        socket.on('disconnect', async (reason) => {
            logger.info(`Client disconnected: ${socket.id} (reason: ${reason})`);

            // Decrement connection count for this IP
            if (socket.clientIP) {
                const currentCount = connectionsPerIP.get(socket.clientIP) || 1;
                if (currentCount <= 1) {
                    connectionsPerIP.delete(socket.clientIP);
                } else {
                    connectionsPerIP.set(socket.clientIP, currentCount - 1);
                }
            }

            // Update cached socket count for fast health checks
            try {
                if (app && typeof app.updateSocketCount === 'function') {
                    app.updateSocketCount(-1);
                }
            } catch (error) {
                logger.error('Error updating socket count:', error);
            }

            // Clean up rate limiter entries for this socket to prevent memory leaks
            try {
                socketRateLimiter.cleanupSocket(socket.id);
            } catch (error) {
                logger.error('Error cleaning up rate limiter:', error);
            }

            // FIX C2: Increased timeout to 30s and added background cleanup on timeout
            // Previously: 10s timeout would abandon critical cleanup operations
            const DISCONNECT_TIMEOUT_MS = 30000; // 30 seconds - more realistic for slow Redis
            let timedOut = false;

            try {
                await Promise.race([
                    handleDisconnect(io, socket, reason),
                    new Promise((_, reject) => {
                        setTimeout(() => {
                            timedOut = true;
                            reject(new Error('Disconnect handler timeout'));
                        }, DISCONNECT_TIMEOUT_MS);
                    })
                ]);
            } catch (error) {
                if (error.message === 'Disconnect handler timeout') {
                    logger.error(`Disconnect handler timed out after ${DISCONNECT_TIMEOUT_MS}ms for socket ${socket.id}`);

                    // FIX C2: Continue cleanup in background even after timeout
                    // This ensures critical operations like host transfer eventually complete
                    setImmediate(() => {
                        handleDisconnect(io, socket, reason).catch(bgErr => {
                            logger.error(`Background disconnect cleanup failed for ${socket.id}:`, bgErr.message);
                        });
                    });
                } else {
                    logger.error('Error in disconnect handler:', error);
                }
            }
        });

        // Handle errors with classification and structured logging
        socket.on('error', (error) => {
            // Classify error type for metrics and handling
            const errorInfo = classifySocketError(error);

            logger.error(`Socket error for ${socket.id}:`, {
                errorType: errorInfo.type,
                errorCode: errorInfo.code,
                message: error.message,
                sessionId: socket.sessionId,
                clientIP: socket.clientIP,
                stack: error.stack
            });

            // Emit error event to client with sanitized info (no internal details)
            socket.emit('socket:error', {
                code: errorInfo.code,
                message: errorInfo.userMessage,
                recoverable: errorInfo.recoverable
            });

            // Handle specific error types
            if (!errorInfo.recoverable) {
                logger.warn(`Non-recoverable socket error, disconnecting ${socket.id}`, {
                    errorType: errorInfo.type
                });
                socket.disconnect(true);
            }
        });

        // Handle connect error (client-side errors reported to server)
        socket.on('connect_error', (error) => {
            logger.warn(`Connection error for ${socket.id}:`, {
                message: error.message,
                sessionId: socket.sessionId
            });
        });
    });

/**
 * Classify socket errors for appropriate handling
 * @param {Error} error - The error to classify
 * @returns {{type: string, code: string, userMessage: string, recoverable: boolean}}
 */
function classifySocketError(error) {
    const errorMessage = error.message?.toLowerCase() || '';
    const errorName = error.name || 'Error';

    // Transport/network errors
    if (errorMessage.includes('transport') || errorMessage.includes('network') ||
        errorMessage.includes('connection') || errorMessage.includes('timeout')) {
        return {
            type: 'TRANSPORT_ERROR',
            code: 'NETWORK_ERROR',
            userMessage: 'Connection error occurred. Please try reconnecting.',
            recoverable: true
        };
    }

    // Authentication errors
    if (errorMessage.includes('auth') || errorMessage.includes('unauthorized') ||
        errorMessage.includes('token') || errorMessage.includes('permission')) {
        return {
            type: 'AUTH_ERROR',
            code: 'AUTHENTICATION_ERROR',
            userMessage: 'Authentication error. Please refresh the page.',
            recoverable: false
        };
    }

    // Validation errors
    if (errorMessage.includes('validation') || errorMessage.includes('invalid') ||
        errorName === 'ValidationError' || errorName === 'ZodError') {
        return {
            type: 'VALIDATION_ERROR',
            code: 'VALIDATION_ERROR',
            userMessage: 'Invalid data received. Please try again.',
            recoverable: true
        };
    }

    // Rate limiting
    if (errorMessage.includes('rate') || errorMessage.includes('limit') ||
        errorMessage.includes('too many')) {
        return {
            type: 'RATE_LIMIT_ERROR',
            code: 'RATE_LIMITED',
            userMessage: 'Too many requests. Please slow down.',
            recoverable: true
        };
    }

    // Default: unknown/server error
    return {
        type: 'SERVER_ERROR',
        code: 'INTERNAL_ERROR',
        userMessage: 'An unexpected error occurred. Please try again.',
        recoverable: true
    };
}

/**
 * Sprint 19: Start periodic check for inactive sockets
 * Disconnects sockets that have been idle for too long
 */
function startInactivityCheck(ioInstance) {
    const { SESSION_SECURITY } = require('../config/constants');
    // Default values if not defined (for testing compatibility)
    const INACTIVITY_TIMEOUT = SESSION_SECURITY?.INACTIVITY_TIMEOUT_MS || 30 * 60 * 1000;
    const CHECK_INTERVAL = SESSION_SECURITY?.INACTIVITY_CHECK_INTERVAL_MS || 60 * 1000;

    // Clear any existing interval
    if (inactivityCheckInterval) {
        clearInterval(inactivityCheckInterval);
    }

    inactivityCheckInterval = setInterval(async () => {
        try {
            const sockets = await ioInstance.fetchSockets();
            const now = Date.now();
            let disconnectedCount = 0;

            for (const socket of sockets) {
                const lastActivity = socket.lastActivity || socket.handshake?.time || now;
                const idleTime = now - lastActivity;

                if (idleTime > INACTIVITY_TIMEOUT) {
                    logger.info(`Disconnecting idle socket ${socket.id} (idle for ${Math.round(idleTime / 1000)}s)`, {
                        sessionId: socket.sessionId,
                        idleTimeMs: idleTime,
                        threshold: INACTIVITY_TIMEOUT
                    });

                    // Emit inactivity warning before disconnect
                    socket.emit('session:inactivityTimeout', {
                        reason: 'inactivity',
                        idleTimeSeconds: Math.round(idleTime / 1000)
                    });

                    socket.disconnect(true);
                    disconnectedCount++;
                }
            }

            if (disconnectedCount > 0) {
                logger.info(`Inactivity check: disconnected ${disconnectedCount} idle socket(s)`);
            }
        } catch (error) {
            logger.error('Error in inactivity check:', error.message);
        }
    }, CHECK_INTERVAL);

    logger.info(`Inactivity check started (timeout: ${INACTIVITY_TIMEOUT / 1000}s, check interval: ${CHECK_INTERVAL / 1000}s)`);
    }

    // Initialize timer service for distributed operation
    timerService.initializeTimerService(createTimerExpireCallback());

    // Start periodic cleanup of stale rate limit entries
    startRateLimitCleanup();

    // Sprint 19: Start inactivity check interval
    startInactivityCheck(io);

    // Register socket functions for handlers (breaks circular dependency)
    registerSocketFunctions({
        emitToRoom,
        emitToPlayer,
        startTurnTimer,
        stopTurnTimer,
        getTimerStatus,
        getIO
    });

    return io;
}

/**
 * Stop the inactivity check interval
 */
function stopInactivityCheck() {
    if (inactivityCheckInterval) {
        clearInterval(inactivityCheckInterval);
        inactivityCheckInterval = null;
        logger.info('Inactivity check stopped');
    }
}

/**
 * Create the callback for timer expiration
 */
function createTimerExpireCallback() {
    return async (roomCode) => {
        const gameService = require('../services/gameService');
        const roomService = require('../services/roomService');
        try {
            // Check if game is still active before ending turn (prevents race condition)
            const game = await gameService.getGame(roomCode);
            if (!game) {
                logger.debug(`Timer expired for room ${roomCode} but no game found`);
                return;
            }
            if (game.gameOver) {
                logger.debug(`Timer expired for room ${roomCode} but game already over`);
                return;
            }

            const result = await gameService.endTurn(roomCode, 'Timer');
            emitToRoom(roomCode, 'game:turnEnded', {
                currentTurn: result.currentTurn,
                previousTurn: result.previousTurn,
                reason: 'timerExpired'
            });
            emitToRoom(roomCode, 'timer:expired', { roomCode });

            // Log timer expiration event for reconnection recovery
            await eventLogService.logEvent(
                roomCode,
                eventLogService.EVENT_TYPES.TIMER_EXPIRED,
                {
                    currentTurn: result.currentTurn,
                    previousTurn: result.previousTurn
                }
            );

            // Restart timer for the new turn (if timer is configured and game not over)
            // BUG-6 & ISSUE #3 FIX: Use distributed lock with improved error handling
            // when multiple timer expirations queue setImmediate callbacks
            // SPRINT-15 FIX: Wrap in IIFE with .catch() to prevent unhandled promise rejections
            setImmediate(() => {
                (async () => {
                    const { getRedis, isRedisHealthy } = require('../config/redis');
                    const redis = getRedis();
                    const lockKey = `lock:timer-restart:${roomCode}`;
                    let lockAcquired = false;

                    try {
                        // Check Redis availability before attempting lock
                        const redisHealthy = await isRedisHealthy();
                        if (!redisHealthy) {
                            logger.warn(`Timer restart skipped for room ${roomCode}: Redis not healthy`);
                            return;
                        }

                        // ISSUE #3 FIX: Increase lock TTL to 10s and track acquisition state
                        // SPRINT-15 FIX: Explicit verification of lock result (Redis returns 'OK' or null)
                        const lockValue = `${process.pid}:${Date.now()}`;
                        const lockResult = await redis.set(lockKey, lockValue, { NX: true, EX: 10 });
                        lockAcquired = lockResult === 'OK' || lockResult === true;

                        if (!lockAcquired) {
                            logger.debug(`Timer restart skipped for room ${roomCode}: another instance handling it`, {
                                lockKey
                            });
                            return;
                        }

                        logger.debug(`Timer restart lock acquired for room ${roomCode}`, {
                            lockKey,
                            lockValue,
                            ttlSeconds: 10
                        });

                        const room = await roomService.getRoom(roomCode);
                        const game = await gameService.getGame(roomCode);

                        if (!room) {
                            logger.debug(`Timer restart skipped for room ${roomCode}: room not found`);
                            return;
                        }
                        if (!room.settings || !room.settings.turnTimer) {
                            logger.debug(`Timer restart skipped for room ${roomCode}: timer not configured`);
                            return;
                        }
                        if (!game) {
                            logger.debug(`Timer restart skipped for room ${roomCode}: game not found`);
                            return;
                        }
                        if (game.gameOver) {
                            logger.debug(`Timer restart skipped for room ${roomCode}: game over (winner: ${game.winner})`);
                            return;
                        }

                        await startTurnTimer(roomCode, room.settings.turnTimer);
                        logger.debug(`Timer restarted for room ${roomCode}, new turn: ${game.currentTurn}`);
                    } catch (err) {
                        logger.error(`Timer restart failed for room ${roomCode}: ${err.message}`);
                    } finally {
                        // ISSUE #3 FIX: Always release lock if we acquired it
                        if (lockAcquired) {
                            try {
                                await redis.del(lockKey);
                            } catch (delErr) {
                                logger.error(`Failed to release timer restart lock for ${roomCode}: ${delErr.message}`);
                            }
                        }
                    }
                })().catch(err => {
                    // SPRINT-15 FIX: Catch any unhandled promise rejections from the async IIFE
                    logger.error(`Unhandled timer restart error for room ${roomCode}:`, err);
                });
            });
        } catch (error) {
            logger.error(`Timer expiry error for room ${roomCode}:`, error);
        }
    };
}

/**
 * Handle player disconnection with room notification
 * Uses lock to prevent race conditions during host transfer
 * ISSUE #17 FIX: Generate reconnection token for secure reconnection
 */
async function handleDisconnect(io, socket, reason) {
    const playerService = require('../services/playerService');
    const roomService = require('../services/roomService');
    const { getRedis } = require('../config/redis');
    const { REDIS_TTL } = require('../config/constants');

    try {
        const player = await playerService.getPlayer(socket.sessionId);

        if (!player) {
            return;
        }

        const roomCode = player.roomCode;

        // ISSUE #17 FIX: Generate reconnection token before marking as disconnected
        let reconnectionToken = null;
        try {
            reconnectionToken = await playerService.generateReconnectionToken(socket.sessionId);
        } catch (tokenError) {
            logger.warn(`Failed to generate reconnection token for ${socket.sessionId}:`, tokenError.message);
        }

        // Update player's connected status
        await playerService.handleDisconnect(socket.sessionId);

        // Notify other players in the room
        if (roomCode) {
            // ISSUE #15 FIX: Get updated player list to ensure clients have consistent state
            const updatedPlayers = await playerService.getPlayersInRoom(roomCode);

            // US-16.3: Calculate reconnection deadline for frontend display
            const { SESSION_SECURITY } = require('../config/constants');
            const reconnectionDeadline = Date.now() + (SESSION_SECURITY.RECONNECTION_TOKEN_TTL_SECONDS * 1000);

            // SECURITY FIX: Do NOT broadcast reconnection token to the room!
            // The token was previously broadcast to all players, allowing potential session hijacking.
            // Now the token is stored server-side only and validated during reconnection handshake.
            // The disconnecting player should proactively request their reconnection token via
            // 'room:getReconnectionToken' event BEFORE they disconnect (e.g., on 'beforeunload').
            io.to(`room:${roomCode}`).emit('player:disconnected', {
                sessionId: socket.sessionId,
                nickname: player.nickname,
                team: player.team,
                reason: reason,
                timestamp: Date.now(),
                // ISSUE #15 FIX: Include updated player list for state consistency
                players: updatedPlayers,
                // US-16.3: Indicate player may reconnect and when the window closes
                // Token is NOT broadcast - stored server-side only for security
                reconnecting: !!reconnectionToken,
                reconnectionDeadline: reconnectionToken ? reconnectionDeadline : null
            });

            // Log disconnect event for reconnection recovery
            await eventLogService.logEvent(
                roomCode,
                eventLogService.EVENT_TYPES.PLAYER_DISCONNECTED,
                {
                    sessionId: socket.sessionId,
                    nickname: player.nickname,
                    team: player.team,
                    reason
                }
            );

            // ISSUE #7 FIX: Check if disconnected player was host - use lock with longer TTL
            if (player.isHost) {
                const redis = getRedis();
                const lockKey = `lock:host-transfer:${roomCode}`;
                let hostTransferLockAcquired = false;

                try {
                    // ISSUE #7 FIX: Increase lock TTL to 10s for slow Redis operations
                    // Explicit verification of lock result (Redis returns 'OK' or null)
                    const lockResult = await redis.set(lockKey, socket.sessionId, { NX: true, EX: 10 });
                    hostTransferLockAcquired = lockResult === 'OK' || lockResult === true;

                    if (hostTransferLockAcquired) {
                        const players = await playerService.getPlayersInRoom(roomCode);
                        // FIX: Add null check for players to prevent server crash
                        if (!players || !Array.isArray(players)) {
                            logger.warn(`Unable to fetch players for host transfer in room ${roomCode}`);
                            return;
                        }
                        const connectedPlayers = players.filter(p => p.connected && p.sessionId !== socket.sessionId);

                        if (connectedPlayers.length > 0) {
                            // Transfer host to first connected player
                            const newHost = connectedPlayers[0];

                            // SECURITY FIX: Use atomic host transfer to prevent race conditions
                            // This atomically updates old host, new host, and room in a single Lua script
                            const transferResult = await playerService.atomicHostTransfer(
                                socket.sessionId,
                                newHost.sessionId,
                                roomCode
                            );

                            if (transferResult.success) {
                                io.to(`room:${roomCode}`).emit('room:hostChanged', {
                                    newHostSessionId: newHost.sessionId,
                                    newHostNickname: newHost.nickname,
                                    reason: 'previousHostDisconnected'
                                });

                                // Log host change event
                                await eventLogService.logEvent(
                                    roomCode,
                                    eventLogService.EVENT_TYPES.HOST_CHANGED,
                                    {
                                        previousHostSessionId: socket.sessionId,
                                        newHostSessionId: newHost.sessionId,
                                        newHostNickname: newHost.nickname,
                                        reason: 'previousHostDisconnected'
                                    }
                                );
                            } else {
                                logger.error(`Atomic host transfer failed: ${transferResult.reason}`, { roomCode });
                            }
                        }
                    } else {
                        logger.debug(`Host transfer lock not acquired for room ${roomCode}, another instance handling it`);
                    }
                } catch (hostTransferError) {
                    logger.error(`Host transfer failed for room ${roomCode}: ${hostTransferError.message}`);
                } finally {
                    // ISSUE #7 FIX: Only release lock if we acquired it
                    if (hostTransferLockAcquired) {
                        try {
                            await redis.del(lockKey);
                        } catch (delErr) {
                            logger.error(`Failed to release host transfer lock for ${roomCode}: ${delErr.message}`);
                        }
                    }
                }
            }
        }

    } catch (error) {
        logger.error('Error handling disconnect:', error);
    }
}

function getIO() {
    if (!io) {
        throw new Error('Socket.io not initialized');
    }
    return io;
}

// Helper to emit to a specific room
function emitToRoom(roomCode, event, data) {
    if (io) {
        io.to(`room:${roomCode}`).emit(event, data);
    }
}

// Helper to emit to a specific player
function emitToPlayer(sessionId, event, data) {
    if (io) {
        io.to(`player:${sessionId}`).emit(event, data);
    }
}

/**
 * Start a turn timer for a room (async)
 */
async function startTurnTimer(roomCode, durationSeconds) {
    const timerInfo = await timerService.startTimer(roomCode, durationSeconds, createTimerExpireCallback());

    // Broadcast timer start
    emitToRoom(roomCode, 'timer:started', {
        ...timerInfo,
        roomCode
    });

    return timerInfo;
}

/**
 * Stop the turn timer for a room (async)
 */
async function stopTurnTimer(roomCode) {
    await timerService.stopTimer(roomCode);
    emitToRoom(roomCode, 'timer:stopped', { roomCode });
}

/**
 * Get timer status for a room (async)
 */
async function getTimerStatus(roomCode) {
    return timerService.getTimerStatus(roomCode);
}

/**
 * Cleanup socket module resources on shutdown
 * Call this before process exit to prevent memory leaks
 */
function cleanupSocketModule() {
    // Stop rate limiter cleanup interval
    stopRateLimitCleanup();

    // Sprint 19: Stop inactivity check interval
    stopInactivityCheck();

    // Close socket.io server if initialized
    if (io) {
        io.close();
        io = null;
    }

    logger.info('Socket module cleaned up');
}

// Export internal functions for testing (prefixed with _ to indicate internal use)
module.exports = {
    initializeSocket,
    getIO,
    emitToRoom,
    emitToPlayer,
    startTurnTimer,
    stopTurnTimer,
    getTimerStatus,
    getSocketRateLimiter,
    createRateLimitedHandler,
    cleanupSocketModule,
    // Exported for testing only - do not use directly in production code
    _handleDisconnect: handleDisconnect,
    _createTimerExpireCallback: createTimerExpireCallback
};
