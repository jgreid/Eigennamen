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

const {
    DistributedLock,
    acquire,
    withLock,
    isLocked,
    getLockOwner,
    forceRelease
} = require('../utils/distributedLock');

// Mock Redis
const mockRedis = {
    set: jest.fn(),
    get: jest.fn(),
    del: jest.fn(),
    exists: jest.fn(),
    eval: jest.fn()
};

jest.mock('../config/redis', () => ({
    getRedis: () => mockRedis
}));

// Mock logger
jest.mock('../utils/logger', () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
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
                .mockResolvedValueOnce('OK')   // First acquirer succeeds
                .mockResolvedValue(null);       // Others fail

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
                .mockResolvedValueOnce('OK')   // First acquirer
                .mockResolvedValueOnce(null)   // Second tries, fails
                .mockResolvedValueOnce('OK');  // Second tries again after release

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
            const acquired = results.filter(r => r.acquired);
            const failed = results.filter(r => !r.acquired);

            expect(acquired).toHaveLength(1);
            expect(failed).toHaveLength(4);
        });
    });

    describe('Lock Expiration', () => {
        test('lock expires after timeout allowing new acquisition', async () => {
            jest.useFakeTimers();

            mockRedis.set
                .mockResolvedValueOnce('OK')   // First acquire
                .mockResolvedValueOnce(null)   // Fails while lock exists
                .mockResolvedValueOnce('OK');  // Succeeds after expiry

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

    describe('Lock Holder Crash Recovery', () => {
        test('force release allows recovery from crashed lock holder', async () => {
            mockRedis.del.mockResolvedValueOnce(1);
            mockRedis.set.mockResolvedValueOnce('OK');

            const lock = new DistributedLock();

            // Simulate crashed lock holder by force releasing
            const forceReleased = await lock.forceRelease('crashed-lock');
            expect(forceReleased).toBe(true);

            // New process can now acquire
            const result = await lock.acquire('crashed-lock');
            expect(result.acquired).toBe(true);
        });

        test('force release on non-existent lock returns false', async () => {
            mockRedis.del.mockResolvedValueOnce(0);

            const lock = new DistributedLock();
            const result = await lock.forceRelease('non-existent-lock');
            expect(result).toBe(false);
        });

        test('isLocked returns false for expired locks', async () => {
            mockRedis.exists.mockResolvedValueOnce(0);

            const result = await isLocked('expired-lock');
            expect(result).toBe(false);
        });

        test('getLockOwner returns null for expired locks', async () => {
            mockRedis.get.mockResolvedValueOnce(null);

            const owner = await getLockOwner('expired-lock');
            expect(owner).toBeNull();
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

        test('releases lock even when wrapped function returns rejected promise', async () => {
            mockRedis.set.mockResolvedValueOnce('OK');
            mockRedis.eval.mockResolvedValueOnce(1);

            const lock = new DistributedLock();

            await expect(
                lock.withLock('rejected-lock', () => Promise.reject(new Error('Rejected')))
            ).rejects.toThrow('Rejected');

            expect(mockRedis.eval).toHaveBeenCalled();
        });

        test('withLock fails gracefully when lock acquisition times out', async () => {
            mockRedis.set.mockResolvedValue(null); // Always fail

            const lock = new DistributedLock({ maxRetries: 2, retryDelay: 5 });

            await expect(
                lock.withLock('unavailable-lock', () => 'should not run')
            ).rejects.toThrow('Failed to acquire lock');
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

        test('handles Redis errors during release gracefully', async () => {
            mockRedis.set.mockResolvedValueOnce('OK');
            mockRedis.eval.mockRejectedValueOnce(new Error('Redis disconnected'));

            const lock = new DistributedLock();
            const result = await lock.acquire('release-error-lock');

            const released = await result.release();
            expect(released).toBe(false);
        });

        test('handles Redis errors during extend gracefully', async () => {
            mockRedis.set.mockResolvedValueOnce('OK');
            mockRedis.eval.mockRejectedValueOnce(new Error('Redis timeout'));

            const lock = new DistributedLock();
            const result = await lock.acquire('extend-error-lock');

            const extended = await result.extend(5000);
            expect(extended).toBe(false);
        });
    });

    describe('Lock Key Format', () => {
        test('uses correct key prefix', async () => {
            mockRedis.set.mockResolvedValueOnce('OK');

            const lock = new DistributedLock();
            await lock.acquire('my-resource');

            expect(mockRedis.set).toHaveBeenCalledWith(
                'lock:my-resource',
                expect.any(String),
                expect.any(Object)
            );
        });

        test('handles special characters in lock name', async () => {
            mockRedis.set.mockResolvedValueOnce('OK');

            const lock = new DistributedLock();
            await lock.acquire('room:TEST12:game');

            expect(mockRedis.set).toHaveBeenCalledWith(
                'lock:room:TEST12:game',
                expect.any(String),
                expect.any(Object)
            );
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

        test('owner ID is a non-empty string', async () => {
            mockRedis.set.mockResolvedValueOnce('OK');

            const lock = new DistributedLock();
            const result = await lock.acquire('owner-test');

            expect(typeof result.ownerId).toBe('string');
            expect(result.ownerId.length).toBeGreaterThan(0);
        });
    });

    describe('Retry Configuration', () => {
        test('retries on initial failure then succeeds', async () => {
            mockRedis.set
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce('OK');

            const lock = new DistributedLock({ retryDelay: 5, maxRetries: 2 });
            const result = await lock.acquire('retry-lock');

            expect(result.acquired).toBe(true);
            expect(mockRedis.set).toHaveBeenCalledTimes(2);
        });

        test('respects maxRetries limit', async () => {
            mockRedis.set.mockResolvedValue(null);

            const lock = new DistributedLock({ maxRetries: 2, retryDelay: 5 });
            const result = await lock.acquire('limited-retry-lock');

            expect(result.acquired).toBe(false);
            expect(mockRedis.set).toHaveBeenCalledTimes(2);
        });

        test('respects custom lock timeout', async () => {
            mockRedis.set.mockResolvedValueOnce('OK');

            const lock = new DistributedLock({ lockTimeout: 30000 });
            await lock.acquire('long-timeout-lock');

            expect(mockRedis.set).toHaveBeenCalledWith(
                'lock:long-timeout-lock',
                expect.any(String),
                { NX: true, PX: 30000 }
            );
        });
    });

    describe('Convenience Functions', () => {
        test('acquire function uses singleton instance', async () => {
            mockRedis.set.mockResolvedValueOnce('OK');

            const result = await acquire('convenience-lock');
            expect(result.acquired).toBe(true);
        });

        test('withLock function uses singleton instance', async () => {
            mockRedis.set.mockResolvedValueOnce('OK');
            mockRedis.eval.mockResolvedValueOnce(1);

            const result = await withLock('convenience-lock', () => 'success');
            expect(result).toBe('success');
        });

        test('isLocked function uses singleton instance', async () => {
            mockRedis.exists.mockResolvedValueOnce(1);

            const result = await isLocked('convenience-lock');
            expect(result).toBe(true);
        });

        test('getLockOwner function uses singleton instance', async () => {
            mockRedis.get.mockResolvedValueOnce('owner-123');

            const result = await getLockOwner('convenience-lock');
            expect(result).toBe('owner-123');
        });

        test('forceRelease function uses singleton instance', async () => {
            mockRedis.del.mockResolvedValueOnce(1);

            const result = await forceRelease('convenience-lock');
            expect(result).toBe(true);
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
