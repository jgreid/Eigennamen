/**
 * Rate-limited Socket Handler Utility
 */

import type { Socket } from 'socket.io';

const { createSocketRateLimiter } = require('../middleware/rateLimit');
const { RATE_LIMITS, ERROR_CODES } = require('../config/constants');
const logger = require('../utils/logger');
const { sanitizeErrorForClient } = require('../errors/GameError');

export interface GameSocket extends Socket {
    sessionId: string;
    roomCode: string | null;
    clientIP?: string;
    flyInstanceId?: string;
    rateLimiter?: SocketRateLimiter;
}

type RateLimiterMiddleware = (
    socket: GameSocket,
    data: unknown,
    next: (error?: Error) => void
) => void;

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

export interface SocketRateLimiter {
    getLimiter: (eventName: string) => RateLimiterMiddleware;
    cleanupSocket: (socketId: string) => void;
    cleanupStale: () => void;
    performLRUEviction: () => number;
    getSize: () => number;
    getMetrics: () => RateLimiterMetrics;
    resetMetrics: () => void;
}

type AckCallback = (response: { ok?: boolean; error?: boolean }) => void;
type RateLimitedHandler = (data: unknown, ackCallback?: AckCallback) => Promise<void>;
type HandlerFunction = (data: unknown) => Promise<void>;

const socketRateLimiter: SocketRateLimiter = createSocketRateLimiter(RATE_LIMITS);
let rateLimitCleanupInterval: ReturnType<typeof setInterval> | null = null;

function startRateLimitCleanup(): void {
    if (!rateLimitCleanupInterval) {
        rateLimitCleanupInterval = setInterval(() => socketRateLimiter.cleanupStale(), 60000);
    }
}

function stopRateLimitCleanup(): void {
    if (rateLimitCleanupInterval) {
        clearInterval(rateLimitCleanupInterval);
        rateLimitCleanupInterval = null;
    }
}

function createRateLimitedHandler(
    socket: GameSocket,
    eventName: string,
    handler: HandlerFunction
): RateLimitedHandler {
    return (data: unknown, ackCallback?: AckCallback): Promise<void> => {
        const limiter = socketRateLimiter.getLimiter(eventName);
        return new Promise((resolve) => {
            limiter(socket, data, async (err?: Error) => {
                if (err) {
                    logger.warn(`Rate limit exceeded for ${eventName} from ${socket.id}`);
                    const errorEvent = `${eventName.split(':')[0]}:error`;
                    socket.emit(errorEvent, {
                        code: ERROR_CODES.RATE_LIMITED,
                        message: 'Too many requests, please slow down'
                    });
                    if (typeof ackCallback === 'function') ackCallback({ error: true });
                    resolve();
                    return;
                }
                try {
                    await handler(data);
                    if (typeof ackCallback === 'function') ackCallback({ ok: true });
                } catch (error) {
                    logger.error(`Error in ${eventName} handler:`, error);
                    const errorEvent = `${eventName.split(':')[0]}:error`;
                    socket.emit(errorEvent, sanitizeErrorForClient(error));
                    if (typeof ackCallback === 'function') ackCallback({ error: true });
                } finally {
                    resolve();
                }
            });
        });
    };
}

function getSocketRateLimiter(): SocketRateLimiter {
    return socketRateLimiter;
}

module.exports = {
    socketRateLimiter,
    createRateLimitedHandler,
    getSocketRateLimiter,
    startRateLimitCleanup,
    stopRateLimitCleanup
};

export {
    socketRateLimiter,
    createRateLimitedHandler,
    getSocketRateLimiter,
    startRateLimitCleanup,
    stopRateLimitCleanup
};
