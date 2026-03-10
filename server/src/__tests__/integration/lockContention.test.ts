/**
 * Distributed Lock Contention Tests
 *
 * Tests lock contention scenarios to verify mutual exclusion, error handling,
 * ownership semantics, auto-extension, and retry exhaustion using a mocked Redis.
 */

const mockLocks = new Map<string, string>();
const pendingTimers = new Set<ReturnType<typeof setTimeout>>();

jest.mock('../../config/redis', () => ({
    getRedis: () => ({
        set: jest.fn(async (key: string, value: string, options: any) => {
            if (options && options.NX) {
                if (mockLocks.has(key)) return null;
                mockLocks.set(key, value);
                // Auto-expire
                if (options.PX) {
                    const timerId = setTimeout(() => {
                        if (mockLocks.get(key) === value) mockLocks.delete(key);
                        pendingTimers.delete(timerId);
                    }, options.PX);
                    pendingTimers.add(timerId);
                }
                return 'OK';
            }
            mockLocks.set(key, value);
            return 'OK';
        }),
        eval: jest.fn(async (_script: string, options: any) => {
            const key = options.keys[0];
            const ownerId = options.arguments[0];
            // Extend script: only extend if owned (check before release so we
            // don't accidentally delete the lock on extension calls)
            if (options.arguments.length > 1 && mockLocks.get(key) === ownerId) {
                return 1;
            }
            // Release script: only release if owned
            if (mockLocks.get(key) === ownerId) {
                mockLocks.delete(key);
                return 1;
            }
            return 0;
        }),
    }),
}));

jest.mock('../../utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
}));

import { DistributedLock } from '../../utils/distributedLock';

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('Distributed Lock Contention', () => {
    beforeEach(() => {
        mockLocks.clear();
    });

    afterEach(() => {
        // Clear all pending auto-expire timers to prevent open handles
        for (const timerId of pendingTimers) {
            clearTimeout(timerId);
        }
        pendingTimers.clear();
    });

    describe('Lock acquisition contention', () => {
        test('only one caller executes at a time with concurrent withLock calls', async () => {
            const lock = new DistributedLock({
                lockTimeout: 5000,
                retryDelay: 10,
                maxRetries: 50,
            });
            let counter = 0;
            const results: number[] = [];

            // Launch 5 concurrent withLock calls on the same key.
            // Each one reads the counter, sleeps briefly, then increments.
            // If mutual exclusion holds, each caller sees a unique counter value
            // and the final count is exactly 5.
            const tasks = Array.from({ length: 5 }, () =>
                lock.withLock('contention-key', async () => {
                    const current = counter;
                    await sleep(20);
                    counter = current + 1;
                    results.push(counter);
                })
            );

            await Promise.all(tasks);

            expect(counter).toBe(5);
            // Each result should be a strictly increasing sequence: 1, 2, 3, 4, 5
            expect(results).toEqual([1, 2, 3, 4, 5]);
        });
    });

    describe('Lock release on error', () => {
        test('lock is released when fn() throws inside withLock', async () => {
            const lock = new DistributedLock({
                lockTimeout: 5000,
                retryDelay: 10,
                maxRetries: 10,
            });

            // First call: fn throws an error
            await expect(
                lock.withLock('error-key', async () => {
                    throw new Error('intentional failure');
                })
            ).rejects.toThrow('intentional failure');

            // The lock should have been released despite the error.
            // Verify by successfully acquiring the same lock immediately.
            let executed = false;
            await lock.withLock('error-key', async () => {
                executed = true;
            });

            expect(executed).toBe(true);
        });
    });

    describe('Lock ownership', () => {
        test('releasing a lock with the wrong owner ID should fail', async () => {
            const lock = new DistributedLock({
                lockTimeout: 5000,
                retryDelay: 10,
                maxRetries: 5,
            });

            // Acquire the lock
            const result = await lock.acquire('ownership-key');
            expect(result.acquired).toBe(true);
            expect(result.ownerId).toBeDefined();
            expect(result.release).toBeDefined();

            // Try to release with a wrong owner ID via the release method directly
            const wrongOwnerId = 'wrong-owner-id';
            const releaseResult = await lock.release(`lock:ownership-key`, wrongOwnerId);
            expect(releaseResult).toBe(false);

            // The lock should still be held — verify it's still in the mock store
            expect(mockLocks.has('lock:ownership-key')).toBe(true);

            // Release with the correct owner should succeed
            const correctRelease = await result.release!();
            expect(correctRelease).toBe(true);
            expect(mockLocks.has('lock:ownership-key')).toBe(false);
        });
    });

    describe('withAutoExtend', () => {
        test('long-running operation completes with auto-extended lock', async () => {
            // Use a short lock timeout so the extension timer fires during the operation
            const lock = new DistributedLock({
                lockTimeout: 100,
                extendThreshold: 0.5, // extend every 50ms
                retryDelay: 10,
                maxRetries: 10,
            });

            let completed = false;

            await lock.withAutoExtend('autoextend-key', async () => {
                // Sleep longer than the lock timeout — the auto-extend should keep it alive
                await sleep(300);
                completed = true;
            });

            expect(completed).toBe(true);

            // After completion, the lock should have been released
            expect(mockLocks.has('lock:autoextend-key')).toBe(false);
        });
    });

    describe('Max retries exceeded', () => {
        test('fails after maxRetries when lock is held indefinitely', async () => {
            const lock = new DistributedLock({
                lockTimeout: 60000, // Long timeout so it never expires during the test
                retryDelay: 10,
                maxRetries: 2,
            });

            // Manually plant a lock that will never be released
            mockLocks.set('lock:held-key', 'permanent-holder');

            // Attempting to acquire should fail after 2 retries
            const result = await lock.acquire('held-key', { maxRetries: 2, retryDelay: 10 });
            expect(result.acquired).toBe(false);
            expect(result.ownerId).toBeUndefined();
            expect(result.release).toBeUndefined();
        });

        test('withLock throws ServerError after maxRetries exceeded', async () => {
            const lock = new DistributedLock({
                lockTimeout: 60000,
                retryDelay: 10,
                maxRetries: 2,
            });

            // Manually plant a lock that will never be released
            mockLocks.set('lock:held-key-2', 'permanent-holder');

            await expect(
                lock.withLock(
                    'held-key-2',
                    async () => {
                        return 'should not reach here';
                    },
                    { maxRetries: 2, retryDelay: 10 }
                )
            ).rejects.toThrow('Failed to acquire lock');
        });
    });
});
