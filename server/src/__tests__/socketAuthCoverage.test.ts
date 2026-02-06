/**
 * Socket Auth Coverage Tests
 *
 * Covers uncovered lines in middleware/socketAuth.js:
 * - Lines 92-98: Rate limit Redis failure (fail-closed mode)
 * - Lines 111-112: Session age with no createdAt/connectedAt
 * - Line 152: IP mismatch NOT allowed
 * - Line 195: validateSession returns NOT_AUTHORIZED for IP mismatch
 * - Lines 253-260: Invalid reconnection token format
 * - Line 321: JWT with validated session having userId
 * - Lines 345, 348: JWT expired and claims mismatch error codes
 */

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

const mockSessionSecurity = {
    MAX_SESSION_AGE_MS: 24 * 60 * 60 * 1000,
    MAX_VALIDATION_ATTEMPTS_PER_IP: 20,
    IP_MISMATCH_ALLOWED: true,
    SESSION_ID_MIN_LENGTH: 36,
    RECONNECTION_TOKEN_TTL_SECONDS: 300,
    RECONNECTION_TOKEN_LENGTH: 32,
    RATE_LIMIT_FAIL_CLOSED: false
};

jest.mock('../config/redis', () => ({
    getRedis: jest.fn()
}));

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
const { verifyTokenWithClaims, isJwtEnabled, JWT_ERROR_CODES } = require('../config/jwt');
const { getRedis } = require('../config/redis');
const { authenticateSocket, validateSession } = require('../middleware/socketAuth');

