/**
 * Security Hardening Tests (Sprint 8)
 *
 * Comprehensive tests for:
 * - Trust proxy configuration
 * - Input validation (clue numbers, nicknames, etc.)
 * - IP-based rate limiting
 * - Session security
 */

const { VALIDATION, BOARD_SIZE, SESSION_SECURITY } = require('../config/constants');

// ============================================
// TRUST PROXY CONFIGURATION TESTS
// ============================================

describe('Trust Proxy Configuration', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        jest.resetModules();
        process.env = { ...originalEnv };
        // Clear all relevant env vars
        delete process.env.TRUST_PROXY;
        delete process.env.FLY_APP_NAME;
        delete process.env.DYNO;
    });

    afterAll(() => {
        process.env = originalEnv;
    });

    describe('shouldTrustProxy behavior', () => {
        test('does not trust proxy by default', () => {
            const { getClientIP } = require('../middleware/socketAuth');

            const mockSocket = {
                handshake: {
                    headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' },
                    address: '127.0.0.1'
                }
            };

            // Without trust proxy, should return direct address
            const ip = getClientIP(mockSocket);
            expect(ip).toBe('127.0.0.1');
        });

        test('trusts proxy when TRUST_PROXY=true', () => {
            process.env.TRUST_PROXY = 'true';
            jest.resetModules();
            const { getClientIP } = require('../middleware/socketAuth');

            const mockSocket = {
                handshake: {
                    headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' },
                    address: '127.0.0.1'
                }
            };

            const ip = getClientIP(mockSocket);
            expect(ip).toBe('1.2.3.4'); // First IP in chain
        });

        test('trusts proxy when TRUST_PROXY=1', () => {
            process.env.TRUST_PROXY = '1';
            jest.resetModules();
            const { getClientIP } = require('../middleware/socketAuth');

            const mockSocket = {
                handshake: {
                    headers: { 'x-forwarded-for': '203.0.113.50' },
                    address: '10.0.0.1'
                }
            };

            const ip = getClientIP(mockSocket);
            expect(ip).toBe('203.0.113.50');
        });

        test('auto-trusts proxy on Fly.io (FLY_APP_NAME)', () => {
            process.env.FLY_APP_NAME = 'my-app';
            jest.resetModules();
            const { getClientIP } = require('../middleware/socketAuth');

            const mockSocket = {
                handshake: {
                    headers: { 'x-forwarded-for': '8.8.8.8' },
                    address: '172.16.0.1'
                }
            };

            const ip = getClientIP(mockSocket);
            expect(ip).toBe('8.8.8.8');
        });

        test('auto-trusts proxy on Heroku (DYNO)', () => {
            process.env.DYNO = 'web.1';
            jest.resetModules();
            const { getClientIP } = require('../middleware/socketAuth');

            const mockSocket = {
                handshake: {
                    headers: { 'x-forwarded-for': '192.0.2.1' },
                    address: '10.0.0.1'
                }
            };

            const ip = getClientIP(mockSocket);
            expect(ip).toBe('192.0.2.1');
        });

        test('handles missing X-Forwarded-For header', () => {
            process.env.TRUST_PROXY = 'true';
            jest.resetModules();
            const { getClientIP } = require('../middleware/socketAuth');

            const mockSocket = {
                handshake: {
                    headers: {},
                    address: '192.168.1.1'
                }
            };

            const ip = getClientIP(mockSocket);
            expect(ip).toBe('192.168.1.1');
        });

        test('handles multiple IPs in X-Forwarded-For correctly', () => {
            process.env.TRUST_PROXY = 'true';
            jest.resetModules();
            const { getClientIP } = require('../middleware/socketAuth');

            const mockSocket = {
                handshake: {
                    headers: { 'x-forwarded-for': '  203.0.113.1  ,  198.51.100.1  ,  192.0.2.1  ' },
                    address: '10.0.0.1'
                }
            };

            const ip = getClientIP(mockSocket);
            expect(ip).toBe('203.0.113.1'); // First IP, trimmed
        });
    });
});

// ============================================
// INPUT VALIDATION TESTS
// ============================================

