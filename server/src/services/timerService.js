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
const pubSubHealth = require('../utils/pubSubHealth');
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
 * Creates a timer expiration callback function
 * Extracted to avoid duplication between startTimer and addTimeLocal
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

            // Publish expiration event with health tracking
            try {
                const { pubClient } = getPubSubClients();
                await pubClient.publish(TIMER_CHANNEL, JSON.stringify({
                    type: 'expired',
                    roomCode,
                    timestamp: Date.now()
                }));
                pubSubHealth.recordSuccess('publish');
            } catch (e) {
                pubSubHealth.recordFailure('publish', e);
                logger.warn(`Failed to publish timer expiration event for room ${roomCode}:`, e.message);
            }

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
                    pubSubHealth.recordSuccess('subscribe');
                    handleTimerEvent(event, onExpireCallback);
                } catch (e) {
                    logger.error('Error handling timer event:', e);
                }
            });

            // Start orphan timer check
            startOrphanCheck(onExpireCallback);

            pubSubHealth.recordSuccess('subscribe');
            logger.info('Timer service initialized with Redis backing');
            return true;
        } catch (error) {
            retries++;
            pubSubHealth.recordFailure('subscribe', error);
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
 * ISSUE #34 FIX: Added 'addTime' event handling for multi-instance routing
 */
function handleTimerEvent(event, onExpireCallback) {
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
        case 'addTime':
            // ISSUE #34 FIX: Handle addTime from another instance
            // Only the instance that owns the timer should process this
            if (localTimers.has(event.roomCode)) {
                const localTimer = localTimers.get(event.roomCode);

                // If event contains newEndTime, it's a notification of completed addTime
                // If event contains secondsToAdd, it's a request to add time
                if (event.newEndTime) {
                    // Update local timer with new end time from completed operation
                    clearTimeout(localTimer.timeoutId);
                    localTimer.endTime = event.newEndTime;
                    localTimer.duration = event.newDuration;

                    const remainingMs = event.newEndTime - Date.now();
                    if (remainingMs > 0) {
                        localTimer.timeoutId = setTimeout(async () => {
                            try {
                                logger.info(`Timer expired for room ${event.roomCode}`);
                                localTimers.delete(event.roomCode);
                                const redis = getRedis();
                                await redis.del(`${TIMER_KEY_PREFIX}${event.roomCode}`);

                                if (onExpireCallback) {
                                    await onExpireCallback(event.roomCode);
                                }
                            } catch (error) {
                                logger.error(`Error handling timer expiration for room ${event.roomCode}:`, error);
                            }
                        }, remainingMs);

                        logger.debug(`Updated local timer for room ${event.roomCode} via pub/sub addTime`);
                    }
                } else if (event.secondsToAdd) {
                    // Process addTime request locally since we own the timer
                    logger.debug(`Processing addTime event for room ${event.roomCode} (we own this timer)`);
                    addTimeLocal(event.roomCode, event.secondsToAdd, onExpireCallback)
                        .catch(err => logger.error(`Error processing addTime event for room ${event.roomCode}:`, err));
                }
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

    // Publish start event with health tracking
    try {
        const { pubClient } = getPubSubClients();
        await pubClient.publish(TIMER_CHANNEL, JSON.stringify({
            type: 'started',
            roomCode,
            endTime,
            duration: durationSeconds,
            timestamp: Date.now()
        }));
        pubSubHealth.recordSuccess('publish');
    } catch (e) {
        pubSubHealth.recordFailure('publish', e);
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

    // Publish stop event with health tracking
    try {
        const { pubClient } = getPubSubClients();
        await pubClient.publish(TIMER_CHANNEL, JSON.stringify({
            type: 'stopped',
            roomCode,
            timestamp: Date.now()
        }));
        pubSubHealth.recordSuccess('publish');
    } catch (e) {
        pubSubHealth.recordFailure('publish', e);
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

    // Publish pause event to all instances with health tracking
    try {
        const { pubClient } = getPubSubClients();
        await pubClient.publish(TIMER_CHANNEL, JSON.stringify({
            type: 'paused',
            roomCode,
            remainingSeconds,
            timestamp: Date.now()
        }));
        pubSubHealth.recordSuccess('publish');
    } catch (e) {
        pubSubHealth.recordFailure('publish', e);
        logger.warn(`Failed to publish pause event for room ${roomCode}:`, e.message);
    }

    logger.info(`Timer paused for room ${roomCode}: ${remainingSeconds}s remaining`);
    return remainingSeconds;
}

/**
 * Resume a paused timer with distributed lock
 * ISSUE #33 FIX: Acquire lock to prevent duplicate timers across instances
 * @param {string} roomCode - Room code
 * @param {Function} onExpire - Callback when timer expires
 * @returns {Object|null} Timer info or null
 */
async function resumeTimer(roomCode, onExpire) {
    const redis = getRedis();
    const lockKey = `lock:timer:resume:${roomCode}`;
    const lockValue = `${process.pid}:${Date.now()}`;

    // ISSUE #33 FIX: Acquire distributed lock to prevent duplicate resume
    // SPRINT-15 FIX: Explicit verification of lock acquisition result
    let lockAcquired;
    try {
        const lockResult = await redis.set(lockKey, lockValue, { NX: true, EX: 5 });
        // Redis SET with NX returns 'OK' on success, null if key exists
        lockAcquired = lockResult === 'OK' || lockResult === true;
    } catch (lockError) {
        logger.error(`Failed to acquire timer resume lock for room ${roomCode}:`, {
            error: lockError.message,
            lockKey
        });
        return null;
    }

    if (!lockAcquired) {
        logger.debug(`Another instance is resuming timer for room ${roomCode}`, { lockKey });
        return null;
    }

    logger.debug(`Timer resume lock acquired for room ${roomCode}`, {
        lockKey,
        lockValue,
        ttlSeconds: 5
    });

    try {
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
    } finally {
        // Always release the lock
        await redis.del(lockKey).catch(err => {
            logger.error(`Failed to release resume lock for room ${roomCode}:`, err.message);
        });
    }
}

/**
 * Add time to an active timer (atomic operation)
 * @param {string} roomCode - Room code
 * @param {number} secondsToAdd - Seconds to add
 * @param {Function} onExpire - Callback when timer expires
 * @returns {Object|null} Updated timer info or null
 */
/**
 * Add time to a timer (routes to owning instance via pub/sub if needed)
 * ISSUE #34 FIX: Route addTime to the instance that owns the timer
 * @param {string} roomCode - Room code
 * @param {number} secondsToAdd - Seconds to add
 * @param {Function} onExpire - Callback when timer expires (only used if we own the timer)
 * @returns {Object|null} Updated timer info or null
 */
async function addTime(roomCode, secondsToAdd, onExpire) {
    // ISSUE #34 FIX: Check if we own this timer locally
    if (localTimers.has(roomCode)) {
        // We own the timer - process locally
        return addTimeLocal(roomCode, secondsToAdd, onExpire);
    }

    // Check if timer exists in Redis before trying pub/sub
    const redis = getRedis();
    const timerExists = await redis.exists(`${TIMER_KEY_PREFIX}${roomCode}`);
    if (!timerExists) {
        return null;
    }

    // We don't own the timer - try to route via pub/sub to the owning instance
    try {
        const { pubClient } = getPubSubClients();

        // Publish addTime request for the owning instance to handle
        await pubClient.publish(TIMER_CHANNEL, JSON.stringify({
            type: 'addTime',
            roomCode,
            secondsToAdd,
            timestamp: Date.now()
        }));
        pubSubHealth.recordSuccess('publish');

        logger.debug(`Routed addTime request for room ${roomCode} via pub/sub`);

        // ISSUE #16 FIX: Return current status with a flag indicating async routing
        // The owning instance will update Redis asynchronously via pub/sub
        // Callers should use the 'pending' flag to know the returned values may be stale
        const currentStatus = await getTimerStatus(roomCode);
        if (currentStatus) {
            return {
                ...currentStatus,
                pending: true,  // Indicates the addTime is being processed asynchronously
                secondsAdded: secondsToAdd
            };
        }
        return null;
    } catch (pubSubError) {
        pubSubHealth.recordFailure('publish', pubSubError);
        logger.warn(`Failed to route addTime via pub/sub for room ${roomCode}, falling back to local:`, pubSubError.message);
        // Fallback to local processing if pub/sub fails
        return addTimeLocal(roomCode, secondsToAdd, onExpire);
    }
}

/**
 * Add time to a timer locally (internal implementation)
 * Only called when we own the timer or as fallback
 */
async function addTimeLocal(roomCode, secondsToAdd, onExpire) {
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

        // Update or create local timer
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
        } else {
            // No local timer exists - publish addTime event via pub/sub
            // The owning instance will handle updating its local timer
            logger.info(`Publishing addTime event for room ${roomCode} (not timer owner)`);

            try {
                const { pubClient } = getPubSubClients();
                await pubClient.publish(TIMER_CHANNEL, JSON.stringify({
                    type: 'addTime',
                    roomCode,
                    secondsAdded: secondsToAdd,
                    newEndTime: newTimer.endTime,
                    newDuration: newTimer.duration,
                    remainingSeconds: newTimer.remainingSeconds,
                    timestamp: Date.now()
                }));
                pubSubHealth.recordSuccess('publish');
            } catch (e) {
                pubSubHealth.recordFailure('publish', e);
                logger.warn(`Failed to publish addTime event for room ${roomCode}:`, e.message);
            }
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
