/**
 * Tests for retryAsync utility
 */

jest.mock('../../utils/logger', () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
}));

import { retryAsync } from '../../utils/retryAsync';

const mockLogger = require('../../utils/logger');

describe('retryAsync', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.useRealTimers();
    });

    it('returns result on first attempt if fn succeeds', async () => {
        const fn = jest.fn().mockResolvedValue('ok');
        const result = await retryAsync(fn);
        expect(result).toBe('ok');
        expect(fn).toHaveBeenCalledTimes(1);
        expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    it('retries on failure and returns result on success', async () => {
        const fn = jest
            .fn()
            .mockRejectedValueOnce(new Error('fail-1'))
            .mockRejectedValueOnce(new Error('fail-2'))
            .mockResolvedValue('ok');

        const result = await retryAsync(fn, {
            maxRetries: 3,
            baseDelayMs: 1,
            operationName: 'test-op',
        });

        expect(result).toBe('ok');
        expect(fn).toHaveBeenCalledTimes(3);
        expect(mockLogger.warn).toHaveBeenCalledTimes(2);
        expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('test-op failed (attempt 1/4)'));
    });

    it('throws after exhausting all retries', async () => {
        const fn = jest.fn().mockRejectedValue(new Error('persistent-fail'));

        await expect(retryAsync(fn, { maxRetries: 2, baseDelayMs: 1, operationName: 'doomed' })).rejects.toThrow(
            'persistent-fail'
        );

        // initial + 2 retries = 3
        expect(fn).toHaveBeenCalledTimes(3);
        expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('doomed failed after 3 attempts'));
    });

    it('uses exponential backoff by default', async () => {
        jest.useFakeTimers();

        const fn = jest
            .fn()
            .mockRejectedValueOnce(new Error('e1'))
            .mockRejectedValueOnce(new Error('e2'))
            .mockResolvedValue('ok');

        const promise = retryAsync(fn, { maxRetries: 3, baseDelayMs: 100 });

        // First retry delay: 100 * 2^0 = 100ms
        await jest.advanceTimersByTimeAsync(100);
        // Second retry delay: 100 * 2^1 = 200ms
        await jest.advanceTimersByTimeAsync(200);

        const result = await promise;
        expect(result).toBe('ok');
        jest.useRealTimers();
    });

    it('uses flat delay when exponentialBackoff is false', async () => {
        jest.useFakeTimers();

        const fn = jest
            .fn()
            .mockRejectedValueOnce(new Error('e1'))
            .mockRejectedValueOnce(new Error('e2'))
            .mockResolvedValue('ok');

        const promise = retryAsync(fn, {
            maxRetries: 3,
            baseDelayMs: 50,
            exponentialBackoff: false,
        });

        // Both retries use base delay of 50ms
        await jest.advanceTimersByTimeAsync(50);
        await jest.advanceTimersByTimeAsync(50);

        const result = await promise;
        expect(result).toBe('ok');
        jest.useRealTimers();
    });

    it('uses default options when none provided', async () => {
        const fn = jest.fn().mockRejectedValueOnce(new Error('e')).mockResolvedValue('ok');

        const result = await retryAsync(fn);
        expect(result).toBe('ok');
        expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('operation failed (attempt 1/4)'));
    });

    it('handles zero maxRetries (no retries)', async () => {
        const fn = jest.fn().mockRejectedValue(new Error('no-retry'));

        await expect(retryAsync(fn, { maxRetries: 0, baseDelayMs: 1 })).rejects.toThrow('no-retry');

        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('preserves original error type', async () => {
        class CustomError extends Error {
            code = 'CUSTOM';
        }
        const fn = jest.fn().mockRejectedValue(new CustomError('custom'));

        try {
            await retryAsync(fn, { maxRetries: 1, baseDelayMs: 1 });
            fail('Should have thrown');
        } catch (error) {
            expect(error).toBeInstanceOf(CustomError);
            expect((error as CustomError).code).toBe('CUSTOM');
        }
    });
});
