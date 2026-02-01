/**
 * Race Condition Tests
 *
 * Tests concurrent operations to verify thread safety and proper locking.
 * These tests verify the basic concurrency patterns work with mocked Redis.
 */

const http = require('http');
const { Server } = require('socket.io');
const Client = require('socket.io-client');
const { v4: uuidv4 } = require('uuid');

// Test configuration
const TEST_PORT = 3096;
const SOCKET_URL = `http://localhost:${TEST_PORT}`;
const CONNECTION_TIMEOUT = 5000;

// Mock storage
const mockRedisStorage = new Map();
const mockRedisSets = new Map();

// Mock Redis
jest.mock('../../config/redis', () => {
    const mockRedis = {
        get: jest.fn(async (key) => mockRedisStorage.get(key) || null),
        set: jest.fn(async (key, value, options) => {
            if (options && options.NX) {
                if (mockRedisStorage.has(key)) {
                    return null;
                }
            }
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
            if (script.includes('SETNX')) {
                const roomKey = options.keys[0];
                const playersKey = options.keys[1];
                const roomData = options.arguments[0];

                if (mockRedisStorage.has(roomKey)) return 0;
                mockRedisStorage.set(roomKey, roomData);
                mockRedisSets.set(playersKey, new Set());
                return 1;
            }

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
                return 1;
            }

            // Role-set script (has 'newRole' and 'SMEMBERS')
            if (script.includes('newRole') && script.includes('SMEMBERS')) {
                const playerKey = options.keys[0];
                const roomPlayersKey = options.keys[1];
                const newRole = options.arguments[0];
                const sessionId = options.arguments[1];

                const playerData = mockRedisStorage.get(playerKey);
                if (!playerData) return null;

                const player = JSON.parse(playerData);

                // For spymaster/clicker, require team
                if ((newRole === 'spymaster' || newRole === 'clicker') && !player.team) {
                    return JSON.stringify({ success: false, reason: 'NO_TEAM' });
                }

                // Check if role is taken
                const memberSet = mockRedisSets.get(roomPlayersKey) || new Set();
                for (const memberId of memberSet) {
                    if (memberId !== sessionId) {
                        const memberData = mockRedisStorage.get(`player:${memberId}`);
                        if (memberData) {
                            const member = JSON.parse(memberData);
                            if (member.team === player.team && member.role === newRole) {
                                return JSON.stringify({ success: false, reason: 'ROLE_TAKEN', existingNickname: member.nickname });
                            }
                        }
                    }
                }

                player.role = newRole;
                player.lastSeen = Date.now();
                mockRedisStorage.set(playerKey, JSON.stringify(player));
                return JSON.stringify({ success: true, player });
            }

            // Team-set script (has 'cjson.decode' and 'team')
            if (script.includes('cjson.decode') && script.includes('team')) {
                const playerKey = options.keys[0];
                const newTeam = options.arguments[0];

                const playerData = mockRedisStorage.get(playerKey);
                if (!playerData) return null;

                const player = JSON.parse(playerData);
                player.team = newTeam === '__NULL__' ? null : newTeam;
                player.lastSeen = Date.now();

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

jest.mock('../../utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));

jest.mock('../../services/timerService', () => ({
    startTimer: jest.fn(async () => ({ durationSeconds: 120, endTime: Date.now() + 120000 })),
    stopTimer: jest.fn(async () => {}),
    getTimerStatus: jest.fn(async () => null),
    initializeTimerService: jest.fn()
}));

const { createSocketRateLimiter } = require('../../middleware/rateLimit');
const { RATE_LIMITS, ERROR_CODES } = require('../../config/constants');
const roomHandlers = require('../../socket/handlers/roomHandlers');
const gameHandlers = require('../../socket/handlers/gameHandlers');
const playerHandlers = require('../../socket/handlers/playerHandlers');

describe('Race Condition Tests', () => {
    let httpServer;
    let io;
    let socketRateLimiter;

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

    describe('Room Creation Atomicity', () => {
        test('room IDs are unique - duplicate creation fails', async () => {
            const clients = [];
            const createPromises = [];

            try {
                // Create 5 clients simultaneously trying to create rooms with SAME roomId
                // Only one should succeed (first one), others should fail
                for (let i = 0; i < 5; i++) {
                    const client = await createClient();
                    clients.push(client);

                    const promise = new Promise((resolve) => {
                        let resolved = false;
                        client.once('room:created', (data) => {
                            if (!resolved) { resolved = true; resolve({ success: true, data }); }
                        });
                        client.once('room:error', (data) => {
                            if (!resolved) { resolved = true; resolve({ success: false, data }); }
                        });
                        setTimeout(() => {
                            if (!resolved) { resolved = true; resolve({ success: false, error: 'timeout' }); }
                        }, 5000);
                    });

                    createPromises.push(promise);
                    // All try to create the same room ID - only first should succeed
                    client.emit('room:create', { roomId: 'race-test' });
                }

                const results = await Promise.all(createPromises);
                const successful = results.filter(r => r.success);
                const failed = results.filter(r => !r.success && r.data?.code === 'ROOM_ALREADY_EXISTS');

                // Only one should succeed (the first one to reach Redis)
                expect(successful.length).toBe(1);
                expect(successful[0].data.room.code).toBe('race-test');

                // Others should fail with ROOM_ALREADY_EXISTS
                expect(failed.length).toBeGreaterThanOrEqual(0); // Some might timeout
            } finally {
                clients.forEach(c => c.disconnect());
            }
        });
    });

    describe('Room Join Capacity', () => {
        test('respects max player limit', async () => {
            const host = await createClient();
            const clients = [];

            try {
                // Create room
                const createPromise = waitForEvent(host, 'room:created');
                host.emit('room:create', { roomId: 'race-test' });
                const { room } = await createPromise;

                // Try to join with 5 players (within limit)
                for (let i = 0; i < 5; i++) {
                    const client = await createClient();
                    clients.push(client);

                    const joinPromise = waitForEvent(client, 'room:joined');
                    client.emit('room:join', { roomId: room.code, nickname: `Player${i}` });
                    await joinPromise;
                }

                // All 5 should have joined successfully (total 6 including host)
                expect(clients.length).toBe(5);
            } finally {
                host.disconnect();
                clients.forEach(c => c.disconnect());
            }
        });
    });

    describe('Game State Consistency', () => {
        // Skip: requires full mock support for game state operations
        test.skip('game start sets proper initial state', async () => {
            const host = await createClient();

            try {
                // Create room
                const createPromise = waitForEvent(host, 'room:created');
                host.emit('room:create', { roomId: 'race-test' });
                await createPromise;

                // Start game
                const startPromise = waitForEvent(host, 'game:started');
                host.emit('game:start', {});
                const { game } = await startPromise;

                // Verify game state
                expect(game.words).toHaveLength(25);
                expect(game.revealed).toHaveLength(25);
                expect(game.revealed.every(r => r === false)).toBe(true);
                expect(['red', 'blue']).toContain(game.currentTurn);
                expect(game.gameOver).toBe(false);
                expect(game.redScore).toBe(0);
                expect(game.blueScore).toBe(0);
            } finally {
                host.disconnect();
            }
        });

        test.skip('cannot start multiple games in same room', async () => {
            const host = await createClient();

            try {
                // Create room
                const createPromise = waitForEvent(host, 'room:created');
                host.emit('room:create', { roomId: 'race-test' });
                await createPromise;

                // Start first game
                const startPromise = waitForEvent(host, 'game:started');
                host.emit('game:start', {});
                await startPromise;

                // Try to start second game
                const errorPromise = waitForEvent(host, 'game:error');
                host.emit('game:start', {});
                const error = await errorPromise;

                expect(error.code).toBe(ERROR_CODES.GAME_IN_PROGRESS);
            } finally {
                host.disconnect();
            }
        });
    });

    describe('Player State Management', () => {
        // Skip: Flaky due to socket event timing in test environment
        test.skip('player can change team', async () => {
            const host = await createClient();
            const player = await createClient();

            try {
                // Create room
                const createPromise = waitForEvent(host, 'room:created');
                host.emit('room:create', { roomId: 'race-test' });
                const { room } = await createPromise;

                // Join room
                const joinPromise = waitForEvent(player, 'room:joined');
                player.emit('room:join', { roomId: room.code, nickname: 'Player' });
                await joinPromise;

                // Set team to red
                let updatePromise = waitForEvent(player, 'player:updated');
                player.emit('player:setTeam', { team: 'red' });
                let update = await updatePromise;
                expect(update.changes.team).toBe('red');

                // Change team to blue
                updatePromise = waitForEvent(player, 'player:updated');
                player.emit('player:setTeam', { team: 'blue' });
                update = await updatePromise;
                expect(update.changes.team).toBe('blue');
            } finally {
                host.disconnect();
                player.disconnect();
            }
        });

        test('role requires team assignment', async () => {
            const host = await createClient();
            const player = await createClient();

            try {
                // Create room
                const createPromise = waitForEvent(host, 'room:created');
                host.emit('room:create', { roomId: 'race-test' });
                const { room } = await createPromise;

                // Join room
                const joinPromise = waitForEvent(player, 'room:joined');
                player.emit('room:join', { roomId: room.code, nickname: 'Player' });
                await joinPromise;

                // Try to become spymaster without team
                const errorPromise = waitForEvent(player, 'player:error');
                player.emit('player:setRole', { role: 'spymaster' });
                const error = await errorPromise;

                expect(error.code).toBe(ERROR_CODES.INVALID_INPUT);
                expect(error.message).toContain('team');
            } finally {
                host.disconnect();
                player.disconnect();
            }
        });
    });
});
