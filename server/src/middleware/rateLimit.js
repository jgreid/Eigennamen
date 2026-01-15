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
 * Returns a middleware function for socket events
 */
function createSocketRateLimiter(limits) {
    const requests = new Map();

    return (eventName) => {
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

            // Clean up old entries periodically
            if (Math.random() < 0.01) {
                for (const [k, v] of requests.entries()) {
                    const filtered = v.filter(t => t > windowStart);
                    if (filtered.length === 0) {
                        requests.delete(k);
                    } else {
                        requests.set(k, filtered);
                    }
                }
            }

            next();
        };
    };
}

module.exports = {
    apiLimiter,
    strictLimiter,
    createSocketRateLimiter
};
