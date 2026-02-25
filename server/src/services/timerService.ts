import type { RedisClient } from '../types';

import { getRedis } from '../config/redis';
import logger from '../utils/logger';
import { withTimeout, TIMEOUTS } from '../utils/timeout';
import { TIMER, REDIS_TTL } from '../config/constants';
import { tryParseJSON } from '../utils/parseJSON';
import { ValidationError } from '../errors/GameError';
import { ATOMIC_ADD_TIME_SCRIPT, ATOMIC_TIMER_STATUS_SCRIPT } from '../scripts';
import { z } from 'zod';

// Zod schema for runtime validation of timer state from Redis.
// Makes instanceId optional to handle data from older server versions or tests.
const timerStateSchema = z.object({
    roomCode: z.string(),
    startTime: z.number(),
    endTime: z.number(),
    duration: z.number(),
    instanceId: z.string().optional(),
    paused: z.boolean().optional(),
    remainingWhenPaused: z.number().optional(),
    pausedAt: z.number().optional()
});

// Zod schema for Lua script addTime result
const addTimeResultSchema = z.object({
    endTime: z.number(),
    duration: z.number(),
    remainingSeconds: z.number()
});

// Zod schema for atomic timer status Lua script result
const timerStatusSchema = z.object({
    startTime: z.number(),
    endTime: z.number(),
    duration: z.number(),
    remainingSeconds: z.number(),
    expired: z.boolean(),
    isPaused: z.boolean()
});

/**
 * Timer state stored in Redis
 */
export interface TimerState {
    roomCode: string;
    startTime: number;
    endTime: number;
    duration: number;
    instanceId: string;
    paused?: boolean;
    remainingWhenPaused?: number;
    pausedAt?: number;
}

/**
 * Local timer data (extends Redis state with timeout info)
 */
interface LocalTimerData extends TimerState {
    timeoutId: ReturnType<typeof setTimeout>;
    onExpire?: TimerExpireCallback;
}

/**
 * Timer status returned to clients
 */
export interface TimerStatus {
    startTime: number;
    endTime: number;
    duration: number;
    remainingSeconds: number;
    expired: boolean;
    isPaused: boolean;
}

/**
 * Timer info returned from start/add operations
 */
export interface TimerInfo {
    startTime?: number;
    endTime: number;
    duration: number;
    remainingSeconds: number;
}

/**
 * Pause result
 */
export interface PauseResult {
    remainingSeconds: number;
}

/**
 * Callback type for timer expiration
 */
export type TimerExpireCallback = (roomCode: string) => void | Promise<void>;

// RedisClient imported from '../types' (shared across all services)

// Local timers for this instance
const localTimers = new Map<string, LocalTimerData>();

// Use centralized constants
const TIMER_TTL_BUFFER: number = TIMER.TIMER_TTL_BUFFER_SECONDS;

// Redis key prefixes
const TIMER_KEY_PREFIX = 'timer:';

/**
 * Creates a timer expiration callback function
 */
function createTimerExpirationCallback(
    roomCode: string,
    onExpire?: TimerExpireCallback
): () => Promise<void> {
    return async (): Promise<void> => {
        try {
            const redis: RedisClient = getRedis();
            logger.info(`Timer expired for room ${roomCode}`);
            localTimers.delete(roomCode);

            // Remove from Redis
            await withTimeout(
                redis.del(`${TIMER_KEY_PREFIX}${roomCode}`),
                TIMEOUTS.TIMER_OPERATION,
                `timerExpired-del-${roomCode}`
            );

            // Call user callback if provided
            if (onExpire) {
                try {
                    await onExpire(roomCode);
                } catch (callbackError) {
                    logger.error(`Error in timer expire callback for room ${roomCode}:`, callbackError);
                }
            }
        } catch (error) {
            logger.error(`Error handling timer expiration for room ${roomCode}:`, error);
        }
    };
}

/**
 * Start a turn timer for a room
 */
