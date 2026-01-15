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
            handleDisconnect(socket);
        });

        // Handle errors
        socket.on('error', (error) => {
            logger.error(`Socket error for ${socket.id}:`, error);
        });
    });

    return io;
}

async function handleDisconnect(socket) {
    // This will be implemented to handle player disconnection
    // - Update player's connected status
    // - Notify room of disconnection
    // - Transfer host if needed
    // - Clean up after timeout
    const playerService = require('../services/playerService');
    try {
        await playerService.handleDisconnect(socket.sessionId);
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

module.exports = {
    initializeSocket,
    getIO,
    emitToRoom,
    emitToPlayer
};
