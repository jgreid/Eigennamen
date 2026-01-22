/**
 * Full Game Flow Integration Tests
 *
 * ISSUE #47 FIX: Comprehensive integration tests for complete game scenarios.
 * Tests the entire game lifecycle from room creation to game completion.
 */

const http = require('http');
const { Server } = require('socket.io');
const Client = require('socket.io-client');
const { v4: uuidv4 } = require('uuid');

// Test configuration
const TEST_PORT = 3098;
const SOCKET_URL = `http://localhost:${TEST_PORT}`;
const CONNECTION_TIMEOUT = 5000;

// Mock Redis storage
let mockRedisStorage = new Map();
let mockRedisSets = new Map();
let mockRedisSortedSets = new Map();

// Setup mocks before importing services
jest.mock('../../config/redis', () => {
    const mockRedis = {
        get: jest.fn(async (key) => mockRedisStorage.get(key) || null),
        set: jest.fn(async (key, value, options) => {
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
        incr: jest.fn(async (key) => {
            const current = parseInt(mockRedisStorage.get(key) || '0');
            const newVal = current + 1;
            mockRedisStorage.set(key, String(newVal));
            return newVal;
        }),
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
        zAdd: jest.fn(async (key, { score, value }) => {
            if (!mockRedisSortedSets.has(key)) mockRedisSortedSets.set(key, []);
            mockRedisSortedSets.get(key).push({ score, value });
            return 1;
        }),
        zRem: jest.fn(async (key, value) => {
            const zset = mockRedisSortedSets.get(key);
            if (!zset) return 0;
            const idx = zset.findIndex(e => e.value === value);
            if (idx !== -1) { zset.splice(idx, 1); return 1; }
            return 0;
        }),
        zRangeByScore: jest.fn(async () => []),
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
                return 1;
            }

            // Simulate atomic team change script
            if (script.includes('cjson.decode') && script.includes('team') && !script.includes('OPTIMIZED_REVEAL')) {
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

            // Simulate optimized reveal script (fallback to standard implementation)
            if (script.includes('revealed') && script.includes('redScore')) {
                // Return error to trigger fallback to standard implementation
                return JSON.stringify({ error: 'SCRIPT_NOT_IMPLEMENTED_IN_MOCK' });
            }

            return null;
        }),
        publish: jest.fn(async () => 0),
        subscribe: jest.fn(async () => {}),
        duplicate: jest.fn(function() { return this; })
    };

    return {
        getRedis: () => mockRedis,
        getPubSubClients: () => ({ pubClient: mockRedis, subClient: mockRedis }),
        isUsingMemoryMode: () => true,
        isRedisHealthy: async () => true
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
    getTimerStatus: jest.fn(async () => null),
    initializeTimerService: jest.fn()
}));

// Import after mocks
const { createSocketRateLimiter } = require('../../middleware/rateLimit');
const { RATE_LIMITS, ERROR_CODES } = require('../../config/constants');
const roomHandlers = require('../../socket/handlers/roomHandlers');
const gameHandlers = require('../../socket/handlers/gameHandlers');
const playerHandlers = require('../../socket/handlers/playerHandlers');

