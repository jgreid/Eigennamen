/**
 * Rate-limited Socket Handler Utility
 * Extracted to avoid circular dependencies between socket/index.js and handlers
 */

const { createSocketRateLimiter } = require('../middleware/rateLimit');
const { RATE_LIMITS } = require('../config/constants');
const logger = require('../utils/logger');

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
    return async (data) => {
        const limiter = socketRateLimiter.getLimiter(eventName);
        limiter(socket, data, async (err) => {
            if (err) {
                logger.warn(`Rate limit exceeded for ${eventName} from ${socket.id}`);
                const errorEvent = `${eventName.split(':')[0]}:error`;
                socket.emit(errorEvent, {
                    code: 'RATE_LIMITED',
                    message: 'Too many requests, please slow down'
                });
                return;
            }
            try {
                await handler(data);
            } catch (error) {
                logger.error(`Error in ${eventName} handler:`, error);
            }
        });
    };
}

/**
 * Get the socket rate limiter for use in handlers
 */
function getSocketRateLimiter() {
    return socketRateLimiter;
}

/**
 * Get socket rate limit metrics for monitoring
 */
function getSocketRateLimitMetrics() {
    return socketRateLimiter.getMetrics();
}

/**
 * Reset socket rate limit metrics
 */
function resetSocketRateLimitMetrics() {
    socketRateLimiter.resetMetrics();
}

module.exports = {
    socketRateLimiter,
    createRateLimitedHandler,
    getSocketRateLimiter,
    getSocketRateLimitMetrics,
    resetSocketRateLimitMetrics,
    startRateLimitCleanup,
    stopRateLimitCleanup
};