describe('Input Validation Hardening', () => {
    const schemas = require('../validators/schemas');

    describe('Clue Number Validation', () => {
        test('accepts valid clue numbers (0-25)', () => {
            const validNumbers = [0, 1, 5, 10, 15, 20, 25];

            for (const num of validNumbers) {
                const result = schemas.gameClueSchema.safeParse({
                    word: 'Test',
                    number: num
                });
                expect(result.success).toBe(true);
            }
        });

        test('rejects negative clue numbers', () => {
            const result = schemas.gameClueSchema.safeParse({
                word: 'Test',
                number: -1
            });
            expect(result.success).toBe(false);
        });

        test('rejects clue numbers greater than 25', () => {
            const result = schemas.gameClueSchema.safeParse({
                word: 'Test',
                number: 26
            });
            expect(result.success).toBe(false);
        });

        test('rejects non-integer clue numbers', () => {
            const result = schemas.gameClueSchema.safeParse({
                word: 'Test',
                number: 2.5
            });
            expect(result.success).toBe(false);
        });

        test('rejects NaN and Infinity', () => {
            const invalidNumbers = [NaN, Infinity, -Infinity];

            for (const num of invalidNumbers) {
                const result = schemas.gameClueSchema.safeParse({
                    word: 'Test',
                    number: num
                });
                expect(result.success).toBe(false);
            }
        });
    });

    describe('Card Index Validation', () => {
        test('accepts valid card indices (0-24)', () => {
            for (let i = 0; i < BOARD_SIZE; i++) {
                const result = schemas.gameRevealSchema.safeParse({ index: i });
                expect(result.success).toBe(true);
            }
        });

        test('rejects negative indices', () => {
            const result = schemas.gameRevealSchema.safeParse({ index: -1 });
            expect(result.success).toBe(false);
        });

        test('rejects indices >= BOARD_SIZE', () => {
            const result = schemas.gameRevealSchema.safeParse({ index: 25 });
            expect(result.success).toBe(false);
        });

        test('rejects non-integer indices', () => {
            const result = schemas.gameRevealSchema.safeParse({ index: 1.5 });
            expect(result.success).toBe(false);
        });
    });

    describe('Nickname Validation', () => {
        const VALID_ROOM_ID = 'test-room'; // Valid room ID for all nickname tests

        test('accepts valid nicknames', () => {
            const validNames = ['Player1', 'JohnDoe', 'test-user', 'user_123'];

            for (const name of validNames) {
                const result = schemas.roomJoinSchema.safeParse({
                    roomId: VALID_ROOM_ID,
                    nickname: name
                });
                expect(result.success).toBe(true);
            }
        });

        test('rejects nicknames with special characters (XSS prevention)', () => {
            // Note: control chars are removed by transform, so test chars that remain invalid
            const maliciousNames = [
                '<script>alert(1)</script>',
                'user<img src=x>',
                'name"; DROP TABLE',
                'test@user.com'
            ];

            for (const name of maliciousNames) {
                const result = schemas.roomJoinSchema.safeParse({
                    roomId: VALID_ROOM_ID,
                    nickname: name
                });
                expect(result.success).toBe(false);
            }
        });

        test('control characters are removed before validation', () => {
            // Control chars are stripped by removeControlChars transform
            const result = schemas.roomJoinSchema.safeParse({
                roomId: VALID_ROOM_ID,
                nickname: 'test\x00null'  // Becomes 'testnull' after transform
            });
            // Passes because control chars are removed, leaving valid 'testnull'
            expect(result.success).toBe(true);
        });

        test('rejects empty nicknames', () => {
            const result = schemas.roomJoinSchema.safeParse({
                roomId: VALID_ROOM_ID,
                nickname: ''
            });
            expect(result.success).toBe(false);
        });

        test('rejects nicknames that are only whitespace', () => {
            const result = schemas.roomJoinSchema.safeParse({
                roomId: VALID_ROOM_ID,
                nickname: '   '
            });
            expect(result.success).toBe(false);
        });

        test('rejects nicknames exceeding max length', () => {
            const longName = 'a'.repeat(VALIDATION.NICKNAME_MAX_LENGTH + 1);
            const result = schemas.roomJoinSchema.safeParse({
                roomId: VALID_ROOM_ID,
                nickname: longName
            });
            expect(result.success).toBe(false);
        });
    });

    describe('Clue Word Validation', () => {
        test('accepts valid clue words', () => {
            const validClues = ['apple', 'ice-cream', "o'brien", 'New York'];

            for (const word of validClues) {
                const result = schemas.gameClueSchema.safeParse({
                    word,
                    number: 2
                });
                expect(result.success).toBe(true);
            }
        });

        test('rejects clue words with numbers', () => {
            const result = schemas.gameClueSchema.safeParse({
                word: 'test123',
                number: 2
            });
            expect(result.success).toBe(false);
        });

        test('rejects empty clue words', () => {
            const result = schemas.gameClueSchema.safeParse({
                word: '',
                number: 2
            });
            expect(result.success).toBe(false);
        });

        test('rejects clue words exceeding max length', () => {
            const longWord = 'a'.repeat(VALIDATION.CLUE_MAX_LENGTH + 1);
            const result = schemas.gameClueSchema.safeParse({
                word: longWord,
                number: 2
            });
            expect(result.success).toBe(false);
        });
    });

    describe('Room ID Validation', () => {
        test('accepts valid room IDs', () => {
            // Room IDs can contain letters, numbers, hyphens, and underscores
            const validIds = ['my-game', 'room123', 'test_room', 'MyRoom', 'game-room-1'];

            for (const roomId of validIds) {
                const result = schemas.roomJoinSchema.safeParse({
                    roomId,
                    nickname: 'Player'
                });
                expect(result.success).toBe(true);
            }
        });

        test('trims room ID whitespace', () => {
            const result = schemas.roomJoinSchema.safeParse({
                roomId: '  my-room  ',
                nickname: 'Player'
            });
            expect(result.success).toBe(true);
            expect(result.data.roomId).toBe('my-room');
        });

        test('rejects room IDs with invalid characters', () => {
            const invalidIds = ['room@123', 'game!test', 'my room', 'test.room'];

            for (const roomId of invalidIds) {
                const result = schemas.roomJoinSchema.safeParse({
                    roomId,
                    nickname: 'Player'
                });
                expect(result.success).toBe(false);
            }
        });

        test('accepts room IDs with hyphens and underscores', () => {
            const result = schemas.roomJoinSchema.safeParse({
                roomId: 'my-game_123',
                nickname: 'Player'
            });
            expect(result.success).toBe(true);
        });

        test('rejects room IDs with wrong length', () => {
            const wrongLengths = ['AB', 'A'.repeat(21)];

            for (const roomId of wrongLengths) {
                const result = schemas.roomJoinSchema.safeParse({
                    roomId,
                    nickname: 'Player'
                });
                expect(result.success).toBe(false);
            }
        });
    });

    describe('Team Name Validation', () => {
        test('accepts valid team names', () => {
            const result = schemas.roomSettingsSchema.safeParse({
                teamNames: { red: 'Dragons', blue: 'Knights' }
            });
            expect(result.success).toBe(true);
        });

        test('rejects team names with special characters', () => {
            const result = schemas.roomSettingsSchema.safeParse({
                teamNames: { red: '<script>', blue: 'Normal' }
            });
            expect(result.success).toBe(false);
        });

        test('rejects team names exceeding max length', () => {
            const longName = 'a'.repeat(VALIDATION.TEAM_NAME_MAX_LENGTH + 1);
            const result = schemas.roomSettingsSchema.safeParse({
                teamNames: { red: longName, blue: 'Normal' }
            });
            expect(result.success).toBe(false);
        });
    });
});

