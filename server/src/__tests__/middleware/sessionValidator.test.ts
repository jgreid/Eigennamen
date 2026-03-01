/**
 * Unit Tests for Session Validator
 *
 * Tests the session validation middleware including:
 * - Memory rate-limit fallback when Redis is unavailable
 * - Max cap enforcement (10k entries) for memory rate limits
 * - Cleanup of expired entries from the memory map
 * - Concurrent access during cleanup
 * - Session age validation
 * - IP consistency validation
 * - Reconnection token validation
 * - Full session validation pipeline
 * - Session ID resolution logic
 */

// Mock dependencies before requiring the module
jest.mock('../../utils/logger', () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
}));

jest.mock('../../services/playerService', () => ({
    getPlayer: jest.fn(),
    validateSocketAuthToken: jest.fn(),
}));

jest.mock('../../config/redis', () => ({
    getRedis: jest.fn(),
}));

// Use realistic config values but keep IP_MISMATCH_ALLOWED testable
let ipMismatchAllowed = false;
jest.mock('../../config/constants', () => ({
    SESSION_SECURITY: {
        get MAX_SESSION_AGE_MS() {
            return 8 * 60 * 60 * 1000;
        }, // 8 hours
        get MAX_VALIDATION_ATTEMPTS_PER_IP() {
            return 20;
        },
        get IP_MISMATCH_ALLOWED() {
            return ipMismatchAllowed;
        },
        SESSION_ID_MIN_LENGTH: 36,
        RECONNECTION_TOKEN_TTL_SECONDS: 300,
        RECONNECTION_TOKEN_LENGTH: 32,
    },
    REDIS_TTL: {
        SESSION_VALIDATION_WINDOW: 60, // 1 minute
    },
    ERROR_CODES: {
        SESSION_EXPIRED: 'SESSION_EXPIRED',
        SESSION_NOT_FOUND: 'SESSION_NOT_FOUND',
        SESSION_VALIDATION_RATE_LIMITED: 'SESSION_VALIDATION_RATE_LIMITED',
        NOT_AUTHORIZED: 'NOT_AUTHORIZED',
    },
}));

const logger = require('../../utils/logger');
const playerService = require('../../services/playerService');
const { getRedis } = require('../../config/redis');

// Valid UUID for testing
const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';
const _VALID_UUID_2 = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

function createMockPlayer(overrides: Record<string, unknown> = {}) {
    return {
        sessionId: VALID_UUID,
        roomCode: 'ABCDEF',
        nickname: 'TestPlayer',
        team: 'red',
        role: 'guesser',
        isHost: false,
        connected: false,
        lastSeen: Date.now(),
        createdAt: Date.now() - 1000, // 1 second ago
        lastIP: '192.168.1.1',
        ...overrides,
    };
}

