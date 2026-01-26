/**
 * Tests for Express Application (app.js)
 */

const request = require('supertest');

// Mock dependencies before requiring app
jest.mock('../utils/logger', () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
}));

jest.mock('../utils/metrics', () => ({
    getAllMetrics: jest.fn(() => ({ counters: {}, gauges: {}, histograms: {} })),
    setSocketConnections: jest.fn()
}));

jest.mock('../utils/correlationId', () => ({
    getCorrelationId: jest.fn(() => 'test-correlation-id'),
    correlationMiddleware: (req, res, next) => next()
}));

jest.mock('../socket/rateLimitHandler', () => ({
    getSocketRateLimitMetrics: jest.fn(() => ({ blockedRequests: 0 }))
}));

jest.mock('../middleware/rateLimit', () => ({
    apiLimiter: (req, res, next) => next(),
    strictLimiter: (req, res, next) => next(),
    getHttpRateLimitMetrics: jest.fn(() => ({ blockedRequests: 0 }))
}));

jest.mock('../middleware/csrf', () => ({
    csrfProtection: (req, res, next) => next()
}));

// Store original env
const originalEnv = process.env.NODE_ENV;

describe('Express Application', () => {
    let app;

    beforeEach(() => {
        jest.clearAllMocks();
        jest.resetModules();

        // Ensure we're not in production for CORS check
        process.env.NODE_ENV = 'test';
        process.env.CORS_ORIGIN = 'http://localhost:3000';

        app = require('../app');
    });

    afterEach(() => {
        process.env.NODE_ENV = originalEnv;
    });

    describe('GET /health', () => {
        it('should return 200 with health status', async () => {
            const response = await request(app).get('/health');

            expect(response.status).toBe(200);
            expect(response.body).toMatchObject({
                status: 'ok',
                timestamp: expect.any(String),
                uptime: expect.any(Number)
            });
        });

        it('should include valid ISO timestamp', async () => {
            const response = await request(app).get('/health');

            const timestamp = new Date(response.body.timestamp);
            expect(timestamp.toISOString()).toBe(response.body.timestamp);
        });

        it('should include positive uptime', async () => {
            const response = await request(app).get('/health');

            expect(response.body.uptime).toBeGreaterThanOrEqual(0);
        });
    });

    describe('GET /health/live', () => {
        it('should return 200 with alive status', async () => {
            const response = await request(app).get('/health/live');

            expect(response.status).toBe(200);
            expect(response.body).toEqual({ status: 'alive' });
        });
    });

    describe('GET /health/ready', () => {
        beforeEach(() => {
            // Mock database module
            jest.mock('../config/database', () => ({
                isDatabaseEnabled: jest.fn(() => false),
                getDatabase: jest.fn()
            }));

            // Mock redis module
            jest.mock('../config/redis', () => ({
                isRedisHealthy: jest.fn(() => Promise.resolve(true)),
                isUsingMemoryMode: jest.fn(() => true),
                getRedis: jest.fn()
            }));
        });

        it('should return 200 with detailed health checks', async () => {
            const response = await request(app).get('/health/ready');

            expect(response.status).toBe(200);
            expect(response.body).toMatchObject({
                status: expect.any(String),
                timestamp: expect.any(String),
                uptime: expect.any(Number),
                memory: expect.any(Object),
                checks: expect.any(Object)
            });
        });

        it('should include memory usage', async () => {
            const response = await request(app).get('/health/ready');

            expect(response.body.memory).toMatchObject({
                heapUsed: expect.any(Number),
                heapTotal: expect.any(Number),
                rss: expect.any(Number)
            });
        });

        it('should include database check', async () => {
            const response = await request(app).get('/health/ready');

            expect(response.body.checks).toHaveProperty('database');
        });

        it('should include storage check', async () => {
            const response = await request(app).get('/health/ready');

            expect(response.body.checks).toHaveProperty('storage');
        });

        it('should include socketio check when io is configured', async () => {
            // Set up mock io
            const mockIo = {
                fetchSockets: jest.fn(() => Promise.resolve([]))
            };
            app.set('io', mockIo);

            const response = await request(app).get('/health/ready');

            expect(response.body.checks).toHaveProperty('socketio');
        });

        it('should handle socketio not configured', async () => {
            app.set('io', null);

            const response = await request(app).get('/health/ready');

            expect(response.body.checks.socketio).toMatchObject({
                status: 'not_configured'
            });
        });
    });

    describe('GET /metrics', () => {
        it('should return 200 with metrics data', async () => {
            const response = await request(app).get('/metrics');

            expect(response.status).toBe(200);
            expect(response.body).toMatchObject({
                timestamp: expect.any(String),
                process: expect.any(Object)
            });
        });

        it('should include process metrics', async () => {
            const response = await request(app).get('/metrics');

            expect(response.body.process).toMatchObject({
                uptime: expect.any(Number),
                memory: expect.any(Object),
                cpu: expect.any(Object)
            });
        });

        it('should include rate limit metrics', async () => {
            const response = await request(app).get('/metrics');

            expect(response.body).toHaveProperty('rateLimits');
            expect(response.body.rateLimits).toMatchObject({
                http: expect.any(Object),
                socket: expect.any(Object)
            });
        });

        it('should include application metrics', async () => {
            const response = await request(app).get('/metrics');

            expect(response.body).toHaveProperty('application');
        });

        it('should include socketio metrics when configured', async () => {
            const mockIo = {
                fetchSockets: jest.fn(() => Promise.resolve([{}, {}, {}]))
            };
            app.set('io', mockIo);

            const response = await request(app).get('/metrics');

            expect(response.body.socketio).toMatchObject({
                status: 'ok',
                connections: expect.any(Number)
            });
        });
    });

    describe('Security Headers', () => {
        it('should include security headers via helmet', async () => {
            const response = await request(app).get('/health');

            // Helmet sets various security headers
            expect(response.headers).toHaveProperty('x-content-type-options');
            expect(response.headers['x-content-type-options']).toBe('nosniff');
        });
    });

    describe('CORS', () => {
        it('should allow configured origin', async () => {
            const response = await request(app)
                .options('/api/rooms/TEST/exists')
                .set('Origin', 'http://localhost:3000');

            // CORS should allow the origin (no error)
            expect([200, 204]).toContain(response.status);
        });
    });

    describe('404 Handling', () => {
        it('should return 404 for unknown API routes', async () => {
            const response = await request(app).get('/api/nonexistent');

            expect(response.status).toBe(404);
        });
    });

    describe('Static Files', () => {
        it('should serve static files from public directory', async () => {
            // The index.html should be served for non-API routes
            const response = await request(app).get('/');

            // Should either return 200 with HTML or 404 if public/index.html doesn't exist in test
            expect([200, 404]).toContain(response.status);
        });
    });

    describe('SPA Routing', () => {
        it('should not serve SPA for /api routes', async () => {
            const response = await request(app).get('/api/test');

            // Should go to API router, not SPA handler
            expect(response.status).toBe(404); // No such API route
        });

        it('should not serve SPA for /health routes', async () => {
            const response = await request(app).get('/health');

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('status');
        });

        it('should not serve SPA for /metrics route', async () => {
            const response = await request(app).get('/metrics');

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('timestamp');
        });
    });

    describe('API Documentation', () => {
        it('should serve Swagger UI at /api-docs', async () => {
            const response = await request(app).get('/api-docs/');

            expect(response.status).toBe(200);
            expect(response.text).toContain('swagger');
        });

        it('should serve OpenAPI spec at /api-docs.json', async () => {
            const response = await request(app).get('/api-docs.json');

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('openapi');
            expect(response.body).toHaveProperty('info');
            expect(response.body.info.title).toBe('Codenames Online API');
        });

        it('should not serve SPA for /api-docs routes', async () => {
            const response = await request(app).get('/api-docs');

            // Should redirect to /api-docs/ (Swagger behavior)
            expect([200, 301, 302]).toContain(response.status);
        });
    });

    describe('updateSocketCount', () => {
        it('should expose updateSocketCount function', () => {
            expect(typeof app.updateSocketCount).toBe('function');
        });

        it('should update socket count with positive delta', () => {
            app.updateSocketCount(5);
            app.updateSocketCount(3);
            // No direct way to test the count, but we can verify it doesn't throw
        });

        it('should not go negative', () => {
            app.updateSocketCount(-1000); // Try to go very negative
            // Should not throw and should clamp to 0
        });
    });
});

