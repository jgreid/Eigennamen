/**
 * Rate Limit Handler - Extended Branch Coverage Tests
 *
 * Targets uncovered branches in lines 142-153 of rateLimitHandler.ts:
 * - ackCallback handling in rate limit exceeded path (line 142)
 * - ackCallback handling in success path (line 148)
 * - ackCallback handling in error/catch path (line 153)
 */

// Mock dependencies before requiring the module
jest.mock('../config/constants', () => ({
    RATE_LIMITS: {
        DEFAULT: { points: 50, duration: 60 }
    },
    ERROR_CODES: {
        RATE_LIMITED: 'RATE_LIMITED',
        SERVER_ERROR: 'SERVER_ERROR'
    }
}));

jest.mock('../utils/logger', () => ({
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn()
}));

jest.mock('../errors/GameError', () => ({
    sanitizeErrorForClient: jest.fn((err: any) => ({
        code: (err && err.code) || 'SERVER_ERROR',
        message: 'An unexpected error occurred'
    }))
}));

// Create controllable mock limiter
const mockLimiterFn = jest.fn((_socket: any, _data: any, callback: Function) => callback());
const mockGetLimiter = jest.fn().mockReturnValue(mockLimiterFn);

jest.mock('../middleware/rateLimit', () => ({
    createSocketRateLimiter: jest.fn().mockReturnValue({
        getLimiter: mockGetLimiter,
        cleanupSocket: jest.fn(),
        cleanupStale: jest.fn()
    })
}));

const {
    createRateLimitedHandler,
    stopRateLimitCleanup
} = require('../socket/rateLimitHandler');

describe('rateLimitHandler - ackCallback branch coverage', () => {
    let mockSocket: any;

    beforeEach(() => {
        jest.clearAllMocks();
        mockSocket = {
            id: 'socket-ack-test-' + Date.now(),
            emit: jest.fn(),
            handshake: { address: '127.0.0.1' }
        };
        // Default: limiter passes through (no error)
        mockLimiterFn.mockImplementation((_socket: any, _data: any, callback: Function) => callback());
    });

    afterEach(() => {
        stopRateLimitCleanup();
    });

    describe('ackCallback on success (line 148)', () => {
        it('calls ackCallback with { ok: true } when handler succeeds', async () => {
            const handler = jest.fn().mockResolvedValue(undefined);
            const wrapped = createRateLimitedHandler(mockSocket, 'game:start', handler);
            const ackCallback = jest.fn();

            await wrapped({ test: 'data' }, ackCallback);

            expect(handler).toHaveBeenCalledWith({ test: 'data' });
            expect(ackCallback).toHaveBeenCalledWith({ ok: true });
        });

        it('does not call ackCallback when not provided (success path)', async () => {
            const handler = jest.fn().mockResolvedValue(undefined);
            const wrapped = createRateLimitedHandler(mockSocket, 'game:start', handler);

            // No ackCallback passed - should not throw
            await wrapped({ test: 'data' });
            expect(handler).toHaveBeenCalled();
        });

        it('does not call ackCallback when it is not a function (success path)', async () => {
            const handler = jest.fn().mockResolvedValue(undefined);
            const wrapped = createRateLimitedHandler(mockSocket, 'game:start', handler);

            // Pass a non-function as ackCallback
            await wrapped({ test: 'data' }, 'not-a-function');
            expect(handler).toHaveBeenCalled();
            // Should not throw
        });
    });

    describe('ackCallback on rate limit exceeded (line 142)', () => {
        it('calls ackCallback with { error: true } when rate limited', async () => {
            mockLimiterFn.mockImplementation((_socket: any, _data: any, callback: Function) => {
                callback(new Error('Rate limit exceeded'));
            });

            const handler = jest.fn();
            const wrapped = createRateLimitedHandler(mockSocket, 'room:create', handler);
            const ackCallback = jest.fn();

            await wrapped({}, ackCallback);

            expect(handler).not.toHaveBeenCalled();
            expect(ackCallback).toHaveBeenCalledWith({ error: true });
            expect(mockSocket.emit).toHaveBeenCalledWith('room:error', {
                code: 'RATE_LIMITED',
                message: 'Too many requests, please slow down'
            });
        });

        it('does not call ackCallback when not provided (rate limit path)', async () => {
            mockLimiterFn.mockImplementation((_socket: any, _data: any, callback: Function) => {
                callback(new Error('Rate limit exceeded'));
            });

            const handler = jest.fn();
            const wrapped = createRateLimitedHandler(mockSocket, 'room:create', handler);

            // Should not throw when no ackCallback
            await wrapped({});
            expect(handler).not.toHaveBeenCalled();
        });

        it('does not call ackCallback when it is not a function (rate limit path)', async () => {
            mockLimiterFn.mockImplementation((_socket: any, _data: any, callback: Function) => {
                callback(new Error('Rate limit exceeded'));
            });

            const handler = jest.fn();
            const wrapped = createRateLimitedHandler(mockSocket, 'room:create', handler);

            // Pass undefined as ackCallback
            await wrapped({}, undefined);
            expect(handler).not.toHaveBeenCalled();
        });
    });

    describe('ackCallback on handler error (line 153)', () => {
        it('calls ackCallback with { error: true } when handler throws', async () => {
            const error = new Error('Handler failed');
            (error as any).code = 'SERVER_ERROR';
            const handler = jest.fn().mockRejectedValue(error);
            const wrapped = createRateLimitedHandler(mockSocket, 'game:reveal', handler);
            const ackCallback = jest.fn();

            await wrapped({ cardIndex: 5 }, ackCallback);

            expect(handler).toHaveBeenCalledWith({ cardIndex: 5 });
            expect(ackCallback).toHaveBeenCalledWith({ error: true });
            expect(mockSocket.emit).toHaveBeenCalledWith('game:error', expect.objectContaining({
                code: 'SERVER_ERROR'
            }));
        });

        it('does not call ackCallback when not provided (error path)', async () => {
            const handler = jest.fn().mockRejectedValue(new Error('fail'));
            const wrapped = createRateLimitedHandler(mockSocket, 'game:reveal', handler);

            // Should not throw when no ackCallback
            await wrapped({});
            expect(handler).toHaveBeenCalled();
        });

        it('does not call ackCallback when it is not a function (error path)', async () => {
            const handler = jest.fn().mockRejectedValue(new Error('fail'));
            const wrapped = createRateLimitedHandler(mockSocket, 'game:reveal', handler);

            // Pass a number as ackCallback
            await wrapped({}, 42);
            expect(handler).toHaveBeenCalled();
        });
    });

    describe('ackCallback with all three paths combined', () => {
        it('success then error on different calls both trigger correct ack', async () => {
            // First call succeeds
            const handler = jest.fn()
                .mockResolvedValueOnce('ok')
                .mockRejectedValueOnce(new Error('fail'));

            const wrapped = createRateLimitedHandler(mockSocket, 'player:setTeam', handler);
            const ack1 = jest.fn();
            const ack2 = jest.fn();

            await wrapped({ team: 'red' }, ack1);
            expect(ack1).toHaveBeenCalledWith({ ok: true });

            await wrapped({ team: 'blue' }, ack2);
            expect(ack2).toHaveBeenCalledWith({ error: true });
        });
    });
});
