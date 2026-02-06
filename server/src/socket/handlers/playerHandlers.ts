/**
 * Player Socket Event Handlers
 *
 * Migrated to use context handler architecture for consistent
 * validation, error handling, and socket room management.
 */

import type { Server, Socket } from 'socket.io';
import type { Player, GameState, Team, Role } from '../../types';

/* eslint-disable @typescript-eslint/no-var-requires */
const playerService = require('../../services/playerService');
const gameService = require('../../services/gameService');
const { playerTeamSchema, playerRoleSchema, playerNicknameSchema, playerKickSchema } = require('../../validators/schemas');
const logger = require('../../utils/logger');
const { ERROR_CODES, SOCKET_EVENTS } = require('../../config/constants');
const { createRoomHandler, createHostHandler } = require('../contextHandler');
const { canChangeTeamOrRole } = require('../playerContext');
const { PlayerError, ValidationError, GameStateError } = require('../../errors/GameError');
const { sanitizeHtml } = require('../../utils/sanitize');
/* eslint-enable @typescript-eslint/no-var-requires */

/**
 * Extended Socket type with custom properties
 */
interface GameSocket extends Socket {
    sessionId: string;
    roomCode: string | null;
}

/**
 * Room handler context
 */
interface RoomContext {
    sessionId: string;
    roomCode: string;
    player: Player;
    game: GameState | null;
}

/**
 * Player team input
 */
interface PlayerTeamInput {
    team: Team | null;
}

/**
 * Player role input
 */
interface PlayerRoleInput {
    role: Role;
}

/**
 * Player nickname input
 */
interface PlayerNicknameInput {
    nickname: string;
}

/**
 * Player kick input
 */
interface PlayerKickInput {
    targetSessionId: string;
}

/**
 * Room stats
 */
interface RoomStats {
    totalPlayers: number;
    spectatorCount: number;
    teams: {
        red: { total: number; spymaster: string | null; clicker: string | null };
        blue: { total: number; spymaster: string | null; clicker: string | null };
    };
}

/**
 * Change permission result
 */
interface ChangePermission {
    allowed: boolean;
    reason?: string;
    code?: string;
}

/**
 * Bug #14 Fix: Helper to sync spectator room membership based on CURRENT player state.
 * This prevents race conditions where concurrent setTeam/setRole operations could
 * result in inconsistent socket room membership (e.g., spymaster incorrectly in spectators room).
 *
 * The issue: Each handler uses the result from its own Lua script to decide room membership,
 * but that result can be stale if another operation completed after the Lua script ran.
 *
 * The fix: Always re-fetch current player state before updating socket rooms.
 */
async function syncSpectatorRoomMembership(
    socket: GameSocket,
    roomCode: string,
    sessionId: string
): Promise<void> {
    // Re-fetch current player state to ensure we have the latest team/role
    const currentPlayer: Player | null = await playerService.getPlayer(sessionId);
    if (!currentPlayer) return;

    const spectatorRoom = `spectators:${roomCode}`;

    // Player should be in spectators room if:
    // - They have no team, OR
    // - Their role is 'spectator'
    const shouldBeInSpectatorRoom = !currentPlayer.team || currentPlayer.role === 'spectator';

    if (shouldBeInSpectatorRoom) {
        socket.join(spectatorRoom);
    } else {
        socket.leave(spectatorRoom);
    }
}

