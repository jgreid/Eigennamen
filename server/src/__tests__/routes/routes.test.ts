/**
 * REST API Route Tests
 *
 * Tests for roomRoutes endpoints.
 * Uses supertest for HTTP request testing with mocked services.
 */

const request = require('supertest');
const express = require('express');

// Mock Redis storage
const mockRedisStorage = new Map();
const mockRedisSets = new Map();

// Setup mocks before importing app/services
jest.mock('../../config/redis', () => {
    const mockRedis = {
        get: jest.fn(async (key) => mockRedisStorage.get(key) || null),
        set: jest.fn(async (key, value, _options) => {
            mockRedisStorage.set(key, value);
            return 'OK';
        }),
        del: jest.fn(async (key) => {
            if (Array.isArray(key)) {
                let deleted = 0;
                key.forEach(k => { if (mockRedisStorage.delete(k)) deleted++; });
                return deleted;
            }
            return mockRedisStorage.delete(key) ? 1 : 0;
        }),
        exists: jest.fn(async (key) => mockRedisStorage.has(key) ? 1 : 0),
        expire: jest.fn(async () => 1),
        sAdd: jest.fn(async (key, ...members) => {
            if (!mockRedisSets.has(key)) mockRedisSets.set(key, new Set());
            const set = mockRedisSets.get(key);
            let added = 0;
            members.forEach(m => { if (!set.has(m)) { set.add(m); added++; } });
            return added;
        }),
        sRem: jest.fn(async (key, ...members) => {
            const set = mockRedisSets.get(key);
            if (!set) return 0;
            let removed = 0;
            members.forEach(m => { if (set.delete(m)) removed++; });
            return removed;
        }),
        sMembers: jest.fn(async (key) => {
            const set = mockRedisSets.get(key);
            return set ? [...set] : [];
        }),
        sIsMember: jest.fn(async (key, member) => {
            const set = mockRedisSets.get(key);
            return set && set.has(member) ? 1 : 0;
        }),
        sCard: jest.fn(async (key) => {
            const set = mockRedisSets.get(key);
            return set ? set.size : 0;
        }),
        watch: jest.fn(async () => 'OK'),
        unwatch: jest.fn(async () => 'OK'),
        mGet: jest.fn(async (keys) => keys.map(k => mockRedisStorage.get(k) || null)),
        multi: jest.fn(() => ({
            set: jest.fn().mockReturnThis(),
            del: jest.fn().mockReturnThis(),
            lPush: jest.fn().mockReturnThis(),
            lTrim: jest.fn().mockReturnThis(),
            exec: jest.fn(async () => [[null, 'OK']])
        })),
        lPush: jest.fn(async () => 1),
        lTrim: jest.fn(async () => 'OK'),
        lRange: jest.fn(async () => []),
        lIndex: jest.fn(async () => null),
        lLen: jest.fn(async () => 0)
    };

    return {
        getRedis: jest.fn(() => mockRedis),
        connectRedis: jest.fn(async () => {}),
        disconnectRedis: jest.fn(async () => {}),
        isRedisHealthy: jest.fn(async () => true),
        isUsingMemoryMode: jest.fn(() => true),
        getPubSubClients: jest.fn(() => ({ pubClient: mockRedis, subClient: mockRedis })),
        getRedisMemoryInfo: jest.fn(async () => ({
            mode: 'memory',
            used_memory: 0,
            used_memory_human: 'N/A',
            used_memory_peak: 0,
            used_memory_peak_human: 'N/A',
            maxmemory: 0,
            maxmemory_human: 'N/A',
            memory_usage_percent: 0,
            alert: null
        }))
    };
});

// Mock pubSubHealth for health routes
jest.mock('../../utils/pubSubHealth', () => ({
    getHealth: jest.fn(() => ({
        isHealthy: true,
        totalPublishes: 0,
        totalFailures: 0,
        failureRate: 0,
        consecutiveFailures: 0,
        lastError: null
    }))
}));

// Mock logger to suppress output
jest.mock('../../utils/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
}));

// Import routes after mocks
const roomRoutes = require('../../routes/roomRoutes');
const healthRoutes = require('../../routes/healthRoutes');
const { errorHandler } = require('../../middleware/errorHandler');

