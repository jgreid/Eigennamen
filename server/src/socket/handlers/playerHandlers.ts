import type { Server } from 'socket.io';
import type { Player, GameState, Team, Role } from '../../types';
import type { ErrorCode } from '../../types/errors';
import type { GameSocket, RoomContext } from './types';
import type { RoomStats } from '../../services/playerService';

import * as playerService from '../../services/playerService';
import * as gameService from '../../services/gameService';
import { sendSpymasterViewIfNeeded } from './roomHandlerUtils';
import { syncSpectatorRoomMembership } from './playerRoomSync';
import {
    playerTeamSchema,
    playerRoleSchema,
    playerTeamRoleSchema,
    playerNicknameSchema,
    playerKickSchema,
    spectatorJoinRequestSchema,
    spectatorJoinResponseSchema,
} from '../../validators/schemas';
import logger from '../../utils/logger';
import { ERROR_CODES, SOCKET_EVENTS } from '../../config/constants';
import { createRoomHandler, createHostHandler } from '../contextHandler';
import { canChangeTeamOrRole } from '../playerContext';
import { PlayerError, ValidationError, GameStateError } from '../../errors/GameError';
import { sanitizeHtml } from '../../utils/sanitize';
import { safeEmitToRoom } from '../safeEmit';
import { withLock } from '../../utils/distributedLock';

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
 * Atomic team+role input
 */
