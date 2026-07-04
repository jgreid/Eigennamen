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
import type { BotClickerView, ClueMemoryEntry } from './strategies/types';

import logger from '../utils/logger';
import { onGameMutation } from '../socket/gameMutationNotifier';
import { safeEmitToPlayers, safeEmitToRoom } from '../socket/safeEmit';
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
import type { GameActor } from '../socket/handlers/gameActions';

/** Per-room de-dupe key for the last advisor suggestion emitted (avoids
 *  re-emitting identical suggestions on every unrelated mutation). */
const suggestionKeys = new Map<string, string>();

/**
 * Per-room clue-debt tracker (Phase 4.3): reconstructs promised-vs-taken per
 * clue from successive game snapshots, so bot clickers get the same
 * within-game memory the harness threads. Ticks fire on every game mutation,
 * so each clue transition is observed promptly; the memory is a tie-breaker
 * boost, so a rare coalesced-race misattribution is acceptable by design.
 */
interface RoomClueTracker {
    /** Identifies the game the memory belongs to (reset on a new game). */
    gameKey: string;
    /** The clue currently being guessed, with the board as it stood when the
     *  clue arrived (finalized by diffing reveals when the clue changes). */
    live: { team: Team; word: string; number: number; revealedSnapshot: readonly boolean[] } | null;
    clues: { red: ClueMemoryEntry[]; blue: ClueMemoryEntry[] };
}
const clueMemory = new Map<string, RoomClueTracker>();

/**
 * Leak guard for the long-lived per-room maps: a room that dies without a
 * final tick (TTL expiry, abandonment mid-game) never hits the gameOver
 * cleanup path, so on a long-running server these maps would only grow.
 * Order is kept LRU by delete-before-set at every write site (clueMemory,
 * suggestionKeys, failureStreak), so the oldest key here is the least
 * recently touched; evicting an active room is harmless — its tracker just
 * rebuilds from the next snapshot (the memory is a tie-breaker boost, not
 * authoritative state).
 */
const MAX_TRACKED_ROOMS = 500;
/** Per-team clue-entry cap within one game (a real game gives far fewer). */
const MAX_CLUES_PER_TEAM = 64;
function evictOldestBeyondCap(map: Map<string, unknown>): void {
    while (map.size > MAX_TRACKED_ROOMS) {
        const oldest = map.keys().next().value;
        if (oldest === undefined) break;
        map.delete(oldest);
    }
}

/** Advance a room's clue-debt tracker to the given game snapshot. Classic
 *  and match only — a duet reveal's classification follows the side-A key,
 *  so the memory stays empty there (mirrors the harness). Exported for
 *  tests; state is cleared by stopBotController. */
export function reconcileClueMemory(roomCode: string, game: GameState): RoomClueTracker {
    const gameKey = String(game.seed ?? roomCode);
    let tracker = clueMemory.get(roomCode);
    if (!tracker || tracker.gameKey !== gameKey) {
        tracker = { gameKey, live: null, clues: { red: [], blue: [] } };
    } else {
        // Refresh recency (delete + set keeps Map insertion order LRU-ish).
        clueMemory.delete(roomCode);
    }
    clueMemory.set(roomCode, tracker);
    evictOldestBeyondCap(clueMemory);
    if (game.gameMode === 'duet') return tracker;
    const live = game.currentClue;
    if (
        tracker.live &&
        (!live ||
            live.word !== tracker.live.word ||
            live.team !== tracker.live.team ||
            live.number !== tracker.live.number)
    ) {
        // The tracked clue ended: classify every card revealed since it
        // arrived (types[] is unmasked server-side).
        let taken = 0;
        let bounced = false;
        for (let i = 0; i < game.revealed.length; i++) {
            if (!game.revealed[i] || tracker.live.revealedSnapshot[i]) continue;
            if (game.types[i] === tracker.live.team) taken++;
            else bounced = true;
        }
        const entries = tracker.clues[tracker.live.team];
        entries.push({
            word: tracker.live.word,
            number: tracker.live.number,
            taken,
            bounced,
        });
        // A stalled game ping-ponging clues must not grow the memory without
        // bound; recent debt is what matters, so the oldest entries yield.
        if (entries.length > MAX_CLUES_PER_TEAM) entries.splice(0, entries.length - MAX_CLUES_PER_TEAM);
        tracker.live = null;
    }
    if (live && !tracker.live) {
        tracker.live = {
            team: live.team,
            word: live.word,
            number: live.number,
            revealedSnapshot: [...game.revealed],
        };
    }
    return tracker;
}

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

/**
 * Force-end the stuck team's turn and tell the room why, once a room has
 * exhausted its re-arm budget. Ticking is driven only by game mutations and
 * it's the stalled bot's own turn, so without this the turn indicator never
 * advances and no other player can produce a mutation to unstick it — a
 * deterministic strategy failure in a timer-less room would otherwise brick
 * the game silently (docs/HARDENING_PLAN.md P1-6).
 */
