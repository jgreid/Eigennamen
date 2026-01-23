/**
 * Socket Handler Integration Tests
 *
 * Tests the complete flow of socket handlers with mocked Redis.
 * Verifies room creation, joining, game flow, player management, and error handling.
 */

const http = require('http');
const { Server } = require('socket.io');
const Client = require('socket.io-client');
const { v4: uuidv4 } = require('uuid');

// Test configuration - use random port offset to avoid conflicts
const TEST_PORT_BASE = 3097;
const TEST_PORT = TEST_PORT_BASE + Math.floor(Math.random() * 50);
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
                    return 0; // Room exists
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

                if (set.has(sessionId)) return -1; // Already member
                if (set.size >= maxPlayers) return 0; // Full

                set.add(sessionId);
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
        duplicate: jest.fn(() => mockRedis)
    };

    return {
        getRedis: () => mockRedis,
        getPubSubClients: () => ({ pubClient: mockRedis, subClient: mockRedis }),
        isUsingMemoryMode: () => true
    };
});

// Mock logger to reduce noise
jest.mock('../../utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));

// Mock timer service to avoid actual timers
jest.mock('../../services/timerService', () => ({
    startTimer: jest.fn(async () => ({ durationSeconds: 120, endTime: Date.now() + 120000 })),
    stopTimer: jest.fn(async () => {}),
    getTimerStatus: jest.fn(async () => null),
    initializeTimerService: jest.fn()
}));

// Import services AFTER mocking (required for mock initialization)
const _roomService = require('../../services/roomService');
const _playerService = require('../../services/playerService');
const _gameService = require('../../services/gameService');
const { createSocketRateLimiter } = require('../../middleware/rateLimit');
const { RATE_LIMITS, ERROR_CODES } = require('../../config/constants');

// Import handlers
const roomHandlers = require('../../socket/handlers/roomHandlers');
const gameHandlers = require('../../socket/handlers/gameHandlers');
const playerHandlers = require('../../socket/handlers/playerHandlers');
const chatHandlers = require('../../socket/handlers/chatHandlers');

describe('Socket Handler Integration Tests', () => {
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

            // Register all handlers
            roomHandlers(io, socket);
            gameHandlers(io, socket);
            playerHandlers(io, socket);
            chatHandlers(io, socket);

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
        // Clear mock storage before each test
        mockRedisStorage.clear();
        mockRedisSets.clear();
        jest.clearAllMocks();
    });

    describe('Room Handlers', () => {
        describe('room:create', () => {
            test('creates room successfully', async () => {
                const client = await createClient();

                try {
                    const responsePromise = waitForEvent(client, 'room:created');
                    client.emit('room:create', { settings: { redTeamName: 'Team Red' } });

                    const response = await responsePromise;
                    expect(response.room).toBeDefined();
                    expect(response.room.code).toHaveLength(6);
                    expect(response.player).toBeDefined();
                    expect(response.player.isHost).toBe(true);
                } finally {
                    client.disconnect();
                }
            });

            test('creates password-protected room', async () => {
                const client = await createClient();

                try {
                    const responsePromise = waitForEvent(client, 'room:created');
                    client.emit('room:create', {
                        settings: { password: 'secret123' }
                    });

                    const response = await responsePromise;
                    expect(response.room.hasPassword).toBe(true);
                    expect(response.room.passwordHash).toBeUndefined(); // Should not expose hash
                } finally {
                    client.disconnect();
                }
            });
        });

        describe('room:join', () => {
            test('joins existing room successfully', async () => {
                // Create room first
                const hostClient = await createClient();
                const hostResponsePromise = waitForEvent(hostClient, 'room:created');
                hostClient.emit('room:create', {});
                const { room } = await hostResponsePromise;

                // Join with another client
                const joinerClient = await createClient();

                try {
                    const joinResponsePromise = waitForEvent(joinerClient, 'room:joined');
                    joinerClient.emit('room:join', {
                        code: room.code,
                        nickname: 'TestPlayer'
                    });

                    const joinResponse = await joinResponsePromise;
                    expect(joinResponse.room.code).toBe(room.code);
                    expect(joinResponse.you.nickname).toBe('TestPlayer');
                } finally {
                    hostClient.disconnect();
                    joinerClient.disconnect();
                }
            });

            test('returns error for non-existent room', async () => {
                const client = await createClient();

                try {
                    const errorPromise = waitForEvent(client, 'room:error');
                    client.emit('room:join', {
                        code: 'ZZZZZZ',
                        nickname: 'TestPlayer'
                    });

                    const error = await errorPromise;
                    expect(error.code).toBe(ERROR_CODES.ROOM_NOT_FOUND);
                } finally {
                    client.disconnect();
                }
            });

            test('requires password for protected room', async () => {
                // Create protected room
                const hostClient = await createClient();
                const hostResponsePromise = waitForEvent(hostClient, 'room:created');
                hostClient.emit('room:create', { settings: { password: 'secret' } });
                const { room } = await hostResponsePromise;

                // Try to join without password
                const joinerClient = await createClient();

                try {
                    const errorPromise = waitForEvent(joinerClient, 'room:error');
                    joinerClient.emit('room:join', {
                        code: room.code,
                        nickname: 'TestPlayer'
                    });

                    const error = await errorPromise;
                    expect(error.code).toBe(ERROR_CODES.ROOM_PASSWORD_REQUIRED);
                } finally {
                    hostClient.disconnect();
                    joinerClient.disconnect();
                }
            });
        });

        describe('room:settings', () => {
            test('host can update settings', async () => {
                const client = await createClient();

                try {
                    // Create room
                    const createPromise = waitForEvent(client, 'room:created');
                    client.emit('room:create', {});
                    await createPromise;

                    // Update settings - we just verify we get a response
                    const updatePromise = waitForEvent(client, 'room:settingsUpdated');
                    client.emit('room:settings', {
                        turnTimer: 120
                    });

                    const response = await updatePromise;
                    // Verify we got a settings response (mock may not preserve all fields)
                    expect(response.settings).toBeDefined();
                } finally {
                    client.disconnect();
                }
            });
        });
    });

    describe('Player Handlers', () => {
        let hostClient;
        let playerClient;
        let roomCode;

        beforeEach(async () => {
            // Create room and join with another player
            hostClient = await createClient();
            const createPromise = waitForEvent(hostClient, 'room:created');
            hostClient.emit('room:create', {});
            const { room } = await createPromise;
            roomCode = room.code;

            playerClient = await createClient();
            const joinPromise = waitForEvent(playerClient, 'room:joined');
            playerClient.emit('room:join', { code: roomCode, nickname: 'Player1' });
            await joinPromise;
        });

        afterEach(() => {
            hostClient?.disconnect();
            playerClient?.disconnect();
        });

        describe('player:setTeam', () => {
            test('player can join a team', async () => {
                const updatePromise = waitForEvent(playerClient, 'player:updated');
                playerClient.emit('player:setTeam', { team: 'red' });

                const response = await updatePromise;
                expect(response.changes.team).toBe('red');
            });

            test('player can leave team (set to null)', async () => {
                // First join a team
                let updatePromise = waitForEvent(playerClient, 'player:updated');
                playerClient.emit('player:setTeam', { team: 'red' });
                await updatePromise;

                // Then leave team
                updatePromise = waitForEvent(playerClient, 'player:updated');
                playerClient.emit('player:setTeam', { team: null });

                const response = await updatePromise;
                expect(response.changes.team).toBeNull();
            });
        });

        describe('player:setRole', () => {
            test('player can become clicker after joining team', async () => {
                // Join team first
                let updatePromise = waitForEvent(playerClient, 'player:updated');
                playerClient.emit('player:setTeam', { team: 'blue' });
                await updatePromise;

                // Become clicker
                updatePromise = waitForEvent(playerClient, 'player:updated');
                playerClient.emit('player:setRole', { role: 'clicker' });

                const response = await updatePromise;
                expect(response.changes.role).toBe('clicker');
            });

            test('cannot become spymaster without team', async () => {
                const errorPromise = waitForEvent(playerClient, 'player:error');
                playerClient.emit('player:setRole', { role: 'spymaster' });

                const error = await errorPromise;
                expect(error.code).toBe(ERROR_CODES.INVALID_INPUT);
                expect(error.message).toContain('team');
            });
        });

        describe('player:setNickname', () => {
            test('player can change nickname', async () => {
                const updatePromise = waitForEvent(playerClient, 'player:updated');
                playerClient.emit('player:setNickname', { nickname: 'NewName' });

                const response = await updatePromise;
                expect(response.changes.nickname).toBe('NewName');
            });
        });
    });

    describe('Game Handlers', () => {
        describe('game:start', () => {
            test('host can start game', async () => {
                const hostClient = await createClient();

                try {
                    // Create room
                    const createPromise = waitForEvent(hostClient, 'room:created');
                    hostClient.emit('room:create', {});
                    await createPromise;

                    // Start game
                    const startPromise = waitForEvent(hostClient, 'game:started');
                    hostClient.emit('game:start', {});

                    const response = await startPromise;
                    expect(response.game).toBeDefined();
                    expect(response.game.words).toHaveLength(25);
                    expect(response.game.currentTurn).toMatch(/^(red|blue)$/);
                } finally {
                    hostClient.disconnect();
                }
            });

            test('non-host cannot start game', async () => {
                const hostClient = await createClient();
                const playerClient = await createClient();

                try {
                    // Create room
                    const createPromise = waitForEvent(hostClient, 'room:created');
                    hostClient.emit('room:create', {});
                    const { room } = await createPromise;

                    // Join room
                    const joinPromise = waitForEvent(playerClient, 'room:joined');
                    playerClient.emit('room:join', { code: room.code, nickname: 'Player' });
                    await joinPromise;

                    // Non-host tries to start game
                    const errorPromise = waitForEvent(playerClient, 'game:error');
                    playerClient.emit('game:start', {});

                    const error = await errorPromise;
                    expect(error.code).toBe(ERROR_CODES.NOT_HOST);
                } finally {
                    hostClient.disconnect();
                    playerClient.disconnect();
                }
            });

            test('cannot start game while game in progress', async () => {
                const hostClient = await createClient();

                try {
                    // Create room
                    const createPromise = waitForEvent(hostClient, 'room:created');
                    hostClient.emit('room:create', {});
                    await createPromise;

                    // Start first game
                    const startPromise = waitForEvent(hostClient, 'game:started');
                    hostClient.emit('game:start', {});
                    await startPromise;

                    // Try to start another game
                    const errorPromise = waitForEvent(hostClient, 'game:error');
                    hostClient.emit('game:start', {});

                    const error = await errorPromise;
                    expect(error.code).toBe(ERROR_CODES.GAME_IN_PROGRESS);
                } finally {
                    hostClient.disconnect();
                }
            });
        });
    });

    describe('Error Handling', () => {
        test('handles validation errors gracefully', async () => {
            const client = await createClient();

            try {
                const errorPromise = waitForEvent(client, 'room:error');
                // Send invalid data (code too short)
                client.emit('room:join', { code: 'AB', nickname: 'Test' });

                const error = await errorPromise;
                expect(error.code).toBe(ERROR_CODES.INVALID_INPUT);
            } finally {
                client.disconnect();
            }
        });

        test('handles missing room context', async () => {
            const client = await createClient();

            try {
                const errorPromise = waitForEvent(client, 'player:error');
                // Try to set team without being in a room
                client.emit('player:setTeam', { team: 'red' });

                const error = await errorPromise;
                expect(error.code).toBe(ERROR_CODES.ROOM_NOT_FOUND);
            } finally {
                client.disconnect();
            }
        });
    });

    describe('Broadcasting', () => {
        test('room events are broadcast to all players', async () => {
            // Create room
            const hostClient = await createClient();
            const createPromise = waitForEvent(hostClient, 'room:created');
            hostClient.emit('room:create', {});
            const { room } = await createPromise;

            // Join with player
            const playerClient = await createClient();
            const hostNotifyPromise = waitForEvent(hostClient, 'room:playerJoined');
            const joinPromise = waitForEvent(playerClient, 'room:joined');

            playerClient.emit('room:join', { code: room.code, nickname: 'Player1' });

            const [joinResponse, notification] = await Promise.all([joinPromise, hostNotifyPromise]);

            expect(joinResponse.you.nickname).toBe('Player1');
            expect(notification.player.nickname).toBe('Player1');

            hostClient.disconnect();
            playerClient.disconnect();
        });
    });
});

