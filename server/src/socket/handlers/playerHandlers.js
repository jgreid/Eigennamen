/**
 * Player Socket Event Handlers
 */

const playerService = require('../../services/playerService');
const { validateInput } = require('../../middleware/validation');
const { playerTeamSchema, playerRoleSchema, playerNicknameSchema } = require('../../validators/schemas');
const logger = require('../../utils/logger');
const { ERROR_CODES } = require('../../config/constants');
const { createRateLimitedHandler } = require('../index');

module.exports = function playerHandlers(io, socket) {

    /**
     * Set player's team
     */
    socket.on('player:setTeam', createRateLimitedHandler(socket, 'player:team', async (data) => {
        try {
            if (!socket.roomCode) {
                throw { code: ERROR_CODES.ROOM_NOT_FOUND, message: 'Not in a room' };
            }

            const validated = validateInput(playerTeamSchema, data);

            const player = await playerService.setTeam(socket.sessionId, validated.team);

            // Broadcast to room
            io.to(`room:${socket.roomCode}`).emit('player:updated', {
                sessionId: socket.sessionId,
                changes: { team: player.team }
            });

            logger.info(`Player ${socket.sessionId} joined team ${player.team}`);

        } catch (error) {
            logger.error('Error setting team:', error);
            socket.emit('player:error', {
                code: error.code || ERROR_CODES.SERVER_ERROR,
                message: error.message
            });
        }
    }));

    /**
     * Set player's role
     */
    socket.on('player:setRole', createRateLimitedHandler(socket, 'player:role', async (data) => {
        try {
            if (!socket.roomCode) {
                throw { code: ERROR_CODES.ROOM_NOT_FOUND, message: 'Not in a room' };
            }

            const validated = validateInput(playerRoleSchema, data);

            const player = await playerService.setRole(socket.sessionId, validated.role);

            // Broadcast to room
            io.to(`room:${socket.roomCode}`).emit('player:updated', {
                sessionId: socket.sessionId,
                changes: { role: player.role }
            });

            // If becoming spymaster, send them the card types
            if (player.role === 'spymaster') {
                const gameService = require('../../services/gameService');
                const game = await gameService.getGame(socket.roomCode);
                if (game && !game.gameOver) {
                    socket.emit('game:spymasterView', { types: game.types });
                }
            }

            logger.info(`Player ${socket.sessionId} set role to ${player.role}`);

        } catch (error) {
            logger.error('Error setting role:', error);
            socket.emit('player:error', {
                code: error.code || ERROR_CODES.SERVER_ERROR,
                message: error.message
            });
        }
    }));

    /**
     * Update nickname
     */
    socket.on('player:setNickname', createRateLimitedHandler(socket, 'player:nickname', async (data) => {
        try {
            if (!socket.roomCode) {
                throw { code: ERROR_CODES.ROOM_NOT_FOUND, message: 'Not in a room' };
            }

            const validated = validateInput(playerNicknameSchema, data);

            const player = await playerService.setNickname(socket.sessionId, validated.nickname);

            // Broadcast to room
            io.to(`room:${socket.roomCode}`).emit('player:updated', {
                sessionId: socket.sessionId,
                changes: { nickname: player.nickname }
            });

            logger.info(`Player ${socket.sessionId} changed nickname to ${player.nickname}`);

        } catch (error) {
            logger.error('Error setting nickname:', error);
            socket.emit('player:error', {
                code: error.code || ERROR_CODES.SERVER_ERROR,
                message: error.message
            });
        }
    }));
};
