/**
 * Distributed Lock Utility
 *
 * Provides robust distributed locking with proper ownership tracking,
 * automatic extension, and deadlock prevention.
 */

import { getRedis } from '../config/redis';
import logger from './logger';
import { v4 as uuidv4 } from 'uuid';
import { withTimeout } from './timeout';

// Timeout for individual lock Redis operations (release, extend)
const LOCK_OPERATION_TIMEOUT = 5000;

/**
 * Lock configuration interface
 */
interface LockConfig {
    lockTimeout: number;
    retryDelay: number;
    maxRetryDelay: number;
    maxRetries: number;
    extendThreshold: number;
}

// Default configuration
const DEFAULT_CONFIG: LockConfig = {
    lockTimeout: 5000,      // Lock expires after 5 seconds
    retryDelay: 50,         // Initial retry delay in ms (grows exponentially)
    maxRetryDelay: 500,     // Cap on retry delay to prevent excessive waits
    maxRetries: 20,         // Max retry attempts
    extendThreshold: 0.5    // Extend when 50% of time remains
};

// Lua script for safe lock release (only release if we own the lock)
const RELEASE_LOCK_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
else
    return 0
end
`;

// Lua script for lock extension (only extend if we own the lock)
const EXTEND_LOCK_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("pexpire", KEYS[1], ARGV[2])
else
    return 0
end
`;

/**
 * Lock acquisition result interface
 */
interface LockResult {
    acquired: boolean;
    ownerId?: string;
    release?: () => Promise<boolean>;
    extend?: (additionalMs?: number) => Promise<boolean>;
}

/**
 * Lock options interface
 */
interface LockOptions extends Partial<LockConfig> {}

/**
 * Distributed Lock class
 * Provides acquire, release, and extend operations with ownership tracking
 */
class DistributedLock {
    private config: LockConfig;
    private instanceId: string;

    constructor(options: LockOptions = {}) {
        this.config = { ...DEFAULT_CONFIG, ...options };
        this.instanceId = process.env.FLY_ALLOC_ID || process.env.INSTANCE_ID || 'local';
    }

    /**
     * Acquire a lock
     * @param lockKey - Unique key for the lock
     * @param options - Override options for this acquisition
     * @returns Lock result with acquired status and control functions
     */
    async acquire(lockKey: string, options: LockOptions = {}): Promise<LockResult> {
        const config = { ...this.config, ...options };
        const redis = getRedis();
        const key = `lock:${lockKey}`;
        const ownerId = `${this.instanceId}:${uuidv4()}`;

        for (let attempt = 0; attempt < config.maxRetries; attempt++) {
            try {
                const result = await redis.set(key, ownerId, {
                    NX: true,
                    PX: config.lockTimeout
                });

                if (result === 'OK') {
                    logger.debug('Lock acquired', {
                        lockKey,
                        ownerId,
                        attempt
                    });

                    return {
                        acquired: true,
                        ownerId,
                        release: () => this.release(key, ownerId),
                        extend: (additionalMs?: number) => this.extend(key, ownerId, additionalMs || config.lockTimeout)
                    };
                }

                // Lock not acquired, wait with exponential backoff + jitter
                const delay = Math.min(
                    config.retryDelay * Math.pow(2, attempt) + Math.random() * 50,
                    config.maxRetryDelay
                );
                await this._sleep(delay);
            } catch (error) {
                logger.error('Lock acquisition error', {
                    lockKey,
                    attempt,
                    error: (error as Error).message
                });
                // Continue retrying
            }
        }

        logger.warn('Failed to acquire lock after max retries', {
            lockKey,
            maxRetries: config.maxRetries
        });

        return { acquired: false };
    }

    /**
     * Release a lock (only if we own it)
     * @param key - Full lock key
     * @param ownerId - Owner ID to verify
     * @returns True if released, false if not owned
     */
    async release(key: string, ownerId: string): Promise<boolean> {
        const redis = getRedis();

        try {
            const result = await withTimeout(
                redis.eval(
                    RELEASE_LOCK_SCRIPT,
                    {
                        keys: [key],
                        arguments: [ownerId]
                    }
                ),
                LOCK_OPERATION_TIMEOUT,
                `lock-release-${key}`
            );

            if (result === 1) {
                logger.debug('Lock released', { key, ownerId });
                return true;
            } else {
                logger.warn('Lock release failed (not owned)', { key, ownerId });
                return false;
            }
        } catch (error) {
            logger.error('Lock release error', {
                key,
                ownerId,
                error: (error as Error).message
            });
            return false;
        }
    }

    /**
     * Extend a lock (only if we own it)
     * @param key - Full lock key
     * @param ownerId - Owner ID to verify
     * @param additionalMs - Additional time in milliseconds
     * @returns True if extended, false if not owned
     */
    async extend(key: string, ownerId: string, additionalMs: number): Promise<boolean> {
        const redis = getRedis();

        try {
            const result = await withTimeout(
                redis.eval(
                    EXTEND_LOCK_SCRIPT,
                    {
                        keys: [key],
                        arguments: [ownerId, additionalMs.toString()]
                    }
                ),
                LOCK_OPERATION_TIMEOUT,
                `lock-extend-${key}`
            );

            if (result === 1) {
                logger.debug('Lock extended', { key, ownerId, additionalMs });
                return true;
            } else {
                logger.warn('Lock extension failed (not owned)', { key, ownerId });
                return false;
            }
        } catch (error) {
            logger.error('Lock extension error', {
                key,
                ownerId,
                error: (error as Error).message
            });
            return false;
        }
    }