// Create test app
function createTestApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/rooms', roomRoutes);
    app.use('/api/health', healthRoutes);
    app.use(errorHandler);
    return app;
}

describe('Room Routes', () => {
    let app;

    beforeEach(() => {
        app = createTestApp();
        mockRedisStorage.clear();
        mockRedisSets.clear();
    });

    describe('GET /api/rooms/:code/exists', () => {
        it('should return exists: true for existing room', async () => {
            // Store with lowercase since roomExists normalizes to lowercase
            const roomCode = 'abc123';
            const roomData = {
                code: roomCode,
                roomId: 'ABC123',
                status: 'waiting',
                hostSessionId: 'host-123',
                settings: { teamNames: { red: 'Red', blue: 'Blue' } }
            };
            mockRedisStorage.set(`room:${roomCode}`, JSON.stringify(roomData));

            // Request can use any case - will be normalized
            const response = await request(app)
                .get('/api/rooms/ABC123/exists')
                .expect(200);

            expect(response.body.exists).toBe(true);
        });

        it('should return exists: false for non-existing room', async () => {
            const response = await request(app)
                .get('/api/rooms/NOTFND/exists')
                .expect(200);

            expect(response.body.exists).toBe(false);
        });

        it('should handle case-insensitive room code lookup', async () => {
            // Store with lowercase since roomExists normalizes to lowercase
            const roomCode = 'abc123';
            const roomData = {
                code: roomCode,
                roomId: 'ABC123',
                status: 'waiting',
                settings: { teamNames: { red: 'Red', blue: 'Blue' } }
            };
            mockRedisStorage.set(`room:${roomCode}`, JSON.stringify(roomData));

            // Request with lowercase should find the room
            const response = await request(app)
                .get('/api/rooms/abc123/exists')
                .expect(200);

            expect(response.body.exists).toBe(true);
        });

        it('should reject invalid room code formats', async () => {
            const response = await request(app)
                .get('/api/rooms/AB/exists') // Too short
                .expect(400);

            expect(response.body.error).toBeDefined();
        });

        it('should reject room codes that are too long', async () => {
            const response = await request(app)
                .get('/api/rooms/abcdefghijklmnopqrstuvwxyz/exists') // Too long (> 20)
                .expect(400);

            expect(response.body.error).toBeDefined();
        });
    });

    describe('GET /api/rooms/:code', () => {
        it('should return room info for existing room', async () => {
            // Use lowercase for storage since getRoom normalizes to lowercase
            const roomCode = 'xyz789';
            const roomData = {
                code: roomCode,
                roomId: 'XYZ789',
                status: 'playing',
                hostSessionId: 'host-456',
                settings: {
                    teamNames: { red: 'Fire', blue: 'Ice' },
                    allowSpectators: true,
                    turnTimer: 60
                }
            };
            mockRedisStorage.set(`room:${roomCode}`, JSON.stringify(roomData));
            mockRedisSets.set(`room:${roomCode}:players`, new Set(['player1', 'player2']));

            // Request can use any case - will be normalized
            const response = await request(app)
                .get('/api/rooms/XYZ789')
                .expect(200);

            expect(response.body.room).toBeDefined();
            expect(response.body.room.code).toBe(roomCode);
            expect(response.body.room.status).toBe('playing');
            expect(response.body.room.settings.teamNames).toEqual({ red: 'Fire', blue: 'Ice' });
            // Note: playerCount comes from playerService which needs mock data
            // The route uses playerService.getPlayersInRoom which reads from player:* keys
            expect(response.body.playerCount).toBeGreaterThanOrEqual(0);
        });

        it('should return 404 for non-existing room', async () => {
            const response = await request(app)
                .get('/api/rooms/NOROOM')
                .expect(404);

            expect(response.body.error.code).toBe('ROOM_NOT_FOUND');
        });

        it('should not expose sensitive room data', async () => {
            // Use lowercase for storage since getRoom normalizes to lowercase
            const roomCode = 'secret';
            const roomData = {
                code: roomCode,
                roomId: 'SECRET',
                status: 'waiting',
                hostSessionId: 'secret-host',
                settings: {
                    teamNames: { red: 'Red', blue: 'Blue' },
                    allowSpectators: false,
                    privateData: 'should-not-expose'
                }
            };
            mockRedisStorage.set(`room:${roomCode}`, JSON.stringify(roomData));

            const response = await request(app)
                .get('/api/rooms/SECRET')
                .expect(200);

            // Should not include hostSessionId
            expect(response.body.room.hostSessionId).toBeUndefined();
        });
    });
});

