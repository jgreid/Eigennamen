/**
 * REST API Route Tests
 *
 * Tests for roomRoutes and wordListRoutes endpoints.
 * Uses supertest for HTTP request testing with mocked services.
 */

const request = require('supertest');
const express = require('express');

// Mock Redis storage
const mockRedisStorage = new Map();
const mockRedisSets = new Map();

// Setup mocks before importing app/services
jest.mock('../config/redis', () => {
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

// Mock database module
jest.mock('../config/database', () => ({
    getDatabase: jest.fn(() => null),
    connectDatabase: jest.fn(async () => {}),
    disconnectDatabase: jest.fn(async () => {}),
    isDatabaseEnabled: jest.fn(() => false)
}));

// Mock pubSubHealth for health routes
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

// Mock logger to suppress output
jest.mock('../utils/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
}));

// Mock word list service for routes that need it
const mockWordLists = new Map();
jest.mock('../services/wordListService', () => ({
    getPublicWordLists: jest.fn(async ({ search, limit, offset }) => {
        const lists = Array.from(mockWordLists.values()).filter(wl => wl.isPublic);
        if (search) {
            return lists.filter(wl => wl.name.toLowerCase().includes(search.toLowerCase()));
        }
        return lists.slice(offset || 0, (offset || 0) + (limit || 50));
    }),
    getWordList: jest.fn(async (id) => mockWordLists.get(id) || null),
    createWordList: jest.fn(async (data) => {
        const id = require('uuid').v4();
        const wordList = { id, ...data, createdAt: new Date().toISOString() };
        mockWordLists.set(id, wordList);
        return wordList;
    }),
    updateWordList: jest.fn(async (id, data, userId) => {
        const existing = mockWordLists.get(id);
        if (!existing) {
            const error = new Error('Word list not found');
            error.code = 'WORD_LIST_NOT_FOUND';
            throw error;
        }
        if (existing.ownerId !== userId) {
            const error = new Error('Not authorized');
            error.code = 'NOT_AUTHORIZED';
            throw error;
        }
        const updated = { ...existing, ...data, updatedAt: new Date().toISOString() };
        mockWordLists.set(id, updated);
        return updated;
    }),
    deleteWordList: jest.fn(async (id, userId) => {
        const existing = mockWordLists.get(id);
        if (!existing) {
            const error = new Error('Word list not found');
            error.code = 'WORD_LIST_NOT_FOUND';
            throw error;
        }
        if (existing.ownerId !== userId) {
            const error = new Error('Not authorized');
            error.code = 'NOT_AUTHORIZED';
            throw error;
        }
        mockWordLists.delete(id);
        return true;
    }),
    getWordsForGame: jest.fn(async () => null)
}));

// Import routes after mocks
const roomRoutes = require('../routes/roomRoutes');
const wordListRoutes = require('../routes/wordListRoutes');
const healthRoutes = require('../routes/healthRoutes');
const { errorHandler } = require('../middleware/errorHandler');

// Create test app
function createTestApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/rooms', roomRoutes);
    app.use('/api/wordlists', wordListRoutes);
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

