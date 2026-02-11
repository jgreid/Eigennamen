/**
 * Rate-limited Socket Handler Utility
 * Extracted to avoid circular dependencies between socket/index.ts and handlers
 */

import type { Socket } from 'socket.io';

import { createSocketRateLimiter } from '../middleware/rateLimit';
import { RATE_LIMITS, ERROR_CODES } from '../config/constants';
import logger from '../utils/logger';
import { sanitizeErrorForClient } from '../errors/GameError';
/**
 * Extended Socket type with game-specific properties
 */
export interface GameSocket extends Socket {
    sessionId: string;
    roomCode: string | null;
    clientIP?: string;
    flyInstanceId?: string;
    rateLimiter?: SocketRateLimiter;
}

/**
 * Rate limiter middleware function type
 */
type RateLimiterMiddleware = (
    socket: GameSocket,
    data: unknown,
    next: (error?: Error) => void
) => void;

/**
 * Event stats for metrics
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
 * Socket rate limiter interface
 */
export interface SocketRateLimiter {
    getLimiter: (eventName: string) => RateLimiterMiddleware;
    cleanupSocket: (socketId: string) => void;
    cleanupStale: () => void;
    performLRUEviction: () => number;
    getSize: () => number;
    getMetrics: () => RateLimiterMetrics;
    resetMetrics: () => void;
}

/**
 * Acknowledgment callback type
 */
type AckCallback = (response: { ok?: boolean; error?: boolean }) => void;

/**
 * Rate-limited handler function type
 */
type RateLimitedHandler = (data: unknown, ackCallback?: AckCallback) => Promise<void>;

/**
 * Handler function type (user-provided)
 */
type HandlerFunction = (data: unknown) => Promise<void>;

// Create socket rate limiter using centralized constants
// This ensures consistency between constants.ts and actual rate limiting
const socketRateLimiter: SocketRateLimiter = createSocketRateLimiter(RATE_LIMITS);

// Store reference for cleanup on shutdown
let rateLimitCleanupInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start periodic cleanup of stale rate limit entries
 */
function startRateLimitCleanup(): void {
    if (!rateLimitCleanupInterval) {
        rateLimitCleanupInterval = setInterval(() => socketRateLimiter.cleanupStale(), 60000);
    }
}

/**
 * Stop periodic cleanup of stale rate limit entries
 */
function stopRateLimitCleanup(): void {
    if (rateLimitCleanupInterval) {
        clearInterval(rateLimitCleanupInterval);
        rateLimitCleanupInterval = null;
    }
}

/**
 * Create a rate-limited socket event handler wrapper
 * @param socket - Socket instance
 * @param eventName - Event name for rate limiting
 * @param handler - Async handler function
 * @returns Wrapped handler with rate limiting
 */
function createRateLimitedHandler(
    socket: GameSocket,
    eventName: string,
    handler: HandlerFunction
): RateLimitedHandler {
    // Socket.io passes the ack callback as the last argument when the client
    // calls socket.emit('event', data, callback). We must call it explicitly -
    // Socket.io 4.8 does NOT auto-ack from async return values.
    return (data: unknown, ackCallback?: AckCallback): Promise<void> => {
        const limiter = socketRateLimiter.getLimiter(eventName);

        // FIX C1: Wrap callback-based limiter in Promise so we properly await completion
        // Previously the function returned immediately before the limiter callback executed
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

/**
 * Get the socket rate limiter for use in handlers
 */
function getSocketRateLimiter(): SocketRateLimiter {
    return socketRateLimiter;
}
export {
    socketRateLimiter,
    createRateLimitedHandler,
    getSocketRateLimiter,
    startRateLimitCleanup,
    stopRateLimitCleanup
};
