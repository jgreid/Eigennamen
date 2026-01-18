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

// Local timers for this instance
const localTimers = new Map();

// Polling interval for orphaned timer recovery (30 seconds)
const ORPHAN_CHECK_INTERVAL = 30000;
let orphanCheckInterval = null;

// Redis key prefixes
const TIMER_KEY_PREFIX = 'timer:';
const TIMER_CHANNEL = 'timer:events';

/**
 * Initialize timer service with Redis pub/sub
 * Call this on server startup
 */
async function initializeTimerService(onExpireCallback) {
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
    } catch (error) {
        logger.warn('Timer service running in single-instance mode (Redis pub/sub unavailable)');
    }
}

/**
 * Handle timer events from pub/sub
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
        { EX: durationSeconds + 60 } // TTL slightly longer than timer duration
    );

    // Set up local timeout
    const timeoutId = setTimeout(async () => {
        logger.info(`Timer expired for room ${roomCode}`);
        localTimers.delete(roomCode);

        // Remove from Redis
        await redis.del(`${TIMER_KEY_PREFIX}${roomCode}`);

        // Publish expiration event
        try {
            const { pubClient } = getPubSubClients();
            await pubClient.publish(TIMER_CHANNEL, JSON.stringify({
                type: 'expired',
                roomCode,
                timestamp: Date.now()
            }));
        } catch (e) {
            // Pub/sub not available
        }

        if (onExpire) {
            onExpire(roomCode);
        }
    }, durationSeconds * 1000);

    localTimers.set(roomCode, {
        ...timerData,
        timeoutId,
        onExpire
    });

    // Publish start event
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
        // Pub/sub not available
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
    try {
        const { pubClient } = getPubSubClients();
        await pubClient.publish(TIMER_CHANNEL, JSON.stringify({
            type: 'stopped',
            roomCode,
            timestamp: Date.now()
        }));
    } catch (e) {
        // Pub/sub not available
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
        const remainingMs = Math.max(0, timer.endTime - now);
        const remainingSeconds = Math.ceil(remainingMs / 1000);

        return {
            startTime: timer.startTime,
            endTime: timer.endTime,
            duration: timer.duration,
            remainingSeconds,
            expired: remainingMs <= 0
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
        const timer = JSON.parse(timerData);
        timer.paused = true;
        timer.remainingWhenPaused = remainingSeconds;
        await redis.set(`${TIMER_KEY_PREFIX}${roomCode}`, JSON.stringify(timer), { EX: 86400 }); // Keep for 24h when paused
    }

    // Clear local timeout
    const localTimer = localTimers.get(roomCode);
    if (localTimer) {
        clearTimeout(localTimer.timeoutId);
        localTimer.paused = true;
        localTimer.remainingWhenPaused = remainingSeconds;
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
 * Add time to an active timer
 * @param {string} roomCode - Room code
 * @param {number} secondsToAdd - Seconds to add
 * @param {Function} onExpire - Callback when timer expires
 * @returns {Object|null} Updated timer info or null
 */
async function addTime(roomCode, secondsToAdd, onExpire) {
    const status = await getTimerStatus(roomCode);
    if (!status || status.expired) {
        return null;
    }

    const newDuration = status.remainingSeconds + secondsToAdd;
    return await startTimer(roomCode, newDuration, onExpire);
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
 * Check for and recover orphaned timers
 */
async function checkOrphanedTimers(onExpireCallback) {
    try {
        const redis = getRedis();
        const keys = await redis.keys(`${TIMER_KEY_PREFIX}*`);

        for (const key of keys) {
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
                    // Timer should have expired - trigger callback
                    logger.info(`Recovering expired orphaned timer for room ${roomCode}`);
                    await redis.del(key);
                    if (onExpireCallback) {
                        onExpireCallback(roomCode);
                    }
                } else if (remainingMs > 0 && remainingMs < ORPHAN_CHECK_INTERVAL * 2) {
                    // Timer is about to expire and no instance is handling it - take ownership
                    logger.info(`Taking ownership of orphaned timer for room ${roomCode}`);
                    const remainingSeconds = Math.ceil(remainingMs / 1000);
                    await startTimer(roomCode, remainingSeconds, onExpireCallback);
                }
            } catch (e) {
                logger.error(`Error processing orphaned timer ${key}:`, e);
            }
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
    for (const [roomCode, timer] of localTimers) {
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

    try {
        const { subClient } = getPubSubClients();
        await subClient.unsubscribe(TIMER_CHANNEL);
    } catch (e) {
        // Ignore
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
