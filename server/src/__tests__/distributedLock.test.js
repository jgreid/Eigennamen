/**
 * Tests for Distributed Lock Utility
 */

const {
    DistributedLock,
    acquire,
    withLock,
    withAutoExtend,
    isLocked,
    getLockOwner,
    forceRelease,
    RELEASE_LOCK_SCRIPT,
    EXTEND_LOCK_SCRIPT
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

// Mock logger to reduce test noise
jest.mock('../utils/logger', () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
}));

describe('DistributedLock', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('constructor', () => {
        it('should create instance with default config', () => {
            const lock = new DistributedLock();
            expect(lock.config).toMatchObject({
                lockTimeout: 5000,
                retryDelay: 100,
                maxRetries: 50
            });
        });

        it('should merge custom options with defaults', () => {
            const lock = new DistributedLock({
                lockTimeout: 10000,
                maxRetries: 10
            });
            expect(lock.config.lockTimeout).toBe(10000);
            expect(lock.config.maxRetries).toBe(10);
            expect(lock.config.retryDelay).toBe(100); // default
        });
    });

    describe('acquire', () => {
        it('should acquire lock successfully on first try', async () => {
            mockRedis.set.mockResolvedValueOnce('OK');

            const lock = new DistributedLock();
            const result = await lock.acquire('test-lock');

            expect(result.acquired).toBe(true);
            expect(result.ownerId).toBeDefined();
            expect(typeof result.release).toBe('function');
            expect(typeof result.extend).toBe('function');
            expect(mockRedis.set).toHaveBeenCalledWith(
                'lock:test-lock',
                expect.stringContaining(':'),
                { NX: true, PX: 5000 }
            );
        });

        it('should retry when lock is not available', async () => {
            mockRedis.set
                .mockResolvedValueOnce(null)  // First try fails
                .mockResolvedValueOnce(null)  // Second try fails
                .mockResolvedValueOnce('OK'); // Third try succeeds

            const lock = new DistributedLock({ retryDelay: 10, maxRetries: 5 });
            const result = await lock.acquire('test-lock');

            expect(result.acquired).toBe(true);
            expect(mockRedis.set).toHaveBeenCalledTimes(3);
        });

        it('should return acquired: false after max retries', async () => {
            mockRedis.set.mockResolvedValue(null);

            const lock = new DistributedLock({ retryDelay: 5, maxRetries: 3 });
            const result = await lock.acquire('test-lock');

            expect(result.acquired).toBe(false);
            expect(mockRedis.set).toHaveBeenCalledTimes(3);
        });

        it('should use custom options when provided', async () => {
            mockRedis.set.mockResolvedValueOnce('OK');

            const lock = new DistributedLock();
            await lock.acquire('test-lock', { lockTimeout: 15000 });

            expect(mockRedis.set).toHaveBeenCalledWith(
                'lock:test-lock',
                expect.any(String),
                { NX: true, PX: 15000 }
            );
        });

        it('should handle Redis errors during acquisition', async () => {
            mockRedis.set
                .mockRejectedValueOnce(new Error('Redis error'))
                .mockResolvedValueOnce('OK');

            const lock = new DistributedLock({ retryDelay: 5, maxRetries: 5 });
            const result = await lock.acquire('test-lock');

            expect(result.acquired).toBe(true);
        });
    });

    describe('release', () => {
        it('should release lock when owned', async () => {
            mockRedis.eval.mockResolvedValueOnce(1);

            const lock = new DistributedLock();
            const released = await lock.release('lock:test', 'owner-123');

            expect(released).toBe(true);
            expect(mockRedis.eval).toHaveBeenCalledWith(
                RELEASE_LOCK_SCRIPT,
                { keys: ['lock:test'], arguments: ['owner-123'] }
            );
        });

        it('should return false when not owned', async () => {
            mockRedis.eval.mockResolvedValueOnce(0);

            const lock = new DistributedLock();
            const released = await lock.release('lock:test', 'wrong-owner');

            expect(released).toBe(false);
        });

        it('should handle Redis errors during release', async () => {
            mockRedis.eval.mockRejectedValueOnce(new Error('Redis error'));

            const lock = new DistributedLock();
            const released = await lock.release('lock:test', 'owner-123');

            expect(released).toBe(false);
        });
    });

    describe('extend', () => {
        it('should extend lock when owned', async () => {
            mockRedis.eval.mockResolvedValueOnce(1);

            const lock = new DistributedLock();
            const extended = await lock.extend('lock:test', 'owner-123', 10000);

            expect(extended).toBe(true);
            expect(mockRedis.eval).toHaveBeenCalledWith(
                EXTEND_LOCK_SCRIPT,
                { keys: ['lock:test'], arguments: ['owner-123', '10000'] }
            );
        });

        it('should return false when not owned', async () => {
            mockRedis.eval.mockResolvedValueOnce(0);

            const lock = new DistributedLock();
            const extended = await lock.extend('lock:test', 'wrong-owner', 10000);

            expect(extended).toBe(false);
        });

        it('should handle Redis errors during extend', async () => {
            mockRedis.eval.mockRejectedValueOnce(new Error('Redis error'));

            const lock = new DistributedLock();
            const extended = await lock.extend('lock:test', 'owner-123', 10000);

            expect(extended).toBe(false);
        });
    });

    describe('withLock', () => {
        it('should execute function while holding lock', async () => {
            mockRedis.set.mockResolvedValueOnce('OK');
            mockRedis.eval.mockResolvedValueOnce(1); // release

            const lock = new DistributedLock();
            const fn = jest.fn().mockResolvedValue('result');

            const result = await lock.withLock('test-lock', fn);

            expect(result).toBe('result');
            expect(fn).toHaveBeenCalled();
            expect(mockRedis.eval).toHaveBeenCalled(); // release was called
        });

        it('should release lock even if function throws', async () => {
            mockRedis.set.mockResolvedValueOnce('OK');
            mockRedis.eval.mockResolvedValueOnce(1); // release

            const lock = new DistributedLock();
            const fn = jest.fn().mockRejectedValue(new Error('test error'));

            await expect(lock.withLock('test-lock', fn)).rejects.toThrow('test error');
            expect(mockRedis.eval).toHaveBeenCalled(); // release was called
        });

        it('should throw if lock acquisition fails', async () => {
            mockRedis.set.mockResolvedValue(null);

            const lock = new DistributedLock({ maxRetries: 1, retryDelay: 5 });
            const fn = jest.fn();

            await expect(lock.withLock('test-lock', fn)).rejects.toThrow('Failed to acquire lock');
            expect(fn).not.toHaveBeenCalled();
        });
    });

    describe('withAutoExtend', () => {
        beforeEach(() => {
            jest.useFakeTimers();
        });

        afterEach(() => {
            jest.useRealTimers();
        });

        it('should auto-extend lock during long operations', async () => {
            mockRedis.set.mockResolvedValueOnce('OK');
            mockRedis.eval.mockResolvedValue(1); // extend and release

            const lock = new DistributedLock({ lockTimeout: 1000, extendThreshold: 0.5 });

            // Create a function that takes a while but resolves immediately for test
            const fn = jest.fn().mockImplementation(async () => {
                // Advance time to trigger extension
                jest.advanceTimersByTime(600);
                return 'result';
            });

            const promise = lock.withAutoExtend('test-lock', fn);

            // Fast-forward past extension threshold
            jest.runAllTimers();

            const result = await promise;
            expect(result).toBe('result');
        });

        it('should throw if lock acquisition fails', async () => {
            jest.useRealTimers(); // Use real timers for this test
            mockRedis.set.mockResolvedValue(null);

            const lock = new DistributedLock({ maxRetries: 1, retryDelay: 1 });
            const fn = jest.fn();

            await expect(lock.withAutoExtend('test-lock', fn)).rejects.toThrow('Failed to acquire lock');
            expect(fn).not.toHaveBeenCalled();
        });
    });

    describe('isLocked', () => {
        it('should return true when key exists', async () => {
            mockRedis.exists.mockResolvedValueOnce(1);

            const lock = new DistributedLock();
            const result = await lock.isLocked('test-lock');

            expect(result).toBe(true);
            expect(mockRedis.exists).toHaveBeenCalledWith('lock:test-lock');
        });

        it('should return false when key does not exist', async () => {
            mockRedis.exists.mockResolvedValueOnce(0);

            const lock = new DistributedLock();
            const result = await lock.isLocked('test-lock');

            expect(result).toBe(false);
        });
    });

    describe('getLockOwner', () => {
        it('should return owner when lock exists', async () => {
            mockRedis.get.mockResolvedValueOnce('owner-123');

            const lock = new DistributedLock();
            const owner = await lock.getLockOwner('test-lock');

            expect(owner).toBe('owner-123');
            expect(mockRedis.get).toHaveBeenCalledWith('lock:test-lock');
        });

        it('should return null when lock does not exist', async () => {
            mockRedis.get.mockResolvedValueOnce(null);

            const lock = new DistributedLock();
            const owner = await lock.getLockOwner('test-lock');

            expect(owner).toBeNull();
        });
    });

    describe('forceRelease', () => {
        it('should force release a lock', async () => {
            mockRedis.del.mockResolvedValueOnce(1);

            const lock = new DistributedLock();
            const released = await lock.forceRelease('test-lock');

            expect(released).toBe(true);
            expect(mockRedis.del).toHaveBeenCalledWith('lock:test-lock');
        });

        it('should return false if lock did not exist', async () => {
            mockRedis.del.mockResolvedValueOnce(0);

            const lock = new DistributedLock();
            const released = await lock.forceRelease('test-lock');

            expect(released).toBe(false);
        });

        it('should handle Redis errors', async () => {
            mockRedis.del.mockRejectedValueOnce(new Error('Redis error'));

            const lock = new DistributedLock();
            const released = await lock.forceRelease('test-lock');

            expect(released).toBe(false);
        });
    });

    describe('convenience functions', () => {
        it('acquire should use default lock instance', async () => {
            mockRedis.set.mockResolvedValueOnce('OK');

            const result = await acquire('test-lock');
            expect(result.acquired).toBe(true);
        });

        it('isLocked should use default lock instance', async () => {
            mockRedis.exists.mockResolvedValueOnce(1);

            const result = await isLocked('test-lock');
            expect(result).toBe(true);
        });

        it('getLockOwner should use default lock instance', async () => {
            mockRedis.get.mockResolvedValueOnce('owner-123');

            const result = await getLockOwner('test-lock');
            expect(result).toBe('owner-123');
        });

        it('forceRelease should use default lock instance', async () => {
            mockRedis.del.mockResolvedValueOnce(1);

            const result = await forceRelease('test-lock');
            expect(result).toBe(true);
        });

        it('withLock should use default lock instance', async () => {
            mockRedis.set.mockResolvedValueOnce('OK');
            mockRedis.eval.mockResolvedValueOnce(1);

            const result = await withLock('test-lock', () => 'result');
            expect(result).toBe('result');
        });

        it('withAutoExtend should use default lock instance', async () => {
            mockRedis.set.mockResolvedValueOnce('OK');
            mockRedis.eval.mockResolvedValue(1);

            const result = await withAutoExtend('test-lock', () => 'result');
            expect(result).toBe('result');
        });
    });

    describe('Lua scripts', () => {
        it('should export RELEASE_LOCK_SCRIPT', () => {
            expect(RELEASE_LOCK_SCRIPT).toBeDefined();
            expect(RELEASE_LOCK_SCRIPT).toContain('redis.call("get"');
            expect(RELEASE_LOCK_SCRIPT).toContain('redis.call("del"');
        });

        it('should export EXTEND_LOCK_SCRIPT', () => {
            expect(EXTEND_LOCK_SCRIPT).toBeDefined();
            expect(EXTEND_LOCK_SCRIPT).toContain('redis.call("get"');
            expect(EXTEND_LOCK_SCRIPT).toContain('redis.call("pexpire"');
        });
    });
});
