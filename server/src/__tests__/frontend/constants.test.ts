/**
 * Frontend Constants Tests
 *
 * Tests for validation functions in frontend/constants.ts
 */

import { validateNickname, validateRoomCode, VALIDATION } from '../../frontend/constants';

describe('Frontend Constants', () => {
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
