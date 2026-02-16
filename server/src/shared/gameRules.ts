/**
 * Shared Game Rule Constants
 *
 * Single source of truth for game rules used by both frontend and backend.
 * This module MUST remain environment-agnostic — no Node.js or browser APIs.
 */

// Board layout
export const BOARD_SIZE = 25;
export const FIRST_TEAM_CARDS = 9;
export const SECOND_TEAM_CARDS = 8;
export const NEUTRAL_CARDS = 7;
export const ASSASSIN_CARDS = 1;

// Timer bounds
export const TIMER_MIN_TURN_SECONDS = 30;
export const TIMER_MAX_TURN_SECONDS = 600;
export const TIMER_DEFAULT_TURN_SECONDS = 120;

// Game modes
export const GAME_MODES = ['classic', 'blitz', 'duet'] as const;
export type GameMode = typeof GAME_MODES[number];

// Teams and roles
export const TEAMS = ['red', 'blue'] as const;
export const ROLES = ['spymaster', 'clicker', 'spectator'] as const;
