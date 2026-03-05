/**
 * Game state actions — centralized mutations for game lifecycle.
 *
 * Each action uses batch() for multi-property updates so subscribers
 * see a single coherent state transition instead of intermediate states.
 */

import { state } from '../../state.js';
import { batch } from '../batch.js';
import { validateTurn, validateWinner, validateGameMode, validateArrayLength } from '../../stateMutations.js';
import { logger } from '../../logger.js';
import type { ClueData } from '../../multiplayerTypes.js';

/**
 * Reset all game state fields to defaults.
 * Called when leaving multiplayer or starting fresh.
 */
export function resetGame(): void {
    batch(() => {
        state.gameState.words = [];
        state.gameState.types = [];
        state.gameState.revealed = [];
        state.gameState.currentTurn = 'red';
        state.gameState.redScore = 0;
        state.gameState.blueScore = 0;
        state.gameState.redTotal = 9;
        state.gameState.blueTotal = 8;
        state.gameState.gameOver = false;
        state.gameState.winner = null;
        state.gameState.seed = null;
        state.gameState.currentClue = null;
        state.gameState.guessesUsed = 0;
        state.gameState.guessesAllowed = 0;
        state.gameState.status = 'waiting';
        state.gameState.duetTypes = [];
        state.gameState.timerTokens = 0;
        state.gameState.greenFound = 0;
        state.gameState.greenTotal = 0;
        state.gameMode = 'match';
    });
}

/**
 * Set game over state with a validated winner.
 */
export function setGameOver(winner: string | null): void {
    batch(() => {
        state.gameState.gameOver = true;
        state.gameState.winner = validateWinner(winner);
    });
}

/**
 * Update scores from server-provided values with range validation.
 */
export function syncScores(data: {
    redScore?: number;
    blueScore?: number;
    redTotal?: number;
    blueTotal?: number;
}): void {
    const MAX_BOARD_SIZE = 100;
    batch(() => {
        if (typeof data.redScore === 'number' && data.redScore >= 0 && data.redScore <= MAX_BOARD_SIZE) {
            state.gameState.redScore = data.redScore;
        }
        if (typeof data.blueScore === 'number' && data.blueScore >= 0 && data.blueScore <= MAX_BOARD_SIZE) {
            state.gameState.blueScore = data.blueScore;
        }
        if (typeof data.redTotal === 'number' && data.redTotal >= 0 && data.redTotal <= MAX_BOARD_SIZE) {
            state.gameState.redTotal = data.redTotal;
        }
        if (typeof data.blueTotal === 'number' && data.blueTotal >= 0 && data.blueTotal <= MAX_BOARD_SIZE) {
            state.gameState.blueTotal = data.blueTotal;
        }
    });
}

/**
 * Sync board data (words, types, revealed) from server.
 * Returns true if the words changed (indicating a new game).
 */
export function syncBoardData(serverGame: { words?: string[]; types?: string[]; revealed?: boolean[] }): boolean {
    if (!serverGame.words || !Array.isArray(serverGame.words)) return false;

    const MAX_BOARD_SIZE = 100;
    const wordCount = serverGame.words.length;
    if (wordCount > MAX_BOARD_SIZE) {
        logger.error(`syncBoardData: rejected oversized words array (${wordCount})`);
        return false;
    }

    const wordsChanged =
        !state.gameState.words ||
        state.gameState.words.length !== wordCount ||
        state.gameState.words.some((w: string, i: number) => w !== serverGame.words![i]);

    batch(() => {
        if (wordsChanged) {
            state.boardInitialized = false;
            state.revealTimeouts.forEach((timeoutId) => clearTimeout(timeoutId));
            state.revealTimeouts.clear();
            state.revealingCards.clear();
            state.revealTimestamps.clear();
            state.isRevealingCard = false;
        }

        state.gameState.words = serverGame.words!;

        const types = serverGame.types || [];
        const revealed = serverGame.revealed || [];
        if (types.length > 0 && !validateArrayLength('types', types, wordCount)) {
            state.gameState.types = new Array(wordCount).fill(null);
        } else {
            state.gameState.types = types;
        }
        if (revealed.length > 0 && !validateArrayLength('revealed', revealed, wordCount)) {
            state.gameState.revealed = new Array(wordCount).fill(false);
        } else {
            state.gameState.revealed = revealed;
        }
    });

    return wordsChanged;
}

/**
 * Sync turn, game-over, clue, guess, and duet state from server.
 */
export function syncTurnAndMetadata(serverGame: {
    currentTurn?: string;
    gameOver?: boolean;
    winner?: string | null;
    seed?: string | number | null;
    currentClue?: ClueData | null;
    guessesUsed?: number;
    guessesAllowed?: number;
    duetTypes?: string[];
    timerTokens?: number;
    greenFound?: number;
    greenTotal?: number;
    gameMode?: string;
}): void {
    batch(() => {
        if (serverGame.currentTurn) {
            state.gameState.currentTurn = validateTurn(serverGame.currentTurn, state.gameState.currentTurn);
        }

        if (serverGame.gameOver || serverGame.winner) {
            state.gameState.gameOver = true;
            state.gameState.winner = validateWinner(serverGame.winner);
        } else {
            state.gameState.gameOver = false;
            state.gameState.winner = null;
        }

        if (serverGame.seed) {
            state.gameState.seed = serverGame.seed;
        }
        if (serverGame.currentClue !== undefined) {
            state.gameState.currentClue = serverGame.currentClue || null;
        }
        if (typeof serverGame.guessesUsed === 'number') {
            state.gameState.guessesUsed = serverGame.guessesUsed;
        }
        if (typeof serverGame.guessesAllowed === 'number') {
            state.gameState.guessesAllowed = serverGame.guessesAllowed;
        }

        // Duet mode fields
        if (serverGame.duetTypes) {
            state.gameState.duetTypes = serverGame.duetTypes;
        }
        if (typeof serverGame.timerTokens === 'number') {
            state.gameState.timerTokens = serverGame.timerTokens;
        }
        if (typeof serverGame.greenFound === 'number') {
            state.gameState.greenFound = serverGame.greenFound;
        }
        if (typeof serverGame.greenTotal === 'number') {
            state.gameState.greenTotal = serverGame.greenTotal;
        }
        if (serverGame.gameMode) {
            state.gameMode = validateGameMode(serverGame.gameMode);
        }
    });
}

/**
 * Clear all card reveal tracking state.
 */
export function clearRevealTracking(): void {
    state.revealTimeouts.forEach((timeoutId) => clearTimeout(timeoutId));
    state.revealTimeouts.clear();
    state.revealingCards.clear();
    state.revealTimestamps.clear();
    state.isRevealingCard = false;
}
