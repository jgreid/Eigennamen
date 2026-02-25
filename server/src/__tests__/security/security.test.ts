/**
 * Security Tests - Phase 2 Security Hardening
 *
 * Tests for:
 * - JWT configuration
 * - Session validation
 * - Reserved names
 * - Input validation hardening
 *
 * Note: Sanitization utility tests are in sanitize.test.ts
 */

const {
    JWT_CONFIG,
    MIN_SECRET_LENGTH,
    getJwtSecret: _getJwtSecret,
    isJwtEnabled: _isJwtEnabled,
    signToken: _signToken,
    verifyToken: _verifyToken,
    decodeToken,
    generateSessionToken: _generateSessionToken
} = require('../../config/jwt');

const { RESERVED_NAMES } = require('../../config/constants');

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
            expect(JWT_CONFIG.issuer).toBe('eigennamen');
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
            const jwt = require('../../config/jwt');

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
            const jwt = require('../../config/jwt');

            const decoded = jwt.verifyToken('invalid-token');
            expect(decoded).toBeNull();
        });
    });

    describe('decodeToken', () => {
        test('decodes without verification', () => {
            process.env.JWT_SECRET = 'a'.repeat(32);
            jest.resetModules();
            const jwt = require('../../config/jwt');

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
            const jwt = require('../../config/jwt');

            const token = jwt.generateSessionToken('user123', 'session456');
            const decoded = jwt.verifyToken(token);

            expect(decoded.userId).toBe('user123');
            expect(decoded.sessionId).toBe('session456');
            expect(decoded.type).toBe('session');
        });

        test('includes additional claims', () => {
            process.env.JWT_SECRET = 'a'.repeat(32);
            jest.resetModules();
            const jwt = require('../../config/jwt');

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
            'mod', 'moderator', 'bot', 'eigennamen', 'game',
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
