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
import type { GameState, Player, Team } from '../types';
import type { BotClickerView } from './strategies/types';

import logger from '../utils/logger';
import { onGameMutation } from '../socket/gameMutationNotifier';
import { safeEmitToRoom } from '../socket/safeEmit';
import { SOCKET_EVENTS } from '../config/constants';
import * as gameService from '../services/gameService';
import * as playerService from '../services/playerService';
import * as botService from '../services/botService';
import { hashString } from '../services/game/boardGenerator';
import { resolveClicker, resolveSpymaster } from './strategies/registry';
import { getSemanticBackend } from './semantics/selectBackend';
import { suggestGuesses } from './strategies/advisor';
import { resolveSkill } from './presets';
import { makeRng } from './rng';
import { playOneAction } from './playOneAction';
import { applyClue, applyReveal, applyEndTurn } from '../socket/handlers/gameActions';

/** Per-room de-dupe key for the last advisor suggestion emitted (avoids
 *  re-emitting identical suggestions on every unrelated mutation). */
const suggestionKeys = new Map<string, string>();

/**
 * Live "thinking" pace between bot actions so a whole cascade (clue → guess →
 * guess → turn flip) doesn't land in a single instant and feel robotic. Disabled
 * in tests so the deterministic unit/harness suites stay synchronous.
 */
const ACTION_PACE_MS = process.env.NODE_ENV === 'test' ? 0 : 350;

/** A small, state-derived jitter on top of the base pace so it isn't metronomic. */
function paceDelayMs(stateVersion: number): number {
    if (ACTION_PACE_MS <= 0) return 0;
    return ACTION_PACE_MS + (Math.abs(stateVersion) % 5) * 70; // 350–630ms
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
        const t = setTimeout(resolve, ms);
        if (typeof t.unref === 'function') t.unref();
    });
}

/** Safety bound on consecutive bot actions in a single tick. */
const MAX_ACTIONS_PER_TICK = 200;
/**
 * Re-arm bounds. Bot ticks are driven only by game mutations, so if a single
 * bot action fails (a reveal-lock acquisition giving up after its retries, a
 * GAME_ACTION timeout under contention, or a transiently-rejected move) the
 * cascade would otherwise stall forever: no further mutation arrives to retry
 * it, and a human waiting on that bot's clue is stuck. So a failed tick re-arms
 * itself after a short backoff. The streak is bounded so a *deterministically*
 * failing action can't spin — after the cap we give up loudly rather than stall
 * silently or loop. Any success (here or via a human-triggered tick) resets it.
 */
const MAX_REARM_ATTEMPTS = 6;
const REARM_BASE_DELAY_MS = 200;
const REARM_MAX_DELAY_MS = 2000;

let ioRef: Server | null = null;
let unsubscribe: (() => void) | null = null;
const inFlight = new Set<string>();
/**
 * Rooms that received a mutation notification while a tick was already running.
 * The in-flight guard drops those notifications; without coalescing, a mutation
 * that lands between a tick's final state read and its exit would be lost and the
 * bot would stall until some unrelated mutation arrived. We record it and re-tick
 * once the current tick finishes.
 */
const pending = new Set<string>();
/** Per-room consecutive-failure count, used to back off and bound re-arming. */
const failureStreak = new Map<string, number>();
/** Per-room pending re-arm timer (at most one in flight). */
const reArmTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Schedule a bounded, backed-off retry of a room that failed mid-cascade. */
function scheduleReArm(roomCode: string): void {
    const streak = (failureStreak.get(roomCode) ?? 0) + 1;
    failureStreak.set(roomCode, streak);
    if (streak > MAX_REARM_ATTEMPTS) {
        logger.error(`botController giving up on ${roomCode} after ${MAX_REARM_ATTEMPTS} consecutive action failures`);
        return;
    }
    if (reArmTimers.has(roomCode)) return; // one pending re-arm at a time
    const delay = Math.min(REARM_MAX_DELAY_MS, REARM_BASE_DELAY_MS * 2 ** (streak - 1));
    const timer = setTimeout(() => {
        reArmTimers.delete(roomCode);
        void tickRoom(roomCode);
    }, delay);
    // A pending bot retry must never keep the process alive on its own.
    if (typeof timer.unref === 'function') timer.unref();
    reArmTimers.set(roomCode, timer);
}

