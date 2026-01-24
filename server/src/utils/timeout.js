/**
 * Timeout utility for async operations
 * Prevents socket handlers from hanging indefinitely when Redis/DB operations stall
 */

const logger = require('./logger');

/**
 * Custom error class for timeout errors
 */
class TimeoutError extends Error {
    constructor(message, operationName) {
        super(message);
        this.name = 'TimeoutError';
        this.operationName = operationName;
        this.code = 'OPERATION_TIMEOUT';
    }
}

/**
 * Wrap a promise with a timeout
 * @param {Promise} promise - The promise to wrap
 * @param {number} timeoutMs - Timeout in milliseconds
 * @param {string} operationName - Name of the operation (for logging)
 * @returns {Promise} The promise result or rejects with TimeoutError
 */
async function withTimeout(promise, timeoutMs, operationName = 'operation') {
    let timeoutId;

    const timeoutPromise = new Promise((_, reject) => {
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
        clearTimeout(timeoutId);
        return result;
    } catch (error) {
        clearTimeout(timeoutId);
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
};

/**
 * Create a timeout-wrapped version of an async handler
 * Useful for wrapping entire socket event handlers
 * @param {Function} handler - Async handler function
 * @param {number} timeoutMs - Timeout in milliseconds
 * @param {string} operationName - Name of the operation
 * @returns {Function} Wrapped handler
 */
function createTimeoutHandler(handler, timeoutMs, operationName) {
    return async (...args) => {
        return withTimeout(handler(...args), timeoutMs, operationName);
    };
}

module.exports = {
    withTimeout,
    createTimeoutHandler,
    TimeoutError,
    TIMEOUTS
};
