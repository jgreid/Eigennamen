// ========== STATE MUTATIONS ==========
// Validated mutation functions for corruption-prone state properties.
// Centralizes team/role/game-mode validation to prevent invalid values
// from sneaking into the shared state singleton.
import { state } from './state.js';
import { logger } from './logger.js';
const VALID_TEAMS = new Set(['red', 'blue']);
const VALID_ROLES = new Set(['spymaster', 'clicker', 'spectator']);
const VALID_GAME_MODES = new Set(['classic', 'blitz', 'duet']);
export function isValidTeam(value) {
    return typeof value === 'string' && VALID_TEAMS.has(value);
}
export function isValidRole(value) {
    return typeof value === 'string' && VALID_ROLES.has(value);
}
export function isValidGameMode(value) {
    return typeof value === 'string' && VALID_GAME_MODES.has(value);
}
// ---- Atomic setters ----
/**
 * Set the player's role and team atomically.
 * Ensures spymasterTeam, clickerTeam, and playerTeam are always consistent.
 * Invalid team/role values are normalized (team→null, role→spectator).
 */
export function setPlayerRole(role, team) {
    const validatedTeam = isValidTeam(team) ? team : null;
    state.playerTeam = validatedTeam;
    if (role === 'spymaster' && validatedTeam) {
        state.spymasterTeam = validatedTeam;
        state.clickerTeam = null;
    }
    else if (role === 'clicker' && validatedTeam) {
        state.clickerTeam = validatedTeam;
        state.spymasterTeam = null;
    }
    else {
        state.spymasterTeam = null;
        state.clickerTeam = null;
    }
}
/**
 * Clear all player role state to defaults.
 */
export function clearPlayerRole() {
    state.playerTeam = null;
    state.spymasterTeam = null;
    state.clickerTeam = null;
}
/**
 * Reset game state fields that become stale when leaving multiplayer.
 * Prevents old board data from persisting across room changes.
 */
export function resetGameState() {
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
    state.gameMode = 'classic';
}
/**
 * Validate a currentTurn value from server data.
 * Returns the value if valid ('red'|'blue'), or the fallback.
 */
export function validateTurn(value, fallback = 'red') {
    return isValidTeam(value) ? value : fallback;
}
/**
 * Validate a winner value from server data.
 * Returns the value if valid ('red'|'blue'|null), or null.
 */
export function validateWinner(value) {
    if (value === null || value === undefined)
        return null;
    return isValidTeam(value) ? value : null;
}
/**
 * Validate a gameMode value from server data.
 * Returns the value if valid, or 'classic'.
 */
export function validateGameMode(value) {
    return isValidGameMode(value) ? value : 'classic';
}
/**
 * Validate that an array has the expected length.
 * Logs a warning and returns false if mismatched.
 */
export function validateArrayLength(name, arr, expectedLength) {
    if (!arr || !Array.isArray(arr))
        return false;
    if (arr.length !== expectedLength) {
        logger.warn(`${name} array length mismatch: got ${arr.length}, expected ${expectedLength}`);
        return false;
    }
    return true;
}
//# sourceMappingURL=stateMutations.js.map