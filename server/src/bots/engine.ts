/**
 * Pure, in-memory game engine for headless self-play.
 *
 * It reuses the EXISTING pure rule functions in services/game/revealEngine
 * (the same logic the production Lua scripts mirror) plus boardGenerator, so the
 * engine and the live server share one rule implementation. No Redis, no
 * sockets, fully deterministic given a seed — suitable for running thousands of
 * games per second in the training harness.
 *
 * The match-mode score accumulation that lives only in revealCard.lua (not in
 * executeCardReveal) is reproduced here so match games score correctly; the
 * parity script (npm run bots:parity) cross-checks the engine against the real
 * Lua path over many seeds.
 */
import type { GameState, Team, RevealResult, ClueResult, EndTurnResult, GameMode } from '../types';

import { BOARD_SIZE, DUET_BOARD_CONFIG, GAME_HISTORY } from '../config/constants';
import { DEFAULT_WORDS, CLUE_NUMBER_MAX, CLUE_NUMBER_UNLIMITED } from '../shared/gameRules';
import { hashString, generateBoardLayout, selectBoardWords, generateCardScores } from '../services/game/boardGenerator';
import {
    validateCardIndex,
    validateRevealPreconditions,
    executeCardReveal,
    determineRevealOutcome,
    buildRevealResult,
    switchTurn,
} from '../services/game/revealEngine';

export interface CreateEngineGameOptions {
    /** Deterministic seed string (board + scores derive from it). */
    seed: string;
    gameMode: GameMode;
    /** Word pool to draw the 25 board words from (defaults to the standard set). */
    words?: string[];
}

/** Build a fresh, deterministic GameState (mirrors gameService.buildGameState). */
export function createEngineGame(opts: CreateEngineGameOptions): GameState {
    const { seed, gameMode } = opts;
    const numericSeed = hashString(seed);
    const isDuet = gameMode === 'duet';
    const isMatch = gameMode === 'match';

    const layout = generateBoardLayout(numericSeed, isDuet);
    const words = selectBoardWords(opts.words ?? [...DEFAULT_WORDS], numericSeed);

    const game: GameState = {
        id: `engine-${seed}`,
        seed,
        wordListId: null,
        words,
        types: layout.types,
        revealed: Array(BOARD_SIZE).fill(false),
        currentTurn: layout.firstTeam,
        redScore: 0,
        blueScore: 0,
        redTotal: layout.redTotal,
        blueTotal: layout.blueTotal,
        gameOver: false,
        winner: null,
        currentClue: null,
        guessesUsed: 0,
        guessesAllowed: 0,
        clues: [],
        history: [],
        stateVersion: 1,
        createdAt: 0,
        gameMode,
    };

    if (isDuet) {
        game.duetTypes = layout.duetTypes;
        game.timerTokens = DUET_BOARD_CONFIG.timerTokens;
        game.greenFound = 0;
        game.greenTotal = DUET_BOARD_CONFIG.greenTotal;
    }

    if (isMatch) {
        game.cardScores = generateCardScores(numericSeed, layout.types).cardScores;
        game.revealedBy = Array(BOARD_SIZE).fill(null);
        game.matchRound = 1;
        game.redMatchScore = 0;
        game.blueMatchScore = 0;
        game.roundHistory = [];
        game.firstTeamHistory = [layout.firstTeam];
        game.matchOver = false;
        game.matchWinner = null;
    }

    return game;
}

/** Codenames clue → guess budget: N grants N+1 guesses; 0 (anti-clue) and
 *  -1 (unlimited "U") both map to the guessesAllowed=0 unlimited sentinel. */
function guessesForClue(n: number): number {
    return n >= 1 ? n + 1 : 0;
}

/**
 * Clamp a clue number to [CLUE_NUMBER_UNLIMITED, CLUE_NUMBER_MAX] the exact way
 * submitClue.lua does (nil → 0, below -1 → -1, above the cap → the cap).
 * gameService.submitClue already rejects out-of-range numbers before Lua runs,
 * so this is the same last-resort defense-in-depth for a direct engine caller
 * (or a future strategy emitting a float or 10+). Kept in lockstep so the
 * parity harness stays green. (N23)
 */
