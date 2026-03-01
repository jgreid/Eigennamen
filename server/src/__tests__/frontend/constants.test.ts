/**
 * Frontend Constants Tests
 *
 * Tests for validation functions in frontend/constants.ts
 */

import {
    validateNickname,
    validateRoomCode,
    VALIDATION,
    BOARD_SIZE,
    FIRST_TEAM_CARDS,
    SECOND_TEAM_CARDS,
    NEUTRAL_CARDS,
    ASSASSIN_CARDS,
    GAME,
    TIMER,
    RESERVED_NAMES,
} from '../../frontend/constants';

describe('Frontend Constants', () => {
    describe('shared constant re-exports', () => {
        test('BOARD_SIZE matches expected value', () => {
            expect(BOARD_SIZE).toBe(25);
        });

        test('card distribution sums to BOARD_SIZE', () => {
            expect(FIRST_TEAM_CARDS + SECOND_TEAM_CARDS + NEUTRAL_CARDS + ASSASSIN_CARDS).toBe(BOARD_SIZE);
        });

        test('GAME object matches individual constants', () => {
            expect(GAME.BOARD_SIZE).toBe(BOARD_SIZE);
            expect(GAME.RED_CARDS_FIRST).toBe(FIRST_TEAM_CARDS);
            expect(GAME.BLUE_CARDS_FIRST).toBe(SECOND_TEAM_CARDS);
            expect(GAME.NEUTRAL_CARDS).toBe(NEUTRAL_CARDS);
            expect(GAME.ASSASSIN_CARDS).toBe(ASSASSIN_CARDS);
        });

        test('TIMER constants are reasonable', () => {
            expect(TIMER.MIN_TURN_SECONDS).toBeGreaterThan(0);
            expect(TIMER.MAX_TURN_SECONDS).toBeGreaterThan(TIMER.MIN_TURN_SECONDS);
            expect(TIMER.DEFAULT_TURN_SECONDS).toBeGreaterThanOrEqual(TIMER.MIN_TURN_SECONDS);
            expect(TIMER.DEFAULT_TURN_SECONDS).toBeLessThanOrEqual(TIMER.MAX_TURN_SECONDS);
        });

        test('VALIDATION has all expected fields', () => {
            expect(VALIDATION.NICKNAME_MIN_LENGTH).toBeDefined();
            expect(VALIDATION.NICKNAME_MAX_LENGTH).toBeDefined();
            expect(VALIDATION.ROOM_CODE_MIN_LENGTH).toBeDefined();
            expect(VALIDATION.ROOM_CODE_MAX_LENGTH).toBeDefined();
            expect(VALIDATION.ROOM_CODE_PATTERN).toBeDefined();
            expect(VALIDATION.CHAT_MESSAGE_MAX_LENGTH).toBeDefined();
        });

        test('RESERVED_NAMES is a non-empty array', () => {
            expect(Array.isArray(RESERVED_NAMES)).toBe(true);
            expect(RESERVED_NAMES.length).toBeGreaterThan(0);
        });
    });

    describe('validateNickname', () => {
        test('accepts valid nickname', () => {
            const result = validateNickname('Alice');
            expect(result).toEqual({ valid: true, error: null });
        });

        test('accepts nickname with Unicode letters', () => {
            const result = validateNickname('Ünîcödé');
            expect(result).toEqual({ valid: true, error: null });
        });

        test('accepts nickname with numbers and hyphens', () => {
            const result = validateNickname('Player-1');
            expect(result).toEqual({ valid: true, error: null });
        });

        test('accepts nickname with underscores', () => {
            const result = validateNickname('cool_player');
            expect(result).toEqual({ valid: true, error: null });
        });

        test('rejects empty string', () => {
            const result = validateNickname('');
            expect(result.valid).toBe(false);
            expect(result.error).toBeTruthy();
        });

        test('rejects null/undefined via falsy check', () => {
            const result = validateNickname(null as unknown as string);
            expect(result.valid).toBe(false);
            expect(result.error).toBe('Nickname is required');
        });

        test('rejects undefined', () => {
            const result = validateNickname(undefined as unknown as string);
            expect(result.valid).toBe(false);
            expect(result.error).toBe('Nickname is required');
        });

        test('rejects non-string type', () => {
            const result = validateNickname(123 as unknown as string);
            expect(result.valid).toBe(false);
            expect(result.error).toBe('Nickname is required');
        });

        test('rejects whitespace-only nickname after trimming', () => {
            const result = validateNickname('   ');
            expect(result.valid).toBe(false);
            expect(result.error).toBeTruthy();
        });

        test('rejects nickname exceeding max length', () => {
            const long = 'A'.repeat(VALIDATION.NICKNAME_MAX_LENGTH + 1);
            const result = validateNickname(long);
            expect(result.valid).toBe(false);
            expect(result.error).toContain('characters or less');
        });

        test('accepts nickname at exact max length', () => {
            const exact = 'A'.repeat(VALIDATION.NICKNAME_MAX_LENGTH);
            const result = validateNickname(exact);
            expect(result).toEqual({ valid: true, error: null });
        });

        test('rejects nickname with special characters', () => {
            const result = validateNickname('Player@#$');
            expect(result.valid).toBe(false);
            expect(result.error).toContain('invalid characters');
        });

        test('rejects reserved names (case-insensitive)', () => {
            const result = validateNickname('admin');
            expect(result.valid).toBe(false);
            expect(result.error).toContain('reserved');
        });

        test('rejects reserved names with mixed case', () => {
            const result = validateNickname('Admin');
            expect(result.valid).toBe(false);
            expect(result.error).toContain('reserved');
        });

        test('rejects "system" as reserved', () => {
            const result = validateNickname('system');
            expect(result.valid).toBe(false);
            expect(result.error).toContain('reserved');
        });

        test('trims whitespace before validation', () => {
            const result = validateNickname('  Alice  ');
            expect(result).toEqual({ valid: true, error: null });
        });
    });

    describe('validateRoomCode', () => {
        test('accepts valid room code', () => {
            const result = validateRoomCode('myroom');
            expect(result).toEqual({ valid: true, error: null });
        });

        test('accepts room code with numbers', () => {
            const result = validateRoomCode('room123');
            expect(result).toEqual({ valid: true, error: null });
        });

        test('accepts room code with hyphens and underscores', () => {
            const result = validateRoomCode('my-room_1');
            expect(result).toEqual({ valid: true, error: null });
        });

        test('rejects empty string', () => {
            const result = validateRoomCode('');
            expect(result.valid).toBe(false);
            expect(result.error).toBeTruthy();
        });

        test('rejects null', () => {
            const result = validateRoomCode(null as unknown as string);
            expect(result.valid).toBe(false);
            expect(result.error).toBe('Room ID is required');
        });

        test('rejects undefined', () => {
            const result = validateRoomCode(undefined as unknown as string);
            expect(result.valid).toBe(false);
            expect(result.error).toBe('Room ID is required');
        });

        test('rejects non-string type', () => {
            const result = validateRoomCode(42 as unknown as string);
            expect(result.valid).toBe(false);
            expect(result.error).toBe('Room ID is required');
        });

        test('rejects room code shorter than minimum', () => {
            const result = validateRoomCode('ab');
            expect(result.valid).toBe(false);
            expect(result.error).toContain('at least');
        });

        test('rejects room code exceeding max length', () => {
            const long = 'a'.repeat(VALIDATION.ROOM_CODE_MAX_LENGTH + 1);
            const result = validateRoomCode(long);
            expect(result.valid).toBe(false);
            expect(result.error).toContain('characters or less');
        });

        test('accepts room code at exact minimum length', () => {
            const code = 'a'.repeat(VALIDATION.ROOM_CODE_MIN_LENGTH);
            const result = validateRoomCode(code);
            expect(result).toEqual({ valid: true, error: null });
        });

        test('accepts room code at exact maximum length', () => {
            const code = 'a'.repeat(VALIDATION.ROOM_CODE_MAX_LENGTH);
            const result = validateRoomCode(code);
            expect(result).toEqual({ valid: true, error: null });
        });

        test('rejects room code with spaces', () => {
            const result = validateRoomCode('my room');
            expect(result.valid).toBe(false);
            expect(result.error).toContain('letters, numbers, hyphens, and underscores');
        });

        test('rejects room code with special characters', () => {
            const result = validateRoomCode('room@!');
            expect(result.valid).toBe(false);
            expect(result.error).toContain('letters, numbers, hyphens, and underscores');
        });

        test('trims whitespace before validation', () => {
            const result = validateRoomCode('  myroom  ');
            expect(result).toEqual({ valid: true, error: null });
        });
    });
});
