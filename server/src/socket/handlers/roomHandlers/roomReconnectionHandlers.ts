import type { Server } from 'socket.io';
import type { Room, Player, GameState, PlayerGameState, Team } from '../../../types';
import type { GameSocket, RoomContext } from '../types';
import type { RoomStats } from '../../../services/playerService';

import * as roomService from '../../../services/roomService';
import * as gameService from '../../../services/gameService';
import * as playerService from '../../../services/playerService';
import * as botService from '../../../services/botService';
import { roomReconnectSchema } from '../../../validators/schemas';
import logger from '../../../utils/logger';
import { ERROR_CODES, SOCKET_EVENTS, SESSION_SECURITY } from '../../../config/constants';
import { createRoomHandler, createPreRoomHandler } from '../../contextHandler';
import { RoomError, PlayerError, ServerError } from '../../../errors/GameError';
import { withTimeout, TIMEOUTS } from '../../../utils/timeout';
import { withLock } from '../../../utils/distributedLock';
import { safeEmitToRoom } from '../../safeEmit';
import { incrementCounter, METRIC_NAMES } from '../../../utils/metrics';
import { sendTimerStatus, sendSpymasterViewIfNeeded, computeFallbackStats } from '../roomHandlerUtils';

/** Roles a bot can ever occupy (services/botService.ts's AddBotOptions). */
const BOT_ELIGIBLE_ROLES = new Set(['spymaster', 'clicker', 'advisor']);

/**
 * If a connected bot is currently standing in on the reconnecting player's own
 * team+role, evict it — a human reclaiming their seat takes precedence over a
 * bot that was only covering it during the disconnect grace window. Mirrors
 * the existing "host transfer prefers humans" policy (a bot can't run
 * host-only functions, so a human already wins precedence there). Without
 * this, addBot's connected-only occupancy check lets a bot take a merely-
 * disconnected human's seat, and the human reconnecting into the same seat
 * verbatim would race the bot's reveals. See docs/HARDENING_PLAN.md P1-7.
 */
async function evictStandInBotIfAny(io: Server, roomCode: string, player: Player): Promise<void> {
    if (!player.team || !player.role || !BOT_ELIGIBLE_ROLES.has(player.role)) return;

    const teamMembers = await playerService.getTeamMembers(roomCode, player.team);
    const standInBot = teamMembers.find(
        (p) => p.isBot && p.connected && p.role === player.role && p.sessionId !== player.sessionId
    );
    if (!standInBot) return;

    try {
        await botService.removeBot(roomCode, standInBot.sessionId);
        logger.info(
            `Evicted stand-in bot ${standInBot.sessionId} (${standInBot.nickname}) from ${roomCode} — ` +
                `${player.nickname} reconnected to reclaim ${player.team} ${player.role}`
        );
        safeEmitToRoom(io, roomCode, SOCKET_EVENTS.ROOM_WARNING, {
            code: 'BOT_SEAT_RECLAIMED',
            message: `${player.nickname} reconnected — a bot was covering their seat while they were away`,
            team: player.team,
        });
    } catch (err) {
        // Non-fatal: the human still reconnects into their seat even if the
        // stand-in bot couldn't be removed (e.g. it was already gone).
        logger.warn(`Failed to evict stand-in bot ${standInBot.sessionId} in ${roomCode}: ${(err as Error).message}`);
    }
}

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

export default function roomReconnectionHandlers(io: Server, socket: GameSocket): void {
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

                    // Serialized against a concurrent disconnect's connected:false
                    // write via the same player-mutation lock (see
                    // services/player/cleanup.ts's handleDisconnect) — otherwise a
                    // disconnect racing this reconnect could land its stale write
                    // last and leave this actively-reconnected player flagged
                    // disconnected. See docs/HARDENING_PLAN.md P0-4.
                    await withLock(`player-mutation:${socket.sessionId}`, async () => {
                        await playerService.updatePlayer(socket.sessionId, {
                            connected: true,
                            lastSeen: Date.now(),
                        });
                    });

                    // A10: if this room's host was reaped (grace-period cleanup or
                    // key-TTL expiry) while nobody connected could take over, the
                    // room is otherwise hostless forever. Now that this player is
                    // connected again, repair it — they (or another connected human)
                    // are promoted so the room is controllable again.
                    await roomService.ensureRoomHasHost(code);

                    const [freshRoom, player, players, game] = (await Promise.all([
                        roomService.getRoom(code),
                        playerService.getPlayer(socket.sessionId),
                        playerService.getPlayersInRoom(code),
                        gameService.getGame(code),
                    ])) as [Room | null, Player | null, Player[], GameState | null];

                    if (!player) {
                        throw PlayerError.notFound(socket.sessionId);
                    }
                    if (!players || !Array.isArray(players)) {
                        throw RoomError.notFound(code);
                    }

                    // A bot may have taken this seat while the human was disconnected
                    // (grace-window). Evict it now so the reconnecting human doesn't
                    // race a still-acting bot for the same team+role.
                    await evictStandInBotIfAny(io, code, player);
                    const freshPlayers = await playerService.getPlayersInRoom(code).catch(() => players);

                    let gameState: PlayerGameState | null = null;
                    if (game) {
                        gameState = gameService.getGameStateForPlayer(game, player);
                    }

                    return { room: freshRoom ?? room, player, players: freshPlayers, game, gameState };
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
