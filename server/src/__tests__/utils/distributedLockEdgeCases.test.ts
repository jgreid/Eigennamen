/**
 * Distributed Lock Edge Case Tests
 *
 * Tests for edge cases and stress scenarios in distributed locking:
 * - Lock contention between multiple instances
 * - Lock expiration and timeout handling
 * - Recovery from lock holder crashes
 * - Auto-extend behavior under load
 * - Race conditions in lock acquisition
 */

const { DistributedLock } = require('../../utils/distributedLock');

// Mock Redis
const mockRedis = {
    set: jest.fn(),
    get: jest.fn(),
    del: jest.fn(),
    exists: jest.fn(),
    eval: jest.fn(),
};

jest.mock('../../config/redis', () => ({
    getRedis: () => mockRedis,
}));

// Mock logger
jest.mock('../../utils/logger', () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
}));

describe('Distributed Lock Edge Cases', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.useRealTimers();
    });

    describe('Lock Contention', () => {
        test('first acquirer wins, subsequent attempts retry', async () => {
            // First call succeeds, subsequent calls fail until release
            mockRedis.set
                .mockResolvedValueOnce('OK') // First acquirer succeeds
                .mockResolvedValue(null); // Others fail

            const lock = new DistributedLock({ retryDelay: 10, maxRetries: 3 });

            // First acquire should succeed
            const first = await lock.acquire('contended-lock');
            expect(first.acquired).toBe(true);

            // Second acquire should fail (no more OK responses)
            const second = await lock.acquire('contended-lock');
            expect(second.acquired).toBe(false);
        });

        test('second acquirer succeeds after first releases', async () => {
            mockRedis.set
                .mockResolvedValueOnce('OK') // First acquirer
                .mockResolvedValueOnce(null) // Second tries, fails
                .mockResolvedValueOnce('OK'); // Second tries again after release

            mockRedis.eval.mockResolvedValue(1); // Release succeeds

            const lock = new DistributedLock({ retryDelay: 5, maxRetries: 3 });

            const first = await lock.acquire('contended-lock');
            expect(first.acquired).toBe(true);

            // Start second acquire (will retry)
            const secondPromise = lock.acquire('contended-lock');

            // Release first lock while second is retrying
            await first.release();

            const second = await secondPromise;
            expect(second.acquired).toBe(true);
        });

        test('handles many concurrent acquisition attempts', async () => {
            let acquireCount = 0;
            mockRedis.set.mockImplementation(async () => {
                acquireCount++;
                // Only first call succeeds
                return acquireCount === 1 ? 'OK' : null;
            });

            const lock = new DistributedLock({ retryDelay: 5, maxRetries: 2 });
            const attempts = 5;
            const promises = [];

            for (let i = 0; i < attempts; i++) {
                promises.push(lock.acquire('concurrent-lock'));
            }

            const results = await Promise.all(promises);
            const acquired = results.filter((r) => r.acquired);
            const failed = results.filter((r) => !r.acquired);

            expect(acquired).toHaveLength(1);
            expect(failed).toHaveLength(4);
        });
    });

    describe('Lock Expiration', () => {
        test('lock expires after timeout allowing new acquisition', async () => {
            jest.useFakeTimers();

            mockRedis.set
                .mockResolvedValueOnce('OK') // First acquire
                .mockResolvedValueOnce(null) // Fails while lock exists
                .mockResolvedValueOnce('OK'); // Succeeds after expiry

            const lock = new DistributedLock({ lockTimeout: 1000, retryDelay: 600, maxRetries: 3 });

            const first = await lock.acquire('expiring-lock');
            expect(first.acquired).toBe(true);

            // Start second acquire (will retry)
            const secondPromise = lock.acquire('expiring-lock');

            // Advance time past lock expiry
            jest.advanceTimersByTime(1100);

            jest.useRealTimers();
            const second = await secondPromise;
            // Note: In real scenario with Redis TTL, lock would expire
            // Here we simulate by controlling mock responses
            expect(second.acquired).toBe(true);
        });

        test('extend prevents lock expiration', async () => {
            mockRedis.set.mockResolvedValueOnce('OK');
            mockRedis.eval.mockResolvedValue(1); // Extend succeeds

            const lock = new DistributedLock({ lockTimeout: 1000 });
            const result = await lock.acquire('extending-lock');
            expect(result.acquired).toBe(true);

            // Extend the lock
            const extended = await result.extend(5000);
            expect(extended).toBe(true);

            expect(mockRedis.eval).toHaveBeenCalled();
        });

        test('extend fails if lock was stolen', async () => {
            mockRedis.set.mockResolvedValueOnce('OK');
            mockRedis.eval.mockResolvedValue(0); // Lock owned by someone else

            const lock = new DistributedLock();
            const result = await lock.acquire('stolen-lock');

            // Try to extend (lock was stolen by another process)
            const extended = await result.extend(5000);
            expect(extended).toBe(false);
        });
    });

    describe('withLock Error Handling', () => {
        test('releases lock even when wrapped function throws', async () => {
            mockRedis.set.mockResolvedValueOnce('OK');
            mockRedis.eval.mockResolvedValueOnce(1);

            const lock = new DistributedLock();

            await expect(
                lock.withLock('error-lock', async () => {
                    throw new Error('Operation failed');
                })
            ).rejects.toThrow('Operation failed');

            // Lock should have been released
            expect(mockRedis.eval).toHaveBeenCalled();
        });
    });

    describe('Redis Failure Handling', () => {
        test('retries on transient Redis errors', async () => {
            mockRedis.set
                .mockRejectedValueOnce(new Error('Connection reset'))
                .mockRejectedValueOnce(new Error('Timeout'))
                .mockResolvedValueOnce('OK');

            const lock = new DistributedLock({ retryDelay: 5, maxRetries: 5 });
            const result = await lock.acquire('resilient-lock');

            expect(result.acquired).toBe(true);
            expect(mockRedis.set).toHaveBeenCalledTimes(3);
        });

        test('fails after max retries on persistent Redis errors', async () => {
            mockRedis.set.mockRejectedValue(new Error('Redis unavailable'));

            const lock = new DistributedLock({ retryDelay: 5, maxRetries: 3 });
            const result = await lock.acquire('unavailable-lock');

            expect(result.acquired).toBe(false);
            expect(mockRedis.set).toHaveBeenCalledTimes(3);
        });
    });

    describe('Lock Key Format', () => {
        test('handles special characters in lock name', async () => {
            mockRedis.set.mockResolvedValueOnce('OK');

            const lock = new DistributedLock();
            await lock.acquire('room:TEST12:game');

            expect(mockRedis.set).toHaveBeenCalledWith('lock:room:TEST12:game', expect.any(String), expect.any(Object));
        });
    });

    describe('Owner ID Generation', () => {
        test('generates unique owner IDs for each acquisition', async () => {
            mockRedis.set.mockResolvedValue('OK');
            mockRedis.eval.mockResolvedValue(1);

            const lock = new DistributedLock();

            const first = await lock.acquire('unique-lock');
            const firstOwnerId = first.ownerId;
            await first.release();

            const second = await lock.acquire('unique-lock');
            const secondOwnerId = second.ownerId;

            expect(firstOwnerId).not.toBe(secondOwnerId);
        });
    });

    describe('Memory Leak Prevention', () => {
        test('acquire completes without hanging promises', async () => {
            mockRedis.set.mockResolvedValueOnce('OK');

            const lock = new DistributedLock();
            const result = await lock.acquire('timer-test');

            // Should complete without timing out
            expect(result.acquired).toBe(true);
        });

        test('failed acquire completes cleanly', async () => {
            mockRedis.set.mockResolvedValue(null);

            const lock = new DistributedLock({ maxRetries: 2, retryDelay: 5 });
            const result = await lock.acquire('timer-fail-test');

            // Should complete without hanging
            expect(result.acquired).toBe(false);
        });
    });
});
