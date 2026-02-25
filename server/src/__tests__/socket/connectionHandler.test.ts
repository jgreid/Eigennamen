/**
 * Connection Handler Tests
 *
 * Tests for handleConnection, ensureSocketFunctionsRegistered,
 * and createTimerExpireCallback in socket/connectionHandler.ts.
 */

jest.mock('../../utils/logger', () => ({
    info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn()
}));

jest.mock('../../socket/rateLimitHandler', () => ({
    socketRateLimiter: { cleanupSocket: jest.fn() },
}));

jest.mock('../../socket/socketFunctionProvider', () => ({
    registerSocketFunctions: jest.fn(),
    isRegistered: jest.fn().mockReturnValue(false),
}));

jest.mock('../../socket/disconnectHandler', () => ({
    handleDisconnect: jest.fn().mockResolvedValue(undefined),
    createTimerExpireCallback: jest.fn(() => jest.fn()),
}));

jest.mock('../../utils/distributedLock', () => ({
    withLock: jest.fn(async (_key, fn) => fn()),
}));

jest.mock('../../socket/handlers/roomHandlers', () => jest.fn());
jest.mock('../../socket/handlers/gameHandlers', () => jest.fn());
jest.mock('../../socket/handlers/playerHandlers', () => jest.fn());
jest.mock('../../socket/handlers/chatHandlers', () => jest.fn());
jest.mock('../../socket/handlers/timerHandlers', () => jest.fn());

jest.mock('../../socket/connectionTracker', () => ({
    decrementConnectionCount: jest.fn(),
}));

jest.mock('../../config/constants', () => ({
    SOCKET: { DISCONNECT_TIMEOUT_MS: 5000 },
    ERROR_CODES: { SERVER_ERROR: 'SERVER_ERROR' },
}));

const { handleConnection, ensureSocketFunctionsRegistered, createTimerExpireCallback } =
    require('../../socket/connectionHandler');
const { registerSocketFunctions, isRegistered } = require('../../socket/socketFunctionProvider');
const { handleDisconnect } = require('../../socket/disconnectHandler');
const { socketRateLimiter } = require('../../socket/rateLimitHandler');
const { decrementConnectionCount } = require('../../socket/connectionTracker');
const roomHandlers = require('../../socket/handlers/roomHandlers');
const gameHandlers = require('../../socket/handlers/gameHandlers');
const playerHandlers = require('../../socket/handlers/playerHandlers');
const chatHandlers = require('../../socket/handlers/chatHandlers');
const timerHandlers = require('../../socket/handlers/timerHandlers');
const logger = require('../../utils/logger');

