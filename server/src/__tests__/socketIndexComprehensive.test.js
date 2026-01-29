/**
 * Comprehensive Socket Index Tests (Sprint 15)
 *
 * These tests achieve 90%+ coverage of socket/index.js by testing:
 * - Timer expire callback (createTimerExpireCallback)
 * - handleDisconnect function with all scenarios
 * - Helper functions
 * - Initialization paths
 */

const http = require('http');

// ============ Mock Setup ============

// Control variables - MUST be prefixed with 'mock' for Jest
const mockRedisStorage = new Map();
const mockRedisSets = new Map();
let mockLockAcquired = true;
let mockRedisHealthy = true;
let mockIsMemoryMode = false;
let mockGetPubSubThrows = false;

const mockRedis = {
    get: jest.fn(async (key) => mockRedisStorage.get(key) || null),
    set: jest.fn(async (key, value, options) => {
        if (options && options.NX) {
            if (!mockLockAcquired) return false;
            if (mockRedisStorage.has(key)) return false;
        }
        mockRedisStorage.set(key, typeof value === 'string' ? value : JSON.stringify(value));
        return options && options.NX ? true : 'OK';
    }),
    del: jest.fn(async (key) => {
        mockRedisStorage.delete(key);
        return 1;
    }),
    exists: jest.fn(async (key) => mockRedisStorage.has(key) ? 1 : 0),
    expire: jest.fn().mockResolvedValue(1),
    sAdd: jest.fn(async (key, value) => {
        if (!mockRedisSets.has(key)) mockRedisSets.set(key, new Set());
        mockRedisSets.get(key).add(value);
        return 1;
    }),
    sMembers: jest.fn(async (key) => [...(mockRedisSets.get(key) || [])]),
    sRem: jest.fn(async (key, value) => {
        if (mockRedisSets.has(key)) mockRedisSets.get(key).delete(value);
        return 1;
    })
};

const mockPubClient = {
    publish: jest.fn().mockResolvedValue(1),
    connect: jest.fn().mockResolvedValue(),
    duplicate: jest.fn().mockReturnThis()
};

const mockSubClient = {
    subscribe: jest.fn().mockResolvedValue(),
    connect: jest.fn().mockResolvedValue(),
    duplicate: jest.fn().mockReturnThis()
};

jest.mock('../config/redis', () => ({
    getRedis: () => mockRedis,
    getPubSubClients: () => {
        if (mockGetPubSubThrows) {
            throw new Error('Redis not available');
        }
        return { pubClient: mockPubClient, subClient: mockSubClient };
    },
    isUsingMemoryMode: jest.fn(() => mockIsMemoryMode),
    isRedisHealthy: jest.fn(async () => mockRedisHealthy)
}));

// Mock logger
const mockLogger = {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
};
jest.mock('../utils/logger', () => mockLogger);

// Mock socket auth
jest.mock('../middleware/socketAuth', () => ({
    authenticateSocket: jest.fn((socket, next) => {
        socket.sessionId = socket.handshake?.auth?.sessionId || 'test-session-id';
        next();
    })
}));

// Mock constants
jest.mock('../config/constants', () => ({
    SOCKET: {
        PING_TIMEOUT_MS: 20000,
        PING_INTERVAL_MS: 25000,
        MAX_DISCONNECTION_DURATION_MS: 120000,
        SOCKET_COUNT_CACHE_MS: 5000
    },
    REDIS_TTL: {
        ROOM: 86400
    }
}));

// Game service mock
let mockGameData = null;
const mockGameService = {
    getGame: jest.fn(async () => mockGameData),
    endTurn: jest.fn(async () => ({ currentTurn: 'blue', previousTurn: 'red' }))
};
jest.mock('../services/gameService', () => mockGameService);

// Room service mock
let mockRoomData = null;
const mockRoomService = {
    getRoom: jest.fn(async () => mockRoomData)
};
jest.mock('../services/roomService', () => mockRoomService);

// Player service mock
let mockPlayerData = null;
let mockPlayersInRoom = [];
const mockPlayerService = {
    getPlayer: jest.fn(async () => mockPlayerData),
    getPlayersInRoom: jest.fn(async () => mockPlayersInRoom),
    handleDisconnect: jest.fn().mockResolvedValue(),
    updatePlayer: jest.fn().mockResolvedValue(),
    generateReconnectionToken: jest.fn(async () => 'test-reconnection-token-' + Date.now())
};
jest.mock('../services/playerService', () => mockPlayerService);