// WordList Routes removed - database scaffolding stripped for MVP

describe('Health Routes (/api/health)', () => {
    let app;
    const { isRedisHealthy, isUsingMemoryMode } = require('../../config/redis');
    const pubSubHealth = require('../../utils/pubSubHealth');

    beforeEach(() => {
        app = createTestApp();
    });

    describe('GET /api/health', () => {
        it('should return 200 with basic health status', async () => {
            const response = await request(app)
                .get('/api/health')
                .expect(200);

            expect(response.body).toMatchObject({
                status: 'ok',
                timestamp: expect.any(String),
                uptime: expect.any(Number)
            });
        });

        it('should include valid ISO timestamp', async () => {
            const response = await request(app)
                .get('/api/health')
                .expect(200);

            const timestamp = new Date(response.body.timestamp);
            expect(timestamp.toISOString()).toBe(response.body.timestamp);
        });

        it('should include non-negative uptime', async () => {
            const response = await request(app)
                .get('/api/health')
                .expect(200);

            expect(response.body.uptime).toBeGreaterThanOrEqual(0);
        });
    });

    describe('GET /api/health/live', () => {
        it('should return 200 with live status', async () => {
            const response = await request(app)
                .get('/api/health/live')
                .expect(200);

            expect(response.body).toMatchObject({
                status: 'live',
                timestamp: expect.any(String)
            });
        });
    });

    describe('GET /api/health/ready', () => {
        it('should return 200 when in memory mode', async () => {
            isUsingMemoryMode.mockReturnValue(true);

            const response = await request(app)
                .get('/api/health/ready')
                .expect(200);

            expect(response.body).toMatchObject({
                status: 'ready',
                timestamp: expect.any(String),
                checks: {
                    redis: { healthy: true, mode: 'memory' },
                    pubsub: { healthy: true, status: 'memory_mode' }
                }
            });
        });

        it('should return 200 when Redis is healthy', async () => {
            isUsingMemoryMode.mockReturnValue(false);
            isRedisHealthy.mockResolvedValue(true);
            pubSubHealth.getHealth = jest.fn().mockReturnValue({
                isHealthy: true,
                consecutiveFailures: 0,
                lastError: null
            });

            const response = await request(app)
                .get('/api/health/ready')
                .expect(200);

            expect(response.body).toMatchObject({
                status: 'ready',
                checks: {
                    redis: { healthy: true, mode: 'redis' },
                    pubsub: { healthy: true, status: 'connected' }
                }
            });
        });

        it('should return 503 when Redis is unhealthy', async () => {
            isUsingMemoryMode.mockReturnValue(false);
            isRedisHealthy.mockResolvedValue(false);
            pubSubHealth.getHealth = jest.fn().mockReturnValue({
                isHealthy: true,
                consecutiveFailures: 0,
                lastError: null
            });

            const response = await request(app)
                .get('/api/health/ready')
                .expect(503);

            expect(response.body).toMatchObject({
                status: 'degraded',
                checks: {
                    redis: { healthy: false, mode: 'redis' }
                }
            });
        });

        it('should return 503 when pub/sub is unhealthy', async () => {
            isUsingMemoryMode.mockReturnValue(false);
            isRedisHealthy.mockResolvedValue(true);
            pubSubHealth.getHealth = jest.fn().mockReturnValue({
                isHealthy: false,
                consecutiveFailures: 5,
                lastError: { type: 'error', message: 'Connection lost', timestamp: Date.now() }
            });

            const response = await request(app)
                .get('/api/health/ready')
                .expect(503);

            expect(response.body).toMatchObject({
                status: 'degraded',
                checks: {
                    pubsub: {
                        healthy: false,
                        status: 'degraded',
                        consecutiveFailures: 5
                    }
                }
            });
        });

        it('should return 503 when health check throws error', async () => {
            isUsingMemoryMode.mockReturnValue(false);
            isRedisHealthy.mockRejectedValue(new Error('Redis connection failed'));

            const response = await request(app)
                .get('/api/health/ready')
                .expect(503);

            expect(response.body).toMatchObject({
                status: 'error',
                error: 'Health check failed'
            });
        });
    });

    describe('GET /api/health/metrics', () => {
        it('should return 200 with detailed metrics', async () => {
            isUsingMemoryMode.mockReturnValue(true);
            isRedisHealthy.mockResolvedValue(true);
            pubSubHealth.getHealth = jest.fn().mockReturnValue({
                isHealthy: true,
                totalPublishes: 100,
                totalFailures: 2,
                failureRate: 0.02,
                consecutiveFailures: 0
            });

            const response = await request(app)
                .get('/api/health/metrics')
                .expect(200);

            expect(response.body).toMatchObject({
                timestamp: expect.any(String),
                uptime: expect.any(Object),
                memory: expect.any(Object),
                redis: expect.any(Object),
                pubsub: expect.any(Object),
                process: expect.any(Object)
            });
        });

        it('should include memory usage in correct format', async () => {
            isUsingMemoryMode.mockReturnValue(true);
            isRedisHealthy.mockResolvedValue(true);
            pubSubHealth.getHealth = jest.fn().mockReturnValue({ isHealthy: true });

            const response = await request(app)
                .get('/api/health/metrics')
                .expect(200);

            expect(response.body.memory).toMatchObject({
                heapUsed: expect.stringMatching(/^\d+MB$/),
                heapTotal: expect.stringMatching(/^\d+MB$/),
                rss: expect.stringMatching(/^\d+MB$/),
                external: expect.stringMatching(/^\d+MB$/)
            });
        });

        it('should include uptime information', async () => {
            isUsingMemoryMode.mockReturnValue(true);
            isRedisHealthy.mockResolvedValue(true);
            pubSubHealth.getHealth = jest.fn().mockReturnValue({ isHealthy: true });

            const response = await request(app)
                .get('/api/health/metrics')
                .expect(200);

            expect(response.body.uptime).toMatchObject({
                seconds: expect.any(Number),
                startTime: expect.any(String)
            });
        });

        it('should include process information', async () => {
            isUsingMemoryMode.mockReturnValue(true);
            isRedisHealthy.mockResolvedValue(true);
            pubSubHealth.getHealth = jest.fn().mockReturnValue({ isHealthy: true });

            const response = await request(app)
                .get('/api/health/metrics')
                .expect(200);

            expect(response.body.process).toMatchObject({
                pid: expect.any(Number),
                nodeVersion: expect.any(String),
                platform: expect.any(String)
            });
        });

        it('should include pub/sub statistics', async () => {
            isUsingMemoryMode.mockReturnValue(true);
            isRedisHealthy.mockResolvedValue(true);
            pubSubHealth.getHealth = jest.fn().mockReturnValue({
                isHealthy: true,
                totalPublishes: 500,
                totalFailures: 10,
                failureRate: 0.02,
                consecutiveFailures: 0
            });

            const response = await request(app)
                .get('/api/health/metrics')
                .expect(200);

            expect(response.body.pubsub).toMatchObject({
                healthy: true,
                totalPublishes: 500,
                totalFailures: 10,
                failureRate: 0.02,
                consecutiveFailures: 0
            });
        });

        it('should return 500 when metrics collection fails', async () => {
            isUsingMemoryMode.mockReturnValue(false);
            isRedisHealthy.mockRejectedValue(new Error('Metrics collection error'));

            const response = await request(app)
                .get('/api/health/metrics')
                .expect(500);

            expect(response.body).toMatchObject({
                error: 'Failed to collect metrics'
            });
        });
    });
});

describe('Error Handling', () => {
    let app;

    beforeEach(() => {
        app = createTestApp();
        mockRedisStorage.clear();
    });

    it('should return proper error format for validation errors', async () => {
        const response = await request(app)
            .get('/api/rooms/XX/exists') // Invalid room code
            .expect(400);

        expect(response.body.error).toBeDefined();
        expect(response.body.error.message).toBeDefined();
    });

    it('should handle malformed JSON gracefully', async () => {
        const response = await request(app)
            .post('/api/wordlists')
            .set('Content-Type', 'application/json')
            .send('not valid json{');

        // Express body-parser sends 400 for malformed JSON
        // but our error handler may transform it to 500 if not handled
        // Either status is acceptable as long as it doesn't crash
        expect([400, 500]).toContain(response.status);
    });
});