export async function startTimer(
    roomCode: string,
    durationSeconds: number,
    onExpire?: TimerExpireCallback
): Promise<TimerInfo> {
    const redis: RedisClient = getRedis();

    // Validate duration bounds (consistent with addTime validation)
    if (typeof durationSeconds !== 'number' || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
        throw new ValidationError('Invalid duration: must be a positive number');
    }
    if (durationSeconds > TIMER.MAX_TURN_SECONDS) {
        throw new ValidationError(`Invalid duration: cannot exceed ${TIMER.MAX_TURN_SECONDS} seconds`);
    }

    // Clear any existing timer
    await stopTimer(roomCode);

    const startTime = Date.now();
    const endTime = startTime + (durationSeconds * 1000);

    // Store timer state in Redis
    const timerData: TimerState = {
        roomCode,
        startTime,
        endTime,
        duration: durationSeconds,
        instanceId: process.pid.toString()
    };

    await withTimeout(
        redis.set(
            `${TIMER_KEY_PREFIX}${roomCode}`,
            JSON.stringify(timerData),
            { EX: durationSeconds + TIMER_TTL_BUFFER } // TTL slightly longer than timer duration
        ),
        TIMEOUTS.TIMER_OPERATION,
        `startTimer-set-${roomCode}`
    );

    // Set up local timeout using shared expiration callback
    const timeoutId = setTimeout(
        createTimerExpirationCallback(roomCode, onExpire),
        durationSeconds * 1000
    );

    localTimers.set(roomCode, {
        ...timerData,
        timeoutId,
        onExpire
    });

    logger.info(`Timer started for room ${roomCode}: ${durationSeconds}s`);

    return {
        startTime,
        endTime,
        duration: durationSeconds,
        remainingSeconds: durationSeconds
    };
}

/**
 * Stop timer for a room
 */
export async function stopTimer(roomCode: string): Promise<void> {
    const redis: RedisClient = getRedis();

    // Clear local timer
    const timer = localTimers.get(roomCode);
    if (timer) {
        clearTimeout(timer.timeoutId);
        localTimers.delete(roomCode);
    }

    // Remove from Redis
    await withTimeout(
        redis.del(`${TIMER_KEY_PREFIX}${roomCode}`),
        TIMEOUTS.TIMER_OPERATION,
        `stopTimer-del-${roomCode}`
    );

    logger.info(`Timer stopped for room ${roomCode}`);
}

/**
 * Get remaining time for a room's timer
 */
export async function getTimerStatus(roomCode: string): Promise<TimerStatus | null> {
    const redis: RedisClient = getRedis();

    // Atomic Lua script: reads timer state and checks for expiration in one operation.
    // Prevents TOCTOU race in multi-instance deployments where another instance
    // could modify the timer between our GET and our expiration check.
    const result = await withTimeout(
        redis.eval(ATOMIC_TIMER_STATUS_SCRIPT, {
            keys: [`${TIMER_KEY_PREFIX}${roomCode}`],
            arguments: [Date.now().toString()]
        }),
        TIMEOUTS.TIMER_OPERATION,
        `getTimerStatus-lua-${roomCode}`
    ) as string | null;

    if (!result) {
        return null;
    }

    // Timer expired while paused — Lua script already cleaned it up
    if (result === 'EXPIRED') {
        localTimers.delete(roomCode);
        return null;
    }

    try {
        const status = tryParseJSON(result, timerStatusSchema, `timer status for ${roomCode}`);
        return status;
    } catch (e) {
        logger.warn(`Failed to parse timer status for ${roomCode}:`, (e as Error).message);
        return null;
    }
}

/**
 * Pause timer for a room (stores remaining time)
 */
