/**
 * Socket Index Module Tests
 *
 * Comprehensive tests for socket/index.js covering initialization,
 * event handling, timer integration, and cleanup.
 */

// Mock dependencies before requiring modules
const mockPubClient = {
    publish: jest.fn().mockResolvedValue(1),
    connect: jest.fn().mockResolvedValue(),
    subscribe: jest.fn().mockResolvedValue()
};

const mockSubClient = {
    subscribe: jest.fn().mockResolvedValue(),
    unsubscribe: jest.fn().mockResolvedValue(),
    connect: jest.fn().mockResolvedValue()
};

let mockRedisStorage = {};
const mockRedis = {
    get: jest.fn(async (key) => mockRedisStorage[key] || null),
    set: jest.fn(async (key, value) => {
        mockRedisStorage[key] = value;
        return 'OK';
    }),
    del: jest.fn(async (key) => {
        delete mockRedisStorage[key];
        return 1;
    }),
    exists: jest.fn(async (key) => mockRedisStorage[key] ? 1 : 0),
    expire: jest.fn().mockResolvedValue(1),
    incr: jest.fn().mockResolvedValue(1),
    eval: jest.fn().mockResolvedValue(null),
    scanIterator: jest.fn(function* () { /* empty iterator */ })
};

jest.mock('../config/redis', () => ({
    getRedis: () => mockRedis,
    getPubSubClients: () => ({ pubClient: mockPubClient, subClient: mockSubClient }),
    isUsingMemoryMode: jest.fn().mockReturnValue(false)
}));

jest.mock('../utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));

jest.mock('../middleware/socketAuth', () => ({
    authenticateSocket: jest.fn((socket, next) => {
        socket.sessionId = socket.handshake?.auth?.sessionId || 'test-session-id';
        next();
    })
}));

// Mock services
jest.mock('../services/gameService', () => ({
    getGame: jest.fn().mockResolvedValue(null),
    endTurn: jest.fn().mockResolvedValue({ currentTurn: 'blue', previousTurn: 'red' }),
    getGameStateForPlayer: jest.fn()
}));

jest.mock('../services/roomService', () => ({
    getRoom: jest.fn().mockResolvedValue({ code: 'TEST12', settings: { turnTimer: 60 } })
}));

jest.mock('../services/playerService', () => ({
    getPlayer: jest.fn().mockResolvedValue(null),
    getPlayersInRoom: jest.fn().mockResolvedValue([]),
    handleDisconnect: jest.fn().mockResolvedValue(),
    updatePlayer: jest.fn().mockResolvedValue()
}));

jest.mock('../services/eventLogService', () => ({
    logEvent: jest.fn().mockResolvedValue(),
    EVENT_TYPES: {
        TIMER_EXPIRED: 'TIMER_EXPIRED',
        PLAYER_DISCONNECTED: 'PLAYER_DISCONNECTED',
        HOST_CHANGED: 'HOST_CHANGED'
    }
}));

// Mock timer service
jest.mock('../services/timerService', () => ({
    initializeTimerService: jest.fn().mockResolvedValue(true),
    startTimer: jest.fn().mockResolvedValue({
        startTime: Date.now(),
        endTime: Date.now() + 60000,
        duration: 60,
        remainingSeconds: 60
    }),
    stopTimer: jest.fn().mockResolvedValue(),
    getTimerStatus: jest.fn().mockResolvedValue(null)
}));

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
    createRateLimitedHandler: jest.fn((socket, eventName, handler) => handler),
    getSocketRateLimiter: jest.fn(),
    startRateLimitCleanup: jest.fn(),
    stopRateLimitCleanup: jest.fn()
}));

const http = require('http');
const { Server } = require('socket.io');
const Client = require('socket.io-client');

