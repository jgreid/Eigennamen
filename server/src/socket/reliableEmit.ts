/**
 * Reliable Emit Utility
 *
 * ISSUE #28 FIX: Provides retry logic for critical Socket.io emissions
 * Uses acknowledgment callbacks to verify message delivery.
 */

import type { Socket, Server as SocketIOServer } from 'socket.io';

/* eslint-disable @typescript-eslint/no-var-requires */
const logger = require('../utils/logger');
/* eslint-enable @typescript-eslint/no-var-requires */

/**
 * Retry options for reliable emit
 */
export interface RetryOptions {
    /** Maximum number of retry attempts */
    maxRetries?: number;
    /** Base delay between retries in milliseconds */
    retryDelayMs?: number;
    /** Timeout for each attempt in milliseconds */
    timeoutMs?: number;
}

/**
 * Default configuration for retry options
 */
const DEFAULT_RETRY_OPTIONS: Required<RetryOptions> = {
    maxRetries: 3,
    retryDelayMs: 1000,
    timeoutMs: 5000
};

/**
 * Sleep utility for retry delays
 * @param ms - Milliseconds to sleep
 */
function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Emit with acknowledgment and retry logic
 *
 * @param socket - Socket.io socket instance
 * @param event - Event name
 * @param data - Data to emit
 * @param options - Retry options
 * @returns True if acknowledged, false if all retries failed
 */
async function emitWithRetry(
    socket: Socket,
    event: string,
    data: unknown,
    options: RetryOptions = {}
): Promise<boolean> {
    const { maxRetries, retryDelayMs, timeoutMs } = { ...DEFAULT_RETRY_OPTIONS, ...options };

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const acknowledged = await emitWithTimeout(socket, event, data, timeoutMs);
            if (acknowledged) {
                if (attempt > 1) {
                    logger.debug(`Emit ${event} succeeded on attempt ${attempt}`);
                }
                return true;
            }
        } catch (error) {
            logger.warn(`Emit ${event} attempt ${attempt}/${maxRetries} failed: ${(error as Error).message}`);
        }

        // Don't wait after the last attempt
        if (attempt < maxRetries) {
            await sleep(retryDelayMs * attempt); // Exponential backoff
        }
    }

    logger.error(`Emit ${event} failed after ${maxRetries} attempts`);
    return false;
}

/**
 * Emit with timeout wrapper
 *
 * FIX: Ensures timeout is always cleaned up even if socket.emit throws or
 * the callback crashes, preventing resource leaks.
 *
 * @param socket - Socket.io socket instance
 * @param event - Event name
 * @param data - Data to emit
 * @param timeoutMs - Timeout in milliseconds
 * @returns True if acknowledged within timeout
 */
function emitWithTimeout(
    socket: Socket,
    event: string,
    data: unknown,
    timeoutMs: number
): Promise<boolean> {
    return new Promise((resolve) => {
        // Check if socket is connected
        if (!socket.connected) {
            resolve(false);
            return;
        }

        let timeoutId: ReturnType<typeof setTimeout> | null = null;
        let resolved = false;

        // Ensure cleanup and single resolution
        const safeResolve = (value: boolean): void => {
            if (!resolved) {
                resolved = true;
                if (timeoutId) {
                    clearTimeout(timeoutId);
                    timeoutId = null;
                }
                resolve(value);
            }
        };

        timeoutId = setTimeout(() => {
            safeResolve(false);
        }, timeoutMs);

        // Emit with acknowledgment callback - wrapped in try-catch
        // to ensure timeout is always cleaned up even if emit throws
        try {
            socket.emit(event, data, (ack: unknown) => {
                safeResolve(ack !== false && ack !== undefined);
            });
        } catch (error) {
            logger.warn(`Emit ${event} threw error: ${(error as Error).message}`);
            safeResolve(false);
        }
    });
}

/**
 * Emit to a room with best-effort delivery (fire-and-forget with logging)
 * Use this for non-critical broadcasts where we don't need acknowledgment
 *
 * @param io - Socket.io server instance
 * @param room - Room name
 * @param event - Event name
 * @param data - Data to emit
 */
function emitToRoomWithLogging(
    io: SocketIOServer,
    room: string,
    event: string,
    data: unknown
): void {
    try {
        io.to(room).emit(event, data);
    } catch (error) {
        logger.error(`Failed to emit ${event} to room ${room}: ${(error as Error).message}`);
    }
}

/**
 * Emit to a specific socket with error handling
 *
 * @param socket - Socket.io socket instance
 * @param event - Event name
 * @param data - Data to emit
 * @returns True if emit didn't throw an error
 */
function safeEmit(
    socket: Socket | null,
    event: string,
    data: unknown
): boolean {
    try {
        if (!socket || !socket.connected) {
            logger.debug(`Cannot emit ${event}: socket not connected`);
            return false;
        }
        socket.emit(event, data);
        return true;
    } catch (error) {
        logger.error(`Failed to emit ${event}: ${(error as Error).message}`);
        return false;
    }
}

module.exports = {
    emitWithRetry,
    emitWithTimeout,
    emitToRoomWithLogging,
    safeEmit,
    DEFAULT_RETRY_OPTIONS
};

export {
    emitWithRetry,
    emitWithTimeout,
    emitToRoomWithLogging,
    safeEmit,
    DEFAULT_RETRY_OPTIONS
};
