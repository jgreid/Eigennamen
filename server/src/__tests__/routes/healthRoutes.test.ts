/**
 * Health Routes Unit Tests
 *
 * Dedicated tests for server/src/routes/healthRoutes.ts
 * Covers: Redis timeout, memory alert thresholds, production vs dev info filtering,
 * PubSub health check failures, readiness checks, metrics, and Prometheus endpoint.
 */

const request = require('supertest');
const express = require('express');

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockIsRedisHealthy = jest.fn().mockResolvedValue(true);
const mockIsUsingMemoryMode = jest.fn().mockReturnValue(false);
const mockGetRedisMemoryInfo = jest.fn().mockResolvedValue({
    mode: 'redis',
    used_memory: 1024000,
    used_memory_human: '1MB',
    used_memory_peak: 2048000,
    used_memory_peak_human: '2MB',
    maxmemory: 10485760,
    maxmemory_human: '10MB',
    maxmemory_policy: 'noeviction',
    memory_usage_percent: 10,
    fragmentation_ratio: 1.2,
    alert: null,
});

jest.mock('../../config/redis', () => ({
    getRedis: jest.fn(() => ({})),
    isRedisHealthy: (...args) => mockIsRedisHealthy(...args),
    isUsingMemoryMode: (...args) => mockIsUsingMemoryMode(...args),
    getRedisMemoryInfo: (...args) => mockGetRedisMemoryInfo(...args),
    getPubSubClients: jest.fn(() => ({ pubClient: {}, subClient: {} })),
    connectRedis: jest.fn(),
    disconnectRedis: jest.fn(),
}));

const mockGetHealth = jest.fn().mockReturnValue({
    isHealthy: true,
    totalPublishes: 100,
    totalFailures: 2,
    failureRate: '2.0%',
    consecutiveFailures: 0,
    lastError: null,
});

jest.mock('../../utils/pubSubHealth', () => ({
    getHealth: (...args) => mockGetHealth(...args),
}));

jest.mock('../../utils/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
}));

const mockGetPrometheusMetrics = jest.fn().mockReturnValue('# TYPE games_started counter\ngames_started 42\n');
const mockUpdateSystemMetrics = jest.fn();

const mockGetAllMetrics = jest.fn().mockReturnValue({
    timestamp: Date.now(),
    instanceId: 'test',
    counters: { broadcasts_sent_total: { value: 10, labels: {} } },
    gauges: { active_rooms: { value: 3, labels: {} } },
    histograms: {},
});

jest.mock('../../utils/metrics', () => ({
    getPrometheusMetrics: (...args) => mockGetPrometheusMetrics(...args),
    updateSystemMetrics: (...args) => mockUpdateSystemMetrics(...args),
    getAllMetrics: (...args) => mockGetAllMetrics(...args),
}));

// Import after mocks are set up
const healthRoutes = require('../../routes/healthRoutes');
const logger = require('../../utils/logger');

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function createTestApp() {
    const app = express();
    app.use(express.json());
    const router = healthRoutes.default || healthRoutes;
    app.use('/health', router);
    return app;
}

