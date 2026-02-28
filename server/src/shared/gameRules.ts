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
export const GAME_MODES = ['classic', 'blitz', 'duet', 'match'] as const;
export type GameMode = typeof GAME_MODES[number];

// Teams and roles
export const TEAMS = ['red', 'blue'] as const;
export const ROLES = ['spymaster', 'clicker', 'spectator'] as const;

// ---- Card Scoring (Match Mode) ----

/** Match target: first team to reach this score (win by MATCH_WIN_MARGIN) */
export const MATCH_TARGET = 42;

/** Minimum lead required to win the match */
export const MATCH_WIN_MARGIN = 3;

/** Bonus points awarded to the team that wins a round */
export const ROUND_WIN_BONUS = 7;

/** Fixed number of standard (1-point) cards per board */
export const STANDARD_SCORE_CARDS = 8;

/**
 * Card score distribution ranges for non-assassin, non-standard cards.
 * The 'blank' (0-point) count fills whatever remains to reach 24 (BOARD_SIZE - 1 assassin).
 */
export const CARD_SCORE_DISTRIBUTION = {
    gold:     { score: 3,  min: 2, max: 4 },
    silver:   { score: 2,  min: 3, max: 6 },
    trap:     { score: -1, min: 0, max: 4 },
} as const;

/** Board total value (sum of all 25 card scores) must fall within this range */
export const BOARD_VALUE_MIN = 20;
export const BOARD_VALUE_MAX = 30;

/**
 * Weighted pool for assassin score generation.
 * Median is -1 (negative-biased). Drawn uniformly from this array.
 */
export const ASSASSIN_SCORE_POOL = [-2, -2, -1, -1, -1, 0, 0, 1, 2] as const;
