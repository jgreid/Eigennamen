/**
 * Chat Socket Event Handlers
 */

const playerService = require('../../services/playerService');
const { validateInput } = require('../../middleware/validation');
const { chatMessageSchema } = require('../../validators/schemas');
const logger = require('../../utils/logger');
const { ERROR_CODES } = require('../../config/constants');
const { createRateLimitedHandler } = require('../index');

module.exports = function chatHandlers(io, socket) {

    /**
     * Send a chat message
     */
    socket.on('chat:message', createRateLimitedHandler(socket, 'chat:message', async (data) => {
        try {
            if (!socket.roomCode) {
                throw { code: ERROR_CODES.ROOM_NOT_FOUND, message: 'Not in a room' };
            }

            const validated = validateInput(chatMessageSchema, data);

            const player = await playerService.getPlayer(socket.sessionId);
            if (!player) {
                throw { code: ERROR_CODES.SERVER_ERROR, message: 'Player not found' };
            }

            const message = {
                from: {
                    sessionId: player.sessionId,
                    nickname: player.nickname,
                    team: player.team
                },
                text: validated.text,
                teamOnly: validated.teamOnly,
                timestamp: Date.now()
            };

            if (validated.teamOnly && player.team) {
                // Send only to teammates
                const players = await playerService.getPlayersInRoom(socket.roomCode);
                const teammates = players.filter(p => p.team === player.team);

                for (const teammate of teammates) {
                    io.to(`player:${teammate.sessionId}`).emit('chat:message', message);
                }
            } else {
                // Send to everyone in the room
                io.to(`room:${socket.roomCode}`).emit('chat:message', message);
            }

        } catch (error) {
            logger.error('Error sending chat message:', error);
            socket.emit('chat:error', {
                code: error.code || ERROR_CODES.SERVER_ERROR,
                message: error.message
            });
        }
    }));
};