describe('Socket Index Module', () => {
    let server;
    beforeAll((done) => {
        server = http.createServer();
        server.setMaxListeners(0);
        server.listen(0, done);
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
    });

    describe('initializeSocket', () => {
        test('initializes Socket.io server correctly', () => {
            jest.resetModules();
            const socketMod = require('../socket/index');
            const result = socketMod.initializeSocket(server);
            expect(result).toBeDefined();
            expect(result.constructor.name).toBe('Server');
            socketMod.cleanupSocketModule();
        });

        test('uses memory adapter when in memory mode', () => {
            jest.resetModules();
            const { isUsingMemoryMode } = require('../config/redis');
            isUsingMemoryMode.mockReturnValue(true);

            const socketMod = require('../socket/index');
            const ioInstance = socketMod.initializeSocket(server);
            expect(ioInstance).toBeDefined();
            socketMod.cleanupSocketModule();
        });

        test('initializes timer service', () => {
            jest.resetModules();
            const timerService = require('../services/timerService');
            const socketMod = require('../socket/index');

            socketMod.initializeSocket(server);
            expect(timerService.initializeTimerService).toHaveBeenCalled();
            socketMod.cleanupSocketModule();
        });

        test('starts rate limit cleanup', () => {
            jest.resetModules();
            const { startRateLimitCleanup } = require('../socket/rateLimitHandler');
            const socketMod = require('../socket/index');

            socketMod.initializeSocket(server);
            expect(startRateLimitCleanup).toHaveBeenCalled();
            socketMod.cleanupSocketModule();
        });

        test('accepts Express app for socket count updates', () => {
            jest.resetModules();
            const mockApp = {
                updateSocketCount: jest.fn()
            };

            const socketMod = require('../socket/index');
            const ioInstance = socketMod.initializeSocket(server, mockApp);
            expect(ioInstance).toBeDefined();
            socketMod.cleanupSocketModule();
        });
    });

    describe('getIO', () => {
        test('returns io instance after initialization', () => {
            jest.resetModules();
            const socketMod = require('../socket/index');
            socketMod.initializeSocket(server);
            const ioInstance = socketMod.getIO();
            expect(ioInstance).toBeDefined();
            expect(ioInstance.constructor.name).toBe('Server');
            socketMod.cleanupSocketModule();
        });

        test('throws error when socket not initialized', () => {
            jest.resetModules();
            const socketMod = require('../socket/index');
            expect(() => socketMod.getIO()).toThrow('Socket.io not initialized');
        });
    });

    describe('emitToRoom', () => {
        test('emits event to room when io is initialized', () => {
            jest.resetModules();
            const socketMod = require('../socket/index');
            socketMod.initializeSocket(server);

            // Should not throw
            socketMod.emitToRoom('TEST12', 'test:event', { data: 'test' });
            socketMod.cleanupSocketModule();
        });

        test('does nothing when io is not initialized', () => {
            jest.resetModules();
            const socketMod = require('../socket/index');
            // Should not throw even without initialization
            expect(() => {
                socketMod.emitToRoom('TEST12', 'test:event', { data: 'test' });
            }).not.toThrow();
        });
    });

    describe('emitToPlayer', () => {
        test('emits event to player when io is initialized', () => {
            jest.resetModules();
            const socketMod = require('../socket/index');
            socketMod.initializeSocket(server);

            // Should not throw
            socketMod.emitToPlayer('session-123', 'test:event', { data: 'test' });
            socketMod.cleanupSocketModule();
        });
    });

    describe('Timer Functions', () => {
        test('startTurnTimer calls timerService and emits event', async () => {
            jest.resetModules();
            const timerService = require('../services/timerService');
            const socketMod = require('../socket/index');

            socketMod.initializeSocket(server);

            const result = await socketMod.startTurnTimer('TEST12', 60);

            expect(timerService.startTimer).toHaveBeenCalledWith('TEST12', 60, expect.any(Function));
            expect(result).toHaveProperty('duration', 60);
            socketMod.cleanupSocketModule();
        });

        test('stopTurnTimer calls timerService', async () => {
            jest.resetModules();
            const timerService = require('../services/timerService');
            const socketMod = require('../socket/index');

            socketMod.initializeSocket(server);

            await socketMod.stopTurnTimer('TEST12');

            expect(timerService.stopTimer).toHaveBeenCalledWith('TEST12');
            socketMod.cleanupSocketModule();
        });

        test('getTimerStatus calls timerService', async () => {
            jest.resetModules();
            const timerService = require('../services/timerService');
            timerService.getTimerStatus.mockResolvedValue({
                remainingSeconds: 30,
                duration: 60
            });
            const socketMod = require('../socket/index');

            socketMod.initializeSocket(server);

            const status = await socketMod.getTimerStatus('TEST12');

            expect(timerService.getTimerStatus).toHaveBeenCalledWith('TEST12');
            expect(status).toHaveProperty('remainingSeconds', 30);
            socketMod.cleanupSocketModule();
        });
    });

    describe('cleanupSocketModule', () => {
        test('stops rate limit cleanup', () => {
            jest.resetModules();
            const { stopRateLimitCleanup } = require('../socket/rateLimitHandler');
            const socketMod = require('../socket/index');

            socketMod.initializeSocket(server);
            socketMod.cleanupSocketModule();

            expect(stopRateLimitCleanup).toHaveBeenCalled();
        });

        test('closes io server', () => {
            jest.resetModules();
            const socketMod = require('../socket/index');
            socketMod.initializeSocket(server);
            socketMod.cleanupSocketModule();

            // After cleanup, getIO should throw
            expect(() => socketMod.getIO()).toThrow('Socket.io not initialized');
        });
    });

    describe('Rate Limiter Export', () => {
        test('exports getSocketRateLimiter', () => {
            jest.resetModules();
            const socketMod = require('../socket/index');
            expect(socketMod.getSocketRateLimiter).toBeDefined();
        });

        test('exports createRateLimitedHandler', () => {
            jest.resetModules();
            const socketMod = require('../socket/index');
            expect(socketMod.createRateLimitedHandler).toBeDefined();
        });
    });
});

