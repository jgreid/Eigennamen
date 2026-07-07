/**
 * Run one bot-vs-bot game on the pure engine via the shared playOneAction
 * chokepoint. Deterministic given (seed, entrants).
 */
import type { Player, Team, Role, GameMode, GameState, RevealResult } from '../../types';
import type { Entrant, MatchResult, SeatSpec } from './types';

import { hashString } from '../../services/game/boardGenerator';
import { resolveClicker, resolveSpymaster } from '../strategies/registry';
import { resolveSkill } from '../presets';
import { makeRng } from '../rng';
import { playOneAction } from '../playOneAction';
import type { ClueMemoryEntry, SkillParams, SpymasterStrategy, ClickerStrategy } from '../strategies/types';
import { createEngineGame, applyEngineClue, applyEngineReveal, applyEngineEndTurn } from '../engine';

/**
 * A move as it happened, emitted to an optional observer so the diagnostics
 * harness can reconstruct per-clue outcomes without duplicating the game loop.
 * The `game` handed to the callback is the live state right AFTER the move is
 * applied (do not mutate it).
 */
export type GameEvent =
    | { kind: 'clue'; team: Team; word: string; number: number }
    | { kind: 'reveal'; team: Team; index: number; result: RevealResult }
    | { kind: 'endTurn'; team: Team };

export interface PlayGameOptions {
    seed: string;
    /** Seed for board generation only (words + key layout). Defaults to `seed`.
     *  Letting callers split the two means a tournament can hold the BOARD
     *  constant across entrant pairings (fair difficulty comparison) while each
     *  pairing still gets its own decision randomness via `seed`. */
    boardSeed?: string;
    gameMode: GameMode;
    red: Entrant;
    blue: Entrant;
    words?: string[];
    /** Safety bound on total actions (a real game uses far fewer). */
    maxActions?: number;
    /** Optional instrumentation hook — invoked after each applied move. */
    onEvent?: (ev: GameEvent, game: GameState) => void;
}

interface SeatBinding {
    seat: Player;
    skill: SkillParams;
    spymaster?: SpymasterStrategy;
    clicker?: ClickerStrategy;
}

function makeSeat(team: Team, role: Role): Player {
    return {
        sessionId: `${team}-${role}`,
        roomCode: 'engine',
        nickname: `${team}-${role}`,
        team,
        role,
        isHost: false,
        connected: true,
        isBot: true,
        lastSeen: 0,
    };
}

function bindSeat(team: Team, role: 'spymaster' | 'clicker', spec: SeatSpec, baseSeed: string): SeatBinding {
    const skill = resolveSkill(spec.skillPreset, hashString(`${baseSeed}:${team}:${role}:${spec.strategyId}`));
    const binding: SeatBinding = { seat: makeSeat(team, role), skill };
    if (role === 'spymaster') binding.spymaster = resolveSpymaster(spec.strategyId, skill);
    else binding.clicker = resolveClicker(spec.strategyId, skill);
    return binding;
}

export function playEngineGame(opts: PlayGameOptions): MatchResult {
    const { seed, gameMode, red, blue } = opts;
    const game = createEngineGame({ seed: opts.boardSeed ?? seed, gameMode, words: opts.words });

    const bindings: Record<string, SeatBinding> = {
        'red:spymaster': bindSeat('red', 'spymaster', red.spymaster, seed),
        'red:clicker': bindSeat('red', 'clicker', red.clicker, seed),
        'blue:spymaster': bindSeat('blue', 'spymaster', blue.spymaster, seed),
        'blue:clicker': bindSeat('blue', 'clicker', blue.clicker, seed),
    };

    let clues = 0;
    let reveals = 0;
    let turns = 0;
    let endReason: string | null = null;
    let assassinBy: Team | null = null;
    const maxActions = opts.maxActions ?? 2000;

    // Within-game clue-debt memory (Phase 4.3), threaded per team as data so
    // strategies stay pure. The live clue is tracked separately and only
    // committed to memory once it ends (new clue / end of turn). Classic and
    // match only: a duet reveal's reported type follows the side-A key, so
    // own-vs-miss classification is unreliable there — the memory stays empty
    // (same reasoning as the clicker's duet-disabled cliff estimate).
    const trackMemory = gameMode !== 'duet';
    const memory: Record<'red' | 'blue', ClueMemoryEntry[]> = { red: [], blue: [] };
    let liveClue: { team: Team; word: string; number: number; taken: number; bounced: boolean } | null = null;
    const finalizeClue = (): void => {
        if (!liveClue) return;
        if (liveClue.team === 'red' || liveClue.team === 'blue') {
            memory[liveClue.team].push({
                word: liveClue.word,
                number: liveClue.number,
                taken: liveClue.taken,
                bounced: liveClue.bounced,
            });
        }
        liveClue = null;
    };

    for (let i = 0; i < maxActions && !game.gameOver; i++) {
        const team = game.currentTurn;
        const role: 'spymaster' | 'clicker' = game.currentClue ? 'clicker' : 'spymaster';
        const binding = bindings[`${team}:${role}`] as SeatBinding;

        const decisionSeed = hashString(`${seed}:${team}:${role}:${game.stateVersion ?? 0}`);
        const teamMemory = memory[team === 'red' ? 'red' : 'blue'];
        const ctx = { gameMode, skill: binding.skill, rng: makeRng(decisionSeed), memory: { clues: teamMemory } };
        const strategy = role === 'spymaster' ? binding.spymaster : binding.clicker;
        if (!strategy) break; // bound at construction; guard satisfies the type narrowing

        const action = playOneAction(game, binding.seat, strategy, ctx);
        if (action.kind === 'clue') {
            finalizeClue();
            applyEngineClue(game, team, action.word, action.number);
            if (trackMemory) {
                liveClue = { team, word: action.word, number: action.number, taken: 0, bounced: false };
            }
            clues++;
            opts.onEvent?.({ kind: 'clue', team, word: action.word, number: action.number }, game);
        } else if (action.kind === 'reveal') {
            const result = applyEngineReveal(game, action.index);
            if (liveClue) {
                if (result.type === liveClue.team) liveClue.taken++;
                else liveClue.bounced = true;
            }
            endReason = result.endReason ?? endReason;
            if (result.endReason === 'assassin') assassinBy = team;
            reveals++;
            opts.onEvent?.({ kind: 'reveal', team, index: action.index, result }, game);
        } else if (action.kind === 'endTurn') {
            finalizeClue();
            applyEngineEndTurn(game);
            turns++;
            opts.onEvent?.({ kind: 'endTurn', team }, game);
        } else {
            break; // noop — should not happen with role-correct strategies
        }
    }

    const result: MatchResult = {
        seed,
        gameMode,
        redEntrant: red.id,
        blueEntrant: blue.id,
        winner: game.winner,
        redScore: game.redScore,
        blueScore: game.blueScore,
        redTotal: game.redTotal,
        blueTotal: game.blueTotal,
        turns,
        clues,
        reveals,
        assassinHit: endReason === 'assassin',
        assassinBy,
        endReason,
    };
    if (gameMode === 'duet') {
        result.greenFound = game.greenFound;
        result.greenTotal = game.greenTotal;
        result.timerTokens = game.timerTokens;
    }
    return result;
}