/** Clear any backoff state for a room (called on success / clean stop). */
function clearReArm(roomCode: string): void {
    failureStreak.delete(roomCode);
    const timer = reArmTimers.get(roomCode);
    if (timer) {
        clearTimeout(timer);
        reArmTimers.delete(roomCode);
    }
}

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
    pending.clear();
    for (const timer of reArmTimers.values()) clearTimeout(timer);
    reArmTimers.clear();
    failureStreak.clear();
    suggestionKeys.clear();
    ioRef = null;
}

/**
 * If the current-turn team has a connected advisor bot and a clue is live, emit
 * ranked guess suggestions for the human clicker to act on. Advisory only — the
 * advisor never reveals. De-duped per distinct board/clue state so it fires once
 * per clue and once after each reveal, not on every unrelated mutation.
 */
async function emitAdvisorSuggestions(
    io: Server,
    roomCode: string,
    game: GameState,
    team: Team,
    members: Player[]
): Promise<void> {
    const clue = game.currentClue;
    if (!clue) return;
    const advisor = members.find((p) => p.isBot && p.connected && p.role === 'advisor');
    if (!advisor) {
        suggestionKeys.delete(roomCode);
        return;
    }

    const key = `${team}:${clue.word}:${clue.number}:${game.guessesUsed ?? 0}:${game.stateVersion ?? 0}`;
    if (suggestionKeys.get(roomCode) === key) return;

    const view: BotClickerView = {
        role: 'clicker',
        team,
        gameMode: (game.gameMode as GameMode) ?? 'classic',
        words: game.words,
        revealed: game.revealed,
        types: [],
        currentTurn: game.currentTurn,
        currentClue: { word: clue.word, number: clue.number, team: clue.team },
        guessesUsed: game.guessesUsed ?? 0,
        guessesAllowed: game.guessesAllowed ?? 0,
    };
    // Honour the advisor bot's configured skill: a strong advisor gives confident,
    // best-fit picks; a weaker one gives loose, lower-confidence hints.
    const cfg = await botService.getBotConfig(advisor.sessionId);
    const seed = hashString(`${cfg?.seed ?? 0}:${game.seed}:${game.stateVersion ?? 0}`);
    const skill = cfg ? resolveSkill(cfg.skillPreset, seed) : undefined;
    const suggestions = suggestGuesses(view, getSemanticBackend(), 3, skill, makeRng(seed));
    if (suggestions.length === 0) return;

    suggestionKeys.set(roomCode, key);
    safeEmitToRoom(io, roomCode, SOCKET_EVENTS.GAME_BOT_SUGGESTION, {
        team,
        clue: { word: clue.word, number: clue.number },
        advisor: { sessionId: advisor.sessionId, nickname: advisor.nickname },
        suggestions,
    });
    // Keep the advisor alive across the disconnect GC window, like an acting bot.
    await playerService.updatePlayer(advisor.sessionId, { lastSeen: Date.now() }).catch(() => {
        /* non-critical */
    });
}

/**
 * Drive all pending bot actions for a room. Loops so a single notification can
 * carry a full cascade; the in-flight guard collapses concurrent notifications.
 * Exported for tests; normally invoked via the mutation subscription.
 */
