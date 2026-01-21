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

// IP multiplier - allows multiple legitimate users on same IP (corporate, shared wifi)
const IP_RATE_LIMIT_MULTIPLIER = 5;

/**
 * In-place filter for timestamp arrays - avoids memory allocation per request
 * @param {number[]} timestamps - Array of timestamps to filter
 * @param {number} windowStart - Minimum timestamp to keep
 * @returns {number} - New length of the filtered array
 */
function filterTimestampsInPlace(timestamps, windowStart) {
    let writeIndex = 0;
    for (let i = 0; i < timestamps.length; i++) {
        if (timestamps[i] > windowStart) {
            timestamps[writeIndex++] = timestamps[i];
        }
    }
    timestamps.length = writeIndex;
    return writeIndex;
}

/**
 * Socket event rate limiter (in-memory, per socket AND per IP)
 * Returns an object with limiter and cleanup functions
 * Includes detailed metrics for production monitoring
 * Implements dual-layer rate limiting:
 *   1. Per-socket: Prevents single client from overwhelming
 *   2. Per-IP: Prevents attackers from opening many connections
 *
 * Performance optimizations:
 *   - Uses in-place array filtering to avoid memory allocations per request
 *   - Periodic cleanup of stale entries runs on interval
 */
function createSocketRateLimiter(limits) {
    const socketRequests = new Map();  // Per-socket rate limiting
    const ipRequests = new Map();      // Per-IP rate limiting (aggregate)

    // Metrics tracking
    const metrics = {
        totalRequests: 0,
        blockedRequests: 0,
        blockedByIP: 0,
        requestsByEvent: {},
        blockedByEvent: {},
        uniqueSockets: new Set(),
        uniqueIPs: new Set(),
        lastReset: Date.now()
    };

    /**
     * Get client IP from socket (set by socketAuth middleware)
     */
    const getSocketIP = (socket) => {
        // IP is stored on handshake by socketAuth middleware
        return socket.clientIP || socket.handshake?.address || 'unknown';
    };

    /**
     * Get rate limiter middleware for a specific event
     */
    const getLimiter = (eventName) => {
        const limit = limits[eventName];
        if (!limit) return (socket, data, next) => next();

        return (socket, data, next) => {
            const socketKey = `${socket.id}:${eventName}`;
            const clientIP = getSocketIP(socket);
            const ipKey = `ip:${clientIP}:${eventName}`;
            const now = Date.now();
            const windowStart = now - limit.window;

            // Track metrics
            metrics.totalRequests++;
            metrics.requestsByEvent[eventName] = (metrics.requestsByEvent[eventName] || 0) + 1;
            metrics.uniqueSockets.add(socket.id);
            metrics.uniqueIPs.add(clientIP);

            // === Per-socket rate limiting ===
            // Use in-place filtering to avoid memory allocation per request
            let socketTimestamps = socketRequests.get(socketKey);
            if (!socketTimestamps) {
                socketTimestamps = [];
                socketRequests.set(socketKey, socketTimestamps);
            }
            const socketCount = filterTimestampsInPlace(socketTimestamps, windowStart);

            if (socketCount >= limit.max) {
                metrics.blockedRequests++;
                metrics.blockedByEvent[eventName] = (metrics.blockedByEvent[eventName] || 0) + 1;
                logger.warn(`Socket rate limit exceeded: ${socket.id} for event ${eventName}`);
                return next(new Error('Rate limit exceeded'));
            }

            // === Per-IP rate limiting (with higher threshold) ===
            const ipLimit = limit.max * IP_RATE_LIMIT_MULTIPLIER;
            let ipTimestamps = ipRequests.get(ipKey);
            if (!ipTimestamps) {
                ipTimestamps = [];
                ipRequests.set(ipKey, ipTimestamps);
            }
            const ipCount = filterTimestampsInPlace(ipTimestamps, windowStart);

            if (ipCount >= ipLimit) {
                metrics.blockedRequests++;
                metrics.blockedByIP++;
                metrics.blockedByEvent[eventName] = (metrics.blockedByEvent[eventName] || 0) + 1;
                logger.warn(`IP rate limit exceeded: ${clientIP} for event ${eventName} (${ipCount} requests)`);
                return next(new Error('IP rate limit exceeded'));
            }

            // Add current timestamp (arrays are already stored in maps)
            socketTimestamps.push(now);
            ipTimestamps.push(now);

            next();
        };
    };

    /**
     * Clean up all rate limit entries for a specific socket
     * Call this when a socket disconnects to prevent memory leaks
     */
    const cleanupSocket = (socketId) => {
        const keysToDelete = [];
        for (const key of socketRequests.keys()) {
            if (key.startsWith(`${socketId}:`)) {
                keysToDelete.push(key);
            }
        }
        for (const key of keysToDelete) {
            socketRequests.delete(key);
        }
        if (keysToDelete.length > 0) {
            logger.debug(`Cleaned up ${keysToDelete.length} rate limit entries for socket ${socketId}`);
        }
        // Note: IP-based entries are not cleaned up per-socket as they aggregate across sockets
    };

    /**
     * Periodic cleanup of stale entries (call from a setInterval)
     * Wrapped in try-catch to prevent cleanup failures from causing memory leaks
     * Uses in-place filtering for performance
     */
    const cleanupStale = () => {
        try {
            const now = Date.now();
            const windows = Object.values(limits)
                .map(l => l && typeof l.window === 'number' ? l.window : 0)
                .filter(w => w > 0);
            const maxWindow = windows.length > 0 ? Math.max(...windows) : 60000;
            const windowStart = now - maxWindow;

            let cleanedSocket = 0;
            let cleanedIP = 0;

            // Clean socket-based entries using in-place filtering
            for (const [key, timestamps] of socketRequests.entries()) {
                const newLength = filterTimestampsInPlace(timestamps, windowStart);
                if (newLength === 0) {
                    socketRequests.delete(key);
                    cleanedSocket++;
                }
            }

            // Clean IP-based entries using in-place filtering
            for (const [key, timestamps] of ipRequests.entries()) {
                const newLength = filterTimestampsInPlace(timestamps, windowStart);
                if (newLength === 0) {
                    ipRequests.delete(key);
                    cleanedIP++;
                }
            }

            if (cleanedSocket > 0 || cleanedIP > 0) {
                logger.debug(`Cleaned up ${cleanedSocket} socket and ${cleanedIP} IP rate limit entries`);
            }
        } catch (error) {
            logger.error('Error during rate limit cleanup:', error);
        }
    };

    /**
     * Get current size of rate limit maps (for monitoring)
     */
    const getSize = () => socketRequests.size + ipRequests.size;

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
            blockedByIP: metrics.blockedByIP,
            blockRate: metrics.totalRequests > 0
                ? ((metrics.blockedRequests / metrics.totalRequests) * 100).toFixed(2) + '%'
                : '0%',
            uniqueSockets: metrics.uniqueSockets.size,
            uniqueIPs: metrics.uniqueIPs.size,
            activeSocketEntries: socketRequests.size,
            activeIPEntries: ipRequests.size,
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
        metrics.blockedByIP = 0;
        metrics.requestsByEvent = {};
        metrics.blockedByEvent = {};
        metrics.uniqueSockets.clear();
        metrics.uniqueIPs.clear();
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