describe('Express Application - Production Mode', () => {
    const originalExit = process.exit;

    beforeEach(() => {
        jest.resetModules();
        process.exit = jest.fn();
    });

    afterEach(() => {
        process.exit = originalExit;
        process.env.NODE_ENV = 'test';
        delete process.env.CORS_ORIGIN;
    });

    it('should exit if CORS_ORIGIN is wildcard in production', () => {
        process.env.NODE_ENV = 'production';
        process.env.CORS_ORIGIN = '*';

        // This should call process.exit(1)
        try {
            require('../app');
        } catch {
            // Expected - module may throw after process.exit is called
        }

        expect(process.exit).toHaveBeenCalledWith(1);
    });
});

describe('Express Application - Fly.io Environment', () => {
    const originalFlyAllocId = process.env.FLY_ALLOC_ID;
    const originalFlyRegion = process.env.FLY_REGION;

    beforeEach(() => {
        jest.resetModules();
        process.env.NODE_ENV = 'test';
        process.env.CORS_ORIGIN = 'http://localhost:3000';
        process.env.FLY_ALLOC_ID = 'test-alloc-id';
        process.env.FLY_REGION = 'iad';
    });

    afterEach(() => {
        if (originalFlyAllocId) {
            process.env.FLY_ALLOC_ID = originalFlyAllocId;
        } else {
            delete process.env.FLY_ALLOC_ID;
        }
        if (originalFlyRegion) {
            process.env.FLY_REGION = originalFlyRegion;
        } else {
            delete process.env.FLY_REGION;
        }
    });

    it('should include Fly.io instance info in /health/ready', async () => {
        const app = require('../app');
        const response = await request(app).get('/health/ready');

        expect(response.body.instance).toMatchObject({
            flyAllocId: 'test-alloc-id',
            flyRegion: 'iad'
        });
    });

    it('should include Fly.io instance info in /metrics', async () => {
        const app = require('../app');
        const response = await request(app).get('/metrics');

        expect(response.body.instance).toMatchObject({
            flyAllocId: 'test-alloc-id',
            flyRegion: 'iad'
        });
    });
});
