/**
 * Socket.io Configuration and Event Handling
 * Optimized for Fly.io deployment with WebSocket transport
 */

const { Server } = require('socket.io');
const { createAdapter } = require('@socket.io/redis-adapter');
const { getPubSubClients, isUsingMemoryMode } = require('../config/redis');
const logger = require('../utils/logger');
const { authenticateSocket, getClientIP } = require('../middleware/socketAuth');
const timerService = require('../services/timerService');
const { SOCKET, SOCKET_EVENTS } = require('../config/constants');
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
let shuttingDown = false;

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
        // SECURITY FIX: Use getClientIP which only trusts X-Forwarded-For behind configured proxies
        const clientIP = getClientIP(socket) || 'unknown';

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

    // Authentication middleware - decrement IP counter on auth failure
    io.use((socket, next) => {
        authenticateSocket(socket, (err) => {
            if (err) {
                // Auth failed: decrement connectionsPerIP to prevent permanent IP blocking
                if (socket.clientIP) {
                    const currentCount = connectionsPerIP.get(socket.clientIP) || 1;
                    if (currentCount <= 1) {
                        connectionsPerIP.delete(socket.clientIP);
                    } else {
                        connectionsPerIP.set(socket.clientIP, currentCount - 1);
                    }
                }
                return next(err);
            }
            next();
        });
    });

    // Connection handling
    io.on('connection', (socket) => {
        // Reject connections during shutdown to prevent handlers referencing a null io
        if (shuttingDown) {
            socket.disconnect(true);
            return;
        }

        logger.info(`Client connected: ${socket.id} (session: ${socket.sessionId})`);

        // Update cached socket count for fast health checks
        if (app && typeof app.updateSocketCount === 'function') {
            app.updateSocketCount(1);
        }

        // Store the Fly.io instance ID for debugging multi-instance issues
        if (process.env.FLY_ALLOC_ID) {
            socket.flyInstanceId = process.env.FLY_ALLOC_ID;
        }

        // Attach rate limiter to socket for use in handlers
        socket.rateLimiter = socketRateLimiter;

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

            // Timeout wrapper for disconnect handler - prevents indefinite hangs
            const DISCONNECT_TIMEOUT_MS = 30000;

            try {
                await Promise.race([
                    handleDisconnect(io, socket, reason),
                    new Promise((_, reject) => {
                        setTimeout(() => {
                            reject(new Error('Disconnect handler timeout'));
                        }, DISCONNECT_TIMEOUT_MS);
                    })
                ]);
            } catch (error) {
                if (error.message === 'Disconnect handler timeout') {
                    logger.error(`Disconnect handler timed out after ${DISCONNECT_TIMEOUT_MS}ms for socket ${socket.id}`);
                    // Do NOT retry — the original promise is still running and will complete.
                    // Retrying would cause duplicate host transfers and disconnect broadcasts.
                } else {
                    logger.error('Error in disconnect handler:', error);
                }
            }
        });

        // Handle socket errors
        socket.on('error', (error) => {
            logger.error(`Socket error for ${socket.id}:`, {
                message: error.message,
                sessionId: socket.sessionId
            });

            socket.emit('socket:error', {
                code: 'INTERNAL_ERROR',
                message: 'An unexpected error occurred. Please try again.'
            });
        });
    });

    // Start periodic cleanup of stale rate limit entries
    startRateLimitCleanup();

    // Initialize timer service with expire callback
    timerService.initializeTimerService(createTimerExpireCallback());

    // Register socket functions for handlers (breaks circular dependency)
    registerSocketFunctions({
        emitToRoom,
        emitToPlayer,
        startTurnTimer,
        stopTurnTimer,
        getTimerStatus,
        getIO,
        createTimerExpireCallback
    });

    return io;
}

/**
 * Create the callback for timer expiration
 */