function clampClueNumber(n: number): number {
    if (!Number.isFinite(n)) return 0;
    const truncated = Math.trunc(n);
    if (truncated < CLUE_NUMBER_UNLIMITED) return CLUE_NUMBER_UNLIMITED;
    return truncated > CLUE_NUMBER_MAX ? CLUE_NUMBER_MAX : truncated;
}

/**
 * Cap game.history to MAX_HISTORY_ENTRIES, keeping the most recent entries —
 * mirrors the identical trim tail every Lua game op (submitClue/revealCard/
 * endTurn) applies. Without it the engine's history grows unbounded and drifts
 * from production once a long game crosses the cap. (N23)
 */
function capHistory(game: GameState): void {
    const max = GAME_HISTORY.MAX_ENTRIES;
    if (game.history && game.history.length > max) {
        game.history = game.history.slice(-max);
    }
}

/** Apply a spymaster clue (mirrors submitClue.lua). Mutates `game`. */
export function applyEngineClue(
    game: GameState,
    team: Team,
    word: string,
    clueNumber: number,
    spymaster = 'bot'
): ClueResult {
    // Clamp exactly as submitClue.lua does, and store the CLAMPED number in
    // currentClue / clues / history so the engine and Lua agree on what was
    // recorded (not just on the guess budget). (N23)
    const number = clampClueNumber(clueNumber);
    const guessesAllowed = guessesForClue(number);
    const clue = { team, word, number, spymaster, timestamp: 0 };
    game.currentClue = clue;
    game.guessesUsed = 0;
    game.guessesAllowed = guessesAllowed;
    (game.clues = game.clues || []).push(clue);
    (game.history = game.history || []).push({
        action: 'clue',
        team,
        word,
        number,
        guessesAllowed,
        spymaster,
        timestamp: 0,
    });
    capHistory(game);
    game.stateVersion = (game.stateVersion ?? 0) + 1;
    return { word, number, team, guessesAllowed };
}

/** Reveal a card (mirrors revealCard.lua). Mutates `game`. */
export function applyEngineReveal(game: GameState, index: number): RevealResult {
    validateCardIndex(index);
    validateRevealPreconditions(game, index);

    const revealingTeam = game.currentTurn;
    const type = executeCardReveal(game, index);

    // Capture this reveal's ordinal now: executeCardReveal has just incremented
    // guessesUsed, but determineRevealOutcome below resets it to 0 on a turn
    // switch. Reading it post-outcome recorded every turn-ending reveal as
    // guessNumber 0 — the engine mirror of the revealCard.lua bug (N6).
    const guessNumber = game.guessesUsed ?? 0;

    // Match-mode score accumulation (only in Lua/here, not in executeCardReveal).
    if (game.gameMode === 'match' && game.cardScores) {
        const cs = game.cardScores[index] ?? 0;
        if (cs !== 0) {
            if (revealingTeam === 'red') game.redMatchScore = (game.redMatchScore ?? 0) + cs;
            else game.blueMatchScore = (game.blueMatchScore ?? 0) + cs;
        }
    }

    const outcome = determineRevealOutcome(game, type, revealingTeam);

    (game.history = game.history || []).push({
        action: 'reveal',
        index,
        word: game.words[index] as string,
        type,
        team: revealingTeam,
        player: 'bot',
        guessNumber,
        timestamp: 0,
    });
    capHistory(game);
    game.stateVersion = (game.stateVersion ?? 0) + 1;

    return buildRevealResult(game, index, type, outcome);
}

/** End the current turn (mirrors endTurn.lua). Mutates `game`. */
export function applyEngineEndTurn(game: GameState): EndTurnResult {
    const previousTurn = game.currentTurn;
    switchTurn(game);
    (game.history = game.history || []).push({
        action: 'endTurn',
        fromTeam: previousTurn,
        toTeam: game.currentTurn,
        player: 'bot',
        timestamp: 0,
    });
    capHistory(game);
    game.stateVersion = (game.stateVersion ?? 0) + 1;
    return { currentTurn: game.currentTurn, previousTurn };
}
