/**
 * Room Socket Event Handlers
 *
 * All handlers use the context handler architecture:
 * - room:create and room:join use createPreRoomHandler (no room context needed)
 * - room:reconnect uses createPreRoomHandler (token-based auth flow)
 * - room:leave, room:settings, room:resync, room:getReconnectionToken use
 *   createRoomHandler/createHostHandler (require room context)
 */

import type { Server } from 'socket.io';
import type { Room, Player, GameState, PlayerGameState, Team } from '../../types';
import type { GameSocket, RoomContext } from './types';
import type { RoomStats } from '../../services/playerService';

import * as roomService from '../../services/roomService';
import * as gameService from '../../services/gameService';
import * as playerService from '../../services/playerService';
import { roomCreateSchema, roomJoinSchema, roomSettingsSchema, roomReconnectSchema } from '../../validators/schemas';
import logger from '../../utils/logger';
import { ERROR_CODES, SOCKET_EVENTS, SESSION_SECURITY } from '../../config/constants';
import { createRoomHandler, createHostHandler, createPreRoomHandler } from '../contextHandler';
import { RoomError, PlayerError, ServerError } from '../../errors/GameError';
import { withTimeout, TIMEOUTS } from '../../utils/timeout';
import { getSocketFunctions } from '../socketFunctionProvider';
import { incrementCounter, METRIC_NAMES } from '../../utils/metrics';
import { getSocketRateLimiter } from '../rateLimitHandler';
import { safeEmitToRoom } from '../safeEmit';

/**
 * Room create input
 */
interface RoomCreateInput {
    roomId: string;
    settings?: Record<string, unknown>;
}

/**
 * Room join input
 */
interface RoomJoinInput {
    roomId: string;
    nickname: string;
}

/**
 * Room reconnect input
 */
interface RoomReconnectInput {
    code: string;
    reconnectionToken: string;
}

/**
 * Timer status from timerService
 */
interface TimerStatus {
    remainingSeconds: number;
    endTime: number;
    isPaused?: boolean;
}

/**
 * Token validation result
 */
interface TokenValidation {
    valid: boolean;
    reason?: string;
    tokenData?: {
        sessionId: string;
        roomCode: string;
        nickname: string;
        team: Team | null;
        role: string;
    };
}

/**
 * Helper: Send timer status to a socket
 */
async function sendTimerStatus(
    socket: GameSocket,
    roomCode: string,
    context: string
): Promise<void> {
    try {
        const { getTimerStatus } = getSocketFunctions();
        const timerStatus: TimerStatus | null = await getTimerStatus(roomCode) as unknown as TimerStatus | null;
        if (timerStatus && timerStatus.endTime) {
            socket.emit(SOCKET_EVENTS.TIMER_STATUS, {
                roomCode,
                remainingSeconds: timerStatus.remainingSeconds,
                endTime: timerStatus.endTime,
                isPaused: timerStatus.isPaused || false
            });
        }
    } catch (timerError) {
        logger.warn(`Failed to send timer status on ${context}: ${(timerError as Error).message}`);
    }
}

/**
 * Helper: Send spymaster view if player is a spymaster with active game
 * Performance fix: Use game.types directly instead of re-fetching from Redis.
 * getGameStateForPlayer already includes full types for spymasters.
 */
async function sendSpymasterViewIfNeeded(
    socket: GameSocket,
    player: Player,
    game: GameState | null,
    _roomCode: string
): Promise<void> {
    if (player.role === 'spymaster' && game && !game.gameOver && game.types) {
        socket.emit(SOCKET_EVENTS.GAME_SPYMASTER_VIEW, { types: game.types });
    }
}

/**
 * Helper: Track failed join attempt for rate limiting
 * Prevents room code enumeration attacks by limiting failed attempts
 */
async function trackFailedJoinAttempt(socket: GameSocket): Promise<void> {
    try {
        const rateLimiter = getSocketRateLimiter();
        const limiter = rateLimiter.getLimiter('room:join:failed');
        // Consume a rate limit token for failed attempts
        await new Promise<void>((resolve) => {
            limiter(socket, {}, (err: Error | undefined) => {
                if (err) {
                    logger.warn('Failed join rate limit exceeded', {
                        socketId: socket.id,
                        sessionId: socket.sessionId
                    });
                }
                resolve();
            });
        });
    } catch (error) {
        // Non-critical - log but don't block
        logger.debug('Failed to track join attempt', { error: (error as Error).message });
    }
}

