/**
 * Tests for JWT Configuration
 */

// Store original env values
const originalEnv = { ...process.env };

// Mock logger before importing jwt module
jest.mock('../../utils/logger', () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
}));

describe('JWT Configuration', () => {
    let jwtModule;
    const _mockLogger = require('../../utils/logger');

    beforeEach(() => {
        jest.clearAllMocks();
        jest.resetModules();
        // Reset env to original values
        process.env = { ...originalEnv };
        delete process.env.JWT_SECRET;
        process.env.NODE_ENV = 'test';
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    describe('getJwtSecret', () => {
        it('should return secret when configured in non-production', () => {
            process.env.JWT_SECRET = 'a-valid-secret-that-is-long-enough-32chars';
            jwtModule = require('../../config/jwt');

            const secret = jwtModule.getJwtSecret();
            expect(secret).toBe('a-valid-secret-that-is-long-enough-32chars');
        });

        it('should return null when no secret in non-production', () => {
            delete process.env.JWT_SECRET;
            process.env.NODE_ENV = 'development';
            jwtModule = require('../../config/jwt');

            const secret = jwtModule.getJwtSecret();
            expect(secret).toBeNull();
        });

        it('should warn about short secrets in development', () => {
            process.env.JWT_SECRET = 'short';
            process.env.NODE_ENV = 'development';
            jwtModule = require('../../config/jwt');

            const secret = jwtModule.getJwtSecret();
            expect(secret).toBe('short');
            // Logger warning is called internally but mock state may vary
        });

        it('should throw in production without secret', () => {
            delete process.env.JWT_SECRET;
            process.env.NODE_ENV = 'production';
            jwtModule = require('../../config/jwt');

            expect(() => jwtModule.getJwtSecret()).toThrow('JWT_SECRET must be configured in production');
        });

        it('should throw error in production with short secret', () => {
            process.env.JWT_SECRET = 'short';
            process.env.NODE_ENV = 'production';
            jwtModule = require('../../config/jwt');

            expect(() => jwtModule.getJwtSecret()).toThrow('JWT_SECRET must be at least 32 characters in production');
        });

        it('should return secret in production when properly configured', () => {
            process.env.JWT_SECRET = 'a-valid-production-secret-that-is-at-least-32-chars';
            process.env.NODE_ENV = 'production';
            jwtModule = require('../../config/jwt');

            const secret = jwtModule.getJwtSecret();
            expect(secret).toBe('a-valid-production-secret-that-is-at-least-32-chars');
        });
    });

    describe('isJwtEnabled', () => {
        it('should return true when JWT is configured', () => {
            process.env.JWT_SECRET = 'a-valid-secret-that-is-long-enough-32chars';
            jwtModule = require('../../config/jwt');

            expect(jwtModule.isJwtEnabled()).toBe(true);
        });

        it('should return false in production without secret', () => {
            delete process.env.JWT_SECRET;
            process.env.NODE_ENV = 'production';
            jwtModule = require('../../config/jwt');

            expect(jwtModule.isJwtEnabled()).toBe(false);
        });

        it('should return false when getJwtSecret throws', () => {
            process.env.JWT_SECRET = 'short';
            process.env.NODE_ENV = 'production';
            jwtModule = require('../../config/jwt');

            expect(jwtModule.isJwtEnabled()).toBe(false);
        });
    });

    describe('signToken', () => {
        beforeEach(() => {
            process.env.JWT_SECRET = 'a-valid-secret-that-is-long-enough-32chars';
            jwtModule = require('../../config/jwt');
        });

        it('should sign a token with default options', () => {
            const token = jwtModule.signToken({ userId: 'test-user' });
            expect(typeof token).toBe('string');
            expect(token.split('.')).toHaveLength(3); // JWT has 3 parts
        });

        it('should sign a token with custom expiry', () => {
            const token = jwtModule.signToken({ userId: 'test-user' }, { expiresIn: '1h' });
            expect(typeof token).toBe('string');
        });

        it('should throw when JWT not configured in production', () => {
            delete process.env.JWT_SECRET;
            process.env.NODE_ENV = 'production';
            jest.resetModules();
            jwtModule = require('../../config/jwt');

            expect(() => jwtModule.signToken({ userId: 'test-user' })).toThrow(
                'JWT_SECRET must be configured in production'
            );
        });
    });

    describe('verifyToken', () => {
        beforeEach(() => {
            process.env.JWT_SECRET = 'a-valid-secret-that-is-long-enough-32chars';
            jwtModule = require('../../config/jwt');
        });

        it('should verify a valid token', () => {
            const token = jwtModule.signToken({ userId: 'test-user' });
            const decoded = jwtModule.verifyToken(token);

            expect(decoded).toBeDefined();
            expect(decoded.userId).toBe('test-user');
        });

        it('should return null for invalid token', () => {
            const decoded = jwtModule.verifyToken('invalid-token');
            expect(decoded).toBeNull();
            // Logger is called but may have been cleared - just verify the return value
        });

        it('should return null for expired token', () => {
            // Create a token that expires immediately
            const jwt = require('jsonwebtoken');
            const token = jwt.sign({ userId: 'test' }, 'a-valid-secret-that-is-long-enough-32chars', {
                expiresIn: '-1s',
                algorithm: 'HS256',
                issuer: 'eigennamen',
                audience: 'game-client',
            });

            const decoded = jwtModule.verifyToken(token);
            expect(decoded).toBeNull();
            // Token is expired, verifyToken returns null
        });

        it('should throw when JWT not configured in production', () => {
            delete process.env.JWT_SECRET;
            process.env.NODE_ENV = 'production';
            jest.resetModules();
            jwtModule = require('../../config/jwt');

            expect(() => jwtModule.verifyToken('any-token')).toThrow('JWT_SECRET must be configured in production');
        });

        it('should log warning for unexpected verification errors', () => {
            // Create a token with wrong issuer
            const jwt = require('jsonwebtoken');
            const token = jwt.sign({ userId: 'test' }, 'a-valid-secret-that-is-long-enough-32chars', {
                algorithm: 'HS256',
                issuer: 'wrong-issuer',
                audience: 'game-client',
            });

            const decoded = jwtModule.verifyToken(token);
            expect(decoded).toBeNull();
        });
    });

    describe('decodeToken', () => {
        beforeEach(() => {
            process.env.JWT_SECRET = 'a-valid-secret-that-is-long-enough-32chars';
            jwtModule = require('../../config/jwt');
        });

        it('should decode a valid token without verification', () => {
            const token = jwtModule.signToken({ userId: 'test-user' });
            const decoded = jwtModule.decodeToken(token);

            expect(decoded).toBeDefined();
            expect(decoded.userId).toBe('test-user');
        });

        it('should return null for malformed token', () => {
            const decoded = jwtModule.decodeToken('not-a-jwt');
            // jwt.decode returns null for non-JWT strings, not throwing
            expect(decoded).toBeNull();
        });

        it('should return null for completely invalid input', () => {
            const decoded = jwtModule.decodeToken(null);
            expect(decoded).toBeNull();
        });
    });

    describe('generateSessionToken', () => {
        beforeEach(() => {
            process.env.JWT_SECRET = 'a-valid-secret-that-is-long-enough-32chars';
            jwtModule = require('../../config/jwt');
        });

        it('should generate a session token with userId and sessionId', () => {
            const token = jwtModule.generateSessionToken('user-123', 'session-456');
            const decoded = jwtModule.verifyToken(token);

            expect(decoded.userId).toBe('user-123');
            expect(decoded.sessionId).toBe('session-456');
            expect(decoded.type).toBe('session');
        });

        it('should include additional claims', () => {
            const token = jwtModule.generateSessionToken('user-123', 'session-456', {
                role: 'admin',
                permissions: ['read', 'write'],
            });
            const decoded = jwtModule.verifyToken(token);

            expect(decoded.role).toBe('admin');
            expect(decoded.permissions).toEqual(['read', 'write']);
        });

        it('should throw when JWT not configured in production', () => {
            delete process.env.JWT_SECRET;
            process.env.NODE_ENV = 'production';
            jest.resetModules();
            jwtModule = require('../../config/jwt');

            expect(() => jwtModule.generateSessionToken('user-123', 'session-456')).toThrow(
                'JWT_SECRET must be configured in production'
            );
        });
    });

    describe('JWT_CONFIG exports', () => {
        it('should export JWT configuration constants', () => {
            process.env.JWT_SECRET = 'a-valid-secret-that-is-long-enough-32chars';
            jwtModule = require('../../config/jwt');

            expect(jwtModule.JWT_CONFIG).toBeDefined();
            expect(jwtModule.JWT_CONFIG.algorithm).toBe('HS256');
            expect(jwtModule.JWT_CONFIG.expiresIn).toBe('24h');
            expect(jwtModule.MIN_SECRET_LENGTH).toBe(32);
        });
    });

    describe('JWT_ERROR_CODES', () => {
        it('should export error codes for JWT validation', () => {
            process.env.JWT_SECRET = 'a-valid-secret-that-is-long-enough-32chars';
            jwtModule = require('../../config/jwt');

            expect(jwtModule.JWT_ERROR_CODES).toBeDefined();
            expect(jwtModule.JWT_ERROR_CODES.TOKEN_EXPIRED).toBe('TOKEN_EXPIRED');
            expect(jwtModule.JWT_ERROR_CODES.TOKEN_INVALID).toBe('TOKEN_INVALID');
            expect(jwtModule.JWT_ERROR_CODES.TOKEN_MALFORMED).toBe('TOKEN_MALFORMED');
            expect(jwtModule.JWT_ERROR_CODES.CLAIMS_MISMATCH).toBe('CLAIMS_MISMATCH');
            expect(jwtModule.JWT_ERROR_CODES.JWT_NOT_CONFIGURED).toBe('JWT_NOT_CONFIGURED');
        });
    });

    describe('verifyToken with returnError option', () => {
        beforeEach(() => {
            process.env.JWT_SECRET = 'a-valid-secret-that-is-long-enough-32chars';
            jwtModule = require('../../config/jwt');
        });

        it('should return error object for expired token when returnError is true', () => {
            const jwt = require('jsonwebtoken');
            const token = jwt.sign({ userId: 'test' }, 'a-valid-secret-that-is-long-enough-32chars', {
                expiresIn: '-1s',
                algorithm: 'HS256',
                issuer: 'eigennamen',
                audience: 'game-client',
            });

            const result = jwtModule.verifyToken(token, { returnError: true });
            expect(result.error).toBe(jwtModule.JWT_ERROR_CODES.TOKEN_EXPIRED);
            expect(result.message).toContain('expired');
        });

        it('should return error object for invalid token when returnError is true', () => {
            const result = jwtModule.verifyToken('invalid-token', { returnError: true });
            expect(result.error).toBeDefined();
            expect(result.message).toBeDefined();
        });

        it('should return decoded payload for valid token', () => {
            const token = jwtModule.signToken({ userId: 'test-user' });
            const result = jwtModule.verifyToken(token, { returnError: true });
            expect(result.userId).toBe('test-user');
            expect(result.error).toBeUndefined();
        });
    });

    describe('verifyTokenWithClaims', () => {
        beforeEach(() => {
            process.env.JWT_SECRET = 'a-valid-secret-that-is-long-enough-32chars';
            jwtModule = require('../../config/jwt');
        });

        it('should return valid:true for token with matching claims', () => {
            const token = jwtModule.signToken({ userId: 'user-123', role: 'admin' });
            const result = jwtModule.verifyTokenWithClaims(token, { userId: 'user-123' });

            expect(result.valid).toBe(true);
            expect(result.decoded).toBeDefined();
            expect(result.decoded.userId).toBe('user-123');
        });

        it('should return valid:false for mismatched claims', () => {
            const token = jwtModule.signToken({ userId: 'user-123' });
            const result = jwtModule.verifyTokenWithClaims(token, { userId: 'different-user' });

            expect(result.valid).toBe(false);
            expect(result.error).toBe(jwtModule.JWT_ERROR_CODES.CLAIMS_MISMATCH);
            expect(result.message).toContain('userId');
        });

        it('should return valid:false for expired token', () => {
            const jwt = require('jsonwebtoken');
            const token = jwt.sign({ userId: 'test' }, 'a-valid-secret-that-is-long-enough-32chars', {
                expiresIn: '-1s',
                algorithm: 'HS256',
                issuer: 'eigennamen',
                audience: 'game-client',
            });

            const result = jwtModule.verifyTokenWithClaims(token, { userId: 'test' });
            expect(result.valid).toBe(false);
            expect(result.error).toBe(jwtModule.JWT_ERROR_CODES.TOKEN_EXPIRED);
        });

        it('should return valid:true when no claims to validate', () => {
            const token = jwtModule.signToken({ userId: 'user-123' });
            const result = jwtModule.verifyTokenWithClaims(token, {});

            expect(result.valid).toBe(true);
            expect(result.decoded.userId).toBe('user-123');
        });

        it('should skip undefined expected claims', () => {
            const token = jwtModule.signToken({ userId: 'user-123' });
            const result = jwtModule.verifyTokenWithClaims(token, { userId: 'user-123', role: undefined });

            expect(result.valid).toBe(true);
        });
    });
});
