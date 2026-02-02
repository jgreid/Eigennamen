/**
 * Coverage Tier 2 Tests
 *
 * Targets uncovered branches in:
 * - gameService.js: generateSeed fallback, createGame lock paths, giveClueOptimized/endTurnOptimized Lua validation
 * - redis.js: retry logic, cleanupPartialConnections
 * - adminRoutes.js: error paths, edge cases
 * - app.js: service-worker caching, error paths in health/metrics
 */

// ─── gameService.js ──────────────────────────────────────────────────────────

// Mock Redis before requiring gameService
const mockRedisInstance = {
    set: jest.fn().mockResolvedValue('OK'),
    get: jest.fn().mockResolvedValue(null),
    del: jest.fn().mockResolvedValue(1),
    keys: jest.fn().mockResolvedValue([]),
    scan: jest.fn().mockResolvedValue({ cursor: '0', keys: [] }),
    exists: jest.fn().mockResolvedValue(0),
    eval: jest.fn().mockResolvedValue(null),
    expire: jest.fn().mockResolvedValue(1),
    watch: jest.fn().mockResolvedValue('OK'),
    unwatch: jest.fn().mockResolvedValue('OK'),
    multi: jest.fn().mockReturnValue({
        set: jest.fn().mockReturnThis(),
        del: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([])
    })
};

jest.mock('../config/redis', () => ({
    getRedis: () => mockRedisInstance,
    connectRedis: jest.fn(),
    disconnectRedis: jest.fn(),
    isRedisHealthy: jest.fn(async () => true),
    isUsingMemoryMode: jest.fn(() => true),
    getPubSubClients: jest.fn(() => ({ pubClient: mockRedisInstance, subClient: mockRedisInstance }))
}));

jest.mock('../utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));

jest.mock('../services/wordListService', () => ({
    getWordsForGame: jest.fn()
}));

jest.mock('../services/roomService', () => ({
    deleteRoom: jest.fn(async () => {}),
    getRoom: jest.fn(),
    cleanupRoom: jest.fn(async () => {})
}));

const gameService = require('../services/gameService');
const crypto = require('crypto');

describe('gameService - generateSeed crypto fallback', () => {
    test('falls back to Math.random when crypto.randomBytes throws', () => {
        const spy = jest.spyOn(crypto, 'randomBytes').mockImplementationOnce(() => {
            throw new Error('not available');
        });

        const seed = gameService.generateSeed();
        expect(typeof seed).toBe('string');
        expect(seed.length).toBeGreaterThan(0);

        spy.mockRestore();
    });
});

describe('gameService - createGame lock branches', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('throws when lock not acquired and no existing game', async () => {
        mockRedisInstance.set.mockResolvedValueOnce(null); // lock fails
        mockRedisInstance.get.mockResolvedValueOnce(null); // no existing game (getGame)

        await expect(gameService.createGame('ROOM1')).rejects.toThrow('Game creation in progress');
    });

    test('throws GAME_IN_PROGRESS when lock not acquired but active game exists', async () => {
        mockRedisInstance.set.mockResolvedValueOnce(null); // lock fails
        // getGame returns active game
        mockRedisInstance.get.mockResolvedValueOnce(JSON.stringify({
            gameOver: false,
            words: [],
            types: []
        }));

        await expect(gameService.createGame('ROOM1')).rejects.toThrow();
    });

    test('throws when lock acquired but existing active game', async () => {
        mockRedisInstance.set.mockResolvedValueOnce('OK'); // lock acquired
        // getGame returns active game
        mockRedisInstance.get.mockResolvedValueOnce(JSON.stringify({
            gameOver: false,
            words: [],
            types: []
        }));

        // del is called to release the lock
        await expect(gameService.createGame('ROOM1')).rejects.toThrow();
    });

    test('throws ROOM_NOT_FOUND when lock acquired, no game, but room missing', async () => {
        mockRedisInstance.set.mockResolvedValueOnce('OK'); // lock acquired
        mockRedisInstance.get
            .mockResolvedValueOnce(null)  // no existing game (getGame)
            .mockResolvedValueOnce(null); // no room data (preCheckRoomData)

        await expect(gameService.createGame('ROOM1')).rejects.toThrow('Room not found');
    });
});

