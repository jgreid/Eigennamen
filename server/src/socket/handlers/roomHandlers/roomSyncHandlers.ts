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

                return { room, players };
            })();

            const { room, players } = await withTimeout(statePromise, TIMEOUTS.RECONNECT, 'room:resync');

            const roomStats: RoomStats = await playerService.getRoomStats(ctx.roomCode).catch((err: Error) => {
                logger.warn(`Failed to get room stats during resync: ${err.message}`);
                return computeFallbackStats(players);
            });

            // Re-read the game immediately before emitting rather than using the
            // ctx.game snapshot captured at context resolution. A reveal/endTurn that
            // committed (and broadcast game:cardRevealed) while we gathered room/
            // players/stats above would otherwise be reverted on the client by this
            // stale resync snapshot, leaving a revealed card visually unrevealed.
            const freshGame = await gameService.getGame(ctx.roomCode);
            const gameState: PlayerGameState | null = freshGame
                ? gameService.getGameStateForPlayer(freshGame, ctx.player)
                : null;

            socket.emit(SOCKET_EVENTS.ROOM_RESYNCED, {
                room,
                players,
                game: gameState,
                you: ctx.player,
                stats: roomStats,
            });

            await Promise.all([
                sendSpymasterViewIfNeeded(socket, ctx.player, freshGame, ctx.roomCode),
                sendTimerStatus(socket, ctx.roomCode, 'resync'),
            ]);

            logger.info(`State resynced for player ${ctx.sessionId} in room ${ctx.roomCode}`);
        })
    );
}
