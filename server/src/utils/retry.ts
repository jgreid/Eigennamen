/**
 * Retry Utility
 *
 * Provides retry functionality with exponential backoff for resilient operations.
 * Centralized retry logic to ensure consistency across the codebase.
 */

const { RETRY_CONFIG } = require('../config/constants');

/**
 * Sleep for a specified duration
 * @param ms - Milliseconds to sleep
 */
function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry options interface
 */
interface RetryOptions {
    maxRetries?: number;
    baseDelayMs?: number;
    shouldRetry?: (error: Error) => boolean;
    onRetry?: (error: Error, attempt: number) => void;
    jitter?: boolean;
}

/**
 * Retry function type
 */
type RetryFunction<T> = (attempt: number) => Promise<T>;

/**
 * Execute a function with retry logic and exponential backoff
 *
 * @param fn - Async function to execute (receives attempt number as argument)
 * @param options - Retry options
 * @returns Result of the function
 * @throws Last error if all retries fail
 *
 * @example
 * // Basic usage
 * const result = await withRetry(
 *   async (attempt) => {
 *     console.log(`Attempt ${attempt}`);
 *     return await someAsyncOperation();
 *   },
 *   { maxRetries: 3, baseDelayMs: 100 }
 * );
 *
 * @example
 * // With custom retry logic
 * const result = await withRetry(
 *   async () => await redis.get('key'),
 *   {
 *     maxRetries: 3,
 *     shouldRetry: (error) => error.code === 'ECONNRESET',
 *     onRetry: (error, attempt) => logger.warn('Retrying', { attempt, error: error.message })
 *   }
 * );
 */
async function withRetry<T>(fn: RetryFunction<T>, options: RetryOptions = {}): Promise<T> {
    const {
        maxRetries = 3,
        baseDelayMs = 100,
        shouldRetry = () => true,
        onRetry = null,
        jitter = true
    } = options;

    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await fn(attempt);
        } catch (error) {
            lastError = error as Error;

            // Check if we should retry
            if (attempt === maxRetries || !shouldRetry(lastError)) {
                throw error;
            }

            // Calculate delay with exponential backoff
            let delay = baseDelayMs * Math.pow(2, attempt - 1);

            // Add jitter (0-50ms) to prevent thundering herd
            if (jitter) {
                delay += Math.random() * 50;
            }

            // Call retry callback if provided
            if (onRetry) {
                onRetry(lastError, attempt);
            }

            await sleep(delay);
        }
    }

    throw lastError;
}

/**
 * Create a retry wrapper with preset configuration
 * Useful for creating domain-specific retry functions
 *
 * @param defaultOptions - Default options for all retries
 * @returns Configured withRetry function
 *
 * @example
 * const redisRetry = createRetryWrapper({
 *   maxRetries: RETRY_CONFIG.REDIS_OPERATION.maxRetries,
 *   baseDelayMs: RETRY_CONFIG.REDIS_OPERATION.baseDelayMs,
 *   shouldRetry: isRedisRetryableError
 * });
 *
 * const result = await redisRetry(async () => await redis.get('key'));
 */
function createRetryWrapper(defaultOptions: RetryOptions = {}): <T>(fn: RetryFunction<T>, overrideOptions?: RetryOptions) => Promise<T> {
    return function<T>(fn: RetryFunction<T>, overrideOptions: RetryOptions = {}): Promise<T> {
        return withRetry(fn, { ...defaultOptions, ...overrideOptions });
    };
}

/**
 * Error with optional code property
 */
interface ErrorWithCode extends Error {
    code?: string;
}

/**
 * Check if an error is likely retryable (network/transient errors)
 * @param error - The error to check
 * @returns True if the error is retryable
 */
function isRetryableError(error: Error): boolean {
    // Common retryable error codes
    const retryableCodes = [
        'ECONNRESET',
        'ECONNREFUSED',
        'ETIMEDOUT',
        'ENOTFOUND',
        'ENETUNREACH',
        'EAI_AGAIN',
        'EPIPE'
    ];

    const errorWithCode = error as ErrorWithCode;
    if (errorWithCode.code && retryableCodes.includes(errorWithCode.code)) {
        return true;
    }

    // Check for Redis-specific transient errors
    if (error.message && (
        error.message.includes('Connection is closed') ||
        error.message.includes('Socket closed unexpectedly') ||
        error.message.includes('READONLY')
    )) {
        return true;
    }

    return false;
}

/**
 * Check if an error indicates a concurrent modification (for optimistic locking)
 * @param error - The error to check
 * @returns True if the error is a concurrent modification
 */
function isConcurrentModificationError(error: Error): boolean {
    const errorWithCode = error as ErrorWithCode;
    if (errorWithCode.code === 'CONCURRENT_MODIFICATION') {
        return true;
    }
    if (error.message && (
        error.message.includes('concurrent modification') ||
        error.message.includes('version mismatch')
    )) {
        return true;
    }
    return false;
}

/**
 * Pre-configured retry for optimistic lock operations
 */
const withOptimisticLockRetry = createRetryWrapper({
    maxRetries: RETRY_CONFIG.OPTIMISTIC_LOCK.maxRetries,
    baseDelayMs: RETRY_CONFIG.OPTIMISTIC_LOCK.baseDelayMs,
    shouldRetry: isConcurrentModificationError,
    jitter: true
});

/**
 * Pre-configured retry for Redis operations
 */
const withRedisRetry = createRetryWrapper({
    maxRetries: RETRY_CONFIG.REDIS_OPERATION.maxRetries,
    baseDelayMs: RETRY_CONFIG.REDIS_OPERATION.baseDelayMs,
    shouldRetry: isRetryableError,
    jitter: true
});

/**
 * Pre-configured retry for network/external service operations
 */
const withNetworkRetry = createRetryWrapper({
    maxRetries: RETRY_CONFIG.NETWORK_REQUEST.maxRetries,
    baseDelayMs: RETRY_CONFIG.NETWORK_REQUEST.baseDelayMs,
    shouldRetry: isRetryableError,
    jitter: true
});

module.exports = {
    withRetry,
    createRetryWrapper,
    isRetryableError,
    isConcurrentModificationError,
    withOptimisticLockRetry,
    withRedisRetry,
    withNetworkRetry,
    sleep
};

// ES6 exports for TypeScript imports
export {
    withRetry,
    createRetryWrapper,
    isRetryableError,
    isConcurrentModificationError,
    withOptimisticLockRetry,
    withRedisRetry,
    withNetworkRetry,
    sleep
};

export type { RetryOptions, RetryFunction, ErrorWithCode };
