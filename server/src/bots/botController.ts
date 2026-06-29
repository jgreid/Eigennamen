/**
 * Live bot driver. A singleton, initialized at socket startup with the Socket.IO
 * server. It subscribes to the existing onGameMutation notifier and, whenever a
 * game changes, checks whether the seat that owns the next action is a bot — if
 * so it computes the move via the shared playOneAction helper and applies it
 * through the SAME gameActions the socket handlers use, so humans see identical
 * broadcasts.
 *
 * Key safeguards:
 *  - Reactions are DEFERRED (queueMicrotask): notifyGameMutation fires INSIDE the
 *    reveal lock, so reacting synchronously would try to re-enter a held lock.
 *  - A per-room in-flight guard prevents overlapping ticks; a single tick loops
 *    to drive a whole cascade (spymaster clue → clicker guesses → turn flip → …).
 *  - Stale snapshots are safe: the reveal lock + Lua preconditions reject any
 *    out-of-turn / already-revealed move, which simply ends the tick.
 *  - Each acting bot's lastSeen is refreshed so the disconnect GC never reaps it.
 */
import type { Server } from 'socket.io';
import type { GameMode } from '../shared/gameRules';

import logger from '../utils/logger';
import { onGameMutation } from '../socket/gameMutationNotifier';
import * as gameService from '../services/gameService';
import * as playerService from '../services/playerService';
import * as botService from '../services/botService';
import { hashString } from '../services/game/boardGenerator';
import { resolveClicker, resolveSpymaster } from './strategies/registry';
import { resolveSkill } from './presets';
import { makeRng } from './rng';
import { playOneAction } from './playOneAction';
import { applyClue, applyReveal, applyEndTurn } from '../socket/handlers/gameActions';

/** Safety bound on consecutive bot actions in a single tick. */
const MAX_ACTIONS_PER_TICK = 200;

let ioRef: Server | null = null;
let unsubscribe: (() => void) | null = null;
const inFlight = new Set<string>();

/** Register the controller. Idempotent — safe to call once at socket init. */
export function initBotController(io: Server): void {
    ioRef = io;
    if (unsubscribe) return;
    unsubscribe = onGameMutation((roomCode: string) => {
        // Defer out of the reveal lock that notifyGameMutation fires within.
        queueMicrotask(() => {
            void tickRoom(roomCode);
        });
    });
    logger.info('Bot controller initialized');
}

/** Tear down (used by tests and shutdown). */
export function stopBotController(): void {
    if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
    }
    inFlight.clear();
    ioRef = null;
}

/**
 * Drive all pending bot actions for a room. Loops so a single notification can
 * carry a full cascade; the in-flight guard collapses concurrent notifications.
 * Exported for tests; normally invoked via the mutation subscription.
 */
export async function tickRoom(roomCode: string): Promise<void> {
    const io = ioRef;
    if (!io) return;
    if (inFlight.has(roomCode)) return;
    inFlight.add(roomCode);

    try {
        // Sequential by design: each bot action mutates shared game state under
        // the reveal lock and must complete before the next is computed.
        /* eslint-disable no-await-in-loop */
        for (let i = 0; i < MAX_ACTIONS_PER_TICK; i++) {
            const game = await gameService.getGame(roomCode);
            if (!game || game.gameOver || game.paused) break;

            const team = game.currentTurn;
            const role: 'spymaster' | 'clicker' = game.currentClue ? 'clicker' : 'spymaster';

            const members = await playerService.getTeamMembers(roomCode, team);
            const seat = members.find((p) => p.isBot && p.connected && p.role === role);
            if (!seat || !seat.team) break; // human's turn, or no bot in that seat

            const cfg = await botService.getBotConfig(seat.sessionId);
            if (!cfg) break;

            // Deterministic per-decision seed: (botSeed, gameSeed, stateVersion).
            const seed = hashString(`${cfg.seed}:${game.seed}:${game.stateVersion ?? 0}`);
            const skill = resolveSkill(cfg.skillPreset, seed);
            const strategy =
                role === 'spymaster' ? resolveSpymaster(cfg.strategyId, skill) : resolveClicker(cfg.strategyId, skill);
            const ctx = { gameMode: (game.gameMode as GameMode) ?? 'classic', skill, rng: makeRng(seed) };

            const action = playOneAction(game, seat, strategy, ctx);
            if (action.kind === 'noop') break;

            // Keep the bot alive across the disconnect GC window.
            await playerService.updatePlayer(seat.sessionId, { lastSeen: Date.now() }).catch(() => {
                /* non-critical */
            });

            const actor = { sessionId: seat.sessionId, nickname: seat.nickname, team, role: seat.role };
            if (action.kind === 'clue') {
                await applyClue(io, roomCode, actor, action.word, action.number);
            } else if (action.kind === 'reveal') {
                await applyReveal(io, roomCode, actor, action.index);
            } else if (action.kind === 'endTurn') {
                await applyEndTurn(io, roomCode, actor);
            }
        }
        /* eslint-enable no-await-in-loop */
    } catch (err) {
        // A rejected move (lost the turn race, already revealed, etc.) just ends
        // the tick; the next mutation re-triggers if a bot still needs to act.
        logger.warn(`botController tick for ${roomCode} stopped: ${(err as Error).message}`);
    } finally {
        inFlight.delete(roomCode);
    }
}
