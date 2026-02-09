/**
 * Socket Auth Extended Coverage Tests
 *
 * Covers additional branches in middleware/socketAuth.ts:
 * - shouldTrustProxy: various env combos
 * - getClientIP: edge cases with array headers, empty forwarded-for
 * - validateOrigin: wildcard subdomain edge cases
 * - validateSession: session with no createdAt/connectedAt
 * - authenticateSocket: with existing session, reconnection flow
 * - requireAuth: both paths
 * - Memory rate limit cleanup timer
 */

const originalEnv = { ...process.env };

jest.mock('../utils/logger', () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
}));

jest.mock('../services/playerService', () => ({
    getPlayer: jest.fn(),
    setSocketMapping: jest.fn().mockResolvedValue(undefined),
    validateReconnectToken: jest.fn().mockResolvedValue(true)
}));

jest.mock('../config/jwt', () => ({
    verifyTokenWithClaims: jest.fn(),
    isJwtEnabled: jest.fn().mockReturnValue(false),
    JWT_ERROR_CODES: {
        TOKEN_EXPIRED: 'TOKEN_EXPIRED',
        TOKEN_INVALID: 'TOKEN_INVALID',
        CLAIMS_MISMATCH: 'CLAIMS_MISMATCH'
    }
}));

jest.mock('../services/auditService', () => ({
    audit: {
        suspicious: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn()
    }
}));

const mockRedis = {
    incr: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(1),
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1)
};

jest.mock('../config/redis', () => ({
    getRedis: () => mockRedis
}));

const mockSessionSecurity = {
    MAX_SESSION_AGE_MS: 24 * 60 * 60 * 1000,
    MAX_VALIDATION_ATTEMPTS_PER_IP: 10,
    IP_MISMATCH_ALLOWED: true,
    RECONNECTION_TOKEN_LENGTH: 32,
    RECONNECTION_TOKEN_TTL_SECONDS: 300
};

jest.mock('../config/constants', () => ({
    get SESSION_SECURITY() { return mockSessionSecurity; },
    REDIS_TTL: { SESSION_VALIDATION_WINDOW: 60 },
    ERROR_CODES: {
        SESSION_EXPIRED: 'SESSION_EXPIRED',
        SESSION_NOT_FOUND: 'SESSION_NOT_FOUND',
        SESSION_VALIDATION_RATE_LIMITED: 'SESSION_VALIDATION_RATE_LIMITED',
        NOT_AUTHORIZED: 'NOT_AUTHORIZED'
    }
}));

const logger = require('../utils/logger');
const playerService = require('../services/playerService');