function createTimerExpireCallback() {
    return async (roomCode) => {
        const gameService = require('../services/gameService');
        const roomService = require('../services/roomService');
        const eventLogService = require('../services/eventLogService');
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
            emitToRoom(roomCode, SOCKET_EVENTS.GAME_TURN_ENDED, {
                currentTurn: result.currentTurn,
                previousTurn: result.previousTurn,
                reason: 'timerExpired'
            });
            emitToRoom(roomCode, SOCKET_EVENTS.TIMER_EXPIRED, { roomCode });

            try {
                await eventLogService.logEvent(roomCode, 'TIMER_EXPIRED', {
                    currentTurn: result.currentTurn,
                    previousTurn: result.previousTurn
                });
            } catch (logErr) {
                logger.warn(`Failed to log timer expire event: ${logErr.message}`);
            }

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
                    let lockValue;

                    try {
                        // Check Redis availability before attempting lock
                        const redisHealthy = await isRedisHealthy();
                        if (!redisHealthy) {
                            logger.warn(`Timer restart skipped for room ${roomCode}: Redis not healthy`);
                            return;
                        }

                        // ISSUE #3 FIX: Increase lock TTL to 10s and track acquisition state
                        // SPRINT-15 FIX: Explicit verification of lock result (Redis returns 'OK' or null)
                        lockValue = `${process.pid}:${Date.now()}`;
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
                        // ISSUE #3 FIX: Always release lock if we acquired it (owner-verified)
                        if (lockAcquired) {
                            try {
                                const { RELEASE_LOCK_SCRIPT } = require('../utils/distributedLock');
                                await redis.eval(RELEASE_LOCK_SCRIPT, { keys: [lockKey], arguments: [lockValue] });
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
    const eventLogService = require('../services/eventLogService');
    const { getRedis } = require('../config/redis');

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
            io.to(`room:${roomCode}`).emit(SOCKET_EVENTS.PLAYER_DISCONNECTED, {
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

            // Log disconnection event
            try {
                await eventLogService.logEvent(roomCode, 'PLAYER_DISCONNECTED', {
                    sessionId: socket.sessionId,
                    nickname: player.nickname,
                    team: player.team,
                    reason: reason
                });
            } catch (logErr) {
                logger.warn(`Failed to log disconnect event: ${logErr.message}`);
            }

            // ISSUE #7 FIX: Check if disconnected player was host - use lock with longer TTL
            if (player.isHost) {
                const redis = getRedis();
                const lockKey = `lock:host-transfer:${roomCode}`;
                let hostTransferLockAcquired = false;
                let hostLockValue;

                try {
                    // ISSUE #7 FIX: Increase lock TTL to 10s for slow Redis operations
                    // Use unique lock value for owner-verified release
                    hostLockValue = `${socket.sessionId}:${Date.now()}`;
                    const lockResult = await redis.set(lockKey, hostLockValue, { NX: true, EX: 10 });
                    hostTransferLockAcquired = lockResult === 'OK' || lockResult === true;

                    if (hostTransferLockAcquired) {
                        const players = await playerService.getPlayersInRoom(roomCode);
                        // FIX: Don't early return - just skip transfer if we can't get players
                        // Early return was causing the rest of disconnect handling to be skipped
                        if (!players || !Array.isArray(players)) {
                            logger.warn(`Unable to fetch players for host transfer in room ${roomCode}, room may be left without host`);
                            // Continue to finally block to release lock, but skip transfer
                        } else {
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
                                    io.to(`room:${roomCode}`).emit(SOCKET_EVENTS.ROOM_HOST_CHANGED, {
                                        newHostSessionId: newHost.sessionId,
                                        newHostNickname: newHost.nickname,
                                        reason: 'previousHostDisconnected'
                                    });

                                    try {
                                        await eventLogService.logEvent(roomCode, 'HOST_CHANGED', {
                                            previousHostSessionId: socket.sessionId,
                                            newHostSessionId: newHost.sessionId,
                                            newHostNickname: newHost.nickname,
                                            reason: 'previousHostDisconnected'
                                        });
                                    } catch (logErr) {
                                        logger.warn(`Failed to log host change event: ${logErr.message}`);
                                    }

                                } else {
                                    logger.error(`Atomic host transfer failed: ${transferResult.reason}`, { roomCode });
                                }
                            }
                        }
                    } else {
                        logger.debug(`Host transfer lock not acquired for room ${roomCode}, another instance handling it`);
                    }
                } catch (hostTransferError) {
                    logger.error(`Host transfer failed for room ${roomCode}: ${hostTransferError.message}`);
                } finally {
                    // ISSUE #7 FIX: Only release lock if we acquired it (owner-verified)
                    if (hostTransferLockAcquired) {
                        try {
                            const { RELEASE_LOCK_SCRIPT } = require('../utils/distributedLock');
                            await redis.eval(RELEASE_LOCK_SCRIPT, { keys: [lockKey], arguments: [hostLockValue] });
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
    emitToRoom(roomCode, SOCKET_EVENTS.TIMER_STARTED, {
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
    emitToRoom(roomCode, SOCKET_EVENTS.TIMER_STOPPED, { roomCode });
}

/**
 * Get timer status for a room (async)
 */
function getTimerStatus(roomCode) {
    return timerService.getTimerStatus(roomCode);
}

/**
 * Cleanup socket module resources on shutdown
 * Call this before process exit to prevent memory leaks
 */
function cleanupSocketModule() {
    // Set shutdown flag to reject new connections immediately
    shuttingDown = true;

    // Stop rate limiter cleanup interval
    stopRateLimitCleanup();

    // Close socket.io server if initialized
    if (io) {
        io.disconnectSockets(true); // Force-disconnect so disconnect handlers run while io is valid
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
