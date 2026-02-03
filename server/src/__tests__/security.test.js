/**
 * Security Tests - Phase 2 Security Hardening
 *
 * Tests for:
 * - Sanitization utilities
 * - JWT configuration
 * - Session validation
 * - Reserved names
 * - Input validation hardening
 */

const {
    sanitizeHtml,
    sanitizeForLog,
    removeControlChars,
    isReservedName
} = require('../utils/sanitize');

const {
    JWT_CONFIG,
    MIN_SECRET_LENGTH,
    getJwtSecret: _getJwtSecret,
    isJwtEnabled: _isJwtEnabled,
    signToken: _signToken,
    verifyToken: _verifyToken,
    decodeToken,
    generateSessionToken: _generateSessionToken
} = require('../config/jwt');

const { RESERVED_NAMES } = require('../config/constants');

describe('Sanitization Utilities', () => {
    describe('sanitizeHtml', () => {
        test('escapes HTML special characters', () => {
            expect(sanitizeHtml('<script>alert("xss")</script>'))
                .toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;&#x2F;script&gt;');
        });

        test('escapes ampersands', () => {
            expect(sanitizeHtml('foo & bar')).toBe('foo &amp; bar');
        });

        test('escapes single quotes', () => {
            expect(sanitizeHtml("it's")).toBe('it&#x27;s');
        });

        test('handles empty string', () => {
            expect(sanitizeHtml('')).toBe('');
        });

        test('handles non-string input', () => {
            expect(sanitizeHtml(null)).toBe('');
            expect(sanitizeHtml(undefined)).toBe('');
            expect(sanitizeHtml(123)).toBe('');
        });
    });

    describe('sanitizeForLog', () => {
        test('redacts password fields', () => {
            const result = sanitizeForLog({ username: 'user', password: 'secret' });
            expect(result.username).toBe('user');
            expect(result.password).toBe('[REDACTED]');
        });

        test('redacts token fields', () => {
            const result = sanitizeForLog({ userId: '123', token: 'jwt-token-here' });
            expect(result.userId).toBe('123');
            expect(result.token).toBe('[REDACTED]');
        });

        test('redacts nested sensitive fields', () => {
            const result = sanitizeForLog({
                user: { name: 'John', authToken: 'secret' }
            });
            expect(result.user.name).toBe('John');
            expect(result.user.authToken).toBe('[REDACTED]');
        });

        test('handles null input', () => {
            expect(sanitizeForLog(null)).toBeNull();
        });

        test('handles non-object input', () => {
            expect(sanitizeForLog('string')).toBe('string');
        });
    });

    describe('removeControlChars', () => {
        test('removes null character', () => {
            expect(removeControlChars('hello\x00world')).toBe('helloworld');
        });

        test('removes bell character', () => {
            expect(removeControlChars('hello\x07world')).toBe('helloworld');
        });

        test('removes backspace', () => {
            expect(removeControlChars('hello\x08world')).toBe('helloworld');
        });

        test('preserves newlines', () => {
            expect(removeControlChars('hello\nworld')).toBe('hello\nworld');
        });

        test('preserves carriage returns', () => {
            expect(removeControlChars('hello\rworld')).toBe('hello\rworld');
        });

        test('handles empty string', () => {
            expect(removeControlChars('')).toBe('');
        });

        test('handles non-string input', () => {
            expect(removeControlChars(null)).toBe('');
        });
    });

    describe('isReservedName', () => {
        test('detects reserved names (exact match)', () => {
            expect(isReservedName('admin', RESERVED_NAMES)).toBe(true);
        });

        test('detects reserved names (case insensitive)', () => {
            expect(isReservedName('ADMIN', RESERVED_NAMES)).toBe(true);
            expect(isReservedName('Admin', RESERVED_NAMES)).toBe(true);
        });

        test('allows non-reserved names', () => {
            expect(isReservedName('player1', RESERVED_NAMES)).toBe(false);
        });

        test('handles whitespace in input', () => {
            expect(isReservedName('  admin  ', RESERVED_NAMES)).toBe(true);
        });

        test('handles non-string input', () => {
            expect(isReservedName(null, RESERVED_NAMES)).toBe(false);
        });

        test('checks all reserved names', () => {
            expect(isReservedName('system', RESERVED_NAMES)).toBe(true);
            expect(isReservedName('moderator', RESERVED_NAMES)).toBe(true);
            expect(isReservedName('bot', RESERVED_NAMES)).toBe(true);
        });
    });
});