describe('Session Validator', () => {
    let mockRedis: Record<string, jest.Mock>;

    // We need to re-require the module for each describe block that tests
    // internal state (memory map), because the map persists across tests.
    // For blocks that don't need isolated internal state, a single require suffices.
    // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- dynamic require
    let sessionValidator: typeof import('../../middleware/auth/sessionValidator');

    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();
        ipMismatchAllowed = false;

        mockRedis = {
            eval: jest.fn().mockResolvedValue(1),
            incr: jest.fn().mockResolvedValue(1),
            expire: jest.fn().mockResolvedValue(1),
        };
        (getRedis as jest.Mock).mockReturnValue(mockRedis);
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    // Fresh module import to reset the internal memory map
    function freshModule() {
        jest.resetModules();
        // Re-apply mocks after resetModules
        jest.mock('../../utils/logger', () => ({
            debug: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
        }));
        jest.mock('../../services/playerService', () => ({
            getPlayer: jest.fn(),
            validateSocketAuthToken: jest.fn(),
        }));
        jest.mock('../../config/redis', () => ({
            getRedis: jest.fn(),
        }));
        jest.mock('../../config/constants', () => ({
            SESSION_SECURITY: {
                get MAX_SESSION_AGE_MS() {
                    return 8 * 60 * 60 * 1000;
                },
                get MAX_VALIDATION_ATTEMPTS_PER_IP() {
                    return 20;
                },
                get IP_MISMATCH_ALLOWED() {
                    return ipMismatchAllowed;
                },
                SESSION_ID_MIN_LENGTH: 36,
                RECONNECTION_TOKEN_TTL_SECONDS: 300,
                RECONNECTION_TOKEN_LENGTH: 32,
            },
            REDIS_TTL: {
                SESSION_VALIDATION_WINDOW: 60,
            },
            ERROR_CODES: {
                SESSION_EXPIRED: 'SESSION_EXPIRED',
                SESSION_NOT_FOUND: 'SESSION_NOT_FOUND',
                SESSION_VALIDATION_RATE_LIMITED: 'SESSION_VALIDATION_RATE_LIMITED',
                NOT_AUTHORIZED: 'NOT_AUTHORIZED',
            },
        }));

        const mod = require('../../middleware/auth/sessionValidator');
        const redis = require('../../config/redis');
        const ps = require('../../services/playerService');

        mockRedis = {
            eval: jest.fn().mockResolvedValue(1),
            incr: jest.fn().mockResolvedValue(1),
            expire: jest.fn().mockResolvedValue(1),
        };
        (redis.getRedis as jest.Mock).mockReturnValue(mockRedis);

        return { mod, redis, playerService: ps };
    }

    // Use default (non-fresh) module for most tests
    beforeAll(() => {
        sessionValidator = require('../../middleware/auth/sessionValidator');
    });

    // =========================================================================
    // checkValidationRateLimit — Redis path
    // =========================================================================
    describe('checkValidationRateLimit', () => {
        test('allows request when Redis returns count within limit', async () => {
            mockRedis.eval.mockResolvedValue(5);

            const result = await sessionValidator.checkValidationRateLimit('192.168.1.1');

            expect(result.allowed).toBe(true);
            expect(result.attempts).toBe(5);
        });

        test('denies request when Redis returns count exceeding limit', async () => {
            mockRedis.eval.mockResolvedValue(21); // MAX_VALIDATION_ATTEMPTS_PER_IP = 20

            const result = await sessionValidator.checkValidationRateLimit('192.168.1.1');

            expect(result.allowed).toBe(false);
            expect(result.attempts).toBe(21);
            expect(logger.warn).toHaveBeenCalledWith(
                'Session validation rate limited',
                expect.objectContaining({
                    clientIP: '192.168.1.1',
                    attempts: 21,
                    maxAttempts: 20,
                })
            );
        });

        test('allows request at exactly the max attempt count', async () => {
            mockRedis.eval.mockResolvedValue(20); // exactly at limit

            const result = await sessionValidator.checkValidationRateLimit('192.168.1.1');

            expect(result.allowed).toBe(true);
            expect(result.attempts).toBe(20);
        });

        test('passes correct Lua script arguments to Redis', async () => {
            mockRedis.eval.mockResolvedValue(1);

            await sessionValidator.checkValidationRateLimit('10.0.0.1');

            expect(mockRedis.eval).toHaveBeenCalledWith(
                expect.stringContaining('INCR'),
                expect.objectContaining({
                    keys: ['session:validation:10.0.0.1'],
                    arguments: ['60'], // SESSION_VALIDATION_WINDOW
                })
            );
        });
    });

    // =========================================================================
    // checkValidationRateLimit — Memory fallback when Redis fails
    // =========================================================================
    describe('checkValidationRateLimit — memory fallback', () => {
        test('falls back to memory rate limit when Redis throws', async () => {
            const { mod, redis } = freshModule();
            const freshRedis = { eval: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) };
            (redis.getRedis as jest.Mock).mockReturnValue(freshRedis);

            const result = await mod.checkValidationRateLimit('10.0.0.1');

            expect(result.allowed).toBe(true);
            expect(result.attempts).toBe(1);

            const freshLogger = require('../../utils/logger');
            expect(freshLogger.error).toHaveBeenCalledWith(
                'Rate limit Redis check failed, using in-memory fallback:',
                'ECONNREFUSED'
            );
        });

        test('memory fallback tracks attempts correctly across calls', async () => {
            const { mod, redis } = freshModule();
            const freshRedis = { eval: jest.fn().mockRejectedValue(new Error('Redis down')) };
            (redis.getRedis as jest.Mock).mockReturnValue(freshRedis);

            // Make multiple calls for the same IP
            for (let i = 1; i <= 20; i++) {
                const result = await mod.checkValidationRateLimit('10.0.0.1');
                expect(result.allowed).toBe(true);
                expect(result.attempts).toBe(i);
            }

            // 21st call should be denied
            const denied = await mod.checkValidationRateLimit('10.0.0.1');
            expect(denied.allowed).toBe(false);
            expect(denied.attempts).toBe(21);
        });

        test('memory fallback treats different IPs independently', async () => {
            const { mod, redis } = freshModule();
            const freshRedis = { eval: jest.fn().mockRejectedValue(new Error('Redis down')) };
            (redis.getRedis as jest.Mock).mockReturnValue(freshRedis);

            await mod.checkValidationRateLimit('10.0.0.1');
            await mod.checkValidationRateLimit('10.0.0.1');
            await mod.checkValidationRateLimit('10.0.0.2');

            const result1 = await mod.checkValidationRateLimit('10.0.0.1');
            expect(result1.attempts).toBe(3); // 3rd attempt for IP 1

            const result2 = await mod.checkValidationRateLimit('10.0.0.2');
            expect(result2.attempts).toBe(2); // 2nd attempt for IP 2
        });

        test('memory fallback resets expired entries on access', async () => {
            const { mod, redis } = freshModule();
            const freshRedis = { eval: jest.fn().mockRejectedValue(new Error('Redis down')) };
            (redis.getRedis as jest.Mock).mockReturnValue(freshRedis);

            // Make some attempts
            for (let i = 0; i < 5; i++) {
                await mod.checkValidationRateLimit('10.0.0.1');
            }

            // Advance time past the window (SESSION_VALIDATION_WINDOW = 60s)
            jest.advanceTimersByTime(61_000);

            // Next attempt should be treated as fresh (count = 1)
            const result = await mod.checkValidationRateLimit('10.0.0.1');
            expect(result.allowed).toBe(true);
            expect(result.attempts).toBe(1);
        });
    });

    // =========================================================================
    // Memory rate-limit max cap enforcement (10k entries)
    // =========================================================================
    describe('memory rate-limit max cap enforcement', () => {
        test('evicts oldest entry when map reaches 10k entries', async () => {
            const { mod, redis } = freshModule();
            const freshRedis = { eval: jest.fn().mockRejectedValue(new Error('Redis down')) };
            (redis.getRedis as jest.Mock).mockReturnValue(freshRedis);

            // Fill the map to capacity with unique IPs
            for (let i = 0; i < 10_000; i++) {
                await mod.checkValidationRateLimit(`10.0.${Math.floor(i / 256)}.${i % 256}`);
            }

            // The next new IP should trigger eviction of the first entry
            await mod.checkValidationRateLimit('192.168.255.255');

            // Verify the new IP was allowed (count = 1)
            const result = await mod.checkValidationRateLimit('192.168.255.255');
            expect(result.allowed).toBe(true);
            // Should be 2 because we already called once above
            expect(result.attempts).toBe(2);

            // The very first IP should have been evicted, so it starts fresh
            const evictedResult = await mod.checkValidationRateLimit('10.0.0.0');
            expect(evictedResult.attempts).toBe(1);
        });
    });

    // =========================================================================
    // Memory rate-limit cleanup (timer-based)
    // =========================================================================
    describe('memory rate-limit cleanup', () => {
        test('cleanup timer removes expired entries after interval', async () => {
            const { mod, redis } = freshModule();
            const freshRedis = { eval: jest.fn().mockRejectedValue(new Error('Redis down')) };
            (redis.getRedis as jest.Mock).mockReturnValue(freshRedis);

            // Create entries
            await mod.checkValidationRateLimit('10.0.0.1');
            await mod.checkValidationRateLimit('10.0.0.2');

            // Advance past the session validation window (60s) but before cleanup fires
            jest.advanceTimersByTime(59_000);

            // Entries should still count (window hasn't expired yet for access check)
            const mid1 = await mod.checkValidationRateLimit('10.0.0.1');
            expect(mid1.attempts).toBe(2); // not reset yet

            // Advance past the window expiry
            jest.advanceTimersByTime(2_000); // now at 61s total

            // Advance to trigger the cleanup interval (60s)
            jest.advanceTimersByTime(60_000);

            // Now accessing the IP should give fresh count because the entry expired
            // and cleanup may have removed it. Even if cleanup didn't run yet,
            // the access-time check should detect expiry.
            const result = await mod.checkValidationRateLimit('10.0.0.1');
            expect(result.attempts).toBe(1); // reset due to expired entry
        });

        test('cleanup only starts one timer (idempotent)', async () => {
            const { mod, redis } = freshModule();
            const freshRedis = { eval: jest.fn().mockRejectedValue(new Error('Redis down')) };
            (redis.getRedis as jest.Mock).mockReturnValue(freshRedis);

            const setIntervalSpy = jest.spyOn(global, 'setInterval');
            const callsBefore = setIntervalSpy.mock.calls.length;

            // Multiple calls should only start one cleanup timer
            await mod.checkValidationRateLimit('10.0.0.1');
            await mod.checkValidationRateLimit('10.0.0.2');
            await mod.checkValidationRateLimit('10.0.0.3');

            // setInterval should have been called at most once by the module
            const callsAfter = setIntervalSpy.mock.calls.length;
            expect(callsAfter - callsBefore).toBeLessThanOrEqual(1);

            setIntervalSpy.mockRestore();
        });
    });

    // =========================================================================
    // Concurrent access during cleanup
    // =========================================================================
    describe('concurrent access during cleanup', () => {
        test('handles concurrent rate limit checks without errors', async () => {
            const { mod, redis } = freshModule();
            const freshRedis = { eval: jest.fn().mockRejectedValue(new Error('Redis down')) };
            (redis.getRedis as jest.Mock).mockReturnValue(freshRedis);

            // Fire many concurrent calls
            const promises = [];
            for (let i = 0; i < 100; i++) {
                promises.push(mod.checkValidationRateLimit(`10.0.${Math.floor(i / 256)}.${i % 256}`));
            }

            // Should all resolve without throwing
            const results = await Promise.all(promises);
            expect(results).toHaveLength(100);
            results.forEach((result: { allowed: boolean; attempts: number }) => {
                expect(result.allowed).toBe(true);
                expect(result.attempts).toBe(1);
            });
        });

        test('concurrent checks for the same IP increment correctly', async () => {
            const { mod, redis } = freshModule();
            const freshRedis = { eval: jest.fn().mockRejectedValue(new Error('Redis down')) };
            (redis.getRedis as jest.Mock).mockReturnValue(freshRedis);

            // Fire 10 concurrent calls for the same IP
            const promises = [];
            for (let i = 0; i < 10; i++) {
                promises.push(mod.checkValidationRateLimit('10.0.0.1'));
            }

            const results = await Promise.all(promises);

            // Since JS is single-threaded, they'll execute in sequence within the microtask.
            // The last result should have attempts = 10
            const maxAttempts = Math.max(...results.map((r: { attempts: number }) => r.attempts));
            expect(maxAttempts).toBe(10);
        });
    });

    // =========================================================================
    // validateSessionAge
    // =========================================================================
    describe('validateSessionAge', () => {
        test('returns valid for player with recent createdAt', () => {
            const player = createMockPlayer({ createdAt: Date.now() - 1000 });
            const result = sessionValidator.validateSessionAge(player as any);
            expect(result.valid).toBe(true);
            expect(result.reason).toBeUndefined();
        });

        test('returns invalid for player with expired session (> 8 hours)', () => {
            const nineHoursAgo = Date.now() - 9 * 60 * 60 * 1000;
            const player = createMockPlayer({ createdAt: nineHoursAgo });
            const result = sessionValidator.validateSessionAge(player as any);
            expect(result.valid).toBe(false);
            expect(result.reason).toBe('SESSION_EXPIRED');
        });

        test('returns valid for session exactly at the age limit', () => {
            // Exactly 8 hours ago — should NOT be expired (> not >=)
            const exactlyEightHours = Date.now() - 8 * 60 * 60 * 1000;
            const player = createMockPlayer({ createdAt: exactlyEightHours });
            const result = sessionValidator.validateSessionAge(player as any);
            expect(result.valid).toBe(true);
        });

        test('returns valid for session just past the age limit', () => {
            const justPastLimit = Date.now() - (8 * 60 * 60 * 1000 + 1);
            const player = createMockPlayer({ createdAt: justPastLimit });
            const result = sessionValidator.validateSessionAge(player as any);
            expect(result.valid).toBe(false);
            expect(result.reason).toBe('SESSION_EXPIRED');
        });

        test('returns valid for legacy player without createdAt (allows but logs)', () => {
            const player = createMockPlayer({ createdAt: undefined });
            const result = sessionValidator.validateSessionAge(player as any);
            expect(result.valid).toBe(true);
            expect(logger.debug).toHaveBeenCalledWith(
                'Session has no createdAt timestamp',
                expect.objectContaining({ sessionId: VALID_UUID })
            );
        });

        test('does not use connectedAt as fallback for age check', () => {
            // Player with no createdAt but recent connectedAt — should still
            // be treated as legacy (valid), not validated by connectedAt
            const player = createMockPlayer({
                createdAt: undefined,
                connectedAt: Date.now() - 1000,
            });
            const result = sessionValidator.validateSessionAge(player as any);
            expect(result.valid).toBe(true);
        });
    });

    // =========================================================================
    // validateIPConsistency
    // =========================================================================
    describe('validateIPConsistency', () => {
        test('returns valid when IPs match', () => {
            const player = createMockPlayer({ lastIP: '192.168.1.1' });
            const result = sessionValidator.validateIPConsistency(player as any, '192.168.1.1');
            expect(result.valid).toBe(true);
            expect(result.ipMismatch).toBe(false);
        });

        test('returns valid when player has no lastIP', () => {
            const player = createMockPlayer({ lastIP: undefined });
            const result = sessionValidator.validateIPConsistency(player as any, '10.0.0.1');
            expect(result.valid).toBe(true);
            expect(result.ipMismatch).toBe(false);
        });

        test('returns invalid when IPs differ and IP_MISMATCH_ALLOWED is false', () => {
            ipMismatchAllowed = false;
            const player = createMockPlayer({ lastIP: '192.168.1.1' });
            const result = sessionValidator.validateIPConsistency(player as any, '10.0.0.99');
            expect(result.valid).toBe(false);
            expect(result.ipMismatch).toBe(true);
            expect(logger.warn).toHaveBeenCalledWith(
                'IP mismatch on session reconnection',
                expect.objectContaining({
                    sessionId: VALID_UUID,
                    previousIP: '192.168.1.1',
                    currentIP: '10.0.0.99',
                })
            );
        });

        test('returns valid with ipMismatch flag when IPs differ and IP_MISMATCH_ALLOWED is true', () => {
            ipMismatchAllowed = true;
            const player = createMockPlayer({ lastIP: '192.168.1.1' });
            const result = sessionValidator.validateIPConsistency(player as any, '10.0.0.99');
            expect(result.valid).toBe(true);
            expect(result.ipMismatch).toBe(true);
        });
    });

    // =========================================================================
    // validateSession (full pipeline)
    // =========================================================================
    describe('validateSession', () => {
        test('returns rate limited when rate limit exceeded', async () => {
            mockRedis.eval.mockResolvedValue(21);

            const result = await sessionValidator.validateSession(VALID_UUID, '10.0.0.1');

            expect(result.valid).toBe(false);
            expect(result.reason).toBe('SESSION_VALIDATION_RATE_LIMITED');
        });

        test('returns SESSION_NOT_FOUND when player does not exist', async () => {
            mockRedis.eval.mockResolvedValue(1);
            playerService.getPlayer.mockResolvedValue(null);

            const result = await sessionValidator.validateSession(VALID_UUID, '10.0.0.1');

            expect(result.valid).toBe(false);
            expect(result.reason).toBe('SESSION_NOT_FOUND');
        });

        test('returns SESSION_EXPIRED when session is too old', async () => {
            mockRedis.eval.mockResolvedValue(1);
            const oldPlayer = createMockPlayer({
                createdAt: Date.now() - 9 * 60 * 60 * 1000,
            });
            playerService.getPlayer.mockResolvedValue(oldPlayer);

            const result = await sessionValidator.validateSession(VALID_UUID, '10.0.0.1');

            expect(result.valid).toBe(false);
            expect(result.reason).toBe('SESSION_EXPIRED');
        });

        test('returns NOT_AUTHORIZED when IP mismatch and not allowed', async () => {
            ipMismatchAllowed = false;
            mockRedis.eval.mockResolvedValue(1);
            const player = createMockPlayer({ lastIP: '192.168.1.1' });
            playerService.getPlayer.mockResolvedValue(player);

            const result = await sessionValidator.validateSession(VALID_UUID, '10.0.0.99');

            expect(result.valid).toBe(false);
            expect(result.reason).toBe('NOT_AUTHORIZED');
        });

        test('returns valid with player when all checks pass', async () => {
            mockRedis.eval.mockResolvedValue(1);
            const player = createMockPlayer({ lastIP: '10.0.0.1' });
            playerService.getPlayer.mockResolvedValue(player);

            const result = await sessionValidator.validateSession(VALID_UUID, '10.0.0.1');

            expect(result.valid).toBe(true);
            expect(result.player).toEqual(player);
            expect(result.ipMismatch).toBe(false);
        });

        test('returns valid with ipMismatch flag when IP differs and allowed', async () => {
            ipMismatchAllowed = true;
            mockRedis.eval.mockResolvedValue(1);
            const player = createMockPlayer({ lastIP: '192.168.1.1' });
            playerService.getPlayer.mockResolvedValue(player);

            const result = await sessionValidator.validateSession(VALID_UUID, '10.0.0.99');

            expect(result.valid).toBe(true);
            expect(result.ipMismatch).toBe(true);
            expect(result.player).toEqual(player);
        });
    });

    // =========================================================================
    // validateRoomReconnectToken
    // =========================================================================
    describe('validateRoomReconnectToken', () => {
        const validToken = 'a'.repeat(64); // 32 bytes * 2 hex chars = 64

        test('returns true when no token provided and playerService accepts', async () => {
            playerService.validateSocketAuthToken.mockResolvedValue(true);

            const result = await sessionValidator.validateRoomReconnectToken(VALID_UUID, undefined, '10.0.0.1');

            expect(result).toBe(true);
            expect(playerService.validateSocketAuthToken).toHaveBeenCalledWith(VALID_UUID, undefined);
        });

        test('returns true when valid token provided and playerService accepts', async () => {
            playerService.validateSocketAuthToken.mockResolvedValue(true);

            const result = await sessionValidator.validateRoomReconnectToken(VALID_UUID, validToken, '10.0.0.1');

            expect(result).toBe(true);
        });

        test('returns false for token with wrong length', async () => {
            const shortToken = 'abcdef1234';

            const result = await sessionValidator.validateRoomReconnectToken(VALID_UUID, shortToken, '10.0.0.1');

            expect(result).toBe(false);
            expect(logger.warn).toHaveBeenCalledWith(
                'Invalid reconnection token format',
                expect.objectContaining({
                    sessionId: VALID_UUID,
                    tokenLength: shortToken.length,
                    expectedLength: 64,
                })
            );
            // playerService should NOT be called for invalid format
            expect(playerService.validateSocketAuthToken).not.toHaveBeenCalled();
        });

        test('returns false for token with non-hex characters', async () => {
            const nonHexToken = 'g'.repeat(64); // 'g' is not hex

            const result = await sessionValidator.validateRoomReconnectToken(VALID_UUID, nonHexToken, '10.0.0.1');

            expect(result).toBe(false);
            expect(playerService.validateSocketAuthToken).not.toHaveBeenCalled();
        });

        test('accepts uppercase hex characters in token', async () => {
            const upperHexToken = 'ABCDEF0123456789'.repeat(4); // 64 chars
            playerService.validateSocketAuthToken.mockResolvedValue(true);

            const result = await sessionValidator.validateRoomReconnectToken(VALID_UUID, upperHexToken, '10.0.0.1');

            expect(result).toBe(true);
        });

        test('returns false when playerService rejects the token', async () => {
            playerService.validateSocketAuthToken.mockResolvedValue(false);

            const result = await sessionValidator.validateRoomReconnectToken(VALID_UUID, validToken, '10.0.0.1');

            expect(result).toBe(false);
            expect(logger.warn).toHaveBeenCalledWith(
                'Reconnection token validation failed',
                expect.objectContaining({
                    sessionId: VALID_UUID,
                    hasToken: true,
                    clientIP: '10.0.0.1',
                })
            );
        });

        test('returns false when no token and playerService rejects', async () => {
            playerService.validateSocketAuthToken.mockResolvedValue(false);

            const result = await sessionValidator.validateRoomReconnectToken(VALID_UUID, undefined, '10.0.0.1');

            expect(result).toBe(false);
            expect(logger.warn).toHaveBeenCalledWith(
                'Reconnection token validation failed',
                expect.objectContaining({
                    hasToken: false,
                })
            );
        });
    });

    // =========================================================================
    // resolveSessionId
    // =========================================================================
    describe('resolveSessionId', () => {
        test('returns null session when no sessionId provided', async () => {
            const result = await sessionValidator.resolveSessionId({}, '10.0.0.1');

            expect(result.validatedSessionId).toBeNull();
            expect(result.sessionValidation).toBeNull();
            expect(result.ipMismatch).toBe(false);
        });

        test('returns null session for invalid UUID format', async () => {
            const result = await sessionValidator.resolveSessionId({ sessionId: 'not-a-valid-uuid' }, '10.0.0.1');

            expect(result.validatedSessionId).toBeNull();
            expect(logger.warn).toHaveBeenCalledWith(
                'Invalid session ID format rejected',
                expect.objectContaining({ clientIP: '10.0.0.1' })
            );
        });

        test('returns sessionId when player does not exist (fresh join)', async () => {
            playerService.getPlayer.mockResolvedValue(null);

            const result = await sessionValidator.resolveSessionId({ sessionId: VALID_UUID }, '10.0.0.1');

            expect(result.validatedSessionId).toBe(VALID_UUID);
            expect(result.sessionValidation).toBeNull();
            expect(result.ipMismatch).toBe(false);
        });

        test('allows connected player reconnection from same IP', async () => {
            const player = createMockPlayer({
                connected: true,
                lastIP: '10.0.0.1',
            });
            playerService.getPlayer.mockResolvedValue(player);

            const result = await sessionValidator.resolveSessionId({ sessionId: VALID_UUID }, '10.0.0.1');

            expect(result.validatedSessionId).toBe(VALID_UUID);
            expect(result.sessionValidation).toEqual({
                valid: true,
                player,
            });
            expect(result.ipMismatch).toBe(false);
            expect(logger.info).toHaveBeenCalledWith(
                'Allowing session continuity from same IP (previous socket still connected)',
                expect.any(Object)
            );
        });

        test('allows connected player with no recorded IP', async () => {
            const player = createMockPlayer({
                connected: true,
                lastIP: undefined,
            });
            playerService.getPlayer.mockResolvedValue(player);

            const result = await sessionValidator.resolveSessionId({ sessionId: VALID_UUID }, '10.0.0.1');

            expect(result.validatedSessionId).toBe(VALID_UUID);
            expect(result.sessionValidation?.valid).toBe(true);
        });

        test('blocks connected player reconnection from different IP (hijack attempt)', async () => {
            const player = createMockPlayer({
                connected: true,
                lastIP: '192.168.1.1',
            });
            playerService.getPlayer.mockResolvedValue(player);

            const result = await sessionValidator.resolveSessionId({ sessionId: VALID_UUID }, '10.0.0.99');

            expect(result.validatedSessionId).toBeNull();
            expect(result.sessionValidation).toBeNull();
            expect(logger.warn).toHaveBeenCalledWith(
                'Session hijacking attempt blocked: different IP',
                expect.objectContaining({
                    sessionId: VALID_UUID,
                    clientIP: '10.0.0.99',
                    existingIP: '192.168.1.1',
                })
            );
        });

        test('performs full validation for disconnected player and allows on success', async () => {
            const player = createMockPlayer({
                connected: false,
                lastIP: '10.0.0.1',
                createdAt: Date.now() - 1000,
            });
            // getPlayer is called twice: once in resolveSessionId, once in validateSession
            playerService.getPlayer.mockResolvedValue(player);
            mockRedis.eval.mockResolvedValue(1); // rate limit ok

            const result = await sessionValidator.resolveSessionId({ sessionId: VALID_UUID }, '10.0.0.1');

            expect(result.validatedSessionId).toBe(VALID_UUID);
            expect(result.sessionValidation?.valid).toBe(true);
            expect(result.ipMismatch).toBe(false);
        });

        test('returns null when disconnected player fails session validation (expired)', async () => {
            const expiredPlayer = createMockPlayer({
                connected: false,
                lastIP: '10.0.0.1',
                createdAt: Date.now() - 9 * 60 * 60 * 1000,
            });
            playerService.getPlayer.mockResolvedValue(expiredPlayer);
            mockRedis.eval.mockResolvedValue(1);

            const result = await sessionValidator.resolveSessionId({ sessionId: VALID_UUID }, '10.0.0.1');

            expect(result.validatedSessionId).toBeNull();
            expect(logger.warn).toHaveBeenCalledWith(
                'Session validation failed',
                expect.objectContaining({
                    reason: 'SESSION_EXPIRED',
                })
            );
        });

        test('returns null when disconnected player fails rate limit', async () => {
            const player = createMockPlayer({ connected: false });
            playerService.getPlayer.mockResolvedValue(player);
            mockRedis.eval.mockResolvedValue(21); // exceeds rate limit

            const result = await sessionValidator.resolveSessionId({ sessionId: VALID_UUID }, '10.0.0.1');

            expect(result.validatedSessionId).toBeNull();
        });

        test('truncates invalid session ID in log output', async () => {
            const longInvalidId = 'abcdefghijklmnop1234567890';

            await sessionValidator.resolveSessionId({ sessionId: longInvalidId }, '10.0.0.1');

            expect(logger.warn).toHaveBeenCalledWith(
                'Invalid session ID format rejected',
                expect.objectContaining({
                    sessionId: 'abcdefghij...',
                })
            );
        });

        test('sets ipMismatch flag when validation reports IP mismatch', async () => {
            ipMismatchAllowed = true;
            const player = createMockPlayer({
                connected: false,
                lastIP: '192.168.1.1',
                createdAt: Date.now() - 1000,
            });
            playerService.getPlayer.mockResolvedValue(player);
            mockRedis.eval.mockResolvedValue(1);

            const result = await sessionValidator.resolveSessionId({ sessionId: VALID_UUID }, '10.0.0.99');

            expect(result.validatedSessionId).toBe(VALID_UUID);
            expect(result.ipMismatch).toBe(true);
        });
    });

    // =========================================================================
    // Edge cases
    // =========================================================================
    describe('edge cases', () => {
        test('empty string sessionId is treated as no session', async () => {
            const result = await sessionValidator.resolveSessionId({ sessionId: '' }, '10.0.0.1');
            // Empty string is falsy so should take the "no session ID" path
            expect(result.validatedSessionId).toBeNull();
            expect(result.sessionValidation).toBeNull();
        });

        test('reconnection token with exactly correct length but mixed case hex passes format check', async () => {
            const mixedCaseToken = 'aAbBcCdD0011223344556677'.padEnd(64, 'f');
            playerService.validateSocketAuthToken.mockResolvedValue(true);

            const result = await sessionValidator.validateRoomReconnectToken(VALID_UUID, mixedCaseToken, '10.0.0.1');

            expect(result).toBe(true);
        });
    });
});
