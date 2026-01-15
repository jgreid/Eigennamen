/**
 * Room Socket Event Handlers
 */

const roomService = require('../../services/roomService');
const playerService = require('../../services/playerService');
const { validateInput } = require('../../middleware/validation');
const { roomCreateSchema, roomJoinSchema, roomSettingsSchema } = require('../../validators/schemas');
const logger = require('../../utils/logger');
const { ERROR_CODES } = require('../../config/constants');

module.exports = function roomHandlers(io, socket) {

    /**
     * Create a new room
     */
    socket.on('room:create', async (data) => {
        try {
            const validated = validateInput(roomCreateSchema, data);

            const { room, player } = await roomService.createRoom(
                socket.sessionId,
                validated.settings
            );

            // Join the socket to the room
            socket.join(`room:${room.code}`);
            socket.join(`player:${socket.sessionId}`);
            socket.roomCode = room.code;

            socket.emit('room:created', { room, player });
            logger.info(`Room created: ${room.code} by ${socket.sessionId}`);

        } catch (error) {
            logger.error('Error creating room:', error);
            socket.emit('room:error', {
                code: error.code || ERROR_CODES.SERVER_ERROR,
                message: error.message
            });
        }
    });

    /**
     * Join an existing room
     */
    socket.on('room:join', async (data) => {
        try {
            const validated = validateInput(roomJoinSchema, data);

            const { room, players, game, player } = await roomService.joinRoom(
                validated.code,
                socket.sessionId,
                validated.nickname
            );

            // Join the socket to the room
            socket.join(`room:${room.code}`);
            socket.join(`player:${socket.sessionId}`);
            socket.roomCode = room.code;

            // Send room state to the joining player
            socket.emit('room:joined', { room, players, game, you: player });

            // Notify others in the room
            socket.to(`room:${room.code}`).emit('room:playerJoined', { player });

            logger.info(`Player ${validated.nickname} joined room ${room.code}`);

        } catch (error) {
            logger.error('Error joining room:', error);
            socket.emit('room:error', {
                code: error.code || ERROR_CODES.SERVER_ERROR,
                message: error.message
            });
        }
    });

    /**
     * Leave the current room
     */
    socket.on('room:leave', async () => {
        try {
            if (!socket.roomCode) {
                return;
            }

            const result = await roomService.leaveRoom(socket.roomCode, socket.sessionId);

            // Leave the socket room
            socket.leave(`room:${socket.roomCode}`);

            // Notify others
            io.to(`room:${socket.roomCode}`).emit('room:playerLeft', {
                sessionId: socket.sessionId,
                newHost: result.newHostId
            });

            logger.info(`Player ${socket.sessionId} left room ${socket.roomCode}`);
            socket.roomCode = null;

        } catch (error) {
            logger.error('Error leaving room:', error);
            socket.emit('room:error', {
                code: error.code || ERROR_CODES.SERVER_ERROR,
                message: error.message
            });
        }
    });

    /**
     * Update room settings (host only)
     */
    socket.on('room:settings', async (data) => {
        try {
            if (!socket.roomCode) {
                throw { code: ERROR_CODES.ROOM_NOT_FOUND, message: 'Not in a room' };
            }

            const validated = validateInput(roomSettingsSchema, data);

            const settings = await roomService.updateSettings(
                socket.roomCode,
                socket.sessionId,
                validated
            );

            // Broadcast to all in room
            io.to(`room:${socket.roomCode}`).emit('room:settingsUpdated', { settings });

            logger.info(`Room ${socket.roomCode} settings updated`);

        } catch (error) {
            logger.error('Error updating settings:', error);
            socket.emit('room:error', {
                code: error.code || ERROR_CODES.SERVER_ERROR,
                message: error.message
            });
        }
    });
};
