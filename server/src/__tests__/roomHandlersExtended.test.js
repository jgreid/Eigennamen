/**
 * Extended Room Handlers Tests
 * Tests additional edge cases and code paths to improve coverage
 * Updated for simplified room ID API (no passwords)
 */

// Mock rate limit handler FIRST to bypass rate limiting
jest.mock('../socket/rateLimitHandler', () => ({
    createRateLimitedHandler: jest.fn((socket, eventName, handler) => handler)
}));

// Mock dependencies
jest.mock('../services/roomService');
jest.mock('../services/playerService');
jest.mock('../services/gameService');
jest.mock('../services/eventLogService');
jest.mock('../utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));
jest.mock('../utils/timeout', () => ({
    withTimeout: jest.fn(async (promise) => {
        try {
            return await promise;
        } catch (error) {
            throw error;
        }
    }),
    TIMEOUTS: {
        SOCKET_HANDLER: 5000,
        JOIN_ROOM: 5000,
        RECONNECT: 5000
    }
}));

// Mock socketFunctionProvider
jest.mock('../socket/socketFunctionProvider', () => ({
    getSocketFunctions: jest.fn(() => ({
        startTurnTimer: jest.fn().mockResolvedValue({}),
        stopTurnTimer: jest.fn().mockResolvedValue(),
        emitToRoom: jest.fn(),
        emitToPlayer: jest.fn(),
        getTimerStatus: jest.fn().mockResolvedValue(null),
        getIO: jest.fn()
    })),
    isRegistered: jest.fn(() => true)
}));

const roomService = require('../services/roomService');
const playerService = require('../services/playerService');
const gameService = require('../services/gameService');
const eventLogService = require('../services/eventLogService');
const { withTimeout: _withTimeout } = require('../utils/timeout');

describe('Extended Room Handlers Tests', () => {
    let mockSocket;
    let mockIo;
    let roomHandlers;

    beforeEach(() => {
        jest.clearAllMocks();

        mockSocket = {
            id: 'socket-123',
            sessionId: 'session-456',
            roomCode: null,
            emit: jest.fn(),
            on: jest.fn(),
            join: jest.fn(),
            leave: jest.fn(),
            to: jest.fn().mockReturnThis()
        };

        mockIo = {
            to: jest.fn().mockReturnThis(),
            emit: jest.fn()
        };

        eventLogService.logEvent = jest.fn().mockResolvedValue();
        eventLogService.EVENT_TYPES = {
            ROOM_CREATED: 'ROOM_CREATED',
            PLAYER_JOINED: 'PLAYER_JOINED',
            PLAYER_LEFT: 'PLAYER_LEFT',
            SETTINGS_UPDATED: 'SETTINGS_UPDATED'
        };

        // Default: no player (since mockSocket.roomCode = null by default)
        playerService.getPlayer.mockResolvedValue(null);
        gameService.getGame.mockResolvedValue(null);
        playerService.getRoomStats.mockResolvedValue({});

        roomHandlers = require('../socket/handlers/roomHandlers');
        roomHandlers(mockIo, mockSocket);
    });

    describe('room:create edge cases', () => {
        test('creates room successfully', async () => {
            roomService.createRoom.mockResolvedValue({
                room: { code: 'my-game', roomId: 'my-game', settings: {} },
                player: { sessionId: 'session-456', nickname: 'Host', isHost: true }
            });

            const handlers = mockSocket.on.mock.calls;
            const createHandler = handlers.find(h => h[0] === 'room:create');
            await createHandler[1]({ roomId: 'my-game', settings: { turnTimer: 60 } });

            expect(roomService.createRoom).toHaveBeenCalledWith('my-game', 'session-456', { turnTimer: 60 });
            expect(mockSocket.join).toHaveBeenCalledWith('room:my-game');
            expect(mockSocket.emit).toHaveBeenCalledWith('room:created', expect.anything());
            expect(mockSocket.roomCode).toBe('my-game');
        });

        test('cleans up on error after partial creation', async () => {
            roomService.createRoom.mockResolvedValue({
                room: { code: 'test-room', roomId: 'test-room', settings: {} },
                player: { sessionId: 'session-456' }
            });
            eventLogService.logEvent.mockRejectedValue(new Error('Log error'));

            const handlers = mockSocket.on.mock.calls;
            const createHandler = handlers.find(h => h[0] === 'room:create');
            await createHandler[1]({ roomId: 'test-room' });

            // Check room was still created even if logging failed
            expect(mockSocket.join).toHaveBeenCalledWith('room:test-room');
        });

        test('handles createRoom error', async () => {
            roomService.createRoom.mockRejectedValue(new Error('Create failed'));

            const handlers = mockSocket.on.mock.calls;
            const createHandler = handlers.find(h => h[0] === 'room:create');
            await createHandler[1]({ roomId: 'my-game' });

            expect(mockSocket.emit).toHaveBeenCalledWith('room:error', expect.objectContaining({
                message: 'Create failed'
            }));
        });

        test('normalizes room ID to lowercase in socket.roomCode', async () => {
            roomService.createRoom.mockResolvedValue({
                room: { code: 'mygame', roomId: 'MyGame', settings: {} },
                player: { sessionId: 'session-456', nickname: 'Host', isHost: true }
            });

            const handlers = mockSocket.on.mock.calls;
            const createHandler = handlers.find(h => h[0] === 'room:create');
            await createHandler[1]({ roomId: 'MyGame', settings: {} });

            expect(mockSocket.roomCode).toBe('mygame');
        });
    });

    describe('room:join edge cases', () => {
        test('joins room successfully', async () => {
            roomService.joinRoom.mockResolvedValue({
                room: { code: 'test-room', roomId: 'test-room', settings: {} },
                players: [],
                game: null,
                player: { sessionId: 'session-456', nickname: 'Player1' }
            });
            playerService.invalidateReconnectionToken.mockResolvedValue();

            const handlers = mockSocket.on.mock.calls;
            const joinHandler = handlers.find(h => h[0] === 'room:join');
            await joinHandler[1]({ roomId: 'test-room', nickname: 'Player1' });

            expect(roomService.joinRoom).toHaveBeenCalledWith('test-room', 'session-456', 'Player1');
            expect(mockSocket.join).toHaveBeenCalledWith('room:test-room');
            expect(mockSocket.emit).toHaveBeenCalledWith('room:joined', expect.anything());
        });
    });

    describe('room:leave edge cases', () => {
        test('handles leave when not in room', async () => {
            mockSocket.roomCode = null;
            playerService.getPlayer.mockResolvedValue(null);

            const handlers = mockSocket.on.mock.calls;
            const leaveHandler = handlers.find(h => h[0] === 'room:leave');
            await leaveHandler[1]();

            expect(roomService.leaveRoom).not.toHaveBeenCalled();
        });

        test('leaves room and notifies others', async () => {
            mockSocket.roomCode = 'test-room';
            playerService.getPlayer.mockResolvedValue({ sessionId: 'session-456', roomCode: 'test-room' });
            roomService.leaveRoom.mockResolvedValue({ newHostId: 'new-host-123' });
            playerService.invalidateReconnectionToken.mockResolvedValue();

            const handlers = mockSocket.on.mock.calls;
            const leaveHandler = handlers.find(h => h[0] === 'room:leave');
            await leaveHandler[1]();

            expect(mockSocket.leave).toHaveBeenCalledWith('room:test-room');
            expect(mockIo.emit).toHaveBeenCalledWith('room:playerLeft', expect.objectContaining({
                sessionId: 'session-456',
                newHost: 'new-host-123'
            }));
            expect(mockSocket.roomCode).toBeNull();
        });

        test('handles leave error', async () => {
            mockSocket.roomCode = 'test-room';
            playerService.getPlayer.mockResolvedValue({ sessionId: 'session-456', roomCode: 'test-room' });
            roomService.leaveRoom.mockRejectedValue(new Error('Leave failed'));
            playerService.invalidateReconnectionToken.mockResolvedValue();

            const handlers = mockSocket.on.mock.calls;
            const leaveHandler = handlers.find(h => h[0] === 'room:leave');
            await leaveHandler[1]();

            expect(mockSocket.emit).toHaveBeenCalledWith('room:error', expect.objectContaining({
                message: 'An unexpected error occurred'
            }));
        });
    });

    describe('room:settings edge cases', () => {
        test('updates room settings', async () => {
            mockSocket.roomCode = 'test-room';
            playerService.getPlayer.mockResolvedValue({ sessionId: 'session-456', roomCode: 'test-room', isHost: true });
            roomService.updateSettings.mockResolvedValue({ turnTimer: 90 });

            const handlers = mockSocket.on.mock.calls;
            const settingsHandler = handlers.find(h => h[0] === 'room:settings');
            await settingsHandler[1]({ turnTimer: 90 });

            expect(mockIo.emit).toHaveBeenCalledWith('room:settingsUpdated', { settings: { turnTimer: 90 } });
        });

        test('handles settings update without roomCode', async () => {
            mockSocket.roomCode = null;

            const handlers = mockSocket.on.mock.calls;
            const settingsHandler = handlers.find(h => h[0] === 'room:settings');
            await settingsHandler[1]({ turnTimer: 90 });

            expect(mockSocket.emit).toHaveBeenCalledWith('room:error', expect.objectContaining({
                code: expect.any(String)
            }));
        });

        test('handles settings update error', async () => {
            mockSocket.roomCode = 'test-room';
            playerService.getPlayer.mockResolvedValue({ sessionId: 'session-456', roomCode: 'test-room', isHost: true });
            roomService.updateSettings.mockRejectedValue(new Error('Update failed'));

            const handlers = mockSocket.on.mock.calls;
            const settingsHandler = handlers.find(h => h[0] === 'room:settings');
            await settingsHandler[1]({ turnTimer: 90 });

            expect(mockSocket.emit).toHaveBeenCalledWith('room:error', expect.objectContaining({
                message: 'An unexpected error occurred'
            }));
        });
    });

    describe('room:resync edge cases', () => {
        test('resyncs full room state', async () => {
            mockSocket.roomCode = 'test-room';
            roomService.getRoom.mockResolvedValue({ code: 'test-room', roomId: 'test-room', settings: {} });
            playerService.getPlayer.mockResolvedValue({ sessionId: 'session-456', roomCode: 'test-room', role: 'clicker' });
            playerService.getPlayersInRoom.mockResolvedValue([]);
            gameService.getGame.mockResolvedValue(null);

            const handlers = mockSocket.on.mock.calls;
            const resyncHandler = handlers.find(h => h[0] === 'room:resync');
            await resyncHandler[1]();

            expect(mockSocket.emit).toHaveBeenCalledWith('room:resynced', expect.objectContaining({
                room: expect.anything(),
                players: expect.anything(),
                you: expect.anything()
            }));
        });

        test('includes game state when game exists', async () => {
            mockSocket.roomCode = 'test-room';
            const mockGame = { id: 'game-1', currentTurn: 'red' };
            roomService.getRoom.mockResolvedValue({ code: 'test-room', roomId: 'test-room', settings: {} });
            playerService.getPlayer.mockResolvedValue({ sessionId: 'session-456', roomCode: 'test-room', role: 'clicker' });
            playerService.getPlayersInRoom.mockResolvedValue([]);
            gameService.getGame.mockResolvedValue(mockGame);
            gameService.getGameStateForPlayer.mockReturnValue({ id: 'game-1' });

            const handlers = mockSocket.on.mock.calls;
            const resyncHandler = handlers.find(h => h[0] === 'room:resync');
            await resyncHandler[1]();

            expect(gameService.getGameStateForPlayer).toHaveBeenCalled();
        });

        test('sends spymaster view on resync for spymaster', async () => {
            mockSocket.roomCode = 'test-room';
            const mockGame = { id: 'game-1', types: ['red', 'blue'], gameOver: false };
            roomService.getRoom.mockResolvedValue({ code: 'test-room', roomId: 'test-room', settings: {} });
            playerService.getPlayer.mockResolvedValue({ sessionId: 'session-456', roomCode: 'test-room', role: 'spymaster' });
            playerService.getPlayersInRoom.mockResolvedValue([]);
            gameService.getGame.mockResolvedValue(mockGame);
            gameService.getGameStateForPlayer.mockReturnValue({ id: 'game-1' });

            const handlers = mockSocket.on.mock.calls;
            const resyncHandler = handlers.find(h => h[0] === 'room:resync');
            await resyncHandler[1]();

            expect(mockSocket.emit).toHaveBeenCalledWith('game:spymasterView', expect.anything());
        });

        test('handles resync without roomCode', async () => {
            mockSocket.roomCode = null;

            const handlers = mockSocket.on.mock.calls;
            const resyncHandler = handlers.find(h => h[0] === 'room:resync');
            await resyncHandler[1]();

            expect(mockSocket.emit).toHaveBeenCalledWith('room:error', expect.objectContaining({
                code: expect.any(String)
            }));
        });
    });

    describe('room:getReconnectionToken edge cases', () => {
        test('returns existing token if available', async () => {
            mockSocket.roomCode = 'test-room';
            playerService.getPlayer.mockResolvedValue({ sessionId: 'session-456', roomCode: 'test-room' });
            playerService.getExistingReconnectionToken.mockResolvedValue('existing-token');

            const handlers = mockSocket.on.mock.calls;
            const tokenHandler = handlers.find(h => h[0] === 'room:getReconnectionToken');
            await tokenHandler[1]();

            expect(playerService.generateReconnectionToken).not.toHaveBeenCalled();
            expect(mockSocket.emit).toHaveBeenCalledWith('room:reconnectionToken', expect.objectContaining({
                token: 'existing-token'
            }));
        });

        test('generates new token if none exists', async () => {
            mockSocket.roomCode = 'test-room';
            playerService.getPlayer.mockResolvedValue({ sessionId: 'session-456', roomCode: 'test-room' });
            playerService.getExistingReconnectionToken.mockResolvedValue(null);
            playerService.generateReconnectionToken.mockResolvedValue('new-token');

            const handlers = mockSocket.on.mock.calls;
            const tokenHandler = handlers.find(h => h[0] === 'room:getReconnectionToken');
            await tokenHandler[1]();

            expect(playerService.generateReconnectionToken).toHaveBeenCalledWith('session-456');
            expect(mockSocket.emit).toHaveBeenCalledWith('room:reconnectionToken', expect.objectContaining({
                token: 'new-token'
            }));
        });

        test('handles token generation failure', async () => {
            mockSocket.roomCode = 'test-room';
            playerService.getPlayer.mockResolvedValue({ sessionId: 'session-456', roomCode: 'test-room' });
            playerService.getExistingReconnectionToken.mockResolvedValue(null);
            playerService.generateReconnectionToken.mockResolvedValue(null);

            const handlers = mockSocket.on.mock.calls;
            const tokenHandler = handlers.find(h => h[0] === 'room:getReconnectionToken');
            await tokenHandler[1]();

            expect(mockSocket.emit).toHaveBeenCalledWith('room:error', expect.objectContaining({
                message: 'An unexpected error occurred'
            }));
        });

        test('handles missing roomCode', async () => {
            mockSocket.roomCode = null;

            const handlers = mockSocket.on.mock.calls;
            const tokenHandler = handlers.find(h => h[0] === 'room:getReconnectionToken');
            await tokenHandler[1]();

            expect(mockSocket.emit).toHaveBeenCalledWith('room:error', expect.objectContaining({
                code: expect.any(String)
            }));
        });
    });

    describe('room:reconnect edge cases', () => {
        test('reconnects with valid token', async () => {
            const mockPlayer = { sessionId: 'session-456', nickname: 'Player1', team: 'red', role: 'clicker' };
            playerService.validateReconnectionToken.mockResolvedValue({
                valid: true,
                tokenData: { roomCode: 'test-room', sessionId: 'session-456' }
            });
            roomService.getRoom.mockResolvedValue({ code: 'test-room', roomId: 'test-room', settings: {} });
            playerService.updatePlayer.mockResolvedValue(mockPlayer);
            playerService.getPlayer.mockResolvedValue(mockPlayer);
            playerService.getPlayersInRoom.mockResolvedValue([mockPlayer]);
            gameService.getGame.mockResolvedValue(null);

            const handlers = mockSocket.on.mock.calls;
            const reconnectHandler = handlers.find(h => h[0] === 'room:reconnect');
            await reconnectHandler[1]({ code: 'test-room', reconnectionToken: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' });

            expect(mockSocket.join).toHaveBeenCalledWith('room:test-room');
            expect(mockSocket.emit).toHaveBeenCalledWith('room:reconnected', expect.anything());
        });

        test('rejects invalid token', async () => {
            playerService.validateReconnectionToken.mockResolvedValue({
                valid: false,
                reason: 'Token expired'
            });

            const handlers = mockSocket.on.mock.calls;
            const reconnectHandler = handlers.find(h => h[0] === 'room:reconnect');
            await reconnectHandler[1]({ code: 'test-room', reconnectionToken: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' });

            expect(mockSocket.emit).toHaveBeenCalledWith('room:error', expect.objectContaining({
                code: 'NOT_AUTHORIZED',
                message: expect.stringContaining('Token expired')
            }));
        });

        test('rejects token for wrong room', async () => {
            playerService.validateReconnectionToken.mockResolvedValue({
                valid: true,
                tokenData: { roomCode: 'different-room', sessionId: 'session-456' }
            });

            const handlers = mockSocket.on.mock.calls;
            const reconnectHandler = handlers.find(h => h[0] === 'room:reconnect');
            await reconnectHandler[1]({ code: 'test-room', reconnectionToken: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' });

            expect(mockSocket.emit).toHaveBeenCalledWith('room:error', expect.objectContaining({
                message: 'Token does not match room'
            }));
        });

        test('handles missing data', async () => {
            const handlers = mockSocket.on.mock.calls;
            const reconnectHandler = handlers.find(h => h[0] === 'room:reconnect');
            await reconnectHandler[1]({});

            expect(mockSocket.emit).toHaveBeenCalledWith('room:error', expect.objectContaining({
                code: 'INVALID_INPUT'
            }));
        });

        test('handles null data', async () => {
            const handlers = mockSocket.on.mock.calls;
            const reconnectHandler = handlers.find(h => h[0] === 'room:reconnect');
            await reconnectHandler[1](null);

            expect(mockSocket.emit).toHaveBeenCalledWith('room:error', expect.objectContaining({
                code: 'INVALID_INPUT'
            }));
        });

        test('sends spymaster view on reconnect for spymaster', async () => {
            const mockPlayer = { sessionId: 'session-456', nickname: 'Spymaster1', team: 'red', role: 'spymaster' };
            const mockGame = { id: 'game-1', types: ['red', 'blue'], gameOver: false };

            playerService.validateReconnectionToken.mockResolvedValue({
                valid: true,
                tokenData: { roomCode: 'test-room', sessionId: 'session-456' }
            });
            roomService.getRoom.mockResolvedValue({ code: 'test-room', roomId: 'test-room', settings: {} });
            playerService.updatePlayer.mockResolvedValue(mockPlayer);
            playerService.getPlayer.mockResolvedValue(mockPlayer);
            playerService.getPlayersInRoom.mockResolvedValue([mockPlayer]);
            gameService.getGame.mockResolvedValue(mockGame);
            gameService.getGameStateForPlayer.mockReturnValue({ id: 'game-1' });

            const handlers = mockSocket.on.mock.calls;
            const reconnectHandler = handlers.find(h => h[0] === 'room:reconnect');
            await reconnectHandler[1]({ code: 'test-room', reconnectionToken: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' });

            expect(mockSocket.emit).toHaveBeenCalledWith('game:spymasterView', expect.anything());
        });
    });
});
