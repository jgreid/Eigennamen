/**
 * Extended Room Handlers Tests
 * Tests additional edge cases and code paths to improve coverage
 * Updated for simplified room ID API (no passwords)
 */

// Mock rate limit handler FIRST to bypass rate limiting
const { SAFE_ERROR_CODES, createMockRateLimitHandler } = require('../helpers/mocks');
jest.mock('../../socket/rateLimitHandler', () => ({
    createRateLimitedHandler: createMockRateLimitHandler(SAFE_ERROR_CODES),
}));

// Mock dependencies
jest.mock('../../services/roomService');
jest.mock('../../services/playerService');
jest.mock('../../services/gameService');
jest.mock('../../utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
}));
jest.mock('../../utils/timeout', () => ({
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
        RECONNECT: 5000,
    },
}));

// Mock socketFunctionProvider
jest.mock('../../socket/socketFunctionProvider', () => ({
    getSocketFunctions: jest.fn(() => ({
        startTurnTimer: jest.fn().mockResolvedValue({}),
        stopTurnTimer: jest.fn().mockResolvedValue(),
        emitToRoom: jest.fn(),
        emitToPlayer: jest.fn(),
        getTimerStatus: jest.fn().mockResolvedValue(null),
        getIO: jest.fn(),
    })),
    isRegistered: jest.fn(() => true),
}));

const roomService = require('../../services/roomService');
const playerService = require('../../services/playerService');
const gameService = require('../../services/gameService');
const { withTimeout: _withTimeout } = require('../../utils/timeout');
const { clearGameStateCache } = require('../../socket/playerContext');

