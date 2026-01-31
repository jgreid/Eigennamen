/**
 * Rate Limiting Middleware with Metrics
 */

const rateLimit = require('express-rate-limit');
const logger = require('../utils/logger');

/**
 * API rate limiter
 */
const apiLimiter = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
    message: {
        error: {
            code: 'RATE_LIMITED',
            message: 'Too many requests, please try again later'
        }
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res, _next, options) => {
        logger.warn(`Rate limit exceeded for IP: ${req.ip}`);
        res.status(429).json(options.message);
    }
});

/**
 * Stricter rate limiter for sensitive endpoints
 */
const strictLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    message: {
        error: {
            code: 'RATE_LIMITED',
            message: 'Too many requests, please try again later'
        }
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res, _next, options) => {
        logger.warn(`Strict rate limit exceeded for IP: ${req.ip}`);
        res.status(429).json(options.message);
    }
});

// IP multiplier - allows multiple legitimate users on same IP (corporate, shared wifi)
const IP_RATE_LIMIT_MULTIPLIER = 5;

// LRU eviction configuration - prevents unbounded memory growth
const MAX_TRACKED_ENTRIES = parseInt(process.env.RATE_LIMIT_MAX_ENTRIES) || 10000;
const LRU_EVICTION_PERCENTAGE = 0.1; // Evict 10% when limit reached

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
    // Reverse index for O(1) socket cleanup: socketId -> Set of keys
    const socketKeyIndex = new Map();

    // Metrics tracking
    let totalRequests = 0;
    let blockedRequests = 0;
    let blockedByIP = 0;
    const uniqueSockets = new Set();
    const uniqueIPs = new Set();
    const eventRequests = new Map();   // event -> count
    const eventBlocked = new Map();    // event -> blocked count
    const startTime = Date.now();

    /**
     * Get client IP from socket (set by socketAuth middleware)
     */
    const getSocketIP = (socket) => {
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
            totalRequests++;
            uniqueSockets.add(socket.id);
            uniqueIPs.add(clientIP);
            eventRequests.set(eventName, (eventRequests.get(eventName) || 0) + 1);

            // === Per-socket rate limiting ===
            let socketTimestamps = socketRequests.get(socketKey);
            if (!socketTimestamps) {
                socketTimestamps = [];
                socketRequests.set(socketKey, socketTimestamps);
                if (!socketKeyIndex.has(socket.id)) {
                    socketKeyIndex.set(socket.id, new Set());
                }
                socketKeyIndex.get(socket.id).add(socketKey);
            }
            const socketCount = filterTimestampsInPlace(socketTimestamps, windowStart);

            if (socketCount >= limit.max) {
                blockedRequests++;
                eventBlocked.set(eventName, (eventBlocked.get(eventName) || 0) + 1);
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
                blockedRequests++;
                blockedByIP++;
                eventBlocked.set(eventName, (eventBlocked.get(eventName) || 0) + 1);
                logger.warn(`IP rate limit exceeded: ${clientIP} for event ${eventName} (${ipCount} requests)`);
                return next(new Error('IP rate limit exceeded'));
            }

            socketTimestamps.push(now);
            ipTimestamps.push(now);

            next();
        };
    };

    /**
     * Clean up all rate limit entries for a specific socket
     * Call this when a socket disconnects to prevent memory leaks
     * Uses reverse index for O(1) lookup instead of O(n) iteration
     */
    const cleanupSocket = (socketId) => {
        // Use reverse index for O(1) cleanup instead of O(n) iteration
        const keys = socketKeyIndex.get(socketId);
        if (keys && keys.size > 0) {
            for (const key of keys) {
                socketRequests.delete(key);
            }
            logger.debug(`Cleaned up ${keys.size} rate limit entries for socket ${socketId}`);
            socketKeyIndex.delete(socketId);
        }
        // Note: IP-based entries are not cleaned up per-socket as they aggregate across sockets
    };

    /**
     * Perform LRU eviction when entry count exceeds threshold
     * Removes the oldest entries (by last activity) to prevent unbounded memory growth
     */
    const performLRUEviction = () => {
        const totalEntries = socketRequests.size + ipRequests.size;
        if (totalEntries <= MAX_TRACKED_ENTRIES) {
            return 0;
        }

        const entriesToRemove = Math.ceil(totalEntries * LRU_EVICTION_PERCENTAGE);
        let removed = 0;

        // Collect all entries with their last activity time
        const allEntries = [];

        for (const [key, timestamps] of socketRequests.entries()) {
            const lastActivity = timestamps.length > 0 ? Math.max(...timestamps) : 0;
            allEntries.push({ key, map: 'socket', lastActivity });
        }

        for (const [key, timestamps] of ipRequests.entries()) {
            const lastActivity = timestamps.length > 0 ? Math.max(...timestamps) : 0;
            allEntries.push({ key, map: 'ip', lastActivity });
        }

        // Sort by last activity (oldest first)
        allEntries.sort((a, b) => a.lastActivity - b.lastActivity);

        // Remove the oldest entries
        for (let i = 0; i < entriesToRemove && i < allEntries.length; i++) {
            const entry = allEntries[i];
            if (entry.map === 'socket') {
                socketRequests.delete(entry.key);
            } else {
                ipRequests.delete(entry.key);
            }
            removed++;
        }

        if (removed > 0) {
            logger.info(`LRU eviction: removed ${removed} oldest rate limit entries (was ${totalEntries}, now ${totalEntries - removed})`);
        }

        return removed;
    };

    /**
     * Periodic cleanup of stale entries (call from a setInterval)
     * Wrapped in try-catch to prevent cleanup failures from causing memory leaks
     * Uses in-place filtering for performance
     * Also performs LRU eviction if entry count exceeds threshold
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
                    // Also clean up reverse index entry
                    const socketId = key.split(':')[0];
                    const indexSet = socketKeyIndex.get(socketId);
                    if (indexSet) {
                        indexSet.delete(key);
                        if (indexSet.size === 0) {
                            socketKeyIndex.delete(socketId);
                        }
                    }
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

            // Perform LRU eviction if we still have too many entries
            performLRUEviction();
        } catch (error) {
            logger.error('Error during rate limit cleanup:', error);
        }
    };

    /**
     * Get total number of tracked entries across all maps
     */
    const getSize = () => socketRequests.size + ipRequests.size;

    /**
     * Get detailed metrics for monitoring
     */
    const getMetrics = () => {
        const uptimeMs = Date.now() - startTime;
        const uptimeMinutes = uptimeMs / 60000;

        // Top requested events (sorted desc)
        const topRequestedEvents = [...eventRequests.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([event, count]) => ({ event, count }));

        // Top blocked events (sorted desc)
        const topBlockedEvents = [...eventBlocked.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([event, count]) => ({ event, count }));

        return {
            totalRequests,
            blockedRequests,
            blockedByIP,
            blockRate: totalRequests > 0 ? `${((blockedRequests / totalRequests) * 100).toFixed(1)}%` : '0%',
            uniqueSockets: uniqueSockets.size,
            uniqueIPs: uniqueIPs.size,
            activeSocketEntries: socketRequests.size,
            activeIPEntries: ipRequests.size,
            requestsPerMinute: uptimeMinutes > 0 ? Math.round(totalRequests / uptimeMinutes) : 0,
            topRequestedEvents,
            topBlockedEvents,
            uptimeMinutes: Math.round(uptimeMinutes * 10) / 10
        };
    };

    /**
     * Reset all metrics counters
     */
    const resetMetrics = () => {
        totalRequests = 0;
        blockedRequests = 0;
        blockedByIP = 0;
        uniqueSockets.clear();
        uniqueIPs.clear();
        eventRequests.clear();
        eventBlocked.clear();
    };

    return {
        getLimiter,
        cleanupSocket,
        cleanupStale,
        performLRUEviction,
        getSize,
        getMetrics,
        resetMetrics
    };
}