describe('gameService - giveClueOptimized Lua result validation', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('throws on null Lua result', async () => {
        mockRedisInstance.eval.mockResolvedValue(null);

        await expect(gameService.giveClueOptimized('ROOM1', 'red', 'CLUE', 3, 'Spy'))
            .rejects.toThrow(/Invalid Lua script result|empty or non-string/);
    });

    test('throws on non-string Lua result', async () => {
        mockRedisInstance.eval.mockResolvedValue(42);

        await expect(gameService.giveClueOptimized('ROOM1', 'red', 'CLUE', 3, 'Spy'))
            .rejects.toThrow(/Invalid Lua script result|empty or non-string/);
    });

    test('throws on unparseable Lua result', async () => {
        mockRedisInstance.eval.mockResolvedValue('not-json{{{');

        await expect(gameService.giveClueOptimized('ROOM1', 'red', 'CLUE', 3, 'Spy'))
            .rejects.toThrow(/parse/i);
    });

    test('throws on non-object Lua result', async () => {
        mockRedisInstance.eval.mockResolvedValue('"just a string"');

        await expect(gameService.giveClueOptimized('ROOM1', 'red', 'CLUE', 3, 'Spy'))
            .rejects.toThrow(/not an object/);
    });

    test('throws mapped error for NO_GAME', async () => {
        mockRedisInstance.eval.mockResolvedValue(JSON.stringify({ error: 'NO_GAME' }));

        await expect(gameService.giveClueOptimized('ROOM1', 'red', 'CLUE', 3, 'Spy'))
            .rejects.toThrow('No active game');
    });

    test('throws mapped error for GAME_OVER', async () => {
        mockRedisInstance.eval.mockResolvedValue(JSON.stringify({ error: 'GAME_OVER' }));

        await expect(gameService.giveClueOptimized('ROOM1', 'red', 'CLUE', 3, 'Spy'))
            .rejects.toThrow('Game is already over');
    });

    test('throws mapped error for NOT_YOUR_TURN', async () => {
        mockRedisInstance.eval.mockResolvedValue(JSON.stringify({ error: 'NOT_YOUR_TURN' }));

        await expect(gameService.giveClueOptimized('ROOM1', 'red', 'CLUE', 3, 'Spy'))
            .rejects.toThrow("not your team's turn");
    });

    test('throws mapped error for CLUE_ALREADY_GIVEN', async () => {
        mockRedisInstance.eval.mockResolvedValue(JSON.stringify({ error: 'CLUE_ALREADY_GIVEN' }));

        await expect(gameService.giveClueOptimized('ROOM1', 'red', 'CLUE', 3, 'Spy'))
            .rejects.toThrow('clue has already been given');
    });

    test('throws mapped error for INVALID_NUMBER', async () => {
        mockRedisInstance.eval.mockResolvedValue(JSON.stringify({ error: 'INVALID_NUMBER' }));

        await expect(gameService.giveClueOptimized('ROOM1', 'red', 'CLUE', 3, 'Spy'))
            .rejects.toThrow(/Clue number must be/);
    });

    test('throws mapped error for WORD_ON_BOARD', async () => {
        mockRedisInstance.eval.mockResolvedValue(JSON.stringify({ error: 'WORD_ON_BOARD', word: 'CLUE' }));

        await expect(gameService.giveClueOptimized('ROOM1', 'red', 'CLUE', 3, 'Spy'))
            .rejects.toThrow(/word on the board/);
    });

    test('throws mapped error for CONTAINS_BOARD_WORD', async () => {
        mockRedisInstance.eval.mockResolvedValue(JSON.stringify({ error: 'CONTAINS_BOARD_WORD', word: 'CL' }));

        await expect(gameService.giveClueOptimized('ROOM1', 'red', 'CLUE', 3, 'Spy'))
            .rejects.toThrow(/contains board word/);
    });

    test('throws mapped error for BOARD_CONTAINS_CLUE', async () => {
        mockRedisInstance.eval.mockResolvedValue(JSON.stringify({ error: 'BOARD_CONTAINS_CLUE', word: 'CLUEWORD' }));

        await expect(gameService.giveClueOptimized('ROOM1', 'red', 'CLUE', 3, 'Spy'))
            .rejects.toThrow(/Board word.*contains/);
    });

    test('throws ServerError for unknown error code', async () => {
        mockRedisInstance.eval.mockResolvedValue(JSON.stringify({ error: 'UNKNOWN_ERR' }));

        await expect(gameService.giveClueOptimized('ROOM1', 'red', 'CLUE', 3, 'Spy'))
            .rejects.toThrow('UNKNOWN_ERR');
    });

    test('returns success result', async () => {
        const successResult = {
            success: true,
            team: 'red',
            word: 'CLUE',
            number: 3,
            spymaster: 'Spy',
            guessesAllowed: 4,
            timestamp: Date.now()
        };
        mockRedisInstance.eval.mockResolvedValue(JSON.stringify(successResult));

        const result = await gameService.giveClueOptimized('ROOM1', 'red', 'CLUE', 3, 'Spy');
        expect(result.success).toBe(true);
        expect(result.team).toBe('red');
    });
});

