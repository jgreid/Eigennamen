/**
 * Selectors — derived/computed state from AppState.
 *
 * These replace scattered inline computations across modules with
 * reusable, testable functions. Each selector reads from state and
 * returns a computed value.
 *
 * Usage:
 *   import { isPlayerTurn, isSpymaster } from './store/selectors.js';
 *   if (isPlayerTurn()) { ... }
 */

import { state } from '../state.js';
import type { ServerPlayerData } from '../multiplayerTypes.js';

// ---- Role selectors ----

/**
 * Whether the current player is a spymaster (on any team).
 * Replaces `state.spymasterTeam !== null` / `!!state.spymasterTeam`.
 */
export function isSpymaster(): boolean {
    return state.spymasterTeam !== null;
}

/**
 * Whether the current player is a clicker (on any team).
 * Replaces `!!state.clickerTeam`.
 */
export function isClicker(): boolean {
    return state.clickerTeam !== null;
}

/**
 * Whether the current player has any team assignment.
 */
export function hasTeam(): boolean {
    return state.playerTeam !== null;
}

/**
 * Whether the current player has a specific role (spymaster or clicker).
 */
export function hasRole(): boolean {
    return state.spymasterTeam !== null || state.clickerTeam !== null;
}

// ---- Turn selectors ----

/**
 * Whether it's the current player's turn to act (as clicker).
 * This is the most commonly duplicated check across the codebase.
 * Replaces:
 *   `state.clickerTeam && state.clickerTeam === state.gameState.currentTurn`
 *   `Boolean(state.clickerTeam && state.clickerTeam === state.gameState.currentTurn && !state.gameState.gameOver)`
 */
export function isPlayerTurn(): boolean {
    return Boolean(state.clickerTeam && state.clickerTeam === state.gameState.currentTurn && !state.gameState.gameOver);
}

/**
 * Whether the current player's team is on turn (regardless of role).
 * Replaces `state.playerTeam === state.gameState.currentTurn`.
 */
export function isTeamOnTurn(): boolean {
    return state.playerTeam === state.gameState.currentTurn;
}

// ---- Board/view selectors ----

/**
 * Whether the board should show spymaster hints (card types).
 * True when player is a spymaster or the game is over.
 * Replaces: `state.spymasterTeam || state.gameState.gameOver`
 */
export function showSpymasterView(): boolean {
    return state.spymasterTeam !== null || state.gameState.gameOver;
}

/**
 * Whether a game is currently in progress (has words and not over).
 */
export function gameInProgress(): boolean {
    return state.gameState.words.length > 0 && !state.gameState.gameOver;
}

// ---- Score selectors ----

/**
 * Remaining cards for the red team.
 * Replaces: `state.gameState.redTotal - state.gameState.redScore`
 */
export function redRemaining(): number {
    return state.gameState.redTotal - state.gameState.redScore;
}

/**
 * Remaining cards for the blue team.
 * Replaces: `state.gameState.blueTotal - state.gameState.blueScore`
 */
export function blueRemaining(): number {
    return state.gameState.blueTotal - state.gameState.blueScore;
}

// ---- Team name selectors ----

/**
 * Get the display name of the team currently on turn.
 * Replaces:
 *   `state.gameState.currentTurn === 'red' ? state.teamNames.red : state.teamNames.blue`
 */
export function currentTeamName(): string {
    return state.gameState.currentTurn === 'red' ? state.teamNames.red : state.teamNames.blue;
}

/**
 * Get the display name for a specific team.
 */
export function teamName(team: string): string {
    return team === 'red' ? state.teamNames.red : state.teamNames.blue;
}

// ---- Clicker availability selectors ----

/**
 * Whether the team clicker for the current turn is disconnected
 * or not assigned. Used for fallback click logic.
 */
export function isCurrentTeamClickerUnavailable(): boolean {
    const teamClicker = state.multiplayerPlayers.find(
        (p: ServerPlayerData) => p.team === state.gameState.currentTurn && p.role === 'clicker'
    );
    return !teamClicker || !teamClicker.connected;
}

/**
 * Whether the current player can act as a clicker fallback
 * (team member on turn when the assigned clicker is disconnected).
 */
export function isClickerFallback(): boolean {
    if (!state.isMultiplayerMode) return false;
    if (state.clickerTeam && state.clickerTeam === state.gameState.currentTurn) return false;
    if (state.playerTeam !== state.gameState.currentTurn) return false;
    return isCurrentTeamClickerUnavailable();
}

/**
 * Whether the current player can perform clicker actions
 * (either as the assigned clicker or as a fallback).
 */
export function canActAsClicker(): boolean {
    if (state.gameState.gameOver) return false;
    return isPlayerTurn() || isClickerFallback();
}

// ---- Game mode selectors ----

/**
 * Whether the game is in duet mode.
 */
export function isDuetMode(): boolean {
    return state.gameMode === 'duet';
}

// ---- Match mode selectors ----

/**
 * Whether the game is in match mode.
 */
export function isMatchMode(): boolean {
    return state.gameMode === 'match';
}

/**
 * Current match round number (0 if not in match).
 */
export function matchRound(): number {
    return state.gameState.matchRound ?? 0;
}

/**
 * Whether the overall match is over.
 */
export function isMatchOver(): boolean {
    return state.gameState.matchOver ?? false;
}

// ---- Multiplayer selectors ----

/**
 * Player count (convenience).
 */
export function playerCount(): number {
    return state.multiplayerPlayers.length;
}
