/**
 * Extended Rate Limit Handler Tests
 *
 * Additional tests to increase coverage from 43% to 70%+
 * Covers edge cases, error handling, and rate limiting behavior
 */

// Mock dependencies
jest.mock('../../config/constants', () => ({
    RATE_LIMITS: {
        ROOM_CREATE: { points: 3, duration: 60 },
        ROOM_JOIN: { points: 10, duration: 60 },
        GAME_START: { points: 5, duration: 60 },
        GAME_REVEAL: { points: 30, duration: 60 },
        PLAYER_SET_TEAM: { points: 10, duration: 60 },
        CHAT_MESSAGE: { points: 20, duration: 60 },
        DEFAULT: { points: 50, duration: 60 },
    },
    ERROR_CODES: {
        RATE_LIMITED: 'RATE_LIMITED',
        SERVER_ERROR: 'SERVER_ERROR',
        ROOM_NOT_FOUND: 'ROOM_NOT_FOUND',
    },
}));

jest.mock('../../utils/logger', () => ({
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
}));

// Mock rateLimit module
const mockLimiter = jest.fn((socket, data, callback) => callback(null));
const mockGetLimiter = jest.fn().mockReturnValue(mockLimiter);
const mockCleanupSocket = jest.fn();
const mockCleanupStale = jest.fn();
jest.mock('../../middleware/rateLimit', () => ({
    createSocketRateLimiter: jest.fn().mockReturnValue({
        getLimiter: mockGetLimiter,
        cleanupSocket: mockCleanupSocket,
        cleanupStale: mockCleanupStale,
    }),
}));

const { createRateLimitedHandler, stopRateLimitCleanup } = require('../../socket/rateLimitHandler');

const logger = require('../../utils/logger');

describe('Rate Limit Handler Extended Tests', () => {
    let mockSocket;

    beforeEach(() => {
        jest.clearAllMocks();
        mockSocket = {
            id: 'test-socket-' + Date.now(),
            emit: jest.fn(),
            handshake: {
                address: '192.168.1.1',
            },
        };
        // Reset the limiter mock for each test
        mockLimiter.mockImplementation((socket, data, callback) => callback(null));
    });

    afterEach(() => {
        stopRateLimitCleanup();
    });

    describe('createRateLimitedHandler Advanced Scenarios', () => {
        test('handles error without message', async () => {
            const error = new Error();
            error.code = 'EMPTY_MESSAGE';
            const handler = jest.fn().mockRejectedValue(error);
            const wrapped = createRateLimitedHandler(mockSocket, 'player:setTeam', handler);

            await wrapped({});
            await new Promise((resolve) => setTimeout(resolve, 10));

            // Error with code but no message - should emit with that code
            expect(mockSocket.emit).toHaveBeenCalledWith(
                'player:error',
                expect.objectContaining({
                    code: 'EMPTY_MESSAGE',
                })
            );
        });

        test('handles thrown string instead of Error object', async () => {
            const handler = jest.fn().mockRejectedValue('String error thrown');
            const wrapped = createRateLimitedHandler(mockSocket, 'chat:message', handler);

            await wrapped({});
            await new Promise((resolve) => setTimeout(resolve, 10));

            // String thrown should result in undefined code/message
            expect(mockSocket.emit).toHaveBeenCalledWith('chat:error', {
                code: 'SERVER_ERROR',
                message: 'An unexpected error occurred',
            });
        });

        test('handles complex event names with multiple colons', async () => {
            const error = new Error('Test error');
            const handler = jest.fn().mockRejectedValue(error);
            const wrapped = createRateLimitedHandler(mockSocket, 'game:board:update', handler);

            await wrapped({});
            await new Promise((resolve) => setTimeout(resolve, 10));

            // Should use first part as error event prefix
            expect(mockSocket.emit).toHaveBeenCalledWith('game:error', expect.any(Object));
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
            await new Promise((resolve) => setTimeout(resolve, 10));

            expect(handler).not.toHaveBeenCalled();
            expect(mockSocket.emit).toHaveBeenCalledWith('room:error', {
                code: 'RATE_LIMITED',
                message: 'Too many requests, please slow down',
                recoverable: true,
                retryable: true,
            });
        });

        test('logs rate limit warning', async () => {
            mockLimiter.mockImplementation((socket, data, callback) => {
                callback(new Error('Rate limit exceeded'));
            });

            const handler = jest.fn();
            const wrapped = createRateLimitedHandler(mockSocket, 'game:reveal', handler);

            await wrapped({});
            await new Promise((resolve) => setTimeout(resolve, 10));

            expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Rate limit exceeded'));
        });
    });

    describe('Concurrent Handler Calls', () => {
        test('handles multiple concurrent calls', async () => {
            const handler = jest.fn().mockImplementation(async (data) => {
                await new Promise((resolve) => setTimeout(resolve, 5));
                return data;
            });
            const wrapped = createRateLimitedHandler(mockSocket, 'game:reveal', handler);

            // Make multiple concurrent calls
            const promises = [wrapped({ id: 1 }), wrapped({ id: 2 }), wrapped({ id: 3 })];

            await Promise.all(promises);
            await new Promise((resolve) => setTimeout(resolve, 20));

            expect(handler).toHaveBeenCalledTimes(3);
        });
    });
});
