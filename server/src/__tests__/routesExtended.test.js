/**
 * Extended Routes Tests
 * Tests additional edge cases for routes to improve coverage
 */

const request = require('supertest');
const express = require('express');

// Mock Redis storage
const mockRedisStorage = new Map();
const mockRedisSets = new Map();

// Setup mocks before importing
jest.mock('../config/redis', () => {
    const mockRedis = {
        get: jest.fn(async (key) => mockRedisStorage.get(key) || null),
        set: jest.fn(async (key, value) => {
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
        sMembers: jest.fn(async (key) => {
            const set = mockRedisSets.get(key);
            return set ? [...set] : [];
        }),
        sCard: jest.fn(async (key) => {
            const set = mockRedisSets.get(key);
            return set ? set.size : 0;
        }),
        mGet: jest.fn(async (keys) => keys.map(k => mockRedisStorage.get(k) || null)),
        eval: jest.fn(async () => 1)
    };

    return {
        getRedis: jest.fn(() => mockRedis),
        connectRedis: jest.fn(async () => {}),
        disconnectRedis: jest.fn(async () => {}),
        isRedisHealthy: jest.fn(async () => true),
        isUsingMemoryMode: jest.fn(() => true),
        getPubSubClients: jest.fn(() => ({ pubClient: mockRedis, subClient: mockRedis }))
    };
});

jest.mock('../config/database', () => ({
    getDatabase: jest.fn(() => null),
    connectDatabase: jest.fn(async () => {}),
    disconnectDatabase: jest.fn(async () => {}),
    isDatabaseEnabled: jest.fn(() => false)
}));

jest.mock('../utils/pubSubHealth', () => ({
    getHealth: jest.fn(() => ({
        isHealthy: true,
        totalPublishes: 0,
        totalFailures: 0,
        failureRate: 0,
        consecutiveFailures: 0,
        lastError: null
    }))
}));

jest.mock('../utils/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
}));

// Mock player service
jest.mock('../services/playerService', () => ({
    getPlayersInRoom: jest.fn(async () => []),
    getPlayer: jest.fn(async () => null)
}));

// Mock room service - keep createRoom for routes that need it
jest.mock('../services/roomService', () => ({
    getRoom: jest.fn(async (code) => {
        const data = mockRedisStorage.get(`room:${code}`);
        return data ? JSON.parse(data) : null;
    }),
    roomExists: jest.fn(async (code) => mockRedisStorage.has(`room:${code}`)),
    createRoom: jest.fn(async () => ({
        room: { code: 'TEST12', settings: {} },
        player: { sessionId: 'test', nickname: 'Host' }
    }))
}));

// Import routes after mocks
const roomRoutes = require('../routes/roomRoutes');
const healthRoutes = require('../routes/healthRoutes');
const { errorHandler } = require('../middleware/errorHandler');
const playerService = require('../services/playerService');

function createTestApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/rooms', roomRoutes);
    app.use('/api/health', healthRoutes);
    app.use(errorHandler);
    return app;
}

describe('Extended Room Routes', () => {
    let app;

    beforeEach(() => {
        app = createTestApp();
        mockRedisStorage.clear();
        mockRedisSets.clear();
        jest.clearAllMocks();
    });

    describe('GET /api/rooms/:code/exists', () => {
        it('handles room codes with various valid formats', async () => {
            const roomCode = 'XY7890';
            mockRedisStorage.set(`room:${roomCode}`, JSON.stringify({
                code: roomCode,
                status: 'waiting',
                settings: {}
            }));

            const response = await request(app)
                .get(`/api/rooms/${roomCode}/exists`)
                .expect(200);

            expect(response.body.exists).toBe(true);
        });

        it('handles special valid characters', async () => {
            const roomCode = 'HJK234';
            mockRedisStorage.set(`room:${roomCode}`, JSON.stringify({
                code: roomCode,
                status: 'waiting'
            }));

            const response = await request(app)
                .get(`/api/rooms/${roomCode}/exists`)
                .expect(200);

            expect(response.body.exists).toBe(true);
        });

        it('returns exists true for password-protected room', async () => {
            const roomCode = 'PASSWD';
            mockRedisStorage.set(`room:${roomCode}`, JSON.stringify({
                code: roomCode,
                status: 'waiting',
                hasPassword: true
            }));

            const response = await request(app)
                .get(`/api/rooms/${roomCode}/exists`)
                .expect(200);

            // Note: the exists endpoint only returns the exists flag, not hasPassword
            expect(response.body.exists).toBe(true);
        });
    });

    describe('GET /api/rooms/:code', () => {
        it('returns full room info with player count', async () => {
            const roomCode = 'GAME01';
            mockRedisStorage.set(`room:${roomCode}`, JSON.stringify({
                code: roomCode,
                status: 'playing',
                hostSessionId: 'host-123',
                settings: {
                    teamNames: { red: 'Red', blue: 'Blue' },
                    turnTimer: 120
                }
            }));
            playerService.getPlayersInRoom.mockResolvedValue([
                { sessionId: 'p1', nickname: 'Player1' },
                { sessionId: 'p2', nickname: 'Player2' }
            ]);

            const response = await request(app)
                .get(`/api/rooms/${roomCode}`)
                .expect(200);

            expect(response.body.room.code).toBe(roomCode);
            expect(response.body.room.status).toBe('playing');
            expect(response.body.playerCount).toBe(2);
        });

        it('does not expose password hash', async () => {
            const roomCode = 'SECRET';
            mockRedisStorage.set(`room:${roomCode}`, JSON.stringify({
                code: roomCode,
                status: 'waiting',
                passwordHash: 'should-not-be-exposed',
                hasPassword: true,
                settings: { teamNames: { red: 'Red', blue: 'Blue' } }
            }));
            playerService.getPlayersInRoom.mockResolvedValue([]);

            const response = await request(app)
                .get(`/api/rooms/${roomCode}`)
                .expect(200);

            // The route only returns selected fields, not passwordHash or hasPassword
            expect(response.body.room.passwordHash).toBeUndefined();
            // hasPassword is not exposed in the public room info endpoint
            expect(response.body.room.hostSessionId).toBeUndefined();
        });

        it('validates room code format', async () => {
            await request(app)
                .get('/api/rooms/a/info') // Too short
                .expect(404); // This will be 404 since it won't match the route

            // Expected - route doesn't match
        });
    });
});

