/**
 * Adversarial Security Tests
 *
 * Tests that verify the application resists common attack patterns:
 * - Error message information disclosure
 * - CSRF protection enforcement
 * - Admin authentication security
 * - Connection rate limiting / DoS mitigation
 * - JWT handling edge cases
 */

const request = require('supertest');
const express = require('express');

// Mock Redis
jest.mock('../../config/redis', () => {
    const mockRedis = {
        get: jest.fn(async () => null),
        set: jest.fn(async () => 'OK'),
        del: jest.fn(async () => 0),
        keys: jest.fn(async () => []),
        exists: jest.fn(async () => 0),
        expire: jest.fn(async () => 1),
        scan: jest.fn(async () => ({ cursor: 0, keys: [] })),
        sMembers: jest.fn(async () => []),
        sAdd: jest.fn(async () => 0),
        eval: jest.fn(async () => 1),
    };
    return {
        getRedis: jest.fn(() => mockRedis),
        connectRedis: jest.fn(async () => {}),
        disconnectRedis: jest.fn(async () => {}),
        isRedisHealthy: jest.fn(async () => true),
        isUsingMemoryMode: jest.fn(() => true),
        getPubSubClients: jest.fn(() => ({ pubClient: mockRedis, subClient: mockRedis })),
    };
});

// Mock logger
jest.mock('../../utils/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn(() => ({
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    })),
}));

// Mock metrics
jest.mock('../../utils/metrics', () => ({
    getAllMetrics: jest.fn(() => ({
        timestamp: Date.now(),
        instanceId: 'test',
        counters: {},
        gauges: {},
        histograms: {},
    })),
    incrementCounter: jest.fn(),
    setGauge: jest.fn(),
    METRIC_NAMES: {
        SOCKET_CONNECTIONS: 'socket_connections',
        RATE_LIMIT_HITS: 'rate_limit_hits',
        WEBSOCKET_EVENTS: 'websocket_events',
    },
}));

// Mock audit service
jest.mock('../../services/auditService', () => ({
    audit: {
        adminLogin: jest.fn(async () => {}),
        suspicious: jest.fn(async () => {}),
    },
}));

