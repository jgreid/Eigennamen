/**
 * Rate-limited Socket Handler Utility
 * Extracted to avoid circular dependencies between socket/index.js and handlers
 */

const { createSocketRateLimiter } = require('../middleware/rateLimit');
const { RATE_LIMITS, ERROR_CODES } = require('../config/constants');
const logger = require('../utils/logger');
const { sanitizeErrorForClient } = require('../errors/GameError');

// Create socket rate limiter using centralized constants
// This ensures consistency between constants.js and actual rate limiting
const socketRateLimiter = createSocketRateLimiter(RATE_LIMITS);

// Store reference for cleanup on shutdown
let rateLimitCleanupInterval = null;

/**
 * Start periodic cleanup of stale rate limit entries
 */
function startRateLimitCleanup() {
    if (!rateLimitCleanupInterval) {
        rateLimitCleanupInterval = setInterval(() => socketRateLimiter.cleanupStale(), 60000);
    }
}

/**
 * Stop periodic cleanup of stale rate limit entries
 */
function stopRateLimitCleanup() {
    if (rateLimitCleanupInterval) {
        clearInterval(rateLimitCleanupInterval);
        rateLimitCleanupInterval = null;
    }
}

/**
 * Create a rate-limited socket event handler wrapper
 * @param {object} socket - Socket instance
 * @param {string} eventName - Event name for rate limiting
 * @param {Function} handler - Async handler function
 * @returns {Function} Wrapped handler with rate limiting
 */
function createRateLimitedHandler(socket, eventName, handler) {
    // Socket.io passes the ack callback as the last argument when the client
    // calls socket.emit('event', data, callback). We must call it explicitly —
    // Socket.io 4.8 does NOT auto-ack from async return values.
    return async (data, ackCallback) => {
        const limiter = socketRateLimiter.getLimiter(eventName);

        // FIX C1: Wrap callback-based limiter in Promise so we properly await completion
        // Previously the function returned immediately before the limiter callback executed
        return new Promise((resolve) => {
            limiter(socket, data, async (err) => {
                if (err) {
                    logger.warn(`Rate limit exceeded for ${eventName} from ${socket.id}`);
                    const errorEvent = `${eventName.split(':')[0]}:error`;
                    socket.emit(errorEvent, {
                        code: ERROR_CODES.RATE_LIMITED,
                        message: 'Too many requests, please slow down'
                    });
                    if (typeof ackCallback === 'function') ackCallback({ error: true });
                    resolve();
                    return;
                }
                try {
                    await handler(data);
                    if (typeof ackCallback === 'function') ackCallback({ ok: true });
                } catch (error) {
                    logger.error(`Error in ${eventName} handler:`, error);
                    const errorEvent = `${eventName.split(':')[0]}:error`;
                    socket.emit(errorEvent, sanitizeErrorForClient(error));
                    if (typeof ackCallback === 'function') ackCallback({ error: true });
                } finally {
                    resolve();
                }
            });
        });
    };
}

/**
 * Get the socket rate limiter for use in handlers
 */
function getSocketRateLimiter() {
    return socketRateLimiter;
}

module.exports = {
    socketRateLimiter,
    createRateLimitedHandler,
    getSocketRateLimiter,
    startRateLimitCleanup,
    stopRateLimitCleanup
};