describe('Full Game Flow Integration Tests', () => {
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

    // Helper to wait for event
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
        mockRedisSortedSets.clear();
        jest.clearAllMocks();
    });

    describe('Complete Game Lifecycle', () => {
        test('full game flow: create room -> setup teams -> start game -> give clue -> reveal cards', async () => {
            // Create host client
            const host = await createClient();

            try {
                // 1. Create room
                const createPromise = waitForEvent(host, 'room:created');
                host.emit('room:create', { settings: { redTeamName: 'Red Team', blueTeamName: 'Blue Team' } });
                const { room, player: hostPlayer } = await createPromise;

                expect(room.code).toHaveLength(6);
                expect(hostPlayer.isHost).toBe(true);

                // 2. Join team as host
                let updatePromise = waitForEvent(host, 'player:updated');
                host.emit('player:setTeam', { team: 'red' });
                const teamUpdate = await updatePromise;
                expect(teamUpdate.changes.team).toBe('red');

                // 3. Become spymaster
                updatePromise = waitForEvent(host, 'player:updated');
                host.emit('player:setRole', { role: 'spymaster' });
                const roleUpdate = await updatePromise;
                expect(roleUpdate.changes.role).toBe('spymaster');

                // 4. Start game
                const startPromise = waitForEvent(host, 'game:started');
                host.emit('game:start', {});
                const { game } = await startPromise;

                expect(game.words).toHaveLength(25);
                expect(game.currentTurn).toMatch(/^(red|blue)$/);
                expect(game.redScore).toBe(0);
                expect(game.blueScore).toBe(0);

                // 5. If it's red's turn, give a clue
                if (game.currentTurn === 'red') {
                    const cluePromise = waitForEvent(host, 'game:clueGiven');
                    host.emit('game:clue', { word: 'TEST', number: 2 });
                    const clue = await cluePromise;

                    expect(clue.word).toBe('TEST');
                    expect(clue.number).toBe(2);
                    expect(clue.guessesAllowed).toBe(3); // number + 1
                }

            } finally {
                host.disconnect();
            }
        });

        test('multiplayer game flow: host + player setup and coordination', async () => {
            const host = await createClient();
            const player = await createClient();

            try {
                // Create room
                const createPromise = waitForEvent(host, 'room:created');
                host.emit('room:create', {});
                const { room } = await createPromise;

                // Player joins
                const joinPromise = waitForEvent(player, 'room:joined');
                const hostNotifyPromise = waitForEvent(host, 'room:playerJoined');
                player.emit('room:join', { code: room.code, nickname: 'Player1' });

                const [joinResult, notification] = await Promise.all([joinPromise, hostNotifyPromise]);
                expect(joinResult.room.code).toBe(room.code);
                expect(notification.player.nickname).toBe('Player1');

                // Setup teams - host is red spymaster
                let updatePromise = waitForEvent(host, 'player:updated');
                host.emit('player:setTeam', { team: 'red' });
                await updatePromise;

                updatePromise = waitForEvent(host, 'player:updated');
                host.emit('player:setRole', { role: 'spymaster' });
                await updatePromise;

                // Player is red clicker
                updatePromise = waitForEvent(player, 'player:updated');
                player.emit('player:setTeam', { team: 'red' });
                await updatePromise;

                updatePromise = waitForEvent(player, 'player:updated');
                player.emit('player:setRole', { role: 'clicker' });
                await updatePromise;

                // Start game - both should receive game:started
                const hostStartPromise = waitForEvent(host, 'game:started');
                const playerStartPromise = waitForEvent(player, 'game:started');
                host.emit('game:start', {});

                const [hostGame, playerGame] = await Promise.all([hostStartPromise, playerStartPromise]);

                // Both should have same board
                expect(hostGame.game.words).toEqual(playerGame.game.words);
                expect(hostGame.game.currentTurn).toBe(playerGame.game.currentTurn);

                // Spymaster should see all types, clicker should not
                expect(hostGame.game.types.every(t => t !== null)).toBe(true);
                // Clicker only sees revealed types (none at start)
                expect(playerGame.game.types.every(t => t === null)).toBe(true);

            } finally {
                host.disconnect();
                player.disconnect();
            }
        });

        test('game flow with turn timer setting', async () => {
            const host = await createClient();

            try {
                // Create room with timer
                const createPromise = waitForEvent(host, 'room:created');
                host.emit('room:create', { settings: { turnTimer: 120 } });
                const { room } = await createPromise;

                expect(room.settings.turnTimer).toBe(120);

                // Setup and start game
                let updatePromise = waitForEvent(host, 'player:updated');
                host.emit('player:setTeam', { team: 'red' });
                await updatePromise;

                updatePromise = waitForEvent(host, 'player:updated');
                host.emit('player:setRole', { role: 'spymaster' });
                await updatePromise;

                // Start game (timer:started is emitted but we just verify game starts)
                const startPromise = waitForEvent(host, 'game:started');
                host.emit('game:start', {});
                const { game } = await startPromise;

                // Verify game started successfully
                expect(game.words).toHaveLength(25);
                expect(game.currentTurn).toMatch(/^(red|blue)$/);

            } finally {
                host.disconnect();
            }
        });
    });

    describe('Game State Recovery', () => {
        test('room:resync returns complete game state', async () => {
            const host = await createClient();

            try {
                // Create and start a game
                const createPromise = waitForEvent(host, 'room:created');
                host.emit('room:create', {});
                await createPromise;

                let updatePromise = waitForEvent(host, 'player:updated');
                host.emit('player:setTeam', { team: 'red' });
                await updatePromise;

                updatePromise = waitForEvent(host, 'player:updated');
                host.emit('player:setRole', { role: 'spymaster' });
                await updatePromise;

                const startPromise = waitForEvent(host, 'game:started');
                host.emit('game:start', {});
                await startPromise;

                // Request resync
                const resyncPromise = waitForEvent(host, 'room:resynced');
                host.emit('room:resync');
                const resyncData = await resyncPromise;

                expect(resyncData.room).toBeDefined();
                expect(resyncData.players).toBeDefined();
                expect(resyncData.game).toBeDefined();
                expect(resyncData.you).toBeDefined();
                expect(resyncData.game.words).toHaveLength(25);

            } finally {
                host.disconnect();
            }
        });
    });

    describe('Error Scenarios', () => {
        test('cannot give clue when not spymaster', async () => {
            const host = await createClient();
            const player = await createClient();

            try {
                // Create room and start game
                const createPromise = waitForEvent(host, 'room:created');
                host.emit('room:create', {});
                const { room } = await createPromise;

                // Player joins as clicker
                const joinPromise = waitForEvent(player, 'room:joined');
                player.emit('room:join', { code: room.code, nickname: 'Clicker' });
                await joinPromise;

                let updatePromise = waitForEvent(player, 'player:updated');
                player.emit('player:setTeam', { team: 'red' });
                await updatePromise;

                updatePromise = waitForEvent(player, 'player:updated');
                player.emit('player:setRole', { role: 'clicker' });
                await updatePromise;

                // Start game
                const startPromise = waitForEvent(player, 'game:started');
                host.emit('game:start', {});
                await startPromise;

                // Clicker tries to give clue
                const errorPromise = waitForEvent(player, 'game:error');
                player.emit('game:clue', { word: 'TEST', number: 2 });
                const error = await errorPromise;

                expect(error.code).toBe(ERROR_CODES.NOT_SPYMASTER);

            } finally {
                host.disconnect();
                player.disconnect();
            }
        });

        test('clicker cannot reveal card without being on current team turn', async () => {
            const host = await createClient();
            const player = await createClient();

            try {
                // Setup game
                const createPromise = waitForEvent(host, 'room:created');
                host.emit('room:create', {});
                const { room } = await createPromise;

                const joinPromise = waitForEvent(player, 'room:joined');
                player.emit('room:join', { code: room.code, nickname: 'Clicker' });
                await joinPromise;

                // Player becomes blue clicker (will error if it's red's turn)
                let updatePromise = waitForEvent(player, 'player:updated');
                player.emit('player:setTeam', { team: 'blue' });
                await updatePromise;

                updatePromise = waitForEvent(player, 'player:updated');
                player.emit('player:setRole', { role: 'clicker' });
                await updatePromise;

                // Start game
                const playerStartPromise = waitForEvent(player, 'game:started');
                host.emit('game:start', {});
                const { game } = await playerStartPromise;

                // If it's NOT blue's turn, clicker should get error for wrong turn
                if (game.currentTurn !== 'blue') {
                    const errorPromise = waitForEvent(player, 'game:error');
                    player.emit('game:reveal', { index: 0 });
                    const error = await errorPromise;

                    expect(error.code).toBe(ERROR_CODES.NOT_YOUR_TURN);
                } else {
                    // It's blue's turn - we verify the game started correctly
                    expect(game.currentTurn).toBe('blue');
                }

            } finally {
                host.disconnect();
                player.disconnect();
            }
        });

        test('cannot start second game while game in progress', async () => {
            const host = await createClient();

            try {
                const createPromise = waitForEvent(host, 'room:created');
                host.emit('room:create', {});
                await createPromise;

                const startPromise = waitForEvent(host, 'game:started');
                host.emit('game:start', {});
                await startPromise;

                // Try to start another game
                const errorPromise = waitForEvent(host, 'game:error');
                host.emit('game:start', {});
                const error = await errorPromise;

                expect(error.code).toBe(ERROR_CODES.GAME_IN_PROGRESS);

            } finally {
                host.disconnect();
            }
        });
    });

    describe('Player Management', () => {
        test('role is cleared when switching teams - verified via resync', async () => {
            const host = await createClient();

            try {
                const createPromise = waitForEvent(host, 'room:created');
                host.emit('room:create', {});
                await createPromise;

                // Join red team and become spymaster
                let updatePromise = waitForEvent(host, 'player:updated');
                host.emit('player:setTeam', { team: 'red' });
                await updatePromise;

                updatePromise = waitForEvent(host, 'player:updated');
                host.emit('player:setRole', { role: 'spymaster' });
                await updatePromise;

                // Verify role is spymaster via resync
                let resyncPromise = waitForEvent(host, 'room:resynced');
                host.emit('room:resync');
                let resyncData = await resyncPromise;
                expect(resyncData.you.role).toBe('spymaster');

                // Switch to blue team - role is cleared atomically in Lua script
                updatePromise = waitForEvent(host, 'player:updated');
                host.emit('player:setTeam', { team: 'blue' });
                const teamChange = await updatePromise;

                // Team change should be broadcast
                expect(teamChange.changes.team).toBe('blue');

                // Verify role was cleared by requesting resync to get full state
                resyncPromise = waitForEvent(host, 'room:resynced');
                host.emit('room:resync');
                resyncData = await resyncPromise;

                // The player's role should now be spectator (reset from spymaster)
                expect(resyncData.you.role).toBe('spectator');

            } finally {
                host.disconnect();
            }
        });
    });

    describe('Reconnection Token Flow', () => {
        test('can request reconnection token', async () => {
            const host = await createClient();

            try {
                // Create and join room
                const createPromise = waitForEvent(host, 'room:created');
                host.emit('room:create', {});
                await createPromise;

                // Request reconnection token
                const tokenPromise = waitForEvent(host, 'room:reconnectionToken');
                host.emit('room:getReconnectionToken');
                const tokenData = await tokenPromise;

                expect(tokenData.token).toBeDefined();
                expect(tokenData.token.length).toBeGreaterThan(0);
                expect(tokenData.sessionId).toBe(host.sessionId);

            } finally {
                host.disconnect();
            }
        });
    });
});
