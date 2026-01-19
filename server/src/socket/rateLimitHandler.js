/**
 * Rate-limited Socket Handler Utility
 * Extracted to avoid circular dependencies between socket/index.js and handlers
 */

const { createSocketRateLimiter } = require('../middleware/rateLimit');
const logger = require('../utils/logger');

// Create socket rate limiter with event-specific limits
const socketRateLimiter = createSocketRateLimiter({
    'room:create': { max: 5, window: 60000 },      // 5 per minute
    'room:join': { max: 10, window: 60000 },       // 10 per minute
    'room:leave': { max: 10, window: 60000 },      // 10 per minute
    'room:settings': { max: 10, window: 60000 },   // 10 per minute
    'game:start': { max: 10, window: 60000 },      // 10 per minute
    'game:reveal': { max: 30, window: 60000 },     // 30 per minute
    'game:clue': { max: 20, window: 60000 },       // 20 per minute
    'game:endTurn': { max: 20, window: 60000 },    // 20 per minute
    'game:forfeit': { max: 5, window: 60000 },     // 5 per minute
    'game:history': { max: 10, window: 60000 },    // 10 per minute
    'player:team': { max: 20, window: 60000 },     // 20 per minute
    'player:role': { max: 20, window: 60000 },     // 20 per minute
    'player:nickname': { max: 10, window: 60000 }, // 10 per minute
    'chat:message': { max: 30, window: 60000 }     // 30 per minute
});

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

module.exports = {
    socketRateLimiter,
    createRateLimitedHandler,
    getSocketRateLimiter,
    startRateLimitCleanup,
    stopRateLimitCleanup
};