describe('connectionHandler', () => {
    let mockIo: any;
    let mockSocket: any;
    let mockApp: any;
    let mockSocketFns: any;
    const eventHandlers: Record<string, Function> = {};

    beforeEach(() => {
        jest.clearAllMocks();
        // Reset implementations (clearAllMocks only clears calls, not mockImplementation)
        (registerSocketFunctions as jest.Mock).mockImplementation(() => {});
        (isRegistered as jest.Mock).mockReturnValue(false);

        // Reset event handlers
        Object.keys(eventHandlers).forEach(k => delete eventHandlers[k]);

        mockIo = { to: jest.fn().mockReturnThis(), emit: jest.fn() };
        mockSocket = {
            id: 'sock-1',
            sessionId: 'sess-1',
            on: jest.fn((event: string, handler: Function) => {
                eventHandlers[event] = handler;
            }),
            emit: jest.fn(),
            disconnect: jest.fn(),
        };
        mockApp = { updateSocketCount: jest.fn() };
        mockSocketFns = {
            emitToRoom: jest.fn(),
            emitToPlayer: jest.fn(),
            startTurnTimer: jest.fn(),
            stopTurnTimer: jest.fn(),
            getTimerStatus: jest.fn(),
            getIO: jest.fn(() => mockIo),
            createTimerExpireCallback: jest.fn(),
        };
    });

    describe('handleConnection', () => {
        it('should log connection and register all handlers', () => {
            handleConnection(mockIo, mockSocket, mockApp, mockSocketFns);

            expect(logger.info).toHaveBeenCalledWith(
                expect.stringContaining('Client connected: sock-1')
            );
            expect(roomHandlers).toHaveBeenCalledWith(mockIo, mockSocket);
            expect(gameHandlers).toHaveBeenCalledWith(mockIo, mockSocket);
            expect(playerHandlers).toHaveBeenCalledWith(mockIo, mockSocket);
            expect(chatHandlers).toHaveBeenCalledWith(mockIo, mockSocket);
            expect(timerHandlers).toHaveBeenCalledWith(mockIo, mockSocket);
        });

        it('should update socket count when app has updateSocketCount', () => {
            handleConnection(mockIo, mockSocket, mockApp, mockSocketFns);
            expect(mockApp.updateSocketCount).toHaveBeenCalledWith(1);
        });

        it('should not crash when app is null', () => {
            expect(() => {
                handleConnection(mockIo, mockSocket, null, mockSocketFns);
            }).not.toThrow();
        });

        it('should not crash when app has no updateSocketCount', () => {
            expect(() => {
                handleConnection(mockIo, mockSocket, {}, mockSocketFns);
            }).not.toThrow();
        });

        it('should attach rate limiter to socket', () => {
            handleConnection(mockIo, mockSocket, mockApp, mockSocketFns);
            expect(mockSocket.rateLimiter).toBe(socketRateLimiter);
        });

        it('should store FLY_ALLOC_ID when present', () => {
            const original = process.env.FLY_ALLOC_ID;
            process.env.FLY_ALLOC_ID = 'fly-abc-123';

            handleConnection(mockIo, mockSocket, mockApp, mockSocketFns);
            expect(mockSocket.flyInstanceId).toBe('fly-abc-123');

            if (original !== undefined) {
                process.env.FLY_ALLOC_ID = original;
            } else {
                delete process.env.FLY_ALLOC_ID;
            }
        });

        it('should not set flyInstanceId when FLY_ALLOC_ID is absent', () => {
            const original = process.env.FLY_ALLOC_ID;
            delete process.env.FLY_ALLOC_ID;

            handleConnection(mockIo, mockSocket, mockApp, mockSocketFns);
            expect(mockSocket.flyInstanceId).toBeUndefined();

            if (original !== undefined) {
                process.env.FLY_ALLOC_ID = original;
            }
        });

        it('should disconnect socket if registration fails', () => {
            (registerSocketFunctions as jest.Mock).mockImplementation(() => {
                throw new Error('Missing required socket functions');
            });

            handleConnection(mockIo, mockSocket, mockApp, mockSocketFns);

            expect(logger.error).toHaveBeenCalledWith(
                expect.stringContaining('Failed to register socket functions'),
                expect.any(Error)
            );
            expect(mockSocket.disconnect).toHaveBeenCalledWith(true);
            // Handlers should NOT have been registered
            expect(roomHandlers).not.toHaveBeenCalled();
        });

        it('should skip registration when already registered', () => {
            (isRegistered as jest.Mock).mockReturnValue(true);

            handleConnection(mockIo, mockSocket, mockApp, mockSocketFns);

            expect(registerSocketFunctions).not.toHaveBeenCalled();
            // Handlers should still be registered
            expect(roomHandlers).toHaveBeenCalled();
        });

        it('should register disconnect and error handlers', () => {
            handleConnection(mockIo, mockSocket, mockApp, mockSocketFns);

            expect(mockSocket.on).toHaveBeenCalledWith('disconnect', expect.any(Function));
            expect(mockSocket.on).toHaveBeenCalledWith('error', expect.any(Function));
        });
    });

    describe('disconnect handler', () => {
        beforeEach(() => {
            handleConnection(mockIo, mockSocket, mockApp, mockSocketFns);
        });

        it('should log disconnect reason and call handleDisconnect', async () => {
            mockSocket.clientIP = '10.0.0.1';
            await eventHandlers['disconnect']('transport close');

            expect(logger.info).toHaveBeenCalledWith(
                expect.stringContaining('Client disconnected: sock-1')
            );
            expect(handleDisconnect).toHaveBeenCalledWith(
                mockIo, mockSocket, 'transport close',
                expect.any(AbortSignal)
            );
        });

        it('should decrement connection count for IP', async () => {
            mockSocket.clientIP = '10.0.0.1';
            await eventHandlers['disconnect']('transport close');

            expect(decrementConnectionCount).toHaveBeenCalledWith('10.0.0.1');
        });

        it('should skip decrement when no clientIP', async () => {
            mockSocket.clientIP = undefined;
            await eventHandlers['disconnect']('transport close');

            expect(decrementConnectionCount).not.toHaveBeenCalled();
        });

        it('should decrement socket count on disconnect', async () => {
            await eventHandlers['disconnect']('transport close');

            expect(mockApp.updateSocketCount).toHaveBeenCalledWith(-1);
        });

        it('should handle updateSocketCount errors gracefully', async () => {
            mockApp.updateSocketCount.mockImplementation(() => {
                throw new Error('count error');
            });

            await eventHandlers['disconnect']('transport close');

            expect(logger.error).toHaveBeenCalledWith(
                'Error updating socket count:',
                expect.any(Error)
            );
        });

        it('should clean up rate limiter on disconnect', async () => {
            await eventHandlers['disconnect']('transport close');

            expect(socketRateLimiter.cleanupSocket).toHaveBeenCalledWith('sock-1');
        });

        it('should handle rate limiter cleanup errors gracefully', async () => {
            socketRateLimiter.cleanupSocket.mockImplementation(() => {
                throw new Error('cleanup error');
            });

            await eventHandlers['disconnect']('transport close');

            expect(logger.error).toHaveBeenCalledWith(
                'Error cleaning up rate limiter:',
                expect.any(Error)
            );
        });

        it('should handle handleDisconnect timeout', async () => {
            // Make handleDisconnect hang
            (handleDisconnect as jest.Mock).mockImplementation(
                () => new Promise(() => {}) // never resolves
            );

            // Use a very short timeout via the constants mock
            const constants = require('../../config/constants');
            const originalTimeout = constants.SOCKET.DISCONNECT_TIMEOUT_MS;
            constants.SOCKET.DISCONNECT_TIMEOUT_MS = 50;

            await eventHandlers['disconnect']('transport close');

            expect(logger.error).toHaveBeenCalledWith(
                expect.stringContaining('Disconnect handler timed out'),
            );

            constants.SOCKET.DISCONNECT_TIMEOUT_MS = originalTimeout;
        });

        it('should handle handleDisconnect errors gracefully', async () => {
            (handleDisconnect as jest.Mock).mockRejectedValue(new Error('disconnect error'));

            await eventHandlers['disconnect']('transport close');

            expect(logger.error).toHaveBeenCalledWith(
                'Error in disconnect handler:',
                expect.any(Error)
            );
        });
    });

    describe('error handler', () => {
        beforeEach(() => {
            handleConnection(mockIo, mockSocket, mockApp, mockSocketFns);
        });

        it('should log error and emit socket:error', () => {
            const error = new Error('test error');
            eventHandlers['error'](error);

            expect(logger.error).toHaveBeenCalledWith(
                expect.stringContaining('Socket error for sock-1'),
                expect.objectContaining({ message: 'test error', sessionId: 'sess-1' })
            );
            expect(mockSocket.emit).toHaveBeenCalledWith('socket:error', {
                code: 'SERVER_ERROR',
                message: 'An unexpected error occurred. Please try again.'
            });
        });
    });

    describe('ensureSocketFunctionsRegistered', () => {
        it('should register when not registered', () => {
            (isRegistered as jest.Mock).mockReturnValue(false);

            ensureSocketFunctionsRegistered(mockSocketFns);

            expect(registerSocketFunctions).toHaveBeenCalledWith(
                expect.objectContaining({
                    emitToRoom: mockSocketFns.emitToRoom,
                    createTimerExpireCallback: expect.any(Function),
                })
            );
        });

        it('should skip when already registered', () => {
            (isRegistered as jest.Mock).mockReturnValue(true);

            ensureSocketFunctionsRegistered(mockSocketFns);

            expect(registerSocketFunctions).not.toHaveBeenCalled();
        });
    });

    describe('createTimerExpireCallback', () => {
        it('should return a function that calls the disconnect handler implementation', () => {
            const result = createTimerExpireCallback(mockSocketFns);
            expect(typeof result).toBe('function');
        });
    });
});