// HTTP rate limit metrics tracking
let httpTotalRequests = 0;
let httpBlockedRequests = 0;
const httpUniqueIPs = new Set();
const httpBlockedIPs = new Set();
const httpStartTime = Date.now();

function getHttpRateLimitMetrics() {
    const uptimeMs = Date.now() - httpStartTime;
    const uptimeMinutes = uptimeMs / 60000;
    return {
        totalRequests: httpTotalRequests,
        blockedRequests: httpBlockedRequests,
        blockRate: httpTotalRequests > 0 ? `${((httpBlockedRequests / httpTotalRequests) * 100).toFixed(1)}%` : '0%',
        uniqueIPs: httpUniqueIPs.size,
        blockedIPs: httpBlockedIPs.size,
        requestsPerMinute: uptimeMinutes > 0 ? Math.round(httpTotalRequests / uptimeMinutes) : 0,
        uptimeMinutes: Math.round(uptimeMinutes * 10) / 10
    };
}

function resetHttpRateLimitMetrics() {
    httpTotalRequests = 0;
    httpBlockedRequests = 0;
    httpUniqueIPs.clear();
    httpBlockedIPs.clear();
}

module.exports = {
    apiLimiter,
    strictLimiter,
    createSocketRateLimiter,
    getHttpRateLimitMetrics,
    resetHttpRateLimitMetrics
};