export async function pauseTimer(roomCode: string): Promise<PauseResult | null> {
    const status = await getTimerStatus(roomCode);
    if (!status || status.expired) {
        return null;
    }

    let remainingSeconds = status.remainingSeconds;

    // Clamp to valid range: must be finite and non-negative
    if (!Number.isFinite(remainingSeconds) || remainingSeconds < 0) {
        logger.warn(`Invalid remainingSeconds ${remainingSeconds} in pauseTimer for ${roomCode}, clamping to 0`);
        remainingSeconds = 0;
    }

    // Stop the timer but remember the remaining time
    const redis: RedisClient = getRedis();
    const timerData = await withTimeout(
        redis.get(`${TIMER_KEY_PREFIX}${roomCode}`),
        TIMEOUTS.TIMER_OPERATION,
        `pauseTimer-get-${roomCode}`
    );
    if (timerData) {
        try {
            const timer = tryParseJSON(timerData, timerStateSchema, `timer pause for ${roomCode}`);
            if (!timer) return null;
            timer.paused = true;
            timer.remainingWhenPaused = remainingSeconds;
            // Store when the timer was paused to detect expiration while paused
            timer.pausedAt = Date.now();
            await withTimeout(
                redis.set(`${TIMER_KEY_PREFIX}${roomCode}`, JSON.stringify(timer), { EX: REDIS_TTL.PAUSED_TIMER }),
                TIMEOUTS.TIMER_OPERATION,
                `pauseTimer-set-${roomCode}`
            );
        } catch (e) {
            logger.error(`Failed to parse timer data for ${roomCode}:`, (e as Error).message);
            return null;
        }
    }

    // Clear local timeout
    const localTimer = localTimers.get(roomCode);
    if (localTimer) {
        clearTimeout(localTimer.timeoutId);
        localTimer.paused = true;
        localTimer.remainingWhenPaused = remainingSeconds;
    }

    logger.info(`Timer paused for room ${roomCode}: ${remainingSeconds}s remaining`);
    return { remainingSeconds };
}

/**
 * Resume a paused timer
 */
export async function resumeTimer(
    roomCode: string,
    onExpire?: TimerExpireCallback
): Promise<TimerInfo | null> {
    const redis: RedisClient = getRedis();

    const timerData = await withTimeout(
        redis.get(`${TIMER_KEY_PREFIX}${roomCode}`),
        TIMEOUTS.TIMER_OPERATION,
        `resumeTimer-get-${roomCode}`
    );

    if (!timerData) {
        return null;
    }

    try {
        const timer = tryParseJSON(timerData, timerStateSchema, `timer resume for ${roomCode}`);
        if (!timer) return null;
        if (!timer.paused) {
            return null;
        }

        const remainingSeconds = timer.remainingWhenPaused;

        // Validate that timer wouldn't have expired while paused
        // If the timer was paused for longer than the remaining time, it should
        // be considered expired rather than starting fresh.
        // NOTE: We do NOT subtract pause duration from remaining time because
        // pausing is meant to preserve the remaining time (e.g., for breaks).
        // Only check if the timer WOULD have expired during the pause period.
        if (timer.pausedAt && remainingSeconds !== undefined) {
            const pausedDuration = Date.now() - timer.pausedAt;
            const remainingWhenPausedMs = remainingSeconds * 1000;

            if (pausedDuration >= remainingWhenPausedMs) {
                logger.info(`Timer for room ${roomCode} would have expired while paused (paused for ${Math.round(pausedDuration/1000)}s, had ${remainingSeconds}s remaining), treating as expired`);
                // Clean up the expired timer
                await withTimeout(
                    redis.del(`${TIMER_KEY_PREFIX}${roomCode}`),
                    TIMEOUTS.TIMER_OPERATION,
                    `resumeTimer-del-expired-${roomCode}`
                );
                localTimers.delete(roomCode);

                // Call expire callback if provided
                if (onExpire) {
                    try {
                        await onExpire(roomCode);
                    } catch (callbackError) {
                        logger.error(`Error in timer expire callback for room ${roomCode}:`, callbackError);
                    }
                }
                return null;
            }
        }

        // Resume with the original remaining time (pausing preserves time)
        if (remainingSeconds === undefined || !Number.isFinite(remainingSeconds) || remainingSeconds <= 0) {
            logger.warn(`Invalid remainingSeconds ${remainingSeconds} in resumeTimer for ${roomCode}, treating as expired`);
            return null;
        }
        return await startTimer(roomCode, remainingSeconds, onExpire);
    } catch (err) {
        logger.error(`resumeTimer failed for room ${roomCode}:`, err instanceof Error ? err.message : String(err));
        return null;
    }
}

/**
 * Add time to an active timer (atomic operation)
 */