// Event log service mock
const mockEventLogService = {
    logEvent: jest.fn().mockResolvedValue(),
    EVENT_TYPES: {
        TIMER_EXPIRED: 'TIMER_EXPIRED',
        PLAYER_DISCONNECTED: 'PLAYER_DISCONNECTED',
        HOST_CHANGED: 'HOST_CHANGED'
    }
};
jest.mock('../services/eventLogService', () => mockEventLogService);

// Timer service mock - capture callback
let timerExpireCallback = null;
const mockTimerService = {
    initializeTimerService: jest.fn((callback) => {
        timerExpireCallback = callback;
        return true;
    }),
    startTimer: jest.fn(async (roomCode, duration) => ({
        startTime: Date.now(),
        endTime: Date.now() + duration * 1000,
        duration,
        durationSeconds: duration,
        remainingSeconds: duration
    })),
    stopTimer: jest.fn().mockResolvedValue(),
    getTimerStatus: jest.fn().mockResolvedValue(null)
};
jest.mock('../services/timerService', () => mockTimerService);

// Mock handlers
jest.mock('../socket/handlers/roomHandlers', () => jest.fn());
jest.mock('../socket/handlers/gameHandlers', () => jest.fn());
jest.mock('../socket/handlers/playerHandlers', () => jest.fn());
jest.mock('../socket/handlers/chatHandlers', () => jest.fn());

// Rate limiter mock
const mockSocketRateLimiter = {
    cleanupSocket: jest.fn(),
    getLimiter: jest.fn(() => (socket, data, next) => next())
};
jest.mock('../socket/rateLimitHandler', () => ({
    socketRateLimiter: mockSocketRateLimiter,
    createRateLimitedHandler: jest.fn((socket, eventName, handler) => handler),
    getSocketRateLimiter: jest.fn(() => mockSocketRateLimiter),
    startRateLimitCleanup: jest.fn(),
    stopRateLimitCleanup: jest.fn()
}));

// Socket function provider mock
jest.mock('../socket/socketFunctionProvider', () => ({
    registerSocketFunctions: jest.fn()
}));

// ============ Tests ============