/** Build a RedisMemoryInfo object with sensible defaults, overriding supplied fields. */
function makeRedisMemory(overrides = {}) {
    return {
        mode: 'redis',
        used_memory: 1024000,
        used_memory_human: '1MB',
        used_memory_peak: 2048000,
        used_memory_peak_human: '2MB',
        maxmemory: 10485760,
        maxmemory_human: '10MB',
        maxmemory_policy: 'noeviction',
        memory_usage_percent: 10,
        fragmentation_ratio: 1.2,
        alert: null,
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Health Routes', () => {
    let app: ReturnType<typeof createTestApp>;
    const originalNodeEnv = process.env.NODE_ENV;

    beforeEach(() => {
        jest.clearAllMocks();
        process.env.NODE_ENV = 'test';
        app = createTestApp();

        // Reset defaults
        mockIsRedisHealthy.mockResolvedValue(true);
        mockIsUsingMemoryMode.mockReturnValue(false);
        mockGetRedisMemoryInfo.mockResolvedValue(makeRedisMemory());
        mockGetHealth.mockReturnValue({
            isHealthy: true,
            totalPublishes: 100,
            totalFailures: 2,
            failureRate: '2.0%',
            consecutiveFailures: 0,
            lastError: null,
        });
    });

    afterEach(() => {
        process.env.NODE_ENV = originalNodeEnv;
    });

    // -----------------------------------------------------------------------
    // GET /health  (basic liveness)
    // -----------------------------------------------------------------------
    describe('GET /health', () => {
        it('should return 200 with status ok', async () => {
            const res = await request(app).get('/health').expect(200);
            expect(res.body).toMatchObject({
                status: 'ok',
                timestamp: expect.any(String),
                uptime: expect.any(Number),
            });
        });

        it('should return a valid ISO timestamp', async () => {
            const res = await request(app).get('/health').expect(200);
            const parsed = new Date(res.body.timestamp);
            expect(parsed.toISOString()).toBe(res.body.timestamp);
        });

        it('should return non-negative uptime', async () => {
            const res = await request(app).get('/health').expect(200);
            expect(res.body.uptime).toBeGreaterThanOrEqual(0);
        });
    });

    // -----------------------------------------------------------------------
    // GET /health/live  (Kubernetes liveness probe)
    // -----------------------------------------------------------------------
    describe('GET /health/live', () => {
        it('should return 200 with status live', async () => {
            const res = await request(app).get('/health/live').expect(200);
            expect(res.body).toMatchObject({
                status: 'live',
                timestamp: expect.any(String),
            });
        });
    });

    // -----------------------------------------------------------------------
    // GET /health/ready  (readiness check)
    // -----------------------------------------------------------------------
    describe('GET /health/ready', () => {
        // --- Memory mode ---
        it('should return 200 ready when in memory mode', async () => {
            mockIsUsingMemoryMode.mockReturnValue(true);

            const res = await request(app).get('/health/ready').expect(200);

            expect(res.body).toMatchObject({
                status: 'ready',
                checks: {
                    redis: { healthy: true, mode: 'memory' },
                    pubsub: { healthy: true, status: 'memory_mode' },
                },
            });
        });

        // --- Redis healthy, PubSub healthy ---
        it('should return 200 when Redis and PubSub are both healthy', async () => {
            mockIsUsingMemoryMode.mockReturnValue(false);
            mockIsRedisHealthy.mockResolvedValue(true);
            mockGetHealth.mockReturnValue({
                isHealthy: true,
                consecutiveFailures: 0,
                lastError: null,
            });

            const res = await request(app).get('/health/ready').expect(200);

            expect(res.body.status).toBe('ready');
            expect(res.body.checks.redis).toEqual({ healthy: true, mode: 'redis' });
            expect(res.body.checks.pubsub).toMatchObject({
                healthy: true,
                status: 'connected',
                consecutiveFailures: 0,
            });
        });

        // --- Redis unhealthy ---
        it('should return 503 degraded when Redis is unhealthy', async () => {
            mockIsUsingMemoryMode.mockReturnValue(false);
            mockIsRedisHealthy.mockResolvedValue(false);
            mockGetHealth.mockReturnValue({ isHealthy: true, consecutiveFailures: 0 });

            const res = await request(app).get('/health/ready').expect(503);

            expect(res.body.status).toBe('degraded');
            expect(res.body.checks.redis).toEqual({ healthy: false, mode: 'redis' });
        });

        // --- PubSub unhealthy ---
        it('should return 503 degraded when PubSub is unhealthy', async () => {
            mockIsUsingMemoryMode.mockReturnValue(false);
            mockIsRedisHealthy.mockResolvedValue(true);
            mockGetHealth.mockReturnValue({
                isHealthy: false,
                consecutiveFailures: 5,
                lastError: { type: 'error', message: 'Connection lost', timestamp: Date.now() },
            });

            const res = await request(app).get('/health/ready').expect(503);

            expect(res.body.status).toBe('degraded');
            expect(res.body.checks.pubsub).toMatchObject({
                healthy: false,
                status: 'degraded',
                consecutiveFailures: 5,
            });
        });

        // --- Both Redis AND PubSub unhealthy ---
        it('should return 503 when both Redis and PubSub are unhealthy', async () => {
            mockIsUsingMemoryMode.mockReturnValue(false);
            mockIsRedisHealthy.mockResolvedValue(false);
            mockGetHealth.mockReturnValue({
                isHealthy: false,
                consecutiveFailures: 3,
            });

            const res = await request(app).get('/health/ready').expect(503);

            expect(res.body.status).toBe('degraded');
            expect(res.body.checks.redis.healthy).toBe(false);
            expect(res.body.checks.pubsub.healthy).toBe(false);
        });

        // --- Redis health check timeout (3s) ---
        it('should return 503 error when Redis health check times out', async () => {
            mockIsUsingMemoryMode.mockReturnValue(false);
            // Simulate a promise that never resolves — withTimeout will reject after 3s.
            // We speed this up by making isRedisHealthy reject with a TimeoutError immediately.
            const { TimeoutError } = require('../../utils/timeout');
            mockIsRedisHealthy.mockRejectedValue(
                new TimeoutError('Redis health check timed out after 3000ms', 'Redis health check')
            );

            const res = await request(app).get('/health/ready').expect(503);

            expect(res.body.status).toBe('error');
            expect(res.body.error).toBe('Health check failed');
            expect(logger.error).toHaveBeenCalled();
        });

        // --- Redis health check throws generic error ---
        it('should return 503 error when Redis health check throws', async () => {
            mockIsUsingMemoryMode.mockReturnValue(false);
            mockIsRedisHealthy.mockRejectedValue(new Error('ECONNREFUSED'));

            const res = await request(app).get('/health/ready').expect(503);

            expect(res.body).toMatchObject({
                status: 'error',
                error: 'Health check failed',
            });
            // Should still include the partial checks object
            expect(res.body.checks).toBeDefined();
            expect(res.body.checks.redis.healthy).toBe(false);
        });

        // --- Response always contains a valid timestamp ---
        it('should always include a valid ISO timestamp in the response', async () => {
            mockIsUsingMemoryMode.mockReturnValue(true);
            const res = await request(app).get('/health/ready').expect(200);
            const parsed = new Date(res.body.timestamp);
            expect(parsed.toISOString()).toBe(res.body.timestamp);
        });
    });

    // -----------------------------------------------------------------------
    // GET /health/metrics  (detailed metrics)
    // -----------------------------------------------------------------------
    describe('GET /health/metrics', () => {
        it('should return 200 with complete metrics structure', async () => {
            const res = await request(app).get('/health/metrics').expect(200);

            expect(res.body).toMatchObject({
                timestamp: expect.any(String),
                uptime: {
                    seconds: expect.any(Number),
                    startTime: expect.any(String),
                },
                memory: {
                    heapUsed: expect.stringMatching(/^\d+MB$/),
                    heapTotal: expect.stringMatching(/^\d+MB$/),
                    rss: expect.stringMatching(/^\d+MB$/),
                    external: expect.stringMatching(/^\d+MB$/),
                },
                redis: {
                    mode: expect.any(String),
                    healthy: expect.any(Boolean),
                },
                pubsub: {
                    healthy: expect.any(Boolean),
                },
            });
        });

        // --- Production vs dev: process info ---
        it('should include process details in non-production', async () => {
            process.env.NODE_ENV = 'development';
            app = createTestApp();

            const res = await request(app).get('/health/metrics').expect(200);

            expect(res.body.process).toMatchObject({
                pid: expect.any(Number),
                nodeVersion: expect.any(String),
                platform: expect.any(String),
            });
        });

        it('should omit process details in production', async () => {
            process.env.NODE_ENV = 'production';
            app = createTestApp();

            const res = await request(app).get('/health/metrics').expect(200);

            expect(res.body.process).toBeUndefined();
        });

        // --- Production vs dev: Redis memory details ---
        it('should include Redis memory details in non-production', async () => {
            process.env.NODE_ENV = 'development';
            app = createTestApp();

            const res = await request(app).get('/health/metrics').expect(200);

            expect(res.body.redis.memory).toBeDefined();
            expect(res.body.redis.memory).toMatchObject({
                used_memory_human: '1MB',
            });
        });

        it('should omit Redis memory details in production', async () => {
            process.env.NODE_ENV = 'production';
            app = createTestApp();

            const res = await request(app).get('/health/metrics').expect(200);

            expect(res.body.redis.memory).toBeUndefined();
        });

        // --- Production vs dev: PubSub counters ---
        it('should include PubSub counters in non-production', async () => {
            process.env.NODE_ENV = 'test';
            app = createTestApp();

            const res = await request(app).get('/health/metrics').expect(200);

            expect(res.body.pubsub).toMatchObject({
                healthy: true,
                totalPublishes: 100,
                totalFailures: 2,
                failureRate: '2.0%',
                consecutiveFailures: 0,
            });
        });

        it('should omit PubSub counters in production', async () => {
            process.env.NODE_ENV = 'production';
            app = createTestApp();

            const res = await request(app).get('/health/metrics').expect(200);

            expect(res.body.pubsub).toEqual({ healthy: true });
            expect(res.body.pubsub.totalPublishes).toBeUndefined();
            expect(res.body.pubsub.totalFailures).toBeUndefined();
            expect(res.body.pubsub.failureRate).toBeUndefined();
            expect(res.body.pubsub.consecutiveFailures).toBeUndefined();
        });

        // --- Memory alert thresholds ---
        it('should include warning alert when Redis memory at 75%+', async () => {
            mockGetRedisMemoryInfo.mockResolvedValue(
                makeRedisMemory({
                    memory_usage_percent: 78,
                    alert: 'warning',
                    used_memory_human: '7.8MB',
                    maxmemory_human: '10MB',
                })
            );

            const res = await request(app).get('/health/metrics').expect(200);

            expect(res.body.alerts).toBeDefined();
            expect(res.body.alerts).toHaveLength(1);
            expect(res.body.alerts[0]).toMatchObject({
                type: 'redis_memory',
                level: 'warning',
                message: 'Redis memory usage at 78%',
            });
        });

        it('should include critical alert when Redis memory at 90%+', async () => {
            mockGetRedisMemoryInfo.mockResolvedValue(
                makeRedisMemory({
                    memory_usage_percent: 95,
                    alert: 'critical',
                    used_memory_human: '9.5MB',
                    maxmemory_human: '10MB',
                })
            );

            const res = await request(app).get('/health/metrics').expect(200);

            expect(res.body.alerts).toBeDefined();
            expect(res.body.alerts).toHaveLength(1);
            expect(res.body.alerts[0]).toMatchObject({
                type: 'redis_memory',
                level: 'critical',
                message: 'Redis memory usage at 95%',
            });
        });

        it('should not include alerts when Redis memory is under 75%', async () => {
            mockGetRedisMemoryInfo.mockResolvedValue(
                makeRedisMemory({
                    memory_usage_percent: 50,
                    alert: null,
                })
            );

            const res = await request(app).get('/health/metrics').expect(200);

            expect(res.body.alerts).toBeUndefined();
        });

        // --- Memory alert detail filtering in production ---
        it('should include alert details in non-production', async () => {
            process.env.NODE_ENV = 'development';
            app = createTestApp();

            mockGetRedisMemoryInfo.mockResolvedValue(
                makeRedisMemory({
                    memory_usage_percent: 80,
                    alert: 'warning',
                    used_memory_human: '8MB',
                    maxmemory_human: '10MB',
                })
            );

            const res = await request(app).get('/health/metrics').expect(200);

            expect(res.body.alerts[0].details).toEqual({
                used: '8MB',
                max: '10MB',
            });
        });

        it('should omit alert details in production', async () => {
            process.env.NODE_ENV = 'production';
            app = createTestApp();

            mockGetRedisMemoryInfo.mockResolvedValue(
                makeRedisMemory({
                    memory_usage_percent: 92,
                    alert: 'critical',
                    used_memory_human: '9.2MB',
                    maxmemory_human: '10MB',
                })
            );

            const res = await request(app).get('/health/metrics').expect(200);

            expect(res.body.alerts[0]).toMatchObject({
                type: 'redis_memory',
                level: 'critical',
            });
            expect(res.body.alerts[0].details).toBeUndefined();
        });

        // --- Redis mode reported correctly ---
        it('should report redis mode when using Redis', async () => {
            mockIsUsingMemoryMode.mockReturnValue(false);

            const res = await request(app).get('/health/metrics').expect(200);

            expect(res.body.redis.mode).toBe('redis');
        });

        it('should report memory mode when using memory mode', async () => {
            mockIsUsingMemoryMode.mockReturnValue(true);

            const res = await request(app).get('/health/metrics').expect(200);

            expect(res.body.redis.mode).toBe('memory');
        });

        // --- Redis health check timeout in metrics ---
        it('should return 500 when Redis memory check times out', async () => {
            const { TimeoutError } = require('../../utils/timeout');
            mockGetRedisMemoryInfo.mockRejectedValue(
                new TimeoutError('Redis memory check timed out after 3000ms', 'Redis memory check')
            );

            const res = await request(app).get('/health/metrics').expect(500);

            expect(res.body).toEqual({ error: 'Failed to collect metrics' });
            expect(logger.error).toHaveBeenCalled();
        });

        // --- isRedisHealthy rejects in metrics ---
        it('should return 500 when isRedisHealthy rejects in metrics', async () => {
            mockIsRedisHealthy.mockRejectedValue(new Error('Redis unavailable'));

            const res = await request(app).get('/health/metrics').expect(500);

            expect(res.body).toEqual({ error: 'Failed to collect metrics' });
        });

        // --- getRedisMemoryInfo rejects with generic error ---
        it('should return 500 when getRedisMemoryInfo throws a generic error', async () => {
            mockGetRedisMemoryInfo.mockRejectedValue(new Error('INFO command failed'));

            const res = await request(app).get('/health/metrics').expect(500);

            expect(res.body).toEqual({ error: 'Failed to collect metrics' });
            expect(logger.error).toHaveBeenCalledWith('Metrics collection failed:', expect.any(Error));
        });
    });

    // -----------------------------------------------------------------------
    // GET /health/metrics/prometheus
    // -----------------------------------------------------------------------
    describe('GET /health/metrics/prometheus', () => {
        it('should return Prometheus text format with correct content type', async () => {
            const res = await request(app).get('/health/metrics/prometheus').expect(200);

            expect(res.headers['content-type']).toMatch(/text\/plain/);
            expect(res.headers['content-type']).toContain('version=0.0.4');
            expect(res.text).toContain('# TYPE games_started counter');
        });

        it('should call updateSystemMetrics before exporting', async () => {
            await request(app).get('/health/metrics/prometheus').expect(200);

            expect(mockUpdateSystemMetrics).toHaveBeenCalledTimes(1);
            // updateSystemMetrics is called before getPrometheusMetrics
            const updateOrder = mockUpdateSystemMetrics.mock.invocationCallOrder[0];
            const exportOrder = mockGetPrometheusMetrics.mock.invocationCallOrder[0];
            expect(updateOrder).toBeLessThan(exportOrder!);
        });

        it('should return 500 with error comment when getPrometheusMetrics throws', async () => {
            mockGetPrometheusMetrics.mockImplementation(() => {
                throw new Error('Metrics registry corrupted');
            });

            const res = await request(app).get('/health/metrics/prometheus').expect(500);

            expect(res.text).toBe('# Error exporting metrics\n');
            expect(logger.error).toHaveBeenCalledWith('Prometheus metrics export failed:', expect.any(Error));
        });

        it('should return 500 when updateSystemMetrics throws', async () => {
            mockUpdateSystemMetrics.mockImplementation(() => {
                throw new Error('memoryUsage() failed');
            });

            const res = await request(app).get('/health/metrics/prometheus').expect(500);

            expect(res.text).toBe('# Error exporting metrics\n');
        });
    });

    // -----------------------------------------------------------------------
    // Edge cases: PubSub failures propagated through readiness
    // -----------------------------------------------------------------------
    describe('PubSub health check integration', () => {
        it('should report PubSub consecutiveFailures in readiness', async () => {
            mockIsUsingMemoryMode.mockReturnValue(false);
            mockIsRedisHealthy.mockResolvedValue(true);
            mockGetHealth.mockReturnValue({
                isHealthy: false,
                consecutiveFailures: 10,
                lastError: new Error('ECONNRESET'),
            });

            const res = await request(app).get('/health/ready').expect(503);

            expect(res.body.checks.pubsub.consecutiveFailures).toBe(10);
            expect(res.body.checks.pubsub.status).toBe('degraded');
        });

        it('should skip PubSub check when in memory mode', async () => {
            mockIsUsingMemoryMode.mockReturnValue(true);

            const res = await request(app).get('/health/ready').expect(200);

            expect(res.body.checks.pubsub.status).toBe('memory_mode');
            // getHealth should NOT be called in memory mode
            expect(mockGetHealth).not.toHaveBeenCalled();
        });

        it('should report PubSub health status in metrics endpoint', async () => {
            mockGetHealth.mockReturnValue({
                isHealthy: false,
                totalPublishes: 500,
                totalFailures: 50,
                failureRate: '9.1%',
                consecutiveFailures: 4,
            });

            const res = await request(app).get('/health/metrics').expect(200);

            expect(res.body.pubsub.healthy).toBe(false);
        });
    });
});
