/**
 * Player Socket Event Handlers
 *
 * Migrated to use context handler architecture for consistent
 * validation, error handling, and socket room management.
 */

import type { Server } from 'socket.io';
import type { Player, GameState, Team, Role } from '../../types';
import type { ErrorCode } from '../../types/errors';
import type { GameSocket, RoomContext } from './types';
import type { RoomStats } from '../../services/playerService';

import * as playerService from '../../services/playerService';
import * as gameService from '../../services/gameService';
import { sendSpymasterViewIfNeeded } from './roomHandlers';
import { playerTeamSchema, playerRoleSchema, playerNicknameSchema, playerKickSchema, spectatorJoinRequestSchema, spectatorJoinResponseSchema } from '../../validators/schemas';
import logger from '../../utils/logger';
import { ERROR_CODES, SOCKET_EVENTS } from '../../config/constants';
import { createRoomHandler, createHostHandler } from '../contextHandler';
import { canChangeTeamOrRole, isPlayerSpectator } from '../playerContext';
import { PlayerError, ValidationError, GameStateError } from '../../errors/GameError';
import { sanitizeHtml } from '../../utils/sanitize';
import { safeEmitToRoom } from '../safeEmit';
import { TIMEOUTS } from '../../utils/timeout';

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
 * Change permission result
 */
interface ChangePermission {
    allowed: boolean;
    reason?: string;
    code?: string;
}

/**
 * Per-player mutex to prevent concurrent room membership updates.
 * Without this, concurrent setTeam + setRole can both call syncSpectatorRoomMembership
 * and produce inconsistent socket room state (e.g., player in both room:X and spectators:X).
 */
const roomSyncLocks = new Map<string, Promise<void>>();
const ROOM_SYNC_LOCKS_MAX_SIZE = 10_000;

/**
 * Bug #14 Fix: Helper to sync spectator room membership based on CURRENT player state.
 * Uses a per-player mutex to serialize room membership updates, preventing the race
 * where concurrent setTeam/setRole operations leave a player in multiple socket rooms.
 */
async function syncSpectatorRoomMembership(
    socket: GameSocket,
    roomCode: string,
    sessionId: string
): Promise<void> {
    // Safety valve: clear the map if it grows too large (prevents unbounded memory growth
    // from accumulated entries where .finally() cleanup was skipped due to reference mismatch)
    if (roomSyncLocks.size > ROOM_SYNC_LOCKS_MAX_SIZE) {
        roomSyncLocks.clear();
    }

    // Serialize room membership updates per player to prevent race conditions
    const lockKey = `${sessionId}:${roomCode}`;
    const existingLock = roomSyncLocks.get(lockKey) || Promise.resolve();

    const newLock = existingLock.then(async () => {
        // Re-fetch current player state to ensure we have the latest team/role
        const currentPlayer: Player | null = await playerService.getPlayer(sessionId);
        if (!currentPlayer) return;

        const spectatorRoom = `spectators:${roomCode}`;

        // Player should be in spectators room if:
        // - They have no team, OR
        // - Their role is 'spectator'
        const shouldBeInSpectatorRoom = isPlayerSpectator(currentPlayer);

        if (shouldBeInSpectatorRoom) {
            socket.join(spectatorRoom);
        } else {
            socket.leave(spectatorRoom);
        }
    }).catch((err) => {
        logger.warn(`syncSpectatorRoomMembership failed for ${sessionId}:`, err instanceof Error ? err.message : String(err));
    }).finally(() => {
        // Clean up lock after completion
        if (roomSyncLocks.get(lockKey) === newLock) {
            roomSyncLocks.delete(lockKey);
        }
    });

    roomSyncLocks.set(lockKey, newLock);

    // Timeout prevents unbounded queueing if a prior lock operation hangs.
    // On timeout, the queued operation is abandoned but the lock chain is
    // cleaned up via .finally() above, so subsequent operations proceed.
    const MUTEX_TIMEOUT = TIMEOUTS.GAME_ACTION;
    await Promise.race([
        newLock,
        new Promise<void>((_, reject) =>
            setTimeout(() => reject(new Error(`Room sync mutex timeout for ${lockKey}`)), MUTEX_TIMEOUT)
        )
    ]).catch((err) => {
        logger.warn(`syncSpectatorRoomMembership mutex timeout or error for ${sessionId}:`, err instanceof Error ? err.message : String(err));
    });
}

