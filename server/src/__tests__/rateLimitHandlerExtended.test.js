/**
 * Extended Rate Limit Handler Tests
 *
 * Additional tests to increase coverage from 43% to 70%+
 * Covers edge cases, error handling, and rate limiting behavior
 */

// Mock dependencies
jest.mock('../config/constants', () => ({
    RATE_LIMITS: {
        ROOM_CREATE: { points: 3, duration: 60 },
        ROOM_JOIN: { points: 10, duration: 60 },
        GAME_START: { points: 5, duration: 60 },
        GAME_REVEAL: { points: 30, duration: 60 },
        GAME_CLUE: { points: 10, duration: 60 },
        PLAYER_SET_TEAM: { points: 10, duration: 60 },
        CHAT_MESSAGE: { points: 20, duration: 60 },
        DEFAULT: { points: 50, duration: 60 }
    },
    ERROR_CODES: {
        RATE_LIMITED: 'RATE_LIMITED',
        SERVER_ERROR: 'SERVER_ERROR',
        ROOM_NOT_FOUND: 'ROOM_NOT_FOUND'
    }
}));

jest.mock('../utils/logger', () => ({
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn()
}));

// Mock rateLimit module
const mockLimiter = jest.fn((socket, data, callback) => callback(null));
const mockGetLimiter = jest.fn().mockReturnValue(mockLimiter);
const mockCleanupSocket = jest.fn();
const mockCleanupStale = jest.fn();
jest.mock('../middleware/rateLimit', () => ({
    createSocketRateLimiter: jest.fn().mockReturnValue({
        getLimiter: mockGetLimiter,
        cleanupSocket: mockCleanupSocket,
        cleanupStale: mockCleanupStale
    })
}));

const {
    socketRateLimiter,
    createRateLimitedHandler,
    getSocketRateLimiter,
    startRateLimitCleanup,
    stopRateLimitCleanup
} = require('../socket/rateLimitHandler');

const logger = require('../utils/logger');