describe('Adversarial Security Tests', () => {
    describe('Error Message Information Disclosure', () => {
        let app: any;

        beforeEach(() => {
            const originalEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'production';

            const { errorHandler, notFoundHandler } = require('../../middleware/errorHandler');
            app = express();
            app.use(express.json());

            // Route that throws an internal error with stack trace
            app.get('/api/throw-internal', () => {
                throw new Error('Internal: DB connection to postgres://admin:secret@db:5432 failed');
            });

            // Route that throws a known game error
            app.get('/api/throw-game-error', () => {
                const err: any = new Error('Room not found');
                err.code = 'ROOM_NOT_FOUND';
                err.details = {
                    roomCode: 'ABCD',
                    internalQuery: 'SELECT * FROM rooms', // should be stripped
                    stackTrace: 'at Object.<anonymous>...', // should be stripped
                };
                throw err;
            });

            app.use(notFoundHandler);
            app.use(errorHandler);

            // Restore after setup since errorHandler reads NODE_ENV at runtime
            process.env.NODE_ENV = originalEnv;
        });

        test('production error responses do not leak internal details', async () => {
            const origEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'production';
            try {
                const res = await request(app).get('/api/throw-internal');
                expect(res.status).toBe(500);
                const body = JSON.stringify(res.body);
                // Should not contain connection strings, passwords, or stack traces
                expect(body).not.toContain('postgres://');
                expect(body).not.toContain('secret');
                expect(body).not.toContain('admin:');
                expect(body).toContain('Internal server error');
            } finally {
                process.env.NODE_ENV = origEnv;
            }
        });

        test('error detail allowlist strips unknown fields', async () => {
            const res = await request(app).get('/api/throw-game-error');
            expect(res.status).toBe(404);
            expect(res.body.error.details).toBeDefined();
            expect(res.body.error.details.roomCode).toBe('ABCD');
            // Internal fields should be stripped
            expect(res.body.error.details.internalQuery).toBeUndefined();
            expect(res.body.error.details.stackTrace).toBeUndefined();
        });

        test('404 responses do not reveal server technology', async () => {
            const res = await request(app).get('/api/nonexistent-endpoint');
            expect(res.status).toBe(404);
            const body = JSON.stringify(res.body);
            expect(body).not.toContain('Express');
            expect(body).not.toContain('Node');
            expect(body).not.toContain('Cannot GET');
        });
    });

    describe('CSRF Protection', () => {
        let app: any;

        beforeEach(() => {
            const { csrfProtection } = require('../../middleware/csrf');
            app = express();
            app.use(express.json());

            // Apply CSRF to all routes
            app.use(csrfProtection);
            app.post('/api/action', (_req: any, res: any) => res.json({ ok: true }));
            app.get('/api/data', (_req: any, res: any) => res.json({ ok: true }));
        });

        test('blocks POST without X-Requested-With header', async () => {
            const res = await request(app).post('/api/action').send({ data: 'test' });
            expect(res.status).toBe(403);
            expect(res.body.error.code).toBe('CSRF_VALIDATION_FAILED');
        });

        test('allows GET without X-Requested-With (safe method)', async () => {
            const res = await request(app).get('/api/data');
            expect(res.status).toBe(200);
        });

        test('blocks POST with invalid X-Requested-With value', async () => {
            const res = await request(app)
                .post('/api/action')
                .set('X-Requested-With', 'evil-script')
                .send({ data: 'test' });
            expect(res.status).toBe(403);
        });

        test('allows POST with valid X-Requested-With header', async () => {
            const res = await request(app)
                .post('/api/action')
                .set('X-Requested-With', 'XMLHttpRequest')
                .send({ data: 'test' });
            expect(res.status).toBe(200);
        });

        test('blocks cross-origin POST when CORS_ORIGIN is restricted', async () => {
            const origCors = process.env.CORS_ORIGIN;
            process.env.CORS_ORIGIN = 'https://example.com';
            try {
                // Re-import to pick up new env
                jest.resetModules();
                const { csrfProtection: csrf2 } = require('../../middleware/csrf');
                const app2 = express();
                app2.use(express.json());
                app2.use(csrf2);
                app2.post('/api/action', (_req: any, res: any) => res.json({ ok: true }));

                const res = await request(app2)
                    .post('/api/action')
                    .set('X-Requested-With', 'XMLHttpRequest')
                    .set('Origin', 'https://evil.com')
                    .send({ data: 'test' });
                expect(res.status).toBe(403);
            } finally {
                process.env.CORS_ORIGIN = origCors;
                jest.resetModules();
            }
        });
    });

    describe('Admin Authentication Security', () => {
        let app: any;

        beforeEach(() => {
            jest.resetModules();
            process.env.ADMIN_PASSWORD = 'test-admin-password-123';
            process.env.NODE_ENV = 'test';
        });

        afterEach(() => {
            delete process.env.ADMIN_PASSWORD;
            jest.resetModules();
        });

        function createAdminApp() {
            const adminRoutes = require('../../routes/adminRoutes').default;
            const testApp = express();
            testApp.use(express.json());
            testApp.use('/admin', adminRoutes);
            return testApp;
        }

        test('rejects request without credentials', async () => {
            app = createAdminApp();
            const res = await request(app).get('/admin/');
            expect(res.status).toBe(401);
            expect(res.headers['www-authenticate']).toContain('Basic');
        });

        test('rejects request with wrong password', async () => {
            app = createAdminApp();
            const creds = Buffer.from('admin:wrong-password').toString('base64');
            const res = await request(app).get('/admin/').set('Authorization', `Basic ${creds}`);
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe('AUTH_INVALID');
        });

        test('accepts correct credentials', async () => {
            app = createAdminApp();
            const creds = Buffer.from('admin:test-admin-password-123').toString('base64');
            const res = await request(app).get('/admin/').set('Authorization', `Basic ${creds}`);
            // Should succeed (may be 200 or 500 if admin.html doesn't exist in test)
            expect(res.status).not.toBe(401);
        });

        test('error response does not reveal whether password is close', async () => {
            app = createAdminApp();
            const creds1 = Buffer.from('admin:test-admin-password-12').toString('base64');
            const creds2 = Buffer.from('admin:completely-wrong').toString('base64');

            const res1 = await request(app).get('/admin/').set('Authorization', `Basic ${creds1}`);
            const res2 = await request(app).get('/admin/').set('Authorization', `Basic ${creds2}`);

            // Both should return identical error structure
            expect(res1.status).toBe(res2.status);
            expect(res1.body).toEqual(res2.body);
        });

        test('denies all access when ADMIN_PASSWORD is not set', async () => {
            delete process.env.ADMIN_PASSWORD;
            jest.resetModules();
            app = createAdminApp();

            const creds = Buffer.from('admin:anything').toString('base64');
            const res = await request(app).get('/admin/').set('Authorization', `Basic ${creds}`);
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe('ADMIN_NOT_CONFIGURED');
        });
    });

    describe('Connection Rate Limiting', () => {
        let connectionTracker: any;

        beforeEach(() => {
            jest.resetModules();
            connectionTracker = require('../../socket/connectionTracker');
        });

        afterEach(() => {
            // Clean up maps
            connectionTracker.getConnectionsMap().clear();
            connectionTracker.getAuthFailuresMap().clear();
        });

        test('blocks IP after MAX_CONNECTIONS_PER_IP concurrent connections', () => {
            const ip = '192.168.1.100';
            // Fill up to the limit
            for (let i = 0; i < 10; i++) {
                connectionTracker.incrementConnectionCount(ip);
            }
            expect(connectionTracker.isConnectionLimitReached(ip)).toBe(true);
        });

        test('allows connections after disconnect frees slots', () => {
            const ip = '192.168.1.100';
            for (let i = 0; i < 10; i++) {
                connectionTracker.incrementConnectionCount(ip);
            }
            expect(connectionTracker.isConnectionLimitReached(ip)).toBe(true);

            connectionTracker.decrementConnectionCount(ip);
            expect(connectionTracker.isConnectionLimitReached(ip)).toBe(false);
        });

        test('blocks IP after too many auth failures', () => {
            const ip = '10.0.0.1';
            // Record failures up to the limit
            for (let i = 0; i < 10; i++) {
                connectionTracker.recordAuthFailure(ip);
            }
            expect(connectionTracker.isAuthBlocked(ip)).toBe(true);
        });

        test('clears auth failures on successful authentication', () => {
            const ip = '10.0.0.1';
            for (let i = 0; i < 5; i++) {
                connectionTracker.recordAuthFailure(ip);
            }
            connectionTracker.clearAuthFailures(ip);
            expect(connectionTracker.isAuthBlocked(ip)).toBe(false);
        });

        test('connection count cannot go negative', () => {
            const ip = '10.0.0.2';
            connectionTracker.decrementConnectionCount(ip);
            expect(connectionTracker.getConnectionCount(ip)).toBe(0);
        });
    });

    describe('Socket Rate Limiter', () => {
        let createSocketRateLimiter: any;

        beforeEach(() => {
            jest.resetModules();
            ({ createSocketRateLimiter } = require('../../middleware/rateLimit'));
        });

        test('blocks socket after exceeding per-event limit', () => {
            const limiter = createSocketRateLimiter({
                'test:event': { max: 3, window: 60000 },
            });

            const socket = { id: 'socket-1', clientIP: '127.0.0.1', handshake: { address: '127.0.0.1' } };
            const middleware = limiter.getLimiter('test:event');
            let blocked = false;

            // Send requests up to and past limit
            for (let i = 0; i < 4; i++) {
                middleware(socket, {}, (err?: Error) => {
                    if (err && i === 3) blocked = true;
                });
            }
            expect(blocked).toBe(true);
        });

        test('different sockets on same IP are independently limited', () => {
            const limiter = createSocketRateLimiter({
                'test:event': { max: 2, window: 60000 },
            });

            const socket1 = { id: 'socket-1', clientIP: '127.0.0.1', handshake: { address: '127.0.0.1' } };
            const socket2 = { id: 'socket-2', clientIP: '127.0.0.1', handshake: { address: '127.0.0.1' } };
            const middleware = limiter.getLimiter('test:event');

            let s1Blocked = false;
            let s2Blocked = false;

            // Socket 1: 2 requests (at limit)
            for (let i = 0; i < 2; i++) {
                middleware(socket1, {}, () => {});
            }

            // Socket 2: should still have its own quota
            middleware(socket2, {}, (err?: Error) => {
                s2Blocked = !!err;
            });
            expect(s2Blocked).toBe(false);

            // Socket 1: next request should be blocked
            middleware(socket1, {}, (err?: Error) => {
                s1Blocked = !!err;
            });
            expect(s1Blocked).toBe(true);
        });

        test('global IP rate limit prevents cross-event abuse', () => {
            // Create limiter with high per-event limits but low global IP limit
            const origGlobal = process.env.GLOBAL_IP_RATE_LIMIT_MAX;
            process.env.GLOBAL_IP_RATE_LIMIT_MAX = '5';

            jest.resetModules();
            const { createSocketRateLimiter: createLimiter } = require('../../middleware/rateLimit');

            const limiter = createLimiter({
                'event:a': { max: 100, window: 60000 },
                'event:b': { max: 100, window: 60000 },
            });

            const socket = { id: 'socket-1', clientIP: '127.0.0.1', handshake: { address: '127.0.0.1' } };
            let globalBlocked = false;

            // Send 3 requests to event:a
            const middlewareA = limiter.getLimiter('event:a');
            for (let i = 0; i < 3; i++) {
                middlewareA(socket, {}, () => {});
            }

            // Send 3 requests to event:b — should hit global limit
            const middlewareB = limiter.getLimiter('event:b');
            for (let i = 0; i < 3; i++) {
                middlewareB(socket, {}, (err?: Error) => {
                    if (err && err.message.includes('Global rate limit')) {
                        globalBlocked = true;
                    }
                });
            }

            expect(globalBlocked).toBe(true);
            process.env.GLOBAL_IP_RATE_LIMIT_MAX = origGlobal;
        });

        test('returns passthrough for unconfigured events', () => {
            const limiter = createSocketRateLimiter({});
            const middleware = limiter.getLimiter('unknown:event');
            let called = false;
            middleware({ id: 's1', clientIP: '1.2.3.4' }, {}, () => {
                called = true;
            });
            expect(called).toBe(true);
        });
    });

    describe('JWT Expired Token Handling', () => {
        test('expired JWT tokens are rejected', () => {
            const jwt = require('jsonwebtoken');
            // Create a token that expired 1 hour ago
            const secret = 'test-jwt-secret-long-enough';
            const payload = { sessionId: 'test-session', ip: '127.0.0.1' };
            const token = jwt.sign(payload, secret, { expiresIn: '-1h' });

            expect(() => jwt.verify(token, secret)).toThrow(/expired/i);
        });

        test('JWT with wrong secret is rejected', () => {
            const jwt = require('jsonwebtoken');
            const token = jwt.sign({ sessionId: 'test' }, 'correct-secret-long-enough', { expiresIn: '1h' });

            expect(() => jwt.verify(token, 'wrong-secret-long-enough')).toThrow(/signature/i);
        });

        test('malformed JWT is rejected', () => {
            const jwt = require('jsonwebtoken');
            expect(() => jwt.verify('not.a.real.jwt.token', 'any-secret')).toThrow();
        });
    });
});