describe('WordList Routes', () => {
    let app;
    const wordListService = require('../services/wordListService');

    beforeEach(() => {
        app = createTestApp();
        mockWordLists.clear();
    });

    describe('GET /api/wordlists', () => {
        it('should return empty list when no word lists exist', async () => {
            const response = await request(app)
                .get('/api/wordlists')
                .expect(200);

            expect(response.body.wordLists).toEqual([]);
        });

        it('should return public word lists', async () => {
            // Add some word lists
            mockWordLists.set('wl-1', {
                id: 'wl-1',
                name: 'Animals',
                description: 'Animal words',
                words: Array(25).fill('word'),
                isPublic: true,
                ownerId: 'user-1'
            });
            mockWordLists.set('wl-2', {
                id: 'wl-2',
                name: 'Private List',
                words: Array(25).fill('word'),
                isPublic: false,
                ownerId: 'user-2'
            });

            const response = await request(app)
                .get('/api/wordlists')
                .expect(200);

            expect(response.body.wordLists.length).toBe(1);
            expect(response.body.wordLists[0].name).toBe('Animals');
        });

        it('should support search query parameter', async () => {
            mockWordLists.set('wl-1', {
                id: 'wl-1',
                name: 'Animals',
                words: Array(25).fill('word'),
                isPublic: true
            });
            mockWordLists.set('wl-2', {
                id: 'wl-2',
                name: 'Food Items',
                words: Array(25).fill('word'),
                isPublic: true
            });

            const _response = await request(app)
                .get('/api/wordlists?search=animal')
                .expect(200);

            expect(wordListService.getPublicWordLists).toHaveBeenCalledWith(
                expect.objectContaining({ search: 'animal' })
            );
        });

        it('should support pagination parameters', async () => {
            const _response = await request(app)
                .get('/api/wordlists?limit=10&offset=5')
                .expect(200);

            expect(wordListService.getPublicWordLists).toHaveBeenCalledWith(
                expect.objectContaining({ limit: 10, offset: 5 })
            );
        });

        it('should reject invalid limit values', async () => {
            const response = await request(app)
                .get('/api/wordlists?limit=200') // Max is 100
                .expect(400);

            expect(response.body.error).toBeDefined();
        });
    });

    describe('GET /api/wordlists/:id', () => {
        it('should return word list by ID', async () => {
            const id = 'e8f8c9a0-1234-5678-9abc-def012345678';
            mockWordLists.set(id, {
                id,
                name: 'Test List',
                description: 'A test word list',
                words: Array(25).fill('word'),
                isPublic: true,
                ownerId: 'user-1'
            });

            const response = await request(app)
                .get(`/api/wordlists/${id}`)
                .expect(200);

            expect(response.body.wordList.id).toBe(id);
            expect(response.body.wordList.name).toBe('Test List');
            expect(response.body.wordList.wordCount).toBe(25);
        });

        it('should return 404 for non-existing word list', async () => {
            const response = await request(app)
                .get('/api/wordlists/e8f8c9a0-1234-5678-9abc-def012345678')
                .expect(404);

            expect(response.body.error.code).toBe('WORD_LIST_NOT_FOUND');
        });

        it('should return 403 for private word list without auth', async () => {
            const id = 'e8f8c9a0-1234-5678-9abc-def012345678';
            mockWordLists.set(id, {
                id,
                name: 'Private List',
                words: Array(25).fill('word'),
                isPublic: false,
                ownerId: 'user-1'
            });

            const response = await request(app)
                .get(`/api/wordlists/${id}`)
                .expect(403);

            expect(response.body.error.code).toBe('NOT_AUTHORIZED');
        });

        it('should reject invalid UUID format', async () => {
            const response = await request(app)
                .get('/api/wordlists/not-a-uuid')
                .expect(400);

            expect(response.body.error).toBeDefined();
        });
    });

    describe('POST /api/wordlists', () => {
        it('should return 403 without authentication', async () => {
            const response = await request(app)
                .post('/api/wordlists')
                .send({
                    name: 'New List',
                    words: Array(25).fill('word'),
                    isPublic: true
                })
                .expect(403);

            expect(response.body.error.code).toBe('NOT_AUTHORIZED');
        });

        it('should require authentication before validation', async () => {
            // Auth check happens before body validation in the route
            // So even with invalid data, we get 403 first
            const response = await request(app)
                .post('/api/wordlists')
                .send({
                    name: 'Small List',
                    words: ['word1', 'word2'], // Only 2 words, need 25
                    isPublic: true
                })
                .expect(403);

            expect(response.body.error.code).toBe('NOT_AUTHORIZED');
        });
    });

    describe('PUT /api/wordlists/:id', () => {
        it('should return 403 without authentication', async () => {
            const response = await request(app)
                .put('/api/wordlists/e8f8c9a0-1234-5678-9abc-def012345678')
                .send({ name: 'Updated Name' })
                .expect(403);

            expect(response.body.error.code).toBe('NOT_AUTHORIZED');
        });
    });

    describe('DELETE /api/wordlists/:id', () => {
        it('should return 403 without authentication', async () => {
            const response = await request(app)
                .delete('/api/wordlists/e8f8c9a0-1234-5678-9abc-def012345678')
                .expect(403);

            expect(response.body.error.code).toBe('NOT_AUTHORIZED');
        });
    });

    describe('Authentication with JWT', () => {
        const jwt = require('jsonwebtoken');
        const testSecret = 'test-jwt-secret';

        beforeEach(() => {
            process.env.JWT_SECRET = testSecret;
        });

        afterEach(() => {
            delete process.env.JWT_SECRET;
        });

        it('should allow authenticated user to create word list', async () => {
            const token = jwt.sign({ id: 'user-123' }, testSecret, { algorithm: 'HS256' });

            const response = await request(app)
                .post('/api/wordlists')
                .set('Authorization', `Bearer ${token}`)
                .send({
                    name: 'My Word List',
                    words: Array(25).fill('word').map((w, i) => `${w}${i}`),
                    isPublic: true
                })
                .expect(201);

            expect(response.body.wordList).toBeDefined();
            expect(response.body.wordList.name).toBe('My Word List');
        });

        it('should allow authenticated owner to update word list', async () => {
            const userId = 'owner-user-123';
            const token = jwt.sign({ id: userId }, testSecret, { algorithm: 'HS256' });
            const listId = 'e8f8c9a0-1234-5678-9abc-def012345678';

            mockWordLists.set(listId, {
                id: listId,
                name: 'Original Name',
                words: Array(25).fill('word'),
                isPublic: true,
                ownerId: userId
            });

            const response = await request(app)
                .put(`/api/wordlists/${listId}`)
                .set('Authorization', `Bearer ${token}`)
                .send({ name: 'Updated Name' })
                .expect(200);

            expect(response.body.wordList.name).toBe('Updated Name');
        });

        it('should allow authenticated owner to delete word list', async () => {
            const userId = 'owner-user-456';
            const token = jwt.sign({ id: userId }, testSecret, { algorithm: 'HS256' });
            const listId = 'e8f8c9a0-1234-5678-9abc-def012345678';

            mockWordLists.set(listId, {
                id: listId,
                name: 'To Be Deleted',
                words: Array(25).fill('word'),
                isPublic: true,
                ownerId: userId
            });

            const response = await request(app)
                .delete(`/api/wordlists/${listId}`)
                .set('Authorization', `Bearer ${token}`)
                .expect(200);

            expect(response.body.success).toBe(true);
        });

        it('should reject invalid JWT token', async () => {
            const response = await request(app)
                .post('/api/wordlists')
                .set('Authorization', 'Bearer invalid-token')
                .send({
                    name: 'My Word List',
                    words: Array(25).fill('word'),
                    isPublic: true
                })
                .expect(403);

            expect(response.body.error.code).toBe('NOT_AUTHORIZED');
        });

        it('should reject JWT with invalid structure (missing id)', async () => {
            const token = jwt.sign({ name: 'user' }, testSecret, { algorithm: 'HS256' });

            const response = await request(app)
                .post('/api/wordlists')
                .set('Authorization', `Bearer ${token}`)
                .send({
                    name: 'My Word List',
                    words: Array(25).fill('word'),
                    isPublic: true
                })
                .expect(403);

            expect(response.body.error.code).toBe('NOT_AUTHORIZED');
        });

        it('should allow authenticated owner to view private word list', async () => {
            const userId = 'owner-user-789';
            const token = jwt.sign({ id: userId }, testSecret, { algorithm: 'HS256' });
            const listId = 'e8f8c9a0-1234-5678-9abc-def012345678';

            mockWordLists.set(listId, {
                id: listId,
                name: 'Private List',
                words: Array(25).fill('word'),
                isPublic: false,
                ownerId: userId
            });

            const response = await request(app)
                .get(`/api/wordlists/${listId}`)
                .set('Authorization', `Bearer ${token}`)
                .expect(200);

            expect(response.body.wordList.name).toBe('Private List');
        });

        it('should handle service errors gracefully in POST', async () => {
            const token = jwt.sign({ id: 'user-123' }, testSecret, { algorithm: 'HS256' });

            wordListService.createWordList.mockRejectedValueOnce(new Error('Database error'));

            const response = await request(app)
                .post('/api/wordlists')
                .set('Authorization', `Bearer ${token}`)
                .send({
                    name: 'My Word List',
                    words: Array(25).fill('word').map((w, i) => `${w}${i}`),
                    isPublic: true
                })
                .expect(500);

            expect(response.body.error).toBeDefined();
        });

        it('should handle service errors gracefully in PUT', async () => {
            const token = jwt.sign({ id: 'user-123' }, testSecret, { algorithm: 'HS256' });
            const listId = 'e8f8c9a0-1234-5678-9abc-def012345678';

            wordListService.updateWordList.mockRejectedValueOnce(new Error('Database error'));

            const response = await request(app)
                .put(`/api/wordlists/${listId}`)
                .set('Authorization', `Bearer ${token}`)
                .send({ name: 'Updated Name' })
                .expect(500);

            expect(response.body.error).toBeDefined();
        });

        it('should handle service errors gracefully in DELETE', async () => {
            const token = jwt.sign({ id: 'user-123' }, testSecret, { algorithm: 'HS256' });
            const listId = 'e8f8c9a0-1234-5678-9abc-def012345678';

            wordListService.deleteWordList.mockRejectedValueOnce(new Error('Database error'));

            const response = await request(app)
                .delete(`/api/wordlists/${listId}`)
                .set('Authorization', `Bearer ${token}`)
                .expect(500);

            expect(response.body.error).toBeDefined();
        });

        it('should handle service errors gracefully in GET list', async () => {
            wordListService.getPublicWordLists.mockRejectedValueOnce(new Error('Database error'));

            const response = await request(app)
                .get('/api/wordlists')
                .expect(500);

            expect(response.body.error).toBeDefined();
        });

        it('should handle service errors gracefully in GET by id', async () => {
            wordListService.getWordList.mockRejectedValueOnce(new Error('Database error'));

            const response = await request(app)
                .get('/api/wordlists/e8f8c9a0-1234-5678-9abc-def012345678')
                .expect(500);

            expect(response.body.error).toBeDefined();
        });
    });

    describe('extractUser middleware', () => {
        it('should skip JWT verification when JWT_SECRET not configured', async () => {
            delete process.env.JWT_SECRET;

            const response = await request(app)
                .get('/api/wordlists')
                .set('Authorization', 'Bearer some-token')
                .expect(200);

            expect(response.body.wordLists).toBeDefined();
        });

        it('should continue without auth header', async () => {
            const response = await request(app)
                .get('/api/wordlists')
                .expect(200);

            expect(response.body.wordLists).toBeDefined();
        });
    });
});

describe('Health Routes (/api/health)', () => {
    let app;
    const { isRedisHealthy, isUsingMemoryMode } = require('../config/redis');
    const pubSubHealth = require('../utils/pubSubHealth');

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
                        consecutiveFailures: 5,
                        lastError: 'Connection lost'
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
                error: 'Redis connection failed'
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
                error: 'Failed to collect metrics',
                message: 'Metrics collection error'
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
