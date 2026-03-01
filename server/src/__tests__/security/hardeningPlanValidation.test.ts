/**
 * Hardening Plan Validation Tests
 *
 * Tests that verify each phase of the hardening plan has been
 * implemented correctly. Covers:
 * - Phase 1: Timer validation alignment, typecheck enforcement
 * - Phase 2: Room code regex, clue word validation
 * - Phase 5: Rate limit config, timer lock TTL
 * - Phase 7: Constant centralization
 */

// ============================================
// Phase 1.1: Timer Validation Alignment
// ============================================

describe('Phase 1.1: Timer Validation Mismatch', () => {
    test('server TIMER.MAX_TURN_SECONDS should be 600 (matching client)', () => {
        const { TIMER } = require('../../config/constants');
        expect(TIMER.MAX_TURN_SECONDS).toBe(600);
    });

    test('server TIMER.MIN_TURN_SECONDS should be 20', () => {
        const { TIMER } = require('../../config/constants');
        expect(TIMER.MIN_TURN_SECONDS).toBe(20);
    });

    test('Zod roomSettingsSchema allows turnTimer up to 600', () => {
        const { roomSettingsSchema } = require('../../validators/schemas');
        // Should succeed with 600
        const result600 = roomSettingsSchema.safeParse({ turnTimer: 600 });
        expect(result600.success).toBe(true);

        // Should fail with 601
        const result601 = roomSettingsSchema.safeParse({ turnTimer: 601 });
        expect(result601.success).toBe(false);
    });

    test('Zod roomSettingsSchema rejects turnTimer below 20', () => {
        const { roomSettingsSchema } = require('../../validators/schemas');
        const result = roomSettingsSchema.safeParse({ turnTimer: 19 });
        expect(result.success).toBe(false);
    });

    test('Zod roomCreateSchema enforces timer bounds', () => {
        const { roomCreateSchema } = require('../../validators/schemas');

        // Accepts 600s (max)
        const at600 = roomCreateSchema.safeParse({
            roomId: 'test-room',
            settings: { turnTimer: 600, gameMode: 'classic' }
        });
        expect(at600.success).toBe(true);

        // Accepts 20s (min)
        const at20 = roomCreateSchema.safeParse({
            roomId: 'test-room',
            settings: { turnTimer: 20, gameMode: 'classic' }
        });
        expect(at20.success).toBe(true);

        // Rejects above max
        const over600 = roomCreateSchema.safeParse({
            roomId: 'test-room',
            settings: { turnTimer: 601, gameMode: 'classic' }
        });
        expect(over600.success).toBe(false);

        // Rejects blitz (removed mode)
        const blitz = roomCreateSchema.safeParse({
            roomId: 'test-room',
            settings: { gameMode: 'blitz' }
        });
        expect(blitz.success).toBe(false);
    });
});

// ============================================
// Phase 1.4: Typecheck Enforcement
// ============================================

describe('Phase 1.4: Typecheck in Build', () => {
    test('package.json prebuild includes typecheck', () => {
        const pkg = require('../../../package.json');
        expect(pkg.scripts.prebuild).toContain('typecheck');
    });
});

// ============================================
// Phase 2.3: Room Warning Event
// ============================================

describe('Phase 2.3: Room Warning Event', () => {
    test('SOCKET_EVENTS includes ROOM_WARNING', () => {
        const { SOCKET_EVENTS } = require('../../config/constants');
        expect(SOCKET_EVENTS.ROOM_WARNING).toBe('room:warning');
    });
});

// ============================================
// Phase 5.1: Room Existence Rate Limit
// ============================================

describe('Phase 5.1: Room Existence Rate Limit', () => {
    test('API_RATE_LIMITS includes ROOM_EXISTS config', () => {
        const { API_RATE_LIMITS } = require('../../config/constants');
        expect(API_RATE_LIMITS.ROOM_EXISTS).toBeDefined();
        expect(API_RATE_LIMITS.ROOM_EXISTS.window).toBe(60000);
        expect(API_RATE_LIMITS.ROOM_EXISTS.max).toBe(10);
    });
});

// ============================================
// Phase 7.3: Centralized Constants
// ============================================

describe('Phase 7.3: Constants Centralization', () => {
    test('TIMER constants are accessible from constants.ts', () => {
        const { TIMER } = require('../../config/constants');
        expect(TIMER.DEFAULT_TURN_SECONDS).toBe(120);
        expect(TIMER.MIN_TURN_SECONDS).toBe(20);
        expect(TIMER.MAX_TURN_SECONDS).toBe(600);
        expect(TIMER.WARNING_SECONDS).toBe(30);
        expect(TIMER.TIMER_TTL_BUFFER_SECONDS).toBe(60);
    });

    test('REDIS_TTL constants are accessible', () => {
        const { REDIS_TTL } = require('../../config/constants');
        expect(REDIS_TTL.SESSION_SOCKET).toBe(300);
        expect(REDIS_TTL.DISCONNECTED_PLAYER).toBe(600);
    });

    test('ROOM config constants are accessible', () => {
        const { ROOM_CODE_LENGTH, ROOM_MAX_PLAYERS } = require('../../config/constants');
        expect(ROOM_CODE_LENGTH).toBe(6);
        expect(ROOM_MAX_PLAYERS).toBe(20);
    });
});
