/**
 * Socket Auth Branch Coverage Tests
 *
 * Tests additional branches in socketAuth.ts including:
 * - Origin validation with wildcard subdomains
 * - Origin validation in production with missing origin
 * - IP mismatch not allowed branch
 * - validateReconnectionToken with bad format
 * - resolveSessionId various branches
 * - handleJwtVerification claims mismatch
 * - requireAuth middleware
 * - shouldTrustProxy with DYNO and FLY_APP_NAME
 * - checkMemoryRateLimit when rate limit exceeded
 * - getClientIP with array x-forwarded-for
 */

// Mock dependencies before requiring
jest.mock('../utils/logger', () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
}));

jest.mock('../services/playerService', () => ({
    getPlayer: jest.fn(),
    setSocketMapping: jest.fn(),
    validateReconnectToken: jest.fn()
}));

jest.mock('../services/auditService', () => ({
    audit: { suspicious: jest.fn() },
    logAuditEvent: jest.fn(),
    AUDIT_EVENTS: {}
}));

jest.mock('../config/jwt', () => ({
    verifyToken: jest.fn(),
    verifyTokenWithClaims: jest.fn(),
    isJwtEnabled: jest.fn(),
    JWT_ERROR_CODES: {
        TOKEN_EXPIRED: 'TOKEN_EXPIRED',
        TOKEN_INVALID: 'TOKEN_INVALID',
        TOKEN_MALFORMED: 'TOKEN_MALFORMED',
        CLAIMS_MISMATCH: 'CLAIMS_MISMATCH',
        JWT_NOT_CONFIGURED: 'JWT_NOT_CONFIGURED'
    }
}));

jest.mock('../config/redis', () => ({
    getRedis: jest.fn(() => ({
        incr: jest.fn().mockResolvedValue(1),
        expire: jest.fn().mockResolvedValue(true)
    }))
}));

jest.mock('../config/constants', () => ({
    SESSION_SECURITY: {
        MAX_SESSION_AGE_MS: 24 * 60 * 60 * 1000,
        MAX_VALIDATION_ATTEMPTS_PER_IP: 20,
        IP_MISMATCH_ALLOWED: true,
        SESSION_ID_MIN_LENGTH: 36,
        RECONNECTION_TOKEN_TTL_SECONDS: 300,
        RECONNECTION_TOKEN_LENGTH: 32
    },
    REDIS_TTL: {
        SESSION_VALIDATION_WINDOW: 60
    },
    ERROR_CODES: {
        SESSION_EXPIRED: 'SESSION_EXPIRED',
        SESSION_NOT_FOUND: 'SESSION_NOT_FOUND',
        SESSION_VALIDATION_RATE_LIMITED: 'SESSION_VALIDATION_RATE_LIMITED',
        NOT_AUTHORIZED: 'NOT_AUTHORIZED',
        RATE_LIMITED: 'RATE_LIMITED'
    }
}));

const {
    authenticateSocket,
    requireAuth,
    getClientIP,
    validateSession,
    validateOrigin
} = require('../middleware/socketAuth');

const playerService = require('../services/playerService');
const { audit } = require('../services/auditService');
const { verifyTokenWithClaims, isJwtEnabled } = require('../config/jwt');
const { getRedis } = require('../config/redis');

const originalEnv = { ...process.env };

function createMockSocket(overrides: Record<string, any> = {}) {
    return {
        id: 'socket-1',
        handshake: {
            auth: {},
            headers: {},
            address: '127.0.0.1',
            ...overrides.handshake
        },
        ...overrides
    };
}