    /**
     * Execute a function while holding a lock
     * Automatically releases the lock when done
     * @param lockKey - Lock key
     * @param fn - Async function to execute
     * @param options - Lock options
     * @returns Result of the function
     */
    async withLock<T>(lockKey: string, fn: () => Promise<T>, options: LockOptions = {}): Promise<T> {
        const lockResult = await this.acquire(lockKey, options);

        if (!lockResult.acquired || !lockResult.release) {
            throw new Error(`Failed to acquire lock: ${lockKey}`);
        }

        // Capture release function after the guard above ensures it exists
        const releaseFn = lockResult.release;

        try {
            return await fn();
        } finally {
            await releaseFn();
        }
    }

    /**
     * Execute a function with automatic lock extension
     * For long-running operations that may exceed lock timeout
     * @param lockKey - Lock key
     * @param fn - Async function to execute
     * @param options - Lock options
     * @returns Result of the function
     */
    async withAutoExtend<T>(lockKey: string, fn: () => Promise<T>, options: LockOptions = {}): Promise<T> {
        const config = { ...this.config, ...options };
        const lockResult = await this.acquire(lockKey, options);

        if (!lockResult.acquired || !lockResult.extend || !lockResult.release) {
            throw new Error(`Failed to acquire lock: ${lockKey}`);
        }

        // Capture functions after the guard above ensures they exist
        const extendFn = lockResult.extend;
        const releaseFn = lockResult.release;

        // Set up auto-extension with tracking to avoid race conditions
        const extendInterval = config.lockTimeout * config.extendThreshold;
        let pendingExtension: Promise<boolean> | null = null;
        const extensionTimer = setInterval(() => {
            pendingExtension = extendFn(config.lockTimeout).then(extended => {
                if (!extended) {
                    logger.warn('Auto-extension failed, lock may have been lost', { lockKey });
                }
                return extended;
            }).catch(err => {
                logger.error('Auto-extension error', { lockKey, error: (err as Error).message });
                return false;
            });
        }, extendInterval);

        try {
            return await fn();
        } finally {
            clearInterval(extensionTimer);
            // Wait for any in-flight extension to complete before releasing
            const pending = pendingExtension;
            if (pending) {
                await (pending as Promise<boolean>).catch(() => {});
            }
            await releaseFn();
        }
    }

    /**
     * Check if a lock is currently held
     * @param lockKey - Lock key
     * @returns True if locked
     */
    async isLocked(lockKey: string): Promise<boolean> {
        const redis = getRedis();
        const key = `lock:${lockKey}`;
        const result = await redis.exists(key);
        return result === 1;
    }

    /**
     * Get the owner of a lock
     * @param lockKey - Lock key
     * @returns Owner ID or null if not locked
     */
    getLockOwner(lockKey: string): Promise<string | null> {
        const redis = getRedis();
        const key = `lock:${lockKey}`;
        return redis.get(key);
    }

    /**
     * Force release a lock (use with caution - for admin/recovery only)
     * @param lockKey - Lock key
     * @returns True if released
     */
    async forceRelease(lockKey: string): Promise<boolean> {
        const redis = getRedis();
        const key = `lock:${lockKey}`;

        try {
            const result = await redis.del(key);
            logger.warn('Lock force released', { lockKey });
            return result === 1;
        } catch (error) {
            logger.error('Force release error', {
                lockKey,
                error: (error as Error).message
            });
            return false;
        }
    }

    private _sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Singleton instance with default configuration
const defaultLock = new DistributedLock();

// Convenience functions using default instance
const acquire = (lockKey: string, options?: LockOptions): Promise<LockResult> =>
    defaultLock.acquire(lockKey, options);

const withLock = <T>(lockKey: string, fn: () => Promise<T>, options?: LockOptions): Promise<T> =>
    defaultLock.withLock(lockKey, fn, options);

const withAutoExtend = <T>(lockKey: string, fn: () => Promise<T>, options?: LockOptions): Promise<T> =>
    defaultLock.withAutoExtend(lockKey, fn, options);

const isLocked = (lockKey: string): Promise<boolean> =>
    defaultLock.isLocked(lockKey);

const getLockOwner = (lockKey: string): Promise<string | null> =>
    defaultLock.getLockOwner(lockKey);

const forceRelease = (lockKey: string): Promise<boolean> =>
    defaultLock.forceRelease(lockKey);

export {
    DistributedLock,
    acquire,
    withLock,
    withAutoExtend,
    isLocked,
    getLockOwner,
    forceRelease,
    RELEASE_LOCK_SCRIPT,
    EXTEND_LOCK_SCRIPT
};

export type { LockConfig, LockResult, LockOptions };
