/**
 * Unit tests for game constants
 */

import { describe, it, expect } from 'vitest';
import {
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
} from '../constants.js';

describe('Board Constants', () => {
  it('should have correct board size', () => {
    expect(BOARD_SIZE).toBe(25);
    expect(BOARD_ROWS * BOARD_COLS).toBe(BOARD_SIZE);
  });

  it('should have correct dimensions', () => {
    expect(BOARD_ROWS).toBe(5);
    expect(BOARD_COLS).toBe(5);
  });
});

describe('Card Distribution', () => {
  it('should have correct card counts', () => {
    expect(FIRST_TEAM_CARDS).toBe(9);
    expect(SECOND_TEAM_CARDS).toBe(8);
    expect(NEUTRAL_CARDS).toBe(7);
    expect(ASSASSIN_CARDS).toBe(1);
  });

  it('should total to board size', () => {
    const total = FIRST_TEAM_CARDS + SECOND_TEAM_CARDS + NEUTRAL_CARDS + ASSASSIN_CARDS;
    expect(total).toBe(BOARD_SIZE);
  });
});

describe('Team Constants', () => {
  it('should have team identifiers', () => {
    expect(TEAM_RED).toBe('red');
    expect(TEAM_BLUE).toBe('blue');
  });
});

describe('Card Types', () => {
  it('should have all card types', () => {
    expect(CARD_TYPES.RED).toBe('red');
    expect(CARD_TYPES.BLUE).toBe('blue');
    expect(CARD_TYPES.NEUTRAL).toBe('neutral');
    expect(CARD_TYPES.ASSASSIN).toBe('assassin');
  });
});

describe('Roles', () => {
  it('should have all roles', () => {
    expect(ROLES.SPYMASTER).toBe('spymaster');
    expect(ROLES.CLICKER).toBe('clicker');
    expect(ROLES.SPECTATOR).toBe('spectator');
  });
});

describe('Word List Modes', () => {
  it('should have all modes', () => {
    expect(WORD_LIST_MODES.DEFAULT).toBe('default');
    expect(WORD_LIST_MODES.COMBINED).toBe('combined');
    expect(WORD_LIST_MODES.CUSTOM).toBe('custom');
  });
});

describe('Validation Constants', () => {
  it('should have correct limits', () => {
    expect(MAX_TEAM_NAME_LENGTH).toBe(32);
    expect(MIN_CUSTOM_WORDS).toBe(25);
  });

  it('should have valid team name regex', () => {
    expect(TEAM_NAME_REGEX.test('Red Team')).toBe(true);
    expect(TEAM_NAME_REGEX.test('Blue-Team')).toBe(true);
    expect(TEAM_NAME_REGEX.test('Team123')).toBe(true);
    expect(TEAM_NAME_REGEX.test('<script>')).toBe(false);
  });
});
