import type { RedisClient } from '../types';

import { getRedis } from '../config/redis';
import logger from '../utils/logger';
import { withTimeout, TIMEOUTS } from '../utils/timeout';
import { TIMER, REDIS_TTL } from '../config/constants';
import { tryParseJSON } from '../utils/parseJSON';
import { ValidationError } from '../errors/GameError';
import { withLock } from '../utils/distributedLock';
import {
    ATOMIC_ADD_TIME_SCRIPT,
    ATOMIC_TIMER_STATUS_SCRIPT,
    ATOMIC_RESUME_TIMER_SCRIPT,
    ATOMIC_PAUSE_TIMER_SCRIPT,
} from '../scripts';
import { setGauge, incrementCounter, METRIC_NAMES } from '../utils/metrics';
import { z } from 'zod';

// Zod schema for Lua script addTime result
const addTimeResultSchema = z.object({
    endTime: z.number(),
    duration: z.number(),
    remainingSeconds: z.number(),
});

// Zod schema for atomic resume timer Lua script result
const resumeTimerResultSchema = z.object({
    expired: z.boolean(),
    remainingSeconds: z.number().optional(),
    pausedFor: z.number().optional(),
    hadRemaining: z.number().optional(),
    error: z.string().optional(),
});

// Zod schema for atomic pause timer Lua script result
const pauseTimerResultSchema = z.object({
    remainingSeconds: z.number().optional(),
    error: z.string().optional(),
});