describe('JWT Configuration', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        jest.resetModules();
        process.env = { ...originalEnv };
    });

    afterAll(() => {
        process.env = originalEnv;
    });

    describe('JWT_CONFIG', () => {
        test('has correct algorithm', () => {
            expect(JWT_CONFIG.algorithm).toBe('HS256');
        });

        test('has correct expiry', () => {
            expect(JWT_CONFIG.expiresIn).toBe('24h');
        });

        test('has issuer and audience', () => {
            expect(JWT_CONFIG.issuer).toBe('die-eigennamen');
            expect(JWT_CONFIG.audience).toBe('game-client');
        });
    });

    describe('MIN_SECRET_LENGTH', () => {
        test('requires at least 32 characters', () => {
            expect(MIN_SECRET_LENGTH).toBe(32);
        });
    });

    describe('signToken and verifyToken', () => {
        test('can sign and verify a token', () => {
            process.env.JWT_SECRET = 'a'.repeat(32);
            // Re-import to pick up new env
            jest.resetModules();
            const jwt = require('../config/jwt');

            const payload = { userId: '123', sessionId: 'abc' };
            const token = jwt.signToken(payload);

            expect(token).toBeDefined();

            const decoded = jwt.verifyToken(token);
            expect(decoded.userId).toBe('123');
            expect(decoded.sessionId).toBe('abc');
        });

        test('returns null for invalid token', () => {
            process.env.JWT_SECRET = 'a'.repeat(32);
            jest.resetModules();
            const jwt = require('../config/jwt');

            const decoded = jwt.verifyToken('invalid-token');
            expect(decoded).toBeNull();
        });
    });

    describe('decodeToken', () => {
        test('decodes without verification', () => {
            process.env.JWT_SECRET = 'a'.repeat(32);
            jest.resetModules();
            const jwt = require('../config/jwt');

            const token = jwt.signToken({ userId: '123' });
            const decoded = jwt.decodeToken(token);

            expect(decoded.userId).toBe('123');
        });

        test('returns null for malformed token', () => {
            const decoded = decodeToken('not-a-jwt');
            expect(decoded).toBeNull();
        });
    });

    describe('generateSessionToken', () => {
        test('creates token with session info', () => {
            process.env.JWT_SECRET = 'a'.repeat(32);
            jest.resetModules();
            const jwt = require('../config/jwt');

            const token = jwt.generateSessionToken('user123', 'session456');
            const decoded = jwt.verifyToken(token);

            expect(decoded.userId).toBe('user123');
            expect(decoded.sessionId).toBe('session456');
            expect(decoded.type).toBe('session');
        });

        test('includes additional claims', () => {
            process.env.JWT_SECRET = 'a'.repeat(32);
            jest.resetModules();
            const jwt = require('../config/jwt');

            const token = jwt.generateSessionToken('user123', 'session456', { nickname: 'Player1' });
            const decoded = jwt.verifyToken(token);

            expect(decoded.nickname).toBe('Player1');
        });
    });
});

describe('Reserved Names Validation', () => {
    test('all expected reserved names are present', () => {
        const expectedNames = [
            'admin', 'administrator', 'system', 'host', 'server',
            'mod', 'moderator', 'bot', 'codenames', 'game',
            'official', 'support', 'help', 'null', 'undefined'
        ];

        expectedNames.forEach(name => {
            expect(RESERVED_NAMES).toContain(name);
        });
    });

    test('reserved names are lowercase', () => {
        RESERVED_NAMES.forEach(name => {
            expect(name).toBe(name.toLowerCase());
        });
    });
});