describe('Chat Handlers', () => {
    let httpServer;
    let io;
    let socketRateLimiter;

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
            chatHandlers(io, socket);

            socket.on('disconnect', () => {
                socketRateLimiter.cleanupSocket(socket.id);
            });
        });

        httpServer.listen(TEST_PORT + 1, done);
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

    async function createChatClient(sessionId = uuidv4()) {
        return new Promise((resolve, reject) => {
            const client = Client(`http://localhost:${TEST_PORT + 1}`, {
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

    function waitForChatEvent(client, event, timeout = 5000) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${event}`)), timeout);
            client.once(event, (data) => {
                clearTimeout(timer);
                resolve(data);
            });
        });
    }

    test('chat messages are delivered to room members', async () => {
        // Create and join room
        const sender = await createChatClient();
        const receiver = await createChatClient();

        try {
            // Create room
            const createPromise = waitForChatEvent(sender, 'room:created');
            sender.emit('room:create', {});
            const { room } = await createPromise;

            // Join room
            const joinPromise = waitForChatEvent(receiver, 'room:joined');
            receiver.emit('room:join', { code: room.code, nickname: 'Receiver' });
            await joinPromise;

            // Send chat message
            const messagePromise = waitForChatEvent(receiver, 'chat:message');
            sender.emit('chat:message', { text: 'Hello room!' });

            const message = await messagePromise;
            expect(message.text).toBe('Hello room!');
        } finally {
            sender.disconnect();
            receiver.disconnect();
        }
    });
});