// ============================================
// IP-BASED RATE LIMITING TESTS
// ============================================

describe('IP-Based Rate Limiting', () => {
    const { createSocketRateLimiter } = require('../middleware/rateLimit');

    test('creates socket rate limiter with IP tracking', () => {
        const limits = {
            'test:event': { window: 1000, max: 2 }
        };

        const limiter = createSocketRateLimiter(limits);

        expect(limiter.getLimiter).toBeDefined();
        expect(limiter.cleanupSocket).toBeDefined();
        expect(limiter.getMetrics).toBeDefined();
    });

    test('rate limits per socket', (done) => {
        const limits = {
            'test:event': { window: 1000, max: 2 }
        };

        const limiter = createSocketRateLimiter(limits);
        const socketLimiter = limiter.getLimiter('test:event');

        const mockSocket = {
            id: 'socket-1',
            clientIP: '192.168.1.1',
            handshake: { address: '192.168.1.1' }
        };

        let callCount = 0;
        const next = (error) => {
            callCount++;
            if (callCount === 3) {
                expect(error).toBeDefined();
                expect(error.message).toContain('Rate limit');
                done();
            }
        };

        // First two requests should succeed
        socketLimiter(mockSocket, {}, next);
        socketLimiter(mockSocket, {}, next);
        // Third should be rate limited
        socketLimiter(mockSocket, {}, next);
    });

    test('rate limits per IP across multiple sockets', (done) => {
        const limits = {
            'test:event': { window: 1000, max: 1 } // 1 per socket, 5 per IP
        };

        const limiter = createSocketRateLimiter(limits);
        const socketLimiter = limiter.getLimiter('test:event');

        const sameIP = '10.0.0.1';
        const sockets = Array.from({ length: 6 }, (_, i) => ({
            id: `socket-${i}`,
            clientIP: sameIP,
            handshake: { address: sameIP }
        }));

        let successCount = 0;
        let errorCount = 0;

        sockets.forEach((socket, index) => {
            socketLimiter(socket, {}, (error) => {
                if (error) {
                    errorCount++;
                } else {
                    successCount++;
                }

                if (index === sockets.length - 1) {
                    // First 5 should succeed (IP limit = socket limit * 5)
                    expect(successCount).toBe(5);
                    expect(errorCount).toBe(1);
                    done();
                }
            });
        });
    });

    test('tracks metrics correctly', () => {
        const limits = {
            'test:event': { window: 1000, max: 10 }
        };

        const limiter = createSocketRateLimiter(limits);
        const socketLimiter = limiter.getLimiter('test:event');

        const mockSocket = {
            id: 'socket-metrics',
            clientIP: '192.168.1.100',
            handshake: { address: '192.168.1.100' }
        };

        // Make some requests
        for (let i = 0; i < 5; i++) {
            socketLimiter(mockSocket, {}, () => {});
        }

        const metrics = limiter.getMetrics();

        expect(metrics.totalRequests).toBe(5);
        expect(metrics.uniqueSockets.size || metrics.uniqueSockets).toBe(1);
        expect(metrics.uniqueIPs.size || metrics.uniqueIPs).toBe(1);
    });

    test('cleans up socket entries on disconnect', () => {
        const limits = {
            'test:event': { window: 60000, max: 10 }
        };

        const limiter = createSocketRateLimiter(limits);
        const socketLimiter = limiter.getLimiter('test:event');

        const mockSocket = {
            id: 'socket-cleanup',
            clientIP: '192.168.1.200',
            handshake: { address: '192.168.1.200' }
        };

        // Make request
        socketLimiter(mockSocket, {}, () => {});

        const sizeBefore = limiter.getSize();
        expect(sizeBefore).toBeGreaterThan(0);

        // Cleanup socket
        limiter.cleanupSocket('socket-cleanup');

        // Size should decrease
        const sizeAfter = limiter.getSize();
        expect(sizeAfter).toBeLessThan(sizeBefore);
    });
});

