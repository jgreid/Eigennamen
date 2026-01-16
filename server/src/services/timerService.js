/**
 * Timer Service - Turn timer management
 */

const { getRedis } = require('../config/redis');
const logger = require('../utils/logger');

// In-memory timers (for single instance, use Redis pub/sub for multi-instance)
const activeTimers = new Map();

/**
 * Start a turn timer for a room
 * @param {string} roomCode - Room code
 * @param {number} durationSeconds - Timer duration in seconds
 * @param {Function} onExpire - Callback when timer expires
 * @returns {Object} Timer info
 */
function startTimer(roomCode, durationSeconds, onExpire) {
    // Clear any existing timer
    stopTimer(roomCode);

    const startTime = Date.now();
    const endTime = startTime + (durationSeconds * 1000);

    const timer = {
        roomCode,
        startTime,
        endTime,
        duration: durationSeconds,
        timeoutId: setTimeout(() => {
            logger.info(`Timer expired for room ${roomCode}`);
            activeTimers.delete(roomCode);
            if (onExpire) {
                onExpire(roomCode);
            }
        }, durationSeconds * 1000)
    };

    activeTimers.set(roomCode, timer);
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
function stopTimer(roomCode) {
    const timer = activeTimers.get(roomCode);
    if (timer) {
        clearTimeout(timer.timeoutId);
        activeTimers.delete(roomCode);
        logger.info(`Timer stopped for room ${roomCode}`);
    }
}

/**
 * Get remaining time for a room's timer
 * @param {string} roomCode - Room code
 * @returns {Object|null} Timer status or null if no timer
 */
function getTimerStatus(roomCode) {
    const timer = activeTimers.get(roomCode);
    if (!timer) {
        return null;
    }

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
}

/**
 * Pause timer for a room (stores remaining time)
 * @param {string} roomCode - Room code
 * @returns {number|null} Remaining seconds or null
 */
function pauseTimer(roomCode) {
    const timer = activeTimers.get(roomCode);
    if (!timer) {
        return null;
    }

    const now = Date.now();
    const remainingMs = Math.max(0, timer.endTime - now);
    const remainingSeconds = Math.ceil(remainingMs / 1000);

    clearTimeout(timer.timeoutId);
    timer.paused = true;
    timer.pausedAt = now;
    timer.remainingWhenPaused = remainingSeconds;

    logger.info(`Timer paused for room ${roomCode}: ${remainingSeconds}s remaining`);
    return remainingSeconds;
}

/**
 * Resume a paused timer
 * @param {string} roomCode - Room code
 * @param {Function} onExpire - Callback when timer expires
 * @returns {Object|null} Timer info or null
 */
function resumeTimer(roomCode, onExpire) {
    const timer = activeTimers.get(roomCode);
    if (!timer || !timer.paused) {
        return null;
    }

    const remainingSeconds = timer.remainingWhenPaused;
    return startTimer(roomCode, remainingSeconds, onExpire);
}

/**
 * Add time to an active timer
 * @param {string} roomCode - Room code
 * @param {number} secondsToAdd - Seconds to add
 * @param {Function} onExpire - Callback when timer expires
 * @returns {Object|null} Updated timer info or null
 */
function addTime(roomCode, secondsToAdd, onExpire) {
    const status = getTimerStatus(roomCode);
    if (!status || status.expired) {
        return null;
    }

    const newDuration = status.remainingSeconds + secondsToAdd;
    return startTimer(roomCode, newDuration, onExpire);
}

/**
 * Check if a room has an active timer
 * @param {string} roomCode - Room code
 * @returns {boolean}
 */
function hasActiveTimer(roomCode) {
    const timer = activeTimers.get(roomCode);
    return !!(timer && !timer.paused);
}

/**
 * Clean up all timers (for shutdown)
 */
function cleanupAllTimers() {
    for (const [roomCode, timer] of activeTimers) {
        clearTimeout(timer.timeoutId);
    }
    activeTimers.clear();
    logger.info('All timers cleaned up');
}

module.exports = {
    startTimer,
    stopTimer,
    getTimerStatus,
    pauseTimer,
    resumeTimer,
    addTime,
    hasActiveTimer,
    cleanupAllTimers
};