export async function tickRoom(roomCode: string): Promise<void> {
    const io = ioRef;
    if (!io) return;
    if (inFlight.has(roomCode)) {
        // A tick is already running for this room. Record that new state arrived
        // so we re-tick once it finishes, instead of dropping the notification.
        pending.add(roomCode);
        return;
    }
    inFlight.add(roomCode);
    // This tick will observe current state, so drop any coalesced marker for it.
    pending.delete(roomCode);

    // Whether the tick ended because an action failed (vs. a clean stop: game
    // over/paused, a human's seat, or no move to make). A failure re-arms a
    // retry; a clean stop clears the backoff.
    let actionFailed = false;
    try {
        // Sequential by design: each bot action mutates shared game state under
        // the reveal lock and must complete before the next is computed.
        /* eslint-disable no-await-in-loop */
        for (let i = 0; i < MAX_ACTIONS_PER_TICK; i++) {
            const game = await gameService.getGame(roomCode);
            if (!game || game.gameOver || game.paused) {
                suggestionKeys.delete(roomCode);
                break;
            }

            const team = game.currentTurn;
            const role: 'spymaster' | 'clicker' = game.currentClue ? 'clicker' : 'spymaster';

            const members = await playerService.getTeamMembers(roomCode, team);
            const seat = members.find((p) => p.isBot && p.connected && p.role === role);
            if (!seat || !seat.team) {
                // No bot to ACT this turn. If a clue is live and this team has an
                // advisor bot, surface suggestions for the (human) clicker instead.
                if (role === 'clicker') await emitAdvisorSuggestions(io, roomCode, game, team, members);
                break; // human's turn, or no bot in that seat
            }

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

            // A brief, human-like pause before the move lands (live play only).
            const pace = paceDelayMs(game.stateVersion ?? 0);
            if (pace > 0) {
                await sleep(pace);
                // The bot could have been removed/kicked/reseated during the pause.
                // Re-verify the seat still holds before acting so a removed bot
                // can't land one last move. (getPlayer returns null if removed.)
                const stillSeated = await playerService.getPlayer(seat.sessionId).catch(() => null);
                if (
                    !stillSeated ||
                    !stillSeated.isBot ||
                    !stillSeated.connected ||
                    stillSeated.team !== team ||
                    stillSeated.role !== role
                ) {
                    break;
                }
            }

            const actor = { sessionId: seat.sessionId, nickname: seat.nickname, team, role: seat.role };
            try {
                if (action.kind === 'clue') {
                    await applyClue(io, roomCode, actor, action.word, action.number);
                } else if (action.kind === 'reveal') {
                    await applyReveal(io, roomCode, actor, action.index);
                } else if (action.kind === 'endTurn') {
                    await applyEndTurn(io, roomCode, actor);
                }
            } catch (err) {
                // A single action failed: a lost turn race / already-revealed card
                // (benign — a re-read fixes it), or a reveal-lock timeout / contention
                // (transient). Either way DON'T silently abandon the cascade forever —
                // end this tick and re-arm a retry below. Re-arming is bounded so a
                // deterministically-rejected move can't spin.
                logger.warn(`botController action (${action.kind}) for ${roomCode} failed: ${(err as Error).message}`);
                actionFailed = true;
                break;
            }
            // An action succeeded: the cascade is making progress, so reset backoff.
            clearReArm(roomCode);
        }
        /* eslint-enable no-await-in-loop */
    } catch (err) {
        // An unexpected failure outside an individual action (e.g. a getGame /
        // getTeamMembers read). Treat as a transient failure and re-arm.
        logger.warn(`botController tick for ${roomCode} stopped: ${(err as Error).message}`);
        actionFailed = true;
    } finally {
        inFlight.delete(roomCode);
    }

    if (pending.has(roomCode)) {
        // A mutation arrived while this tick was running. Re-tick so the bot reacts
        // to it now rather than stalling until the next unrelated mutation. This
        // supersedes failure re-arm (the fresh state may itself resolve the failure).
        pending.delete(roomCode);
        queueMicrotask(() => {
            void tickRoom(roomCode);
        });
        return;
    }

    if (actionFailed) {
        scheduleReArm(roomCode);
    } else {
        // Clean stop: nothing more for a bot to do right now. Drop any backoff.
        clearReArm(roomCode);
    }
}
