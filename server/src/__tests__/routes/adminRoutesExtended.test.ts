/**
 * Extended Admin Routes Tests
 *
 * Tests for routes/adminRoutes.js - covers room details, player kick, and room deletion.
 */

const express = require('express');
const request = require('supertest');

// Mock dependencies
jest.mock('../../utils/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
}));

// Mock metrics
jest.mock('../../utils/metrics', () => ({
    incrementCounter: jest.fn(),
    setGauge: jest.fn(),
    getAllMetrics: jest.fn(() => ({ counters: {}, gauges: {}, histograms: {} })),
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

// Mock audit service
jest.mock('../../services/auditService', () => ({
    audit: {
        adminLogin: jest.fn(),
        adminAction: jest.fn(),
        adminKickPlayer: jest.fn(),
        adminDeleteRoom: jest.fn()
    }
}));

// Mock Redis
const mockRedisStorage = new Map();
const mockRedisSets = new Map();
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
    sMembers: jest.fn(async (key) => {
        const members = mockRedisSets.get(key);
        return members ? Array.from(members) : [];
    }),
    sIsMember: jest.fn(async (key, member) => {
        const members = mockRedisSets.get(key);
        return members && members.has(member);
    }),
    sRem: jest.fn(async (key, member) => {
        const members = mockRedisSets.get(key);
        if (members) {
            return members.delete(member) ? 1 : 0;
        }
        return 0;
    }),
    sCard: jest.fn(async (key) => {
        const members = mockRedisSets.get(key);
        return members ? members.size : 0;
    }),
    keys: jest.fn(async () => []),
    scan: jest.fn(async () => ({ cursor: '0', keys: [] })),
    scanIterator: jest.fn(() => ({
        [Symbol.asyncIterator]: async function* () {
            // Empty iterator
        }
    }))
};

jest.mock('../../config/redis', () => ({
    getRedis: jest.fn(() => mockRedis),
    isUsingMemoryMode: jest.fn(() => true),
    isRedisHealthy: jest.fn(async () => true)
}));

// Mock rate limiter
jest.mock('../../middleware/rateLimit', () => ({
    apiLimiter: (req, res, next) => next(),
    strictLimiter: (req, res, next) => next()
}));

// Mock player service
jest.mock('../../services/playerService', () => ({
    removePlayer: jest.fn(async () => {})
}));

// Mock room service
jest.mock('../../services/roomService', () => ({
    deleteRoom: jest.fn(async () => {}),
    getRoom: jest.fn(async () => null),
    cleanupRoom: jest.fn(async () => {})
}));

// Import after mocks
const adminRoutes = require('../../routes/adminRoutes');
const { errorHandler } = require('../../middleware/errorHandler');
const { audit } = require('../../services/auditService');
const { incrementCounter, METRIC_NAMES } = require('../../utils/metrics');

// Test password
const TEST_PASSWORD = 'test-admin-password';

// Helper to create auth header
function createAuthHeader(username, password) {
    const credentials = Buffer.from(`${username}:${password}`).toString('base64');
    return `Basic ${credentials}`;
}

describe('Admin Routes Extended Tests', () => {
    let app;
    let mockIo;

    beforeEach(() => {
        jest.clearAllMocks();
        mockRedisStorage.clear();
        mockRedisSets.clear();

        // Set admin password
        process.env.ADMIN_PASSWORD = TEST_PASSWORD;

        // Setup mock Socket.io
        mockIo = {
            to: jest.fn().mockReturnThis(),
            in: jest.fn().mockReturnValue({ socketsLeave: jest.fn() }),
            emit: jest.fn(),
            fetchSockets: jest.fn(async () => [])
        };

        // Create Express app with admin routes
        app = express();
        app.use(express.json());
        app.set('io', mockIo);
        app.use('/admin', adminRoutes);
        app.use(errorHandler);
    });

    afterEach(() => {
        delete process.env.ADMIN_PASSWORD;
    });

    describe('GET /admin/api/rooms/:code/details', () => {
        const validRoomCode = 'TESTROOM';

        beforeEach(() => {
            // Setup mock room data
            const roomData = JSON.stringify({
                code: validRoomCode,
                status: 'waiting',
                hostSessionId: 'host-session-123',
                settings: { turnTimer: 60, maxPlayers: 8 },
                createdAt: Date.now()
            });
            mockRedisStorage.set(`room:${validRoomCode.toLowerCase()}`, roomData);

            // Setup mock players set
            const players = new Set(['host-session-123', 'player-session-456']);
            mockRedisSets.set(`room:${validRoomCode.toLowerCase()}:players`, players);

            // Setup player data
            mockRedisStorage.set('player:host-session-123', JSON.stringify({
                nickname: 'HostPlayer',
                team: 'red',
                role: 'spymaster',
                joinedAt: Date.now() - 10000
            }));
            mockRedisStorage.set('player:player-session-456', JSON.stringify({
                nickname: 'Player2',
                team: 'blue',
                role: 'operative',
                joinedAt: Date.now()
            }));
        });

        it('should return room details with players', async () => {
            const response = await request(app)
                .get(`/admin/api/rooms/${validRoomCode}/details`)
                .set('Authorization', createAuthHeader('admin', TEST_PASSWORD))
                .expect(200);

            expect(response.body.code).toBe(validRoomCode);
            expect(response.body.status).toBe('waiting');
            expect(response.body.players).toBeDefined();
            expect(response.body.players.length).toBe(2);

            // Host should be first
            expect(response.body.players[0].isHost).toBe(true);
            expect(response.body.players[0].nickname).toBe('HostPlayer');
        });

        it('should return 400 for invalid room code format', async () => {
            const response = await request(app)
                .get('/admin/api/rooms/ab/details')  // Too short
                .set('Authorization', createAuthHeader('admin', TEST_PASSWORD))
                .expect(400);

            expect(response.body.error.code).toBe('INVALID_ROOM_CODE');
        });

        it('should return 404 for non-existent room', async () => {
            const response = await request(app)
                .get('/admin/api/rooms/NONEXISTENT/details')
                .set('Authorization', createAuthHeader('admin', TEST_PASSWORD))
                .expect(404);

            expect(response.body.error.code).toBe('ROOM_NOT_FOUND');
        });

        it('should handle player data parse errors gracefully', async () => {
            // Add invalid player data
            const players = new Set(['host-session-123', 'bad-player']);
            mockRedisSets.set(`room:${validRoomCode.toLowerCase()}:players`, players);
            mockRedisStorage.set('player:bad-player', 'not valid json');

            const response = await request(app)
                .get(`/admin/api/rooms/${validRoomCode}/details`)
                .set('Authorization', createAuthHeader('admin', TEST_PASSWORD))
                .expect(200);

            // Should still return valid players
            expect(response.body.players.length).toBe(1);
        });

        it('should sort players with host first', async () => {
            const response = await request(app)
                .get(`/admin/api/rooms/${validRoomCode}/details`)
                .set('Authorization', createAuthHeader('admin', TEST_PASSWORD))
                .expect(200);

            expect(response.body.players[0].isHost).toBe(true);
        });
    });

    describe('DELETE /admin/api/rooms/:code/players/:playerId', () => {
        const roomCode = 'KICKTEST';
        const hostId = 'host-123';
        const playerId = 'player-456';

        beforeEach(() => {
            // Setup room
            mockRedisStorage.set(`room:${roomCode.toLowerCase()}`, JSON.stringify({
                code: roomCode,
                hostSessionId: hostId,
                status: 'playing'
            }));

            // Setup players set
            const players = new Set([hostId, playerId]);
            mockRedisSets.set(`room:${roomCode.toLowerCase()}:players`, players);

            // Setup player data
            mockRedisStorage.set(`player:${playerId}`, JSON.stringify({
                nickname: 'KickMe',
                team: 'red'
            }));
        });

        it('should kick player successfully', async () => {
            const { removePlayer } = require('../../services/playerService');

            const response = await request(app)
                .delete(`/admin/api/rooms/${roomCode}/players/${playerId}`)
                .set('Authorization', createAuthHeader('admin', TEST_PASSWORD))
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.message).toContain('kicked');

            // Verify socket.io notifications
            expect(mockIo.to).toHaveBeenCalledWith(`player:${playerId}`);
            expect(mockIo.emit).toHaveBeenCalledWith('room:kicked', expect.any(Object));

            // Verify player's socket forced to leave the room
            expect(mockIo.in).toHaveBeenCalledWith(`player:${playerId}`);
            expect(mockIo.in(`player:${playerId}`).socketsLeave).toHaveBeenCalledWith(`room:${roomCode.toLowerCase()}`);

            // Verify proper cleanup via playerService
            expect(removePlayer).toHaveBeenCalledWith(playerId);

            // Verify metrics and audit
            expect(incrementCounter).toHaveBeenCalledWith(METRIC_NAMES.PLAYER_KICKS, 1, { roomCode: roomCode.toLowerCase(), reason: 'admin' });
            expect(audit.adminKickPlayer).toHaveBeenCalled();
        });

        it('should return 400 for invalid room code', async () => {
            const response = await request(app)
                .delete('/admin/api/rooms/ab/players/player-123')
                .set('Authorization', createAuthHeader('admin', TEST_PASSWORD))
                .expect(400);

            expect(response.body.error.code).toBe('INVALID_ROOM_CODE');
        });

        it('should return 400 for invalid player ID', async () => {
            const response = await request(app)
                .delete(`/admin/api/rooms/${roomCode}/players/${'a'.repeat(101)}`)
                .set('Authorization', createAuthHeader('admin', TEST_PASSWORD))
                .expect(400);

            expect(response.body.error.code).toBe('INVALID_PLAYER_ID');
        });

        it('should return 404 for non-existent room', async () => {
            const response = await request(app)
                .delete('/admin/api/rooms/NOROOM/players/player-123')
                .set('Authorization', createAuthHeader('admin', TEST_PASSWORD))
                .expect(404);

            expect(response.body.error.code).toBe('ROOM_NOT_FOUND');
        });

        it('should return 400 when trying to kick host', async () => {
            const response = await request(app)
                .delete(`/admin/api/rooms/${roomCode}/players/${hostId}`)
                .set('Authorization', createAuthHeader('admin', TEST_PASSWORD))
                .expect(400);

            expect(response.body.error.code).toBe('CANNOT_KICK_HOST');
        });

        it('should return 404 for player not in room', async () => {
            const response = await request(app)
                .delete(`/admin/api/rooms/${roomCode}/players/not-in-room`)
                .set('Authorization', createAuthHeader('admin', TEST_PASSWORD))
                .expect(404);

            expect(response.body.error.code).toBe('PLAYER_NOT_FOUND');
        });

        it('should handle missing io gracefully', async () => {
            app.set('io', null);

            const response = await request(app)
                .delete(`/admin/api/rooms/${roomCode}/players/${playerId}`)
                .set('Authorization', createAuthHeader('admin', TEST_PASSWORD))
                .expect(200);

            expect(response.body.success).toBe(true);
        });
    });

    describe('DELETE /admin/api/rooms/:code', () => {
        const roomCode = 'DELETEROOM';

        beforeEach(() => {
            // Setup room
            mockRedisStorage.set(`room:${roomCode.toLowerCase()}`, JSON.stringify({
                code: roomCode,
                hostSessionId: 'host-123',
                status: 'waiting'
            }));

            // Setup players
            const players = new Set(['host-123', 'player-456']);
            mockRedisSets.set(`room:${roomCode.toLowerCase()}:players`, players);

            // Setup game data
            mockRedisStorage.set(`game:${roomCode.toLowerCase()}`, JSON.stringify({
                gameOver: false
            }));
        });

        it('should delete room successfully', async () => {
            const response = await request(app)
                .delete(`/admin/api/rooms/${roomCode}`)
                .set('Authorization', createAuthHeader('admin', TEST_PASSWORD))
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.message).toContain('closed');

            // Verify socket.io notification
            expect(mockIo.to).toHaveBeenCalledWith(`room:${roomCode.toLowerCase()}`);
            expect(mockIo.emit).toHaveBeenCalledWith('room:forceClosed', expect.any(Object));

            // Verify audit
            expect(audit.adminDeleteRoom).toHaveBeenCalled();
        });

        it('should return 400 for invalid room code format', async () => {
            const response = await request(app)
                .delete('/admin/api/rooms/ab')
                .set('Authorization', createAuthHeader('admin', TEST_PASSWORD))
                .expect(400);

            expect(response.body.error.code).toBe('INVALID_ROOM_CODE');
        });

        it('should return 404 for non-existent room', async () => {
            const response = await request(app)
                .delete('/admin/api/rooms/NOTEXIST')
                .set('Authorization', createAuthHeader('admin', TEST_PASSWORD))
                .expect(404);

            expect(response.body.error.code).toBe('ROOM_NOT_FOUND');
        });

        it('should handle missing io gracefully', async () => {
            app.set('io', null);

            const response = await request(app)
                .delete(`/admin/api/rooms/${roomCode}`)
                .set('Authorization', createAuthHeader('admin', TEST_PASSWORD))
                .expect(200);

            expect(response.body.success).toBe(true);
        });

        it('should clean up all room-related keys', async () => {
            const roomService = require('../../services/roomService');

            await request(app)
                .delete(`/admin/api/rooms/${roomCode}`)
                .set('Authorization', createAuthHeader('admin', TEST_PASSWORD))
                .expect(200);

            // Verify roomService.deleteRoom was called to clean up
            expect(roomService.deleteRoom).toHaveBeenCalledWith(roomCode.toLowerCase());
        });
    });

    describe('Error handling', () => {
        it('should handle Redis errors in room details', async () => {
            mockRedis.get.mockRejectedValueOnce(new Error('Redis connection failed'));

            const response = await request(app)
                .get('/admin/api/rooms/TESTROOM/details')
                .set('Authorization', createAuthHeader('admin', TEST_PASSWORD))
                .expect(500);

            expect(response.body.error.code).toBe('ROOM_DETAILS_ERROR');
        });

        it('should handle Redis errors in player kick', async () => {
            mockRedisStorage.set('room:testroom', JSON.stringify({ code: 'TESTROOM', hostSessionId: 'host' }));
            mockRedis.sIsMember.mockRejectedValueOnce(new Error('Redis error'));

            const response = await request(app)
                .delete('/admin/api/rooms/TESTROOM/players/player-123')
                .set('Authorization', createAuthHeader('admin', TEST_PASSWORD))
                .expect(500);

            expect(response.body.error.code).toBe('KICK_ERROR');
        });

        it('should handle errors in room deletion', async () => {
            mockRedisStorage.set('room:testroom', JSON.stringify({ code: 'TESTROOM' }));

            // Make roomService.deleteRoom throw
            const roomService = require('../../services/roomService');
            roomService.deleteRoom.mockRejectedValueOnce(new Error('Delete failed'));

            const response = await request(app)
                .delete('/admin/api/rooms/TESTROOM')
                .set('Authorization', createAuthHeader('admin', TEST_PASSWORD))
                .expect(500);

            expect(response.body.error.code).toBe('ROOM_CLOSE_ERROR');
        });
    });
});