describe('Socket Auth Coverage', () => {
    let mockRedis;

    beforeEach(() => {
        jest.clearAllMocks();
        mockRedis = {
            incr: jest.fn(),
            expire: jest.fn(),
            set: jest.fn(),
            get: jest.fn(),
            del: jest.fn()
        };
        getRedis.mockReturnValue(mockRedis);

        // Reset to defaults
        mockSessionSecurity.IP_MISMATCH_ALLOWED = true;
        mockSessionSecurity.RATE_LIMIT_FAIL_CLOSED = false;
    });

    describe('Rate limit Redis failure - in-memory fallback', () => {
        test('allows first request via in-memory fallback when Redis fails', async () => {
            mockRedis.incr.mockRejectedValue(new Error('Redis connection failed'));

            playerService.getPlayer.mockResolvedValue({
                sessionId: 'test-session',
                createdAt: Date.now(),
                lastIP: '192.168.1.1'
            });

            const result = await validateSession('test-session', '192.168.1.1');
            expect(result.valid).toBe(true);
            expect(logger.error).toHaveBeenCalledWith(
                expect.stringContaining('in-memory fallback'),
                expect.any(String)
            );
        });

        test('denies request via in-memory fallback when limit exceeded', async () => {
            mockRedis.incr.mockRejectedValue(new Error('Redis connection failed'));

            // Exceed the in-memory rate limit by making many requests
            for (let i = 0; i < mockSessionSecurity.MAX_VALIDATION_ATTEMPTS_PER_IP; i++) {
                playerService.getPlayer.mockResolvedValue({
                    sessionId: 'test-session',
                    createdAt: Date.now(),
                    lastIP: '10.0.0.99'
                });
                await validateSession('test-session', '10.0.0.99');
            }

            // The next request should be denied
            const result = await validateSession('test-session', '10.0.0.99');
            expect(result.valid).toBe(false);
            expect(result.reason).toBe('SESSION_VALIDATION_RATE_LIMITED');
        });
    });

    describe('IP mismatch NOT allowed (line 152)', () => {
        test('rejects session when IP mismatch is not allowed', async () => {
            mockSessionSecurity.IP_MISMATCH_ALLOWED = false;
            mockRedis.incr.mockResolvedValue(1);
            mockRedis.expire.mockResolvedValue(true);

            playerService.getPlayer.mockResolvedValue({
                sessionId: 'test-session',
                createdAt: Date.now(),
                lastIP: '192.168.1.1',
                nickname: 'Test',
                roomCode: 'ROOM01'
            });

            const result = await validateSession('test-session', '10.0.0.1');

            expect(result.valid).toBe(false);
            expect(result.reason).toBe('NOT_AUTHORIZED');
        });
    });

    describe('Invalid reconnection token format (lines 253-260)', () => {
        test('rejects token with wrong length', async () => {
            const validUuid = '550e8400-e29b-41d4-a716-446655440000';
            const socket = {
                id: 'socket-123',
                handshake: {
                    auth: {
                        sessionId: validUuid,
                        reconnectToken: 'abc123' // wrong length
                    },
                    address: '192.168.1.1',
                    headers: {}
                }
            };
            const next = jest.fn();

            playerService.getPlayer.mockResolvedValue({
                sessionId: validUuid,
                connected: false,
                createdAt: Date.now(),
                lastIP: '192.168.1.1'
            });
            mockRedis.incr.mockResolvedValue(1);
            mockRedis.expire.mockResolvedValue(true);
            playerService.setSocketMapping.mockResolvedValue(true);
            isJwtEnabled.mockReturnValue(false);

            await authenticateSocket(socket, next);

            expect(logger.warn).toHaveBeenCalledWith(
                'Invalid reconnection token format',
                expect.objectContaining({ sessionId: validUuid })
            );
            // Should generate new session
            expect(socket.sessionId).not.toBe(validUuid);
            expect(next).toHaveBeenCalledWith();
        });

        test('rejects token with non-hex characters', async () => {
            const validUuid = '550e8400-e29b-41d4-a716-446655440000';
            const nonHexToken = 'g'.repeat(64); // 'g' is not a hex char
            const socket = {
                id: 'socket-123',
                handshake: {
                    auth: {
                        sessionId: validUuid,
                        reconnectToken: nonHexToken
                    },
                    address: '192.168.1.1',
                    headers: {}
                }
            };
            const next = jest.fn();

            playerService.getPlayer.mockResolvedValue({
                sessionId: validUuid,
                connected: false,
                createdAt: Date.now(),
                lastIP: '192.168.1.1'
            });
            mockRedis.incr.mockResolvedValue(1);
            mockRedis.expire.mockResolvedValue(true);
            playerService.setSocketMapping.mockResolvedValue(true);
            isJwtEnabled.mockReturnValue(false);

            await authenticateSocket(socket, next);

            expect(logger.warn).toHaveBeenCalledWith(
                'Invalid reconnection token format',
                expect.objectContaining({ sessionId: validUuid })
            );
            expect(socket.sessionId).not.toBe(validUuid);
        });
    });

    describe('JWT with validated session userId (line 321)', () => {
        test('passes userId in expectedClaims when session has userId', async () => {
            const validUuid = '550e8400-e29b-41d4-a716-446655440000';
            const validHexToken = 'a'.repeat(64);
            const socket = {
                id: 'socket-123',
                handshake: {
                    auth: {
                        sessionId: validUuid,
                        reconnectToken: validHexToken,
                        token: 'jwt-token'
                    },
                    address: '192.168.1.1',
                    headers: {}
                }
            };
            const next = jest.fn();

            playerService.getPlayer.mockResolvedValue({
                sessionId: validUuid,
                connected: false,
                createdAt: Date.now(),
                lastIP: '192.168.1.1',
                userId: 'user-456'
            });
            playerService.validateReconnectToken.mockResolvedValue(true);
            playerService.setSocketMapping.mockResolvedValue(true);
            mockRedis.incr.mockResolvedValue(1);
            mockRedis.expire.mockResolvedValue(true);
            isJwtEnabled.mockReturnValue(true);
            verifyTokenWithClaims.mockReturnValue({
                valid: true,
                decoded: { userId: 'user-456' }
            });

            await authenticateSocket(socket, next);

            expect(verifyTokenWithClaims).toHaveBeenCalledWith('jwt-token', { userId: 'user-456' });
            expect(socket.userId).toBe('user-456');
        });
    });

    describe('JWT error codes - expired and claims mismatch (lines 345, 348)', () => {
        test('sets jwtExpired flag when token is expired', async () => {
            const socket = {
                id: 'socket-123',
                handshake: {
                    auth: { token: 'expired-jwt' },
                    address: '192.168.1.1',
                    headers: {}
                }
            };
            const next = jest.fn();

            playerService.setSocketMapping.mockResolvedValue(true);
            isJwtEnabled.mockReturnValue(true);
            verifyTokenWithClaims.mockReturnValue({
                valid: false,
                error: JWT_ERROR_CODES.TOKEN_EXPIRED,
                message: 'Token expired'
            });

            await authenticateSocket(socket, next);

            expect(socket.jwtExpired).toBe(true);
            expect(next).toHaveBeenCalledWith();
        });

        test('logs warning when JWT claims mismatch', async () => {
            const socket = {
                id: 'socket-123',
                handshake: {
                    auth: { token: 'mismatched-jwt' },
                    address: '192.168.1.1',
                    headers: {}
                }
            };
            const next = jest.fn();

            playerService.setSocketMapping.mockResolvedValue(true);
            isJwtEnabled.mockReturnValue(true);
            verifyTokenWithClaims.mockReturnValue({
                valid: false,
                error: JWT_ERROR_CODES.CLAIMS_MISMATCH,
                message: 'Claims do not match'
            });

            await authenticateSocket(socket, next);

            expect(logger.warn).toHaveBeenCalledWith(
                'JWT claims mismatch detected',
                expect.objectContaining({ socketId: 'socket-123' })
            );
            expect(next).toHaveBeenCalledWith();
        });
    });
});
