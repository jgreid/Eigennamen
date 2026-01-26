/**
 * Reliable Emit Utility
 *
 * ISSUE #28 FIX: Provides retry logic for critical Socket.io emissions
 * Uses acknowledgment callbacks to verify message delivery.
 */

const logger = require('../utils/logger');

// Default configuration
const DEFAULT_RETRY_OPTIONS = {
    maxRetries: 3,
    retryDelayMs: 1000,
    timeoutMs: 5000
};

/**
 * Emit with acknowledgment and retry logic
 *
 * @param {Socket} socket - Socket.io socket instance
 * @param {string} event - Event name
 * @param {Object} data - Data to emit
 * @param {Object} options - Retry options
 * @returns {Promise<boolean>} - True if acknowledged, false if all retries failed
 */
async function emitWithRetry(socket, event, data, options = {}) {
    const { maxRetries, retryDelayMs, timeoutMs } = { ...DEFAULT_RETRY_OPTIONS, ...options };

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const acknowledged = await emitWithTimeout(socket, event, data, timeoutMs);
            if (acknowledged) {
                if (attempt > 1) {
                    logger.debug(`Emit ${event} succeeded on attempt ${attempt}`);
                }
                return true;
            }
        } catch (error) {
            logger.warn(`Emit ${event} attempt ${attempt}/${maxRetries} failed: ${error.message}`);
        }

        // Don't wait after the last attempt
        if (attempt < maxRetries) {
            await sleep(retryDelayMs * attempt); // Exponential backoff
        }
    }

    logger.error(`Emit ${event} failed after ${maxRetries} attempts`);
    return false;
}

/**
 * Emit with timeout wrapper
 *
 * FIX: Ensures timeout is always cleaned up even if socket.emit throws or
 * the callback crashes, preventing resource leaks.
 *
 * @param {Socket} socket - Socket.io socket instance
 * @param {string} event - Event name
 * @param {Object} data - Data to emit
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {Promise<boolean>} - True if acknowledged within timeout
 */
function emitWithTimeout(socket, event, data, timeoutMs) {
    return new Promise((resolve) => {
        // Check if socket is connected
        if (!socket.connected) {
            resolve(false);
            return;
        }

        let timeoutId = null;
        let resolved = false;

        // Ensure cleanup and single resolution
        const safeResolve = (value) => {
            if (!resolved) {
                resolved = true;
                if (timeoutId) {
                    clearTimeout(timeoutId);
                    timeoutId = null;
                }
                resolve(value);
            }
        };

        timeoutId = setTimeout(() => {
            safeResolve(false);
        }, timeoutMs);

        // Emit with acknowledgment callback - wrapped in try-catch
        // to ensure timeout is always cleaned up even if emit throws
        try {
            socket.emit(event, data, (ack) => {
                safeResolve(ack !== false && ack !== undefined);
            });
        } catch (error) {
            logger.warn(`Emit ${event} threw error: ${error.message}`);
            safeResolve(false);
        }
    });
}

/**
 * Emit to a room with best-effort delivery (fire-and-forget with logging)
 * Use this for non-critical broadcasts where we don't need acknowledgment
 *
 * @param {Server} io - Socket.io server instance
 * @param {string} room - Room name
 * @param {string} event - Event name
 * @param {Object} data - Data to emit
 */
function emitToRoomWithLogging(io, room, event, data) {
    try {
        io.to(room).emit(event, data);
    } catch (error) {
        logger.error(`Failed to emit ${event} to room ${room}: ${error.message}`);
    }
}

/**
 * Emit to a specific socket with error handling
 *
 * @param {Socket} socket - Socket.io socket instance
 * @param {string} event - Event name
 * @param {Object} data - Data to emit
 * @returns {boolean} - True if emit didn't throw an error
 */
function safeEmit(socket, event, data) {
    try {
        if (!socket || !socket.connected) {
            logger.debug(`Cannot emit ${event}: socket not connected`);
            return false;
        }
        socket.emit(event, data);
        return true;
    } catch (error) {
        logger.error(`Failed to emit ${event}: ${error.message}`);
        return false;
    }
}

/**
 * Sleep utility for retry delays
 * @param {number} ms - Milliseconds to sleep
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
    emitWithRetry,
    emitWithTimeout,
    emitToRoomWithLogging,
    safeEmit,
    DEFAULT_RETRY_OPTIONS
};
