/**
 * Player Handlers Edge Case Tests
 *
 * Tests for uncovered branches in playerHandlers.js to reach 80% coverage
 * Focuses on team switching restrictions, game state checks, and error paths
 */

const http = require('http');
const { Server } = require('socket.io');
const Client = require('socket.io-client');
const { v4: uuidv4 } = require('uuid');

// Test configuration
const TEST_PORT = 3200 + Math.floor(Math.random() * 50);
const SOCKET_URL = `http://localhost:${TEST_PORT}`;
const CONNECTION_TIMEOUT = 5000;

// Mock Redis storage
const mockRedisStorage = new Map();
const mockRedisSets = new Map();

// Setup mocks before importing services
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
            exec: jest.fn(async () => [[null, 'OK']])
        })),
        eval: jest.fn(async (script, options) => {
            // Simulate atomic room creation script
            if (script.includes('SETNX')) {
                const roomKey = options.keys[0];
                const playersKey = options.keys[1];
                const roomData = options.arguments[0];

                if (mockRedisStorage.has(roomKey)) {
                    return 0;
                }

                mockRedisStorage.set(roomKey, roomData);
                mockRedisSets.set(playersKey, new Set());
                return 1;
            }

            // Simulate atomic join script
            if (script.includes('SISMEMBER') && script.includes('SCARD')) {
                const playersKey = options.keys[0];
                const maxPlayers = parseInt(options.arguments[0]);
                const sessionId = options.arguments[1];

                if (!mockRedisSets.has(playersKey)) {
                    mockRedisSets.set(playersKey, new Set());
                }

                const set = mockRedisSets.get(playersKey);

                if (set.has(sessionId)) return -1;
                if (set.size >= maxPlayers) return 0;

                set.add(sessionId);

                // Sprint D1: Also create player data atomically
                const playerData = options.arguments[2];
                const playerKey = options.arguments[3];
                if (playerData && playerKey) {
                    mockRedisStorage.set(playerKey, playerData);
                }

                return 1;
            }

            // Simulate atomic team change script
            if (script.includes('cjson.decode') && script.includes('team')) {
                const playerKey = options.keys[0];
                const newTeam = options.arguments[0];

                const playerData = mockRedisStorage.get(playerKey);
                if (!playerData) return null;

                const player = JSON.parse(playerData);
                const oldTeam = player.team;
                const oldRole = player.role;

                player.team = newTeam === '__NULL__' ? null : newTeam;
                player.lastSeen = Date.now();

                if (oldTeam !== newTeam && (oldRole === 'spymaster' || oldRole === 'clicker')) {
                    player.role = 'spectator';
                }

                mockRedisStorage.set(playerKey, JSON.stringify(player));
                return JSON.stringify(player);
            }

            return null;
        }),
        publish: jest.fn(async () => 0),
        duplicate: jest.fn(function() { return this; })
    };

    return {
        getRedis: () => mockRedis,
        getPubSubClients: () => ({ pubClient: mockRedis, subClient: mockRedis }),
        isUsingMemoryMode: () => true
    };
});