export async function addTime(
    roomCode: string,
    secondsToAdd: number,
    onExpire?: TimerExpireCallback
): Promise<TimerInfo | null> {
    // Validate parameters
    if (!roomCode || typeof roomCode !== 'string') {
        throw new ValidationError('Invalid roomCode: must be a non-empty string');
    }
    if (typeof secondsToAdd !== 'number' || !Number.isFinite(secondsToAdd) || secondsToAdd <= 0) {
        throw new ValidationError('Invalid secondsToAdd: must be a positive number');
    }
    // Add upper bound to prevent excessive time additions
    if (secondsToAdd > TIMER.MAX_TURN_SECONDS) {
        throw new ValidationError(`Invalid secondsToAdd: cannot exceed ${TIMER.MAX_TURN_SECONDS} seconds`);
    }

    return addTimeLocal(roomCode, secondsToAdd, onExpire);
}

/**
 * Add time to a timer locally (internal implementation)
 */
async function addTimeLocal(
    roomCode: string,
    secondsToAdd: number,
    onExpire?: TimerExpireCallback
): Promise<TimerInfo | null> {
    const redis: RedisClient = getRedis();

    // Atomically add time to prevent race conditions
    const result = await withTimeout(
        redis.eval(
            ATOMIC_ADD_TIME_SCRIPT,
            {
                keys: [`${TIMER_KEY_PREFIX}${roomCode}`],
                arguments: [secondsToAdd.toString(), process.pid.toString(), Date.now().toString(), TIMER_TTL_BUFFER.toString()]
            }
        ),
        TIMEOUTS.TIMER_OPERATION,
        `addTimeLocal-lua-${roomCode}`
    ) as string | null;

    if (!result) {
        return null;
    }

    try {
        const newTimer = tryParseJSON(result, addTimeResultSchema, `addTime result for ${roomCode}`);
        if (!newTimer) return null;

        // Update local timer if we own it
        const localTimer = localTimers.get(roomCode);
        if (localTimer) {
            // Clear existing timeout and create new one using shared expiration callback
            clearTimeout(localTimer.timeoutId);

            const timeoutId = setTimeout(
                createTimerExpirationCallback(roomCode, onExpire),
                newTimer.remainingSeconds * 1000
            );

            localTimers.set(roomCode, {
                ...localTimer,
                endTime: newTimer.endTime,
                duration: newTimer.duration,
                timeoutId,
                onExpire
            });
        }

        logger.info(`Added ${secondsToAdd}s to timer for room ${roomCode}, new remaining: ${newTimer.remainingSeconds}s`);

        return {
            endTime: newTimer.endTime,
            duration: newTimer.duration,
            remainingSeconds: newTimer.remainingSeconds
        };
    } catch (e) {
        logger.error(`Error parsing addTime result for room ${roomCode}:`, e);
        return null;
    }
}

/**
 * Check if a room has an active timer
 */
export async function hasActiveTimer(roomCode: string): Promise<boolean> {
    const status = await getTimerStatus(roomCode);
    return status !== null && !status.expired;
}

/**
 * Remove stale entries from the localTimers map.
 *
 * A timer is considered stale if its endTime has passed (plus a generous
 * buffer) and it wasn't cleaned up by its expiration callback. This can
 * happen if the callback threw or Redis deleted the key before the local
 * timeout fired.
 *
 * Called periodically from the socket module's cleanup interval.
 */
export function sweepStaleTimers(): number {
    const now = Date.now();
    // 2-minute buffer beyond endTime before considering stale
    const STALE_BUFFER_MS = 2 * 60 * 1000;
    let swept = 0;

    for (const [roomCode, timer] of localTimers) {
        // Skip paused timers — they legitimately have old endTimes
        if (timer.paused) continue;

        if (timer.endTime + STALE_BUFFER_MS < now) {
            clearTimeout(timer.timeoutId);
            localTimers.delete(roomCode);
            swept++;
        }
    }

    if (swept > 0) {
        logger.info(`Swept ${swept} stale timer entries, ${localTimers.size} remaining`);
    }

    return swept;
}

/**
 * Clean up all timers (for shutdown)
 */
export function cleanupAllTimers(): void {
    // Clear local timers
    for (const [_roomCode, timer] of localTimers) {
        clearTimeout(timer.timeoutId);
    }
    localTimers.clear();

    logger.info('All local timers cleaned up');
}

