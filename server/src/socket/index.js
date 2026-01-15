/**
 * Socket.io Configuration and Event Handling
 */

const { Server } = require('socket.io');
const { createAdapter } = require('@socket.io/redis-adapter');
const { getPubSubClients } = require('../config/redis');
const logger = require('../utils/logger');
const roomHandlers = require('./handlers/roomHandlers');
const gameHandlers = require('./handlers/gameHandlers');
const playerHandlers = require('./handlers/playerHandlers');
const chatHandlers = require('./handlers/chatHandlers');
const { authenticateSocket } = require('../middleware/socketAuth');
const timerService = require('../services/timerService');

let io = null;

function initializeSocket(server) {
    io = new Server(server, {
        cors: {
            origin: process.env.CORS_ORIGIN || '*',
            methods: ['GET', 'POST'],
            credentials: true
        },
        pingTimeout: 60000,
        pingInterval: 25000
    });

    // Use Redis adapter for horizontal scaling
    try {
        const { pubClient, subClient } = getPubSubClients();
        io.adapter(createAdapter(pubClient, subClient));
        logger.info('Socket.io Redis adapter configured');
    } catch (error) {
        logger.warn('Redis adapter not available, using in-memory adapter');
    }

    // Authentication middleware
    io.use(authenticateSocket);

    // Connection handling
    io.on('connection', (socket) => {
        logger.info(`Client connected: ${socket.id} (session: ${socket.sessionId})`);

        // Register all event handlers
        roomHandlers(io, socket);
        gameHandlers(io, socket);
        playerHandlers(io, socket);
        chatHandlers(io, socket);

        // Handle disconnection
        socket.on('disconnect', (reason) => {
            logger.info(`Client disconnected: ${socket.id} (reason: ${reason})`);
            handleDisconnect(io, socket, reason);
        });

        // Handle errors
        socket.on('error', (error) => {
            logger.error(`Socket error for ${socket.id}:`, error);
        });
    });

    return io;
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
 * Start a turn timer for a room
 */
function startTurnTimer(roomCode, durationSeconds) {
    const onExpire = async (code) => {
        // Auto-end turn when timer expires
        const gameService = require('../services/gameService');
        try {
            const result = await gameService.endTurn(code, 'Timer');
            emitToRoom(code, 'game:turnEnded', {
                currentTurn: result.currentTurn,
                previousTurn: result.previousTurn,
                reason: 'timerExpired'
            });
            emitToRoom(code, 'timer:expired', { roomCode: code });
        } catch (error) {
            logger.error(`Timer expiry error for room ${code}:`, error);
        }
    };

    const timerInfo = timerService.startTimer(roomCode, durationSeconds, onExpire);

    // Broadcast timer start
    emitToRoom(roomCode, 'timer:started', {
        ...timerInfo,
        roomCode
    });

    return timerInfo;
}

/**
 * Stop the turn timer for a room
 */
function stopTurnTimer(roomCode) {
    timerService.stopTimer(roomCode);
    emitToRoom(roomCode, 'timer:stopped', { roomCode });
}

/**
 * Get timer status for a room
 */
function getTimerStatus(roomCode) {
    return timerService.getTimerStatus(roomCode);
}

module.exports = {
    initializeSocket,
    getIO,
    emitToRoom,
    emitToPlayer,
    startTurnTimer,
    stopTurnTimer,
    getTimerStatus
};
