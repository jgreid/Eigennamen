/**
 * Performance Timing Middleware
 * Sprint 19: Adds request timing and logging for monitoring
 */

import type { Request, Response, NextFunction } from 'express';

const logger = require('../utils/logger');

/**
 * Extended request with timing properties
 */
interface TimedRequest extends Request {
    requestId?: string;
}

/**
 * Socket with session info
 */
interface GameSocket {
    id: string;
    sessionId?: string;
}

/**
 * Request log data
 */
interface RequestLogData {
    requestId: string;
    method: string;
    path: string;
    statusCode: number;
    durationMs: number;
    contentLength: string | number;
    userAgent?: string;
}

/**
 * Socket event log data
 */
interface SocketEventLogData {
    event: string;
    socketId: string;
    sessionId?: string;
    durationMs: number;
    error?: string;
}

/**
 * Memory log data
 */
interface MemoryLogData {
    heapUsedMB: number;
    heapTotalMB: number;
    rssMB: number;
    externalMB: number;
    heapUsagePercent: number;
}

/**
 * HTTP request timing middleware
 * Logs request duration for all HTTP requests
 */
function requestTiming(req: TimedRequest, res: Response, next: NextFunction): void {
    const start = process.hrtime.bigint();
    const requestId = (req.headers['x-request-id'] as string) || generateRequestId();

    // Attach request ID for correlation
    req.requestId = requestId;
    res.setHeader('X-Request-ID', requestId);

    // Log request completion
    res.on('finish', () => {
        const duration = Number(process.hrtime.bigint() - start) / 1e6; // Convert to ms
        const logData: RequestLogData = {
            requestId,
            method: req.method,
            path: req.path,
            statusCode: res.statusCode,
            durationMs: Math.round(duration * 100) / 100, // 2 decimal places
            contentLength: res.get('Content-Length') || 0,
            userAgent: req.get('User-Agent')?.substring(0, 100) // Truncate
        };

        // Log level based on duration and status
        if (res.statusCode >= 500) {
            logger.error('HTTP request completed with error', logData);
        } else if (duration > 1000) {
            logger.warn('HTTP request slow', logData);
        } else if (req.path !== '/health' && req.path !== '/health/live') {
            // Don't spam logs with health checks
            logger.debug('HTTP request completed', logData);
        }
    });

    next();
}

/**
 * Socket event timing wrapper
 * Wraps socket handlers to measure execution time
 */
function socketEventTiming<T extends unknown[]>(
    eventName: string,
    handler: (this: GameSocket, ...args: T) => Promise<unknown> | unknown
): (this: GameSocket, ...args: T) => Promise<unknown> {
    return async function timedHandler(this: GameSocket, ...args: T): Promise<unknown> {
        const start = process.hrtime.bigint();
        const socket = this;

        try {
            const result = await handler.apply(this, args);
            const duration = Number(process.hrtime.bigint() - start) / 1e6;

            const logData: SocketEventLogData = {
                event: eventName,
                socketId: socket.id,
                sessionId: socket.sessionId,
                durationMs: Math.round(duration * 100) / 100
            };

            if (duration > 500) {
                logger.warn('Socket event slow', logData);
            } else if (duration > 100) {
                logger.debug('Socket event timing', logData);
            }

            return result;
        } catch (error) {
            const duration = Number(process.hrtime.bigint() - start) / 1e6;
            logger.error('Socket event error', {
                event: eventName,
                socketId: socket.id,
                sessionId: socket.sessionId,
                durationMs: Math.round(duration * 100) / 100,
                error: (error as Error).message
            });
            throw error;
        }
    };
}

/**
 * Memory usage monitoring
 * Logs memory stats periodically and triggers cleanup under memory pressure.
 *
 * Thresholds (for 512MB Fly.io VM):
 *   - Warning (300MB): Log warning for awareness
 *   - Critical (400MB): Force MemoryStorage cleanup to reclaim memory before OOM
 */
let memoryCheckInterval: ReturnType<typeof setInterval> | null = null;
const MEMORY_CHECK_INTERVAL_MS = 60000; // 1 minute
const MEMORY_WARNING_THRESHOLD_MB = 300; // Warn at 300MB (212MB headroom)
const MEMORY_CRITICAL_THRESHOLD_MB = 400; // Force cleanup at 400MB (112MB before OOM)

function startMemoryMonitoring(): void {
    if (memoryCheckInterval) return;

    memoryCheckInterval = setInterval(() => {
        const usage = process.memoryUsage();
        const heapUsedMB = Math.round(usage.heapUsed / 1024 / 1024);
        const heapTotalMB = Math.round(usage.heapTotal / 1024 / 1024);
        const rssMB = Math.round(usage.rss / 1024 / 1024);

        const logData: MemoryLogData = {
            heapUsedMB,
            heapTotalMB,
            rssMB,
            externalMB: Math.round(usage.external / 1024 / 1024),
            heapUsagePercent: Math.round((heapUsedMB / heapTotalMB) * 100)
        };

        if (heapUsedMB > MEMORY_CRITICAL_THRESHOLD_MB) {
            logger.error('Critical memory usage - forcing cleanup', logData);
            // Trigger emergency cleanup in MemoryStorage
            try {
                const { isMemoryMode, getMemoryStorage } = require('../config/memoryStorage');
                if (isMemoryMode()) {
                    const storage = getMemoryStorage();
                    const cleaned = storage.forceCleanup();
                    const keyCount = storage.getKeyCount();
                    logger.warn(`Emergency cleanup completed: ${cleaned} keys removed, ${keyCount} remaining`);
                }
            } catch (e) {
                logger.error('Failed to run emergency cleanup:', e);
            }
        } else if (heapUsedMB > MEMORY_WARNING_THRESHOLD_MB) {
            logger.warn('High memory usage detected', logData);
        } else {
            logger.debug('Memory usage', logData);
        }
    }, MEMORY_CHECK_INTERVAL_MS);

    logger.info('Memory monitoring started');
}

function stopMemoryMonitoring(): void {
    if (memoryCheckInterval) {
        clearInterval(memoryCheckInterval);
        memoryCheckInterval = null;
        logger.info('Memory monitoring stopped');
    }
}

/**
 * Generate a simple request ID
 */
function generateRequestId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`;
}

module.exports = {
    requestTiming,
    socketEventTiming,
    startMemoryMonitoring,
    stopMemoryMonitoring
};

export {
    requestTiming,
    socketEventTiming,
    startMemoryMonitoring,
    stopMemoryMonitoring
};