describe('Socket Auth Branch Coverage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        process.env = { ...originalEnv };
        delete process.env.NODE_ENV;
        delete process.env.CORS_ORIGIN;
        delete process.env.TRUST_PROXY;
        delete process.env.FLY_APP_NAME;
        delete process.env.DYNO;

        playerService.setSocketMapping.mockResolvedValue(undefined);
    });

    afterEach(() => {
        process.env = { ...originalEnv };
    });

    describe('validateOrigin', () => {
        it('should reject disallowed origin in production and audit', () => {
            process.env.NODE_ENV = 'production';
            process.env.CORS_ORIGIN = 'https://example.com';

            const socket = createMockSocket({
                handshake: {
                    auth: {},
                    headers: { origin: 'https://evil.com' },
                    address: '1.2.3.4'
                }
            });

            const result = validateOrigin(socket);
            expect(result.valid).toBe(false);
            expect(result.reason).toBe('Origin not allowed');
            expect(audit.suspicious).toHaveBeenCalled();
        });

        it('should allow wildcard subdomain origin', () => {
            process.env.NODE_ENV = 'production';
            process.env.CORS_ORIGIN = '*.example.com';

            const socket = createMockSocket({
                handshake: {
                    auth: {},
                    headers: { origin: 'https://app.example.com' },
                    address: '1.2.3.4'
                }
            });

            const result = validateOrigin(socket);
            expect(result.valid).toBe(true);
        });

        it('should reject non-matching wildcard subdomain', () => {
            process.env.NODE_ENV = 'production';
            process.env.CORS_ORIGIN = '*.example.com';

            const socket = createMockSocket({
                handshake: {
                    auth: {},
                    headers: { origin: 'https://evil.com' },
                    address: '1.2.3.4'
                }
            });

            const result = validateOrigin(socket);
            expect(result.valid).toBe(false);
        });

        it('should warn but allow missing origin in production', () => {
            process.env.NODE_ENV = 'production';
            process.env.CORS_ORIGIN = 'https://example.com';

            const socket = createMockSocket({
                handshake: {
                    auth: {},
                    headers: {},
                    address: '1.2.3.4'
                }
            });

            const result = validateOrigin(socket);
            expect(result.valid).toBe(true);
        });

        it('should allow all origins in dev with wildcard CORS', () => {
            process.env.NODE_ENV = 'development';
            process.env.CORS_ORIGIN = '*';

            const socket = createMockSocket({
                handshake: {
                    auth: {},
                    headers: { origin: 'http://anything' },
                    address: '1.2.3.4'
                }
            });

            const result = validateOrigin(socket);
            expect(result.valid).toBe(true);
        });

        it('should allow all origins in dev with no CORS_ORIGIN', () => {
            process.env.NODE_ENV = 'development';
            delete process.env.CORS_ORIGIN;

            const socket = createMockSocket({
                handshake: {
                    auth: {},
                    headers: { origin: 'http://anything' },
                    address: '1.2.3.4'
                }
            });

            const result = validateOrigin(socket);
            expect(result.valid).toBe(true);
        });

        it('should allow exact match origin', () => {
            process.env.NODE_ENV = 'production';
            process.env.CORS_ORIGIN = 'https://example.com';

            const socket = createMockSocket({
                handshake: {
                    auth: {},
                    headers: { origin: 'https://example.com' },
                    address: '1.2.3.4'
                }
            });

            const result = validateOrigin(socket);
            expect(result.valid).toBe(true);
        });
    });

    describe('getClientIP', () => {
        it('should use x-forwarded-for when TRUST_PROXY is true', () => {
            process.env.TRUST_PROXY = 'true';

            const socket = createMockSocket({
                handshake: {
                    auth: {},
                    headers: { 'x-forwarded-for': '10.0.0.1, 10.0.0.2' },
                    address: '127.0.0.1'
                }
            });

            const ip = getClientIP(socket);
            expect(ip).toBe('10.0.0.1');
        });

        it('should handle array x-forwarded-for', () => {
            process.env.TRUST_PROXY = '1';

            const socket = createMockSocket({
                handshake: {
                    auth: {},
                    headers: { 'x-forwarded-for': ['10.0.0.1'] },
                    address: '127.0.0.1'
                }
            });

            const ip = getClientIP(socket);
            expect(ip).toBe('10.0.0.1');
        });

        it('should use FLY_APP_NAME for proxy trust', () => {
            process.env.FLY_APP_NAME = 'my-app';

            const socket = createMockSocket({
                handshake: {
                    auth: {},
                    headers: { 'x-forwarded-for': '10.0.0.5' },
                    address: '127.0.0.1'
                }
            });

            const ip = getClientIP(socket);
            expect(ip).toBe('10.0.0.5');
        });

        it('should use DYNO for proxy trust', () => {
            process.env.DYNO = 'web.1';

            const socket = createMockSocket({
                handshake: {
                    auth: {},
                    headers: { 'x-forwarded-for': '10.0.0.6' },
                    address: '127.0.0.1'
                }
            });

            const ip = getClientIP(socket);
            expect(ip).toBe('10.0.0.6');
        });

        it('should fall back to address when no proxy', () => {
            const socket = createMockSocket({
                handshake: {
                    auth: {},
                    headers: {},
                    address: '192.168.1.1'
                }
            });

            const ip = getClientIP(socket);
            expect(ip).toBe('192.168.1.1');
        });

        it('should fall back to address when x-forwarded-for is empty', () => {
            process.env.TRUST_PROXY = 'true';

            const socket = createMockSocket({
                handshake: {
                    auth: {},
                    headers: { 'x-forwarded-for': '' },
                    address: '192.168.1.1'
                }
            });

            const ip = getClientIP(socket);
            expect(ip).toBe('192.168.1.1');
        });
    });

    describe('validateSession', () => {
        it('should return rate limited when rate limit exceeded', async () => {
            const redis = {
                incr: jest.fn().mockResolvedValue(100),
                expire: jest.fn().mockResolvedValue(true)
            };
            getRedis.mockReturnValue(redis);

            const result = await validateSession('some-uuid-1234-5678-9012-abcdef123456', '1.2.3.4');
            expect(result.valid).toBe(false);
            expect(result.reason).toBe('SESSION_VALIDATION_RATE_LIMITED');
        });

        it('should return not found when player not found', async () => {
            const redis = {
                incr: jest.fn().mockResolvedValue(1),
                expire: jest.fn().mockResolvedValue(true)
            };
            getRedis.mockReturnValue(redis);
            playerService.getPlayer.mockResolvedValue(null);

            const result = await validateSession('some-uuid-1234-5678-9012-abcdef123456', '1.2.3.4');
            expect(result.valid).toBe(false);
            expect(result.reason).toBe('SESSION_NOT_FOUND');
        });

        it('should return expired for old session', async () => {
            const redis = {
                incr: jest.fn().mockResolvedValue(1),
                expire: jest.fn().mockResolvedValue(true)
            };
            getRedis.mockReturnValue(redis);
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'some-uuid',
                createdAt: Date.now() - (25 * 60 * 60 * 1000), // 25 hours ago
                lastIP: '1.2.3.4'
            });

            const result = await validateSession('some-uuid-1234-5678-9012-abcdef123456', '1.2.3.4');
            expect(result.valid).toBe(false);
            expect(result.reason).toBe('SESSION_EXPIRED');
        });

        it('should validate successfully with valid session', async () => {
            const redis = {
                incr: jest.fn().mockResolvedValue(1),
                expire: jest.fn().mockResolvedValue(true)
            };
            getRedis.mockReturnValue(redis);
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'some-uuid',
                createdAt: Date.now() - (1000),
                lastIP: '1.2.3.4'
            });

            const result = await validateSession('some-uuid', '1.2.3.4');
            expect(result.valid).toBe(true);
            expect(result.player).toBeDefined();
        });

        it('should use in-memory fallback when Redis fails', async () => {
            const redis = {
                incr: jest.fn().mockRejectedValue(new Error('Redis down')),
                expire: jest.fn()
            };
            getRedis.mockReturnValue(redis);
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'some-uuid',
                createdAt: Date.now(),
                lastIP: '1.2.3.4'
            });

            const result = await validateSession('some-uuid', '1.2.3.4');
            expect(result.valid).toBe(true);
        });
    });

    describe('authenticateSocket', () => {
        it('should generate new session ID when no sessionId provided', async () => {
            const socket = createMockSocket({
                handshake: {
                    auth: {},
                    headers: {},
                    address: '127.0.0.1'
                }
            });

            const next = jest.fn();
            await authenticateSocket(socket, next);

            expect(next).toHaveBeenCalledWith();
            expect((socket as any).sessionId).toBeDefined();
            expect((socket as any).sessionId).toHaveLength(36); // UUID length
        });

        it('should reject invalid session ID format', async () => {
            const socket = createMockSocket({
                handshake: {
                    auth: { sessionId: 'not-a-uuid' },
                    headers: {},
                    address: '127.0.0.1'
                }
            });

            const next = jest.fn();
            await authenticateSocket(socket, next);

            expect(next).toHaveBeenCalledWith();
            // Should generate a new UUID since the provided one is invalid
            expect((socket as any).sessionId).toHaveLength(36);
        });

        it('should generate new session when existing player is connected (hijacking prevention)', async () => {
            const validUuid = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
            playerService.getPlayer.mockResolvedValue({
                sessionId: validUuid,
                connected: true
            });

            const socket = createMockSocket({
                handshake: {
                    auth: { sessionId: validUuid },
                    headers: {},
                    address: '127.0.0.1'
                }
            });

            const next = jest.fn();
            await authenticateSocket(socket, next);

            expect(next).toHaveBeenCalledWith();
            // Should generate a new UUID, not use the hijacked one
            expect((socket as any).sessionId).not.toBe(validUuid);
        });

        it('should handle JWT verification with claims mismatch', async () => {
            const validUuid = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
            const redis = {
                incr: jest.fn().mockResolvedValue(1),
                expire: jest.fn().mockResolvedValue(true)
            };
            getRedis.mockReturnValue(redis);

            playerService.getPlayer.mockResolvedValue({
                sessionId: validUuid,
                connected: false,
                createdAt: Date.now(),
                lastIP: '127.0.0.1',
                userId: 'user-1'
            });
            playerService.validateReconnectToken.mockResolvedValue(true);

            isJwtEnabled.mockReturnValue(true);
            verifyTokenWithClaims.mockReturnValue({
                valid: false,
                error: 'CLAIMS_MISMATCH',
                message: 'Claims do not match'
            });

            const socket = createMockSocket({
                handshake: {
                    auth: { sessionId: validUuid, token: 'some-jwt-token' },
                    headers: {},
                    address: '127.0.0.1'
                }
            });

            const next = jest.fn();
            await authenticateSocket(socket, next);

            expect(next).toHaveBeenCalledWith();
            // Claims mismatch is logged but not fatal
        });

        it('should handle JWT with expired token', async () => {
            const validUuid = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
            const redis = {
                incr: jest.fn().mockResolvedValue(1),
                expire: jest.fn().mockResolvedValue(true)
            };
            getRedis.mockReturnValue(redis);

            playerService.getPlayer.mockResolvedValue({
                sessionId: validUuid,
                connected: false,
                createdAt: Date.now(),
                lastIP: '127.0.0.1'
            });
            playerService.validateReconnectToken.mockResolvedValue(true);

            isJwtEnabled.mockReturnValue(true);
            verifyTokenWithClaims.mockReturnValue({
                valid: false,
                error: 'TOKEN_EXPIRED',
                message: 'Token expired'
            });

            const socket = createMockSocket({
                handshake: {
                    auth: { sessionId: validUuid, token: 'expired-jwt' },
                    headers: {},
                    address: '127.0.0.1'
                }
            });

            const next = jest.fn();
            await authenticateSocket(socket, next);

            expect(next).toHaveBeenCalledWith();
            expect((socket as any).jwtExpired).toBe(true);
        });

        it('should handle successful JWT verification', async () => {
            const validUuid = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
            const redis = {
                incr: jest.fn().mockResolvedValue(1),
                expire: jest.fn().mockResolvedValue(true)
            };
            getRedis.mockReturnValue(redis);

            playerService.getPlayer.mockResolvedValue({
                sessionId: validUuid,
                connected: false,
                createdAt: Date.now(),
                lastIP: '127.0.0.1',
                userId: 'user-1'
            });
            playerService.validateReconnectToken.mockResolvedValue(true);

            isJwtEnabled.mockReturnValue(true);
            verifyTokenWithClaims.mockReturnValue({
                valid: true,
                decoded: { userId: 'user-1', sessionId: validUuid }
            });

            const socket = createMockSocket({
                handshake: {
                    auth: { sessionId: validUuid, token: 'valid-jwt' },
                    headers: {},
                    address: '127.0.0.1'
                }
            });

            const next = jest.fn();
            await authenticateSocket(socket, next);

            expect(next).toHaveBeenCalledWith();
            expect((socket as any).jwtVerified).toBe(true);
            expect((socket as any).userId).toBe('user-1');
        });

        it('should call next with error on authentication failure', async () => {
            playerService.setSocketMapping.mockRejectedValue(new Error('Mapping failed'));

            const socket = createMockSocket({
                handshake: {
                    auth: {},
                    headers: {},
                    address: '127.0.0.1'
                }
            });

            const next = jest.fn();
            await authenticateSocket(socket, next);

            expect(next).toHaveBeenCalledWith(expect.any(Error));
            expect(next.mock.calls[0][0].message).toBe('Authentication failed');
        });

        it('should reject connection when origin is not allowed', async () => {
            process.env.NODE_ENV = 'production';
            process.env.CORS_ORIGIN = 'https://example.com';

            const socket = createMockSocket({
                handshake: {
                    auth: {},
                    headers: { origin: 'https://evil.com' },
                    address: '127.0.0.1'
                }
            });

            const next = jest.fn();
            await authenticateSocket(socket, next);

            expect(next).toHaveBeenCalledWith(expect.any(Error));
            expect(next.mock.calls[0][0].message).toBe('Origin not allowed');
        });

        it('should flag IP mismatch on socket', async () => {
            const validUuid = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
            const redis = {
                incr: jest.fn().mockResolvedValue(1),
                expire: jest.fn().mockResolvedValue(true)
            };
            getRedis.mockReturnValue(redis);

            playerService.getPlayer.mockResolvedValue({
                sessionId: validUuid,
                connected: false,
                createdAt: Date.now(),
                lastIP: '10.0.0.1'  // Different from current IP
            });
            playerService.validateReconnectToken.mockResolvedValue(true);

            const socket = createMockSocket({
                handshake: {
                    auth: { sessionId: validUuid },
                    headers: {},
                    address: '127.0.0.1'
                }
            });

            const next = jest.fn();
            await authenticateSocket(socket, next);

            expect(next).toHaveBeenCalledWith();
            expect((socket as any).ipMismatch).toBe(true);
        });

        it('should allow session with no existing player (fresh session)', async () => {
            const validUuid = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
            playerService.getPlayer.mockResolvedValue(null);

            const socket = createMockSocket({
                handshake: {
                    auth: { sessionId: validUuid },
                    headers: {},
                    address: '127.0.0.1'
                }
            });

            const next = jest.fn();
            await authenticateSocket(socket, next);

            expect(next).toHaveBeenCalledWith();
            // Should use the provided UUID since no player exists
            expect((socket as any).sessionId).toBe(validUuid);
        });

        it('should generate new session when reconnect token is invalid', async () => {
            const validUuid = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
            const redis = {
                incr: jest.fn().mockResolvedValue(1),
                expire: jest.fn().mockResolvedValue(true)
            };
            getRedis.mockReturnValue(redis);

            playerService.getPlayer.mockResolvedValue({
                sessionId: validUuid,
                connected: false,
                createdAt: Date.now(),
                lastIP: '127.0.0.1'
            });
            playerService.validateReconnectToken.mockResolvedValue(false);

            const socket = createMockSocket({
                handshake: {
                    auth: { sessionId: validUuid, reconnectToken: 'a'.repeat(64) },
                    headers: {},
                    address: '127.0.0.1'
                }
            });

            const next = jest.fn();
            await authenticateSocket(socket, next);

            expect(next).toHaveBeenCalledWith();
            // Should generate new UUID since token validation failed
            expect((socket as any).sessionId).not.toBe(validUuid);
        });

        it('should reject badly formatted reconnection token', async () => {
            const validUuid = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
            const redis = {
                incr: jest.fn().mockResolvedValue(1),
                expire: jest.fn().mockResolvedValue(true)
            };
            getRedis.mockReturnValue(redis);

            playerService.getPlayer.mockResolvedValue({
                sessionId: validUuid,
                connected: false,
                createdAt: Date.now(),
                lastIP: '127.0.0.1'
            });

            const socket = createMockSocket({
                handshake: {
                    auth: { sessionId: validUuid, reconnectToken: 'bad-format!' },
                    headers: {},
                    address: '127.0.0.1'
                }
            });

            const next = jest.fn();
            await authenticateSocket(socket, next);

            expect(next).toHaveBeenCalledWith();
            // Should generate new UUID since token format is invalid
            expect((socket as any).sessionId).not.toBe(validUuid);
        });
    });

    describe('requireAuth', () => {
        it('should call next without error when userId exists', () => {
            const socket = { userId: 'user-1' };
            const next = jest.fn();

            requireAuth(socket, next);

            expect(next).toHaveBeenCalledWith();
        });

        it('should call next with error when userId missing', () => {
            const socket = {};
            const next = jest.fn();

            requireAuth(socket, next);

            expect(next).toHaveBeenCalledWith(expect.any(Error));
            expect(next.mock.calls[0][0].message).toBe('Authentication required');
        });
    });
});