function playerHandlers(io: Server, socket: GameSocket): void {

    /**
     * Set player's team
     */
    socket.on(SOCKET_EVENTS.PLAYER_SET_TEAM, createRoomHandler(socket, SOCKET_EVENTS.PLAYER_SET_TEAM, playerTeamSchema,
        async (ctx: RoomContext, validated: PlayerTeamInput) => {
            const canChange: ChangePermission = canChangeTeamOrRole(ctx, { isTeamChange: true });
            if (!canChange.allowed) {
                const errorCode = (canChange.code || ERROR_CODES.CANNOT_SWITCH_TEAM_DURING_TURN) as ErrorCode;
                throw new GameStateError(errorCode, canChange.reason ?? '');
            }

            const shouldCheckEmpty = !!(ctx.game && !ctx.game.gameOver &&
                ctx.player.team && ctx.player.team !== validated.team);
            // setTeam always returns a Player or throws — no null return path
            const player: Player = await playerService.setTeam(ctx.sessionId, validated.team, shouldCheckEmpty);

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
                    throw new GameStateError(ERROR_CODES.CANNOT_CHANGE_ROLE_DURING_TURN, canChange.reason ?? '');
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
                await sendSpymasterViewIfNeeded(socket, player, freshGame, ctx.roomCode);
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

            // Invalidate reconnection token so kicked player cannot rejoin
            await playerService.invalidateRoomReconnectToken(validated.targetSessionId);

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
    socket.on(SOCKET_EVENTS.SPECTATOR_REQUEST_JOIN, createRoomHandler(socket, SOCKET_EVENTS.SPECTATOR_REQUEST_JOIN, spectatorJoinRequestSchema,
        async (ctx: RoomContext, validated: { team: string }) => {
            // Only spectators can request to join
            if (ctx.player.team && ctx.player.role !== 'spectator') {
                throw PlayerError.notAuthorized();
            }

            // Find the host to notify
            const players: Player[] = await playerService.getPlayersInRoom(ctx.roomCode);
            const host = players.find((p: Player) => p.isHost);
            if (!host) {
                throw new PlayerError(ERROR_CODES.NOT_HOST, 'No host found in room');
            }

            // Emit join request to the host (io captured from outer closure)
            const hostSockets = await io.in(host.sessionId).fetchSockets();
            if (hostSockets.length > 0) {
                // Safe to cast: we just verified length > 0
                const hostSocket = hostSockets[0] as (typeof hostSockets)[number];
                hostSocket.emit(SOCKET_EVENTS.SPECTATOR_JOIN_REQUEST, {
                    requesterId: ctx.sessionId,
                    requesterNickname: sanitizeHtml(ctx.player.nickname),
                    team: validated.team,
                    timestamp: Date.now()
                });
            }

            logger.info(`Spectator ${sanitizeHtml(ctx.player.nickname)} requested to join ${validated.team} team in room ${ctx.roomCode}`);
        }
    ));

    // Host: Approve or deny spectator join request
    socket.on(SOCKET_EVENTS.SPECTATOR_APPROVE_JOIN, createHostHandler(socket, SOCKET_EVENTS.SPECTATOR_APPROVE_JOIN, spectatorJoinResponseSchema,
        async (ctx: RoomContext, validated: { requesterId: string; approved: boolean }) => {
            const requester: Player | null = await playerService.getPlayer(validated.requesterId);
            if (!requester || requester.roomCode !== ctx.roomCode) {
                throw new PlayerError(ERROR_CODES.PLAYER_NOT_FOUND, 'Requester not found in room');
            }

            // Verify the requester is actually a spectator to prevent team players
            // from exploiting the spectator join flow
            if (requester.team && requester.role !== 'spectator') {
                throw PlayerError.notAuthorized();
            }

            if (validated.approved) {
                // Notify the requester they've been approved (io captured from outer closure)
                const requesterSockets = await io.in(validated.requesterId).fetchSockets();
                if (requesterSockets.length > 0) {
                    // Safe to cast: we just verified length > 0
                    const requesterSocket = requesterSockets[0] as (typeof requesterSockets)[number];
                    requesterSocket.emit(SOCKET_EVENTS.SPECTATOR_JOIN_APPROVED, {
                        message: 'Your request to join a team has been approved',
                        timestamp: Date.now()
                    });
                }

                logger.info(`Host approved spectator ${sanitizeHtml(requester.nickname)} join request in room ${ctx.roomCode}`);
            } else {
                // Notify the requester they've been denied (io captured from outer closure)
                const requesterSockets = await io.in(validated.requesterId).fetchSockets();
                if (requesterSockets.length > 0) {
                    // Safe to cast: we just verified length > 0
                    const deniedSocket = requesterSockets[0] as (typeof requesterSockets)[number];
                    deniedSocket.emit(SOCKET_EVENTS.SPECTATOR_JOIN_DENIED, {
                        message: 'Your request to join a team was denied',
                        timestamp: Date.now()
                    });
                }

                logger.info(`Host denied spectator ${sanitizeHtml(requester.nickname)} join request in room ${ctx.roomCode}`);
            }
        }
    ));
}

export default playerHandlers;

// CommonJS interop — tests use require() which needs module.exports
module.exports = playerHandlers;
module.exports.default = playerHandlers;
