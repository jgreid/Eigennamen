/**
 * Timeout utility for async operations
 * Prevents socket handlers from hanging indefinitely when Redis/DB operations stall
 */

const logger = require('./logger');

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
    let timeoutId: ReturnType<typeof setTimeout>;

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
        clearTimeout(timeoutId!);
        return result;
    } catch (error) {
        clearTimeout(timeoutId!);
        throw error;
    }
}

/**
 * Default timeout values for different operation types
 */
const TIMEOUTS = {
    SOCKET_HANDLER: 30000,      // 30 seconds for general socket operations
    REDIS_OPERATION: 10000,     // 10 seconds for Redis operations
    JOIN_ROOM: 15000,           // 15 seconds for room join (includes multiple DB operations)
    RECONNECT: 15000,           // 15 seconds for reconnection
    GAME_ACTION: 10000,         // 10 seconds for game actions
    TIMER_OPERATION: 5000       // 5 seconds for timer operations
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

module.exports = {
    withTimeout,
    createTimeoutHandler,
    TimeoutError,
    TIMEOUTS
};

// ES6 exports for TypeScript imports
export {
    withTimeout,
    createTimeoutHandler,
    TimeoutError,
    TIMEOUTS
};

export type { TimeoutType, AsyncHandler };