// ============================================
// SESSION SECURITY TESTS
// ============================================

describe('Session Security', () => {
    describe('Session ID Validation', () => {
        const { validate: isValidUuid } = require('uuid');

        test('accepts valid UUID session IDs', () => {
            const validIds = [
                '550e8400-e29b-41d4-a716-446655440000',
                'f47ac10b-58cc-4372-a567-0e02b2c3d479'
            ];

            for (const id of validIds) {
                expect(isValidUuid(id)).toBe(true);
            }
        });

        test('rejects invalid session ID formats', () => {
            const invalidIds = [
                'not-a-uuid',
                '12345',
                '',
                'sql-injection-attempt',
                '<script>alert(1)</script>'
            ];

            for (const id of invalidIds) {
                expect(isValidUuid(id)).toBe(false);
            }
        });

        test('rejects null and undefined', () => {
            expect(isValidUuid(null)).toBe(false);
            expect(isValidUuid(undefined)).toBe(false);
        });
    });

    describe('Session Security Constants', () => {
        test('has reasonable max session age', () => {
            expect(SESSION_SECURITY.MAX_SESSION_AGE_MS).toBeGreaterThan(0);
            // Should be at least 1 hour
            expect(SESSION_SECURITY.MAX_SESSION_AGE_MS).toBeGreaterThanOrEqual(60 * 60 * 1000);
            // Should be at most 7 days
            expect(SESSION_SECURITY.MAX_SESSION_AGE_MS).toBeLessThanOrEqual(7 * 24 * 60 * 60 * 1000);
        });

        test('has validation rate limit configured', () => {
            expect(SESSION_SECURITY.MAX_VALIDATION_ATTEMPTS_PER_IP).toBeGreaterThan(0);
            expect(SESSION_SECURITY.MAX_VALIDATION_ATTEMPTS_PER_IP).toBeLessThanOrEqual(100);
        });

        test('has IP mismatch policy defined', () => {
            expect(typeof SESSION_SECURITY.IP_MISMATCH_ALLOWED).toBe('boolean');
        });

        test('has session ID length defined', () => {
            expect(SESSION_SECURITY.SESSION_ID_MIN_LENGTH).toBe(36); // UUID length
        });
    });

    describe('getClientIP function', () => {
        const originalEnv = process.env;

        beforeEach(() => {
            jest.resetModules();
            process.env = { ...originalEnv };
            delete process.env.TRUST_PROXY;
            delete process.env.FLY_APP_NAME;
            delete process.env.DYNO;
        });

        afterAll(() => {
            process.env = originalEnv;
        });

        test('returns direct address when proxy not trusted', () => {
            const { getClientIP } = require('../middleware/socketAuth');

            const mockSocket = {
                handshake: {
                    headers: { 'x-forwarded-for': 'spoofed-ip' },
                    address: '127.0.0.1'
                }
            };

            expect(getClientIP(mockSocket)).toBe('127.0.0.1');
        });

        test('handles missing address gracefully', () => {
            const { getClientIP } = require('../middleware/socketAuth');

            const mockSocket = {
                handshake: {
                    headers: {},
                    address: undefined
                }
            };

            // Should not throw
            expect(() => getClientIP(mockSocket)).not.toThrow();
        });
    });
});