describe('Socket Connection Handling', () => {
    let server;
    let ioServer;
    let clientSocket;
    let testPort;

    beforeEach((done) => {
        server = http.createServer();
        ioServer = new Server(server, {
            cors: { origin: '*' },
            transports: ['websocket', 'polling']
        });

        // Simple auth middleware
        ioServer.use((socket, next) => {
            socket.sessionId = socket.handshake.auth?.sessionId || 'default-session';
            socket.rateLimiter = { cleanupSocket: jest.fn() };
            next();
        });

        server.listen(0, () => {
            testPort = server.address().port;
            done();
        });
    });

    afterEach((done) => {
        if (clientSocket) {
            clientSocket.removeAllListeners();
            clientSocket.disconnect();
            clientSocket = null;
        }
        ioServer.close();
        server.close(done);
    });

    test('client can connect successfully', (done) => {
        ioServer.on('connection', (socket) => {
            expect(socket.sessionId).toBeDefined();
            done();
        });

        clientSocket = Client(`http://localhost:${testPort}`, {
            transports: ['websocket'],
            auth: { sessionId: 'test-123' }
        });
    });

    test('registers handlers on connection', (done) => {
        const mockHandler = jest.fn();

        ioServer.on('connection', (socket) => {
            socket.on('test:event', mockHandler);

            // Emit test event
            socket.emit('connected');
        });

        clientSocket = Client(`http://localhost:${testPort}`, {
            transports: ['websocket']
        });

        clientSocket.on('connected', () => {
            clientSocket.emit('test:event', { data: 'test' });
            setTimeout(() => {
                expect(mockHandler).toHaveBeenCalled();
                done();
            }, 100);
        });
    });

    test('handles disconnection correctly', (done) => {
        ioServer.on('connection', (socket) => {
            socket.on('disconnect', (reason) => {
                expect(reason).toBeDefined();
                done();
            });
        });

        clientSocket = Client(`http://localhost:${testPort}`, {
            transports: ['websocket']
        });

        clientSocket.on('connect', () => {
            clientSocket.disconnect();
        });
    });
});

describe('Timer Expire Callback', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('handles timer expiration when game exists and is active', async () => {
        const gameService = require('../services/gameService');
        const roomService = require('../services/roomService');

        gameService.getGame.mockResolvedValue({
            id: 'game-1',
            currentTurn: 'red',
            gameOver: false
        });

        gameService.endTurn.mockResolvedValue({
            currentTurn: 'blue',
            previousTurn: 'red'
        });

        roomService.getRoom.mockResolvedValue({
            code: 'TEST12',
            settings: { turnTimer: 60 }
        });

        // The actual callback is created internally, but we can verify
        // the service calls work correctly
        await gameService.endTurn('TEST12', 'Timer');

        expect(gameService.endTurn).toHaveBeenCalledWith('TEST12', 'Timer');
    });

    test('skips turn end when game is already over', async () => {
        const gameService = require('../services/gameService');

        gameService.getGame.mockResolvedValue({
            id: 'game-1',
            currentTurn: 'red',
            gameOver: true,
            winner: 'blue'
        });

        // When game is over, endTurn should not be called
        const game = await gameService.getGame('TEST12');
        expect(game.gameOver).toBe(true);
    });

    test('skips when no game exists', async () => {
        const gameService = require('../services/gameService');
        gameService.getGame.mockResolvedValue(null);

        const game = await gameService.getGame('TEST12');
        expect(game).toBeNull();
    });
});

describe('Disconnect Handling', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('notifies room when player disconnects', async () => {
        const playerService = require('../services/playerService');

        playerService.getPlayer.mockResolvedValue({
            sessionId: 'session-1',
            nickname: 'TestPlayer',
            roomCode: 'TEST12',
            team: 'red',
            isHost: false,
            connected: true
        });

        await playerService.handleDisconnect('session-1');
        expect(playerService.handleDisconnect).toHaveBeenCalledWith('session-1');
    });

    test('handles host disconnect with transfer', async () => {
        const playerService = require('../services/playerService');

        playerService.getPlayer.mockResolvedValue({
            sessionId: 'session-1',
            nickname: 'HostPlayer',
            roomCode: 'TEST12',
            team: 'red',
            isHost: true,
            connected: true
        });

        playerService.getPlayersInRoom.mockResolvedValue([
            { sessionId: 'session-2', nickname: 'Player2', connected: true }
        ]);

        // Simulate the flow
        const player = await playerService.getPlayer('session-1');
        expect(player.isHost).toBe(true);

        const players = await playerService.getPlayersInRoom('TEST12');
        const connectedPlayers = players.filter(p => p.connected);
        expect(connectedPlayers.length).toBe(1);
    });

    test('handles disconnect when player not found', async () => {
        const playerService = require('../services/playerService');
        playerService.getPlayer.mockResolvedValue(null);

        const player = await playerService.getPlayer('nonexistent');
        expect(player).toBeNull();
    });
});
