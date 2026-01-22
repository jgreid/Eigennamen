/**
 * Player Socket Event Handlers
 */

const playerService = require('../../services/playerService');
const eventLogService = require('../../services/eventLogService');
const { validateInput } = require('../../middleware/validation');
const { playerTeamSchema, playerRoleSchema, playerNicknameSchema } = require('../../validators/schemas');
const logger = require('../../utils/logger');
const { ERROR_CODES } = require('../../config/constants');
const { createRateLimitedHandler } = require('../rateLimitHandler');
const { RoomError } = require('../../errors/GameError');

module.exports = function playerHandlers(io, socket) {

    /**
     * Set player's team
     * Issue #61 Fix: Prevent clickers/spymasters from switching teams during their active turn
     * Issue #59 Fix: Prevent team from becoming empty during active game
     */
    socket.on('player:setTeam', createRateLimitedHandler(socket, 'player:team', async (data) => {
        try {
            if (!socket.roomCode) {
                throw RoomError.notFound(socket.roomCode);
            }

            const validated = validateInput(playerTeamSchema, data);
            const gameService = require('../../services/gameService');

            // Get current player and game state
            const currentPlayer = await playerService.getPlayer(socket.sessionId);
            const game = await gameService.getGame(socket.roomCode);

            // Check if player has an active role during their team's turn (Issue #61)
            if (currentPlayer && (currentPlayer.role === 'spymaster' || currentPlayer.role === 'clicker')) {
                if (game && !game.gameOver && game.currentTurn === currentPlayer.team) {
                    throw {
                        code: ERROR_CODES.CANNOT_SWITCH_TEAM_DURING_TURN,
                        message: `Cannot switch teams while you are the active ${currentPlayer.role} during your team's turn`
                    };
                }
            }

            // ISSUE #59 FIX: Prevent team from becoming empty during active game
            if (game && !game.gameOver && currentPlayer && currentPlayer.team && currentPlayer.team !== validated.team) {
                // Player is leaving their current team - check if it would become empty
                const teamMembers = await playerService.getTeamMembers(socket.roomCode, currentPlayer.team);
                // Filter to only connected players (excluding this player)
                const remainingMembers = teamMembers.filter(p =>
                    p.sessionId !== socket.sessionId && p.connected
                );

                if (remainingMembers.length === 0) {
                    throw {
                        code: ERROR_CODES.INVALID_INPUT,
                        message: `Cannot leave team ${currentPlayer.team} - your team cannot be empty during an active game`
                    };
                }
            }

            const player = await playerService.setTeam(socket.sessionId, validated.team);

            // Broadcast to room
            io.to(`room:${socket.roomCode}`).emit('player:updated', {
                sessionId: socket.sessionId,
                changes: { team: player.team }
            });

            // Log event for reconnection recovery
            await eventLogService.logEvent(
                socket.roomCode,
                eventLogService.EVENT_TYPES.TEAM_CHANGED,
                {
                    sessionId: socket.sessionId,
                    nickname: player.nickname,
                    team: player.team
                }
            );

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
                throw RoomError.notFound(socket.roomCode);
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

            // Log event for reconnection recovery
            await eventLogService.logEvent(
                socket.roomCode,
                eventLogService.EVENT_TYPES.ROLE_CHANGED,
                {
                    sessionId: socket.sessionId,
                    nickname: player.nickname,
                    role: player.role
                }
            );

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
                throw RoomError.notFound(socket.roomCode);
            }

            const validated = validateInput(playerNicknameSchema, data);

            const player = await playerService.setNickname(socket.sessionId, validated.nickname);

            // Broadcast to room
            io.to(`room:${socket.roomCode}`).emit('player:updated', {
                sessionId: socket.sessionId,
                changes: { nickname: player.nickname }
            });

            // Log event for reconnection recovery
            await eventLogService.logEvent(
                socket.roomCode,
                eventLogService.EVENT_TYPES.NICKNAME_CHANGED,
                {
                    sessionId: socket.sessionId,
                    nickname: player.nickname
                }
            );

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
