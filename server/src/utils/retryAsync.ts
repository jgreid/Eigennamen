import logger from './logger';

export interface RetryOptions {
    /** Maximum number of retry attempts (default: 3) */
    maxRetries?: number;
    /** Base delay between retries in ms (default: 50) */
    baseDelayMs?: number;
    /** Name for logging (default: 'operation') */
    operationName?: string;
    /** Whether to use exponential backoff (default: true) */
    exponentialBackoff?: boolean;
}

/**
 * Retry an async operation with exponential backoff.
 *
 * Designed for transient failures (network blips, Redis timeouts).
 * Does NOT retry on application-level errors (validation, not-found, etc).
 *
 * @param fn - The async operation to retry
 * @param options - Retry configuration
 * @returns The result of the successful operation
 * @throws The last error if all retries are exhausted
 */
export async function retryAsync<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
    const { maxRetries = 3, baseDelayMs = 50, operationName = 'operation', exponentialBackoff = true } = options;

    let lastError: Error = new Error(`${operationName} failed`);

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            // eslint-disable-next-line no-await-in-loop -- retries must be sequential
            return await fn();
        } catch (error) {
            lastError = error as Error;

            if (attempt >= maxRetries) {
                break;
            }

            const delay = exponentialBackoff ? baseDelayMs * Math.pow(2, attempt) : baseDelayMs;

            logger.warn(
                `${operationName} failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay}ms: ${lastError.message}`
            );
            // eslint-disable-next-line no-await-in-loop -- deliberate delay between retries
            await new Promise((resolve) => setTimeout(resolve, delay));
        }
    }

    logger.error(`${operationName} failed after ${maxRetries + 1} attempts: ${lastError.message}`);
    throw lastError;
}
