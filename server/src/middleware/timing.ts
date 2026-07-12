import type { Request, Response, NextFunction } from 'express';
import type { GameSocket } from '../socket/handlers/types';

import crypto from 'crypto';
import { getHeapStatistics } from 'v8';
import logger from '../utils/logger';

interface TimedRequest extends Request {
    requestId?: string;
}

function requestTiming(req: TimedRequest, res: Response, next: NextFunction): void {
    const start = process.hrtime.bigint();
    const requestId = (req.headers['x-request-id'] as string) || generateRequestId();

    req.requestId = requestId;
    res.setHeader('X-Request-ID', requestId);

    res.on('finish', () => {
        const duration = Number(process.hrtime.bigint() - start) / 1e6;
        const logData = {
            requestId,
            method: req.method,
            path: req.path,
            statusCode: res.statusCode,
            durationMs: Math.round(duration * 100) / 100,
            contentLength: res.get('Content-Length') || 0,
            userAgent: req.get('User-Agent')?.substring(0, 100),
        };

        if (res.statusCode >= 500) {
            logger.error('HTTP request completed with error', logData);
        } else if (duration > 1000) {
            logger.warn('HTTP request slow', logData);
        } else if (req.path !== '/health' && req.path !== '/health/live') {
            logger.debug('HTTP request completed', logData);
        }
    });

    next();
}

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

            const logData = {
                event: eventName,
                socketId: socket.id,
                sessionId: socket.sessionId,
                durationMs: Math.round(duration * 100) / 100,
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
                error: (error as Error).message,
            });
            throw error;
        }
    };
}

// Memory monitoring — thresholds are RELATIVE to the actual V8 heap limit
// (machine/cgroup-size aware via Node, and tracks --max-old-space-size), not
// absolute megabytes sized for one particular VM. The old fixed 300/400 MB
// numbers dated from the 512 MB deployment: the wide embeddings bake
// legitimately holds ~350 MB of long-lived heap on the 2 GB VM, which tripped
// the "High memory usage" warning every single minute — and would have
// escalated to error-level "Critical" during any busy stretch — at under 30%
// of real capacity. Alarm fatigue like that is exactly what buries a genuine
// leak. (heapUsed/heapTotal is not a useful signal either: V8 grows heapTotal
// lazily, so used/total idles near 99% in any long-lived-data-heavy steady
// state; the reported heapUsagePercent is therefore measured against the
// LIMIT — the number that actually predicts an out-of-memory crash.)
let memoryCheckInterval: ReturnType<typeof setInterval> | null = null;
const MEMORY_CHECK_INTERVAL_MS = 60000;
const HEAP_WARNING_FRACTION = 0.75;
const HEAP_CRITICAL_FRACTION = 0.9;

function startMemoryMonitoring(): void {
    if (memoryCheckInterval) return;

    // The heap limit is constant for the process's lifetime; read it lazily
    // (not at module load) so tests can stub it.
    const heapLimitMB = Math.round(getHeapStatistics().heap_size_limit / 1024 / 1024);
    const warnAtMB = heapLimitMB * HEAP_WARNING_FRACTION;
    const criticalAtMB = heapLimitMB * HEAP_CRITICAL_FRACTION;

    memoryCheckInterval = setInterval(() => {
        const usage = process.memoryUsage();
        const heapUsedMB = Math.round(usage.heapUsed / 1024 / 1024);
        const heapTotalMB = Math.round(usage.heapTotal / 1024 / 1024);
        const rssMB = Math.round(usage.rss / 1024 / 1024);

        const logData = {
            heapUsedMB,
            heapTotalMB,
            heapLimitMB,
            rssMB,
            externalMB: Math.round(usage.external / 1024 / 1024),
            heapUsagePercent: Math.round((heapUsedMB / heapLimitMB) * 100),
        };

        if (heapUsedMB > criticalAtMB) {
            logger.error('Critical memory usage detected', logData);
        } else if (heapUsedMB > warnAtMB) {
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

function generateRequestId(): string {
    return `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
}

export { requestTiming, socketEventTiming, startMemoryMonitoring, stopMemoryMonitoring };
