/**
 * Distributed Lock Utility
 *
 * Provides robust distributed locking with proper ownership tracking,
 * automatic extension, and deadlock prevention.
 */

const { getRedis } = require('../config/redis');
const logger = require('./logger');
const { v4: uuidv4 } = require('uuid');

// Default configuration
const DEFAULT_CONFIG = {
    lockTimeout: 5000,      // Lock expires after 5 seconds
    retryDelay: 100,        // Wait 100ms between retries
    maxRetries: 50,         // Max retry attempts (5 seconds total)
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
 * Distributed Lock class
 * Provides acquire, release, and extend operations with ownership tracking
 */
class DistributedLock {
    constructor(options = {}) {
        this.config = { ...DEFAULT_CONFIG, ...options };
        this.instanceId = process.env.FLY_ALLOC_ID || process.env.INSTANCE_ID || 'local';
    }

    /**
     * Acquire a lock
     * @param {string} lockKey - Unique key for the lock
     * @param {Object} options - Override options for this acquisition
     * @returns {Object} { acquired: boolean, release: Function, extend: Function, ownerId: string }
     */
    async acquire(lockKey, options = {}) {
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
                        extend: (additionalMs) => this.extend(key, ownerId, additionalMs || config.lockTimeout)
                    };
                }

                // Lock not acquired, wait and retry
                await this._sleep(config.retryDelay + Math.random() * 50);
            } catch (error) {
                logger.error('Lock acquisition error', {
                    lockKey,
                    attempt,
                    error: error.message
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
     * @param {string} key - Full lock key
     * @param {string} ownerId - Owner ID to verify
     * @returns {boolean} True if released, false if not owned
     */
    async release(key, ownerId) {
        const redis = getRedis();

        try {
            const result = await redis.eval(
                RELEASE_LOCK_SCRIPT,
                {
                    keys: [key],
                    arguments: [ownerId]
                }
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
                error: error.message
            });
            return false;
        }
    }

    /**
     * Extend a lock (only if we own it)
     * @param {string} key - Full lock key
     * @param {string} ownerId - Owner ID to verify
     * @param {number} additionalMs - Additional time in milliseconds
     * @returns {boolean} True if extended, false if not owned
     */
    async extend(key, ownerId, additionalMs) {
        const redis = getRedis();

        try {
            const result = await redis.eval(
                EXTEND_LOCK_SCRIPT,
                {
                    keys: [key],
                    arguments: [ownerId, additionalMs.toString()]
                }
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
                error: error.message
            });
            return false;
        }
    }

    /**
     * Execute a function while holding a lock
     * Automatically releases the lock when done
     * @param {string} lockKey - Lock key
     * @param {Function} fn - Async function to execute
     * @param {Object} options - Lock options
     * @returns {*} Result of the function
     */
    async withLock(lockKey, fn, options = {}) {
        const lockResult = await this.acquire(lockKey, options);

        if (!lockResult.acquired) {
            throw new Error(`Failed to acquire lock: ${lockKey}`);
        }

        try {
            return await fn();
        } finally {
            await lockResult.release();
        }
    }

    /**
     * Execute a function with automatic lock extension
     * For long-running operations that may exceed lock timeout
     * @param {string} lockKey - Lock key
     * @param {Function} fn - Async function to execute
     * @param {Object} options - Lock options
     * @returns {*} Result of the function
     */
    async withAutoExtend(lockKey, fn, options = {}) {
        const config = { ...this.config, ...options };
        const lockResult = await this.acquire(lockKey, options);

        if (!lockResult.acquired) {
            throw new Error(`Failed to acquire lock: ${lockKey}`);
        }

        // Set up auto-extension with tracking to avoid race conditions
        const extendInterval = config.lockTimeout * config.extendThreshold;
        let pendingExtension = null;
        const extensionTimer = setInterval(() => {
            pendingExtension = lockResult.extend(config.lockTimeout).then(extended => {
                if (!extended) {
                    logger.warn('Auto-extension failed, lock may have been lost', { lockKey });
                }
            }).catch(err => {
                logger.error('Auto-extension error', { lockKey, error: err.message });
            });
        }, extendInterval);

        try {
            return await fn();
        } finally {
            clearInterval(extensionTimer);
            // Wait for any in-flight extension to complete before releasing
            if (pendingExtension) {
                await pendingExtension.catch(() => {});
            }
            await lockResult.release();
        }
    }

    /**
     * Check if a lock is currently held
     * @param {string} lockKey - Lock key
     * @returns {boolean} True if locked
     */
    async isLocked(lockKey) {
        const redis = getRedis();
        const key = `lock:${lockKey}`;
        const result = await redis.exists(key);
        return result === 1;
    }

    /**
     * Get the owner of a lock
     * @param {string} lockKey - Lock key
     * @returns {string|null} Owner ID or null if not locked
     */
    async getLockOwner(lockKey) {
        const redis = getRedis();
        const key = `lock:${lockKey}`;
        return redis.get(key);
    }

    /**
     * Force release a lock (use with caution - for admin/recovery only)
     * @param {string} lockKey - Lock key
     * @returns {boolean} True if released
     */
    async forceRelease(lockKey) {
        const redis = getRedis();
        const key = `lock:${lockKey}`;

        try {
            const result = await redis.del(key);
            logger.warn('Lock force released', { lockKey });
            return result === 1;
        } catch (error) {
            logger.error('Force release error', {
                lockKey,
                error: error.message
            });
            return false;
        }
    }

    _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Singleton instance with default configuration
const defaultLock = new DistributedLock();

// Convenience functions using default instance
const acquire = (lockKey, options) => defaultLock.acquire(lockKey, options);
const withLock = (lockKey, fn, options) => defaultLock.withLock(lockKey, fn, options);
const withAutoExtend = (lockKey, fn, options) => defaultLock.withAutoExtend(lockKey, fn, options);
const isLocked = (lockKey) => defaultLock.isLocked(lockKey);
const getLockOwner = (lockKey) => defaultLock.getLockOwner(lockKey);
const forceRelease = (lockKey) => defaultLock.forceRelease(lockKey);

module.exports = {
    DistributedLock,
    acquire,
    withLock,
    withAutoExtend,
    isLocked,
    getLockOwner,
    forceRelease,
    // For testing
    RELEASE_LOCK_SCRIPT,
    EXTEND_LOCK_SCRIPT
};