describe('Extended Room Handlers Tests', () => {
    let mockSocket;
    let mockIo;
    let roomHandlers;

    beforeEach(() => {
        jest.clearAllMocks();
        clearGameStateCache();

        mockSocket = {
            id: 'socket-123',
            sessionId: 'session-456',
            roomCode: null,
            emit: jest.fn(),
            on: jest.fn(),
            join: jest.fn(),
            leave: jest.fn(),
            to: jest.fn().mockReturnThis(),
        };

        mockIo = {
            to: jest.fn().mockReturnThis(),
            emit: jest.fn(),
        };

        // Default: no player (since mockSocket.roomCode = null by default)
        playerService.getPlayer.mockResolvedValue(null);
        gameService.getGame.mockResolvedValue(null);
        playerService.getRoomStats.mockResolvedValue({});

        roomHandlers = require('../../socket/handlers/roomHandlers');
        roomHandlers(mockIo, mockSocket);
    });

    describe('room:create edge cases', () => {
        test('normalizes room ID to lowercase in socket.roomCode', async () => {
            roomService.createRoom.mockResolvedValue({
                room: { code: 'mygame', roomId: 'MyGame', settings: {} },
                player: { sessionId: 'session-456', nickname: 'Host', isHost: true },
            });

            const handlers = mockSocket.on.mock.calls;
            const createHandler = handlers.find((h) => h[0] === 'room:create');
            await createHandler[1]({ roomId: 'MyGame', settings: {} });

            expect(mockSocket.roomCode).toBe('mygame');
        });
    });

    describe('room:settings edge cases', () => {
        test('handles settings update error', async () => {
            mockSocket.roomCode = 'test-room';
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-456',
                roomCode: 'test-room',
                isHost: true,
            });
            roomService.updateSettings.mockRejectedValue(new Error('Update failed'));

            const handlers = mockSocket.on.mock.calls;
            const settingsHandler = handlers.find((h) => h[0] === 'room:settings');
            await settingsHandler[1]({ turnTimer: 90 });

            expect(mockSocket.emit).toHaveBeenCalledWith(
                'room:error',
                expect.objectContaining({
                    message: 'An unexpected error occurred',
                })
            );
        });
    });

    describe('room:resync edge cases', () => {
        test('resyncs full room state', async () => {
            mockSocket.roomCode = 'test-room';
            roomService.getRoom.mockResolvedValue({ code: 'test-room', roomId: 'test-room', settings: {} });
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-456',
                roomCode: 'test-room',
                role: 'clicker',
            });
            playerService.getPlayersInRoom.mockResolvedValue([]);
            gameService.getGame.mockResolvedValue(null);

            const handlers = mockSocket.on.mock.calls;
            const resyncHandler = handlers.find((h) => h[0] === 'room:resync');
            await resyncHandler[1]();

            expect(mockSocket.emit).toHaveBeenCalledWith(
                'room:resynced',
                expect.objectContaining({
                    room: expect.anything(),
                    players: expect.anything(),
                    you: expect.anything(),
                })
            );
        });

        test('includes game state when game exists', async () => {
            mockSocket.roomCode = 'test-room';
            const mockGame = { id: 'game-1', currentTurn: 'red' };
            roomService.getRoom.mockResolvedValue({ code: 'test-room', roomId: 'test-room', settings: {} });
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-456',
                roomCode: 'test-room',
                role: 'clicker',
            });
            playerService.getPlayersInRoom.mockResolvedValue([]);
            gameService.getGame.mockResolvedValue(mockGame);
            gameService.getGameStateForPlayer.mockReturnValue({ id: 'game-1' });

            const handlers = mockSocket.on.mock.calls;
            const resyncHandler = handlers.find((h) => h[0] === 'room:resync');
            await resyncHandler[1]();

            expect(gameService.getGameStateForPlayer).toHaveBeenCalled();
        });

        test('sends spymaster view on resync for spymaster', async () => {
            mockSocket.roomCode = 'test-room';
            const mockGame = { id: 'game-1', types: ['red', 'blue'], gameOver: false };
            roomService.getRoom.mockResolvedValue({ code: 'test-room', roomId: 'test-room', settings: {} });
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-456',
                roomCode: 'test-room',
                role: 'spymaster',
            });
            playerService.getPlayersInRoom.mockResolvedValue([]);
            gameService.getGame.mockResolvedValue(mockGame);
            gameService.getGameStateForPlayer.mockReturnValue({ id: 'game-1' });

            const handlers = mockSocket.on.mock.calls;
            const resyncHandler = handlers.find((h) => h[0] === 'room:resync');
            await resyncHandler[1]();

            expect(mockSocket.emit).toHaveBeenCalledWith('game:spymasterView', expect.anything());
        });

        test('handles resync without roomCode', async () => {
            mockSocket.roomCode = null;

            const handlers = mockSocket.on.mock.calls;
            const resyncHandler = handlers.find((h) => h[0] === 'room:resync');
            await resyncHandler[1]();

            expect(mockSocket.emit).toHaveBeenCalledWith(
                'room:error',
                expect.objectContaining({
                    code: expect.any(String),
                })
            );
        });
    });

    describe('room:getReconnectionToken edge cases', () => {
        test('handles missing roomCode', async () => {
            mockSocket.roomCode = null;

            const handlers = mockSocket.on.mock.calls;
            const tokenHandler = handlers.find((h) => h[0] === 'room:getReconnectionToken');
            await tokenHandler[1]();

            expect(mockSocket.emit).toHaveBeenCalledWith(
                'room:error',
                expect.objectContaining({
                    code: expect.any(String),
                })
            );
        });
    });

    describe('room:reconnect edge cases', () => {
        test('rejects token for wrong room', async () => {
            playerService.validateRoomReconnectToken.mockResolvedValue({
                valid: true,
                tokenData: { roomCode: 'different-room', sessionId: 'session-456' },
            });

            const handlers = mockSocket.on.mock.calls;
            const reconnectHandler = handlers.find((h) => h[0] === 'room:reconnect');
            await reconnectHandler[1]({
                code: 'test-room',
                reconnectionToken: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            });

            expect(mockSocket.emit).toHaveBeenCalledWith(
                'room:error',
                expect.objectContaining({
                    message: 'Token does not match room',
                })
            );
        });

        test('handles missing data', async () => {
            const handlers = mockSocket.on.mock.calls;
            const reconnectHandler = handlers.find((h) => h[0] === 'room:reconnect');
            await reconnectHandler[1]({});

            expect(mockSocket.emit).toHaveBeenCalledWith(
                'room:error',
                expect.objectContaining({
                    code: 'INVALID_INPUT',
                })
            );
        });

        test('handles null data', async () => {
            const handlers = mockSocket.on.mock.calls;
            const reconnectHandler = handlers.find((h) => h[0] === 'room:reconnect');
            await reconnectHandler[1](null);

            expect(mockSocket.emit).toHaveBeenCalledWith(
                'room:error',
                expect.objectContaining({
                    code: 'INVALID_INPUT',
                })
            );
        });

        test('sends spymaster view on reconnect for spymaster', async () => {
            const mockPlayer = { sessionId: 'session-456', nickname: 'Spymaster1', team: 'red', role: 'spymaster' };
            const mockGame = { id: 'game-1', types: ['red', 'blue'], gameOver: false };

            playerService.validateRoomReconnectToken.mockResolvedValue({
                valid: true,
                tokenData: { roomCode: 'test-room', sessionId: 'session-456' },
            });
            roomService.getRoom.mockResolvedValue({ code: 'test-room', roomId: 'test-room', settings: {} });
            playerService.updatePlayer.mockResolvedValue(mockPlayer);
            playerService.getPlayer.mockResolvedValue(mockPlayer);
            playerService.getPlayersInRoom.mockResolvedValue([mockPlayer]);
            gameService.getGame.mockResolvedValue(mockGame);
            gameService.getGameStateForPlayer.mockReturnValue({ id: 'game-1' });

            const handlers = mockSocket.on.mock.calls;
            const reconnectHandler = handlers.find((h) => h[0] === 'room:reconnect');
            await reconnectHandler[1]({
                code: 'test-room',
                reconnectionToken: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            });

            expect(mockSocket.emit).toHaveBeenCalledWith('game:spymasterView', expect.anything());
        });
    });
});
