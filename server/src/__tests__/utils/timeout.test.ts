/**
 * Timeout Utility Tests
 *
 * Tests for async timeout wrapper and related utilities
 */

jest.mock('../../utils/logger', () => ({
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
}));

const { withTimeout, TimeoutError, TIMEOUTS } = require('../../utils/timeout');
const logger = require('../../utils/logger');

describe('Timeout Utility', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    describe('TimeoutError', () => {
        test('creates error with message and operation name', () => {
            const error = new TimeoutError('Operation timed out', 'testOperation');

            expect(error.message).toBe('Operation timed out');
            expect(error.name).toBe('TimeoutError');
            expect(error.operationName).toBe('testOperation');
            expect(error.code).toBe('OPERATION_TIMEOUT');
        });

        test('is instanceof Error', () => {
            const error = new TimeoutError('Test', 'test');
            expect(error instanceof Error).toBe(true);
        });

        test('has proper stack trace', () => {
            const error = new TimeoutError('Test', 'test');
            expect(error.stack).toBeDefined();
            expect(error.stack).toContain('TimeoutError');
        });
    });

    describe('withTimeout', () => {
        test('resolves when promise completes before timeout', async () => {
            const promise = Promise.resolve('success');

            const result = await withTimeout(promise, 1000, 'testOp');

            expect(result).toBe('success');
        });

        test('resolves with correct value for async operation', async () => {
            jest.useRealTimers();

            const promise = new Promise((resolve) => {
                setTimeout(() => resolve({ data: 'test' }), 10);
            });

            const result = await withTimeout(promise, 1000, 'asyncOp');

            expect(result).toEqual({ data: 'test' });
        });

        test('rejects with TimeoutError when timeout exceeded', async () => {
            const neverResolves = new Promise(() => {}); // Never resolves

            const promise = withTimeout(neverResolves, 100, 'slowOp');

            jest.advanceTimersByTime(150);

            await expect(promise).rejects.toThrow(TimeoutError);
            await expect(promise).rejects.toMatchObject({
                operationName: 'slowOp',
                code: 'OPERATION_TIMEOUT',
            });
        });

        test('logs error when timeout occurs', async () => {
            const neverResolves = new Promise(() => {});

            const promise = withTimeout(neverResolves, 100, 'loggingOp');

            jest.advanceTimersByTime(150);

            try {
                await promise;
            } catch {
                // Expected
            }

            expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Operation timeout: loggingOp'));
        });

        test('includes timeout duration in error message', async () => {
            const neverResolves = new Promise(() => {});

            const promise = withTimeout(neverResolves, 5000, 'durationOp');

            jest.advanceTimersByTime(5500);

            await expect(promise).rejects.toThrow(/5000ms/);
        });

        test('clears timeout when promise resolves', async () => {
            const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');

            const promise = Promise.resolve('done');

            await withTimeout(promise, 1000, 'clearTest');

            expect(clearTimeoutSpy).toHaveBeenCalled();
            clearTimeoutSpy.mockRestore();
        });

        test('clears timeout when promise rejects', async () => {
            const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');

            const promise = Promise.reject(new Error('Original error'));

            await expect(withTimeout(promise, 1000, 'rejectTest')).rejects.toThrow('Original error');

            expect(clearTimeoutSpy).toHaveBeenCalled();
            clearTimeoutSpy.mockRestore();
        });

        test('propagates original error when promise rejects before timeout', async () => {
            const originalError = new Error('Original failure');
            originalError.code = 'ORIGINAL_CODE';
            const promise = Promise.reject(originalError);

            await expect(withTimeout(promise, 1000, 'errorTest')).rejects.toThrow('Original failure');
        });

        test('uses default operation name when not provided', async () => {
            const neverResolves = new Promise(() => {});

            const promise = withTimeout(neverResolves, 100);

            jest.advanceTimersByTime(150);

            await expect(promise).rejects.toThrow(/operation timed out/i);
        });
    });

    describe('TIMEOUTS constants', () => {
        test('SOCKET_HANDLER is 30 seconds', () => {
            expect(TIMEOUTS.SOCKET_HANDLER).toBe(30000);
        });

        test('REDIS_OPERATION is 10 seconds', () => {
            expect(TIMEOUTS.REDIS_OPERATION).toBe(10000);
        });

        test('JOIN_ROOM is 15 seconds', () => {
            expect(TIMEOUTS.JOIN_ROOM).toBe(15000);
        });

        test('RECONNECT is 15 seconds', () => {
            expect(TIMEOUTS.RECONNECT).toBe(15000);
        });

        test('GAME_ACTION is 10 seconds', () => {
            expect(TIMEOUTS.GAME_ACTION).toBe(10000);
        });

        test('TIMER_OPERATION is 5 seconds', () => {
            expect(TIMEOUTS.TIMER_OPERATION).toBe(5000);
        });

        test('all timeout values are positive numbers', () => {
            Object.values(TIMEOUTS).forEach((value) => {
                expect(typeof value).toBe('number');
                expect(value).toBeGreaterThan(0);
            });
        });
    });

    describe('Real-world scenarios', () => {
        beforeEach(() => {
            jest.useRealTimers();
        });

        test('handles fast-resolving promise correctly', async () => {
            const fastPromise = Promise.resolve('fast');
            const result = await withTimeout(fastPromise, 5000, 'fastOp');
            expect(result).toBe('fast');
        });

        test('handles async function correctly', async () => {
            async function asyncOperation() {
                await new Promise((resolve) => setTimeout(resolve, 10));
                return 'async result';
            }

            const result = await withTimeout(asyncOperation(), 1000, 'asyncFn');
            expect(result).toBe('async result');
        });

        test('race condition: promise resolves just before timeout', async () => {
            const promise = new Promise((resolve) => {
                setTimeout(() => resolve('just in time'), 50);
            });

            const result = await withTimeout(promise, 100, 'raceOp');
            expect(result).toBe('just in time');
        });
    });

    describe('envInt (tested via module re-require)', () => {
        const originalEnv = process.env;

        afterEach(() => {
            process.env = originalEnv;
            jest.resetModules();
        });

        test('returns default when env var is not set', () => {
            // Already tested by TIMEOUTS defaults above, but let's be explicit
            expect(TIMEOUTS.SOCKET_HANDLER).toBe(30000);
        });

        test('uses env var when set to valid value', () => {
            jest.resetModules();
            process.env = { ...originalEnv, TIMEOUT_SOCKET_HANDLER: '20000' };
            const { TIMEOUTS: t } = require('../../utils/timeout');
            expect(t.SOCKET_HANDLER).toBe(20000);
        });

        test('returns default for NaN env var', () => {
            jest.resetModules();
            process.env = { ...originalEnv, TIMEOUT_SOCKET_HANDLER: 'notanumber' };
            const { TIMEOUTS: t } = require('../../utils/timeout');
            expect(t.SOCKET_HANDLER).toBe(30000);
        });

        test('returns default for negative env var', () => {
            jest.resetModules();
            process.env = { ...originalEnv, TIMEOUT_SOCKET_HANDLER: '-100' };
            const { TIMEOUTS: t } = require('../../utils/timeout');
            expect(t.SOCKET_HANDLER).toBe(30000);
        });

        test('returns default for zero env var', () => {
            jest.resetModules();
            process.env = { ...originalEnv, TIMEOUT_SOCKET_HANDLER: '0' };
            const { TIMEOUTS: t } = require('../../utils/timeout');
            expect(t.SOCKET_HANDLER).toBe(30000);
        });

        test('clamps value below minimum to minimum', () => {
            jest.resetModules();
            // SOCKET_HANDLER min is 5000, max is 120000
            process.env = { ...originalEnv, TIMEOUT_SOCKET_HANDLER: '1000' };
            // Re-mock logger after resetModules so the fresh require picks it up
            jest.mock('../../utils/logger', () => ({
                error: jest.fn(),
                warn: jest.fn(),
                info: jest.fn(),
                debug: jest.fn(),
            }));
            const { TIMEOUTS: t } = require('../../utils/timeout');
            const freshLogger = require('../../utils/logger');
            expect(t.SOCKET_HANDLER).toBe(5000);
            expect(freshLogger.warn).toHaveBeenCalledWith(expect.stringContaining('out of bounds'));
        });

        test('clamps value above maximum to maximum', () => {
            jest.resetModules();
            // SOCKET_HANDLER min is 5000, max is 120000
            process.env = { ...originalEnv, TIMEOUT_SOCKET_HANDLER: '500000' };
            jest.mock('../../utils/logger', () => ({
                error: jest.fn(),
                warn: jest.fn(),
                info: jest.fn(),
                debug: jest.fn(),
            }));
            const { TIMEOUTS: t } = require('../../utils/timeout');
            const freshLogger = require('../../utils/logger');
            expect(t.SOCKET_HANDLER).toBe(120000);
            expect(freshLogger.warn).toHaveBeenCalledWith(expect.stringContaining('out of bounds'));
        });

        test('accepts value at exact minimum boundary', () => {
            jest.resetModules();
            process.env = { ...originalEnv, TIMEOUT_SOCKET_HANDLER: '5000' };
            const { TIMEOUTS: t } = require('../../utils/timeout');
            expect(t.SOCKET_HANDLER).toBe(5000);
        });

        test('accepts value at exact maximum boundary', () => {
            jest.resetModules();
            process.env = { ...originalEnv, TIMEOUT_SOCKET_HANDLER: '120000' };
            const { TIMEOUTS: t } = require('../../utils/timeout');
            expect(t.SOCKET_HANDLER).toBe(120000);
        });

        test('returns default for empty string env var', () => {
            jest.resetModules();
            process.env = { ...originalEnv, TIMEOUT_SOCKET_HANDLER: '' };
            const { TIMEOUTS: t } = require('../../utils/timeout');
            expect(t.SOCKET_HANDLER).toBe(30000);
        });
    });
});
