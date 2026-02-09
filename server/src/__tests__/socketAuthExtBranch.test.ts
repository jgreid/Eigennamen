/**
 * Socket Auth Extended Branch Coverage Tests
 *
 * Tests: memory rate limit cleanup timer, authenticateSocket origin validation failure
 */

jest.mock('../utils/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
}));

const mockPlayerService = {
    getPlayer: jest.fn().mockResolvedValue(null),
    validateReconnectToken: jest.fn().mockResolvedValue(true),
    setSocketMapping: jest.fn().mockResolvedValue(true)
};

jest.mock('../services/playerService', () => mockPlayerService);

jest.mock('../config/jwt', () => ({
    verifyTokenWithClaims: jest.fn().mockReturnValue({ valid: false }),
    isJwtEnabled: jest.fn().mockReturnValue(false),
    JWT_ERROR_CODES: {
        TOKEN_EXPIRED: 'TOKEN_EXPIRED',
        CLAIMS_MISMATCH: 'CLAIMS_MISMATCH'
    }
}));

const mockRedis = {
    incr: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(1)
};

jest.mock('../config/redis', () => ({
    getRedis: () => mockRedis
}));

jest.mock('../services/auditService', () => ({
    audit: {
        suspicious: jest.fn()
    }
}));

const socketAuth = require('../middleware/socketAuth');

