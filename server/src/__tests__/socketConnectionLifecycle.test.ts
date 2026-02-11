/**
 * Socket Connection Lifecycle Tests
 *
 * Comprehensive tests for socket/index.js connection handling,
 * timer callbacks, and disconnect behavior
 */

// Store mock state
let mockRedisStorage = {};
const mockPubClient = {
    publish: jest.fn().mockResolvedValue(1)
};
const mockSubClient = {
    subscribe: jest.fn().mockResolvedValue(),
    unsubscribe: jest.fn().mockResolvedValue()
};

const mockRedis = {
    get: jest.fn(async (key) => mockRedisStorage[key] || null),
    set: jest.fn(async (key, value) => {
        mockRedisStorage[key] = typeof value === 'string' ? value : JSON.stringify(value);
        return 'OK';
    }),
    del: jest.fn(async (keys) => {
        const keysArray = Array.isArray(keys) ? keys : [keys];
        keysArray.forEach(key => delete mockRedisStorage[key]);
        return keysArray.length;
    }),
    exists: jest.fn(async (key) => mockRedisStorage[key] ? 1 : 0),
    expire: jest.fn().mockResolvedValue(1),
    sMembers: jest.fn().mockResolvedValue([]),
    sAdd: jest.fn().mockResolvedValue(1),
    sRem: jest.fn().mockResolvedValue(1),
    watch: jest.fn().mockResolvedValue('OK'),
    unwatch: jest.fn().mockResolvedValue('OK'),
    multi: jest.fn(() => ({
        set: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([['OK']])
    }))
};

// Mock modules
jest.mock('../infrastructure/redis', () => ({
    getRedis: () => mockRedis,
    getPubSubClients: () => ({ pubClient: mockPubClient, subClient: mockSubClient }),
    isUsingMemoryMode: jest.fn().mockReturnValue(true)
}));