describe('Extended Health Routes', () => {
    let app;
    const { isRedisHealthy, isUsingMemoryMode } = require('../config/redis');
    const pubSubHealth = require('../utils/pubSubHealth');

    beforeEach(() => {
        app = createTestApp();
        jest.clearAllMocks();
    });

    describe('GET /api/health', () => {
        it('returns consistent timestamp format', async () => {
            const response = await request(app)
                .get('/api/health')
                .expect(200);

            expect(response.body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
        });
    });

    describe('GET /api/health/ready', () => {
        it('handles mixed healthy/unhealthy components', async () => {
            isUsingMemoryMode.mockReturnValue(false);
            isRedisHealthy.mockResolvedValue(true);
            pubSubHealth.getHealth.mockReturnValue({
                isHealthy: false,
                consecutiveFailures: 3,
                lastError: 'Temporary failure'
            });

            const response = await request(app)
                .get('/api/health/ready')
                .expect(503);

            expect(response.body.status).toBe('degraded');
            expect(response.body.checks.redis.healthy).toBe(true);
            expect(response.body.checks.pubsub.healthy).toBe(false);
        });

        it('includes detailed pubsub info when degraded', async () => {
            isUsingMemoryMode.mockReturnValue(false);
            isRedisHealthy.mockResolvedValue(true);
            pubSubHealth.getHealth.mockReturnValue({
                isHealthy: false,
                consecutiveFailures: 10,
                lastError: 'Connection timeout'
            });

            const response = await request(app)
                .get('/api/health/ready')
                .expect(503);

            expect(response.body.checks.pubsub.consecutiveFailures).toBe(10);
            expect(response.body.checks.pubsub.lastError).toBe('Connection timeout');
        });
    });

    describe('GET /api/health/metrics', () => {
        it('includes all expected metric sections', async () => {
            isUsingMemoryMode.mockReturnValue(true);
            isRedisHealthy.mockResolvedValue(true);
            pubSubHealth.getHealth.mockReturnValue({
                isHealthy: true,
                totalPublishes: 1000,
                totalFailures: 5,
                failureRate: 0.005,
                consecutiveFailures: 0
            });

            const response = await request(app)
                .get('/api/health/metrics')
                .expect(200);

            expect(response.body).toHaveProperty('timestamp');
            expect(response.body).toHaveProperty('uptime');
            expect(response.body).toHaveProperty('memory');
            expect(response.body).toHaveProperty('redis');
            expect(response.body).toHaveProperty('pubsub');
            expect(response.body).toHaveProperty('process');
        });

        it('formats memory values correctly', async () => {
            isUsingMemoryMode.mockReturnValue(true);
            isRedisHealthy.mockResolvedValue(true);
            pubSubHealth.getHealth.mockReturnValue({ isHealthy: true });

            const response = await request(app)
                .get('/api/health/metrics')
                .expect(200);

            // Memory values should be strings ending with "MB"
            expect(response.body.memory.heapUsed).toMatch(/^\d+MB$/);
            expect(response.body.memory.heapTotal).toMatch(/^\d+MB$/);
            expect(response.body.memory.rss).toMatch(/^\d+MB$/);
        });

        it('includes correct redis mode', async () => {
            isUsingMemoryMode.mockReturnValue(false);
            isRedisHealthy.mockResolvedValue(true);
            pubSubHealth.getHealth.mockReturnValue({ isHealthy: true });

            const response = await request(app)
                .get('/api/health/metrics')
                .expect(200);

            expect(response.body.redis.mode).toBe('redis');
        });

        it('handles metrics when redis is in memory mode', async () => {
            isUsingMemoryMode.mockReturnValue(true);
            isRedisHealthy.mockResolvedValue(true);
            pubSubHealth.getHealth.mockReturnValue({ isHealthy: true });

            const response = await request(app)
                .get('/api/health/metrics')
                .expect(200);

            expect(response.body.redis.mode).toBe('memory');
        });
    });

    describe('GET /api/health/live', () => {
        it('always returns success quickly', async () => {
            const startTime = Date.now();

            const response = await request(app)
                .get('/api/health/live')
                .expect(200);

            const duration = Date.now() - startTime;
            expect(duration).toBeLessThan(100); // Should be very fast
            expect(response.body.status).toBe('live');
        });
    });
});

describe('Error Handler Integration', () => {
    let app;

    beforeEach(() => {
        app = createTestApp();
        mockRedisStorage.clear();
    });

    it('handles validation errors with proper format', async () => {
        const response = await request(app)
            .get('/api/rooms/X/exists') // Too short - validation error
            .expect(400);

        expect(response.body.error).toBeDefined();
        expect(response.body.error.message).toBeDefined();
    });

    it('handles 404 for unknown routes', async () => {
        await request(app)
            .get('/api/unknown/route')
            .expect(404);

        // Express default 404
    });
});