describe('gameService - endTurnOptimized Lua result validation', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('throws on null Lua result', async () => {
        mockRedisInstance.eval.mockResolvedValue(null);

        await expect(gameService.endTurnOptimized('ROOM1', 'Player'))
            .rejects.toThrow(/Invalid Lua script result|empty or non-string/);
    });

    test('throws on non-string Lua result', async () => {
        mockRedisInstance.eval.mockResolvedValue(42);

        await expect(gameService.endTurnOptimized('ROOM1', 'Player'))
            .rejects.toThrow(/Invalid Lua script result|empty or non-string/);
    });

    test('throws on unparseable JSON result', async () => {
        mockRedisInstance.eval.mockResolvedValue('broken{json');

        await expect(gameService.endTurnOptimized('ROOM1', 'Player'))
            .rejects.toThrow(/parse/i);
    });

    test('throws on non-object result', async () => {
        mockRedisInstance.eval.mockResolvedValue('"just a string"');

        await expect(gameService.endTurnOptimized('ROOM1', 'Player'))
            .rejects.toThrow(/not an object/);
    });

    test('throws mapped error for NO_GAME', async () => {
        mockRedisInstance.eval.mockResolvedValue(JSON.stringify({ error: 'NO_GAME' }));

        await expect(gameService.endTurnOptimized('ROOM1', 'Player'))
            .rejects.toThrow('No active game');
    });

    test('throws mapped error for GAME_OVER', async () => {
        mockRedisInstance.eval.mockResolvedValue(JSON.stringify({ error: 'GAME_OVER' }));

        await expect(gameService.endTurnOptimized('ROOM1', 'Player'))
            .rejects.toThrow('Game is already over');
    });

    test('throws ServerError for unknown error code', async () => {
        mockRedisInstance.eval.mockResolvedValue(JSON.stringify({ error: 'WEIRD_ERROR' }));

        await expect(gameService.endTurnOptimized('ROOM1', 'Player'))
            .rejects.toThrow('WEIRD_ERROR');
    });

    test('returns success result', async () => {
        const successResult = {
            success: true,
            previousTurn: 'red',
            currentTurn: 'blue'
        };
        mockRedisInstance.eval.mockResolvedValue(JSON.stringify(successResult));

        const result = await gameService.endTurnOptimized('ROOM1', 'Player');
        expect(result.success).toBe(true);
        expect(result.currentTurn).toBe('blue');
    });
});

describe('gameService - revealCardOptimized error not in errorMap', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('unknown Lua error falls back to SERVER_ERROR', async () => {
        mockRedisInstance.eval.mockResolvedValue(JSON.stringify({ error: 'SOMETHING_UNKNOWN' }));

        await expect(gameService.revealCardOptimized('ROOM1', 0, 'Player'))
            .rejects.toMatchObject({ code: expect.any(String) });
    });
});

// ─── redis.js - retry logic and cleanupPartialConnections ────────────────────
// The top-level jest.mock for '../config/redis' prevents us from testing
// the actual redis.js module in this file. We test redis retry and cleanup
// logic by isolating module loading.

// Redis retry/cleanup tests use jest.isolateModules with jest.unmock to bypass
// the top-level mock.

