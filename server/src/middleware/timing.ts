import type { Request, Response, NextFunction } from 'express';
import type { GameSocket } from '../socket/handlers/types';

import crypto from 'crypto';
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

// Memory monitoring - thresholds for 512MB Fly.io VM
let memoryCheckInterval: ReturnType<typeof setInterval> | null = null;
const MEMORY_CHECK_INTERVAL_MS = 60000;
const MEMORY_WARNING_THRESHOLD_MB = 300;
const MEMORY_CRITICAL_THRESHOLD_MB = 400;

function startMemoryMonitoring(): void {
    if (memoryCheckInterval) return;

    memoryCheckInterval = setInterval(() => {
        const usage = process.memoryUsage();
        const heapUsedMB = Math.round(usage.heapUsed / 1024 / 1024);
        const heapTotalMB = Math.round(usage.heapTotal / 1024 / 1024);
        const rssMB = Math.round(usage.rss / 1024 / 1024);

        const logData = {
            heapUsedMB,
            heapTotalMB,
            rssMB,
            externalMB: Math.round(usage.external / 1024 / 1024),
            heapUsagePercent: Math.round((heapUsedMB / heapTotalMB) * 100),
        };

        if (heapUsedMB > MEMORY_CRITICAL_THRESHOLD_MB) {
            logger.error('Critical memory usage detected', logData);
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

function generateRequestId(): string {
    return `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
}

export { requestTiming, socketEventTiming, startMemoryMonitoring, stopMemoryMonitoring };
