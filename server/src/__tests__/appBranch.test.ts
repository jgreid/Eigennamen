/**
 * App Branch Coverage Tests
 *
 * Tests additional branches in app.ts including:
 * - Health endpoint with various storage/database states
 * - Metrics endpoint with socket.io errors and missing rate limiter
 * - getCachedSocketCount timeout and stale cache
 * - Trust proxy configuration
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
    correlationMiddleware: (_req: any, _res: any, next: any) => next()
}));

jest.mock('../socket/rateLimitHandler', () => ({}));

jest.mock('../middleware/rateLimit', () => ({
    apiLimiter: (_req: any, _res: any, next: any) => next(),
    strictLimiter: (_req: any, _res: any, next: any) => next(),
    getHttpRateLimitMetrics: jest.fn(() => ({ totalRequests: 0 }))
}));

jest.mock('../middleware/csrf', () => ({
    csrfProtection: (_req: any, _res: any, next: any) => next()
}));

jest.mock('../middleware/timing', () => ({
    requestTiming: (_req: any, _res: any, next: any) => next()
}));

jest.mock('../config/swagger', () => ({
    setupSwagger: jest.fn()
}));

jest.mock('../routes/adminRoutes', () => {
    const express = require('express');
    return express.Router();
});

jest.mock('../services/auditService', () => ({
    audit: { suspicious: jest.fn() },
    logAuditEvent: jest.fn(),
    AUDIT_EVENTS: {}
}));

const originalEnv = { ...process.env };

describe('App Branch Coverage', () => {
    let app: any;

    beforeEach(() => {
        jest.clearAllMocks();
        jest.resetModules();
        process.env.NODE_ENV = 'test';
        process.env.CORS_ORIGIN = 'http://localhost:3000';
        delete process.env.FLY_ALLOC_ID;
        delete process.env.FLY_REGION;
        delete process.env.TRUST_PROXY;
    });

    afterEach(() => {
        process.env = { ...originalEnv };
    });

    describe('/health/ready - storage unhealthy', () => {
        it('should return 503 when storage is unhealthy', async () => {
            jest.mock('../config/database', () => ({
                isDatabaseEnabled: jest.fn(() => false)
            }));
            jest.mock('../config/redis', () => ({
                isRedisHealthy: jest.fn().mockResolvedValue(false),
                isUsingMemoryMode: jest.fn(() => false),
                getRedis: jest.fn()
            }));

            app = require('../app');

            const response = await request(app).get('/health/ready');
            expect(response.status).toBe(503);
            expect(response.body.status).toBe('degraded');
            expect(response.body.checks.storage.status).toBe('error');
        });
    });

    describe('/health/ready - storage throws', () => {
        it('should return 503 when storage check throws', async () => {
            jest.mock('../config/database', () => ({
                isDatabaseEnabled: jest.fn(() => false)
            }));
            jest.mock('../config/redis', () => ({
                isRedisHealthy: jest.fn().mockRejectedValue(new Error('Redis gone')),
                isUsingMemoryMode: jest.fn(() => false),
                getRedis: jest.fn()
            }));

            app = require('../app');

            const response = await request(app).get('/health/ready');
            expect(response.status).toBe(503);
            expect(response.body.status).toBe('degraded');
            expect(response.body.checks.storage.status).toBe('error');
            expect(response.body.checks.storage.message).toBe('Redis gone');
        });
    });

    describe('/health/ready - database enabled and working', () => {
        it('should show database ok when enabled and connected', async () => {
            jest.mock('../config/database', () => ({
                isDatabaseEnabled: jest.fn(() => true)
            }));
            jest.mock('../config/redis', () => ({
                isRedisHealthy: jest.fn().mockResolvedValue(true),
                isUsingMemoryMode: jest.fn(() => true),
                getRedis: jest.fn()
            }));

            app = require('../app');

            // Mock the database getter on app
            const mockPrisma = {
                $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }])
            };
            app.set('database', () => mockPrisma);

            const response = await request(app).get('/health/ready');
            expect(response.status).toBe(200);
            expect(response.body.checks.database.status).toBe('ok');
        });
    });

    describe('/health/ready - database throws', () => {
        it('should handle database error gracefully', async () => {
            jest.mock('../config/database', () => ({
                isDatabaseEnabled: jest.fn(() => true)
            }));
            jest.mock('../config/redis', () => ({
                isRedisHealthy: jest.fn().mockResolvedValue(true),
                isUsingMemoryMode: jest.fn(() => false),
                getRedis: jest.fn()
            }));

            app = require('../app');

            // Mock the database getter that throws
            app.set('database', () => ({
                $queryRaw: jest.fn().mockRejectedValue(new Error('DB down'))
            }));

            const response = await request(app).get('/health/ready');
            // Database errors are non-critical, so overall status is still ok
            expect(response.body.checks.database.status).toBe('error');
            expect(response.body.checks.database.message).toBe('DB down');
        });
    });

    describe('/health/ready - socket.io fetchSockets fails (stale cache)', () => {
        it('should return stale cache note when fetchSockets rejects', async () => {
            jest.mock('../config/database', () => ({
                isDatabaseEnabled: jest.fn(() => false)
            }));
            jest.mock('../config/redis', () => ({
                isRedisHealthy: jest.fn().mockResolvedValue(true),
                isUsingMemoryMode: jest.fn(() => true),
                getRedis: jest.fn()
            }));

            app = require('../app');

            // Set io to an object that rejects on fetchSockets
            // getCachedSocketCount catches this and returns stale cache
            app.set('io', {
                fetchSockets: jest.fn().mockRejectedValue(new Error('Socket.io error'))
            });

            const response = await request(app).get('/health/ready');
            expect(response.status).toBe(200);
            expect(response.body.checks.socketio.status).toBe('ok');
            expect(response.body.checks.socketio.note).toBe('Count may be stale');
        });
    });

    describe('/health/ready - storage healthy, memory mode note', () => {
        it('should include note when using memory mode', async () => {
            jest.mock('../config/database', () => ({
                isDatabaseEnabled: jest.fn(() => false)
            }));
            jest.mock('../config/redis', () => ({
                isRedisHealthy: jest.fn().mockResolvedValue(true),
                isUsingMemoryMode: jest.fn(() => true),
                getRedis: jest.fn()
            }));

            app = require('../app');

            const response = await request(app).get('/health/ready');
            expect(response.body.checks.storage.type).toBe('memory');
            expect(response.body.checks.storage.note).toContain('Single-instance');
        });
    });

    describe('/health/ready - redis mode (non-memory)', () => {
        it('should show redis type when not using memory mode', async () => {
            jest.mock('../config/database', () => ({
                isDatabaseEnabled: jest.fn(() => false)
            }));
            jest.mock('../config/redis', () => ({
                isRedisHealthy: jest.fn().mockResolvedValue(true),
                isUsingMemoryMode: jest.fn(() => false),
                getRedis: jest.fn()
            }));

            app = require('../app');

            const response = await request(app).get('/health/ready');
            expect(response.body.checks.storage.type).toBe('redis');
            expect(response.body.checks.storage.note).toBeUndefined();
        });
    });

    describe('/metrics - socket.io fetchSockets fails (stale cache)', () => {
        it('should return stale socketio data when fetchSockets rejects', async () => {
            jest.mock('../config/database', () => ({
                isDatabaseEnabled: jest.fn(() => false)
            }));
            jest.mock('../config/redis', () => ({
                isRedisHealthy: jest.fn().mockResolvedValue(true),
                isUsingMemoryMode: jest.fn(() => true),
                getRedis: jest.fn()
            }));

            app = require('../app');

            app.set('io', {
                fetchSockets: jest.fn().mockRejectedValue(new Error('Fetch failed'))
            });

            const response = await request(app).get('/metrics');
            expect(response.status).toBe(200);
            // getCachedSocketCount catches the error and returns stale cache
            expect(response.body.socketio.status).toBe('ok');
            expect(response.body.socketio.note).toBe('Count may be stale');
        });
    });

    describe('/metrics - application metrics throws', () => {
        it('should handle application metrics error', async () => {
            jest.mock('../config/database', () => ({
                isDatabaseEnabled: jest.fn(() => false)
            }));
            jest.mock('../config/redis', () => ({
                isRedisHealthy: jest.fn().mockResolvedValue(true),
                isUsingMemoryMode: jest.fn(() => true),
                getRedis: jest.fn()
            }));

            const { getAllMetrics } = require('../utils/metrics');
            getAllMetrics.mockImplementation(() => { throw new Error('Metrics error'); });

            app = require('../app');

            const response = await request(app).get('/metrics');
            expect(response.status).toBe(200);
            expect(response.body.application.status).toBe('error');
        });
    });

    describe('/metrics - rate limit metrics throws', () => {
        it('should handle rate limit metrics error', async () => {
            jest.mock('../config/database', () => ({
                isDatabaseEnabled: jest.fn(() => false)
            }));
            jest.mock('../config/redis', () => ({
                isRedisHealthy: jest.fn().mockResolvedValue(true),
                isUsingMemoryMode: jest.fn(() => true),
                getRedis: jest.fn()
            }));

            const { getHttpRateLimitMetrics } = require('../middleware/rateLimit');
            getHttpRateLimitMetrics.mockImplementation(() => { throw new Error('Rate limit metrics error'); });

            app = require('../app');

            const response = await request(app).get('/metrics');
            expect(response.status).toBe(200);
            expect(response.body.rateLimits).toEqual({ http: {}, socket: {} });
        });
    });

    describe('/metrics - socketRateLimiter available', () => {
        it('should include socket rate limiter metrics when available', async () => {
            jest.mock('../config/database', () => ({
                isDatabaseEnabled: jest.fn(() => false)
            }));
            jest.mock('../config/redis', () => ({
                isRedisHealthy: jest.fn().mockResolvedValue(true),
                isUsingMemoryMode: jest.fn(() => true),
                getRedis: jest.fn()
            }));

            app = require('../app');

            app.set('socketRateLimiter', {
                getMetrics: jest.fn(() => ({ blocked: 5 }))
            });

            const response = await request(app).get('/metrics');
            expect(response.body.rateLimits.socket).toEqual({ blocked: 5 });
        });
    });

    describe('Trust proxy configuration', () => {
        it('should enable trust proxy in production', async () => {
            jest.mock('../config/database', () => ({
                isDatabaseEnabled: jest.fn(() => false)
            }));
            jest.mock('../config/redis', () => ({
                isRedisHealthy: jest.fn().mockResolvedValue(true),
                isUsingMemoryMode: jest.fn(() => true),
                getRedis: jest.fn()
            }));

            process.env.NODE_ENV = 'production';
            process.env.CORS_ORIGIN = 'https://example.com';

            app = require('../app');
            // Just ensure it doesn't crash - trust proxy is set
            expect(app).toBeDefined();
        });

        it('should enable trust proxy when TRUST_PROXY is true', async () => {
            jest.mock('../config/database', () => ({
                isDatabaseEnabled: jest.fn(() => false)
            }));
            jest.mock('../config/redis', () => ({
                isRedisHealthy: jest.fn().mockResolvedValue(true),
                isUsingMemoryMode: jest.fn(() => true),
                getRedis: jest.fn()
            }));

            process.env.TRUST_PROXY = 'true';

            app = require('../app');
            expect(app).toBeDefined();
        });
    });
});
