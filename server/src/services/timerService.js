/**
 * Timer Service - Turn timer management with Redis backing for horizontal scaling
 *
 * Architecture:
 * - Timer state is stored in Redis for persistence across instances
 * - Local timeouts handle expiration on the instance that started the timer
 * - Redis pub/sub coordinates timer events across instances
 * - Polling checks for orphaned timers when instances crash
 */

const { getRedis, getPubSubClients } = require('../config/redis');
const logger = require('../utils/logger');
const { TIMER, REDIS_TTL } = require('../config/constants');

// Local timers for this instance
const localTimers = new Map();

// Use centralized constants
const ORPHAN_CHECK_INTERVAL = TIMER.ORPHAN_CHECK_INTERVAL_MS;
const ORPHAN_CHECK_TIMEOUT = TIMER.ORPHAN_CHECK_TIMEOUT_MS;
const MAX_ORPHAN_KEYS = TIMER.MAX_ORPHAN_KEYS;
const TIMER_TTL_BUFFER = TIMER.TIMER_TTL_BUFFER_SECONDS;

let orphanCheckInterval = null;

// Redis key prefixes
const TIMER_KEY_PREFIX = 'timer:';
const TIMER_CHANNEL = 'timer:events';

/**
 * Lua script for atomic timer claim (prevents duplicate expiration handling)
 * Returns: timer data if claimed, nil if already claimed/expired by another instance
 */
const ATOMIC_TIMER_CLAIM_SCRIPT = `
local timerKey = KEYS[1]
local instanceId = ARGV[1]

-- Get the timer data
local timerData = redis.call('GET', timerKey)
if not timerData then
    return nil
end

-- Parse and check if already being handled
local timer = cjson.decode(timerData)
if timer.claimed then
    return nil
end

-- Mark as claimed by this instance and delete (atomic)
redis.call('DEL', timerKey)
return timerData
`;

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

-- Calculate new end time
local newEndTime = timer.endTime + (secondsToAdd * 1000)
local newDuration = math.ceil((newEndTime - now) / 1000)

-- Update timer
timer.endTime = newEndTime
timer.duration = newDuration
timer.instanceId = instanceId

-- Calculate new TTL (duration + 60 seconds buffer)
local newTtl = newDuration + 60

