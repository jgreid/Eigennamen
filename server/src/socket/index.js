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
const {
    socketRateLimiter,
    createRateLimitedHandler,
    getSocketRateLimiter,
    startRateLimitCleanup,
    stopRateLimitCleanup
} = require('./rateLimitHandler');

// Import handlers AFTER rate limiter is set up to avoid circular dependency issues
const roomHandlers = require('./handlers/roomHandlers');
const gameHandlers = require('./handlers/gameHandlers');
const playerHandlers = require('./handlers/playerHandlers');
const chatHandlers = require('./handlers/chatHandlers');

let io = null;
let app = null; // Reference to Express app for socket count updates

function initializeSocket(server, expressApp = null) {
    app = expressApp;
    const isProduction = process.env.NODE_ENV === 'production';

    io = new Server(server, {
        cors: {
            origin: process.env.CORS_ORIGIN || '*',
            methods: ['GET', 'POST'],
            credentials: true
        },
        // Use WebSocket only in production for better Fly.io compatibility
        // Polling can have issues with Fly.io's proxy and load balancing
        transports: isProduction ? ['websocket'] : ['polling', 'websocket'],
        // Allow upgrades in development
        allowUpgrades: !isProduction,
        // Increase timeouts for better stability on Fly.io
        pingTimeout: 60000,
        pingInterval: 25000,
        // Connection state recovery for reconnections
        connectionStateRecovery: {
            // Maximum number of minutes a connection can be offline
            maxDisconnectionDuration: 2 * 60 * 1000, // 2 minutes
            // Skip middlewares on reconnection
            skipMiddlewares: false
        },
        // Allow EIO4 for older clients
        allowEIO3: true
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

        // Attach rate limiter to socket for use in handlers
        socket.rateLimiter = socketRateLimiter;

        // Register all event handlers
        roomHandlers(io, socket);
        gameHandlers(io, socket);
        playerHandlers(io, socket);
        chatHandlers(io, socket);

        // Handle disconnection
        socket.on('disconnect', (reason) => {
            logger.info(`Client disconnected: ${socket.id} (reason: ${reason})`);

            // Update cached socket count for fast health checks
            if (app && typeof app.updateSocketCount === 'function') {
                app.updateSocketCount(-1);
            }

            // Clean up rate limiter entries for this socket to prevent memory leaks
            socketRateLimiter.cleanupSocket(socket.id);

            handleDisconnect(io, socket, reason);
        });

        // Handle errors
        socket.on('error', (error) => {
            logger.error(`Socket error for ${socket.id}:`, error);
        });
    });

    // Initialize timer service for distributed operation
    timerService.initializeTimerService(createTimerExpireCallback());

    // Start periodic cleanup of stale rate limit entries
    startRateLimitCleanup();

    return io;
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
            // BUG-6 FIX: Use distributed lock to prevent multiple timer restarts
            // when multiple timer expirations queue setImmediate callbacks
            setImmediate(async () => {
                const redis = require('../config/redis').getRedis();
                const lockKey = `lock:timer-restart:${roomCode}`;

                try {
                    // Acquire lock to prevent concurrent timer restarts
                    const lockAcquired = await redis.set(lockKey, process.pid.toString(), { NX: true, EX: 5 });
                    if (!lockAcquired) {
                        logger.debug(`Timer restart skipped for room ${roomCode}: another instance handling it`);
                        return;
                    }

                    try {
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
                    } finally {
                        // Release lock
                        await redis.del(lockKey);
                    }
                } catch (err) {
                    logger.error(`Timer restart failed for room ${roomCode}: ${err.message}`);
                }
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
            io.to(`room:${roomCode}`).emit('player:disconnected', {
                sessionId: socket.sessionId,
                nickname: player.nickname,
                team: player.team,
                reason: reason,
                timestamp: Date.now(),
                // ISSUE #17 FIX: Include reconnection token in disconnect notification
                // This allows clients to store it for secure reconnection
                reconnectionToken: reconnectionToken
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

            // Check if disconnected player was host - use lock to prevent race condition
            if (player.isHost) {
                const redis = getRedis();
                const lockKey = `lock:host-transfer:${roomCode}`;

                // Try to acquire lock (expires after 3 seconds - enough for DB operations)
                const lockAcquired = await redis.set(lockKey, socket.sessionId, { NX: true, EX: 3 });

                if (lockAcquired) {
                    try {
                        const room = await roomService.getRoom(roomCode);
                        const players = await playerService.getPlayersInRoom(roomCode);
                        const connectedPlayers = players.filter(p => p.connected && p.sessionId !== socket.sessionId);

                        if (connectedPlayers.length > 0) {
                            // Transfer host to first connected player
                            const newHost = connectedPlayers[0];

                            // Clear old host's isHost flag first
                            await playerService.updatePlayer(socket.sessionId, { isHost: false });
                            await playerService.updatePlayer(newHost.sessionId, { isHost: true });

                            // Update room
                            if (room) {
                                room.hostSessionId = newHost.sessionId;
                                await redis.set(`room:${roomCode}`, JSON.stringify(room), { EX: REDIS_TTL.ROOM });
                            }

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

                            logger.info(`Host transferred to ${newHost.nickname} in room ${roomCode}`);
                        }
                    } finally {
                        // Release lock
                        await redis.del(lockKey);
                    }
                } else {
                    logger.debug(`Host transfer lock not acquired for room ${roomCode}, another instance handling it`);
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
    return await timerService.getTimerStatus(roomCode);
}

/**
 * Cleanup socket module resources on shutdown
 * Call this before process exit to prevent memory leaks
 */
function cleanupSocketModule() {
    // Stop rate limiter cleanup interval
    stopRateLimitCleanup();

    // Close socket.io server if initialized
    if (io) {
        io.close();
        io = null;
    }

    logger.info('Socket module cleaned up');
}

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
    cleanupSocketModule
};