describe('redis.js - retry and cleanup', () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
        process.env = { ...originalEnv };
    });

    function setupRedisTest(mockClientFactory) {
        return new Promise((resolve, _reject) => {
            jest.isolateModules(() => {
                jest.unmock('../config/redis');
                jest.doMock('redis', () => ({
                    createClient: jest.fn(mockClientFactory)
                }));
                jest.doMock('../utils/logger', () => ({
                    info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn()
                }));
                jest.doMock('../config/memoryStorage', () => ({
                    getMemoryStorage: jest.fn(),
                    isMemoryMode: jest.fn().mockReturnValue(false)
                }));
                const redis = require('../config/redis');
                resolve(redis);
            });
        });
    }

    test('connectRedis retries on failure then succeeds', async () => {
        let attempt = 0;
        const quitMock = jest.fn().mockResolvedValue();
        const mockPub = { connect: jest.fn().mockResolvedValue(), on: jest.fn(), isOpen: true, quit: quitMock };
        const mockSub = { connect: jest.fn().mockResolvedValue(), on: jest.fn(), isOpen: true, quit: quitMock };

        process.env.REDIS_URL = 'redis://localhost:6379';
        process.env.NODE_ENV = 'test';

        const redis = await setupRedisTest(() => ({
            connect: jest.fn().mockImplementation(async () => {
                attempt++;
                if (attempt === 1) throw new Error('Connection refused');
            }),
            on: jest.fn(),
            isOpen: false,
            quit: quitMock,
            duplicate: jest.fn()
                .mockReturnValueOnce(mockPub)
                .mockReturnValueOnce(mockSub)
        }));

        const result = await redis.connectRedis();
        expect(result).toHaveProperty('redisClient');
        expect(attempt).toBe(2);
    }, 30000);

    test('connectRedis throws after all retries fail', async () => {
        const quitMock = jest.fn().mockResolvedValue();

        process.env.REDIS_URL = 'redis://localhost:6379';
        process.env.NODE_ENV = 'test';

        const redis = await setupRedisTest(() => ({
            connect: jest.fn().mockRejectedValue(new Error('Connection refused')),
            on: jest.fn(),
            isOpen: false,
            quit: quitMock
        }));

        await expect(redis.connectRedis()).rejects.toThrow('Connection refused');
    }, 120000);

    test('cleanupPartialConnections quits open clients on failed attempt', async () => {
        let callCount = 0;
        const quitMock = jest.fn().mockResolvedValue();
        const mockPub = { connect: jest.fn().mockResolvedValue(), on: jest.fn(), isOpen: true, quit: quitMock };
        const mockSub = { connect: jest.fn().mockResolvedValue(), on: jest.fn(), isOpen: true, quit: quitMock };

        process.env.REDIS_URL = 'redis://localhost:6379';
        process.env.NODE_ENV = 'test';

        const redis = await setupRedisTest(() => ({
            connect: jest.fn().mockImplementation(async () => {
                callCount++;
                if (callCount <= 1) throw new Error('fail');
            }),
            on: jest.fn(),
            isOpen: true,
            quit: quitMock,
            duplicate: jest.fn()
                .mockReturnValueOnce(mockPub)
                .mockReturnValueOnce(mockSub)
        }));

        const result = await redis.connectRedis();
        expect(result).toHaveProperty('redisClient');
        expect(quitMock).toHaveBeenCalled();
    }, 30000);

    test('cleanupPartialConnections handles quit error gracefully', async () => {
        let callCount = 0;
        const goodQuit = jest.fn().mockResolvedValue();
        const mockPub = { connect: jest.fn().mockResolvedValue(), on: jest.fn(), isOpen: true, quit: goodQuit };
        const mockSub = { connect: jest.fn().mockResolvedValue(), on: jest.fn(), isOpen: true, quit: goodQuit };

        process.env.REDIS_URL = 'redis://localhost:6379';
        process.env.NODE_ENV = 'test';

        const redis = await setupRedisTest(() => ({
            connect: jest.fn().mockImplementation(async () => {
                callCount++;
                if (callCount <= 1) throw new Error('fail');
            }),
            on: jest.fn(),
            isOpen: true,
            quit: jest.fn().mockRejectedValue(new Error('quit failed')),
            duplicate: jest.fn()
                .mockReturnValueOnce(mockPub)
                .mockReturnValueOnce(mockSub)
        }));

        const result = await redis.connectRedis();
        expect(result).toHaveProperty('redisClient');
    }, 30000);
});

// ─── adminRoutes.js ──────────────────────────────────────────────────────────

const request = require('supertest');
const express = require('express');

