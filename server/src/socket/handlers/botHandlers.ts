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
import { PlayerError } from '../../errors/GameError';
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
                // Clients identify the bot only by its opaque playerId (N1);
                // resolve it back to the bot's session within this room.
                const bot = await playerService.findPlayerByPublicId(ctx.roomCode, validated.playerId);
                if (!bot) {
                    throw PlayerError.notFound(validated.playerId);
                }
                // Capture the seat the bot held BEFORE removing it, so we can tell
                // whether the current turn was waiting on it (N25).
                const removedTeam = bot.team;
                const removedRole = bot.role;
                await botService.removeBot(ctx.roomCode, bot.sessionId);

                const players: Player[] = await playerService.getPlayersInRoom(ctx.roomCode);
                // toPublicPlayers here too — this emit previously sent the raw
                // Player[] and was the one ROOM_PLAYER_LEFT bypassing the N2
                // PII projection (leaking every peer's lastIP/userId).
                safeEmitToRoom(io, ctx.roomCode, SOCKET_EVENTS.ROOM_PLAYER_LEFT, {
                    playerId: validated.playerId,
                    newHost: null,
                    players: playerService.toPublicPlayers(players),
                });

                const stats: RoomStats = await playerService.getRoomStats(ctx.roomCode, players);
                safeEmitToRoom(io, ctx.roomCode, SOCKET_EVENTS.ROOM_STATS_UPDATED, { stats });

                // If a game is live, the removed bot may have held the very seat
                // the current turn is waiting on. Unlike BOT_ADD, this path never
                // nudged the controller, and nothing warned the room — so in a
                // timer-less room the turn indicator would hang on a seat nobody
                // holds (the silent-stall symptom P1-6/B4 fixed, just human-
                // initiated). Warn the room when the vacated seat is the pending
                // one, and nudge the controller either way so a remaining bot on
                // the team (or a re-added one) re-evaluates. (N25)
                const game = await gameService.getGame(ctx.roomCode);
                if (game && !game.gameOver && !game.paused) {
                    const pendingRole: 'spymaster' | 'clicker' = game.currentClue ? 'clicker' : 'spymaster';
                    if (removedTeam === game.currentTurn && removedRole === pendingRole) {
                        safeEmitToRoom(io, ctx.roomCode, SOCKET_EVENTS.ROOM_WARNING, {
                            code: 'SEAT_VACATED',
                            message: `The ${removedTeam} ${pendingRole} bot was removed mid-turn; the game is now waiting on a human to take that seat.`,
                            team: removedTeam,
                        });
                    }
                    notifyGameMutation(ctx.roomCode);
                }

                logger.info(
                    `Bot ${validated.playerId} removed from room ${ctx.roomCode} by host ${ctx.player.nickname}`
                );
            }
        )
    );
}

export default botHandlers;

// CommonJS interop — tests use require()
module.exports = botHandlers;
module.exports.default = botHandlers;