// Mock logger
jest.mock('../../utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));

// Mock timer service
jest.mock('../../services/timerService', () => ({
    startTimer: jest.fn(async () => ({ durationSeconds: 120, endTime: Date.now() + 120000 })),
    stopTimer: jest.fn(async () => {}),
    getTimerStatus: jest.fn(async () => null)
}));

// Import after mocks
const { createSocketRateLimiter } = require('../../middleware/rateLimit');
const { RATE_LIMITS, ERROR_CODES } = require('../../config/constants');
const roomHandlers = require('../../socket/handlers/roomHandlers');
const gameHandlers = require('../../socket/handlers/gameHandlers');
const playerHandlers = require('../../socket/handlers/playerHandlers');

describe('Player Handlers Edge Cases', () => {
    let httpServer;
    let io;
    let socketRateLimiter;

    // Helper to create connected client
    async function createClient(sessionId = uuidv4()) {
        return new Promise((resolve, reject) => {
            const client = Client(SOCKET_URL, {
                transports: ['websocket'],
                timeout: CONNECTION_TIMEOUT,
                reconnection: false,
                auth: { sessionId }
            });

            const timeout = setTimeout(() => {
                client.disconnect();
                reject(new Error('Connection timeout'));
            }, CONNECTION_TIMEOUT);

            client.on('connect', () => {
                clearTimeout(timeout);
                client.sessionId = sessionId;
                resolve(client);
            });

            client.on('connect_error', (err) => {
                clearTimeout(timeout);
                reject(err);
            });
        });
    }

    // Helper to wait for event with error fallback
    function waitForEvent(client, event, timeout = 5000) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${event}`)), timeout);
            client.once(event, (data) => {
                clearTimeout(timer);
                resolve(data);
            });
        });
    }

    beforeAll((done) => {
        httpServer = http.createServer();
        io = new Server(httpServer, {
            cors: { origin: '*' },
            transports: ['websocket', 'polling']
        });

        socketRateLimiter = createSocketRateLimiter(RATE_LIMITS);

        io.on('connection', (socket) => {
            socket.sessionId = socket.handshake.auth?.sessionId || uuidv4();
            socket.rateLimiter = socketRateLimiter;

            roomHandlers(io, socket);
            gameHandlers(io, socket);
            playerHandlers(io, socket);

            socket.on('disconnect', () => {
                socketRateLimiter.cleanupSocket(socket.id);
            });
        });

        httpServer.listen(TEST_PORT, done);
    });

    afterAll((done) => {
        io.close();
        httpServer.close(done);
    });

    beforeEach(() => {
        mockRedisStorage.clear();
        mockRedisSets.clear();
        jest.clearAllMocks();
    });

    // Note: Team switching during active turn and empty-team-prevention tests
    // require complex game state mocks. These behaviors are covered by unit tests
    // in playerService.test.ts and playerHandlersUnit.test.ts.

    describe('player:setRole - Room Context Validation', () => {
        test('setRole returns error when not in a room', async () => {
            const client = await createClient();

            try {
                const errorPromise = waitForEvent(client, 'player:error');
                client.emit('player:setRole', { role: 'clicker' });

                const error = await errorPromise;
                expect(error.code).toBe(ERROR_CODES.ROOM_NOT_FOUND);
            } finally {
                client.disconnect();
            }
        });
    });

    describe('player:setNickname - Room Context Validation', () => {
        test('setNickname returns error when not in a room', async () => {
            const client = await createClient();

            try {
                const errorPromise = waitForEvent(client, 'player:error');
                client.emit('player:setNickname', { nickname: 'NewName' });

                const error = await errorPromise;
                expect(error.code).toBe(ERROR_CODES.ROOM_NOT_FOUND);
            } finally {
                client.disconnect();
            }
        });
    });

    // Note: Spymaster view during active game test requires full game state mock.
    // This behavior is covered by unit tests in playerHandlersUnit.test.ts.

    describe('player:setRole - Error Handling', () => {
        test('handles setRole error gracefully', async () => {
            const client = await createClient();

            try {
                // Create room
                const createPromise = waitForEvent(client, 'room:created');
                client.emit('room:create', { roomId: 'edge-test' });
                await createPromise;

                // Try to set invalid role (validation error)
                const errorPromise = waitForEvent(client, 'player:error');
                client.emit('player:setRole', { role: 'invalidRole' });

                const error = await errorPromise;
                expect(error.code).toBe(ERROR_CODES.INVALID_INPUT);
            } finally {
                client.disconnect();
            }
        });
    });

    describe('player:setNickname - Error Handling', () => {
        test('handles empty nickname validation', async () => {
            const client = await createClient();

            try {
                // Create room
                const createPromise = waitForEvent(client, 'room:created');
                client.emit('room:create', { roomId: 'edge-test' });
                await createPromise;

                // Try to set empty nickname
                const errorPromise = waitForEvent(client, 'player:error');
                client.emit('player:setNickname', { nickname: '' });

                const error = await errorPromise;
                expect(error.code).toBe(ERROR_CODES.INVALID_INPUT);
            } finally {
                client.disconnect();
            }
        });

        test('handles very long nickname validation', async () => {
            const client = await createClient();

            try {
                // Create room
                const createPromise = waitForEvent(client, 'room:created');
                client.emit('room:create', { roomId: 'edge-test' });
                await createPromise;

                // Try to set overly long nickname
                const errorPromise = waitForEvent(client, 'player:error');
                client.emit('player:setNickname', { nickname: 'A'.repeat(100) });

                const error = await errorPromise;
                expect(error.code).toBe(ERROR_CODES.INVALID_INPUT);
            } finally {
                client.disconnect();
            }
        });
    });
});