// Zod schema for atomic timer status Lua script result
const timerStatusSchema = z.object({
    startTime: z.number(),
    endTime: z.number(),
    duration: z.number(),
    remainingSeconds: z.number(),
    expired: z.boolean(),
    isPaused: z.boolean(),
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

// Local timers for this instance.
// Max-size cap prevents unbounded growth if sweeps fall behind under load.
const localTimers = new Map<string, LocalTimerData>();
const LOCAL_TIMERS_MAX_SIZE = 5000;

// Use centralized constants
const TIMER_TTL_BUFFER: number = TIMER.TIMER_TTL_BUFFER_SECONDS;

// Redis key prefixes
const TIMER_KEY_PREFIX = 'timer:';

/**
 * Creates a timer expiration callback function
 */
function createTimerExpirationCallback(roomCode: string, onExpire?: TimerExpireCallback): () => Promise<void> {
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
 * Start a turn timer for a room.
 * Uses a distributed lock to prevent two concurrent startTimer calls
 * from creating duplicate local setTimeout callbacks.
 */
export async function startTimer(
    roomCode: string,
    durationSeconds: number,
    onExpire?: TimerExpireCallback
): Promise<TimerInfo> {
    // Validate duration bounds before acquiring lock
    if (typeof durationSeconds !== 'number' || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
        throw new ValidationError('Invalid duration: must be a positive number');
    }
    if (durationSeconds > TIMER.MAX_TURN_SECONDS) {
        throw new ValidationError(`Invalid duration: cannot exceed ${TIMER.MAX_TURN_SECONDS} seconds`);
    }

    return withLock(
        `timer:${roomCode}`,
        async () => {
            const redis: RedisClient = getRedis();

            // Clear any existing timer
            await stopTimer(roomCode);

            const startTime = Date.now();
            const endTime = startTime + durationSeconds * 1000;

            // Store timer state in Redis
            const timerData: TimerState = {
                roomCode,
                startTime,
                endTime,
                duration: durationSeconds,
                instanceId: process.pid.toString(),
            };

            await withTimeout(
                redis.set(`${TIMER_KEY_PREFIX}${roomCode}`, JSON.stringify(timerData), {
                    EX: durationSeconds + TIMER_TTL_BUFFER,
                }),
                TIMEOUTS.TIMER_OPERATION,
                `startTimer-set-${roomCode}`
            );

            // Set up local timeout using shared expiration callback
            const timeoutId = setTimeout(createTimerExpirationCallback(roomCode, onExpire), durationSeconds * 1000);

            // Evict entries with earliest endTimes if map exceeds max size
            // Batch eviction (10%) prevents rapid growth from outpacing single-entry eviction
            if (localTimers.size >= LOCAL_TIMERS_MAX_SIZE) {
                const evictCount = Math.max(1, Math.floor(LOCAL_TIMERS_MAX_SIZE * 0.1));
                const entries = Array.from(localTimers.entries()).sort((a, b) => a[1].endTime - b[1].endTime);
                for (let i = 0; i < evictCount && i < entries.length; i++) {
                    const entry = entries[i];
                    if (!entry) continue;
                    const [key, timer] = entry;
                    clearTimeout(timer.timeoutId);
                    localTimers.delete(key);
                }
                logger.warn(
                    `Local timer map at capacity (${LOCAL_TIMERS_MAX_SIZE}), evicted ${evictCount} earliest-ending entries`
                );
            }

            localTimers.set(roomCode, {
                ...timerData,
                timeoutId,
                onExpire,
            });

            logger.info(`Timer started for room ${roomCode}: ${durationSeconds}s`);

            return {
                startTime,
                endTime,
                duration: durationSeconds,
                remainingSeconds: durationSeconds,
            };
        },
        { lockTimeout: 3000, maxRetries: 5 }
    );
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
    const result = (await withTimeout(
        redis.eval(ATOMIC_TIMER_STATUS_SCRIPT, {
            keys: [`${TIMER_KEY_PREFIX}${roomCode}`],
            arguments: [Date.now().toString()],
        }),
        TIMEOUTS.TIMER_OPERATION,
        `getTimerStatus-lua-${roomCode}`
    )) as string | null;

    if (!result) {
        return null;
    }

    // Corrupted timer data — log and treat as missing
    if (result === 'CORRUPTED_DATA') {
        logger.error(`Corrupted timer data detected in Redis for room ${roomCode}`);
        localTimers.delete(roomCode);
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
 * Uses atomic Lua script to prevent TOCTOU race between reading timer state
 * and writing the paused state — matches the atomic pattern used by resumeTimer and addTime.
 */
export async function pauseTimer(roomCode: string): Promise<PauseResult | null> {
    const redis: RedisClient = getRedis();

    try {
        const resultStr = (await withTimeout(
            redis.eval(ATOMIC_PAUSE_TIMER_SCRIPT, {
                keys: [`${TIMER_KEY_PREFIX}${roomCode}`],
                arguments: [Date.now().toString(), REDIS_TTL.PAUSED_TIMER.toString()],
            }),
            TIMEOUTS.TIMER_OPERATION,
            `pauseTimer-lua-${roomCode}`
        )) as string | null;

        if (!resultStr) {
            return null; // No timer exists
        }

        const result = tryParseJSON(resultStr, pauseTimerResultSchema, `timer pause for ${roomCode}`);
        if (!result) return null;

        if (result.error) {
            if (result.error === 'EXPIRED' || result.error === 'ALREADY_PAUSED') {
                return null;
            }
            logger.warn(`pauseTimer Lua error for ${roomCode}: ${result.error}`);
            return null;
        }

        const remainingSeconds = result.remainingSeconds;
        if (remainingSeconds === undefined || !Number.isFinite(remainingSeconds) || remainingSeconds < 0) {
            logger.warn(`Invalid remainingSeconds ${remainingSeconds} in pauseTimer for ${roomCode}`);
            return null;
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
    } catch (err) {
        logger.error(`pauseTimer failed for room ${roomCode}:`, err instanceof Error ? err.message : String(err));
        return null;
    }
}

/**
 * Resume a paused timer
 */
export async function resumeTimer(roomCode: string, onExpire?: TimerExpireCallback): Promise<TimerInfo | null> {
    const redis: RedisClient = getRedis();

    try {
        // Atomic Lua script: checks if paused timer expired, deletes if so.
        // Eliminates race window between checking pause duration and deleting the timer.
        const resultStr = await withTimeout(
            redis.eval(ATOMIC_RESUME_TIMER_SCRIPT, {
                keys: [`${TIMER_KEY_PREFIX}${roomCode}`],
                arguments: [Date.now().toString()],
            }),
            TIMEOUTS.TIMER_OPERATION,
            `resumeTimer-lua-${roomCode}`
        );

        if (!resultStr) {
            return null; // No timer exists
        }

        const result = tryParseJSON(String(resultStr), resumeTimerResultSchema, `timer resume for ${roomCode}`);
        if (!result) return null;

        if (result.error) {
            if (result.error === 'NOT_PAUSED') return null;
            logger.warn(`resumeTimer Lua error for ${roomCode}: ${result.error}`);
            return null;
        }

        if (result.expired) {
            logger.info(
                `Timer for room ${roomCode} expired while paused (paused for ${Math.round((result.pausedFor || 0) / 1000)}s, had ${Math.round((result.hadRemaining || 0) / 1000)}s remaining), treating as expired`
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

        // Resume with the original remaining time (pausing preserves time)
        const remainingSeconds = result.remainingSeconds;
        if (remainingSeconds === undefined || !Number.isFinite(remainingSeconds) || remainingSeconds <= 0) {
            logger.warn(
                `Invalid remainingSeconds ${remainingSeconds} in resumeTimer for ${roomCode}, treating as expired`
            );
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
    const result = (await withTimeout(
        redis.eval(ATOMIC_ADD_TIME_SCRIPT, {
            keys: [`${TIMER_KEY_PREFIX}${roomCode}`],
            arguments: [
                secondsToAdd.toString(),
                process.pid.toString(),
                Date.now().toString(),
                TIMER_TTL_BUFFER.toString(),
            ],
        }),
        TIMEOUTS.TIMER_OPERATION,
        `addTimeLocal-lua-${roomCode}`
    )) as string | null;

    if (!result) {
        return null;
    }

    if (result === 'CORRUPTED_DATA') {
        logger.error(`Corrupted timer data detected during addTime for room ${roomCode}`);
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
                onExpire,
            });
        }

        logger.info(
            `Added ${secondsToAdd}s to timer for room ${roomCode}, new remaining: ${newTimer.remainingSeconds}s`
        );

        return {
            endTime: newTimer.endTime,
            duration: newTimer.duration,
            remainingSeconds: newTimer.remainingSeconds,
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
        incrementCounter(METRIC_NAMES.TIMER_SWEEP_ORPHANS, swept);
    }

    setGauge(METRIC_NAMES.ACTIVE_TIMERS, localTimers.size);

    return swept;
}

/**
 * Get the current count of active local timers (for health/metrics reporting)
 */
export function getActiveTimerCount(): number {
    return localTimers.size;
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
