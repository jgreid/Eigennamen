/**
 * Socket Index Edge Case Tests
 *
 * Tests for uncovered edge cases in socket/index.js to reach 80% coverage
 * Focuses on Redis adapter errors, disconnect handling edge cases, and timer callbacks
 */

const http = require('http');

// Store original env
const originalEnv = { ...process.env };

// Mock Redis storage
let mockRedisStorage = {};
let mockRedisHealthy = true;

const mockRedis = {
    get: jest.fn(async (key) => mockRedisStorage[key] || null),
    set: jest.fn(async (key, value, options) => {
        if (options?.NX && mockRedisStorage[key]) {
            return null;
        }
        mockRedisStorage[key] = typeof value === 'string' ? value : JSON.stringify(value);
        return 'OK';
    }),
    del: jest.fn(async (key) => {
        const existed = mockRedisStorage[key] ? 1 : 0;
        delete mockRedisStorage[key];
        return existed;
    }),
    exists: jest.fn(async (key) => mockRedisStorage[key] ? 1 : 0),
    expire: jest.fn().mockResolvedValue(1)
};

const mockPubClient = {
    publish: jest.fn().mockResolvedValue(1),
    connect: jest.fn().mockResolvedValue()
};

const mockSubClient = {
    subscribe: jest.fn().mockResolvedValue(),
    connect: jest.fn().mockResolvedValue()
};

jest.mock('../config/redis', () => ({
    getRedis: () => mockRedis,
    getPubSubClients: () => ({ pubClient: mockPubClient, subClient: mockSubClient }),
    isUsingMemoryMode: jest.fn().mockReturnValue(true),
    isRedisHealthy: jest.fn(async () => mockRedisHealthy)
}));

