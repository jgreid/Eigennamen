/**
 * Rate Limiting Middleware with Metrics
 */

const rateLimit = require('express-rate-limit');
const logger = require('../utils/logger');

/**
 * HTTP API Rate Limit Metrics
 */
const httpRateLimitMetrics = {
    totalRequests: 0,
    blockedRequests: 0,
    uniqueIPs: new Set(),
    blockedIPs: new Set(),
    lastReset: Date.now(),

    recordRequest(ip) {
        this.totalRequests++;
        this.uniqueIPs.add(ip);
    },

    recordBlocked(ip) {
        this.blockedRequests++;
        this.blockedIPs.add(ip);
    },

    getStats() {
        const uptimeMinutes = (Date.now() - this.lastReset) / 60000;
        return {
            totalRequests: this.totalRequests,
            blockedRequests: this.blockedRequests,
            blockRate: this.totalRequests > 0
                ? ((this.blockedRequests / this.totalRequests) * 100).toFixed(2) + '%'
                : '0%',
            uniqueIPs: this.uniqueIPs.size,
            blockedIPs: this.blockedIPs.size,
            requestsPerMinute: uptimeMinutes > 0
                ? (this.totalRequests / uptimeMinutes).toFixed(2)
                : 0,
            uptimeMinutes: Math.floor(uptimeMinutes)
        };
    },

    reset() {
        this.totalRequests = 0;
        this.blockedRequests = 0;
        this.uniqueIPs.clear();
        this.blockedIPs.clear();
        this.lastReset = Date.now();
    }
};

/**
 * API rate limiter with metrics
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
    handler: (req, res, _next, options) => {
        httpRateLimitMetrics.recordBlocked(req.ip);
        logger.warn(`Rate limit exceeded for IP: ${req.ip}`);
        res.status(429).json(options.message);
    },
    // Track all requests for metrics
    skip: (req) => {
        httpRateLimitMetrics.recordRequest(req.ip);
        return false; // Don't skip any requests
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
    legacyHeaders: false,
    handler: (req, res, _next, options) => {
        httpRateLimitMetrics.recordBlocked(req.ip);
        logger.warn(`Strict rate limit exceeded for IP: ${req.ip}`);
        res.status(429).json(options.message);
    }
});

/**
 * Socket event rate limiter (in-memory, per socket)
 * Returns an object with limiter and cleanup functions
 * Includes detailed metrics for production monitoring
 */
function createSocketRateLimiter(limits) {
    const requests = new Map();

    // Metrics tracking
    const metrics = {
        totalRequests: 0,
        blockedRequests: 0,
        requestsByEvent: {},
        blockedByEvent: {},
        uniqueSockets: new Set(),
        lastReset: Date.now()
    };

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

            // Track metrics
            metrics.totalRequests++;
            metrics.requestsByEvent[eventName] = (metrics.requestsByEvent[eventName] || 0) + 1;
            metrics.uniqueSockets.add(socket.id);

            // Get or initialize request timestamps
            let timestamps = requests.get(key) || [];

            // Filter to only timestamps within window
            timestamps = timestamps.filter(t => t > windowStart);

            if (timestamps.length >= limit.max) {
                metrics.blockedRequests++;
                metrics.blockedByEvent[eventName] = (metrics.blockedByEvent[eventName] || 0) + 1;
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
     * Wrapped in try-catch to prevent cleanup failures from causing memory leaks
     */
    const cleanupStale = () => {
        try {
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
        } catch (error) {
            logger.error('Error during rate limit cleanup:', error);
        }
    };

    /**
     * Get current size of rate limit map (for monitoring)
     */
    const getSize = () => requests.size;

    /**
     * Get detailed metrics for monitoring
     */
    const getMetrics = () => {
        const uptimeMinutes = (Date.now() - metrics.lastReset) / 60000;

        // Find top blocked events
        const topBlockedEvents = Object.entries(metrics.blockedByEvent)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([event, count]) => ({ event, count }));

        // Find top requested events
        const topRequestedEvents = Object.entries(metrics.requestsByEvent)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([event, count]) => ({ event, count }));

        return {
            totalRequests: metrics.totalRequests,
            blockedRequests: metrics.blockedRequests,
            blockRate: metrics.totalRequests > 0
                ? ((metrics.blockedRequests / metrics.totalRequests) * 100).toFixed(2) + '%'
                : '0%',
            uniqueSockets: metrics.uniqueSockets.size,
            activeEntries: requests.size,
            requestsPerMinute: uptimeMinutes > 0
                ? (metrics.totalRequests / uptimeMinutes).toFixed(2)
                : 0,
            topRequestedEvents,
            topBlockedEvents,
            uptimeMinutes: Math.floor(uptimeMinutes)
        };
    };

    /**
     * Reset metrics (useful for periodic reset)
     */
    const resetMetrics = () => {
        metrics.totalRequests = 0;
        metrics.blockedRequests = 0;
        metrics.requestsByEvent = {};
        metrics.blockedByEvent = {};
        metrics.uniqueSockets.clear();
        metrics.lastReset = Date.now();
    };

    return {
        getLimiter,
        cleanupSocket,
        cleanupStale,
        getSize,
        getMetrics,
        resetMetrics
    };
}

/**
 * Get HTTP API rate limit metrics
 */
function getHttpRateLimitMetrics() {
    return httpRateLimitMetrics.getStats();
}

/**
 * Reset HTTP API rate limit metrics
 */
function resetHttpRateLimitMetrics() {
    httpRateLimitMetrics.reset();
}

module.exports = {
    apiLimiter,
    strictLimiter,
    createSocketRateLimiter,
    getHttpRateLimitMetrics,
    resetHttpRateLimitMetrics
};
