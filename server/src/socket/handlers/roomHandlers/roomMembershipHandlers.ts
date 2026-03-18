import type { Server } from 'socket.io';
import type { Room, Player, GameState, PlayerGameState } from '../../../types';
import type { GameSocket, RoomContext } from '../types';
import type { RoomStats } from '../../../services/playerService';

import * as roomService from '../../../services/roomService';
import * as gameService from '../../../services/gameService';
import * as playerService from '../../../services/playerService';
import { roomCreateSchema, roomJoinSchema } from '../../../validators/schemas';
import logger from '../../../utils/logger';
import { ERROR_CODES, SOCKET_EVENTS } from '../../../config/constants';
import { createRoomHandler, createPreRoomHandler } from '../../contextHandler';
import { withTimeout, TIMEOUTS } from '../../../utils/timeout';
import { safeEmitToRoom } from '../../safeEmit';
import {
    sendTimerStatus,
    sendSpymasterViewIfNeeded,
    trackFailedJoinAttempt,
    computeFallbackStats,
} from '../roomHandlerUtils';

interface RoomCreateInput {
    roomId: string;
    settings?: Record<string, unknown>;
}

interface RoomJoinInput {
    roomId: string;
    nickname: string;
}

export default function roomMembershipHandlers(io: Server, socket: GameSocket): void {
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
}