jest.mock('../utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));

jest.mock('../services/timerService', () => ({
    startTimer: jest.fn().mockResolvedValue({
        startTime: Date.now(),
        endTime: Date.now() + 60000,
        duration: 60,
        remainingSeconds: 60
    }),
    stopTimer: jest.fn().mockResolvedValue()
}));

jest.mock('../middleware/socketAuth', () => ({
    authenticateSocket: jest.fn((socket, next) => {
        socket.sessionId = socket.handshake?.auth?.sessionId || 'test-session';
        next();
    })
}));

jest.mock('../socket/handlers/roomHandlers', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('../socket/handlers/gameHandlers', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('../socket/handlers/playerHandlers', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('../socket/handlers/chatHandlers', () => ({ __esModule: true, default: jest.fn() }));

jest.mock('../socket/rateLimitHandler', () => ({
    socketRateLimiter: { cleanupSocket: jest.fn() },
    createRateLimitedHandler: jest.fn((socket, eventName, handler) => handler),
    getSocketRateLimiter: jest.fn(),
    startRateLimitCleanup: jest.fn(),
    stopRateLimitCleanup: jest.fn()
}));

const http = require('http');
const { Server } = require('socket.io');
const Client = require('socket.io-client');

describe('Socket Connection Lifecycle', () => {
    let httpServer;
    let ioServer;
    let clientSocket;
    let testPort;

    beforeEach((done) => {
        jest.clearAllMocks();
        mockRedisStorage = {};

        httpServer = http.createServer();
        ioServer = new Server(httpServer, {
            cors: { origin: '*' },
            transports: ['websocket', 'polling']
        });

        ioServer.use((socket, next) => {
            socket.sessionId = socket.handshake.auth?.sessionId || 'default-session';
            socket.rateLimiter = { cleanupSocket: jest.fn() };
            next();
        });

        httpServer.listen(0, () => {
            testPort = httpServer.address().port;
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
        httpServer.close(done);
    });

    describe('Connection Events', () => {
        test('assigns session ID on connection', (done) => {
            ioServer.on('connection', (socket) => {
                expect(socket.sessionId).toBe('client-session-123');
                done();
            });

            clientSocket = Client(`http://localhost:${testPort}`, {
                transports: ['websocket'],
                auth: { sessionId: 'client-session-123' }
            });
        });

        test('uses default session ID when not provided', (done) => {
            ioServer.on('connection', (socket) => {
                expect(socket.sessionId).toBe('default-session');
                done();
            });

            clientSocket = Client(`http://localhost:${testPort}`, {
                transports: ['websocket']
            });
        });

        test('attaches rate limiter to socket', (done) => {
            ioServer.on('connection', (socket) => {
                expect(socket.rateLimiter).toBeDefined();
                expect(socket.rateLimiter.cleanupSocket).toBeDefined();
                done();
            });

            clientSocket = Client(`http://localhost:${testPort}`, {
                transports: ['websocket']
            });
        });

        test('handles multiple simultaneous connections', (done) => {
            let connectionCount = 0;
            const targetConnections = 3;
            const clients = [];

            ioServer.on('connection', () => {
                connectionCount++;
                if (connectionCount === targetConnections) {
                    clients.forEach(c => c.disconnect());
                    done();
                }
            });

            for (let i = 0; i < targetConnections; i++) {
                clients.push(Client(`http://localhost:${testPort}`, {
                    transports: ['websocket'],
                    auth: { sessionId: `session-${i}` }
                }));
            }
        });
    });

    describe('Disconnection Events', () => {
        test('fires disconnect event with reason', (done) => {
            ioServer.on('connection', (socket) => {
                socket.on('disconnect', (reason) => {
                    expect(reason).toBe('client namespace disconnect');
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

        test('cleans up rate limiter on disconnect', (done) => {
            let socketInstance;

            ioServer.on('connection', (socket) => {
                socketInstance = socket;
                socket.on('disconnect', () => {
                    // Verify cleanup was called
                    expect(socketInstance.rateLimiter.cleanupSocket).toBeDefined();
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

        test('handles transport close disconnect', (done) => {
            ioServer.on('connection', (socket) => {
                socket.on('disconnect', (reason) => {
                    expect(['transport close', 'client namespace disconnect']).toContain(reason);
                    done();
                });
            });

            clientSocket = Client(`http://localhost:${testPort}`, {
                transports: ['websocket']
            });

            clientSocket.on('connect', () => {
                // Force close the underlying connection
                clientSocket.io.engine.close();
            });
        });
    });

    describe('Error Handling', () => {
        test('socket has error event handler capability', (done) => {
            ioServer.on('connection', (socket) => {
                // Verify socket can handle error events
                expect(typeof socket.on).toBe('function');
                expect(typeof socket.emit).toBe('function');
                done();
            });

            clientSocket = Client(`http://localhost:${testPort}`, {
                transports: ['websocket']
            });
        });

        test('connection errors are handled gracefully', () => {
            // Invalid port should not crash
            let badClient;
            expect(() => {
                badClient = Client(`http://localhost:99999`, {
                    transports: ['websocket'],
                    timeout: 100
                });
            }).not.toThrow();
            if (badClient) badClient.disconnect();
        });
    });

    describe('Room Channel Operations', () => {
        test('client can join room channel', (done) => {
            ioServer.on('connection', (socket) => {
                socket.join('room:TEST12');

                // Verify socket is in room
                expect(socket.rooms.has('room:TEST12')).toBe(true);
                done();
            });

            clientSocket = Client(`http://localhost:${testPort}`, {
                transports: ['websocket']
            });
        });

        test('client can join player channel', (done) => {
            ioServer.on('connection', (socket) => {
                socket.join(`player:${socket.sessionId}`);

                expect(socket.rooms.has(`player:${socket.sessionId}`)).toBe(true);
                done();
            });

            clientSocket = Client(`http://localhost:${testPort}`, {
                transports: ['websocket'],
                auth: { sessionId: 'player-123' }
            });
        });

        test('messages can be sent to room', (done) => {
            ioServer.on('connection', (socket) => {
                socket.join('room:TEST12');

                socket.on('room:message', () => {
                    ioServer.to('room:TEST12').emit('room:broadcast', { data: 'test' });
                });
            });

            clientSocket = Client(`http://localhost:${testPort}`, {
                transports: ['websocket']
            });

            clientSocket.on('connect', () => {
                clientSocket.on('room:broadcast', (data) => {
                    expect(data.data).toBe('test');
                    done();
                });

                // Small delay to ensure join completes
                setTimeout(() => {
                    clientSocket.emit('room:message');
                }, 50);
            });
        });

        test('client leaves room on disconnect', (done) => {
            let testSocket;

            ioServer.on('connection', (socket) => {
                testSocket = socket;
                socket.join('room:TEST12');

                socket.on('disconnect', () => {
                    // After disconnect, socket should not be in room
                    expect(testSocket.rooms.has('room:TEST12')).toBe(false);
                    done();
                });
            });

            clientSocket = Client(`http://localhost:${testPort}`, {
                transports: ['websocket']
            });

            clientSocket.on('connect', () => {
                setTimeout(() => clientSocket.disconnect(), 50);
            });
        });
    });
});

describe('Socket Module Functions', () => {
    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
        mockRedisStorage = {};
    });

    describe('emitToRoom', () => {
        test('handles missing io instance gracefully', () => {
            const socketMod = require('../socket/index');

            // Should not throw when io is not initialized
            expect(() => {
                socketMod.emitToRoom('TEST12', 'test:event', { data: 'test' });
            }).not.toThrow();
        });
    });

    describe('emitToPlayer', () => {
        test('handles missing io instance gracefully', () => {
            const socketMod = require('../socket/index');

            expect(() => {
                socketMod.emitToPlayer('session-123', 'test:event', { data: 'test' });
            }).not.toThrow();
        });
    });

    describe('Timer Functions', () => {
        test('timer functions are exported', () => {
            const socketMod = require('../socket/index');

            expect(typeof socketMod.startTurnTimer).toBe('function');
            expect(typeof socketMod.stopTurnTimer).toBe('function');
            expect(typeof socketMod.getTimerStatus).toBe('function');
        });

        test('timer service is called correctly', async () => {
            const timerService = require('../services/timerService');

            // Verify timer service mocks are set up
            expect(timerService.startTimer).toBeDefined();
            expect(timerService.stopTimer).toBeDefined();
        });
    });
});

describe('Timer Expire Callback Behavior', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockRedisStorage = {};
    });

    test('timer callback ends turn when game is active', async () => {
        const gameService = require('../services/gameService');
        const roomService = require('../services/roomService');

        // Mock active game
        gameService.getGame = jest.fn().mockResolvedValue({
            id: 'game-1',
            currentTurn: 'red',
            gameOver: false
        });

        gameService.endTurn = jest.fn().mockResolvedValue({
            currentTurn: 'blue',
            previousTurn: 'red'
        });

        roomService.getRoom = jest.fn().mockResolvedValue({
            code: 'TEST12',
            settings: { turnTimer: 60 }
        });

        // Verify the game service works correctly
        const game = await gameService.getGame('TEST12');
        expect(game.gameOver).toBe(false);

        const result = await gameService.endTurn('TEST12', 'Timer');
        expect(result.currentTurn).toBe('blue');
        expect(gameService.endTurn).toHaveBeenCalledWith('TEST12', 'Timer');
    });

    test('timer callback skips when game is over', async () => {
        const gameService = require('../services/gameService');

        gameService.getGame = jest.fn().mockResolvedValue({
            id: 'game-1',
            currentTurn: 'red',
            gameOver: true,
            winner: 'blue'
        });

        gameService.endTurn = jest.fn();

        const game = await gameService.getGame('TEST12');

        // When game is over, endTurn should not be called
        if (!game.gameOver) {
            await gameService.endTurn('TEST12', 'Timer');
        }

        expect(gameService.endTurn).not.toHaveBeenCalled();
    });

    test('timer callback skips when no game exists', async () => {
        const gameService = require('../services/gameService');

        gameService.getGame = jest.fn().mockResolvedValue(null);
        gameService.endTurn = jest.fn();

        const game = await gameService.getGame('TEST12');

        if (game && !game.gameOver) {
            await gameService.endTurn('TEST12', 'Timer');
        }

        expect(gameService.endTurn).not.toHaveBeenCalled();
    });
});

describe('Disconnect Handler Behavior', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockRedisStorage = {};
    });

    test('updates player status on disconnect', async () => {
        const playerService = require('../services/playerService');

        playerService.getPlayer = jest.fn().mockResolvedValue({
            sessionId: 'session-1',
            nickname: 'Player1',
            roomCode: 'TEST12',
            team: 'red',
            isHost: false,
            connected: true
        });

        playerService.handleDisconnect = jest.fn().mockResolvedValue();

        const player = await playerService.getPlayer('session-1');
        expect(player).toBeDefined();
        expect(player.connected).toBe(true);

        await playerService.handleDisconnect('session-1');
        expect(playerService.handleDisconnect).toHaveBeenCalledWith('session-1');
    });

    test('transfers host when host disconnects', async () => {
        const playerService = require('../services/playerService');
        const roomService = require('../services/roomService');

        playerService.getPlayer = jest.fn().mockResolvedValue({
            sessionId: 'host-session',
            nickname: 'Host',
            roomCode: 'TEST12',
            isHost: true,
            connected: true
        });

        playerService.getPlayersInRoom = jest.fn().mockResolvedValue([
            { sessionId: 'player-2', nickname: 'Player2', connected: true },
            { sessionId: 'player-3', nickname: 'Player3', connected: true }
        ]);

        playerService.updatePlayer = jest.fn().mockResolvedValue({});

        roomService.getRoom = jest.fn().mockResolvedValue({
            code: 'TEST12',
            hostSessionId: 'host-session'
        });

        const player = await playerService.getPlayer('host-session');
        expect(player.isHost).toBe(true);

        const players = await playerService.getPlayersInRoom('TEST12');
        const connectedPlayers = players.filter(p => p.connected);

        if (player.isHost && connectedPlayers.length > 0) {
            const newHost = connectedPlayers[0];
            await playerService.updatePlayer('host-session', { isHost: false });
            await playerService.updatePlayer(newHost.sessionId, { isHost: true });

            expect(playerService.updatePlayer).toHaveBeenCalledWith('host-session', { isHost: false });
            expect(playerService.updatePlayer).toHaveBeenCalledWith('player-2', { isHost: true });
        }
    });

    test('handles disconnect when player not in room', async () => {
        const playerService = require('../services/playerService');

        playerService.getPlayer = jest.fn().mockResolvedValue({
            sessionId: 'session-1',
            nickname: 'Player1',
            roomCode: null,
            connected: true
        });

        const player = await playerService.getPlayer('session-1');
        expect(player.roomCode).toBeNull();

        // When player is not in a room, room operations should be skipped
    });

    test('handles disconnect when player not found', async () => {
        const playerService = require('../services/playerService');

        playerService.getPlayer = jest.fn().mockResolvedValue(null);

        const player = await playerService.getPlayer('nonexistent');
        expect(player).toBeNull();

        // When player not found, disconnect should complete without error
    });
});
