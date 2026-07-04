import { getRedis } from '../config/redis';
import logger from './logger';
import { randomUUID } from 'crypto';
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
        // NOTE: a lock TTL shorter than the total retry-wait window is NOT a
        // misconfiguration — a waiter that retries after the current holder's TTL
        // expires simply acquires the freed lock. (A previous warning here both
        // mis-computed the window with an UNCAPPED exponential — ignoring
        // maxRetryDelay — and fired on virtually every default acquisition, so it
        // was pure log noise.) The meaningful signal is the "failed to acquire
        // after max retries" warning below.
        const redis = getRedis();
        const key = `lock:${lockKey}`;
        const ownerId = `${this.instanceId}:${randomUUID()}`;

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

    /**
     * Run `fn` while holding the named lock. `fn` is itself raced against an
     * internal timeout (`lockTimeout - 500ms`) so the lock is never held past its
     * own TTL — but `withTimeout` cannot cancel `fn()` if it loses that race, only
     * stop waiting for it. If `fn` is still genuinely running when this timeout
     * fires, the lock is released and the caller sees a rejection while `fn`'s
     * Redis calls may still complete and commit afterward — a real state
     * divergence between what the caller was told and what happened.
     *
     * CALLERS MUST size `lockTimeout` to comfortably exceed the slowest realistic
     * total duration of `fn` (sum of every `withTimeout`/Redis call budget inside
     * it, not just one), or this race becomes routine instead of a rare edge case.
     * See docs/HARDENING_PLAN.md P0-3 for the timerService.startTimer instance
     * this was found from.
     */
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

        const lockTimeout = { ...this.config, ...options }.lockTimeout;
        const operationTimeout = Math.max(lockTimeout - 500, MIN_LOCK_TIMEOUT);
        try {
            return await withTimeout(fn(), operationTimeout, `withLock:${lockKey}`);
        } catch (error) {
            if ((error as { code?: string }).code === 'OPERATION_TIMEOUT') {
                // The lock is about to be released (below) while fn() may still be
                // running — anything it does after this point (a Redis write, a
                // mutation-notify) can still land even though the caller is about
                // to see this as a failure. Loud because this is the exact
                // divergence class in docs/HARDENING_PLAN.md P0-3.
                logger.warn(
                    `withLock:${lockKey} timed out after ${operationTimeout}ms with the wrapped operation ` +
                        `possibly still running — releasing the lock now. If this recurs, lockTimeout ` +
                        `(${lockTimeout}ms) is too small for what this callback actually does.`,
                    { lockKey, lockTimeout, operationTimeout }
                );
            }
            throw error;
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
