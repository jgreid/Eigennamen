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
const { RoomError, PlayerError, ValidationError } = require('../../errors/GameError');

module.exports = function playerHandlers(io, socket) {

    /**
     * Set player's team
     * Issue #61 Fix: Prevent clickers/spymasters from switching teams during their active turn
     * Issue #59 Fix: Prevent team from becoming empty during active game
     * ISSUE #10 & #18 FIX: Validate socket.roomCode before operations
     */
    socket.on('player:setTeam', createRateLimitedHandler(socket, 'player:team', async (data) => {
        try {
            // ISSUE #18 FIX: Better error message for missing roomCode
            if (!socket.roomCode) {
                throw new RoomError(ERROR_CODES.ROOM_NOT_FOUND, 'Not in a room', { roomCode: 'none' });
            }

            const validated = validateInput(playerTeamSchema, data);
            const gameService = require('../../services/gameService');

            // ISSUE #10 FIX: Verify player exists before proceeding
            const currentPlayer = await playerService.getPlayer(socket.sessionId);
            if (!currentPlayer || currentPlayer.roomCode !== socket.roomCode) {
                throw new RoomError(ERROR_CODES.ROOM_NOT_FOUND, 'Player not in room', { roomCode: socket.roomCode });
            }

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

            // ISSUE #59 FIX: Use atomic safeSetTeam to prevent team from becoming empty during active game
            // The checkEmpty flag triggers atomic validation in the Lua script
            const shouldCheckEmpty = game && !game.gameOver && currentPlayer && currentPlayer.team && currentPlayer.team !== validated.team;
            const player = await playerService.safeSetTeam(socket.sessionId, validated.team, shouldCheckEmpty);

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
     * ISSUE #10 & #18 FIX: Validate socket.roomCode before operations
     */
    socket.on('player:setRole', createRateLimitedHandler(socket, 'player:role', async (data) => {
        try {
            // ISSUE #18 FIX: Better error message for missing roomCode
            if (!socket.roomCode) {
                throw new RoomError(ERROR_CODES.ROOM_NOT_FOUND, 'Not in a room', { roomCode: 'none' });
            }

            const validated = validateInput(playerRoleSchema, data);

            const player = await playerService.setRole(socket.sessionId, validated.role);

            // ISSUE #10 FIX: Verify player is still in the room before broadcasting
            if (!player || player.roomCode !== socket.roomCode) {
                throw new RoomError(ERROR_CODES.ROOM_NOT_FOUND, 'Player not in room', { roomCode: socket.roomCode });
            }

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
     * ISSUE #10 & #18 FIX: Validate socket.roomCode before operations
     */
    socket.on('player:setNickname', createRateLimitedHandler(socket, 'player:nickname', async (data) => {
        try {
            // ISSUE #18 FIX: Better error message for missing roomCode
            if (!socket.roomCode) {
                throw new RoomError(ERROR_CODES.ROOM_NOT_FOUND, 'Not in a room', { roomCode: 'none' });
            }

            const validated = validateInput(playerNicknameSchema, data);

            const player = await playerService.setNickname(socket.sessionId, validated.nickname);

            // ISSUE #10 FIX: Verify player is still in the room before broadcasting
            if (!player || player.roomCode !== socket.roomCode) {
                throw new RoomError(ERROR_CODES.ROOM_NOT_FOUND, 'Player not in room', { roomCode: socket.roomCode });
            }

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

    /**
     * Kick a player from the room (host only)
     * PHASE 1 FIX: Allow host to remove disruptive players
     * ISSUE #10 & #18 FIX: Validate socket.roomCode before operations
     */
    socket.on('player:kick', createRateLimitedHandler(socket, 'player:kick', async (data) => {
        try {
            // ISSUE #18 FIX: Better error message for missing roomCode
            if (!socket.roomCode) {
                throw new RoomError(ERROR_CODES.ROOM_NOT_FOUND, 'Not in a room', { roomCode: 'none' });
            }

            if (!data || !data.targetSessionId) {
                throw new ValidationError('Target player session ID required');
            }

            // Verify requester is the host
            const requester = await playerService.getPlayer(socket.sessionId);
            if (!requester || !requester.isHost) {
                throw PlayerError.notHost();
            }

            // Cannot kick yourself
            if (data.targetSessionId === socket.sessionId) {
                throw new ValidationError('Cannot kick yourself');
            }

            // Get target player
            const targetPlayer = await playerService.getPlayer(data.targetSessionId);
            if (!targetPlayer || targetPlayer.roomCode !== socket.roomCode) {
                throw PlayerError.notFound(data.targetSessionId);
            }

            // Get target player's socket ID
            const targetSocketId = await playerService.getSocketId(data.targetSessionId);

            // Broadcast kick event before removing player
            io.to(`room:${socket.roomCode}`).emit('player:kicked', {
                sessionId: data.targetSessionId,
                nickname: targetPlayer.nickname,
                kickedBy: requester.nickname
            });

            // Log the kick event
            await eventLogService.logEvent(
                socket.roomCode,
                eventLogService.EVENT_TYPES.PLAYER_LEFT,
                {
                    sessionId: data.targetSessionId,
                    nickname: targetPlayer.nickname,
                    reason: 'kicked',
                    kickedBy: requester.nickname
                }
            );

            // Remove player from room data
            await playerService.removePlayer(data.targetSessionId);

            // Disconnect the target player's socket
            if (targetSocketId) {
                const targetSocket = io.sockets.sockets.get(targetSocketId);
                if (targetSocket) {
                    // Send kick notification to the kicked player before disconnecting
                    targetSocket.emit('room:kicked', {
                        reason: 'You were removed from the room by the host'
                    });
                    targetSocket.leave(`room:${socket.roomCode}`);
                    targetSocket.roomCode = null;
                    targetSocket.disconnect(true);
                }
            }

            // Update player list for remaining players
            const remainingPlayers = await playerService.getPlayersInRoom(socket.roomCode);
            io.to(`room:${socket.roomCode}`).emit('room:playerLeft', {
                sessionId: data.targetSessionId,
                players: remainingPlayers
            });

            logger.info(`Host ${requester.nickname} kicked player ${targetPlayer.nickname} from room ${socket.roomCode}`);

        } catch (error) {
            logger.error('Error kicking player:', error);
            socket.emit('player:error', {
                code: error.code || ERROR_CODES.SERVER_ERROR,
                message: error.message
            });
        }
    }));
};