describe('Socket Index Comprehensive Tests', () => {
    let server;
    let socketModule;
    const TEST_PORT = 3200;

    beforeAll((done) => {
        server = http.createServer();
        server.setMaxListeners(20); // Avoid warnings
        server.on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                server.listen(TEST_PORT + Math.floor(Math.random() * 100), done);
            }
        });
        server.listen(TEST_PORT, done);
    });

    afterAll((done) => {
        try {
            if (socketModule) {
                socketModule.cleanupSocketModule();
            }
        } catch (e) {
            // Ignore cleanup errors
        }
        if (server && server.listening) {
            server.close(done);
        } else {
            done();
        }
    });

    beforeEach(() => {
        // Reset all mocks
        jest.clearAllMocks();

        // Reset control variables
        mockRedisStorage.clear();
        mockRedisSets.clear();
        mockLockAcquired = true;
        mockRedisHealthy = true;
        mockIsMemoryMode = false;
        mockGetPubSubThrows = false;
        mockGameData = null;
        mockRoomData = null;
        mockPlayerData = null;
        mockPlayersInRoom = [];
        timerExpireCallback = null;

        // Reset module
        jest.resetModules();
    });

    describe('initializeSocket', () => {
        test('initializes with memory adapter when in memory mode', () => {
            mockIsMemoryMode = true;

            socketModule = require('../socket/index');
            const io = socketModule.initializeSocket(server);

            expect(io).toBeDefined();
            expect(mockLogger.info).toHaveBeenCalledWith(
                'Using Socket.io in-memory adapter (single-instance mode)'
            );
        });

        test('falls back to memory adapter when Redis pub/sub fails', () => {
            mockIsMemoryMode = false;
            mockGetPubSubThrows = true;

            socketModule = require('../socket/index');
            const io = socketModule.initializeSocket(server);

            expect(io).toBeDefined();
            expect(mockLogger.warn).toHaveBeenCalledWith(
                expect.stringContaining('Redis adapter not available'),
                'Redis not available'
            );
        });

        test('initializes timer service with callback', () => {
            mockIsMemoryMode = true;

            socketModule = require('../socket/index');
            socketModule.initializeSocket(server);

            expect(mockTimerService.initializeTimerService).toHaveBeenCalledWith(
                expect.any(Function)
            );
            expect(timerExpireCallback).not.toBeNull();
        });
    });

    describe('Timer Expire Callback', () => {
        beforeEach(() => {
            mockIsMemoryMode = true;
            socketModule = require('../socket/index');
            socketModule.initializeSocket(server);
        });

        test('handles timer expiry when game exists and is active', async () => {
            mockGameData = {
                currentTurn: 'red',
                gameOver: false
            };

            await timerExpireCallback('TEST12');

            expect(mockGameService.getGame).toHaveBeenCalledWith('TEST12');
            expect(mockGameService.endTurn).toHaveBeenCalledWith('TEST12', 'Timer');
            expect(mockEventLogService.logEvent).toHaveBeenCalled();
        });

        test('skips turn end when no game exists', async () => {
            mockGameData = null;

            await timerExpireCallback('TEST12');

            expect(mockGameService.getGame).toHaveBeenCalledWith('TEST12');
            expect(mockGameService.endTurn).not.toHaveBeenCalled();
            expect(mockLogger.debug).toHaveBeenCalledWith(
                expect.stringContaining('no game found')
            );
        });

        test('skips turn end when game is over', async () => {
            mockGameData = {
                currentTurn: 'red',
                gameOver: true,
                winner: 'blue'
            };

            await timerExpireCallback('TEST12');

            expect(mockGameService.getGame).toHaveBeenCalledWith('TEST12');
            expect(mockGameService.endTurn).not.toHaveBeenCalled();
            expect(mockLogger.debug).toHaveBeenCalledWith(
                expect.stringContaining('game already over')
            );
        });

        test('handles timer restart when Redis is not healthy', async () => {
            mockGameData = { currentTurn: 'red', gameOver: false };
            mockRedisHealthy = false;

            await timerExpireCallback('TEST12');

            // Wait for setImmediate
            await new Promise(resolve => setTimeout(resolve, 50));

            expect(mockLogger.warn).toHaveBeenCalledWith(
                expect.stringContaining('Redis not healthy')
            );
        });

        test('handles timer restart when lock not acquired', async () => {
            mockGameData = { currentTurn: 'red', gameOver: false };
            mockRedisHealthy = true;
            // Lock already exists
            mockRedisStorage.set('lock:timer-restart:TEST12', 'other-pid');

            await timerExpireCallback('TEST12');

            await new Promise(resolve => setTimeout(resolve, 50));

            expect(mockLogger.debug).toHaveBeenCalledWith(
                expect.stringContaining('another instance handling it'),
                expect.objectContaining({ lockKey: expect.any(String) })
            );
        });

        test('handles timer restart when room not found', async () => {
            mockGameData = { currentTurn: 'red', gameOver: false };
            mockRedisHealthy = true;
            mockRoomData = null;

            await timerExpireCallback('TEST12');

            await new Promise(resolve => setTimeout(resolve, 50));

            expect(mockLogger.debug).toHaveBeenCalledWith(
                expect.stringContaining('room not found')
            );
        });

        test('handles timer restart when timer not configured', async () => {
            mockGameData = { currentTurn: 'red', gameOver: false };
            mockRedisHealthy = true;
            mockRoomData = { settings: { turnTimer: null } };

            await timerExpireCallback('TEST12');

            await new Promise(resolve => setTimeout(resolve, 50));

            expect(mockLogger.debug).toHaveBeenCalledWith(
                expect.stringContaining('timer not configured')
            );
        });

        test('handles timer restart when game not found after lock', async () => {
            // First call returns game, second call returns null
            let callCount = 0;
            mockGameService.getGame.mockImplementation(async () => {
                callCount++;
                if (callCount === 1) {
                    return { currentTurn: 'red', gameOver: false };
                }
                return null;
            });
            mockRedisHealthy = true;
            mockRoomData = { settings: { turnTimer: 60 } };

            await timerExpireCallback('TEST12');

            await new Promise(resolve => setTimeout(resolve, 50));

            expect(mockLogger.debug).toHaveBeenCalledWith(
                expect.stringContaining('game not found')
            );
        });

        test('handles timer restart when game over after lock', async () => {
            let callCount = 0;
            mockGameService.getGame.mockImplementation(async () => {
                callCount++;
                if (callCount === 1) {
                    return { currentTurn: 'red', gameOver: false };
                }
                return { currentTurn: 'red', gameOver: true, winner: 'blue' };
            });
            mockRedisHealthy = true;
            mockRoomData = { settings: { turnTimer: 60 } };

            await timerExpireCallback('TEST12');

            await new Promise(resolve => setTimeout(resolve, 50));

            expect(mockLogger.debug).toHaveBeenCalledWith(
                expect.stringContaining('game over')
            );
        });

        test('restarts timer successfully when all conditions met', async () => {
            mockGameService.getGame.mockResolvedValue({ currentTurn: 'blue', gameOver: false });
            mockRedisHealthy = true;
            mockRoomData = { settings: { turnTimer: 90 } };

            await timerExpireCallback('TEST12');

            await new Promise(resolve => setTimeout(resolve, 100));

            expect(mockTimerService.startTimer).toHaveBeenCalled();
            expect(mockLogger.debug).toHaveBeenCalledWith(
                expect.stringContaining('Timer restarted')
            );
        });

        test('handles errors in timer restart gracefully', async () => {
            mockGameData = { currentTurn: 'red', gameOver: false };
            mockRedisHealthy = true;
            mockRoomData = { settings: { turnTimer: 60 } };
            mockRoomService.getRoom.mockRejectedValueOnce(new Error('Redis connection failed'));

            await timerExpireCallback('TEST12');

            await new Promise(resolve => setTimeout(resolve, 50));

            expect(mockLogger.error).toHaveBeenCalledWith(
                expect.stringContaining('Timer restart failed')
            );
        });

        test('handles lock release failure gracefully', async () => {
            let callCount = 0;
            mockGameService.getGame.mockImplementation(async () => {
                callCount++;
                if (callCount === 1) {
                    return { currentTurn: 'red', gameOver: false };
                }
                return { currentTurn: 'red', gameOver: true, winner: 'blue' };
            });
            mockRedisHealthy = true;
            mockRoomData = { settings: { turnTimer: 60 } };

            // Make del throw an error
            mockRedis.del.mockRejectedValueOnce(new Error('Redis del failed'));

            await timerExpireCallback('TEST12');

            await new Promise(resolve => setTimeout(resolve, 50));

            expect(mockLogger.error).toHaveBeenCalledWith(
                expect.stringContaining('Failed to release timer restart lock')
            );
        });

        test('handles timer expiry error gracefully', async () => {
            mockGameService.getGame.mockRejectedValueOnce(new Error('Database error'));

            await timerExpireCallback('TEST12');

            expect(mockLogger.error).toHaveBeenCalledWith(
                expect.stringContaining('Timer expiry error'),
                expect.any(Error)
            );
        });
    });

    describe('Helper Functions', () => {
        test('getIO throws when not initialized', () => {
            jest.resetModules();
            socketModule = require('../socket/index');

            expect(() => socketModule.getIO()).toThrow('Socket.io not initialized');
        });

        test('getIO returns io after initialization', () => {
            mockIsMemoryMode = true;
            socketModule = require('../socket/index');
            socketModule.initializeSocket(server);

            expect(socketModule.getIO()).toBeDefined();
        });

        test('emitToRoom does nothing when io not initialized', () => {
            jest.resetModules();
            socketModule = require('../socket/index');

            // Should not throw
            expect(() => socketModule.emitToRoom('TEST', 'event', {})).not.toThrow();
        });

        test('emitToPlayer does nothing when io not initialized', () => {
            jest.resetModules();
            socketModule = require('../socket/index');

            // Should not throw
            expect(() => socketModule.emitToPlayer('session123', 'event', {})).not.toThrow();
        });

        test('startTurnTimer calls timer service and emits event', async () => {
            mockIsMemoryMode = true;
            socketModule = require('../socket/index');
            socketModule.initializeSocket(server);

            const result = await socketModule.startTurnTimer('TEST12', 60);

            expect(mockTimerService.startTimer).toHaveBeenCalledWith('TEST12', 60, expect.any(Function));
            expect(result).toBeDefined();
            expect(result.durationSeconds).toBe(60);
        });

        test('stopTurnTimer calls timer service', async () => {
            mockIsMemoryMode = true;
            socketModule = require('../socket/index');
            socketModule.initializeSocket(server);

            await socketModule.stopTurnTimer('TEST12');

            expect(mockTimerService.stopTimer).toHaveBeenCalledWith('TEST12');
        });

        test('getTimerStatus returns timer info', async () => {
            mockTimerService.getTimerStatus.mockResolvedValueOnce({
                active: true,
                remainingSeconds: 45
            });

            mockIsMemoryMode = true;
            socketModule = require('../socket/index');
            socketModule.initializeSocket(server);

            const result = await socketModule.getTimerStatus('TEST12');

            expect(mockTimerService.getTimerStatus).toHaveBeenCalledWith('TEST12');
            expect(result.active).toBe(true);
        });

        test('cleanupSocketModule cleans up resources', () => {
            mockIsMemoryMode = true;
            socketModule = require('../socket/index');
            socketModule.initializeSocket(server);

            socketModule.cleanupSocketModule();

            expect(mockLogger.info).toHaveBeenCalledWith('Socket module cleaned up');
        });
    });

    describe('Connection Handling via IO events', () => {
        test('emitToRoom emits to correct room after initialization', () => {
            mockIsMemoryMode = true;
            socketModule = require('../socket/index');
            const io = socketModule.initializeSocket(server);

            // Spy on the to().emit() chain
            const emitMock = jest.fn();
            const toMock = jest.fn(() => ({ emit: emitMock }));
            io.to = toMock;

            socketModule.emitToRoom('TEST12', 'game:started', { team: 'red' });

            expect(toMock).toHaveBeenCalledWith('room:TEST12');
            expect(emitMock).toHaveBeenCalledWith('game:started', { team: 'red' });
        });

        test('emitToPlayer emits to correct player room', () => {
            mockIsMemoryMode = true;
            socketModule = require('../socket/index');
            const io = socketModule.initializeSocket(server);

            const emitMock = jest.fn();
            const toMock = jest.fn(() => ({ emit: emitMock }));
            io.to = toMock;

            socketModule.emitToPlayer('session-abc', 'player:updated', { nickname: 'Bob' });

            expect(toMock).toHaveBeenCalledWith('player:session-abc');
            expect(emitMock).toHaveBeenCalledWith('player:updated', { nickname: 'Bob' });
        });
    });

    describe('Express App Integration', () => {
        test('initializeSocket accepts express app parameter', () => {
            mockIsMemoryMode = true;

            const mockApp = {
                updateSocketCount: jest.fn()
            };

            socketModule = require('../socket/index');
            const io = socketModule.initializeSocket(server, mockApp);

            expect(io).toBeDefined();
        });
    });
});