redis.call('SET', timerKey, cjson.encode(timer), 'EX', newTtl)
return cjson.encode({endTime = newEndTime, duration = newDuration, remainingSeconds = newDuration})
`;

/**
 * Initialize timer service with Redis pub/sub
 * Includes retry logic for pub/sub subscription
 * Call this on server startup
 */
async function initializeTimerService(onExpireCallback, maxRetries = 3) {
    let retries = 0;

    const attemptSubscription = async () => {
        try {
            const { subClient } = getPubSubClients();

            // Subscribe to timer events for coordination across instances
            await subClient.subscribe(TIMER_CHANNEL, (message) => {
                try {
                    const event = JSON.parse(message);
                    handleTimerEvent(event, onExpireCallback);
                } catch (e) {
                    logger.error('Error handling timer event:', e);
                }
            });

            // Start orphan timer check
            startOrphanCheck(onExpireCallback);

            logger.info('Timer service initialized with Redis backing');
            return true;
        } catch (error) {
            retries++;
            if (retries < maxRetries) {
                logger.warn(`Timer service pub/sub subscription failed (attempt ${retries}/${maxRetries}), retrying in 2s...`);
                await new Promise(resolve => setTimeout(resolve, 2000));
                return attemptSubscription();
            }
            logger.warn('Timer service running in single-instance mode (Redis pub/sub unavailable after retries)');
            // Still start orphan check even without pub/sub - it works locally
            startOrphanCheck(onExpireCallback);
            return false;
        }
    };

    return attemptSubscription();
}

/**
 * Handle timer events from pub/sub
 */
function handleTimerEvent(event, _onExpireCallback) {
    switch (event.type) {
        case 'started':
            // Another instance started a timer - clear any local timer for this room
            if (localTimers.has(event.roomCode)) {
                clearTimeout(localTimers.get(event.roomCode).timeoutId);
                localTimers.delete(event.roomCode);
            }
            break;
        case 'stopped':
            // Another instance stopped a timer
            if (localTimers.has(event.roomCode)) {
                clearTimeout(localTimers.get(event.roomCode).timeoutId);
                localTimers.delete(event.roomCode);
            }
            break;
        case 'paused':
            // ISSUE #30 FIX: Handle pause event from another instance
            // Clear local timer but keep the data marked as paused
            if (localTimers.has(event.roomCode)) {
                const timer = localTimers.get(event.roomCode);
                clearTimeout(timer.timeoutId);
                timer.paused = true;
                timer.remainingWhenPaused = event.remainingSeconds;
                // Don't delete - keep the paused state locally
            }
            break;
        case 'expired':
            // Timer expired on another instance - no action needed
            break;
    }
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

    // Set up local timeout
    const timeoutId = setTimeout(async () => {
        try {
            logger.info(`Timer expired for room ${roomCode}`);
            localTimers.delete(roomCode);

            // Remove from Redis
            await redis.del(`${TIMER_KEY_PREFIX}${roomCode}`);

            // Publish expiration event
            // ISSUE #68 FIX: Log pub/sub failures instead of silent catch
            try {
                const { pubClient } = getPubSubClients();
                await pubClient.publish(TIMER_CHANNEL, JSON.stringify({
                    type: 'expired',
                    roomCode,
                    timestamp: Date.now()
                }));
            } catch (e) {
                logger.warn(`Failed to publish timer expiration event for room ${roomCode}:`, e.message);
            }

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
    }, durationSeconds * 1000);

    localTimers.set(roomCode, {
        ...timerData,
        timeoutId,
        onExpire
    });

    // Publish start event
    // ISSUE #68 FIX: Log pub/sub failures instead of silent catch
    try {
        const { pubClient } = getPubSubClients();
        await pubClient.publish(TIMER_CHANNEL, JSON.stringify({
            type: 'started',
            roomCode,
            endTime,
            duration: durationSeconds,
            timestamp: Date.now()
        }));
    } catch (e) {
        logger.warn(`Failed to publish timer start event for room ${roomCode}:`, e.message);
    }

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

    // Publish stop event
    // ISSUE #68 FIX: Log pub/sub failures instead of silent catch
    try {
        const { pubClient } = getPubSubClients();
        await pubClient.publish(TIMER_CHANNEL, JSON.stringify({
            type: 'stopped',
            roomCode,
            timestamp: Date.now()
        }));
    } catch (e) {
        logger.warn(`Failed to publish timer stop event for room ${roomCode}:`, e.message);
    }

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
        const remainingMs = timer.endTime - now;
        const expired = remainingMs <= 0;
        // If expired, remainingSeconds should be 0, not 1 from Math.ceil
        const remainingSeconds = expired ? 0 : Math.ceil(remainingMs / 1000);

        return {
            startTime: timer.startTime,
            endTime: timer.endTime,
            duration: timer.duration,
            remainingSeconds,
            expired
        };
    } catch (e) {
        return null;
    }
}

/**
 * Pause timer for a room (stores remaining time)
 * @param {string} roomCode - Room code
 * @returns {number|null} Remaining seconds or null
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

    // ISSUE #30 FIX: Publish pause event to all instances
    try {
        const { pubClient } = getPubSubClients();
        await pubClient.publish(TIMER_CHANNEL, JSON.stringify({
            type: 'paused',
            roomCode,
            remainingSeconds,
            timestamp: Date.now()
        }));
    } catch (e) {
        // Pub/sub not available - log for observability
        logger.warn(`Failed to publish pause event for room ${roomCode}:`, e.message);
    }

    logger.info(`Timer paused for room ${roomCode}: ${remainingSeconds}s remaining`);
    return remainingSeconds;
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
        return await startTimer(roomCode, remainingSeconds, onExpire);
    } catch (e) {
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
async function addTime(roomCode, secondsToAdd, onExpire) {
    const redis = getRedis();

    // Atomically add time to prevent race conditions
    const result = await redis.eval(
        ATOMIC_ADD_TIME_SCRIPT,
        {
            keys: [`${TIMER_KEY_PREFIX}${roomCode}`],
            arguments: [secondsToAdd.toString(), process.pid.toString(), Date.now().toString()]
        }
    );

    if (!result) {
        return null;
    }

    try {
        const newTimer = JSON.parse(result);

        // Helper to create timeout callback
        const createTimeoutCallback = () => async () => {
            try {
                logger.info(`Timer expired for room ${roomCode}`);
                localTimers.delete(roomCode);
                await redis.del(`${TIMER_KEY_PREFIX}${roomCode}`);

                // ISSUE #68 FIX: Log pub/sub failures instead of silent catch
                try {
                    const { pubClient } = getPubSubClients();
                    await pubClient.publish(TIMER_CHANNEL, JSON.stringify({
                        type: 'expired',
                        roomCode,
                        timestamp: Date.now()
                    }));
                } catch (e) {
                    logger.warn(`Failed to publish timer expiration event for room ${roomCode}:`, e.message);
                }

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

        // Update or create local timer
        const localTimer = localTimers.get(roomCode);
        if (localTimer) {
            // Clear existing timeout and create new one
            clearTimeout(localTimer.timeoutId);

            const timeoutId = setTimeout(createTimeoutCallback(), newTimer.remainingSeconds * 1000);

            localTimers.set(roomCode, {
                ...localTimer,
                endTime: newTimer.endTime,
                duration: newTimer.duration,
                timeoutId,
                onExpire
            });
        } else {
            // No local timer exists - create one to handle the Redis timer
            // This happens when addTime is called on an instance that doesn't own the timer
            logger.info(`Creating local timer for room ${roomCode} (taking ownership via addTime)`);

            const timeoutId = setTimeout(createTimeoutCallback(), newTimer.remainingSeconds * 1000);

            localTimers.set(roomCode, {
                roomCode,
                startTime: Date.now(),
                endTime: newTimer.endTime,
                duration: newTimer.duration,
                instanceId: process.pid.toString(),
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
 * Start periodic check for orphaned timers (timers whose instance crashed)
 */
function startOrphanCheck(onExpireCallback) {
    if (orphanCheckInterval) {
        clearInterval(orphanCheckInterval);
    }

    orphanCheckInterval = setInterval(async () => {
        await checkOrphanedTimers(onExpireCallback);
    }, ORPHAN_CHECK_INTERVAL);
}

/**
 * Check for and recover orphaned timers with timeout protection
 * Uses SCAN instead of KEYS to avoid blocking Redis in production
 */
async function checkOrphanedTimers(onExpireCallback) {
    const startTime = Date.now();

    try {
        const redis = getRedis();
        const keys = [];

        // Use SCAN for non-blocking iteration with timeout protection
        const scanPromise = (async () => {
            for await (const key of redis.scanIterator({
                MATCH: `${TIMER_KEY_PREFIX}*`,
                COUNT: 100
            })) {
                // Check if we've exceeded time or key limit
                if (Date.now() - startTime > ORPHAN_CHECK_TIMEOUT) {
                    logger.warn('Orphan timer check timed out, will continue next interval');
                    break;
                }
                if (keys.length >= MAX_ORPHAN_KEYS) {
                    logger.debug('Orphan timer check reached key limit, will continue next interval');
                    break;
                }
                keys.push(key);
            }
        })();

        // Add overall timeout protection
        await Promise.race([
            scanPromise,
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Scan timeout')), ORPHAN_CHECK_TIMEOUT)
            )
        ]).catch(err => {
            if (err.message === 'Scan timeout') {
                logger.warn('Orphan timer scan timed out');
            } else {
                throw err;
            }
        });

        // Process found keys
        for (const key of keys) {
            // Check timeout for each key processing
            if (Date.now() - startTime > ORPHAN_CHECK_TIMEOUT) {
                break;
            }

            const roomCode = key.replace(TIMER_KEY_PREFIX, '');

            // Skip if we already have a local timer for this room
            if (localTimers.has(roomCode)) {
                continue;
            }

            const timerData = await redis.get(key);
            if (!timerData) continue;

            try {
                const timer = JSON.parse(timerData);

                // Skip paused timers
                if (timer.paused) continue;

                const now = Date.now();
                const remainingMs = timer.endTime - now;

                if (remainingMs <= 0) {
                    // Timer should have expired - atomically claim it to prevent duplicate handling
                    const claimed = await redis.eval(
                        ATOMIC_TIMER_CLAIM_SCRIPT,
                        {
                            keys: [key],
                            arguments: [process.pid.toString()]
                        }
                    );

                    if (claimed) {
                        // We successfully claimed the expired timer
                        logger.info(`Recovering expired orphaned timer for room ${roomCode}`);
                        if (onExpireCallback) {
                            try {
                                await onExpireCallback(roomCode);
                            } catch (callbackError) {
                                logger.error(`Error in timer expire callback for room ${roomCode}:`, callbackError);
                            }
                        }
                    }
                    // If claimed is null, another instance already handled it
                } else if (remainingMs > 0) {
                    // Timer is still active but no local instance is handling it
                    // Take ownership regardless of remaining time to handle long-running timers
                    // (up to MAX_TURN_SECONDS = 300s) from crashed instances
                    logger.info(`Taking ownership of orphaned timer for room ${roomCode} (${Math.ceil(remainingMs / 1000)}s remaining)`);
                    const remainingSeconds = Math.ceil(remainingMs / 1000);
                    await startTimer(roomCode, remainingSeconds, onExpireCallback);
                }
            } catch (e) {
                logger.error(`Error processing orphaned timer ${key}:`, e);
            }
        }

        const duration = Date.now() - startTime;
        if (duration > 1000) {
            logger.debug(`Orphan timer check completed in ${duration}ms, processed ${keys.length} keys`);
        }
    } catch (error) {
        logger.error('Error checking orphaned timers:', error);
    }
}

/**
 * Clean up all timers (for shutdown)
 */
async function cleanupAllTimers() {
    // Clear local timers
    for (const [_roomCode, timer] of localTimers) {
        clearTimeout(timer.timeoutId);
    }
    localTimers.clear();

    // Stop orphan check
    if (orphanCheckInterval) {
        clearInterval(orphanCheckInterval);
        orphanCheckInterval = null;
    }

    logger.info('All local timers cleaned up');
}

/**
 * Shutdown timer service gracefully
 */
async function shutdownTimerService() {
    await cleanupAllTimers();

    // ISSUE #68 FIX: Log pub/sub failures during shutdown
    try {
        const { subClient } = getPubSubClients();
        await subClient.unsubscribe(TIMER_CHANNEL);
    } catch (e) {
        logger.debug(`Timer service unsubscribe failed during shutdown: ${e.message}`);
    }

    logger.info('Timer service shut down');
}

module.exports = {
    initializeTimerService,
    startTimer,
    stopTimer,
    getTimerStatus,
    pauseTimer,
    resumeTimer,
    addTime,
    hasActiveTimer,
    cleanupAllTimers,
    shutdownTimerService
};