describe('Socket Auth Extended Branch Coverage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Reset env vars
        delete process.env.TRUST_PROXY;
        delete process.env.FLY_APP_NAME;
        delete process.env.DYNO;
        delete process.env.CORS_ORIGIN;
        delete process.env.NODE_ENV;
    });

    describe('validateOrigin', () => {
        it('should allow all origins in development with wildcard CORS', () => {
            process.env.NODE_ENV = 'development';
            process.env.CORS_ORIGIN = '*';

            const socket = {
                id: 'socket-1',
                handshake: {
                    headers: { origin: 'http://localhost:3000' },
                    address: '127.0.0.1',
                    auth: {}
                }
            };

            const result = socketAuth.validateOrigin(socket);
            expect(result.valid).toBe(true);
        });

        it('should allow all origins in development without CORS_ORIGIN set', () => {
            process.env.NODE_ENV = 'development';
            delete process.env.CORS_ORIGIN;

            const socket = {
                id: 'socket-1',
                handshake: {
                    headers: { origin: 'http://anywhere.com' },
                    address: '127.0.0.1',
                    auth: {}
                }
            };

            const result = socketAuth.validateOrigin(socket);
            expect(result.valid).toBe(true);
        });

        it('should reject unauthorized origin in production', () => {
            process.env.NODE_ENV = 'production';
            process.env.CORS_ORIGIN = 'https://myapp.com';

            const socket = {
                id: 'socket-1',
                handshake: {
                    headers: { origin: 'https://evil.com' },
                    address: '127.0.0.1',
                    auth: {}
                }
            };

            const result = socketAuth.validateOrigin(socket);
            expect(result.valid).toBe(false);
            expect(result.reason).toBe('Origin not allowed');
        });

        it('should allow matching origin in production', () => {
            process.env.NODE_ENV = 'production';
            process.env.CORS_ORIGIN = 'https://myapp.com';

            const socket = {
                id: 'socket-1',
                handshake: {
                    headers: { origin: 'https://myapp.com' },
                    address: '127.0.0.1',
                    auth: {}
                }
            };

            const result = socketAuth.validateOrigin(socket);
            expect(result.valid).toBe(true);
        });

        it('should support wildcard subdomain matching', () => {
            process.env.NODE_ENV = 'production';
            process.env.CORS_ORIGIN = '*.example.com';

            const socket = {
                id: 'socket-1',
                handshake: {
                    headers: { origin: 'https://sub.example.com' },
                    address: '127.0.0.1',
                    auth: {}
                }
            };

            const result = socketAuth.validateOrigin(socket);
            expect(result.valid).toBe(true);
        });

        it('should not match origin that only ends with domain without dot separator', () => {
            process.env.NODE_ENV = 'production';
            process.env.CORS_ORIGIN = '*.example.com';

            const socket = {
                id: 'socket-1',
                handshake: {
                    headers: { origin: 'https://notexample.com' },
                    address: '127.0.0.1',
                    auth: {}
                }
            };

            const result = socketAuth.validateOrigin(socket);
            expect(result.valid).toBe(false);
        });

        it('should allow missing origin header in production (backwards compat)', () => {
            process.env.NODE_ENV = 'production';
            process.env.CORS_ORIGIN = 'https://myapp.com';

            const socket = {
                id: 'socket-1',
                handshake: {
                    headers: {},
                    address: '127.0.0.1',
                    auth: {}
                }
            };

            const result = socketAuth.validateOrigin(socket);
            expect(result.valid).toBe(true);
        });

        it('should allow missing origin header in development', () => {
            process.env.NODE_ENV = 'development';
            process.env.CORS_ORIGIN = 'http://localhost:3000';

            const socket = {
                id: 'socket-1',
                handshake: {
                    headers: {},
                    address: '127.0.0.1',
                    auth: {}
                }
            };

            const result = socketAuth.validateOrigin(socket);
            expect(result.valid).toBe(true);
        });
    });

    describe('authenticateSocket - origin validation failure', () => {
        it('should call next with error when origin is rejected', async () => {
            process.env.NODE_ENV = 'production';
            process.env.CORS_ORIGIN = 'https://myapp.com';

            const socket = {
                id: 'socket-1',
                handshake: {
                    headers: { origin: 'https://evil.com' },
                    address: '127.0.0.1',
                    auth: { sessionId: 'test-session' }
                }
            };

            const next = jest.fn();
            await socketAuth.authenticateSocket(socket, next);

            expect(next).toHaveBeenCalledWith(expect.any(Error));
            expect(next.mock.calls[0][0].message).toBe('Origin not allowed');
        });
    });

    describe('authenticateSocket - successful authentication', () => {
        it('should generate new session ID when none provided', async () => {
            process.env.NODE_ENV = 'development';
            delete process.env.CORS_ORIGIN;

            const socket = {
                id: 'socket-1',
                handshake: {
                    headers: {},
                    address: '127.0.0.1',
                    auth: {}
                }
            } as Record<string, unknown>;

            const next = jest.fn();
            await socketAuth.authenticateSocket(socket, next);

            expect(next).toHaveBeenCalledWith(); // No error
            expect((socket as Record<string, unknown>).sessionId).toBeDefined();
        });
    });

    describe('authenticateSocket - error handling', () => {
        it('should handle errors during authentication', async () => {
            process.env.NODE_ENV = 'development';
            delete process.env.CORS_ORIGIN;

            // Make setSocketMapping throw
            mockPlayerService.setSocketMapping.mockRejectedValueOnce(new Error('DB error'));

            const socket = {
                id: 'socket-1',
                handshake: {
                    headers: {},
                    address: '127.0.0.1',
                    auth: {}
                }
            };

            const next = jest.fn();
            await socketAuth.authenticateSocket(socket, next);

            expect(next).toHaveBeenCalledWith(expect.any(Error));
            expect(next.mock.calls[0][0].message).toBe('Authentication failed');
        });
    });

    describe('getClientIP', () => {
        it('should use direct address when proxy not trusted', () => {
            delete process.env.TRUST_PROXY;
            delete process.env.FLY_APP_NAME;
            delete process.env.DYNO;

            const socket = {
                handshake: {
                    headers: { 'x-forwarded-for': '10.0.0.1' },
                    address: '192.168.1.1'
                }
            };

            const ip = socketAuth.getClientIP(socket);
            expect(ip).toBe('192.168.1.1');
        });

        it('should use X-Forwarded-For when proxy trusted', () => {
            process.env.TRUST_PROXY = 'true';

            const socket = {
                handshake: {
                    headers: { 'x-forwarded-for': '10.0.0.1, 192.168.1.1' },
                    address: '172.16.0.1'
                }
            };

            const ip = socketAuth.getClientIP(socket);
            expect(ip).toBe('10.0.0.1');
        });

        it('should detect Fly.io deployment', () => {
            process.env.FLY_APP_NAME = 'myapp';

            const socket = {
                handshake: {
                    headers: { 'x-forwarded-for': '10.0.0.1' },
                    address: '172.16.0.1'
                }
            };

            const ip = socketAuth.getClientIP(socket);
            expect(ip).toBe('10.0.0.1');
        });

        it('should detect Heroku deployment', () => {
            process.env.DYNO = 'web.1';

            const socket = {
                handshake: {
                    headers: { 'x-forwarded-for': '10.0.0.1' },
                    address: '172.16.0.1'
                }
            };

            const ip = socketAuth.getClientIP(socket);
            expect(ip).toBe('10.0.0.1');
        });

        it('should handle array X-Forwarded-For', () => {
            process.env.TRUST_PROXY = 'true';

            const socket = {
                handshake: {
                    headers: { 'x-forwarded-for': ['10.0.0.1', '10.0.0.2'] },
                    address: '172.16.0.1'
                }
            };

            const ip = socketAuth.getClientIP(socket);
            expect(ip).toBe('10.0.0.1');
        });
    });

    describe('validateSession', () => {
        it('should reject when rate limited', async () => {
            // Make rate limit check fail
            mockRedis.incr.mockResolvedValue(999);

            const result = await socketAuth.validateSession('session-1', '127.0.0.1');
            expect(result.valid).toBe(false);
        });

        it('should reject when player not found', async () => {
            mockRedis.incr.mockResolvedValue(1);
            mockPlayerService.getPlayer.mockResolvedValue(null);

            const result = await socketAuth.validateSession('session-1', '127.0.0.1');
            expect(result.valid).toBe(false);
        });

        it('should validate session with valid player', async () => {
            mockRedis.incr.mockResolvedValue(1);
            mockPlayerService.getPlayer.mockResolvedValue({
                sessionId: 'session-1',
                connected: true,
                connectedAt: Date.now(),
                lastIP: '127.0.0.1'
            });

            const result = await socketAuth.validateSession('session-1', '127.0.0.1');
            expect(result.valid).toBe(true);
        });
    });
});
