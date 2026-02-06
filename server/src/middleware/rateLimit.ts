/**
 * Rate Limiting Middleware with Metrics
 */

import type { Request, Response, NextFunction } from 'express';

/* eslint-disable @typescript-eslint/no-var-requires */
const rateLimit = require('express-rate-limit');
const logger = require('../utils/logger');
/* eslint-enable @typescript-eslint/no-var-requires */

/**
 * Rate limit configuration
 */
interface RateLimitConfig {
    max: number;
    window: number;
}

/**
 * Rate limit configurations by event name
 */
type RateLimitConfigs = Record<string, RateLimitConfig | undefined>;

/**
 * Socket with rate limit properties
 */
interface RateLimitSocket {
    id: string;
    sessionId?: string;
    clientIP?: string;
    handshake?: {
        address?: string;
    };
}

/**
 * Rate limiter middleware function
 */
type RateLimiterMiddleware = (
    socket: RateLimitSocket,
    data: unknown,
    next: (error?: Error) => void
) => void;

/**
 * Entry for LRU eviction
 */
interface LRUEntry {
    key: string;
    map: 'socket' | 'ip';
    lastActivity: number;
}

/**
 * Event stats
 */
interface EventStats {
    event: string;
    count: number;
}

/**
 * Rate limiter metrics
 */
interface RateLimiterMetrics {
    totalRequests: number;
    blockedRequests: number;
    blockedByIP: number;
    blockRate: string;
    uniqueSockets: number;
    uniqueIPs: number;
    activeSocketEntries: number;
    activeIPEntries: number;
    requestsPerMinute: number;
    topRequestedEvents: EventStats[];
    topBlockedEvents: EventStats[];
    uptimeMinutes: number;
}

/**
 * HTTP rate limit metrics
 */
interface HttpRateLimitMetrics {
    totalRequests: number;
    blockedRequests: number;
    blockRate: string;
    uniqueIPs: number;
    blockedIPs: number;
    requestsPerMinute: number;
    uptimeMinutes: number;
}

/**
 * Socket rate limiter interface
 */
interface SocketRateLimiter {
    getLimiter: (eventName: string) => RateLimiterMiddleware;
    cleanupSocket: (socketId: string) => void;
    cleanupStale: () => void;
    performLRUEviction: () => number;
    getSize: () => number;
    getMetrics: () => RateLimiterMetrics;
    resetMetrics: () => void;
}

/**
 * API rate limiter
 */
const apiLimiter = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '') || 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '') || 100,
    message: {
        error: {
            code: 'RATE_LIMITED',
            message: 'Too many requests, please try again later'
        }
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req: Request, res: Response, _next: NextFunction, options: { message: unknown }) => {
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
    handler: (req: Request, res: Response, _next: NextFunction, options: { message: unknown }) => {
        logger.warn(`Strict rate limit exceeded for IP: ${req.ip}`);
        res.status(429).json(options.message);
    }
});

// IP multiplier - allows multiple legitimate users on same IP (corporate, shared wifi)
const IP_RATE_LIMIT_MULTIPLIER = 5;

// LRU eviction configuration - prevents unbounded memory growth
const MAX_TRACKED_ENTRIES = parseInt(process.env.RATE_LIMIT_MAX_ENTRIES || '') || 10000;
const LRU_EVICTION_PERCENTAGE = 0.1; // Evict 10% when limit reached

/**
 * In-place filter for timestamp arrays - avoids memory allocation per request
 */