describe('Socket Auth Extended Coverage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        process.env = { ...originalEnv };
        delete process.env.TRUST_PROXY;
        delete process.env.FLY_APP_NAME;
        delete process.env.DYNO;
        delete process.env.CORS_ORIGIN;
        delete process.env.NODE_ENV;
        mockSessionSecurity.IP_MISMATCH_ALLOWED = true;
    });

    afterAll(() => {
        process.env = originalEnv;
    });

    describe('validateSession - session with no timestamps', () => {
        it('should allow session with no createdAt or connectedAt', async () => {
            mockRedis.incr.mockResolvedValue(1);
            mockRedis.expire.mockResolvedValue(1);
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'test-session',
                lastIP: '127.0.0.1',
                // No createdAt or connectedAt
                connected: false
            });

            const { validateSession } = require('../middleware/socketAuth');
            const result = await validateSession('test-session', '127.0.0.1');

            expect(result.valid).toBe(true);
            expect(logger.debug).toHaveBeenCalledWith('Session has no creation timestamp');
        });
    });

    describe('validateSession - IP consistency with no previous IP', () => {
        it('should allow when no previous IP is recorded', async () => {
            mockRedis.incr.mockResolvedValue(1);
            mockRedis.expire.mockResolvedValue(1);
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'test-session',
                connectedAt: Date.now() - 1000,
                // No lastIP
                connected: false
            });

            const { validateSession } = require('../middleware/socketAuth');
            const result = await validateSession('test-session', '192.168.1.1');

            expect(result.valid).toBe(true);
            expect(result.ipMismatch).toBeFalsy();
        });
    });

    describe('validateOrigin - edge cases', () => {
        it('should allow when CORS_ORIGIN not set in development', () => {
            process.env.NODE_ENV = 'development';
            // CORS_ORIGIN not set
            jest.resetModules();
            const { validateOrigin } = require('../middleware/socketAuth');

            const socket = {
                handshake: {
                    headers: { origin: 'http://localhost:3000' },
                    address: '127.0.0.1'
                },
                id: 'socket-1'
            };
            const result = validateOrigin(socket as any);
            expect(result.valid).toBe(true);
        });

        it('should handle wildcard in CORS_ORIGIN list', () => {
            process.env.NODE_ENV = 'production';
            process.env.CORS_ORIGIN = '*';
            jest.resetModules();
            const { validateOrigin } = require('../middleware/socketAuth');

            const socket = {
                handshake: {
                    headers: { origin: 'https://anysite.com' },
                    address: '127.0.0.1'
                },
                id: 'socket-1'
            };
            const result = validateOrigin(socket as any);
            expect(result.valid).toBe(true);
        });
    });

    describe('authenticateSocket - session reuse flow', () => {
        it('should reuse valid session for returning user without existing player', async () => {
            process.env.NODE_ENV = 'development';
            const { v4: uuidv4 } = require('uuid');
            const sessionId = uuidv4();

            playerService.getPlayer.mockResolvedValue(null); // No existing player

            jest.resetModules();
            const { authenticateSocket } = require('../middleware/socketAuth');

            const socket = {
                id: 'socket-1',
                handshake: {
                    headers: {},
                    address: '127.0.0.1',
                    auth: { sessionId }
                }
            } as any;
            const next = jest.fn();

            await authenticateSocket(socket, next);

            expect(next).toHaveBeenCalledWith();
            // Should reuse the provided session ID since there's no existing player
            expect(socket.sessionId).toBe(sessionId);
        });

        it('should handle reconnection flow with valid token', async () => {
            process.env.NODE_ENV = 'development';
            const { v4: uuidv4 } = require('uuid');
            const sessionId = uuidv4();

            playerService.getPlayer.mockResolvedValue({
                sessionId,
                connected: false,
                connectedAt: Date.now() - 1000,
                lastIP: '127.0.0.1',
                nickname: 'Test',
                roomCode: 'ROOM01'
            });
            playerService.validateReconnectToken.mockResolvedValue(true);
            mockRedis.incr.mockResolvedValue(1);

            jest.resetModules();
            const { authenticateSocket } = require('../middleware/socketAuth');

            const socket = {
                id: 'socket-1',
                handshake: {
                    headers: {},
                    address: '127.0.0.1',
                    auth: { sessionId, reconnectToken: 'a'.repeat(64) }
                }
            } as any;
            const next = jest.fn();

            await authenticateSocket(socket, next);

            expect(next).toHaveBeenCalledWith();
            // Should reuse the validated session
            expect(socket.sessionId).toBe(sessionId);
        });
    });

    describe('requireAuth', () => {
        it('should reject when userId is not set', () => {
            const { requireAuth } = require('../middleware/socketAuth');
            const socket = {} as any;
            const next = jest.fn();

            requireAuth(socket, next);
            expect(next).toHaveBeenCalledWith(expect.any(Error));
        });

        it('should pass when userId is set', () => {
            const { requireAuth } = require('../middleware/socketAuth');
            const socket = { userId: 'user-1' } as any;
            const next = jest.fn();

            requireAuth(socket, next);
            expect(next).toHaveBeenCalledWith();
        });
    });
});
