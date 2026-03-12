import type { GameDataInput, ValidationResult } from './types';

import { BOARD_SIZE } from '../../shared';

/**
 * Count clues from game history based on turn starts.
 * Every new turn starts with a clue (given verbally). We count turns by
 * tracking when the active team changes — each change represents a new
 * turn (and thus a new clue).
 *
 * If explicit `clue` entries exist in the history, we count those directly
 * as the authoritative source.
 */
export function countCluesFromHistory(history: unknown[] | null | undefined): number {
    if (!history || !Array.isArray(history) || history.length === 0) return 0;

    // If explicit clue entries exist, count those directly
    const clueEntries = history.filter((e) => (e as Record<string, unknown>).action === 'clue');
    if (clueEntries.length > 0) return clueEntries.length;

    // Otherwise, count turn starts by tracking team changes across all actions
    let turnCount = 0;
    let currentTeam: string | null = null;

    for (const entry of history) {
        const e = entry as Record<string, unknown>;
        if (e.action === 'reveal' && typeof e.team === 'string') {
            if (e.team !== currentTeam) {
                turnCount++;
                currentTeam = e.team;
            }
        } else if (e.action === 'endTurn' && typeof e.toTeam === 'string') {
            // endTurn switches to a new team — only count if we haven't
            // already counted this team from a subsequent reveal
            if (e.toTeam !== currentTeam) {
                turnCount++;
                currentTeam = e.toTeam;
            }
        }
    }

    return turnCount;
}

/**
 * Validate game data structure before saving to history
 * Prevents corrupted or malformed data from being saved
 */
export function validateGameData(gameData: GameDataInput | null | undefined): ValidationResult {
    const errors: string[] = [];

    // Check required fields exist
    if (!gameData) {
        return { valid: false, errors: ['Game data is null or undefined'] };
    }

    // Validate words array
    if (!Array.isArray(gameData.words)) {
        errors.push('words must be an array');
    } else if (gameData.words.length !== BOARD_SIZE) {
        errors.push(`words array must have ${BOARD_SIZE} elements, got ${gameData.words.length}`);
    } else if (!gameData.words.every((w) => typeof w === 'string' && w.length > 0)) {
        errors.push('All words must be non-empty strings');
    }

    // Validate types array
    if (!Array.isArray(gameData.types)) {
        errors.push('types must be an array');
    } else if (gameData.types.length !== BOARD_SIZE) {
        errors.push(`types array must have ${BOARD_SIZE} elements, got ${gameData.types.length}`);
    } else {
        const validTypes = ['red', 'blue', 'neutral', 'assassin'];
        const invalidTypes = gameData.types.filter((t) => !validTypes.includes(t));
        if (invalidTypes.length > 0) {
            errors.push(`Invalid card types found: ${invalidTypes.join(', ')}`);
        }
    }

    // Validate seed
    if (typeof gameData.seed !== 'string' || gameData.seed.length === 0) {
        errors.push('seed must be a non-empty string');
    }

    // Validate scores are non-negative integers
    if (typeof gameData.redScore !== 'number' || !Number.isInteger(gameData.redScore) || gameData.redScore < 0) {
        errors.push('redScore must be a non-negative integer');
    }
    if (typeof gameData.blueScore !== 'number' || !Number.isInteger(gameData.blueScore) || gameData.blueScore < 0) {
        errors.push('blueScore must be a non-negative integer');
    }

    // Validate totals
    if (typeof gameData.redTotal !== 'number' || !Number.isInteger(gameData.redTotal) || gameData.redTotal < 0) {
        errors.push('redTotal must be a non-negative integer');
    }
    if (typeof gameData.blueTotal !== 'number' || !Number.isInteger(gameData.blueTotal) || gameData.blueTotal < 0) {
        errors.push('blueTotal must be a non-negative integer');
    }

    // Validate winner if game is over
    if (gameData.gameOver) {
        if (gameData.winner !== 'red' && gameData.winner !== 'blue') {
            errors.push('winner must be "red" or "blue" when game is over');
        }
    }

    // Validate history array if present
    if (gameData.history !== undefined && !Array.isArray(gameData.history)) {
        errors.push('history must be an array if provided');
    }

    // Validate clues array if present
    if (gameData.clues !== undefined && !Array.isArray(gameData.clues)) {
        errors.push('clues must be an array if provided');
    }

    return { valid: errors.length === 0, errors };
}
