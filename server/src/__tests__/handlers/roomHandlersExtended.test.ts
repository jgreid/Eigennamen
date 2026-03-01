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
});
