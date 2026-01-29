/**
 * Player Socket Event Handlers
 *
 * Migrated to use context handler architecture for consistent
 * validation, error handling, and socket room management.
 */

const playerService = require('../../services/playerService');
const eventLogService = require('../../services/eventLogService');
const { playerTeamSchema, playerRoleSchema, playerNicknameSchema, playerKickSchema } = require('../../validators/schemas');
const logger = require('../../utils/logger');
const { ERROR_CODES } = require('../../config/constants');
const { createRoomHandler, createHostHandler } = require('../contextHandler');
const { canChangeTeamOrRole } = require('../playerContext');
const { PlayerError, ValidationError, GameStateError, RoomError } = require('../../errors/GameError');
const { sanitizeHtml } = require('../../utils/sanitize');

module.exports = function playerHandlers(io, socket) {

    /**
     * Set player's team
     */
    socket.on('player:setTeam', createRoomHandler(socket, 'player:setTeam', playerTeamSchema,
        async (ctx, validated) => {
            const canChange = canChangeTeamOrRole(ctx);
            if (!canChange.allowed) {
                throw new GameStateError(ERROR_CODES.CANNOT_SWITCH_TEAM_DURING_TURN, canChange.reason);
            }

            const shouldCheckEmpty = ctx.game && !ctx.game.gameOver &&
                ctx.player.team && ctx.player.team !== validated.team;
            const player = await playerService.safeSetTeam(ctx.sessionId, validated.team, shouldCheckEmpty);

            if (!player) {
                throw PlayerError.notFound(ctx.sessionId);
            }

            // Broadcast to room
            io.to(`room:${ctx.roomCode}`).emit('player:updated', {
                sessionId: ctx.sessionId,
                changes: { team: player.team }
            });

            // Broadcast updated stats
            const roomStats = await playerService.getRoomStats(ctx.roomCode);
            io.to(`room:${ctx.roomCode}`).emit('room:statsUpdated', { stats: roomStats });

            // Log event for reconnection recovery
            await eventLogService.logEvent(
                ctx.roomCode,
                eventLogService.EVENT_TYPES.TEAM_CHANGED,
                {
                    sessionId: ctx.sessionId,
                    nickname: player.nickname,
                    team: player.team
                }
            );

            logger.info(`Player ${ctx.sessionId} joined team ${player.team}`);

            return { player };
        }
    ));

    /**
     * Set player's role
     */
    socket.on('player:setRole', createRoomHandler(socket, 'player:setRole', playerRoleSchema,
        async (ctx, validated) => {
            const canChange = canChangeTeamOrRole(ctx);
            if (!canChange.allowed) {
                throw new GameStateError(ERROR_CODES.CANNOT_CHANGE_ROLE_DURING_TURN, canChange.reason);
            }

            const player = await playerService.setRole(ctx.sessionId, validated.role);

            if (!player) {
                throw PlayerError.notFound(ctx.sessionId);
            }

            // Broadcast to room
            io.to(`room:${ctx.roomCode}`).emit('player:updated', {
                sessionId: ctx.sessionId,
                changes: { role: player.role }
            });

            // Broadcast updated stats
            const roomStats = await playerService.getRoomStats(ctx.roomCode);
            io.to(`room:${ctx.roomCode}`).emit('room:statsUpdated', { stats: roomStats });

            // If becoming spymaster, send card types
            if (player.role === 'spymaster' && ctx.game && !ctx.game.gameOver) {
                socket.emit('game:spymasterView', { types: ctx.game.types });
            }

            // Log event for reconnection recovery
            await eventLogService.logEvent(
                ctx.roomCode,
                eventLogService.EVENT_TYPES.ROLE_CHANGED,
                {
                    sessionId: ctx.sessionId,
                    nickname: player.nickname,
                    role: player.role
                }
            );

            logger.info(`Player ${ctx.sessionId} set role to ${player.role}`);

            return { player };
        }
    ));

    /**
     * Update nickname
     */
    socket.on('player:setNickname', createRoomHandler(socket, 'player:setNickname', playerNicknameSchema,
        async (ctx, validated) => {
            const player = await playerService.setNickname(ctx.sessionId, validated.nickname);

            if (!player) {
                throw PlayerError.notFound(ctx.sessionId);
            }

            const sanitizedNickname = sanitizeHtml(player.nickname);

            // Broadcast to room
            io.to(`room:${ctx.roomCode}`).emit('player:updated', {
                sessionId: ctx.sessionId,
                changes: { nickname: sanitizedNickname }
            });

            // Log event for reconnection recovery
            await eventLogService.logEvent(
                ctx.roomCode,
                eventLogService.EVENT_TYPES.NICKNAME_CHANGED,
                {
                    sessionId: ctx.sessionId,
                    nickname: sanitizedNickname
                }
            );

            logger.info(`Player ${ctx.sessionId} changed nickname to ${sanitizedNickname}`);

            return { player };
        }
    ));

    /**
     * Kick a player from the room (host only)
     */
    socket.on('player:kick', createHostHandler(socket, 'player:kick', playerKickSchema,
        async (ctx, validated) => {
            // Cannot kick yourself
            if (validated.targetSessionId === ctx.sessionId) {
                throw new ValidationError('Cannot kick yourself');
            }

            // Get target player
            const targetPlayer = await playerService.getPlayer(validated.targetSessionId);
            if (!targetPlayer || targetPlayer.roomCode !== ctx.roomCode) {
                throw PlayerError.notFound(validated.targetSessionId);
            }

            // Get target player's socket ID
            const targetSocketId = await playerService.getSocketId(validated.targetSessionId);

            // Broadcast kick event before removing player
            io.to(`room:${ctx.roomCode}`).emit('player:kicked', {
                sessionId: validated.targetSessionId,
                nickname: sanitizeHtml(targetPlayer.nickname),
                kickedBy: sanitizeHtml(ctx.player.nickname)
            });

            // Log the kick event
            await eventLogService.logEvent(
                ctx.roomCode,
                eventLogService.EVENT_TYPES.PLAYER_LEFT,
                {
                    sessionId: validated.targetSessionId,
                    nickname: sanitizeHtml(targetPlayer.nickname),
                    reason: 'kicked',
                    kickedBy: sanitizeHtml(ctx.player.nickname)
                }
            );

            // Remove player from room data
            await playerService.removePlayer(validated.targetSessionId);

            // Disconnect the target player's socket
            if (targetSocketId) {
                const targetSocket = io.sockets.sockets.get(targetSocketId);
                if (targetSocket) {
                    targetSocket.emit('room:kicked', {
                        reason: 'You were removed from the room by the host'
                    });
                    targetSocket.leave(`room:${ctx.roomCode}`);
                    targetSocket.roomCode = null;
                    targetSocket.disconnect(true);
                }
            }

            // Update player list for remaining players
            const remainingPlayers = await playerService.getPlayersInRoom(ctx.roomCode);
            io.to(`room:${ctx.roomCode}`).emit('room:playerLeft', {
                sessionId: validated.targetSessionId,
                newHost: null,
                players: remainingPlayers || []
            });

            logger.info(`Host ${sanitizeHtml(ctx.player.nickname)} kicked player ${sanitizeHtml(targetPlayer.nickname)} from room ${ctx.roomCode}`);
        }
    ));
};