function playerHandlers(io: Server, socket: GameSocket): void {

    /**
     * Set player's team
     */
    socket.on(SOCKET_EVENTS.PLAYER_SET_TEAM, createRoomHandler(socket, SOCKET_EVENTS.PLAYER_SET_TEAM, playerTeamSchema,
        async (ctx: RoomContext, validated: PlayerTeamInput) => {
            const canChange: ChangePermission = canChangeTeamOrRole(ctx, { isTeamChange: true });
            if (!canChange.allowed) {
                const errorCode = canChange.code || ERROR_CODES.CANNOT_SWITCH_TEAM_DURING_TURN;
                throw new GameStateError(errorCode, canChange.reason);
            }

            const shouldCheckEmpty = !!(ctx.game && !ctx.game.gameOver &&
                ctx.player.team && ctx.player.team !== validated.team);
            const player: Player | null = await playerService.setTeam(ctx.sessionId, validated.team, shouldCheckEmpty);

            if (!player) {
                throw PlayerError.notFound(ctx.sessionId);
            }

            // Bug #14 Fix: Sync spectator room membership based on current state
            // (prevents race with concurrent setRole operations)
            await syncSpectatorRoomMembership(socket, ctx.roomCode, ctx.sessionId);

            // Build changes object - include role if it was changed by the team switch
            // (e.g., clicker/spymaster role is reset to spectator when switching teams)
            const changes: { team: Team | null; role?: Role } = { team: player.team };
            if (player.role !== ctx.player.role) {
                changes.role = player.role;
            }

            // Broadcast to room
            io.to(`room:${ctx.roomCode}`).emit(SOCKET_EVENTS.PLAYER_UPDATED, {
                sessionId: ctx.sessionId,
                changes
            });

            // Broadcast updated stats
            const roomStats: RoomStats = await playerService.getRoomStats(ctx.roomCode);
            io.to(`room:${ctx.roomCode}`).emit(SOCKET_EVENTS.ROOM_STATS_UPDATED, { stats: roomStats });

            logger.info(`Player ${ctx.sessionId} joined team ${player.team}`);

        }
    ));

    /**
     * Set player's role
     */
    socket.on(SOCKET_EVENTS.PLAYER_SET_ROLE, createRoomHandler(socket, SOCKET_EVENTS.PLAYER_SET_ROLE, playerRoleSchema,
        async (ctx: RoomContext, validated: PlayerRoleInput) => {
            // Skip validation if player already has the requested role (idempotent)
            if (ctx.player.role !== validated.role) {
                const canChange: ChangePermission = canChangeTeamOrRole(ctx, { targetRole: validated.role });
                if (!canChange.allowed) {
                    throw new GameStateError(ERROR_CODES.CANNOT_CHANGE_ROLE_DURING_TURN, canChange.reason);
                }
            }

            const player: Player | null = await playerService.setRole(ctx.sessionId, validated.role);

            if (!player) {
                throw PlayerError.notFound(ctx.sessionId);
            }

            // Bug #14 Fix: Sync spectator room membership based on current state
            // (prevents race with concurrent setTeam operations)
            await syncSpectatorRoomMembership(socket, ctx.roomCode, ctx.sessionId);

            // Broadcast to room
            io.to(`room:${ctx.roomCode}`).emit(SOCKET_EVENTS.PLAYER_UPDATED, {
                sessionId: ctx.sessionId,
                changes: { role: player.role }
            });

            // Broadcast updated stats
            const roomStats: RoomStats = await playerService.getRoomStats(ctx.roomCode);
            io.to(`room:${ctx.roomCode}`).emit(SOCKET_EVENTS.ROOM_STATS_UPDATED, { stats: roomStats });

            // If becoming spymaster, re-fetch game state to avoid stale context
            if (player.role === 'spymaster') {
                const freshGame: GameState | null = await gameService.getGame(ctx.roomCode);
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
        async (ctx: RoomContext, validated: PlayerNicknameInput) => {
            const player: Player | null = await playerService.setNickname(ctx.sessionId, validated.nickname);

            if (!player) {
                throw PlayerError.notFound(ctx.sessionId);
            }

            const sanitizedNickname: string = sanitizeHtml(player.nickname);

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
        async (ctx: RoomContext, validated: PlayerKickInput) => {
            // Cannot kick yourself
            if (validated.targetSessionId === ctx.sessionId) {
                throw new ValidationError('Cannot kick yourself');
            }

            // Get target player
            const targetPlayer: Player | null = await playerService.getPlayer(validated.targetSessionId);
            if (!targetPlayer || targetPlayer.roomCode !== ctx.roomCode) {
                throw PlayerError.notFound(validated.targetSessionId);
            }

            // Get target player's socket ID
            const targetSocketId: string | null = await playerService.getSocketId(validated.targetSessionId);

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
                const targetSocket = io.sockets.sockets.get(targetSocketId) as GameSocket | undefined;
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
            const remainingPlayers: Player[] = await playerService.getPlayersInRoom(ctx.roomCode);
            io.to(`room:${ctx.roomCode}`).emit(SOCKET_EVENTS.ROOM_PLAYER_LEFT, {
                sessionId: validated.targetSessionId,
                newHost: null,
                players: remainingPlayers || []
            });

            logger.info(`Host ${sanitizeHtml(ctx.player.nickname)} kicked player ${sanitizeHtml(targetPlayer.nickname)} from room ${ctx.roomCode}`);

        }
    ));
}

module.exports = playerHandlers;
export default playerHandlers;
