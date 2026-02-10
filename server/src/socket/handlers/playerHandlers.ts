/**
 * Player Socket Event Handlers
 *
 * Migrated to use context handler architecture for consistent
 * validation, error handling, and socket room management.
 */

import type { Server } from 'socket.io';
import type { Player, GameState, Team, Role } from '../../types';
import type { GameSocket, RoomContext } from './types';

const playerService = require('../../services/playerService');
const gameService = require('../../services/gameService');
const { playerTeamSchema, playerRoleSchema, playerNicknameSchema, playerKickSchema, spectatorJoinRequestSchema, spectatorJoinResponseSchema } = require('../../validators/schemas');
const logger = require('../../utils/logger');
const { ERROR_CODES, SOCKET_EVENTS } = require('../../config/constants');
const { createRoomHandler, createHostHandler } = require('../contextHandler');
const { canChangeTeamOrRole } = require('../playerContext');
const { PlayerError, ValidationError, GameStateError } = require('../../errors/GameError');
const { sanitizeHtml } = require('../../utils/sanitize');
const { safeEmitToRoom } = require('../safeEmit');

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
            safeEmitToRoom(io, ctx.roomCode, SOCKET_EVENTS.PLAYER_UPDATED, {
                sessionId: ctx.sessionId,
                changes
            });

            // Broadcast updated stats
            const roomStats: RoomStats = await playerService.getRoomStats(ctx.roomCode);
            safeEmitToRoom(io, ctx.roomCode, SOCKET_EVENTS.ROOM_STATS_UPDATED, { stats: roomStats });

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
            safeEmitToRoom(io, ctx.roomCode, SOCKET_EVENTS.PLAYER_UPDATED, {
                sessionId: ctx.sessionId,
                changes: { role: player.role }
            });

            // Broadcast updated stats
            const roomStats: RoomStats = await playerService.getRoomStats(ctx.roomCode);
            safeEmitToRoom(io, ctx.roomCode, SOCKET_EVENTS.ROOM_STATS_UPDATED, { stats: roomStats });

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
            safeEmitToRoom(io, ctx.roomCode, SOCKET_EVENTS.PLAYER_UPDATED, {
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
            safeEmitToRoom(io, ctx.roomCode, SOCKET_EVENTS.PLAYER_KICKED, {
                sessionId: validated.targetSessionId,
                nickname: sanitizeHtml(targetPlayer.nickname),
                kickedBy: sanitizeHtml(ctx.player.nickname)
            });

            // Disconnect the target player's socket BEFORE removing data from Redis.
            // This prevents a window where the kicked player's socket can still emit
            // events that reference their now-deleted player data.
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

            // Remove player from room data (after socket is disconnected)
            await playerService.removePlayer(validated.targetSessionId);

            // Update player list for remaining players
            const remainingPlayers: Player[] = await playerService.getPlayersInRoom(ctx.roomCode);
            safeEmitToRoom(io, ctx.roomCode, SOCKET_EVENTS.ROOM_PLAYER_LEFT, {
                sessionId: validated.targetSessionId,
                newHost: null,
                players: remainingPlayers || []
            });

            logger.info(`Host ${sanitizeHtml(ctx.player.nickname)} kicked player ${sanitizeHtml(targetPlayer.nickname)} from room ${ctx.roomCode}`);

        }
    ));

    // Spectator: Request to join a team
    socket.on(SOCKET_EVENTS.SPECTATOR_REQUEST_JOIN, createRoomHandler(
        io, socket, 'spectator:requestJoin',
        async (ctx: RoomContext, validated: { team: string }) => {
            // Only spectators can request to join
            if (ctx.player.team && ctx.player.role !== 'spectator') {
                throw PlayerError.notAuthorized('Only spectators can request to join a team');
            }

            // Find the host to notify
            const players: Player[] = await playerService.getPlayersInRoom(ctx.roomCode);
            const host = players.find((p: Player) => p.isHost);
            if (!host) {
                throw new PlayerError('No host found in room', ERROR_CODES.NOT_HOST);
            }

            // Emit join request to the host
            const hostSockets = await io.in(host.sessionId).fetchSockets();
            if (hostSockets.length > 0) {
                hostSockets[0]!.emit(SOCKET_EVENTS.SPECTATOR_JOIN_REQUEST, {
                    requesterId: ctx.sessionId,
                    requesterNickname: sanitizeHtml(ctx.player.nickname),
                    team: validated.team,
                    timestamp: Date.now()
                });
            }

            logger.info(`Spectator ${sanitizeHtml(ctx.player.nickname)} requested to join ${validated.team} team in room ${ctx.roomCode}`);
        },
        spectatorJoinRequestSchema
    ));

    // Host: Approve or deny spectator join request
    socket.on(SOCKET_EVENTS.SPECTATOR_APPROVE_JOIN, createHostHandler(
        io, socket, 'spectator:approveJoin',
        async (ctx: RoomContext, validated: { requesterId: string; approved: boolean }) => {
            const requester: Player | null = await playerService.getPlayer(validated.requesterId);
            if (!requester || requester.roomCode !== ctx.roomCode) {
                throw new PlayerError('Requester not found in room', ERROR_CODES.PLAYER_NOT_FOUND);
            }

            if (validated.approved) {
                // Notify the requester they've been approved
                const requesterSockets = await io.in(validated.requesterId).fetchSockets();
                if (requesterSockets.length > 0) {
                    requesterSockets[0]!.emit(SOCKET_EVENTS.SPECTATOR_JOIN_APPROVED, {
                        message: 'Your request to join a team has been approved',
                        timestamp: Date.now()
                    });
                }

                logger.info(`Host approved spectator ${sanitizeHtml(requester.nickname)} join request in room ${ctx.roomCode}`);
            } else {
                // Notify the requester they've been denied
                const requesterSockets = await io.in(validated.requesterId).fetchSockets();
                if (requesterSockets.length > 0) {
                    requesterSockets[0]!.emit(SOCKET_EVENTS.SPECTATOR_JOIN_DENIED, {
                        message: 'Your request to join a team was denied',
                        timestamp: Date.now()
                    });
                }

                logger.info(`Host denied spectator ${sanitizeHtml(requester.nickname)} join request in room ${ctx.roomCode}`);
            }
        },
        spectatorJoinResponseSchema
    ));
}

module.exports = playerHandlers;
export default playerHandlers;