async function giveUpAndForceEndTurn(roomCode: string, lastActor: GameActor | null): Promise<void> {
    logger.error(
        `botController giving up on ${roomCode} after ${MAX_REARM_ATTEMPTS} consecutive action failures — forcing the stuck turn to end`
    );
    const io = ioRef;
    if (!io) return;
    try {
        const game = await gameService.getGame(roomCode);
        if (!game || game.gameOver || game.paused) return; // nothing left to force-end
        const team = game.currentTurn;
        // Prefer the nickname of the bot whose action actually failed, but the
        // team is what matters for the endTurn guard — fall back to a generic
        // identity if the last failure happened before an actor was resolved
        // (e.g. a getGame/getTeamMembers read failure) or belongs to the other team.
        const actor: GameActor =
            lastActor && lastActor.team === team ? lastActor : { sessionId: 'system', nickname: 'Bot', team };
        await applyEndTurn(io, roomCode, actor);
        safeEmitToRoom(io, roomCode, SOCKET_EVENTS.ROOM_WARNING, {
            code: 'BOT_STALLED',
            message: `A bot on the ${team} team couldn't complete its turn after ${MAX_REARM_ATTEMPTS} attempts, so its turn was ended automatically.`,
            team,
        });
    } catch (err) {
        logger.error(`botController force-end-turn for ${roomCode} also failed: ${(err as Error).message}`);
    }
}

/** Schedule a bounded, backed-off retry of a room that failed mid-cascade. */
async function scheduleReArm(roomCode: string, lastActor: GameActor | null): Promise<void> {
    const streak = (failureStreak.get(roomCode) ?? 0) + 1;
    // Delete-before-set refreshes recency (Map keeps first-insertion order, so
    // a bare re-set would leave an actively-failing room as the OLDEST entry —
    // then the leak-guard eviction would drop it first and RESET its streak,
    // letting a deterministically-failing action evade MAX_REARM_ATTEMPTS
    // forever (correctness-review finding). Refreshed, the failing room stays
    // at the tail and the give-up cap governs it, not eviction.
    failureStreak.delete(roomCode);
    failureStreak.set(roomCode, streak);
    // Leak guard: a room that dies mid-backoff (or after giving up) never gets
    // a success/clean-stop to clear its streak.
    evictOldestBeyondCap(failureStreak);
    if (streak > MAX_REARM_ATTEMPTS) {
        // Reset so a fresh failure streak (e.g. next turn also stalls) gets its
        // own full retry budget instead of giving up immediately again.
        clearReArm(roomCode);
        await giveUpAndForceEndTurn(roomCode, lastActor);
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
    clueMemory.clear();
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
    // Public own-remaining count for the late-stretch warning (types[] is
    // unmasked server-side; the count itself is public via the room score,
    // so no key information reaches the advisor payload). In Duet, blue's own
    // greens live only in duetTypes — mirrors the same branch playOneAction.ts
    // uses for the spymaster view, or a blue-side advisor always sees 0 own
    // cards remaining and trips the late-stretch warning from turn one.
    const ownTypes =
        (game.gameMode as GameMode) === 'duet' && team === 'blue' ? (game.duetTypes ?? game.types) : game.types;
    let ownRemaining = 0;
    for (let i = 0; i < ownTypes.length; i++) {
        if (ownTypes[i] === team && !game.revealed[i]) ownRemaining++;
    }
    const suggestions = suggestGuesses(view, getSemanticBackend(), 3, skill, makeRng(seed), { ownRemaining });
    if (suggestions.length === 0) return;

    // Delete-before-set: refresh recency so the most active advisor rooms
    // aren't evicted first (which would re-emit duplicate suggestions to them).
    suggestionKeys.delete(roomCode);
    suggestionKeys.set(roomCode, key);
    evictOldestBeyondCap(suggestionKeys);
    // Scoped to this team's own members only (not safeEmitToRoom) — these are
    // suggestions for the acting team's own clicker, and broadcasting them
    // room-wide would let the opposing team (and spectators) preview which
    // cards the advisor considers top picks for a clue that's still live. See
    // docs/HARDENING_PLAN.md P0-5.
    safeEmitToPlayers(io, members, SOCKET_EVENTS.GAME_BOT_SUGGESTION, {
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
    // The actor whose action most recently failed (or was attempted), so that if
    // the room eventually gives up, the forced endTurn can be attributed to the
    // right team/nickname instead of a bare fallback.
    let lastActor: GameActor | null = null;
    try {
        // Sequential by design: each bot action mutates shared game state under
        // the reveal lock and must complete before the next is computed.
        /* eslint-disable no-await-in-loop */
        for (let i = 0; i < MAX_ACTIONS_PER_TICK; i++) {
            const game = await gameService.getGame(roomCode);
            if (!game || game.gameOver || game.paused) {
                suggestionKeys.delete(roomCode);
                if (!game || game.gameOver) clueMemory.delete(roomCode);
                break;
            }
            // Keep the clue-debt memory current with every observed snapshot.
            const memoryTracker = reconcileClueMemory(roomCode, game);

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
            const ctx = {
                gameMode: (game.gameMode as GameMode) ?? 'classic',
                skill,
                rng: makeRng(seed),
                // Shallow copy: the snapshot handed to a strategy must stay
                // immutable even if a strategy misbehaves — the tracker is
                // shared room state.
                memory: { clues: [...memoryTracker.clues[team]] },
            };

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
            lastActor = actor;
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
        await scheduleReArm(roomCode, lastActor);
    } else {
        // Clean stop: nothing more for a bot to do right now. Drop any backoff.
        clearReArm(roomCode);
    }
}
