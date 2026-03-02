import { state } from './state.js';
import { logger } from './logger.js';

// ---- Type guards ----

export type ValidTeam = 'red' | 'blue';
export type ValidRole = 'spymaster' | 'clicker' | 'spectator';
export type ValidGameMode = 'classic' | 'duet' | 'match';

const VALID_TEAMS = new Set<string>(['red', 'blue']);
const VALID_ROLES = new Set<string>(['spymaster', 'clicker', 'spectator']);
const VALID_GAME_MODES = new Set<string>(['classic', 'duet', 'match']);

export function isValidTeam(value: unknown): value is ValidTeam {
    return typeof value === 'string' && VALID_TEAMS.has(value);
}

export function isValidRole(value: unknown): value is ValidRole {
    return typeof value === 'string' && VALID_ROLES.has(value);
}

export function isValidGameMode(value: unknown): value is ValidGameMode {
    return typeof value === 'string' && VALID_GAME_MODES.has(value);
}

// ---- Atomic setters ----

/**
 * Set the player's role and team atomically.
 * Ensures spymasterTeam, clickerTeam, and playerTeam are always consistent.
 * Invalid team/role values are normalized (team→null, role→spectator).
 */
export function setPlayerRole(role: string | null, team: string | null): void {
    const validatedTeam = isValidTeam(team) ? team : null;

    state.playerTeam = validatedTeam;

    if (role === 'spymaster' && validatedTeam) {
        state.spymasterTeam = validatedTeam;
        state.clickerTeam = null;
    } else if (role === 'clicker' && validatedTeam) {
        state.clickerTeam = validatedTeam;
        state.spymasterTeam = null;
    } else {
        state.spymasterTeam = null;
        state.clickerTeam = null;
    }
}

/**
 * Clear all player role state to defaults.
 */
export function clearPlayerRole(): void {
    state.playerTeam = null;
    state.spymasterTeam = null;
    state.clickerTeam = null;
}

/**
 * Reset game state fields that become stale when leaving multiplayer.
 * Prevents old board data from persisting across room changes.
 */
export function resetGameState(): void {
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
    // Match mode
    state.gameState.cardScores = [];
    state.gameState.revealedBy = [];
    state.gameState.matchRound = 0;
    state.gameState.redMatchScore = 0;
    state.gameState.blueMatchScore = 0;
    state.gameState.roundHistory = [];
    state.gameState.matchOver = false;
    state.gameState.matchWinner = null;
    state.gameMode = 'match';
}

/**
 * Validate a currentTurn value from server data.
 * Returns the value if valid ('red'|'blue'), or the fallback.
 */
export function validateTurn(value: unknown, fallback: string = 'red'): string {
    return isValidTeam(value) ? value : fallback;
}

/**
 * Validate a winner value from server data.
 * Returns the value if valid ('red'|'blue'|null), or null.
 */
export function validateWinner(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    return isValidTeam(value) ? value : null;
}

/**
 * Validate a gameMode value from server data.
 * Returns the value if valid, or 'classic'.
 */
export function validateGameMode(value: unknown): ValidGameMode {
    return isValidGameMode(value) ? value : 'classic';
}

/**
 * Validate that an array has the expected length.
 * Logs a warning and returns false if mismatched.
 */
export function validateArrayLength(name: string, arr: unknown[] | undefined, expectedLength: number): boolean {
    if (!arr || !Array.isArray(arr)) return false;
    if (arr.length !== expectedLength) {
        logger.warn(`${name} array length mismatch: got ${arr.length}, expected ${expectedLength}`);
        return false;
    }
    return true;
}
