import type { Server } from 'socket.io';
import type { Player, GameState, Team, Role } from '../../../types';
import type { ErrorCode } from '../../../types/errors';
import type { GameSocket, RoomContext } from '../types';
import type { RoomStats } from '../../../services/playerService';

import * as playerService from '../../../services/playerService';
import * as gameService from '../../../services/gameService';
import { sendSpymasterViewIfNeeded } from '../roomHandlerUtils';
import { syncSpectatorRoomMembership } from '../playerRoomSync';
import { playerTeamSchema, playerRoleSchema, playerTeamRoleSchema } from '../../../validators/schemas';
import logger from '../../../utils/logger';
import { ERROR_CODES, SOCKET_EVENTS } from '../../../config/constants';
import { createRoomHandler } from '../../contextHandler';
import { canChangeTeamOrRole } from '../../playerContext';
import { PlayerError, GameStateError } from '../../../errors/GameError';
import { safeEmitToRoom } from '../../safeEmit';
import { withLock } from '../../../utils/distributedLock';

interface PlayerTeamInput {
    team: Team | null;
}

interface PlayerRoleInput {
    role: Role;
}

interface PlayerTeamRoleInput {
    team: Team;
    role: 'spymaster' | 'clicker';
}

interface ChangePermission {
    allowed: boolean;
    reason?: string;
    code?: string;
}

export default function playerRoleHandlers(io: Server, socket: GameSocket): void {
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
}
