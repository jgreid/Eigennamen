/**
 * Timeout utility for async operations
 * Prevents socket handlers from hanging indefinitely when Redis/DB operations stall
 */

import logger from './logger';

/**
 * Custom error class for timeout errors
 */
class TimeoutError extends Error {
    public operationName: string;
    public code: string;

    constructor(message: string, operationName: string) {
        super(message);
        this.name = 'TimeoutError';
        this.operationName = operationName;
        this.code = 'OPERATION_TIMEOUT';
    }
}

/**
 * Wrap a promise with a timeout
 * @param promise - The promise to wrap
 * @param timeoutMs - Timeout in milliseconds
 * @param operationName - Name of the operation (for logging)
 * @returns The promise result or rejects with TimeoutError
 */
async function withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    operationName: string = 'operation'
): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
            const error = new TimeoutError(
                `${operationName} timed out after ${timeoutMs}ms`,
                operationName
            );
            logger.error(`Operation timeout: ${operationName} exceeded ${timeoutMs}ms`);
            reject(error);
        }, timeoutMs);
    });

    try {
        const result = await Promise.race([promise, timeoutPromise]);
        if (timeoutId !== undefined) clearTimeout(timeoutId);
        return result;
    } catch (error) {
        if (timeoutId !== undefined) clearTimeout(timeoutId);
        throw error;
    }
}

/**
 * Parse an integer env var, returning the default if unset or invalid.
 * Clamps to [min, max] and logs a warning if the value was out of range.
 */
function envInt(name: string, defaultValue: number, min: number = 1000, max: number = 120000): number {
    const raw = process.env[name];
    if (!raw) return defaultValue;
    const parsed = parseInt(raw, 10);
    if (isNaN(parsed) || parsed <= 0) return defaultValue;
    if (parsed < min || parsed > max) {
        const clamped = Math.max(min, Math.min(max, parsed));
        logger.warn(`Timeout ${name}=${parsed}ms out of bounds [${min}, ${max}], clamped to ${clamped}ms`);
        return clamped;
    }
    return parsed;
}

/**
 * Timeout values for different operation types.
 * Configurable via environment variables; falls back to defaults.
 */
const TIMEOUTS = {
    SOCKET_HANDLER:  envInt('TIMEOUT_SOCKET_HANDLER',  30000, 5000, 120000),
    REDIS_OPERATION: envInt('TIMEOUT_REDIS_OPERATION',  10000, 1000, 60000),
    JOIN_ROOM:       envInt('TIMEOUT_JOIN_ROOM',        15000, 3000, 60000),
    RECONNECT:       envInt('TIMEOUT_RECONNECT',        15000, 3000, 60000),
    GAME_ACTION:     envInt('TIMEOUT_GAME_ACTION',      10000, 1000, 60000),
    TIMER_OPERATION: envInt('TIMEOUT_TIMER_OPERATION',    5000, 1000, 30000)
} as const;

type TimeoutType = keyof typeof TIMEOUTS;

/**
 * Handler function type
 */
type AsyncHandler<T extends unknown[], R> = (...args: T) => Promise<R>;

/**
 * Create a timeout-wrapped version of an async handler
 * Useful for wrapping entire socket event handlers
 * @param handler - Async handler function
 * @param timeoutMs - Timeout in milliseconds
 * @param operationName - Name of the operation
 * @returns Wrapped handler
 */
function createTimeoutHandler<T extends unknown[], R>(
    handler: AsyncHandler<T, R>,
    timeoutMs: number,
    operationName: string
): AsyncHandler<T, R> {
    return (...args: T): Promise<R> => {
        return withTimeout(handler(...args), timeoutMs, operationName);
    };
}

export {
    withTimeout,
    createTimeoutHandler,
    TimeoutError,
    TIMEOUTS
};

export type { TimeoutType, AsyncHandler };
