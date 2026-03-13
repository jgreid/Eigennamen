import { getRedis } from '../config/redis';
import logger from './logger';
import { v4 as uuidv4 } from 'uuid';
import { withTimeout } from './timeout';
import { ServerError } from '../errors/GameError';
import { RELEASE_LOCK_SCRIPT as _RELEASE_LOCK_SCRIPT, EXTEND_LOCK_SCRIPT as _EXTEND_LOCK_SCRIPT } from '../scripts';
import { instanceId as envInstanceId } from '../config/env';

export const RELEASE_LOCK_SCRIPT = _RELEASE_LOCK_SCRIPT;
export const EXTEND_LOCK_SCRIPT = _EXTEND_LOCK_SCRIPT;

const LOCK_OPERATION_TIMEOUT = 5000;
const MIN_LOCK_TIMEOUT = 1000;

interface LockConfig {
    lockTimeout: number;
    retryDelay: number;
    maxRetryDelay: number;
    maxRetries: number;
    extendThreshold: number;
}

const DEFAULT_CONFIG: LockConfig = {
    lockTimeout: 5000, // Lock expires after 5 seconds
    retryDelay: 50, // Initial retry delay in ms (grows exponentially)
    maxRetryDelay: 500, // Cap on retry delay to prevent excessive waits
    maxRetries: 20, // Max retry attempts
    extendThreshold: 0.5, // Extend when 50% of time remains
};

interface LockResult {
    acquired: boolean;
    ownerId?: string;
    release?: () => Promise<boolean>;
    extend?: (additionalMs?: number) => Promise<boolean>;
}

interface LockOptions extends Partial<LockConfig> {}

class DistributedLock {
    private config: LockConfig;
    private instanceId: string;

    constructor(options: LockOptions = {}) {
        this.config = { ...DEFAULT_CONFIG, ...options };
        this.instanceId = envInstanceId;
    }

    async acquire(lockKey: string, options: LockOptions = {}): Promise<LockResult> {
        const config = { ...this.config, ...options };
        // Enforce minimum lock timeout to prevent locks expiring before operations complete
        if (config.lockTimeout < MIN_LOCK_TIMEOUT) {
            config.lockTimeout = MIN_LOCK_TIMEOUT;
        }
        // Warn if lock timeout is shorter than the maximum total retry wait time.
        // This means the lock could expire before all retries complete, which is
        // usually a misconfiguration.
        const maxRetryWait = config.retryDelay * (Math.pow(2, config.maxRetries) - 1);
        if (config.lockTimeout < maxRetryWait && config.maxRetries > 3) {
            logger.warn('Lock timeout shorter than max retry duration', {
                lockKey,
                lockTimeout: config.lockTimeout,
                maxRetryWait,
            });
        }
        const redis = getRedis();
        const key = `lock:${lockKey}`;
        const ownerId = `${this.instanceId}:${uuidv4()}`;

        for (let attempt = 0; attempt < config.maxRetries; attempt++) {
            try {
                const result = await redis.set(key, ownerId, {
                    NX: true,
                    PX: config.lockTimeout,
                });

                if (result === 'OK') {
                    logger.info('Lock acquired', {
                        lockKey,
                        ownerId,
                        attempt,
                    });

                    return {
                        acquired: true,
                        ownerId,
                        release: () => this.release(key, ownerId),
                        extend: (additionalMs?: number) =>
                            this.extend(key, ownerId, additionalMs || config.lockTimeout),
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
                    error: (error as Error).message,
                });
                // Continue retrying
            }
        }

        logger.warn('Failed to acquire lock after max retries', {
            lockKey,
            maxRetries: config.maxRetries,
        });

        return { acquired: false };
    }

    async release(key: string, ownerId: string): Promise<boolean> {
        const redis = getRedis();

        try {
            const result = await withTimeout(
                redis.eval(RELEASE_LOCK_SCRIPT, {
                    keys: [key],
                    arguments: [ownerId],
                }),
                LOCK_OPERATION_TIMEOUT,
                `lock-release-${key}`
            );

            if (result === 1) {
                logger.info('Lock released', { key, ownerId });
                return true;
            } else {
                logger.warn('Lock release failed (not owned)', { key, ownerId });
                return false;
            }
        } catch (error) {
            logger.error('Lock release error', {
                key,
                ownerId,
                error: (error as Error).message,
            });
            return false;
        }
    }

    async extend(key: string, ownerId: string, additionalMs: number): Promise<boolean> {
        const redis = getRedis();

        try {
            const result = await withTimeout(
                redis.eval(EXTEND_LOCK_SCRIPT, {
                    keys: [key],
                    arguments: [ownerId, additionalMs.toString()],
                }),
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
                error: (error as Error).message,
            });
            return false;
        }
    }

    async withLock<T>(lockKey: string, fn: () => Promise<T>, options: LockOptions = {}): Promise<T> {
        const lockResult = await this.acquire(lockKey, options);

        if (!lockResult.acquired || !lockResult.release) {
            throw new ServerError(`Failed to acquire lock: ${lockKey}`, {
                operation: `lock:${lockKey}`,
                retryable: true,
            });
        }

        // Capture release function after the guard above ensures it exists
        const releaseFn = lockResult.release;

        try {
            return await fn();
        } finally {
            await releaseFn();
        }
    }

    async withAutoExtend<T>(lockKey: string, fn: () => Promise<T>, options: LockOptions = {}): Promise<T> {
        const config = { ...this.config, ...options };
        const lockResult = await this.acquire(lockKey, options);

        if (!lockResult.acquired || !lockResult.extend || !lockResult.release) {
            throw new ServerError(`Failed to acquire lock: ${lockKey}`, {
                operation: `lock:${lockKey}`,
                retryable: true,
            });
        }

        // Capture functions after the guard above ensures they exist
        const extendFn = lockResult.extend;
        const releaseFn = lockResult.release;

        // Set up auto-extension with tracking to avoid race conditions
        const extendInterval = config.lockTimeout * config.extendThreshold;
        let pendingExtension: Promise<boolean> | null = null;
        const extensionTimer = setInterval(() => {
            pendingExtension = extendFn(config.lockTimeout)
                .then((extended) => {
                    if (!extended) {
                        logger.warn('Auto-extension failed, lock may have been lost', { lockKey });
                    }
                    return extended;
                })
                .catch((err) => {
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

    private _sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}

const defaultLock = new DistributedLock();

const acquire = (lockKey: string, options?: LockOptions): Promise<LockResult> => defaultLock.acquire(lockKey, options);

const withLock = <T>(lockKey: string, fn: () => Promise<T>, options?: LockOptions): Promise<T> =>
    defaultLock.withLock(lockKey, fn, options);

const withAutoExtend = <T>(lockKey: string, fn: () => Promise<T>, options?: LockOptions): Promise<T> =>
    defaultLock.withAutoExtend(lockKey, fn, options);

export { DistributedLock, acquire, withLock, withAutoExtend };

export type { LockConfig, LockResult, LockOptions };
