/**
 * Rate Limiting Middleware
 */

const rateLimit = require('express-rate-limit');
const logger = require('../utils/logger');

/**
 * API rate limiter
 */
const apiLimiter = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60 * 1000, // 1 minute
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100, // 100 requests per window
    message: {
        error: {
            code: 'RATE_LIMITED',
            message: 'Too many requests, please try again later'
        }
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res, next, options) => {
        logger.warn(`Rate limit exceeded for IP: ${req.ip}`);
        res.status(429).json(options.message);
    }
});

/**
 * Stricter rate limiter for sensitive endpoints
 */
const strictLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 10, // 10 requests per minute
    message: {
        error: {
            code: 'RATE_LIMITED',
            message: 'Too many requests, please try again later'
        }
    },
    standardHeaders: true,
    legacyHeaders: false
});

/**
 * Socket event rate limiter (in-memory, per socket)
 * Returns an object with limiter and cleanup functions
 */
function createSocketRateLimiter(limits) {
    const requests = new Map();

    /**
     * Get rate limiter middleware for a specific event
     */
    const getLimiter = (eventName) => {
        const limit = limits[eventName];
        if (!limit) return (socket, data, next) => next();

        return (socket, data, next) => {
            const key = `${socket.id}:${eventName}`;
            const now = Date.now();
            const windowStart = now - limit.window;

            // Get or initialize request timestamps
            let timestamps = requests.get(key) || [];

            // Filter to only timestamps within window
            timestamps = timestamps.filter(t => t > windowStart);

            if (timestamps.length >= limit.max) {
                logger.warn(`Socket rate limit exceeded: ${socket.id} for event ${eventName}`);
                return next(new Error('Rate limit exceeded'));
            }

            timestamps.push(now);
            requests.set(key, timestamps);

            next();
        };
    };

    /**
     * Clean up all rate limit entries for a specific socket
     * Call this when a socket disconnects to prevent memory leaks
     */
    const cleanupSocket = (socketId) => {
        const keysToDelete = [];
        for (const key of requests.keys()) {
            if (key.startsWith(`${socketId}:`)) {
                keysToDelete.push(key);
            }
        }
        for (const key of keysToDelete) {
            requests.delete(key);
        }
        if (keysToDelete.length > 0) {
            logger.debug(`Cleaned up ${keysToDelete.length} rate limit entries for socket ${socketId}`);
        }
    };

    /**
     * Periodic cleanup of stale entries (call from a setInterval)
     */
    const cleanupStale = () => {
        const now = Date.now();
        const windows = Object.values(limits)
            .map(l => l && typeof l.window === 'number' ? l.window : 0)
            .filter(w => w > 0);
        const maxWindow = windows.length > 0 ? Math.max(...windows) : 60000;
        const windowStart = now - maxWindow;

        let cleaned = 0;
        for (const [key, timestamps] of requests.entries()) {
            const filtered = timestamps.filter(t => t > windowStart);
            if (filtered.length === 0) {
                requests.delete(key);
                cleaned++;
            } else if (filtered.length !== timestamps.length) {
                requests.set(key, filtered);
            }
        }
        if (cleaned > 0) {
            logger.debug(`Cleaned up ${cleaned} stale rate limit entries`);
        }
    };

    /**
     * Get current size of rate limit map (for monitoring)
     */
    const getSize = () => requests.size;

    return {
        getLimiter,
        cleanupSocket,
        cleanupStale,
        getSize
    };
}

module.exports = {
    apiLimiter,
    strictLimiter,
    createSocketRateLimiter
};
