/**
 * Rate Limiting Middleware with Metrics
 */

import type { Request, Response, NextFunction } from 'express';

import rateLimit from 'express-rate-limit';
import logger from '../utils/logger';

interface RateLimitConfig {
    max: number;
    window: number;
}

type RateLimitConfigs = Record<string, RateLimitConfig | undefined>;

interface RateLimitSocket {
    id: string;
    sessionId?: string;
    clientIP?: string;
    handshake?: {
        address?: string;
    };
}

type RateLimiterMiddleware = (
    socket: RateLimitSocket,
    data: unknown,
    next: (error?: Error) => void
) => void;

interface LRUEntry {
    key: string;
    map: 'socket' | 'ip';
    lastActivity: number;
}

interface EventStats {
    event: string;
    count: number;
}

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

interface SocketRateLimiter {
    getLimiter: (eventName: string) => RateLimiterMiddleware;
    cleanupSocket: (socketId: string) => void;
    cleanupStale: () => void;
    performLRUEviction: () => number;
    getSize: () => number;
    getMetrics: () => RateLimiterMetrics;
    resetMetrics: () => void;
}

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

// IP multiplier: allows multiple users on same IP (3x per-socket limit)
const IP_RATE_LIMIT_MULTIPLIER = 3;

const MAX_TRACKED_ENTRIES = parseInt(process.env.RATE_LIMIT_MAX_ENTRIES || '') || 10000;
const LRU_EVICTION_PERCENTAGE = 0.1;

function filterTimestampsInPlace(timestamps: number[], windowStart: number): number {
    let writeIndex = 0;
    for (let i = 0; i < timestamps.length; i++) {
        const ts = timestamps[i];
        if (ts !== undefined && ts > windowStart) {
            timestamps[writeIndex++] = ts;
        }
    }
    timestamps.length = writeIndex;
    return writeIndex;
}

/** Dual-layer rate limiter: per-socket + per-IP */
function createSocketRateLimiter(limits: RateLimitConfigs): SocketRateLimiter {
    const socketRequests = new Map<string, number[]>();
    const ipRequests = new Map<string, number[]>();
    const socketKeyIndex = new Map<string, Set<string>>();

    let totalRequests = 0;
    let blockedRequests = 0;
    let blockedByIP = 0;
    const MAX_UNIQUE_TRACKING = 10000;
    const METRICS_CLEANUP_THRESHOLD = MAX_UNIQUE_TRACKING * 0.9;
    const uniqueSockets = new Set<string>();
    const uniqueIPs = new Set<string>();
    const eventRequests = new Map<string, number>();
    const eventBlocked = new Map<string, number>();
    const startTime = Date.now();
    let lastMetricsCleanup = Date.now();

    const getSocketIP = (socket: RateLimitSocket): string => {
        return socket.clientIP || socket.handshake?.address || 'unknown';
    };

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
                // Safe to cast: we just ensured the key exists above
                (socketKeyIndex.get(socket.id) as Set<string>).add(socketKey);
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

    const cleanupSocket = (socketId: string): void => {
        const keys = socketKeyIndex.get(socketId);
        if (keys && keys.size > 0) {
            for (const key of keys) {
                socketRequests.delete(key);
            }
            logger.debug(`Cleaned up ${keys.size} rate limit entries for socket ${socketId}`);
            socketKeyIndex.delete(socketId);
        }
    };

    const performLRUEviction = (): number => {
        const totalEntries = socketRequests.size + ipRequests.size;
        if (totalEntries <= MAX_TRACKED_ENTRIES) {
            return 0;
        }

        const entriesToRemove = Math.ceil(totalEntries * LRU_EVICTION_PERCENTAGE);
        let removed = 0;

        const allEntries: LRUEntry[] = [];

        for (const [key, timestamps] of socketRequests.entries()) {
            const lastTs = timestamps[timestamps.length - 1];
            const lastActivity = timestamps.length > 0 && lastTs !== undefined ? lastTs : 0;
            allEntries.push({ key, map: 'socket', lastActivity });
        }

        for (const [key, timestamps] of ipRequests.entries()) {
            const lastTs = timestamps[timestamps.length - 1];
            const lastActivity = timestamps.length > 0 && lastTs !== undefined ? lastTs : 0;
            allEntries.push({ key, map: 'ip', lastActivity });
        }

        allEntries.sort((a, b) => a.lastActivity - b.lastActivity);
        for (let i = 0; i < entriesToRemove && i < allEntries.length; i++) {
            const entry = allEntries[i] as LRUEntry;
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

            for (const [key, timestamps] of socketRequests.entries()) {
                const newLength = filterTimestampsInPlace(timestamps, windowStart);
                if (newLength === 0) {
                    socketRequests.delete(key);
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

            performLRUEviction();

            // Clean up metrics sets periodically to prevent unbounded growth
            const timeSinceLastMetricsCleanup = now - lastMetricsCleanup;
            const metricsCleanupInterval = 5 * 60 * 1000;

            if (timeSinceLastMetricsCleanup >= metricsCleanupInterval) {
                let metricsCleanedUp = false;

                if (uniqueSockets.size >= METRICS_CLEANUP_THRESHOLD) {
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

                if (uniqueIPs.size >= METRICS_CLEANUP_THRESHOLD) {
                    const activeIPs = new Set<string>();
                    for (const key of ipRequests.keys()) {
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

    const getSize = (): number => socketRequests.size + ipRequests.size;

    const getMetrics = (): RateLimiterMetrics => {
        const uptimeMs = Date.now() - startTime;
        const uptimeMinutes = uptimeMs / 60000;
        const topRequestedEvents: EventStats[] = [...eventRequests.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([event, count]) => ({ event, count }));

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

export {
    apiLimiter,
    strictLimiter,
    createSocketRateLimiter
};
