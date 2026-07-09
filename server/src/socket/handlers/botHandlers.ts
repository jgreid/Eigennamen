import type { Server } from 'socket.io';
import type { Player } from '../../types';
import type { GameSocket, RoomContext } from './types';

import * as botService from '../../services/botService';
import * as playerService from '../../services/playerService';
import * as gameService from '../../services/gameService';
import type { RoomStats } from '../../services/player/stats';
import { SOCKET_EVENTS } from '../../config/constants';
import { createHostHandler } from '../contextHandler';
import { safeEmitToRoom } from '../safeEmit';
import { notifyGameMutation } from '../gameMutationNotifier';
import { botAddSchema, botRemoveSchema } from '../../validators/schemas';
import type { BotAddInput, BotRemoveInput } from '../../validators/schemas';
import logger from '../../utils/logger';

// Use the Zod-inferred input types (G5) instead of hand-written local copies.
// The old local `BotAddInput` dropped `advisor` from the role union and forced
// `botAddSchema as ZodType<BotAddInput>`, so an `advisor` bot passed validation
// but was typed as an impossible role at the handler — the cast silently hid the
// mismatch. The inferred types stay in lockstep with the schema.

/**
 * Bot management handlers (host only): add or remove server-side bot players.
 * Added bots appear in the room exactly like human players (room:playerJoined),
 * so no frontend change is required to see them in the lobby.
 */
function botHandlers(io: Server, socket: GameSocket): void {
    /**
     * Add a bot to a seat (host only)
     */
    socket.on(
        SOCKET_EVENTS.BOT_ADD,
        createHostHandler(
            socket,
            SOCKET_EVENTS.BOT_ADD,
            botAddSchema,
            async (ctx: RoomContext, validated: BotAddInput) => {
                const bot: Player = await botService.addBot(ctx.roomCode, {
                    team: validated.team,
                    role: validated.role,
                    strategyId: validated.strategyId,
                    skillPreset: validated.skillPreset,
                    nickname: validated.nickname,
                });

                // Announce the bot to everyone (including the host) like a join.
                // Route through the same public-player projection as the human join
                // path so the ROOM_PLAYER_JOINED payload shape stays identical (N2).
                safeEmitToRoom(io, ctx.roomCode, SOCKET_EVENTS.ROOM_PLAYER_JOINED, {
                    player: playerService.toPublicPlayer(bot),
                });

                const players: Player[] = await playerService.getPlayersInRoom(ctx.roomCode);
                const stats: RoomStats = await playerService.getRoomStats(ctx.roomCode, players);
                safeEmitToRoom(io, ctx.roomCode, SOCKET_EVENTS.ROOM_STATS_UPDATED, { stats });

                // If a game is already running, nudge the controller so the bot
                // acts immediately when it's its turn.
                const game = await gameService.getGame(ctx.roomCode);
                if (game && !game.gameOver) {
                    notifyGameMutation(ctx.roomCode);
                }

                logger.info(`Bot added to room ${ctx.roomCode} by host ${ctx.player.nickname}`);
            }
        )
    );

    /**
     * Remove a bot (host only)
     */
    socket.on(
        SOCKET_EVENTS.BOT_REMOVE,
        createHostHandler(
            socket,
            SOCKET_EVENTS.BOT_REMOVE,
            botRemoveSchema,
            async (ctx: RoomContext, validated: BotRemoveInput) => {
                await botService.removeBot(ctx.roomCode, validated.sessionId);

                const players: Player[] = await playerService.getPlayersInRoom(ctx.roomCode);
                safeEmitToRoom(io, ctx.roomCode, SOCKET_EVENTS.ROOM_PLAYER_LEFT, {
                    sessionId: validated.sessionId,
                    newHost: null,
                    players,
                });

                const stats: RoomStats = await playerService.getRoomStats(ctx.roomCode, players);
                safeEmitToRoom(io, ctx.roomCode, SOCKET_EVENTS.ROOM_STATS_UPDATED, { stats });

                logger.info(
                    `Bot ${validated.sessionId} removed from room ${ctx.roomCode} by host ${ctx.player.nickname}`
                );
            }
        )
    );
}

export default botHandlers;

// CommonJS interop — tests use require()
module.exports = botHandlers;
module.exports.default = botHandlers;
