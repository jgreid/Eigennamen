/**
 * Admin Routes Tests
 *
 * Tests for admin dashboard routes including authentication,
 * stats endpoints, room management, and broadcast functionality.
 */

const request = require('supertest');
const express = require('express');

// Mock Redis storage
const mockRedisStorage = new Map();
const mockRedisSets = new Map();

// Setup mocks before importing routes
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
        keys: jest.fn(async (pattern) => {
            const regex = new RegExp('^' + pattern.replace('*', '.*') + '$');
            return Array.from(mockRedisStorage.keys()).filter(key => regex.test(key));
        }),
        scan: jest.fn(async (cursor, options) => {
            const pattern = options?.MATCH || '*';
            const regex = new RegExp('^' + pattern.replace('*', '.*') + '$');
            const keys = Array.from(mockRedisStorage.keys()).filter(key => regex.test(key));
            return { cursor: 0, keys };
        }),
        exists: jest.fn(async (key) => mockRedisStorage.has(key) ? 1 : 0),
        expire: jest.fn(async () => 1),
        sMembers: jest.fn(async (key) => {
            const set = mockRedisSets.get(key);
            return set ? [...set] : [];
        }),
        sAdd: jest.fn(async (key, ...members) => {
            if (!mockRedisSets.has(key)) mockRedisSets.set(key, new Set());
            const set = mockRedisSets.get(key);
            let added = 0;
            members.forEach(m => { if (!set.has(m)) { set.add(m); added++; } });
            return added;
        }),
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


// Mock logger
jest.mock('../../utils/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
}));

// Mock metrics
jest.mock('../../utils/metrics', () => ({
    getAllMetrics: jest.fn(() => ({
        timestamp: Date.now(),
        instanceId: 'test',
        counters: {},
        gauges: {},
        histograms: {}
    })),
    incrementCounter: jest.fn(),
    setGauge: jest.fn(),
    METRIC_NAMES: {
        SOCKET_CONNECTIONS: 'socket_connections',
        PLAYER_KICKS: 'player_kicks_total',
        BROADCASTS_SENT: 'broadcasts_sent_total',
        RECONNECTIONS: 'reconnections_total',
        GAMES_STARTED: 'games_started',
        GAMES_COMPLETED: 'games_completed',
        CARDS_REVEALED: 'cards_revealed',
        CLUES_GIVEN: 'clues_given',
        ROOMS_CREATED: 'rooms_created',
        ROOMS_JOINED: 'rooms_joined',
        ERRORS: 'errors',
        RATE_LIMIT_HITS: 'rate_limit_hits',
        HTTP_REQUESTS: 'http_requests_total',
        WEBSOCKET_EVENTS: 'websocket_events_total',
        ACTIVE_ROOMS: 'active_rooms',
        ACTIVE_PLAYERS: 'active_players',
        ACTIVE_GAMES: 'active_games',
        ACTIVE_TIMERS: 'active_timers',
        SPECTATORS: 'spectators_total',
        MEMORY_HEAP_USED: 'memory_heap_used_bytes',
        MEMORY_HEAP_TOTAL: 'memory_heap_total_bytes',
        MEMORY_RSS: 'memory_rss_bytes',
        EVENT_LOOP_LAG: 'event_loop_lag_ms',
        OPERATION_LATENCY: 'operation_latency_ms',
        REDIS_LATENCY: 'redis_latency_ms',
        GAME_DURATION: 'game_duration_seconds',
        TURN_DURATION: 'turn_duration_seconds',
        SOCKET_EVENT_LATENCY: 'socket_event_latency_ms',
        HTTP_REQUEST_DURATION: 'http_request_duration_ms',
        WEBSOCKET_MESSAGE_SIZE: 'websocket_message_size_bytes'
    }
}));

// Mock rate limit
jest.mock('../../middleware/rateLimit', () => ({
    apiLimiter: (req, res, next) => next(),
    strictLimiter: (req, res, next) => next()
}));

// Mock roomService for delete operations
jest.mock('../../services/roomService', () => ({
    deleteRoom: jest.fn(async () => {}),
    getRoom: jest.fn(async (code) => mockRedisStorage.get(`room:${code}`)),
    cleanupRoom: jest.fn(async () => {})
}));

