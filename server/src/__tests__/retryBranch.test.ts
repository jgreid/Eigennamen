/**
 * Retry Branch Coverage Tests
 */

jest.mock('../config/constants', () => ({
    RETRY_CONFIG: {
        REDIS_OPERATION: { maxRetries: 3, baseDelayMs: 1 },
        DATABASE: { maxRetries: 3, baseDelayMs: 1 },
        OPTIMISTIC_LOCK: { maxRetries: 3, baseDelayMs: 1 },
        NETWORK_REQUEST: { maxRetries: 4, baseDelayMs: 1 },
        DISTRIBUTED_LOCK: { maxRetries: 3, baseDelayMs: 1 },
        RACE_CONDITION: { delayMs: 1 }
    }
}));

describe('Retry Branch Coverage', () => {
    let withRetry: any;
    let createRetryWrapper: any;

    beforeEach(() => {
        jest.clearAllMocks();
        const mod = require('../utils/retry');
        withRetry = mod.withRetry;
        createRetryWrapper = mod.createRetryWrapper;
    });

    it('should not add jitter when jitter is false', async () => {
        let callCount = 0;
        const fn = async () => {
            callCount++;
            if (callCount < 2) throw new Error('fail');
            return 'ok';
        };
        const result = await withRetry(fn, { maxRetries: 3, baseDelayMs: 1, jitter: false });
        expect(result).toBe('ok');
        expect(callCount).toBe(2);
    });

    it('should throw immediately when shouldRetry returns false', async () => {
        const fn = async () => { throw new Error('non-retryable'); };
        await expect(withRetry(fn, {
            maxRetries: 3, baseDelayMs: 1, shouldRetry: () => false
        })).rejects.toThrow('non-retryable');
    });

    it('should call onRetry before each retry', async () => {
        let callCount = 0;
        const onRetry = jest.fn();
        const fn = async () => {
            callCount++;
            if (callCount < 3) throw new Error('temporary');
            return 'success';
        };
        await withRetry(fn, { maxRetries: 5, baseDelayMs: 1, onRetry });
        expect(onRetry).toHaveBeenCalledTimes(2);
    });

    it('should create a wrapper with preset config', async () => {
        const wrapper = createRetryWrapper({ maxRetries: 2, baseDelayMs: 1 });
        const result = await wrapper(async () => 'wrapped');
        expect(result).toBe('wrapped');
    });

    it('should allow overriding preset config', async () => {
        const wrapper = createRetryWrapper({ maxRetries: 1, baseDelayMs: 1 });
        let callCount = 0;
        const result = await wrapper(async () => {
            callCount++;
            if (callCount < 2) throw new Error('once');
            return 'ok';
        }, { maxRetries: 2 });
        expect(result).toBe('ok');
    });

    it('should throw when maxRetries is 0', async () => {
        const fn = async () => 'never called';
        await expect(withRetry(fn, { maxRetries: 0 })).rejects.toBeUndefined();
    });
});