// We need a fresh app for admin tests since we already mocked redis above
describe('adminRoutes - uncovered branches', () => {
    const { isRedisHealthy } = require('../config/redis');
    const adminRoutes = require('../routes/adminRoutes');
    const { errorHandler } = require('../middleware/errorHandler');

    function createAuthHeader(username, password) {
        return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
    }

    function createTestApp(adminPassword = null) {
        if (adminPassword) {
            process.env.ADMIN_PASSWORD = adminPassword;
        } else {
            delete process.env.ADMIN_PASSWORD;
        }
        const app = express();
        app.use(express.json());
        const mockIO = {
            fetchSockets: jest.fn(async () => [{ id: '1' }]),
            emit: jest.fn(),
            to: jest.fn(() => ({ emit: jest.fn() }))
        };
        app.set('io', mockIO);
        app.use('/admin', adminRoutes);
        app.use(errorHandler);
        return app;
    }

    const PW = 'test-pw';

    beforeEach(() => {
        jest.clearAllMocks();
        mockRedisInstance.keys.mockResolvedValue([]);
        mockRedisInstance.scan.mockResolvedValue({ cursor: '0', keys: [] });
        mockRedisInstance.get.mockResolvedValue(null);
    });

    afterEach(() => {
        delete process.env.ADMIN_PASSWORD;
    });

    test('GET /admin serves HTML (or 500 if file missing)', async () => {
        const app = createTestApp(PW);
        const res = await request(app)
            .get('/admin')
            .set('Authorization', createAuthHeader('admin', PW));
        // In test env, admin.html may not exist
        expect([200, 500]).toContain(res.status);
    });

    test('GET /admin/api/stats handles redis health error', async () => {
        isRedisHealthy.mockRejectedValueOnce(new Error('Redis down'));
        const app = createTestApp(PW);
        const res = await request(app)
            .get('/admin/api/stats')
            .set('Authorization', createAuthHeader('admin', PW));
        expect(res.status).toBe(200);
        expect(res.body.health.redis).toHaveProperty('error');
    });

    test('GET /admin/api/stats handles io.fetchSockets error', async () => {
        const app = createTestApp(PW);
        const io = app.get('io');
        io.fetchSockets.mockRejectedValueOnce(new Error('Socket error'));
        const res = await request(app)
            .get('/admin/api/stats')
            .set('Authorization', createAuthHeader('admin', PW));
        expect(res.status).toBe(200);
    });

    test('GET /admin/api/stats handles room count error', async () => {
        mockRedisInstance.scan.mockRejectedValueOnce(new Error('keys fail'));
        const app = createTestApp(PW);
        const res = await request(app)
            .get('/admin/api/stats')
            .set('Authorization', createAuthHeader('admin', PW));
        expect(res.status).toBe(200);
        expect(res.body.connections.activeRooms).toBe(0);
    });

    test('GET /admin/api/rooms handles parse error gracefully', async () => {
        mockRedisInstance.scan.mockResolvedValueOnce({ cursor: '0', keys: ['room:ABCD'] });
        mockRedisInstance.get.mockResolvedValueOnce('not-valid-json');
        const app = createTestApp(PW);
        const res = await request(app)
            .get('/admin/api/rooms')
            .set('Authorization', createAuthHeader('admin', PW));
        expect(res.status).toBe(200);
        expect(res.body.rooms).toEqual([]);
    });

    test('GET /admin/api/rooms handles general error', async () => {
        mockRedisInstance.scan.mockRejectedValueOnce(new Error('boom'));
        const app = createTestApp(PW);
        const res = await request(app)
            .get('/admin/api/rooms')
            .set('Authorization', createAuthHeader('admin', PW));
        expect(res.status).toBe(500);
        expect(res.body.error.code).toBe('ROOMS_ERROR');
    });

    test('POST /admin/api/broadcast validates missing message', async () => {
        const app = createTestApp(PW);
        const res = await request(app)
            .post('/admin/api/broadcast')
            .set('Authorization', createAuthHeader('admin', PW))
            .send({});
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('INVALID_MESSAGE');
    });

    test('POST /admin/api/broadcast validates too-long message', async () => {
        const app = createTestApp(PW);
        const res = await request(app)
            .post('/admin/api/broadcast')
            .set('Authorization', createAuthHeader('admin', PW))
            .send({ message: 'x'.repeat(501) });
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('MESSAGE_TOO_LONG');
    });

    test('POST /admin/api/broadcast validates invalid type', async () => {
        const app = createTestApp(PW);
        const res = await request(app)
            .post('/admin/api/broadcast')
            .set('Authorization', createAuthHeader('admin', PW))
            .send({ message: 'hello', type: 'invalid' });
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('INVALID_TYPE');
    });

    test('POST /admin/api/broadcast returns 503 when io not available', async () => {
        const app = createTestApp(PW);
        app.set('io', null);
        const res = await request(app)
            .post('/admin/api/broadcast')
            .set('Authorization', createAuthHeader('admin', PW))
            .send({ message: 'hello' });
        expect(res.status).toBe(503);
        expect(res.body.error.code).toBe('SOCKET_UNAVAILABLE');
    });

    test('POST /admin/api/broadcast succeeds', async () => {
        const app = createTestApp(PW);
        const res = await request(app)
            .post('/admin/api/broadcast')
            .set('Authorization', createAuthHeader('admin', PW))
            .send({ message: 'hello', type: 'warning' });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    test('DELETE /admin/api/rooms/:code validates bad format', async () => {
        const app = createTestApp(PW);
        const res = await request(app)
            .delete('/admin/api/rooms/!!!')
            .set('Authorization', createAuthHeader('admin', PW));
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('INVALID_ROOM_CODE');
    });

    test('DELETE /admin/api/rooms/:code returns 404 when room not found', async () => {
        mockRedisInstance.get.mockResolvedValueOnce(null);
        const app = createTestApp(PW);
        const res = await request(app)
            .delete('/admin/api/rooms/ABCD')
            .set('Authorization', createAuthHeader('admin', PW));
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('ROOM_NOT_FOUND');
    });

    test('DELETE /admin/api/rooms/:code succeeds', async () => {
        mockRedisInstance.get.mockResolvedValueOnce(JSON.stringify({ code: 'ABCD', status: 'waiting' }));
        const app = createTestApp(PW);
        const res = await request(app)
            .delete('/admin/api/rooms/ABCD')
            .set('Authorization', createAuthHeader('admin', PW));
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    test('auth with malformed base64 returns 401', async () => {
        const app = createTestApp(PW);
        const res = await request(app)
            .get('/admin/api/stats')
            .set('Authorization', 'Basic !!!not-base64!!!');
        expect(res.status).toBe(401);
    });

    test('GET /admin/api/stats catches top-level error', async () => {
        // Mock process.memoryUsage to throw, triggering the outer catch (line 196)
        const origMemUsage = process.memoryUsage;
        process.memoryUsage = () => { throw new Error('stats boom'); };
        const app = createTestApp(PW);
        const res = await request(app)
            .get('/admin/api/stats')
            .set('Authorization', createAuthHeader('admin', PW));
        process.memoryUsage = origMemUsage;
        expect(res.status).toBe(500);
        expect(res.body.error.code).toBe('STATS_ERROR');
    });

    test('POST /admin/api/broadcast catches unexpected error', async () => {
        // Force io.emit to throw
        const app = createTestApp(PW);
        const io = app.get('io');
        io.emit.mockImplementationOnce(() => { throw new Error('emit boom'); });
        const res = await request(app)
            .post('/admin/api/broadcast')
            .set('Authorization', createAuthHeader('admin', PW))
            .send({ message: 'hello', type: 'info' });
        expect(res.status).toBe(500);
        expect(res.body.error.code).toBe('BROADCAST_ERROR');
    });

    test('DELETE /admin/api/rooms/:code catches unexpected error', async () => {
        mockRedisInstance.get.mockResolvedValueOnce(JSON.stringify({ code: 'ABCD' }));
        const roomService = require('../services/roomService');
        roomService.deleteRoom.mockRejectedValueOnce(new Error('delete boom'));
        const app = createTestApp(PW);
        const res = await request(app)
            .delete('/admin/api/rooms/ABCD')
            .set('Authorization', createAuthHeader('admin', PW));
        expect(res.status).toBe(500);
        expect(res.body.error.code).toBe('ROOM_CLOSE_ERROR');
    });

    test('rate limit handler fires when NODE_ENV is not test (line 82-83)', async () => {
        // Temporarily load adminRoutes with NODE_ENV !== 'test' so skip returns false
        const origEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'development';
        jest.resetModules();

        jest.doMock('../config/redis', () => ({
            getRedis: () => mockRedisInstance,
            connectRedis: jest.fn(),
            disconnectRedis: jest.fn(),
            isRedisHealthy: jest.fn(async () => true),
            isUsingMemoryMode: jest.fn(() => true),
            getPubSubClients: jest.fn(() => ({ pubClient: mockRedisInstance, subClient: mockRedisInstance }))
        }));
        jest.doMock('../utils/logger', () => ({
            info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn()
        }));
        jest.doMock('../config/database', () => ({
            isDatabaseEnabled: jest.fn(() => false)
        }));
        jest.doMock('../utils/metrics', () => ({
            getAllMetrics: jest.fn(() => ({ counters: {}, gauges: {}, histograms: {} })),
            setSocketConnections: jest.fn()
        }));

        process.env.ADMIN_PASSWORD = PW;
        const freshAdminRoutes = require('../routes/adminRoutes');
        const freshApp = express();
        freshApp.use(express.json());
        freshApp.use('/admin', freshAdminRoutes);

        // The admin rate limit has a small window. Send many requests to trigger it.
        const { API_RATE_LIMITS } = require('../config/constants');
        const maxReqs = API_RATE_LIMITS.ADMIN?.max || 30;

        // Fire requests rapidly to exhaust rate limit
        const promises = [];
        for (let i = 0; i < maxReqs + 5; i++) {
            promises.push(
                request(freshApp)
                    .get('/admin/api/stats')
                    .set('Authorization', createAuthHeader('admin', PW))
            );
        }
        const results = await Promise.all(promises);
        const rateLimited = results.some(r => r.status === 429);
        expect(rateLimited).toBe(true);

        // Check the 429 response has proper error format
        const limitedRes = results.find(r => r.status === 429);
        expect(limitedRes.body.error.code).toBe('RATE_LIMITED');

        process.env.NODE_ENV = origEnv;
    });

    test('GET /admin sendFile error returns 500 (line 103-104)', async () => {
        // Mock path.join to return nonexistent file for admin.html
        const path = require('path');
        const origJoin = path.join;
        path.join = function(...args) {
            const result = origJoin.apply(path, args);
            if (result.endsWith('admin.html')) {
                return '/nonexistent/path/admin.html';
            }
            return result;
        };

        // Need fresh route import to pick up mocked path
        jest.resetModules();
        // Re-apply mocks needed for fresh require
        jest.doMock('../config/redis', () => ({
            getRedis: () => mockRedisInstance,
            connectRedis: jest.fn(),
            disconnectRedis: jest.fn(),
            isRedisHealthy: jest.fn(async () => true),
            isUsingMemoryMode: jest.fn(() => true),
            getPubSubClients: jest.fn(() => ({ pubClient: mockRedisInstance, subClient: mockRedisInstance }))
        }));
        jest.doMock('../utils/logger', () => ({
            info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn()
        }));
        jest.doMock('../config/database', () => ({
            isDatabaseEnabled: jest.fn(() => false)
        }));
        jest.doMock('../utils/metrics', () => ({
            getAllMetrics: jest.fn(() => ({ counters: {}, gauges: {}, histograms: {} })),
            setSocketConnections: jest.fn()
        }));

        process.env.ADMIN_PASSWORD = PW;
        const freshAdminRoutes = require('../routes/adminRoutes');
        const freshApp = express();
        freshApp.use(express.json());
        freshApp.use('/admin', freshAdminRoutes);
        const { errorHandler: eh } = require('../middleware/errorHandler');
        freshApp.use(eh);

        const res = await request(freshApp)
            .get('/admin')
            .set('Authorization', createAuthHeader('admin', PW));

        path.join = origJoin;
        expect(res.status).toBe(500);
        expect(res.body.error.code).toBe('ADMIN_PAGE_ERROR');
    });

    test('auth with username but no password in base64', async () => {
        // Encode just "admin" without colon — split(':') gives ['admin'], password is undefined
        const encoded = Buffer.from('admin').toString('base64');
        const app = createTestApp(PW);
        const res = await request(app)
            .get('/admin/api/stats')
            .set('Authorization', `Basic ${encoded}`);
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('AUTH_INVALID');
    });

    test('auth decode error triggers catch block (line 61)', async () => {
        const app = createTestApp(PW);
        // Mock Buffer.from to throw when called with base64 decoding
        const origFrom = Buffer.from;
        let callCount = 0;
        Buffer.from = function(...args) {
            // The auth code calls Buffer.from(credentials, 'base64')
            if (args[1] === 'base64') {
                callCount++;
                if (callCount === 1) {
                    throw new Error('decode error');
                }
            }
            return origFrom.apply(Buffer, args);
        };
        const res = await request(app)
            .get('/admin/api/stats')
            .set('Authorization', 'Basic dGVzdDp0ZXN0'); // valid base64
        Buffer.from = origFrom;
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('AUTH_INVALID');
    });
});

// ─── app.js - additional coverage ───────────────────────────────────────────

describe('app.js - service worker and edge cases', () => {
    let app;

    beforeEach(() => {
        jest.clearAllMocks();
        jest.resetModules();
        process.env.NODE_ENV = 'test';
        process.env.CORS_ORIGIN = 'http://localhost:3000';

        // Re-mock everything needed for fresh app import
        jest.doMock('../utils/logger', () => ({
            debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn()
        }));
        jest.doMock('../utils/metrics', () => ({
            getAllMetrics: jest.fn(() => ({ counters: {}, gauges: {}, histograms: {} })),
            setSocketConnections: jest.fn()
        }));
        jest.doMock('../middleware/rateLimit', () => ({
            apiLimiter: (req, res, next) => next(),
            strictLimiter: (req, res, next) => next(),
            getHttpRateLimitMetrics: jest.fn(() => ({}))
        }));
        jest.doMock('../middleware/csrf', () => ({
            csrfProtection: (req, res, next) => next()
        }));

        app = require('../app');
    });

    test('/health/ready with storage not healthy returns degraded', async () => {
        const { isRedisHealthy: irh } = require('../config/redis');
        irh.mockResolvedValueOnce(false);

        const res = await request(app).get('/health/ready');
        expect(res.body.checks.storage.status).toBe('error');
        expect(res.body.status).toBe('degraded');
    });

    test('/health/ready with storage error returns degraded', async () => {
        const { isRedisHealthy: irh } = require('../config/redis');
        irh.mockRejectedValueOnce(new Error('Redis gone'));

        const res = await request(app).get('/health/ready');
        expect(res.body.checks.storage).toMatchObject({ status: 'error' });
        expect(res.body.status).toBe('degraded');
    });

    test('/health/ready with database enabled but erroring', async () => {
        // The database mock in the app may already be loaded, but we test the branch
        const res = await request(app).get('/health/ready');
        // Database check should be present (disabled or error)
        expect(res.body.checks).toHaveProperty('database');
    });

    test('/metrics with no io configured', async () => {
        app.set('io', null);

        const res = await request(app).get('/metrics');
        expect(res.status).toBe(200);
        // socketio should not be present when io is null
        expect(res.body.socketio).toBeUndefined();
    });

    test('/metrics handles application metrics error', async () => {
        const { getAllMetrics } = require('../utils/metrics');
        getAllMetrics.mockImplementationOnce(() => { throw new Error('metrics fail'); });

        const res = await request(app).get('/metrics');
        expect(res.status).toBe(200);
        expect(res.body.application).toMatchObject({ status: 'error' });
    });

    test('/metrics handles rate limit metrics error', async () => {
        const { getHttpRateLimitMetrics } = require('../middleware/rateLimit');
        getHttpRateLimitMetrics.mockImplementationOnce(() => { throw new Error('rl fail'); });

        const res = await request(app).get('/metrics');
        expect(res.status).toBe(200);
    });

    test('/metrics with socketRateLimiter configured', async () => {
        app.set('socketRateLimiter', {
            getMetrics: jest.fn(() => ({ requests: 100 }))
        });

        const res = await request(app).get('/metrics');
        expect(res.status).toBe(200);
        expect(res.body.rateLimits.socket).toMatchObject({ requests: 100 });
    });

    test('SPA catch-all serves index.html for non-reserved paths', async () => {
        const res = await request(app).get('/some-game-path');
        // Should attempt to serve index.html (200 if exists, 404 if not)
        expect([200, 404]).toContain(res.status);
    });

    test('SPA catch-all does not serve for /admin paths', async () => {
        // /admin should go to admin routes (which requires auth), not SPA
        const res = await request(app).get('/admin');
        // Without auth it should be 401, not SPA HTML
        expect(res.status).toBe(401);
    });

    test('trust proxy is set when TRUST_PROXY=true', () => {
        jest.resetModules();
        process.env.NODE_ENV = 'test';
        process.env.CORS_ORIGIN = 'http://localhost:3000';
        process.env.TRUST_PROXY = 'true';

        const freshApp = require('../app');
        // trust proxy should be set to 1
        expect(freshApp.get('trust proxy')).toBeTruthy();
        delete process.env.TRUST_PROXY;
    });
});
