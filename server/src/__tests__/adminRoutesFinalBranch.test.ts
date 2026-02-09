/**
 * Admin Routes Final Branch Coverage Tests
 * Targets uncovered lines: 443-449, 515, 546-552, 671-677
 *
 * Lines 443-449: GET /admin/api/rooms/:code/details - invalid room code format
 * Line 515: room details - player sort by host first and join time
 * Lines 546-552: DELETE /admin/api/rooms/:code/players/:playerId - invalid room code format
 * Lines 671-677: DELETE /admin/api/rooms/:code - invalid room code format
 */

const request = require('supertest');
const express = require('express');

// Mock Redis storage
const mockRedisStorageAR = new Map<string, any>();
const mockRedisSetsAR = new Map<string, Set<string>>();

jest.mock('../config/redis', () => {
    const mockRedis = {
        get: jest.fn(async (key: string) => mockRedisStorageAR.get(key) || null),
        set: jest.fn(async (key: string, value: string) => {
            mockRedisStorageAR.set(key, value);
            return 'OK';
        }),
        del: jest.fn(async (key: string) => {
            if (Array.isArray(key)) {
                let deleted = 0;
                key.forEach((k: string) => { if (mockRedisStorageAR.delete(k)) deleted++; });
                return deleted;
            }
            return mockRedisStorageAR.delete(key) ? 1 : 0;
        }),
        scan: jest.fn(async () => ({ cursor: '0', keys: [] })),
        expire: jest.fn(async () => 1),
        sMembers: jest.fn(async (key: string) => {
            const set = mockRedisSetsAR.get(key);
            return set ? [...set] : [];
        }),
        sIsMember: jest.fn(async (key: string, value: string) => {
            const set = mockRedisSetsAR.get(key);
            return set ? set.has(value) : false;
        }),
        sRem: jest.fn(async () => 1),
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

jest.mock('../utils/logger', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn()
}));

jest.mock('../utils/metrics', () => ({
    getAllMetrics: jest.fn(() => ({
        timestamp: Date.now(), instanceId: 'test',
        counters: {}, gauges: {}, histograms: {}
    })),
    setSocketConnections: jest.fn(),
    trackBroadcast: jest.fn(),
    trackPlayerKick: jest.fn()
}));

jest.mock('../services/roomService', () => ({
    deleteRoom: jest.fn(async () => {}),
    getRoom: jest.fn(async () => null),
    cleanupRoom: jest.fn(async () => {})
}));

jest.mock('../services/auditService', () => ({
    audit: {
        adminLogin: jest.fn(),
        adminDeleteRoom: jest.fn(),
        adminKickPlayer: jest.fn()
    },
    getAuditLogs: jest.fn(async () => []),
    getAuditSummary: jest.fn(async () => ({}))
}));

const adminRoutes = require('../routes/adminRoutes');

function createAuthHeaderAR(username: string, password: string): string {
    const credentials = Buffer.from(`${username}:${password}`).toString('base64');
    return `Basic ${credentials}`;
}

function createTestAppAR(adminPassword: string | null = null) {
    if (adminPassword) {
        process.env.ADMIN_PASSWORD = adminPassword;
    } else {
        delete process.env.ADMIN_PASSWORD;
    }

    const app = express();
    app.use(express.json());

    const mockIO = {
        fetchSockets: jest.fn(async () => []),
        emit: jest.fn(),
        to: jest.fn(() => ({ emit: jest.fn() }))
    };
    app.set('io', mockIO);

    app.use('/admin', adminRoutes);
    return app;
}

describe('Admin Routes Final Branch Coverage', () => {
    const PASS = 'admin-test-pass';

    beforeEach(() => {
        mockRedisStorageAR.clear();
        mockRedisSetsAR.clear();
        jest.clearAllMocks();
    });

    afterEach(() => {
        delete process.env.ADMIN_PASSWORD;
    });

    describe('Lines 443-449: GET /admin/api/rooms/:code/details - invalid room code', () => {
        it('should return 400 for short room code (regex fails)', async () => {
            const app = createTestAppAR(PASS);

            const response = await request(app)
                .get('/admin/api/rooms/ab/details')
                .set('Authorization', createAuthHeaderAR('admin', PASS))
                .expect(400);

            expect(response.body.error.code).toBe('INVALID_ROOM_CODE');
            expect(response.body.error.message).toBe('Invalid room code format');
        });

        it('should return 400 for room code that is too long', async () => {
            const app = createTestAppAR(PASS);
            const longCode = 'A'.repeat(21); // 21 chars, max is 20

            const response = await request(app)
                .get(`/admin/api/rooms/${longCode}/details`)
                .set('Authorization', createAuthHeaderAR('admin', PASS))
                .expect(400);

            expect(response.body.error.code).toBe('INVALID_ROOM_CODE');
        });
    });

    describe('Line 515: room details player sort (host first, then join time)', () => {
        it('should sort players with host first, then by join time', async () => {
            const app = createTestAppAR(PASS);

            const room = {
                code: 'sorttest',
                status: 'playing',
                hostId: 'player-2',
                createdAt: Date.now(),
                settings: {}
            };
            mockRedisStorageAR.set('room:sorttest', JSON.stringify(room));
            mockRedisSetsAR.set('room:sorttest:players', new Set(['player-1', 'player-2', 'player-3']));

            mockRedisStorageAR.set('player:player-1', JSON.stringify({
                nickname: 'Alice', team: 'red', role: 'spymaster', joinedAt: 1000
            }));
            mockRedisStorageAR.set('player:player-2', JSON.stringify({
                nickname: 'Bob', team: 'blue', role: 'clicker', joinedAt: 2000
            }));
            mockRedisStorageAR.set('player:player-3', JSON.stringify({
                nickname: 'Carol', team: null, role: 'spectator', joinedAt: 500
            }));

            const response = await request(app)
                .get('/admin/api/rooms/SORTTEST/details')
                .set('Authorization', createAuthHeaderAR('admin', PASS))
                .expect(200);

            const players = response.body.players;
            expect(players).toHaveLength(3);
            // Host (player-2) should be first
            expect(players[0].isHost).toBe(true);
            expect(players[0].nickname).toBe('Bob');
            // Then sorted by joinedAt
            expect(players[1].nickname).toBe('Carol'); // joinedAt: 500
            expect(players[2].nickname).toBe('Alice'); // joinedAt: 1000
        });
    });

    describe('Lines 546-552: DELETE player - invalid room code format', () => {
        it('should return 400 for short room code', async () => {
            const app = createTestAppAR(PASS);

            const response = await request(app)
                .delete('/admin/api/rooms/ab/players/player-1')
                .set('Authorization', createAuthHeaderAR('admin', PASS))
                .expect(400);

            expect(response.body.error.code).toBe('INVALID_ROOM_CODE');
            expect(response.body.error.message).toBe('Invalid room code format');
        });

        it('should return 400 for overly long player ID', async () => {
            const app = createTestAppAR(PASS);

            const longId = 'a'.repeat(101);
            const response = await request(app)
                .delete(`/admin/api/rooms/VALID1/players/${longId}`)
                .set('Authorization', createAuthHeaderAR('admin', PASS))
                .expect(400);

            expect(response.body.error.code).toBe('INVALID_PLAYER_ID');
        });
    });

    describe('Lines 671-677: DELETE room - invalid room code format', () => {
        it('should return 400 for short room code', async () => {
            const app = createTestAppAR(PASS);

            const response = await request(app)
                .delete('/admin/api/rooms/ab')
                .set('Authorization', createAuthHeaderAR('admin', PASS))
                .expect(400);

            expect(response.body.error.code).toBe('INVALID_ROOM_CODE');
            expect(response.body.error.message).toBe('Invalid room code format');
        });

        it('should return 400 for room code with invalid chars', async () => {
            const app = createTestAppAR(PASS);

            const response = await request(app)
                .delete('/admin/api/rooms/$$$')
                .set('Authorization', createAuthHeaderAR('admin', PASS))
                .expect(400);

            expect(response.body.error.code).toBe('INVALID_ROOM_CODE');
        });

        it('should return 404 for valid but non-existent room code', async () => {
            const app = createTestAppAR(PASS);

            const response = await request(app)
                .delete('/admin/api/rooms/NOEXIST')
                .set('Authorization', createAuthHeaderAR('admin', PASS))
                .expect(404);

            expect(response.body.error.code).toBe('ROOM_NOT_FOUND');
        });
    });
});