// NOTE: isFailedJoinRateLimited was removed because getLimiter() consumes a
// rate limit token on each call (not a peek). This caused successful joins to
// count against the failed-join bucket, and failed joins to be double-counted.
// The handler-level room:join rate limit (10/min via createPreRoomHandler)
// provides adequate brute-force protection. trackFailedJoinAttempt still
// tracks failures for monitoring/metrics.

function roomHandlers(io: Server, socket: GameSocket): void {

    /**
     * Create a new room
     */
    socket.on(SOCKET_EVENTS.ROOM_CREATE, createPreRoomHandler(socket, SOCKET_EVENTS.ROOM_CREATE, roomCreateSchema,
        async (validated: RoomCreateInput) => {
            const { room, player }: { room: Room; player: Player } = await withTimeout(
                roomService.createRoom(validated.roomId, socket.sessionId, validated.settings),
                TIMEOUTS.SOCKET_HANDLER,
                'room:create'
            );

            socket.join(`room:${room.code}`);
            socket.join(`player:${socket.sessionId}`);
            socket.roomCode = room.code;

            // Host starts as spectator
            socket.join(`spectators:${room.code}`);

            const roomStats: RoomStats = await playerService.getRoomStats(room.code);

            socket.emit(SOCKET_EVENTS.ROOM_CREATED, { room, player, stats: roomStats });

            logger.info(`Room created: ${room.code} by ${socket.sessionId}`);
        }
    ));

    /**
     * Join an existing room
     */
    socket.on(SOCKET_EVENTS.ROOM_JOIN, createPreRoomHandler(socket, SOCKET_EVENTS.ROOM_JOIN, roomJoinSchema,
        async (validated: RoomJoinInput) => {
            // Rate limiting for join attempts is handled by createPreRoomHandler
            // (room:join: 10/min). Failed attempts are additionally tracked by
            // trackFailedJoinAttempt for monitoring/metrics.

            let joinResult: { room: Room; players: Player[]; game: GameState | null; player: Player };
            try {
                joinResult = await withTimeout(
                    roomService.joinRoom(
                        validated.roomId,
                        socket.sessionId,
                        validated.nickname
                    ),
                    TIMEOUTS.JOIN_ROOM,
                    'room:join'
                ) as { room: Room; players: Player[]; game: GameState | null; player: Player };
            } catch (error) {
                // Track failed attempt for rate limiting (prevents room enumeration)
                if ((error as { code?: string }).code === ERROR_CODES.ROOM_NOT_FOUND ||
                    (error as { code?: string }).code === ERROR_CODES.INVALID_INPUT) {
                    await trackFailedJoinAttempt(socket);
                }
                throw error;
            }

            const { room, players, game, player } = joinResult;

            socket.join(`room:${room.code}`);
            socket.join(`player:${socket.sessionId}`);
            socket.roomCode = room.code;

            const isSpectator = player.role === 'spectator' || !player.team;
            if (isSpectator) {
                socket.join(`spectators:${room.code}`);
            }

            // FIX: Run stats fetch, token invalidation, and game state computation in parallel
            // to reduce total response time and avoid pushing past the client's timeout
            let statsUsedFallback = false;
            const [, roomStats, gameState] = await Promise.all([
                playerService.invalidateRoomReconnectToken(socket.sessionId).catch((err: Error) => {
                    logger.warn(`Failed to invalidate reconnection token during join: ${err.message}`);
                }),
                playerService.getRoomStats(room.code).catch((err: Error) => {
                    logger.warn(`Failed to get room stats during join: ${err.message}`);
                    statsUsedFallback = true;
                    return { totalPlayers: players.length, spectatorCount: 0, teams: { red: { total: 0, spymaster: null, clicker: null }, blue: { total: 0, spymaster: null, clicker: null } } } as RoomStats;
                }),
                Promise.resolve(game ? gameService.getGameStateForPlayer(game, player) : null)
            ]) as [void, RoomStats, PlayerGameState | null];

            socket.emit(SOCKET_EVENTS.ROOM_JOINED, { room, players, game: gameState, you: player, stats: roomStats });

            // Notify client if stats used fallback data so it can request resync
            if (statsUsedFallback) {
                socket.emit(SOCKET_EVENTS.ROOM_WARNING, {
                    code: 'STATS_STALE',
                    message: 'Room stats may be incomplete. Request a resync if data looks wrong.'
                });
            }

            await Promise.all([
                sendSpymasterViewIfNeeded(socket, player, game, room.code),
                sendTimerStatus(socket, room.code, 'join')
            ]);

            const isReconnect = !!(player as Player & { lastConnected?: number }).lastConnected;

            if (isReconnect) {
                socket.to(`room:${room.code}`).emit(SOCKET_EVENTS.ROOM_PLAYER_RECONNECTED, {
                    sessionId: socket.sessionId,
                    nickname: player.nickname,
                    team: player.team
                });
            } else {
                socket.to(`room:${room.code}`).emit(SOCKET_EVENTS.ROOM_PLAYER_JOINED, { player });
            }

            logger.info(`Player ${validated.nickname} joined room ${room.code}`);
        }
    ));

    /**
     * Leave the current room
     */
    socket.on(SOCKET_EVENTS.ROOM_LEAVE, createRoomHandler(socket, SOCKET_EVENTS.ROOM_LEAVE, null,
        async (ctx: RoomContext) => {
            // Invalidate reconnection token when explicitly leaving
            await playerService.invalidateRoomReconnectToken(ctx.sessionId);

            const leaveResult = await roomService.leaveRoom(ctx.roomCode, ctx.sessionId);
            const result: { newHostId?: string } | null = leaveResult ? { ...leaveResult, newHostId: leaveResult.newHostId ?? undefined } : null;

            // Leave all socket rooms for this room
            socket.leave(`room:${ctx.roomCode}`);
            socket.leave(`spectators:${ctx.roomCode}`);
            socket.leave(`player:${ctx.sessionId}`);

            const remainingPlayers: Player[] = await playerService.getPlayersInRoom(ctx.roomCode);

            safeEmitToRoom(io, ctx.roomCode, SOCKET_EVENTS.ROOM_PLAYER_LEFT, {
                sessionId: ctx.sessionId,
                newHost: result?.newHostId || null,
                players: remainingPlayers || []
            });

            // Broadcast updated stats so clients reflect the player departure
            const roomStats: RoomStats = await playerService.getRoomStats(ctx.roomCode, remainingPlayers);
            safeEmitToRoom(io, ctx.roomCode, SOCKET_EVENTS.ROOM_STATS_UPDATED, { stats: roomStats });

            logger.info(`Player ${ctx.sessionId} left room ${ctx.roomCode}`);
            socket.roomCode = null;
        }
    ));

    /**
     * Update room settings (host only)
     */
    socket.on(SOCKET_EVENTS.ROOM_SETTINGS, createHostHandler(socket, SOCKET_EVENTS.ROOM_SETTINGS, roomSettingsSchema,
        async (ctx: RoomContext, validated: Record<string, unknown>) => {
            const settings = await roomService.updateSettings(
                ctx.roomCode,
                ctx.sessionId,
                validated
            );

            safeEmitToRoom(io, ctx.roomCode, SOCKET_EVENTS.ROOM_SETTINGS_UPDATED, { settings });

            logger.info(`Room ${ctx.roomCode} settings updated`);
        }
    ));

    /**
     * Request full state resync
     */
    socket.on(SOCKET_EVENTS.ROOM_RESYNC, createRoomHandler(socket, SOCKET_EVENTS.ROOM_RESYNC, null,
        async (ctx: RoomContext) => {
            const statePromise = (async () => {
                const [room, players] = await Promise.all([
                    roomService.getRoom(ctx.roomCode),
                    playerService.getPlayersInRoom(ctx.roomCode)
                ]) as [Room | null, Player[]];

                if (!room) {
                    throw RoomError.notFound(ctx.roomCode);
                }
                if (!players || !Array.isArray(players)) {
                    throw RoomError.notFound(ctx.roomCode);
                }

                let gameState: PlayerGameState | null = null;
                if (ctx.game) {
                    gameState = gameService.getGameStateForPlayer(ctx.game, ctx.player);
                }

                return { room, players, gameState };
            })();

            const { room, players, gameState } = await withTimeout(
                statePromise,
                TIMEOUTS.RECONNECT,
                'room:resync'
            );

            const roomStats: RoomStats = await playerService.getRoomStats(ctx.roomCode);

            socket.emit(SOCKET_EVENTS.ROOM_RESYNCED, {
                room,
                players,
                game: gameState,
                you: ctx.player,
                stats: roomStats
            });

            await Promise.all([
                sendSpymasterViewIfNeeded(socket, ctx.player, ctx.game, ctx.roomCode),
                sendTimerStatus(socket, ctx.roomCode, 'resync')
            ]);

            logger.info(`State resynced for player ${ctx.sessionId} in room ${ctx.roomCode}`);
        }
    ));

    /**
     * Request a reconnection token
     */
    socket.on(SOCKET_EVENTS.ROOM_GET_RECONNECTION_TOKEN, createRoomHandler(socket, SOCKET_EVENTS.ROOM_GET_RECONNECTION_TOKEN, null,
        async (ctx: RoomContext) => {
            let token: string | null = await playerService.getExistingReconnectionToken(ctx.sessionId);

            if (!token) {
                token = await playerService.generateReconnectionToken(ctx.sessionId);
            }

            if (!token) {
                throw new ServerError('Failed to generate reconnection token');
            }

            socket.emit(SOCKET_EVENTS.ROOM_RECONNECTION_TOKEN, {
                token,
                sessionId: ctx.sessionId,
                roomCode: ctx.roomCode
            });

            logger.debug(`Reconnection token sent to player ${ctx.sessionId}`);
        }
    ));

    /**
     * Reconnect with a secure token
     */
    socket.on(SOCKET_EVENTS.ROOM_RECONNECT, createPreRoomHandler(socket, SOCKET_EVENTS.ROOM_RECONNECT, roomReconnectSchema,
        async (validated: RoomReconnectInput) => {
            const { code, reconnectionToken } = validated;

            const reconnectPromise = (async () => {
                const validation: TokenValidation = await playerService.validateRoomReconnectToken(reconnectionToken, socket.sessionId);

                if (!validation.valid) {
                    throw new PlayerError(ERROR_CODES.NOT_AUTHORIZED, `Invalid reconnection token: ${validation.reason}`);
                }

                const { tokenData } = validation;

                if (tokenData?.roomCode !== code) {
                    throw new PlayerError(ERROR_CODES.INVALID_INPUT, 'Token does not match room');
                }

                const room: Room | null = await roomService.getRoom(code);
                if (!room) {
                    throw RoomError.notFound(code);
                }

                await playerService.updatePlayer(socket.sessionId, {
                    connected: true,
                    lastSeen: Date.now()
                });

                const [player, players, game] = await Promise.all([
                    playerService.getPlayer(socket.sessionId),
                    playerService.getPlayersInRoom(code),
                    gameService.getGame(code)
                ]) as [Player | null, Player[], GameState | null];

                if (!player) {
                    throw PlayerError.notFound(socket.sessionId);
                }
                if (!players || !Array.isArray(players)) {
                    throw RoomError.notFound(code);
                }

                let gameState: PlayerGameState | null = null;
                if (game) {
                    gameState = gameService.getGameStateForPlayer(game, player);
                }

                return { room, player, players, game, gameState };
            })();

            const { room, player, players, game, gameState } = await withTimeout(
                reconnectPromise,
                TIMEOUTS.RECONNECT,
                'room:reconnect'
            );

            socket.join(`room:${code}`);
            socket.join(`player:${socket.sessionId}`);
            socket.roomCode = code;

            const isSpectator = player.role === 'spectator' || !player.team;
            if (isSpectator) {
                socket.join(`spectators:${code}`);
            } else {
                socket.leave(`spectators:${code}`);
            }

            const roomStats: RoomStats = await playerService.getRoomStats(code);

            let newReconnectionToken: string | null = null;
            if (SESSION_SECURITY.ROTATE_SESSION_ON_RECONNECT) {
                try {
                    newReconnectionToken = await playerService.generateReconnectionToken(socket.sessionId);
                    logger.debug(`Session rotated for player ${player.nickname} in room ${code}`);
                } catch (tokenError) {
                    logger.warn(`Failed to rotate session token: ${(tokenError as Error).message}`);
                }
            }

            socket.emit(SOCKET_EVENTS.ROOM_RECONNECTED, {
                room,
                players,
                game: gameState,
                you: player,
                stats: roomStats,
                reconnectionToken: newReconnectionToken
            });

            await Promise.all([
                sendSpymasterViewIfNeeded(socket, player, game, code),
                sendTimerStatus(socket, code, 'reconnect')
            ]);

            socket.to(`room:${code}`).emit(SOCKET_EVENTS.ROOM_PLAYER_RECONNECTED, {
                sessionId: socket.sessionId,
                nickname: player.nickname,
                team: player.team
            });

            // PHASE 5.1: Track successful reconnection
            incrementCounter(METRIC_NAMES.RECONNECTIONS, 1, { roomCode: code, success: 'true' });

            logger.info(`Player ${player.nickname} securely reconnected to room ${code}`);
        }
    ));
}

export default roomHandlers;

// CommonJS compat
module.exports = roomHandlers;
module.exports.default = roomHandlers;