// ============================================
// RESERVED NAME BLOCKING TESTS
// ============================================

describe('Reserved Name Blocking', () => {
    const { isReservedName } = require('../utils/sanitize');
    const { RESERVED_NAMES } = require('../config/constants');

    test('blocks all reserved names (case-insensitive)', () => {
        for (const name of RESERVED_NAMES) {
            expect(isReservedName(name, RESERVED_NAMES)).toBe(true);
            expect(isReservedName(name.toUpperCase(), RESERVED_NAMES)).toBe(true);
            expect(isReservedName(name.toLowerCase(), RESERVED_NAMES)).toBe(true);
        }
    });

    test('allows non-reserved names', () => {
        const allowedNames = ['Player1', 'JohnDoe', 'TestUser', 'Gamer'];

        for (const name of allowedNames) {
            expect(isReservedName(name, RESERVED_NAMES)).toBe(false);
        }
    });
});

// ============================================
// CONTROL CHARACTER SANITIZATION TESTS
// ============================================

describe('Control Character Sanitization', () => {
    const { removeControlChars } = require('../utils/sanitize');

    test('removes null bytes', () => {
        const result = removeControlChars('test\x00string');
        expect(result).toBe('teststring');
    });

    test('removes control characters', () => {
        const result = removeControlChars('test\x01\x02\x03string');
        expect(result).toBe('teststring');
    });

    test('preserves normal whitespace', () => {
        const result = removeControlChars('test string');
        expect(result).toBe('test string');
    });

    test('removes escape sequences', () => {
        const result = removeControlChars('test\x1bstring');
        expect(result).toBe('teststring');
    });
});
