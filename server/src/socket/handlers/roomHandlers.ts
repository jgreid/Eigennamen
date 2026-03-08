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
import { incrementCounter, METRIC_NAMES } from '../../utils/metrics';
import { safeEmitToRoom } from '../safeEmit';
import {
    sendTimerStatus,
    sendSpymasterViewIfNeeded,
    trackFailedJoinAttempt,
    computeFallbackStats,
} from './roomHandlerUtils';

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

function roomHandlers(io: Server, socket: GameSocket): void {
    /**
     * Create a new room
     */
    socket.on(
        SOCKET_EVENTS.ROOM_CREATE,
        createPreRoomHandler(
            socket,
            SOCKET_EVENTS.ROOM_CREATE,
            roomCreateSchema,
            async (validated: RoomCreateInput) => {
                const { room, player }: { room: Room; player: Player } = await withTimeout(
                    roomService.createRoom(validated.roomId, socket.sessionId, validated.settings),
                    TIMEOUTS.SOCKET_HANDLER,
                    'room:create'
                );

                socket.join(`room:${room.code}`);
                socket.join(`player:${socket.sessionId}`);
                // Set roomCode immediately after joining socket rooms so that
                // any concurrent event handlers see consistent state between
                // socket.roomCode and Redis (the player is already persisted).
                socket.roomCode = room.code;

                // Host starts as spectator
                socket.join(`spectators:${room.code}`);

                // Use fallback stats if getRoomStats fails to prevent room creation
                // from failing after the room is already persisted in Redis
                const roomStats: RoomStats = await playerService.getRoomStats(room.code).catch((err: Error) => {
                    logger.warn(`Failed to get room stats during create: ${err.message}`);
                    return computeFallbackStats([player]);
                });

                socket.emit(SOCKET_EVENTS.ROOM_CREATED, { room, player, stats: roomStats });

                logger.info(`Room created: ${room.code} by ${socket.sessionId}`);
            }
        )
    );

    /**
     * Join an existing room
     */
    socket.on(
        SOCKET_EVENTS.ROOM_JOIN,
        createPreRoomHandler(socket, SOCKET_EVENTS.ROOM_JOIN, roomJoinSchema, async (validated: RoomJoinInput) => {
            // Rate limiting for join attempts is handled by createPreRoomHandler
            // (room:join: 10/min). Failed attempts are additionally tracked by
            // trackFailedJoinAttempt for monitoring/metrics.

            let joinResult: {
                room: Room;
                players: Player[];
                game: GameState | null;
                player: Player;
                isReconnecting: boolean;
            };
            try {
                joinResult = (await withTimeout(
                    roomService.joinRoom(validated.roomId, socket.sessionId, validated.nickname),
                    TIMEOUTS.JOIN_ROOM,
                    'room:join'
                )) as {
                    room: Room;
                    players: Player[];
                    game: GameState | null;
                    player: Player;
                    isReconnecting: boolean;
                };
            } catch (error) {
                // Track failed attempt for rate limiting (prevents room enumeration)
                if (
                    (error as { code?: string }).code === ERROR_CODES.ROOM_NOT_FOUND ||
                    (error as { code?: string }).code === ERROR_CODES.INVALID_INPUT
                ) {
                    await trackFailedJoinAttempt(socket);
                }
                throw error;
            }

            const { room, players, game, player, isReconnecting } = joinResult;

            socket.join(`room:${room.code}`);
            socket.join(`player:${socket.sessionId}`);
            // Set roomCode immediately after joining socket rooms so that
            // any concurrent event handlers see consistent state between
            // socket.roomCode and Redis (the player is already persisted).
            socket.roomCode = room.code;

            const isSpectator = player.role === 'spectator' || !player.team;
            if (isSpectator) {
                socket.join(`spectators:${room.code}`);
            }

            // Run stats fetch, token invalidation, and game state computation in parallel
            // to reduce total response time and avoid pushing past the client's timeout.
            // Overall timeout prevents a single slow Redis operation from blocking indefinitely.
            let statsUsedFallback = false;
            const [, roomStats, gameState] = (await withTimeout(
                Promise.all([
                    playerService.invalidateRoomReconnectToken(socket.sessionId).catch((err: Error) => {
                        logger.warn(`Failed to invalidate reconnection token during join: ${err.message}`);
                    }),
                    playerService.getRoomStats(room.code).catch((err: Error) => {
                        logger.warn(`Failed to get room stats during join: ${err.message}`);
                        statsUsedFallback = true;
                        return computeFallbackStats(players);
                    }),
                    Promise.resolve(game ? gameService.getGameStateForPlayer(game, player) : null),
                ]),
                TIMEOUTS.SOCKET_HANDLER,
                'room:join-parallel-ops'
            )) as [void, RoomStats, PlayerGameState | null];

            socket.emit(SOCKET_EVENTS.ROOM_JOINED, { room, players, game: gameState, you: player, stats: roomStats });

            // Notify client if stats used fallback data so it can request resync
            if (statsUsedFallback) {
                socket.emit(SOCKET_EVENTS.ROOM_WARNING, {
                    code: 'STATS_STALE',
                    message: 'Room stats may be incomplete. Request a resync if data looks wrong.',
                });
            }

            await Promise.all([
                sendSpymasterViewIfNeeded(socket, player, game, room.code),
                sendTimerStatus(socket, room.code, 'join'),
            ]);

            if (isReconnecting) {
                socket.to(`room:${room.code}`).emit(SOCKET_EVENTS.ROOM_PLAYER_RECONNECTED, {
                    sessionId: socket.sessionId,
                    nickname: player.nickname,
                    team: player.team,
                });
            } else {
                socket.to(`room:${room.code}`).emit(SOCKET_EVENTS.ROOM_PLAYER_JOINED, { player });
            }

            logger.info(`Player ${validated.nickname} joined room ${room.code}`);
        })
    );

    /**
     * Leave the current room
     */
    socket.on(
        SOCKET_EVENTS.ROOM_LEAVE,
        createRoomHandler(socket, SOCKET_EVENTS.ROOM_LEAVE, null, async (ctx: RoomContext) => {
            // Invalidate reconnection token when explicitly leaving
            await playerService.invalidateRoomReconnectToken(ctx.sessionId);

            const leaveResult = await roomService.leaveRoom(ctx.roomCode, ctx.sessionId);
            const result: { newHostId?: string } | null = leaveResult
                ? { ...leaveResult, newHostId: leaveResult.newHostId ?? undefined }
                : null;

            // Leave all socket rooms for this room
            socket.leave(`room:${ctx.roomCode}`);
            socket.leave(`spectators:${ctx.roomCode}`);
            socket.leave(`player:${ctx.sessionId}`);

            const remainingPlayers: Player[] = await playerService.getPlayersInRoom(ctx.roomCode);

            safeEmitToRoom(io, ctx.roomCode, SOCKET_EVENTS.ROOM_PLAYER_LEFT, {
                sessionId: ctx.sessionId,
                newHost: result?.newHostId || null,
                players: remainingPlayers || [],
            });

            // Broadcast updated stats so clients reflect the player departure
            const roomStats: RoomStats = await playerService.getRoomStats(ctx.roomCode, remainingPlayers);
            safeEmitToRoom(io, ctx.roomCode, SOCKET_EVENTS.ROOM_STATS_UPDATED, { stats: roomStats });

            logger.info(`Player ${ctx.sessionId} left room ${ctx.roomCode}`);
            socket.roomCode = null;
        })
    );

    /**
     * Update room settings (host only)
     */
    socket.on(
        SOCKET_EVENTS.ROOM_SETTINGS,
        createHostHandler(
            socket,
            SOCKET_EVENTS.ROOM_SETTINGS,
            roomSettingsSchema,
            async (ctx: RoomContext, validated: Record<string, unknown>) => {
                const settings = await roomService.updateSettings(ctx.roomCode, ctx.sessionId, validated);

                safeEmitToRoom(io, ctx.roomCode, SOCKET_EVENTS.ROOM_SETTINGS_UPDATED, { settings });

                logger.info(`Room ${ctx.roomCode} settings updated`);
            }
        )
    );

    /**
     * Request full state resync
     */
    socket.on(
        SOCKET_EVENTS.ROOM_RESYNC,
        createRoomHandler(socket, SOCKET_EVENTS.ROOM_RESYNC, null, async (ctx: RoomContext) => {
            const statePromise = (async () => {
                const [room, players] = (await Promise.all([
                    roomService.getRoom(ctx.roomCode),
                    playerService.getPlayersInRoom(ctx.roomCode),
                ])) as [Room | null, Player[]];

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

            const { room, players, gameState } = await withTimeout(statePromise, TIMEOUTS.RECONNECT, 'room:resync');

            const roomStats: RoomStats = await playerService.getRoomStats(ctx.roomCode).catch((err: Error) => {
                logger.warn(`Failed to get room stats during resync: ${err.message}`);
                return computeFallbackStats(players);
            });

            socket.emit(SOCKET_EVENTS.ROOM_RESYNCED, {
                room,
                players,
                game: gameState,
                you: ctx.player,
                stats: roomStats,
            });

            await Promise.all([
                sendSpymasterViewIfNeeded(socket, ctx.player, ctx.game, ctx.roomCode),
                sendTimerStatus(socket, ctx.roomCode, 'resync'),
            ]);

            logger.info(`State resynced for player ${ctx.sessionId} in room ${ctx.roomCode}`);
        })
    );

    /**
     * Request a reconnection token
     */
    socket.on(
        SOCKET_EVENTS.ROOM_GET_RECONNECTION_TOKEN,
        createRoomHandler(socket, SOCKET_EVENTS.ROOM_GET_RECONNECTION_TOKEN, null, async (ctx: RoomContext) => {
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
                roomCode: ctx.roomCode,
            });

            logger.debug(`Reconnection token sent to player ${ctx.sessionId}`);
        })
    );

    /**
     * Reconnect with a secure token
     */
    socket.on(
        SOCKET_EVENTS.ROOM_RECONNECT,
        createPreRoomHandler(
            socket,
            SOCKET_EVENTS.ROOM_RECONNECT,
            roomReconnectSchema,
            async (validated: RoomReconnectInput) => {
                const { code, reconnectionToken } = validated;

                const reconnectPromise = (async () => {
                    const validation: TokenValidation = await playerService.validateRoomReconnectToken(
                        reconnectionToken,
                        socket.sessionId
                    );

                    if (!validation.valid) {
                        throw new PlayerError(
                            ERROR_CODES.NOT_AUTHORIZED,
                            `Invalid reconnection token: ${validation.reason}`
                        );
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
                        lastSeen: Date.now(),
                    });

                    const [player, players, game] = (await Promise.all([
                        playerService.getPlayer(socket.sessionId),
                        playerService.getPlayersInRoom(code),
                        gameService.getGame(code),
                    ])) as [Player | null, Player[], GameState | null];

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
                // Set roomCode immediately after joining socket rooms so that
                // any concurrent event handlers see consistent state between
                // socket.roomCode and Redis (the player is already persisted).
                socket.roomCode = code;

                const isSpectator = player.role === 'spectator' || !player.team;
                if (isSpectator) {
                    socket.join(`spectators:${code}`);
                } else {
                    socket.leave(`spectators:${code}`);
                }

                const roomStats: RoomStats = await playerService.getRoomStats(code).catch((err: Error) => {
                    logger.warn(`Failed to get room stats during reconnect: ${err.message}`);
                    return computeFallbackStats(players);
                });

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
                    reconnectionToken: newReconnectionToken,
                });

                await Promise.all([
                    sendSpymasterViewIfNeeded(socket, player, game, code),
                    sendTimerStatus(socket, code, 'reconnect'),
                ]);

                socket.to(`room:${code}`).emit(SOCKET_EVENTS.ROOM_PLAYER_RECONNECTED, {
                    sessionId: socket.sessionId,
                    nickname: player.nickname,
                    team: player.team,
                });

                // Track successful reconnection
                incrementCounter(METRIC_NAMES.RECONNECTIONS, 1, { roomCode: code, success: 'true' });

                logger.info(`Player ${player.nickname} securely reconnected to room ${code}`);
            }
        )
    );
}

export default roomHandlers;

// CommonJS interop — tests use require() which needs module.exports
module.exports = roomHandlers;
module.exports.default = roomHandlers;
module.exports.sendSpymasterViewIfNeeded = sendSpymasterViewIfNeeded;