function filterTimestampsInPlace(timestamps: number[], windowStart: number): number {
    let writeIndex = 0;
    for (let i = 0; i < timestamps.length; i++) {
        if (timestamps[i]! > windowStart) {
            timestamps[writeIndex++] = timestamps[i]!;
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
function createSocketRateLimiter(limits: RateLimitConfigs): SocketRateLimiter {
    const socketRequests = new Map<string, number[]>();  // Per-socket rate limiting
    const ipRequests = new Map<string, number[]>();      // Per-IP rate limiting (aggregate)
    // Reverse index for O(1) socket cleanup: socketId -> Set of keys
    const socketKeyIndex = new Map<string, Set<string>>();

    // Metrics tracking
    let totalRequests = 0;
    let blockedRequests = 0;
    let blockedByIP = 0;
    // HARDENING FIX: Capped with periodic cleanup to prevent unbounded growth
    const MAX_UNIQUE_TRACKING = 10000;
    const METRICS_CLEANUP_THRESHOLD = MAX_UNIQUE_TRACKING * 0.9; // 90% triggers cleanup
    const uniqueSockets = new Set<string>();
    const uniqueIPs = new Set<string>();
    const eventRequests = new Map<string, number>();   // event -> count
    const eventBlocked = new Map<string, number>();    // event -> blocked count
    const startTime = Date.now();
    let lastMetricsCleanup = Date.now();

    /**
     * Get client IP from socket (set by socketAuth middleware)
     */
    const getSocketIP = (socket: RateLimitSocket): string => {
        return socket.clientIP || socket.handshake?.address || 'unknown';
    };

    /**
     * Get rate limiter middleware for a specific event
     */
    const getLimiter = (eventName: string): RateLimiterMiddleware => {
        const limit = limits[eventName];
        if (!limit) return (_socket, _data, next) => next();

        return (socket, _data, next) => {
            const socketKey = `${socket.id}:${eventName}`;
            const clientIP = getSocketIP(socket);
            const ipKey = `ip:${clientIP}:${eventName}`;
            const now = Date.now();
            const windowStart = now - limit.window;

            // Track metrics
            totalRequests++;
            if (uniqueSockets.size < MAX_UNIQUE_TRACKING) uniqueSockets.add(socket.id);
            if (uniqueIPs.size < MAX_UNIQUE_TRACKING) uniqueIPs.add(clientIP);
            eventRequests.set(eventName, (eventRequests.get(eventName) || 0) + 1);

            // === Per-socket rate limiting ===
            let socketTimestamps = socketRequests.get(socketKey);
            if (!socketTimestamps) {
                socketTimestamps = [];
                socketRequests.set(socketKey, socketTimestamps);
                if (!socketKeyIndex.has(socket.id)) {
                    socketKeyIndex.set(socket.id, new Set());
                }
                socketKeyIndex.get(socket.id)!.add(socketKey);
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
    const cleanupSocket = (socketId: string): void => {
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
    const performLRUEviction = (): number => {
        const totalEntries = socketRequests.size + ipRequests.size;
        if (totalEntries <= MAX_TRACKED_ENTRIES) {
            return 0;
        }

        const entriesToRemove = Math.ceil(totalEntries * LRU_EVICTION_PERCENTAGE);
        let removed = 0;

        // Collect all entries with their last activity time
        const allEntries: LRUEntry[] = [];

        for (const [key, timestamps] of socketRequests.entries()) {
            const lastActivity = timestamps.length > 0 ? timestamps[timestamps.length - 1]! : 0;
            allEntries.push({ key, map: 'socket', lastActivity });
        }

        for (const [key, timestamps] of ipRequests.entries()) {
            const lastActivity = timestamps.length > 0 ? timestamps[timestamps.length - 1]! : 0;
            allEntries.push({ key, map: 'ip', lastActivity });
        }

        // Sort by last activity (oldest first)
        allEntries.sort((a, b) => a.lastActivity - b.lastActivity);

        // Remove the oldest entries
        for (let i = 0; i < entriesToRemove && i < allEntries.length; i++) {
            const entry = allEntries[i]!;
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
    const cleanupStale = (): void => {
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
                    if (socketId) {
                        const indexSet = socketKeyIndex.get(socketId);
                        if (indexSet) {
                            indexSet.delete(key);
                            if (indexSet.size === 0) {
                                socketKeyIndex.delete(socketId);
                            }
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

            // HARDENING FIX: Clean up metrics sets to prevent unbounded growth
            // Only clean up every 5 minutes and when sets are approaching capacity
            const timeSinceLastMetricsCleanup = now - lastMetricsCleanup;
            const metricsCleanupInterval = 5 * 60 * 1000; // 5 minutes

            if (timeSinceLastMetricsCleanup >= metricsCleanupInterval) {
                let metricsCleanedUp = false;

                // Clear uniqueSockets if approaching threshold or if we can verify disconnected sockets
                if (uniqueSockets.size >= METRICS_CLEANUP_THRESHOLD) {
                    // Keep only sockets that still have active rate limit entries
                    const activeSockets = new Set<string>();
                    for (const socketId of socketKeyIndex.keys()) {
                        if (uniqueSockets.has(socketId)) {
                            activeSockets.add(socketId);
                        }
                    }
                    const oldSize = uniqueSockets.size;
                    uniqueSockets.clear();
                    for (const socketId of activeSockets) {
                        uniqueSockets.add(socketId);
                    }
                    logger.info(`Metrics cleanup: uniqueSockets reduced from ${oldSize} to ${uniqueSockets.size}`);
                    metricsCleanedUp = true;
                }

                // Clear uniqueIPs if approaching threshold
                if (uniqueIPs.size >= METRICS_CLEANUP_THRESHOLD) {
                    // Keep only IPs that still have active rate limit entries
                    const activeIPs = new Set<string>();
                    for (const key of ipRequests.keys()) {
                        // Key format is "ip:${clientIP}:${eventName}"
                        const parts = key.split(':');
                        if (parts.length >= 2) {
                            const ip = parts[1];
                            if (ip && uniqueIPs.has(ip)) {
                                activeIPs.add(ip);
                            }
                        }
                    }
                    const oldSize = uniqueIPs.size;
                    uniqueIPs.clear();
                    for (const ip of activeIPs) {
                        uniqueIPs.add(ip);
                    }
                    logger.info(`Metrics cleanup: uniqueIPs reduced from ${oldSize} to ${uniqueIPs.size}`);
                    metricsCleanedUp = true;
                }

                if (metricsCleanedUp) {
                    lastMetricsCleanup = now;
                }
            }
        } catch (error) {
            logger.error('Error during rate limit cleanup:', error);
        }
    };

    /**
     * Get total number of tracked entries across all maps
     */
    const getSize = (): number => socketRequests.size + ipRequests.size;

    /**
     * Get detailed metrics for monitoring
     */
    const getMetrics = (): RateLimiterMetrics => {
        const uptimeMs = Date.now() - startTime;
        const uptimeMinutes = uptimeMs / 60000;

        // Top requested events (sorted desc)
        const topRequestedEvents: EventStats[] = [...eventRequests.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([event, count]) => ({ event, count }));

        // Top blocked events (sorted desc)
        const topBlockedEvents: EventStats[] = [...eventBlocked.entries()]
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
    const resetMetrics = (): void => {
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
const httpUniqueIPs = new Set<string>();
const httpBlockedIPs = new Set<string>();
const httpStartTime = Date.now();

function getHttpRateLimitMetrics(): HttpRateLimitMetrics {
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

function resetHttpRateLimitMetrics(): void {
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

export {
    apiLimiter,
    strictLimiter,
    createSocketRateLimiter,
    getHttpRateLimitMetrics,
    resetHttpRateLimitMetrics
};