// Import after mocks
const adminRoutes = require('../../routes/adminRoutes');
const { errorHandler } = require('../../middleware/errorHandler');
const { isRedisHealthy } = require('../../config/redis');

// Helper to create auth header
function createAuthHeader(username, password) {
    const credentials = Buffer.from(`${username}:${password}`).toString('base64');
    return `Basic ${credentials}`;
}

// Create test app
function createTestApp(adminPassword = null) {
    // Set admin password env var
    if (adminPassword) {
        process.env.ADMIN_PASSWORD = adminPassword;
    } else {
        delete process.env.ADMIN_PASSWORD;
    }

    const app = express();
    app.use(express.json());

    // Mock socket.io
    const mockIO = {
        fetchSockets: jest.fn(async () => [{ id: '1' }, { id: '2' }]),
        emit: jest.fn(),
        to: jest.fn(() => ({ emit: jest.fn() }))
    };
    app.set('io', mockIO);

    app.use('/admin', adminRoutes);
    app.use(errorHandler);
    return app;
}

describe('Admin Routes', () => {
    const TEST_PASSWORD = 'test-admin-password';

    beforeEach(() => {
        mockRedisStorage.clear();
        mockRedisSets.clear();
        jest.clearAllMocks();
    });

    afterEach(() => {
        delete process.env.ADMIN_PASSWORD;
    });

    describe('Authentication', () => {
        it('should return 401 when ADMIN_PASSWORD is not configured', async () => {
            const app = createTestApp(null);

            const response = await request(app)
                .get('/admin/api/stats')
                .expect(401);

            expect(response.body.error.code).toBe('ADMIN_NOT_CONFIGURED');
        });

        it('should return 401 when no authorization header is provided', async () => {
            const app = createTestApp(TEST_PASSWORD);

            const response = await request(app)
                .get('/admin/api/stats')
                .expect(401);

            expect(response.body.error.code).toBe('AUTH_REQUIRED');
            expect(response.headers['www-authenticate']).toBe('Basic realm="Admin Dashboard"');
        });

        it('should return 401 when password is incorrect', async () => {
            const app = createTestApp(TEST_PASSWORD);

            const response = await request(app)
                .get('/admin/api/stats')
                .set('Authorization', createAuthHeader('admin', 'wrong-password'))
                .expect(401);

            expect(response.body.error.code).toBe('AUTH_INVALID');
        });

        it('should authenticate successfully with correct password', async () => {
            const app = createTestApp(TEST_PASSWORD);

            const response = await request(app)
                .get('/admin/api/stats')
                .set('Authorization', createAuthHeader('admin', TEST_PASSWORD))
                .expect(200);

            expect(response.body.timestamp).toBeDefined();
        });

        it('should accept any username with correct password', async () => {
            const app = createTestApp(TEST_PASSWORD);

            const response = await request(app)
                .get('/admin/api/stats')
                .set('Authorization', createAuthHeader('custom-user', TEST_PASSWORD))
                .expect(200);

            expect(response.body).toBeDefined();
        });

        it('should handle malformed authorization header gracefully', async () => {
            const app = createTestApp(TEST_PASSWORD);

            const response = await request(app)
                .get('/admin/api/stats')
                .set('Authorization', 'Basic invalid-base64-!!!')
                .expect(401);

            expect(response.body.error.code).toBe('AUTH_INVALID');
        });

        it('should reject non-Basic auth schemes', async () => {
            const app = createTestApp(TEST_PASSWORD);

            const response = await request(app)
                .get('/admin/api/stats')
                .set('Authorization', 'Bearer some-token')
                .expect(401);

            expect(response.body.error.code).toBe('AUTH_REQUIRED');
        });
    });

    describe('GET /admin/api/stats', () => {
        let app;

        beforeEach(() => {
            app = createTestApp(TEST_PASSWORD);
        });

        it('should return server statistics', async () => {
            const response = await request(app)
                .get('/admin/api/stats')
                .set('Authorization', createAuthHeader('admin', TEST_PASSWORD))
                .expect(200);

            expect(response.body).toMatchObject({
                timestamp: expect.any(String),
                uptime: expect.objectContaining({
                    seconds: expect.any(Number),
                    formatted: expect.any(String)
                }),
                memory: expect.objectContaining({
                    heapUsed: expect.any(Number),
                    heapTotal: expect.any(Number),
                    rss: expect.any(Number)
                }),
                connections: expect.objectContaining({
                    sockets: expect.any(Number),
                    activeRooms: expect.any(Number)
                }),
                health: expect.objectContaining({
                    redis: expect.any(Object)
                })
            });
        });

        it('should include rate limit metrics', async () => {
            const response = await request(app)
                .get('/admin/api/stats')
                .set('Authorization', createAuthHeader('admin', TEST_PASSWORD))
                .expect(200);

            expect(response.body.metrics).toBeDefined();
        });

        it('should include instance information', async () => {
            const response = await request(app)
                .get('/admin/api/stats')
                .set('Authorization', createAuthHeader('admin', TEST_PASSWORD))
                .expect(200);

            expect(response.body.instance).toMatchObject({
                pid: expect.any(Number),
                nodeVersion: expect.any(String)
            });
        });

        it('should handle Redis health check failures gracefully', async () => {
            isRedisHealthy.mockRejectedValueOnce(new Error('Redis error'));

            const response = await request(app)
                .get('/admin/api/stats')
                .set('Authorization', createAuthHeader('admin', TEST_PASSWORD))
                .expect(200);

            expect(response.body.health.redis.error).toBeDefined();
        });
    });

    describe('GET /admin/api/rooms', () => {
        let app;

        beforeEach(() => {
            app = createTestApp(TEST_PASSWORD);
        });

        it('should return empty list when no rooms exist', async () => {
            const response = await request(app)
                .get('/admin/api/rooms')
                .set('Authorization', createAuthHeader('admin', TEST_PASSWORD))
                .expect(200);

            expect(response.body.count).toBe(0);
            expect(response.body.rooms).toEqual([]);
        });

        it('should list active rooms', async () => {
            // Create test rooms
            const room1 = {
                code: 'ABC123',
                status: 'waiting',
                hostSessionId: 'host-session-123',
                hasPassword: false,
                createdAt: Date.now(),
                settings: { teamNames: { red: 'Red', blue: 'Blue' } }
            };
            const room2 = {
                code: 'XYZ789',
                status: 'playing',
                hostSessionId: 'host-session-456',
                createdAt: Date.now() - 1000,
                settings: { teamNames: { red: 'Fire', blue: 'Ice' }, turnTimer: 60 }
            };

            mockRedisStorage.set('room:ABC123', JSON.stringify(room1));
            mockRedisStorage.set('room:XYZ789', JSON.stringify(room2));
            mockRedisSets.set('room:ABC123:players', new Set(['player1', 'player2']));
            mockRedisSets.set('room:XYZ789:players', new Set(['player3']));

            const response = await request(app)
                .get('/admin/api/rooms')
                .set('Authorization', createAuthHeader('admin', TEST_PASSWORD))
                .expect(200);

            expect(response.body.count).toBe(2);
            expect(response.body.rooms).toHaveLength(2);

            // Should be sorted by creation time (newest first)
            expect(response.body.rooms[0].code).toBe('ABC123');
            expect(response.body.rooms[0].playerCount).toBe(2);
            expect(response.body.rooms[1].code).toBe('XYZ789');
        });

        it('should not include sensitive room data', async () => {
            const room = {
                code: 'SECRET',
                status: 'waiting',
                hostSessionId: 'secret-host-id',
                createdAt: Date.now(),
                settings: { teamNames: { red: 'Red', blue: 'Blue' } }
            };
            mockRedisStorage.set('room:SECRET', JSON.stringify(room));

            const response = await request(app)
                .get('/admin/api/rooms')
                .set('Authorization', createAuthHeader('admin', TEST_PASSWORD))
                .expect(200);

            const roomData = response.body.rooms[0];
            expect(roomData.hostSessionId).toBeUndefined();
        });
    });

    describe('POST /admin/api/broadcast', () => {
        let app;

        beforeEach(() => {
            app = createTestApp(TEST_PASSWORD);
        });

        it('should send broadcast message successfully', async () => {
            const response = await request(app)
                .post('/admin/api/broadcast')
                .set('Authorization', createAuthHeader('admin', TEST_PASSWORD))
                .send({ message: 'Test broadcast message', type: 'info' })
                .expect(200);

            expect(response.body.success).toBe(true);

            // Verify io.emit was called
            const io = app.get('io');
            expect(io.emit).toHaveBeenCalledWith('admin:broadcast', expect.objectContaining({
                message: 'Test broadcast message',
                type: 'info',
                from: 'admin'
            }));
        });

        it('should reject empty message', async () => {
            const response = await request(app)
                .post('/admin/api/broadcast')
                .set('Authorization', createAuthHeader('admin', TEST_PASSWORD))
                .send({ message: '', type: 'info' })
                .expect(400);

            expect(response.body.error.code).toBe('INVALID_INPUT');
        });

        it('should reject message that is too long', async () => {
            const longMessage = 'a'.repeat(501);

            const response = await request(app)
                .post('/admin/api/broadcast')
                .set('Authorization', createAuthHeader('admin', TEST_PASSWORD))
                .send({ message: longMessage, type: 'info' })
                .expect(400);

            expect(response.body.error.code).toBe('INVALID_INPUT');
        });

        it('should reject invalid message type', async () => {
            const response = await request(app)
                .post('/admin/api/broadcast')
                .set('Authorization', createAuthHeader('admin', TEST_PASSWORD))
                .send({ message: 'Test', type: 'invalid' })
                .expect(400);

            expect(response.body.error.code).toBe('INVALID_INPUT');
        });

        it('should default to info type when not specified', async () => {
            await request(app)
                .post('/admin/api/broadcast')
                .set('Authorization', createAuthHeader('admin', TEST_PASSWORD))
                .send({ message: 'Test message' })
                .expect(200);

            const io = app.get('io');
            expect(io.emit).toHaveBeenCalledWith('admin:broadcast', expect.objectContaining({
                type: 'info'
            }));
        });

        it('should trim whitespace from message', async () => {
            await request(app)
                .post('/admin/api/broadcast')
                .set('Authorization', createAuthHeader('admin', TEST_PASSWORD))
                .send({ message: '  Trimmed message  ', type: 'warning' })
                .expect(200);

            const io = app.get('io');
            expect(io.emit).toHaveBeenCalledWith('admin:broadcast', expect.objectContaining({
                message: 'Trimmed message'
            }));
        });

        it('should return 503 when socket.io is not available', async () => {
            // Create app without io
            const appWithoutIO = express();
            appWithoutIO.use(express.json());
            process.env.ADMIN_PASSWORD = TEST_PASSWORD;
            appWithoutIO.use('/admin', adminRoutes);

            const response = await request(appWithoutIO)
                .post('/admin/api/broadcast')
                .set('Authorization', createAuthHeader('admin', TEST_PASSWORD))
                .send({ message: 'Test', type: 'info' })
                .expect(503);

            expect(response.body.error.code).toBe('SOCKET_UNAVAILABLE');
        });
    });

    describe('DELETE /admin/api/rooms/:code', () => {
        let app;
        const roomService = require('../../services/roomService');

        beforeEach(() => {
            app = createTestApp(TEST_PASSWORD);
        });

        it('should close a room successfully', async () => {
            const room = {
                code: 'delete',
                status: 'waiting',
                hostSessionId: 'host-session-123',
                createdAt: Date.now(),
                settings: {}
            };
            mockRedisStorage.set('room:delete', JSON.stringify(room));

            const response = await request(app)
                .delete('/admin/api/rooms/DELETE')
                .set('Authorization', createAuthHeader('admin', TEST_PASSWORD))
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(roomService.deleteRoom).toHaveBeenCalledWith('delete');
        });

        it('should notify players before closing room', async () => {
            const room = {
                code: 'notify',
                status: 'playing',
                hostSessionId: 'host-session-123',
                createdAt: Date.now(),
                settings: {}
            };
            mockRedisStorage.set('room:notify', JSON.stringify(room));

            await request(app)
                .delete('/admin/api/rooms/NOTIFY')
                .set('Authorization', createAuthHeader('admin', TEST_PASSWORD))
                .expect(200);

            const io = app.get('io');
            expect(io.to).toHaveBeenCalledWith('room:notify');
        });

        it('should return 404 for non-existing room', async () => {
            const response = await request(app)
                .delete('/admin/api/rooms/NOROOM')
                .set('Authorization', createAuthHeader('admin', TEST_PASSWORD))
                .expect(404);

            expect(response.body.error.code).toBe('ROOM_NOT_FOUND');
        });

        it('should reject invalid room code format', async () => {
            const response = await request(app)
                .delete('/admin/api/rooms/ab')
                .set('Authorization', createAuthHeader('admin', TEST_PASSWORD))
                .expect(400);

            expect(response.body.error.code).toBe('INVALID_ROOM_CODE');
        });

        it('should normalize room code to lowercase', async () => {
            const room = {
                code: 'lower1',
                status: 'waiting',
                hostSessionId: 'host-session-123',
                createdAt: Date.now(),
                settings: {}
            };
            mockRedisStorage.set('room:lower1', JSON.stringify(room));

            await request(app)
                .delete('/admin/api/rooms/LOWER1')
                .set('Authorization', createAuthHeader('admin', TEST_PASSWORD))
                .expect(200);

            expect(roomService.deleteRoom).toHaveBeenCalledWith('lower1');
        });
    });

    describe('GET /admin (HTML page)', () => {
        it('should serve admin.html', async () => {
            const app = createTestApp(TEST_PASSWORD);

            // Mock sendFile to verify it's called with correct path
            const originalSendFile = express.response.sendFile;
            let sentPath = null;

            express.response.sendFile = function(filePath, callback) {
                sentPath = filePath;
                if (callback) callback(null);
                this.status(200).send('Admin HTML');
            };

            await request(app)
                .get('/admin')
                .set('Authorization', createAuthHeader('admin', TEST_PASSWORD))
                .expect(200);

            // Restore original
            express.response.sendFile = originalSendFile;

            expect(sentPath).toContain('admin.html');
        });
    });

    describe('Integration scenarios', () => {
        it('should track admin username in broadcast', async () => {
            const testApp = createTestApp(TEST_PASSWORD);

            await request(testApp)
                .post('/admin/api/broadcast')
                .set('Authorization', createAuthHeader('superadmin', TEST_PASSWORD))
                .send({ message: 'Admin message', type: 'warning' })
                .expect(200);

            const io = testApp.get('io');
            expect(io.emit).toHaveBeenCalledWith('admin:broadcast', expect.objectContaining({
                from: 'superadmin'
            }));
        });

        it('should handle concurrent requests correctly', async () => {
            const app = createTestApp(TEST_PASSWORD);

            const requests = Array(5).fill(null).map(() =>
                request(app)
                    .get('/admin/api/stats')
                    .set('Authorization', createAuthHeader('admin', TEST_PASSWORD))
            );

            const responses = await Promise.all(requests);

            responses.forEach(response => {
                expect(response.status).toBe(200);
                expect(response.body.timestamp).toBeDefined();
            });
        });
    });
});

describe('Uptime formatting', () => {
    it('should format uptime correctly', async () => {
        process.env.ADMIN_PASSWORD = 'test-password';
        const app = express();
        app.use(express.json());
        const mockIO = {
            fetchSockets: jest.fn(async () => [{ id: '1' }, { id: '2' }]),
            emit: jest.fn(),
            to: jest.fn(() => ({ emit: jest.fn() }))
        };
        app.set('io', mockIO);
        app.use('/admin', adminRoutes);
        app.use(errorHandler);

        const response = await request(app)
            .get('/admin/api/stats')
            .set('Authorization', createAuthHeader('admin', 'test-password'))
            .expect(200);

        // Uptime should be a readable format like "1h 2m 3s", "1m", "0s", etc.
        expect(response.body.uptime.formatted).toMatch(/^\d+[dhms](\s\d+[dhms])*$/);
    });
});