interface PlayerTeamRoleInput {
    team: Team;
    role: 'spymaster' | 'clicker';
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

function playerHandlers(io: Server, socket: GameSocket): void {
    /**
     * Set player's team
     */
    socket.on(
        SOCKET_EVENTS.PLAYER_SET_TEAM,
        createRoomHandler(
            socket,
            SOCKET_EVENTS.PLAYER_SET_TEAM,
            playerTeamSchema,
            async (ctx: RoomContext, validated: PlayerTeamInput) => {
                // Per-player lock serializes team/role mutations to prevent TOCTOU races
                // where concurrent setTeam+setRole could interleave at await boundaries,
                // causing the canChangeTeamOrRole check to pass on stale state.
                return await withLock(
                    `player-mutation:${ctx.sessionId}`,
                    async () => {
                        // Re-fetch player and game state after acquiring lock to validate
                        // against fresh state (the snapshot in ctx may be stale)
                        const freshPlayer: Player | null = await playerService.getPlayer(ctx.sessionId);
                        if (!freshPlayer) {
                            throw PlayerError.notFound(ctx.sessionId);
                        }
                        const freshGame: GameState | null = ctx.roomCode
                            ? await gameService.getGame(ctx.roomCode)
                            : null;
                        const freshCtx = { player: freshPlayer, game: freshGame };

                        const canChange: ChangePermission = canChangeTeamOrRole(freshCtx, { isTeamChange: true });
                        if (!canChange.allowed) {
                            const errorCode = (canChange.code ||
                                ERROR_CODES.CANNOT_SWITCH_TEAM_DURING_TURN) as ErrorCode;
                            throw new GameStateError(errorCode, canChange.reason ?? '');
                        }

                        const shouldCheckEmpty = !!(
                            freshGame &&
                            !freshGame.gameOver &&
                            freshPlayer.team &&
                            freshPlayer.team !== validated.team
                        );
                        // setTeam always returns a Player or throws — no null return path
                        const player: Player = await playerService.setTeam(
                            ctx.sessionId,
                            validated.team,
                            shouldCheckEmpty
                        );

                        // Bug #14 Fix: Sync spectator room membership based on current state
                        // (prevents race with concurrent setRole operations)
                        await syncSpectatorRoomMembership(socket, ctx.roomCode, ctx.sessionId);

                        // Build changes object - include role if it was changed by the team switch
                        // (e.g., clicker/spymaster role is reset to spectator when switching teams)
                        const changes: { team: Team | null; role?: Role } = { team: player.team };
                        if (player.role !== freshPlayer.role) {
                            changes.role = player.role;
                        }

                        // Broadcast to room
                        safeEmitToRoom(io, ctx.roomCode, SOCKET_EVENTS.PLAYER_UPDATED, {
                            sessionId: ctx.sessionId,
                            changes,
                        });

                        // Broadcast updated stats
                        const roomStats: RoomStats = await playerService.getRoomStats(ctx.roomCode);
                        safeEmitToRoom(io, ctx.roomCode, SOCKET_EVENTS.ROOM_STATS_UPDATED, { stats: roomStats });

                        logger.info(`Player ${ctx.sessionId} joined team ${player.team}`);
                    },
                    { lockTimeout: 5000, maxRetries: 3 }
                );
            }
        )
    );

    /**
     * Set player's role
     */
    socket.on(
        SOCKET_EVENTS.PLAYER_SET_ROLE,
        createRoomHandler(
            socket,
            SOCKET_EVENTS.PLAYER_SET_ROLE,
            playerRoleSchema,
            async (ctx: RoomContext, validated: PlayerRoleInput) => {
                // Per-player lock serializes team/role mutations to prevent TOCTOU races
                return await withLock(
                    `player-mutation:${ctx.sessionId}`,
                    async () => {
                        // Re-fetch player and game state after acquiring lock
                        const freshPlayer: Player | null = await playerService.getPlayer(ctx.sessionId);
                        if (!freshPlayer) {
                            throw PlayerError.notFound(ctx.sessionId);
                        }
                        const freshGame: GameState | null = ctx.roomCode
                            ? await gameService.getGame(ctx.roomCode)
                            : null;
                        const freshCtx = { player: freshPlayer, game: freshGame };

                        // Skip validation if player already has the requested role (idempotent)
                        if (freshPlayer.role !== validated.role) {
                            const canChange: ChangePermission = canChangeTeamOrRole(freshCtx, {
                                targetRole: validated.role,
                            });
                            if (!canChange.allowed) {
                                throw new GameStateError(
                                    ERROR_CODES.CANNOT_CHANGE_ROLE_DURING_TURN,
                                    canChange.reason ?? ''
                                );
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
                            changes: { role: player.role },
                        });

                        // Broadcast updated stats
                        const roomStats: RoomStats = await playerService.getRoomStats(ctx.roomCode);
                        safeEmitToRoom(io, ctx.roomCode, SOCKET_EVENTS.ROOM_STATS_UPDATED, { stats: roomStats });

                        // If becoming spymaster, re-fetch game state to avoid stale context
                        if (player.role === 'spymaster') {
                            const spymasterGame: GameState | null = await gameService.getGame(ctx.roomCode);
                            await sendSpymasterViewIfNeeded(socket, player, spymasterGame, ctx.roomCode);
                        }

                        logger.info(`Player ${ctx.sessionId} set role to ${player.role}`);

                        return { player };
                    },
                    { lockTimeout: 5000, maxRetries: 3 }
                );
            }
        )
    );

    /**
     * Set player's team and role atomically (e.g., clicking "Spymaster" on another team)
     */
    socket.on(
        SOCKET_EVENTS.PLAYER_SET_TEAM_ROLE,
        createRoomHandler(
            socket,
            SOCKET_EVENTS.PLAYER_SET_TEAM_ROLE,
            playerTeamRoleSchema,
            async (ctx: RoomContext, validated: PlayerTeamRoleInput) => {
                return await withLock(
                    `player-mutation:${ctx.sessionId}`,
                    async () => {
                        const freshPlayer: Player | null = await playerService.getPlayer(ctx.sessionId);
                        if (!freshPlayer) {
                            throw PlayerError.notFound(ctx.sessionId);
                        }
                        const freshGame: GameState | null = ctx.roomCode
                            ? await gameService.getGame(ctx.roomCode)
                            : null;
                        const freshCtx = { player: freshPlayer, game: freshGame };

                        // If changing teams, validate the team change first
                        if (freshPlayer.team !== validated.team) {
                            const canChangeTeam: ChangePermission = canChangeTeamOrRole(freshCtx, {
                                isTeamChange: true,
                            });
                            if (!canChangeTeam.allowed) {
                                const errorCode = (canChangeTeam.code ||
                                    ERROR_CODES.CANNOT_SWITCH_TEAM_DURING_TURN) as ErrorCode;
                                throw new GameStateError(errorCode, canChangeTeam.reason ?? '');
                            }
                        }

                        // Validate the role change
                        const canChangeRole: ChangePermission = canChangeTeamOrRole(freshCtx, {
                            targetRole: validated.role,
                        });
                        if (!canChangeRole.allowed) {
                            throw new GameStateError(
                                ERROR_CODES.CANNOT_CHANGE_ROLE_DURING_TURN,
                                canChangeRole.reason ?? ''
                            );
                        }

                        // Step 1: Set team if different (this resets role to spectator)
                        const teamChanged = freshPlayer.team !== validated.team;
                        if (teamChanged) {
                            const shouldCheckEmpty = !!(
                                freshGame &&
                                !freshGame.gameOver &&
                                freshPlayer.team &&
                                freshPlayer.team !== validated.team
                            );
                            await playerService.setTeam(ctx.sessionId, validated.team, shouldCheckEmpty);
                        }

                        // Step 2: Set role — rollback team on failure
                        let player: Player | null;
                        try {
                            player = await playerService.setRole(ctx.sessionId, validated.role as Role);
                        } catch (roleError: unknown) {
                            if (teamChanged && freshPlayer.team) {
                                try {
                                    await playerService.setTeam(ctx.sessionId, freshPlayer.team, false);
                                } catch (rollbackError: unknown) {
                                    logger.error(
                                        `Failed to rollback team for ${ctx.sessionId} after setRole failure`,
                                        rollbackError
                                    );
                                }
                            }
                            throw roleError;
                        }
                        if (!player) {
                            throw PlayerError.notFound(ctx.sessionId);
                        }

                        await syncSpectatorRoomMembership(socket, ctx.roomCode, ctx.sessionId);

                        // Broadcast the combined change
                        safeEmitToRoom(io, ctx.roomCode, SOCKET_EVENTS.PLAYER_UPDATED, {
                            sessionId: ctx.sessionId,
                            changes: { team: player.team, role: player.role },
                        });

                        const roomStats: RoomStats = await playerService.getRoomStats(ctx.roomCode);
                        safeEmitToRoom(io, ctx.roomCode, SOCKET_EVENTS.ROOM_STATS_UPDATED, { stats: roomStats });

                        if (player.role === 'spymaster') {
                            const spymasterGame: GameState | null = await gameService.getGame(ctx.roomCode);
                            await sendSpymasterViewIfNeeded(socket, player, spymasterGame, ctx.roomCode);
                        }

                        logger.info(`Player ${ctx.sessionId} set team=${player.team} role=${player.role} (atomic)`);
                    },
                    { lockTimeout: 5000, maxRetries: 3 }
                );
            }
        )
    );

    /**
     * Update nickname
     */
    socket.on(
        SOCKET_EVENTS.PLAYER_SET_NICKNAME,
        createRoomHandler(
            socket,
            SOCKET_EVENTS.PLAYER_SET_NICKNAME,
            playerNicknameSchema,
            async (ctx: RoomContext, validated: PlayerNicknameInput) => {
                const player: Player | null = await playerService.setNickname(ctx.sessionId, validated.nickname);

                if (!player) {
                    throw PlayerError.notFound(ctx.sessionId);
                }

                // Broadcast to room — frontend renders via textContent (XSS-safe),
                // so no server-side HTML encoding needed
                safeEmitToRoom(io, ctx.roomCode, SOCKET_EVENTS.PLAYER_UPDATED, {
                    sessionId: ctx.sessionId,
                    changes: { nickname: player.nickname },
                });

                logger.info(`Player ${ctx.sessionId} changed nickname to ${sanitizeHtml(player.nickname)}`);

                return { player };
            }
        )
    );

    /**
     * Kick a player from the room (host only)
     */
    socket.on(
        SOCKET_EVENTS.PLAYER_KICK,
        createHostHandler(
            socket,
            SOCKET_EVENTS.PLAYER_KICK,
            playerKickSchema,
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
                    nickname: targetPlayer.nickname,
                    kickedBy: ctx.player.nickname,
                });

                // Disconnect the target player's socket BEFORE removing data from Redis.
                // This prevents a window where the kicked player's socket can still emit
                // events that reference their now-deleted player data.
                if (targetSocketId) {
                    const targetSocket = io.sockets.sockets.get(targetSocketId) as GameSocket | undefined;
                    if (targetSocket) {
                        targetSocket.emit(SOCKET_EVENTS.ROOM_KICKED, {
                            reason: 'You were removed from the room by the host',
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
                    players: remainingPlayers || [],
                });

                // Broadcast updated stats so clients refresh team counters
                const roomStats: RoomStats = await playerService.getRoomStats(ctx.roomCode);
                safeEmitToRoom(io, ctx.roomCode, SOCKET_EVENTS.ROOM_STATS_UPDATED, { stats: roomStats });

                logger.info(
                    `Host ${sanitizeHtml(ctx.player.nickname)} kicked player ${sanitizeHtml(targetPlayer.nickname)} from room ${ctx.roomCode}`
                );
            }
        )
    );