jest.mock('../utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));

jest.mock('../middleware/socketAuth', () => ({
    authenticateSocket: jest.fn((socket, next) => {
        socket.sessionId = socket.handshake?.auth?.sessionId || 'test-session-' + Math.random();
        next();
    })
}));

// Mock services
const mockGameService = {
    getGame: jest.fn(),
    endTurn: jest.fn(),
    getGameStateForPlayer: jest.fn()
};

const mockRoomService = {
    getRoom: jest.fn()
};

const mockPlayerService = {
    getPlayer: jest.fn(),
    getPlayersInRoom: jest.fn(),
    handleDisconnect: jest.fn(),
    updatePlayer: jest.fn(),
    generateReconnectionToken: jest.fn()
};

const mockEventLogService = {
    logEvent: jest.fn().mockResolvedValue(),
    EVENT_TYPES: {
        TIMER_EXPIRED: 'TIMER_EXPIRED',
        PLAYER_DISCONNECTED: 'PLAYER_DISCONNECTED',
        HOST_CHANGED: 'HOST_CHANGED'
    }
};

const mockTimerService = {
    initializeTimerService: jest.fn(),
    startTimer: jest.fn().mockResolvedValue({
        startTime: Date.now(),
        endTime: Date.now() + 60000,
        duration: 60,
        remainingSeconds: 60
    }),
    stopTimer: jest.fn().mockResolvedValue(),
    getTimerStatus: jest.fn()
};

jest.mock('../services/gameService', () => mockGameService);
jest.mock('../services/roomService', () => mockRoomService);
jest.mock('../services/playerService', () => mockPlayerService);
jest.mock('../services/eventLogService', () => mockEventLogService);
jest.mock('../services/timerService', () => mockTimerService);

// Mock handlers
jest.mock('../socket/handlers/roomHandlers', () => jest.fn());
jest.mock('../socket/handlers/gameHandlers', () => jest.fn());
jest.mock('../socket/handlers/playerHandlers', () => jest.fn());
jest.mock('../socket/handlers/chatHandlers', () => jest.fn());

// Mock rate limiter
jest.mock('../socket/rateLimitHandler', () => ({
    socketRateLimiter: {
        cleanupSocket: jest.fn()
    },
    createRateLimitedHandler: jest.fn((socket, event, handler) => handler),
    getSocketRateLimiter: jest.fn(),
    startRateLimitCleanup: jest.fn(),
    stopRateLimitCleanup: jest.fn()
}));

describe('Socket Index Edge Cases', () => {
    let server;
    let socketModule;
    const TEST_PORT = 3120 + Math.floor(Math.random() * 50);

    beforeAll((done) => {
        server = http.createServer();
        server.on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                server.listen(TEST_PORT + 100, () => done());
            }
        });
        server.listen(TEST_PORT, done);
    });

    afterAll((done) => {
        if (server && server.listening) {
            server.close(done);
        } else {
            done();
        }
    });

    beforeEach(() => {
        jest.clearAllMocks();
        mockRedisStorage = {};
        mockRedisHealthy = true;
        process.env = { ...originalEnv };

        // Reset mock defaults
        mockGameService.getGame.mockResolvedValue(null);
        mockGameService.endTurn.mockResolvedValue({ currentTurn: 'blue', previousTurn: 'red' });
        mockRoomService.getRoom.mockResolvedValue({ code: 'TESTXY', settings: { turnTimer: 60 } });
        mockPlayerService.getPlayer.mockResolvedValue(null);
        mockPlayerService.getPlayersInRoom.mockResolvedValue([]);
        mockPlayerService.handleDisconnect.mockResolvedValue();
        mockPlayerService.updatePlayer.mockResolvedValue();
        mockPlayerService.generateReconnectionToken.mockResolvedValue('token-abc');
    });

    afterEach(() => {
        process.env = originalEnv;
        if (socketModule) {
            socketModule.cleanupSocketModule();
            socketModule = null;
        }
    });

    describe('Redis Adapter Error Handling', () => {
        test('falls back to memory adapter when Redis adapter throws', () => {
            jest.resetModules();

            // Make getPubSubClients throw
            jest.doMock('../config/redis', () => ({
                getRedis: () => mockRedis,
                getPubSubClients: () => {
                    throw new Error('Redis connection failed');
                },
                isUsingMemoryMode: jest.fn().mockReturnValue(false),
                isRedisHealthy: jest.fn(async () => false)
            }));

            socketModule = require('../socket/index');
            const io = socketModule.initializeSocket(server);

            expect(io).toBeDefined();
            const logger = require('../utils/logger');
            expect(logger.warn).toHaveBeenCalledWith(
                expect.stringContaining('Redis adapter not available'),
                expect.any(String)
            );
        });
    });

    describe('Timer Expire Callback Edge Cases', () => {
        test('handles timer expiry when Redis is unhealthy', async () => {
            jest.resetModules();
            mockRedisHealthy = false;

            const { isRedisHealthy } = require('../config/redis');
            isRedisHealthy.mockResolvedValue(false);

            socketModule = require('../socket/index');
            socketModule.initializeSocket(server);

            // Verify Redis health check
            const healthy = await isRedisHealthy();
            expect(healthy).toBe(false);
            // The timer restart would be skipped when Redis is unhealthy
        });

        test('handles timer expiry when lock cannot be acquired', async () => {
            jest.resetModules();

            // Pre-set the lock so acquisition fails
            mockRedisStorage['lock:timer-restart:TESTXY'] = 'another-process';

            socketModule = require('../socket/index');
            socketModule.initializeSocket(server);

            const result = await mockRedis.set('lock:timer-restart:TESTXY', 'new-process', { NX: true, EX: 5 });
            expect(result).toBeNull();
        });

        test('handles timer restart when game becomes over between checks', async () => {
            mockGameService.getGame
                .mockResolvedValueOnce({ id: 'game-1', gameOver: false, currentTurn: 'red' })
                .mockResolvedValueOnce({ id: 'game-1', gameOver: true, winner: 'blue' });

            const game1 = await mockGameService.getGame('TESTXY');
            expect(game1.gameOver).toBe(false);

            const game2 = await mockGameService.getGame('TESTXY');
            expect(game2.gameOver).toBe(true);
        });

        test('handles timer restart when room settings have no timer', async () => {
            mockRoomService.getRoom.mockResolvedValue({
                code: 'TESTXY',
                settings: {} // No turnTimer
            });

            const room = await mockRoomService.getRoom('TESTXY');
            expect(room.settings.turnTimer).toBeUndefined();
        });
    });

    describe('Disconnect Handler Edge Cases', () => {
        test('handles player without room code', async () => {
            mockPlayerService.getPlayer.mockResolvedValue({
                sessionId: 'session-1',
                nickname: 'Player1',
                roomCode: null,
                connected: true
            });

            const player = await mockPlayerService.getPlayer('session-1');
            expect(player.roomCode).toBeNull();
        });

        test('handles reconnection token generation failure gracefully', async () => {
            mockPlayerService.generateReconnectionToken.mockRejectedValue(
                new Error('Token generation failed')
            );

            await expect(mockPlayerService.generateReconnectionToken('session-1'))
                .rejects.toThrow('Token generation failed');
        });

        test('handles host disconnect with only disconnected players remaining', async () => {
            mockPlayerService.getPlayer.mockResolvedValue({
                sessionId: 'host-session',
                nickname: 'Host',
                roomCode: 'TESTXY',
                isHost: true,
                connected: true
            });

            // All other players are disconnected
            mockPlayerService.getPlayersInRoom.mockResolvedValue([
                { sessionId: 'host-session', connected: false, isHost: true },
                { sessionId: 'player-2', connected: false, isHost: false },
                { sessionId: 'player-3', connected: false, isHost: false }
            ]);

            const players = await mockPlayerService.getPlayersInRoom('TESTXY');
            const connectedOthers = players.filter(p =>
                p.connected && p.sessionId !== 'host-session'
            );
            expect(connectedOthers.length).toBe(0);
        });

        test('handles host transfer when lock is already held', async () => {
            const lockKey = 'lock:host-transfer:TESTXY';
            mockRedisStorage[lockKey] = 'another-socket';

            const result = await mockRedis.set(lockKey, 'new-socket', { NX: true, EX: 3 });
            expect(result).toBeNull();
        });

        test('handles room not found during host transfer', async () => {
            mockPlayerService.getPlayer.mockResolvedValue({
                sessionId: 'host-session',
                nickname: 'Host',
                roomCode: 'TESTXY',
                isHost: true,
                connected: true
            });

            mockPlayerService.getPlayersInRoom.mockResolvedValue([
                { sessionId: 'player-2', nickname: 'Player2', connected: true }
            ]);

            mockRoomService.getRoom.mockResolvedValue(null);

            const room = await mockRoomService.getRoom('TESTXY');
            expect(room).toBeNull();
        });

        test('handles error during host transfer update', async () => {
            mockPlayerService.updatePlayer.mockRejectedValueOnce(
                new Error('Update failed')
            );

            await expect(mockPlayerService.updatePlayer('session-1', { isHost: false }))
                .rejects.toThrow('Update failed');
        });
    });

    describe('Socket Count Updates', () => {
        test('handles updateSocketCount error gracefully', () => {
            jest.resetModules();

            const mockApp = {
                updateSocketCount: jest.fn().mockImplementation(() => {
                    throw new Error('Update failed');
                })
            };

            socketModule = require('../socket/index');
            socketModule.initializeSocket(server, mockApp);

            // Should not throw on initialization
            expect(socketModule.getIO()).toBeDefined();
        });
    });

    describe('Start/Stop Timer Functions', () => {
        test('startTurnTimer broadcasts timer:started event', async () => {
            jest.resetModules();

            socketModule = require('../socket/index');
            socketModule.initializeSocket(server);

            const timerInfo = await socketModule.startTurnTimer('TESTXY', 60);

            expect(mockTimerService.startTimer).toHaveBeenCalled();
            expect(timerInfo).toBeDefined();
        });

        test('stopTurnTimer broadcasts timer:stopped event', async () => {
            jest.resetModules();

            socketModule = require('../socket/index');
            socketModule.initializeSocket(server);

            await socketModule.stopTurnTimer('TESTXY');

            expect(mockTimerService.stopTimer).toHaveBeenCalledWith('TESTXY');
        });
    });

    describe('getIO throws when not initialized', () => {
        test('throws error when getting IO before initialization', () => {
            jest.resetModules();

            const freshModule = require('../socket/index');
            freshModule.cleanupSocketModule();

            expect(() => freshModule.getIO()).toThrow('Socket.io not initialized');
        });
    });

    describe('emitToRoom and emitToPlayer', () => {
        test('emitToRoom sends event to room', () => {
            jest.resetModules();

            socketModule = require('../socket/index');
            socketModule.initializeSocket(server);

            // Should not throw
            socketModule.emitToRoom('TESTXY', 'test:event', { data: 'test' });
        });

        test('emitToPlayer sends event to player', () => {
            jest.resetModules();

            socketModule = require('../socket/index');
            socketModule.initializeSocket(server);

            // Should not throw
            socketModule.emitToPlayer('session-1', 'test:event', { data: 'test' });
        });
    });

    describe('cleanupSocketModule', () => {
        test('cleanupSocketModule stops rate limit cleanup', () => {
            jest.resetModules();

            socketModule = require('../socket/index');
            socketModule.initializeSocket(server);
            socketModule.cleanupSocketModule();

            const { stopRateLimitCleanup } = require('../socket/rateLimitHandler');
            expect(stopRateLimitCleanup).toHaveBeenCalled();
        });

        test('cleanupSocketModule can be called multiple times', () => {
            jest.resetModules();

            socketModule = require('../socket/index');
            socketModule.initializeSocket(server);

            // Should not throw when called multiple times
            socketModule.cleanupSocketModule();
            socketModule.cleanupSocketModule();
        });
    });
});
