/**
 * Player Socket Event Handlers
 *
 * Migrated to use context handler architecture for consistent
 * validation, error handling, and socket room management.
 */

const playerService = require('../../services/playerService');
const gameService = require('../../services/gameService');
const { playerTeamSchema, playerRoleSchema, playerNicknameSchema, playerKickSchema } = require('../../validators/schemas');
const logger = require('../../utils/logger');
const { ERROR_CODES, SOCKET_EVENTS } = require('../../config/constants');
const { createRoomHandler, createHostHandler } = require('../contextHandler');
const { canChangeTeamOrRole } = require('../playerContext');
const { PlayerError, ValidationError, GameStateError } = require('../../errors/GameError');
const { sanitizeHtml } = require('../../utils/sanitize');

module.exports = function playerHandlers(io, socket) {

    /**
     * Set player's team
     */
    socket.on(SOCKET_EVENTS.PLAYER_SET_TEAM, createRoomHandler(socket, SOCKET_EVENTS.PLAYER_SET_TEAM, playerTeamSchema,
        async (ctx, validated) => {
            const canChange = canChangeTeamOrRole(ctx, { isTeamChange: true });
            if (!canChange.allowed) {
                const errorCode = canChange.code || ERROR_CODES.CANNOT_SWITCH_TEAM_DURING_TURN;
                throw new GameStateError(errorCode, canChange.reason);
            }

            const shouldCheckEmpty = !!(ctx.game && !ctx.game.gameOver &&
                ctx.player.team && ctx.player.team !== validated.team);
            const player = await playerService.setTeam(ctx.sessionId, validated.team, shouldCheckEmpty);

            if (!player) {
                throw PlayerError.notFound(ctx.sessionId);
            }

            // Update spectator room membership
            if (player.team) {
                socket.leave(`spectators:${ctx.roomCode}`);
            } else {
                socket.join(`spectators:${ctx.roomCode}`);
            }

            // Build changes object - include role if it was changed by the team switch
            // (e.g., clicker/spymaster role is reset to spectator when switching teams)
            const changes = { team: player.team };
            if (player.role !== ctx.player.role) {
                changes.role = player.role;
            }

            // Broadcast to room
            io.to(`room:${ctx.roomCode}`).emit(SOCKET_EVENTS.PLAYER_UPDATED, {
                sessionId: ctx.sessionId,
                changes
            });

            // Broadcast updated stats
            const roomStats = await playerService.getRoomStats(ctx.roomCode);
            io.to(`room:${ctx.roomCode}`).emit(SOCKET_EVENTS.ROOM_STATS_UPDATED, { stats: roomStats });

            logger.info(`Player ${ctx.sessionId} joined team ${player.team}`);

        }
    ));

    /**
     * Set player's role
     */
    socket.on(SOCKET_EVENTS.PLAYER_SET_ROLE, createRoomHandler(socket, SOCKET_EVENTS.PLAYER_SET_ROLE, playerRoleSchema,
        async (ctx, validated) => {
            // Skip validation if player already has the requested role (idempotent)
            if (ctx.player.role !== validated.role) {
                const canChange = canChangeTeamOrRole(ctx);
                if (!canChange.allowed) {
                    throw new GameStateError(ERROR_CODES.CANNOT_CHANGE_ROLE_DURING_TURN, canChange.reason);
                }
            }

            const player = await playerService.setRole(ctx.sessionId, validated.role);

            if (!player) {
                throw PlayerError.notFound(ctx.sessionId);
            }

            // Update spectator room membership
            if (player.team && player.role !== 'spectator') {
                socket.leave(`spectators:${ctx.roomCode}`);
            } else {
                socket.join(`spectators:${ctx.roomCode}`);
            }

            // Broadcast to room
            io.to(`room:${ctx.roomCode}`).emit(SOCKET_EVENTS.PLAYER_UPDATED, {
                sessionId: ctx.sessionId,
                changes: { role: player.role }
            });

            // Broadcast updated stats
            const roomStats = await playerService.getRoomStats(ctx.roomCode);
            io.to(`room:${ctx.roomCode}`).emit(SOCKET_EVENTS.ROOM_STATS_UPDATED, { stats: roomStats });

            // If becoming spymaster, re-fetch game state to avoid stale context
            if (player.role === 'spymaster') {
                const freshGame = await gameService.getGame(ctx.roomCode);
                if (freshGame && !freshGame.gameOver) {
                    socket.emit(SOCKET_EVENTS.GAME_SPYMASTER_VIEW, { types: freshGame.types });
                }
            }

            logger.info(`Player ${ctx.sessionId} set role to ${player.role}`);

            return { player };
        }
    ));

    /**
     * Update nickname
     */
    socket.on(SOCKET_EVENTS.PLAYER_SET_NICKNAME, createRoomHandler(socket, SOCKET_EVENTS.PLAYER_SET_NICKNAME, playerNicknameSchema,
        async (ctx, validated) => {
            const player = await playerService.setNickname(ctx.sessionId, validated.nickname);

            if (!player) {
                throw PlayerError.notFound(ctx.sessionId);
            }

            const sanitizedNickname = sanitizeHtml(player.nickname);

            // Broadcast to room
            io.to(`room:${ctx.roomCode}`).emit(SOCKET_EVENTS.PLAYER_UPDATED, {
                sessionId: ctx.sessionId,
                changes: { nickname: sanitizedNickname }
            });

            logger.info(`Player ${ctx.sessionId} changed nickname to ${sanitizedNickname}`);

            return { player };
        }
    ));

    /**
     * Kick a player from the room (host only)
     */
    socket.on(SOCKET_EVENTS.PLAYER_KICK, createHostHandler(socket, SOCKET_EVENTS.PLAYER_KICK, playerKickSchema,
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
            io.to(`room:${ctx.roomCode}`).emit(SOCKET_EVENTS.PLAYER_KICKED, {
                sessionId: validated.targetSessionId,
                nickname: sanitizeHtml(targetPlayer.nickname),
                kickedBy: sanitizeHtml(ctx.player.nickname)
            });

            // Remove player from room data
            await playerService.removePlayer(validated.targetSessionId);

            // Disconnect the target player's socket
            if (targetSocketId) {
                const targetSocket = io.sockets.sockets.get(targetSocketId);
                if (targetSocket) {
                    targetSocket.emit(SOCKET_EVENTS.ROOM_KICKED, {
                        reason: 'You were removed from the room by the host'
                    });
                    targetSocket.leave(`room:${ctx.roomCode}`);
                    targetSocket.roomCode = null;
                    targetSocket.disconnect(true);
                }
            }

            // Update player list for remaining players
            const remainingPlayers = await playerService.getPlayersInRoom(ctx.roomCode);
            io.to(`room:${ctx.roomCode}`).emit(SOCKET_EVENTS.ROOM_PLAYER_LEFT, {
                sessionId: validated.targetSessionId,
                newHost: null,
                players: remainingPlayers || []
            });

            logger.info(`Host ${sanitizeHtml(ctx.player.nickname)} kicked player ${sanitizeHtml(targetPlayer.nickname)} from room ${ctx.roomCode}`);

        }
    ));
};
