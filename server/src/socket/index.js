/**
 * Socket.io Configuration and Event Handling
 * Optimized for Fly.io deployment with WebSocket transport
 */

const { Server } = require('socket.io');
const { createAdapter } = require('@socket.io/redis-adapter');
const { getPubSubClients, isUsingMemoryMode } = require('../config/redis');
const logger = require('../utils/logger');
const roomHandlers = require('./handlers/roomHandlers');
const gameHandlers = require('./handlers/gameHandlers');
const playerHandlers = require('./handlers/playerHandlers');
const chatHandlers = require('./handlers/chatHandlers');
const { authenticateSocket } = require('../middleware/socketAuth');
const { createSocketRateLimiter } = require('../middleware/rateLimit');
const timerService = require('../services/timerService');

let io = null;

// Create socket rate limiter with event-specific limits
const socketRateLimiter = createSocketRateLimiter({
    'room:create': { max: 5, window: 60000 },      // 5 per minute
    'room:join': { max: 10, window: 60000 },       // 10 per minute
    'room:leave': { max: 10, window: 60000 },      // 10 per minute
    'room:settings': { max: 10, window: 60000 },   // 10 per minute
    'game:start': { max: 10, window: 60000 },      // 10 per minute
    'game:reveal': { max: 30, window: 60000 },     // 30 per minute
    'game:clue': { max: 20, window: 60000 },       // 20 per minute
    'game:endTurn': { max: 20, window: 60000 },    // 20 per minute
    'game:forfeit': { max: 5, window: 60000 },     // 5 per minute
    'game:history': { max: 10, window: 60000 },    // 10 per minute
    'player:team': { max: 20, window: 60000 },     // 20 per minute
    'player:role': { max: 20, window: 60000 },     // 20 per minute
    'player:nickname': { max: 10, window: 60000 }, // 10 per minute
    'chat:message': { max: 30, window: 60000 }     // 30 per minute
});

// Start periodic cleanup of stale rate limit entries
// Store reference for cleanup on shutdown
let rateLimitCleanupInterval = setInterval(() => socketRateLimiter.cleanupStale(), 60000);

/**
 * Create a rate-limited socket event handler wrapper
 * @param {object} socket - Socket instance
 * @param {string} eventName - Event name for rate limiting
 * @param {Function} handler - Async handler function
 * @returns {Function} Wrapped handler with rate limiting
 */
function createRateLimitedHandler(socket, eventName, handler) {
    return async (data) => {
        const limiter = socketRateLimiter.getLimiter(eventName);
        limiter(socket, data, async (err) => {
            if (err) {
                logger.warn(`Rate limit exceeded for ${eventName} from ${socket.id}`);
                const errorEvent = `${eventName.split(':')[0]}:error`;
                socket.emit(errorEvent, {
                    code: 'RATE_LIMITED',
                    message: 'Too many requests, please slow down'
                });
                return;
            }
            try {
                await handler(data);
            } catch (error) {
                logger.error(`Error in ${eventName} handler:`, error);
            }
        });
    };
}

function initializeSocket(server) {
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
            const result = await gameService.endTurn(roomCode, 'Timer');
            emitToRoom(roomCode, 'game:turnEnded', {
                currentTurn: result.currentTurn,
                previousTurn: result.previousTurn,
                reason: 'timerExpired'
            });
            emitToRoom(roomCode, 'timer:expired', { roomCode });

            // Restart timer for the new turn (if timer is configured and game not over)
            setTimeout(async () => {
                try {
                    const room = await roomService.getRoom(roomCode);
                    const game = await gameService.getGame(roomCode);

                    if (room && room.settings && room.settings.turnTimer && game && !game.gameOver) {
                        await startTurnTimer(roomCode, room.settings.turnTimer);
                    }
                } catch (err) {
                    logger.debug(`Timer restart skipped for room ${roomCode}: ${err.message}`);
                }
            }, 100);
        } catch (error) {
            logger.error(`Timer expiry error for room ${roomCode}:`, error);
        }
    };
}

/**
 * Handle player disconnection with room notification
 */
async function handleDisconnect(io, socket, reason) {
    const playerService = require('../services/playerService');
    const roomService = require('../services/roomService');

    try {
        const player = await playerService.getPlayer(socket.sessionId);

        if (!player) {
            return;
        }

        const roomCode = player.roomCode;

        // Update player's connected status
        await playerService.handleDisconnect(socket.sessionId);

        // Notify other players in the room
        if (roomCode) {
            io.to(`room:${roomCode}`).emit('player:disconnected', {
                sessionId: socket.sessionId,
                nickname: player.nickname,
                team: player.team,
                reason: reason,
                timestamp: Date.now()
            });

            // Check if disconnected player was host
            if (player.isHost) {
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
                        const redis = require('../config/redis').getRedis();
                        const { REDIS_TTL } = require('../config/constants');
                        await redis.set(`room:${roomCode}`, JSON.stringify(room), { EX: REDIS_TTL.ROOM });
                    }

                    io.to(`room:${roomCode}`).emit('room:hostChanged', {
                        newHostSessionId: newHost.sessionId,
                        newHostNickname: newHost.nickname,
                        reason: 'previousHostDisconnected'
                    });

                    logger.info(`Host transferred to ${newHost.nickname} in room ${roomCode}`);
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
 * Get the socket rate limiter for use in handlers
 */
function getSocketRateLimiter() {
    return socketRateLimiter;
}

/**
 * Cleanup socket module resources on shutdown
 * Call this before process exit to prevent memory leaks
 */
function cleanupSocketModule() {
    // Clear rate limiter cleanup interval
    if (rateLimitCleanupInterval) {
        clearInterval(rateLimitCleanupInterval);
        rateLimitCleanupInterval = null;
    }

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