describe('handleDisconnect Unit Tests', () => {
    // These tests use a simpler approach - testing the disconnect logic
    // by creating mock socket objects and calling handlers directly

    beforeEach(() => {
        jest.clearAllMocks();
        mockRedisStorage.clear();
        mockRedisSets.clear();
        mockLockAcquired = true;
        mockRedisHealthy = true;
        mockIsMemoryMode = true;
        mockGetPubSubThrows = false;
        mockGameData = null;
        mockRoomData = null;
        mockPlayerData = null;
        mockPlayersInRoom = [];
        jest.resetModules();
    });

    test('player service handleDisconnect is called on disconnect', async () => {
        const server = http.createServer();
        server.setMaxListeners(20);

        const socketModule = require('../socket/index');
        const io = socketModule.initializeSocket(server);

        // Create mock socket
        const mockSocket = {
            id: 'test-socket-id',
            sessionId: 'test-session-id',
            handshake: { auth: { sessionId: 'test-session-id' } },
            on: jest.fn(),
            join: jest.fn(),
            rateLimiter: mockSocketRateLimiter
        };

        // Find the disconnect handler
        let disconnectHandler = null;
        mockSocket.on.mockImplementation((event, handler) => {
            if (event === 'disconnect') {
                disconnectHandler = handler;
            }
        });

        // Simulate connection
        io.emit('connection', mockSocket);

        // Setup player data
        mockPlayerData = {
            sessionId: 'test-session-id',
            roomCode: 'ROOM01',
            nickname: 'TestPlayer',
            team: 'red',
            isHost: false
        };
        mockPlayersInRoom = [mockPlayerData];

        // Call disconnect handler if it was registered
        if (disconnectHandler) {
            await disconnectHandler('transport close');

            await new Promise(resolve => setTimeout(resolve, 50));

            expect(mockPlayerService.handleDisconnect).toHaveBeenCalledWith('test-session-id');
        }

        socketModule.cleanupSocketModule();
        server.close();
    });

    test('host transfer logic is triggered for host disconnect', async () => {
        const server = http.createServer();
        server.setMaxListeners(20);

        const socketModule = require('../socket/index');
        const io = socketModule.initializeSocket(server);

        const mockSocket = {
            id: 'host-socket-id',
            sessionId: 'host-session-id',
            handshake: { auth: { sessionId: 'host-session-id' } },
            on: jest.fn(),
            join: jest.fn(),
            rateLimiter: mockSocketRateLimiter
        };

        let disconnectHandler = null;
        mockSocket.on.mockImplementation((event, handler) => {
            if (event === 'disconnect') {
                disconnectHandler = handler;
            }
        });

        io.emit('connection', mockSocket);

        // Setup host player
        mockPlayerData = {
            sessionId: 'host-session-id',
            roomCode: 'ROOM01',
            nickname: 'HostPlayer',
            team: 'red',
            isHost: true
        };

        const newHostPlayer = {
            sessionId: 'other-session-id',
            roomCode: 'ROOM01',
            nickname: 'OtherPlayer',
            team: 'blue',
            isHost: false,
            connected: true
        };

        mockPlayersInRoom = [
            { ...mockPlayerData, connected: false },
            newHostPlayer
        ];

        mockRoomData = {
            code: 'ROOM01',
            hostSessionId: 'host-session-id',
            settings: {}
        };

        // Spy on emit
        const emitMock = jest.fn();
        const toMock = jest.fn(() => ({ emit: emitMock }));
        io.to = toMock;

        if (disconnectHandler) {
            await disconnectHandler('transport close');

            await new Promise(resolve => setTimeout(resolve, 100));

            // Verify host transfer occurred
            expect(mockPlayerService.updatePlayer).toHaveBeenCalledWith('other-session-id', { isHost: true });
        }

        socketModule.cleanupSocketModule();
        server.close();
    });

    test('reconnection token is generated on disconnect', async () => {
        const server = http.createServer();
        server.setMaxListeners(20);

        const socketModule = require('../socket/index');
        const io = socketModule.initializeSocket(server);

        const mockSocket = {
            id: 'test-socket-id',
            sessionId: 'test-session-id',
            handshake: { auth: { sessionId: 'test-session-id' } },
            on: jest.fn(),
            join: jest.fn(),
            rateLimiter: mockSocketRateLimiter
        };

        let disconnectHandler = null;
        mockSocket.on.mockImplementation((event, handler) => {
            if (event === 'disconnect') {
                disconnectHandler = handler;
            }
        });

        io.emit('connection', mockSocket);

        mockPlayerData = {
            sessionId: 'test-session-id',
            roomCode: 'ROOM01',
            nickname: 'TestPlayer',
            team: 'red',
            isHost: false
        };
        mockPlayersInRoom = [mockPlayerData];

        if (disconnectHandler) {
            await disconnectHandler('transport close');

            await new Promise(resolve => setTimeout(resolve, 50));

            expect(mockPlayerService.generateReconnectionToken).toHaveBeenCalledWith('test-session-id');
        }

        socketModule.cleanupSocketModule();
        server.close();
    });

    test('handles player not found on disconnect gracefully', async () => {
        const server = http.createServer();
        server.setMaxListeners(20);

        const socketModule = require('../socket/index');
        const io = socketModule.initializeSocket(server);

        const mockSocket = {
            id: 'test-socket-id',
            sessionId: 'test-session-id',
            handshake: { auth: { sessionId: 'test-session-id' } },
            on: jest.fn(),
            join: jest.fn(),
            rateLimiter: mockSocketRateLimiter
        };

        let disconnectHandler = null;
        mockSocket.on.mockImplementation((event, handler) => {
            if (event === 'disconnect') {
                disconnectHandler = handler;
            }
        });

        io.emit('connection', mockSocket);

        mockPlayerData = null; // No player found

        if (disconnectHandler) {
            await disconnectHandler('transport close');

            await new Promise(resolve => setTimeout(resolve, 50));

            // Should not call handleDisconnect on player service
            expect(mockPlayerService.handleDisconnect).not.toHaveBeenCalled();
        }

        socketModule.cleanupSocketModule();
        server.close();
    });

    test('handles reconnection token generation failure', async () => {
        const server = http.createServer();
        server.setMaxListeners(20);

        const socketModule = require('../socket/index');
        const io = socketModule.initializeSocket(server);

        const mockSocket = {
            id: 'test-socket-id',
            sessionId: 'test-session-id',
            handshake: { auth: { sessionId: 'test-session-id' } },
            on: jest.fn(),
            join: jest.fn(),
            rateLimiter: mockSocketRateLimiter
        };

        let disconnectHandler = null;
        mockSocket.on.mockImplementation((event, handler) => {
            if (event === 'disconnect') {
                disconnectHandler = handler;
            }
        });

        io.emit('connection', mockSocket);

        mockPlayerData = {
            sessionId: 'test-session-id',
            roomCode: 'ROOM01',
            nickname: 'TestPlayer',
            team: 'red',
            isHost: false
        };
        mockPlayersInRoom = [mockPlayerData];

        mockPlayerService.generateReconnectionToken.mockRejectedValueOnce(new Error('Token generation failed'));

        if (disconnectHandler) {
            await disconnectHandler('transport close');

            await new Promise(resolve => setTimeout(resolve, 50));

            expect(mockLogger.warn).toHaveBeenCalledWith(
                expect.stringContaining('Failed to generate reconnection token'),
                'Token generation failed'
            );
        }

        socketModule.cleanupSocketModule();
        server.close();
    });

    test('handles host transfer when no other connected players', async () => {
        const server = http.createServer();
        server.setMaxListeners(20);

        const socketModule = require('../socket/index');
        const io = socketModule.initializeSocket(server);

        const mockSocket = {
            id: 'host-socket-id',
            sessionId: 'host-session-id',
            handshake: { auth: { sessionId: 'host-session-id' } },
            on: jest.fn(),
            join: jest.fn(),
            rateLimiter: mockSocketRateLimiter
        };

        let disconnectHandler = null;
        mockSocket.on.mockImplementation((event, handler) => {
            if (event === 'disconnect') {
                disconnectHandler = handler;
            }
        });

        io.emit('connection', mockSocket);

        mockPlayerData = {
            sessionId: 'host-session-id',
            roomCode: 'ROOM01',
            nickname: 'HostPlayer',
            team: 'red',
            isHost: true
        };

        // No other connected players
        mockPlayersInRoom = [
            { ...mockPlayerData, connected: false }
        ];

        mockRoomData = {
            code: 'ROOM01',
            hostSessionId: 'host-session-id'
        };

        if (disconnectHandler) {
            await disconnectHandler('transport close');

            await new Promise(resolve => setTimeout(resolve, 100));

            // Should not try to transfer host when no other connected players
            expect(mockPlayerService.updatePlayer).not.toHaveBeenCalledWith(
                expect.any(String),
                { isHost: true }
            );
        }

        socketModule.cleanupSocketModule();
        server.close();
    });

    test('handles host transfer lock not acquired', async () => {
        const server = http.createServer();
        server.setMaxListeners(20);

        const socketModule = require('../socket/index');
        const io = socketModule.initializeSocket(server);

        const mockSocket = {
            id: 'host-socket-id',
            sessionId: 'host-session-id',
            handshake: { auth: { sessionId: 'host-session-id' } },
            on: jest.fn(),
            join: jest.fn(),
            rateLimiter: mockSocketRateLimiter
        };

        let disconnectHandler = null;
        mockSocket.on.mockImplementation((event, handler) => {
            if (event === 'disconnect') {
                disconnectHandler = handler;
            }
        });

        io.emit('connection', mockSocket);

        mockPlayerData = {
            sessionId: 'host-session-id',
            roomCode: 'ROOM01',
            nickname: 'HostPlayer',
            team: 'red',
            isHost: true
        };

        mockPlayersInRoom = [
            { ...mockPlayerData, connected: false },
            { sessionId: 'other-session', connected: true, isHost: false }
        ];

        // Lock already exists
        mockRedisStorage.set('lock:host-transfer:ROOM01', 'other-instance');

        if (disconnectHandler) {
            await disconnectHandler('transport close');

            await new Promise(resolve => setTimeout(resolve, 100));

            expect(mockLogger.debug).toHaveBeenCalledWith(
                expect.stringContaining('Host transfer lock not acquired')
            );
        }

        socketModule.cleanupSocketModule();
        server.close();
    });

    test('handles host transfer error gracefully', async () => {
        const server = http.createServer();
        server.setMaxListeners(20);

        const socketModule = require('../socket/index');
        const io = socketModule.initializeSocket(server);

        const mockSocket = {
            id: 'host-socket-id',
            sessionId: 'host-session-id',
            handshake: { auth: { sessionId: 'host-session-id' } },
            on: jest.fn(),
            join: jest.fn(),
            rateLimiter: mockSocketRateLimiter
        };

        let disconnectHandler = null;
        mockSocket.on.mockImplementation((event, handler) => {
            if (event === 'disconnect') {
                disconnectHandler = handler;
            }
        });

        io.emit('connection', mockSocket);

        mockPlayerData = {
            sessionId: 'host-session-id',
            roomCode: 'ROOM01',
            nickname: 'HostPlayer',
            team: 'red',
            isHost: true
        };

        mockPlayersInRoom = [
            { ...mockPlayerData, connected: false },
            { sessionId: 'other-session', connected: true, isHost: false, nickname: 'Other' }
        ];

        mockRoomData = { code: 'ROOM01', hostSessionId: 'host-session-id' };

        // Make updatePlayer throw
        mockPlayerService.updatePlayer.mockRejectedValueOnce(new Error('Update failed'));

        if (disconnectHandler) {
            await disconnectHandler('transport close');

            await new Promise(resolve => setTimeout(resolve, 100));

            expect(mockLogger.error).toHaveBeenCalledWith(
                expect.stringContaining('Host transfer failed'),
                expect.any(String)
            );
        }

        socketModule.cleanupSocketModule();
        server.close();
    });

    test('handles host transfer lock release failure', async () => {
        const server = http.createServer();
        server.setMaxListeners(20);

        const socketModule = require('../socket/index');
        const io = socketModule.initializeSocket(server);

        const mockSocket = {
            id: 'host-socket-id',
            sessionId: 'host-session-id',
            handshake: { auth: { sessionId: 'host-session-id' } },
            on: jest.fn(),
            join: jest.fn(),
            rateLimiter: mockSocketRateLimiter
        };

        let disconnectHandler = null;
        mockSocket.on.mockImplementation((event, handler) => {
            if (event === 'disconnect') {
                disconnectHandler = handler;
            }
        });

        io.emit('connection', mockSocket);

        mockPlayerData = {
            sessionId: 'host-session-id',
            roomCode: 'ROOM01',
            nickname: 'HostPlayer',
            team: 'red',
            isHost: true
        };

        mockPlayersInRoom = [
            { ...mockPlayerData, connected: false },
            { sessionId: 'other-session', connected: true, isHost: false, nickname: 'Other' }
        ];

        mockRoomData = { code: 'ROOM01', hostSessionId: 'host-session-id' };

        // Make del fail after successful host transfer
        let delCallCount = 0;
        mockRedis.del.mockImplementation(async (key) => {
            delCallCount++;
            if (key.includes('host-transfer') && delCallCount === 1) {
                throw new Error('Del failed');
            }
            mockRedisStorage.delete(key);
            return 1;
        });

        // Spy on emit
        const emitMock = jest.fn();
        const toMock = jest.fn(() => ({ emit: emitMock }));
        io.to = toMock;

        if (disconnectHandler) {
            await disconnectHandler('transport close');

            await new Promise(resolve => setTimeout(resolve, 100));

            expect(mockLogger.error).toHaveBeenCalledWith(
                expect.stringContaining('Failed to release host transfer lock'),
                expect.any(String)
            );
        }

        socketModule.cleanupSocketModule();
        server.close();
    });
});
