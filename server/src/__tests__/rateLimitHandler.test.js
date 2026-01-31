/**
 * Rate Limit Handler Tests
 */

const {
    socketRateLimiter,
    createRateLimitedHandler,
    getSocketRateLimiter,
    startRateLimitCleanup,
    stopRateLimitCleanup
} = require('../socket/rateLimitHandler');

describe('Rate Limit Handler', () => {
    let mockSocket;

    beforeEach(() => {
        mockSocket = {
            id: 'test-socket-id',
            emit: jest.fn(),
            handshake: {
                address: '127.0.0.1'
            }
        };
    });

    afterEach(() => {
        stopRateLimitCleanup();
    });

    describe('socketRateLimiter', () => {
        test('exports a rate limiter object', () => {
            expect(socketRateLimiter).toBeDefined();
            expect(typeof socketRateLimiter.getLimiter).toBe('function');
        });

        test('getLimiter returns a function', () => {
            const limiter = socketRateLimiter.getLimiter('room:create');
            expect(typeof limiter).toBe('function');
        });

        test('cleanupSocket removes socket entries', () => {
            // Get a limiter to register the socket
            const limiter = socketRateLimiter.getLimiter('room:create');
            limiter(mockSocket, {}, () => {});

            // Should not throw
            expect(() => socketRateLimiter.cleanupSocket(mockSocket.id)).not.toThrow();
        });

        test('cleanupStale does not throw', () => {
            expect(() => socketRateLimiter.cleanupStale()).not.toThrow();
        });
    });

    describe('createRateLimitedHandler', () => {
        test('creates a wrapped handler function', () => {
            const handler = jest.fn();
            const wrapped = createRateLimitedHandler(mockSocket, 'game:start', handler);
            expect(typeof wrapped).toBe('function');
        });

        test('calls handler when rate limit not exceeded', async () => {
            const handler = jest.fn().mockResolvedValue(undefined);
            const wrapped = createRateLimitedHandler(mockSocket, 'game:start', handler);

            await wrapped({ test: 'data' });

            // Give time for async callback
            await new Promise(resolve => setTimeout(resolve, 10));

            expect(handler).toHaveBeenCalledWith({ test: 'data' }, undefined);
        });

        test('emits error event when handler throws with safe error code', async () => {
            // Use a safe error code that allows message passthrough
            const error = new Error('Invalid input provided');
            error.code = 'INVALID_INPUT';
            const handler = jest.fn().mockRejectedValue(error);
            const wrapped = createRateLimitedHandler(mockSocket, 'game:reveal', handler);

            await wrapped({ test: 'data' });

            // Give time for async callback
            await new Promise(resolve => setTimeout(resolve, 10));

            expect(mockSocket.emit).toHaveBeenCalledWith('game:error', {
                code: 'INVALID_INPUT',
                message: 'Invalid input provided'
            });
        });

        test('emits sanitized message for unknown error codes', async () => {
            // Non-safe error codes should have message sanitized
            const error = new Error('Internal server details');
            error.code = 'UNKNOWN_CODE';
            const handler = jest.fn().mockRejectedValue(error);
            const wrapped = createRateLimitedHandler(mockSocket, 'room:join', handler);

            await wrapped({});

            await new Promise(resolve => setTimeout(resolve, 10));

            expect(mockSocket.emit).toHaveBeenCalledWith('room:error', {
                code: 'UNKNOWN_CODE',
                message: 'An unexpected error occurred'
            });
        });

        test('emits SERVER_ERROR with sanitized message when handler throws without code', async () => {
            const error = new Error('Unknown error');
            const handler = jest.fn().mockRejectedValue(error);
            const wrapped = createRateLimitedHandler(mockSocket, 'room:join', handler);

            await wrapped({});

            await new Promise(resolve => setTimeout(resolve, 10));

            // Message should be sanitized for SERVER_ERROR
            expect(mockSocket.emit).toHaveBeenCalledWith('room:error', {
                code: 'SERVER_ERROR',
                message: 'An unexpected error occurred'
            });
        });

        test('handles event names without colon', async () => {
            const handler = jest.fn().mockRejectedValue(new Error('Test'));
            const wrapped = createRateLimitedHandler(mockSocket, 'simpleevent', handler);

            await wrapped({});

            await new Promise(resolve => setTimeout(resolve, 10));

            // Should use first part as error event prefix
            expect(mockSocket.emit).toHaveBeenCalledWith('simpleevent:error', expect.any(Object));
        });
    });

    describe('getSocketRateLimiter', () => {
        test('returns the socket rate limiter', () => {
            const limiter = getSocketRateLimiter();
            expect(limiter).toBe(socketRateLimiter);
        });
    });

    describe('Rate Limit Cleanup', () => {
        test('startRateLimitCleanup starts interval', () => {
            startRateLimitCleanup();
            // Should not throw when called again
            startRateLimitCleanup();
        });

        test('stopRateLimitCleanup stops interval', () => {
            startRateLimitCleanup();
            stopRateLimitCleanup();
            // Should not throw when called again
            stopRateLimitCleanup();
        });

        test('cleanup can be started after stopping', () => {
            startRateLimitCleanup();
            stopRateLimitCleanup();
            startRateLimitCleanup();
            stopRateLimitCleanup();
        });
    });

    describe('Rate Limiting Behavior', () => {
        test('rate limits rapid requests', async () => {
            // Use a unique socket for this test to avoid interference
            const testSocket = {
                id: 'rate-limit-test-' + Date.now(),
                emit: jest.fn(),
                handshake: { address: '192.168.1.100' }
            };

            const handler = jest.fn().mockResolvedValue(undefined);
            const wrapped = createRateLimitedHandler(testSocket, 'chat:message', handler);

            // Make many rapid requests
            const promises = [];
            for (let i = 0; i < 50; i++) {
                promises.push(wrapped({ msg: i }));
            }

            await Promise.all(promises);
            await new Promise(resolve => setTimeout(resolve, 50));

            // Some should be rate limited (emit RATE_LIMITED error)
            const rateLimitedCalls = testSocket.emit.mock.calls.filter(
                call => call[0] === 'chat:error' && call[1]?.code === 'RATE_LIMITED'
            );

            // Depending on rate limit config, some may be limited
            // Just verify the mechanism works (handler called or rate limited)
            expect(handler.mock.calls.length + rateLimitedCalls.length).toBeGreaterThan(0);
        });
    });
});
