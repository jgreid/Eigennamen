/**
 * Timer Service - Turn timer management with Redis backing
 *
 * Single-instance architecture:
 * - Timer state is stored in Redis for persistence
 * - Local timeouts handle expiration
 */

const { getRedis } = require('../config/redis');
const logger = require('../utils/logger');
const { withTimeout, TIMEOUTS } = require('../utils/timeout');
const { TIMER, REDIS_TTL } = require('../config/constants');

// Local timers for this instance
const localTimers = new Map();

// Global timer expire callback (set via initializeTimerService)
let _globalExpireCallback = null;

// Use centralized constants
const TIMER_TTL_BUFFER = TIMER.TIMER_TTL_BUFFER_SECONDS;

// Redis key prefixes
const TIMER_KEY_PREFIX = 'timer:';

/**
 * Lua script for atomic addTime operation
 * Reads current timer, calculates new duration, and updates atomically
 * Returns: new end time if successful, nil if timer doesn't exist or is expired
 */
const ATOMIC_ADD_TIME_SCRIPT = `
local timerKey = KEYS[1]
local secondsToAdd = tonumber(ARGV[1])
local instanceId = ARGV[2]

local timerData = redis.call('GET', timerKey)
if not timerData then
    return nil
end

local timer = cjson.decode(timerData)
if timer.paused then
    return nil
end

local now = tonumber(ARGV[3])
local remainingMs = timer.endTime - now
if remainingMs <= 0 then
    return nil
end

-- FIX: Get TTL buffer from arguments instead of hardcoding
local ttlBuffer = tonumber(ARGV[4]) or 60

-- Calculate new end time
local newEndTime = timer.endTime + (secondsToAdd * 1000)
local newDuration = math.ceil((newEndTime - now) / 1000)

-- Update timer
timer.endTime = newEndTime
timer.duration = newDuration
timer.instanceId = instanceId

-- Calculate new TTL (duration + buffer from constant)
local newTtl = newDuration + ttlBuffer

redis.call('SET', timerKey, cjson.encode(timer), 'EX', newTtl)
return cjson.encode({endTime = newEndTime, duration = newDuration, remainingSeconds = newDuration})
`;

/**
 * Creates a timer expiration callback function
 * @param {string} roomCode - Room code
 * @param {Function} onExpire - User-provided callback
 * @returns {Function} Async callback for setTimeout
 */