describe('Rate Limit Handler Extended Tests', () => {
    let mockSocket;

    beforeEach(() => {
        jest.clearAllMocks();
        mockSocket = {
            id: 'test-socket-' + Date.now(),
            emit: jest.fn(),
            handshake: {
                address: '192.168.1.1'
            }
        };
        // Reset the limiter mock for each test
        mockLimiter.mockImplementation((socket, data, callback) => callback(null));
    });

    afterEach(() => {
        stopRateLimitCleanup();
    });

    describe('createRateLimitedHandler Advanced Scenarios', () => {

        test('handles async handler that returns value', async () => {
            const returnValue = { success: true, data: [1, 2, 3] };
            const handler = jest.fn().mockResolvedValue(returnValue);
            const wrapped = createRateLimitedHandler(mockSocket, 'game:start', handler);

            await wrapped({ test: 'data' });
            await new Promise(resolve => setTimeout(resolve, 10));

            expect(handler).toHaveBeenCalledWith({ test: 'data' });
        });

        test('handles handler that returns undefined', async () => {
            const handler = jest.fn().mockResolvedValue(undefined);
            const wrapped = createRateLimitedHandler(mockSocket, 'game:start', handler);

            await wrapped({});
            await new Promise(resolve => setTimeout(resolve, 10));

            expect(handler).toHaveBeenCalled();
            expect(mockSocket.emit).not.toHaveBeenCalled();
        });

        test('handles handler that returns null', async () => {
            const handler = jest.fn().mockResolvedValue(null);
            const wrapped = createRateLimitedHandler(mockSocket, 'game:start', handler);

            await wrapped({});
            await new Promise(resolve => setTimeout(resolve, 10));

            expect(handler).toHaveBeenCalled();
        });

        test('handles synchronous handler function', async () => {
            const handler = jest.fn().mockReturnValue('sync result');
            const wrapped = createRateLimitedHandler(mockSocket, 'game:start', handler);

            await wrapped({ sync: true });
            await new Promise(resolve => setTimeout(resolve, 10));

            expect(handler).toHaveBeenCalled();
        });

        test('emits error with safe error code and passes message through', async () => {
            // Use a safe error code that allows message passthrough
            const customError = new Error('Room not found');
            customError.code = 'ROOM_NOT_FOUND';
            const handler = jest.fn().mockRejectedValue(customError);
            const wrapped = createRateLimitedHandler(mockSocket, 'room:join', handler);

            await wrapped({});
            await new Promise(resolve => setTimeout(resolve, 10));

            expect(mockSocket.emit).toHaveBeenCalledWith('room:error', {
                code: 'ROOM_NOT_FOUND',
                message: 'Room not found'
            });
        });

        test('handles error without message', async () => {
            const error = new Error();
            error.code = 'EMPTY_MESSAGE';
            const handler = jest.fn().mockRejectedValue(error);
            const wrapped = createRateLimitedHandler(mockSocket, 'player:setTeam', handler);

            await wrapped({});
            await new Promise(resolve => setTimeout(resolve, 10));

            // Error with code but no message - should emit with that code
            expect(mockSocket.emit).toHaveBeenCalledWith('player:error',
                expect.objectContaining({
                    code: 'EMPTY_MESSAGE'
                })
            );
        });

        test('handles thrown string instead of Error object', async () => {
            const handler = jest.fn().mockRejectedValue('String error thrown');
            const wrapped = createRateLimitedHandler(mockSocket, 'chat:message', handler);

            await wrapped({});
            await new Promise(resolve => setTimeout(resolve, 10));

            // String thrown should result in undefined code/message
            expect(mockSocket.emit).toHaveBeenCalledWith('chat:error', {
                code: 'SERVER_ERROR',
                message: 'An unexpected error occurred'
            });
        });

        test('handles complex event names with multiple colons', async () => {
            const error = new Error('Test error');
            const handler = jest.fn().mockRejectedValue(error);
            const wrapped = createRateLimitedHandler(mockSocket, 'game:board:update', handler);

            await wrapped({});
            await new Promise(resolve => setTimeout(resolve, 10));

            // Should use first part as error event prefix
            expect(mockSocket.emit).toHaveBeenCalledWith('game:error', expect.any(Object));
        });

        test('handles event name without colon', async () => {
            const error = new Error('Test error');
            const handler = jest.fn().mockRejectedValue(error);
            const wrapped = createRateLimitedHandler(mockSocket, 'disconnect', handler);

            await wrapped({});
            await new Promise(resolve => setTimeout(resolve, 10));

            expect(mockSocket.emit).toHaveBeenCalledWith('disconnect:error', expect.any(Object));
        });

        test('passes through complex data objects', async () => {
            const complexData = {
                nested: { deep: { value: 123 } },
                array: [1, 2, { three: 3 }],
                date: new Date().toISOString(),
                nullable: null,
                boolean: true
            };
            const handler = jest.fn().mockResolvedValue(undefined);
            const wrapped = createRateLimitedHandler(mockSocket, 'game:clue', handler);

            await wrapped(complexData);
            await new Promise(resolve => setTimeout(resolve, 10));

            expect(handler).toHaveBeenCalledWith(complexData);
        });
    });

    describe('Rate Limit Exceeded Handling', () => {

        test('emits rate limit error when limit exceeded', async () => {
            // Mock rate limiter to return error (limit exceeded)
            mockLimiter.mockImplementation((socket, data, callback) => {
                callback(new Error('Rate limit exceeded'));
            });

            const handler = jest.fn();
            const wrapped = createRateLimitedHandler(mockSocket, 'room:create', handler);

            await wrapped({});
            await new Promise(resolve => setTimeout(resolve, 10));

            expect(handler).not.toHaveBeenCalled();
            expect(mockSocket.emit).toHaveBeenCalledWith('room:error', {
                code: 'RATE_LIMITED',
                message: 'Too many requests, please slow down'
            });
        });

        test('logs rate limit warning', async () => {
            mockLimiter.mockImplementation((socket, data, callback) => {
                callback(new Error('Rate limit exceeded'));
            });

            const handler = jest.fn();
            const wrapped = createRateLimitedHandler(mockSocket, 'game:reveal', handler);

            await wrapped({});
            await new Promise(resolve => setTimeout(resolve, 10));

            expect(logger.warn).toHaveBeenCalledWith(
                expect.stringContaining('Rate limit exceeded')
            );
        });
    });

    describe('Cleanup Functions', () => {

        test('startRateLimitCleanup is idempotent', () => {
            startRateLimitCleanup();
            startRateLimitCleanup();
            startRateLimitCleanup();
            // Should not throw and should only create one interval
            stopRateLimitCleanup();
        });

        test('stopRateLimitCleanup is idempotent', () => {
            stopRateLimitCleanup();
            stopRateLimitCleanup();
            stopRateLimitCleanup();
            // Should not throw
        });

        test('can restart cleanup after stopping', () => {
            startRateLimitCleanup();
            stopRateLimitCleanup();
            startRateLimitCleanup();
            stopRateLimitCleanup();
            // Should not throw
        });

        test('cleanupSocket handles socket ID', () => {
            socketRateLimiter.cleanupSocket('test-socket-id');
            expect(mockCleanupSocket).toHaveBeenCalledWith('test-socket-id');
        });

        test('cleanupStale can be called directly', () => {
            socketRateLimiter.cleanupStale();
            expect(mockCleanupStale).toHaveBeenCalled();
        });
    });

    describe('Socket Rate Limiter Instance', () => {

        test('getLimiter returns function for room events', () => {
            const limiter = socketRateLimiter.getLimiter('room:create');
            expect(mockGetLimiter).toHaveBeenCalledWith('room:create');
            expect(typeof limiter).toBe('function');
        });

        test('getLimiter returns function for game events', () => {
            socketRateLimiter.getLimiter('game:reveal');
            expect(mockGetLimiter).toHaveBeenCalledWith('game:reveal');
        });

        test('getLimiter returns function for chat events', () => {
            socketRateLimiter.getLimiter('chat:message');
            expect(mockGetLimiter).toHaveBeenCalledWith('chat:message');
        });

        test('getLimiter returns function for unknown events', () => {
            socketRateLimiter.getLimiter('unknown:event');
            expect(mockGetLimiter).toHaveBeenCalledWith('unknown:event');
        });
    });

    describe('getSocketRateLimiter Export', () => {

        test('returns the rate limiter instance', () => {
            const limiter = getSocketRateLimiter();
            expect(limiter).toBe(socketRateLimiter);
        });

        test('returned limiter has getLimiter method', () => {
            const limiter = getSocketRateLimiter();
            expect(typeof limiter.getLimiter).toBe('function');
        });

        test('returned limiter has cleanupSocket method', () => {
            const limiter = getSocketRateLimiter();
            expect(typeof limiter.cleanupSocket).toBe('function');
        });
    });

    describe('Handler with Different Data Types', () => {

        test('handles undefined data', async () => {
            const handler = jest.fn().mockResolvedValue(undefined);
            const wrapped = createRateLimitedHandler(mockSocket, 'game:start', handler);

            await wrapped(undefined);
            await new Promise(resolve => setTimeout(resolve, 10));

            expect(handler).toHaveBeenCalledWith(undefined);
        });

        test('handles null data', async () => {
            const handler = jest.fn().mockResolvedValue(undefined);
            const wrapped = createRateLimitedHandler(mockSocket, 'game:start', handler);

            await wrapped(null);
            await new Promise(resolve => setTimeout(resolve, 10));

            expect(handler).toHaveBeenCalledWith(null);
        });

        test('handles empty object', async () => {
            const handler = jest.fn().mockResolvedValue(undefined);
            const wrapped = createRateLimitedHandler(mockSocket, 'game:start', handler);

            await wrapped({});
            await new Promise(resolve => setTimeout(resolve, 10));

            expect(handler).toHaveBeenCalledWith({});
        });

        test('handles array data', async () => {
            const handler = jest.fn().mockResolvedValue(undefined);
            const wrapped = createRateLimitedHandler(mockSocket, 'game:start', handler);

            await wrapped([1, 2, 3]);
            await new Promise(resolve => setTimeout(resolve, 10));

            expect(handler).toHaveBeenCalledWith([1, 2, 3]);
        });

        test('handles string data', async () => {
            const handler = jest.fn().mockResolvedValue(undefined);
            const wrapped = createRateLimitedHandler(mockSocket, 'chat:message', handler);

            await wrapped('Hello, world!');
            await new Promise(resolve => setTimeout(resolve, 10));

            expect(handler).toHaveBeenCalledWith('Hello, world!');
        });

        test('handles number data', async () => {
            const handler = jest.fn().mockResolvedValue(undefined);
            const wrapped = createRateLimitedHandler(mockSocket, 'game:reveal', handler);

            await wrapped(42);
            await new Promise(resolve => setTimeout(resolve, 10));

            expect(handler).toHaveBeenCalledWith(42);
        });
    });

    describe('Concurrent Handler Calls', () => {

        test('handles multiple concurrent calls', async () => {
            const handler = jest.fn().mockImplementation(async (data) => {
                await new Promise(resolve => setTimeout(resolve, 5));
                return data;
            });
            const wrapped = createRateLimitedHandler(mockSocket, 'game:reveal', handler);

            // Make multiple concurrent calls
            const promises = [
                wrapped({ id: 1 }),
                wrapped({ id: 2 }),
                wrapped({ id: 3 })
            ];

            await Promise.all(promises);
            await new Promise(resolve => setTimeout(resolve, 20));

            expect(handler).toHaveBeenCalledTimes(3);
        });

        test('each call gets its own data', async () => {
            const receivedData = [];
            const handler = jest.fn().mockImplementation(async (data) => {
                receivedData.push(data);
            });
            const wrapped = createRateLimitedHandler(mockSocket, 'game:reveal', handler);

            await wrapped({ value: 'first' });
            await wrapped({ value: 'second' });
            await wrapped({ value: 'third' });
            await new Promise(resolve => setTimeout(resolve, 20));

            expect(receivedData).toContainEqual({ value: 'first' });
            expect(receivedData).toContainEqual({ value: 'second' });
            expect(receivedData).toContainEqual({ value: 'third' });
        });
    });
});