    // Spectator: Request to join a team
    socket.on(
        SOCKET_EVENTS.SPECTATOR_REQUEST_JOIN,
        createRoomHandler(
            socket,
            SOCKET_EVENTS.SPECTATOR_REQUEST_JOIN,
            spectatorJoinRequestSchema,
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
                        requesterNickname: ctx.player.nickname,
                        team: validated.team,
                        timestamp: Date.now(),
                    });
                }

                logger.info(
                    `Spectator ${sanitizeHtml(ctx.player.nickname)} requested to join ${validated.team} team in room ${ctx.roomCode}`
                );
            }
        )
    );

    // Host: Approve or deny spectator join request
    socket.on(
        SOCKET_EVENTS.SPECTATOR_APPROVE_JOIN,
        createHostHandler(
            socket,
            SOCKET_EVENTS.SPECTATOR_APPROVE_JOIN,
            spectatorJoinResponseSchema,
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
                            timestamp: Date.now(),
                        });
                    }

                    logger.info(
                        `Host approved spectator ${sanitizeHtml(requester.nickname)} join request in room ${ctx.roomCode}`
                    );
                } else {
                    // Notify the requester they've been denied (io captured from outer closure)
                    const requesterSockets = await io.in(validated.requesterId).fetchSockets();
                    if (requesterSockets.length > 0) {
                        // Safe to cast: we just verified length > 0
                        const deniedSocket = requesterSockets[0] as (typeof requesterSockets)[number];
                        deniedSocket.emit(SOCKET_EVENTS.SPECTATOR_JOIN_DENIED, {
                            message: 'Your request to join a team was denied',
                            timestamp: Date.now(),
                        });
                    }

                    logger.info(
                        `Host denied spectator ${sanitizeHtml(requester.nickname)} join request in room ${ctx.roomCode}`
                    );
                }
            }
        )
    );
}

export default playerHandlers;

// CommonJS interop — tests use require() which needs module.exports
module.exports = playerHandlers;
module.exports.default = playerHandlers;