function createTimerExpirationCallback(roomCode, onExpire) {
    return async () => {
        try {
            const redis = getRedis();
            logger.info(`Timer expired for room ${roomCode}`);
            localTimers.delete(roomCode);

            // Remove from Redis
            await redis.del(`${TIMER_KEY_PREFIX}${roomCode}`);

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
 * @param {string} roomCode - Room code
 * @param {number} durationSeconds - Timer duration in seconds
 * @param {Function} onExpire - Callback when timer expires
 * @returns {Object} Timer info
 */
async function startTimer(roomCode, durationSeconds, onExpire) {
    const redis = getRedis();

    // Clear any existing timer
    await stopTimer(roomCode);

    const startTime = Date.now();
    const endTime = startTime + (durationSeconds * 1000);

    // Store timer state in Redis
    const timerData = {
        roomCode,
        startTime,
        endTime,
        duration: durationSeconds,
        instanceId: process.pid.toString()
    };

    await redis.set(
        `${TIMER_KEY_PREFIX}${roomCode}`,
        JSON.stringify(timerData),
        { EX: durationSeconds + TIMER_TTL_BUFFER } // TTL slightly longer than timer duration
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
 * @param {string} roomCode - Room code
 */
async function stopTimer(roomCode) {
    const redis = getRedis();

    // Clear local timer
    const timer = localTimers.get(roomCode);
    if (timer) {
        clearTimeout(timer.timeoutId);
        localTimers.delete(roomCode);
    }

    // Remove from Redis
    await redis.del(`${TIMER_KEY_PREFIX}${roomCode}`);

    logger.info(`Timer stopped for room ${roomCode}`);
}

/**
 * Get remaining time for a room's timer
 * @param {string} roomCode - Room code
 * @returns {Object|null} Timer status or null if no timer
 */
async function getTimerStatus(roomCode) {
    const redis = getRedis();

    // Check Redis for timer state
    const timerData = await redis.get(`${TIMER_KEY_PREFIX}${roomCode}`);
    if (!timerData) {
        return null;
    }

    try {
        const timer = JSON.parse(timerData);
        const now = Date.now();

        // FIX M9: Account for paused state in timer status
        // When paused, return the stored remaining time instead of calculating from endTime
        if (timer.paused && timer.remainingWhenPaused !== undefined) {
            return {
                startTime: timer.startTime,
                endTime: timer.endTime,
                duration: timer.duration,
                remainingSeconds: timer.remainingWhenPaused,
                expired: false,
                isPaused: true
            };
        }

        const remainingMs = timer.endTime - now;
        const expired = remainingMs <= 0;
        // If expired, remainingSeconds should be 0, not 1 from Math.ceil
        const remainingSeconds = expired ? 0 : Math.ceil(remainingMs / 1000);

        return {
            startTime: timer.startTime,
            endTime: timer.endTime,
            duration: timer.duration,
            remainingSeconds,
            expired,
            isPaused: false
        };
    } catch (e) {
        logger.warn(`Failed to parse timer data for ${roomCode}:`, e.message);
        return null;
    }
}

/**
 * Pause timer for a room (stores remaining time)
 * @param {string} roomCode - Room code
 * @returns {Object|null} Object with remainingSeconds or null
 */
async function pauseTimer(roomCode) {
    const status = await getTimerStatus(roomCode);
    if (!status || status.expired) {
        return null;
    }

    const remainingSeconds = status.remainingSeconds;

    // Stop the timer but remember the remaining time
    const redis = getRedis();
    const timerData = await redis.get(`${TIMER_KEY_PREFIX}${roomCode}`);
    if (timerData) {
        try {
            const timer = JSON.parse(timerData);
            timer.paused = true;
            timer.remainingWhenPaused = remainingSeconds;
            // HARDENING FIX: Store when the timer was paused to detect expiration while paused
            timer.pausedAt = Date.now();
            await redis.set(`${TIMER_KEY_PREFIX}${roomCode}`, JSON.stringify(timer), { EX: REDIS_TTL.PAUSED_TIMER });
        } catch (e) {
            logger.error(`Failed to parse timer data for ${roomCode}:`, e.message);
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
 * @param {string} roomCode - Room code
 * @param {Function} onExpire - Callback when timer expires
 * @returns {Object|null} Timer info or null
 */
async function resumeTimer(roomCode, onExpire) {
    const redis = getRedis();

    const timerData = await redis.get(`${TIMER_KEY_PREFIX}${roomCode}`);

    if (!timerData) {
        return null;
    }

    try {
        const timer = JSON.parse(timerData);
        if (!timer.paused) {
            return null;
        }

        const remainingSeconds = timer.remainingWhenPaused;

        // HARDENING FIX: Validate that timer wouldn't have expired while paused
        // If the timer was paused for longer than the remaining time, it should
        // be considered expired rather than starting fresh.
        // NOTE: We do NOT subtract pause duration from remaining time because
        // pausing is meant to preserve the remaining time (e.g., for breaks).
        // Only check if the timer WOULD have expired during the pause period.
        if (timer.pausedAt) {
            const pausedDuration = Date.now() - timer.pausedAt;
            const remainingWhenPausedMs = remainingSeconds * 1000;

            if (pausedDuration >= remainingWhenPausedMs) {
                logger.info(`Timer for room ${roomCode} would have expired while paused (paused for ${Math.round(pausedDuration/1000)}s, had ${remainingSeconds}s remaining), treating as expired`);
                // Clean up the expired timer
                await redis.del(`${TIMER_KEY_PREFIX}${roomCode}`);
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
        return await startTimer(roomCode, remainingSeconds, onExpire);
    } catch {
        return null;
    }
}

/**
 * Add time to an active timer (atomic operation)
 * @param {string} roomCode - Room code
 * @param {number} secondsToAdd - Seconds to add
 * @param {Function} onExpire - Callback when timer expires
 * @returns {Object|null} Updated timer info or null
 */
// eslint-disable-next-line require-await -- callers await this; delegates to async addTimeLocal
async function addTime(roomCode, secondsToAdd, onExpire) {
    // Validate parameters
    if (!roomCode || typeof roomCode !== 'string') {
        throw new Error('Invalid roomCode: must be a non-empty string');
    }
    if (typeof secondsToAdd !== 'number' || !Number.isFinite(secondsToAdd) || secondsToAdd <= 0) {
        throw new Error('Invalid secondsToAdd: must be a positive number');
    }
    // SECURITY FIX: Add upper bound to prevent excessive time additions
    if (secondsToAdd > TIMER.MAX_TURN_SECONDS) {
        throw new Error(`Invalid secondsToAdd: cannot exceed ${TIMER.MAX_TURN_SECONDS} seconds`);
    }

    return addTimeLocal(roomCode, secondsToAdd, onExpire);
}

/**
 * Add time to a timer locally (internal implementation)
 */
async function addTimeLocal(roomCode, secondsToAdd, onExpire) {
    const redis = getRedis();

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
    );

    if (!result) {
        return null;
    }

    try {
        const newTimer = JSON.parse(result);

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
 * @param {string} roomCode - Room code
 * @returns {boolean}
 */
async function hasActiveTimer(roomCode) {
    const status = await getTimerStatus(roomCode);
    return status !== null && !status.expired;
}

/**
 * Clean up all timers (for shutdown)
 */
function cleanupAllTimers() {
    // Clear local timers
    for (const [_roomCode, timer] of localTimers) {
        clearTimeout(timer.timeoutId);
    }
    localTimers.clear();

    logger.info('All local timers cleaned up');
}

/**
 * Initialize the timer service with a global expire callback.
 * @param {Function} callback - Called with (roomCode) when any timer expires
 */
function initializeTimerService(callback) {
    _globalExpireCallback = callback;
    logger.info('Timer service initialized with expire callback');
    return true;
}

module.exports = {
    startTimer,
    stopTimer,
    getTimerStatus,
    pauseTimer,
    resumeTimer,
    addTime,
    hasActiveTimer,
    cleanupAllTimers,
    initializeTimerService
};
