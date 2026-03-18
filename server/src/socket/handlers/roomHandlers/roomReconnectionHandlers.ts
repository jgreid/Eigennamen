import type { Room, Player, GameState, PlayerGameState, Team } from '../../../types';
import type { GameSocket, RoomContext } from '../types';
import type { RoomStats } from '../../../services/playerService';

import * as roomService from '../../../services/roomService';
import * as gameService from '../../../services/gameService';
import * as playerService from '../../../services/playerService';
import { roomReconnectSchema } from '../../../validators/schemas';
import logger from '../../../utils/logger';
import { ERROR_CODES, SOCKET_EVENTS, SESSION_SECURITY } from '../../../config/constants';
import { createRoomHandler, createPreRoomHandler } from '../../contextHandler';
import { RoomError, PlayerError, ServerError } from '../../../errors/GameError';
import { withTimeout, TIMEOUTS } from '../../../utils/timeout';
import { incrementCounter, METRIC_NAMES } from '../../../utils/metrics';
import { sendTimerStatus, sendSpymasterViewIfNeeded, computeFallbackStats } from '../roomHandlerUtils';

interface RoomReconnectInput {
    code: string;
    reconnectionToken: string;
}

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

export default function roomReconnectionHandlers(_io: unknown, socket: GameSocket): void {
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
