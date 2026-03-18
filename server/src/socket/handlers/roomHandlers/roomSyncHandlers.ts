import type { Room, Player, PlayerGameState } from '../../../types';
import type { GameSocket, RoomContext } from '../types';
import type { RoomStats } from '../../../services/playerService';

import * as roomService from '../../../services/roomService';
import * as gameService from '../../../services/gameService';
import * as playerService from '../../../services/playerService';
import logger from '../../../utils/logger';
import { SOCKET_EVENTS } from '../../../config/constants';
import { createRoomHandler } from '../../contextHandler';
import { RoomError } from '../../../errors/GameError';
import { withTimeout, TIMEOUTS } from '../../../utils/timeout';
import { sendTimerStatus, sendSpymasterViewIfNeeded, computeFallbackStats } from '../roomHandlerUtils';

export default function roomSyncHandlers(_io: unknown, socket: GameSocket): void {
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
}
