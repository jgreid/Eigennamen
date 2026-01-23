/**
 * Game Constants
 *
 * Central configuration for Codenames game rules and limits.
 * These values must stay synchronized with server-side constants.
 *
 * @module constants
 */

// Board dimensions
export const BOARD_SIZE = 25;
export const BOARD_ROWS = 5;
export const BOARD_COLS = 5;

// Card distribution
export const FIRST_TEAM_CARDS = 9;
export const SECOND_TEAM_CARDS = 8;
export const NEUTRAL_CARDS = 7;
export const ASSASSIN_CARDS = 1;

// Team identifiers
export const TEAM_RED = 'red';
export const TEAM_BLUE = 'blue';

// Card types
export const CARD_TYPES = {
  RED: 'red',
  BLUE: 'blue',
  NEUTRAL: 'neutral',
  ASSASSIN: 'assassin',
};

// Role types
export const ROLES = {
  SPYMASTER: 'spymaster',
  CLICKER: 'clicker',
  SPECTATOR: 'spectator',
};

// Word list modes
export const WORD_LIST_MODES = {
  DEFAULT: 'default',
  COMBINED: 'combined',
  CUSTOM: 'custom',
};

// Validation limits
export const MAX_TEAM_NAME_LENGTH = 32;
export const MIN_CUSTOM_WORDS = 25;

// Team name validation regex (alphanumeric, spaces, hyphens only)
export const TEAM_NAME_REGEX = /^[a-zA-Z0-9\s\-]+$/;

// Toast notification durations (ms)
export const TOAST_DURATION = {
  SHORT: 2000,
  DEFAULT: 4000,
  LONG: 6000,
};

// Animation durations (ms)
export const ANIMATION = {
  MODAL_TRANSITION: 300,
  TOAST_FADE: 300,
  CARD_FLIP: 200,
  DEBOUNCE: 500,
};

// Font size thresholds for card text
export const CARD_FONT_THRESHOLDS = {
  SMALL: 10,  // Words longer than this get smaller font
  TINY: 14,   // Words longer than this get even smaller font
};

// Default export for convenience
export default {
  BOARD_SIZE,
  BOARD_ROWS,
  BOARD_COLS,
  FIRST_TEAM_CARDS,
  SECOND_TEAM_CARDS,
  NEUTRAL_CARDS,
  ASSASSIN_CARDS,
  TEAM_RED,
  TEAM_BLUE,
  CARD_TYPES,
  ROLES,
  WORD_LIST_MODES,
  MAX_TEAM_NAME_LENGTH,
  MIN_CUSTOM_WORDS,
  TEAM_NAME_REGEX,
  TOAST_DURATION,
  ANIMATION,
  CARD_FONT_THRESHOLDS,
};
