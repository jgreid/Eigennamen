/**
 * Safe Socket.io Emission Utilities
 *
 * HARDENING FIX: Provides error-handling wrappers for socket emissions
 * to prevent silent failures when emitting to rooms or players.
 *
 * These utilities log errors and optionally track failed emissions for metrics.
 */

const logger = require('../utils/logger');

// Metrics tracking for emission failures (optional monitoring)
let emissionMetrics = {
    total: 0,
    successful: 0,
    failed: 0,
    lastFailure: null
};

/**
 * Safely emit an event to a room with error handling
 * @param {object} io - Socket.io server instance
 * @param {string} roomCode - Room code (without prefix)
 * @param {string} event - Event name
 * @param {object} data - Data to emit
 * @param {object} options - Optional settings
 * @param {boolean} options.logSuccess - Log successful emissions (default: false)
 * @param {boolean} options.throwOnError - Throw error instead of logging (default: false)
 * @returns {boolean} True if emission succeeded
 */
function safeEmitToRoom(io, roomCode, event, data, options = {}) {
    const { logSuccess = false, throwOnError = false } = options;
    emissionMetrics.total++;

    try {
        if (!io) {
            throw new Error('Socket.io instance not available');
        }

        const target = `room:${roomCode}`;
        io.to(target).emit(event, data);

        emissionMetrics.successful++;
        if (logSuccess) {
            logger.debug(`Emitted ${event} to ${target}`, { dataKeys: Object.keys(data || {}) });
        }

        return true;
    } catch (error) {
        emissionMetrics.failed++;
        emissionMetrics.lastFailure = {
            event,
            roomCode,
            error: error.message,
            timestamp: Date.now()
        };

        const errorMsg = `Failed to emit ${event} to room:${roomCode}: ${error.message}`;
        if (throwOnError) {
            throw new Error(errorMsg);
        }

        logger.error(errorMsg, { event, roomCode, error: error.message });
        return false;
    }
}

/**
 * Safely emit an event to a specific player with error handling
 * @param {object} io - Socket.io server instance
 * @param {string} sessionId - Player's session ID
 * @param {string} event - Event name
 * @param {object} data - Data to emit
 * @param {object} options - Optional settings
 * @returns {boolean} True if emission succeeded
 */
function safeEmitToPlayer(io, sessionId, event, data, options = {}) {
    const { logSuccess = false, throwOnError = false } = options;
    emissionMetrics.total++;

    try {
        if (!io) {
            throw new Error('Socket.io instance not available');
        }

        const target = `player:${sessionId}`;
        io.to(target).emit(event, data);

        emissionMetrics.successful++;
        if (logSuccess) {
            logger.debug(`Emitted ${event} to ${target}`, { dataKeys: Object.keys(data || {}) });
        }

        return true;
    } catch (error) {
        emissionMetrics.failed++;
        emissionMetrics.lastFailure = {
            event,
            sessionId,
            error: error.message,
            timestamp: Date.now()
        };

        const errorMsg = `Failed to emit ${event} to player:${sessionId}: ${error.message}`;
        if (throwOnError) {
            throw new Error(errorMsg);
        }

        logger.error(errorMsg, { event, sessionId, error: error.message });
        return false;
    }
}

/**
 * Safely emit to multiple players with error handling
 * @param {object} io - Socket.io server instance
 * @param {Array<object>} players - Array of player objects with sessionId
 * @param {string} event - Event name
 * @param {Function} dataFn - Function that receives player and returns data to emit
 * @param {object} options - Optional settings
 * @returns {object} { successful: number, failed: number, errors: Array }
 */
function safeEmitToPlayers(io, players, event, dataFn, options = {}) {
    const results = { successful: 0, failed: 0, errors: [] };

    if (!Array.isArray(players)) {
        logger.error('safeEmitToPlayers called with non-array players');
        return results;
    }

    for (const player of players) {
        if (!player || !player.sessionId) {
            results.failed++;
            results.errors.push({ reason: 'Invalid player object' });
            continue;
        }

        try {
            const data = typeof dataFn === 'function' ? dataFn(player) : dataFn;
            const success = safeEmitToPlayer(io, player.sessionId, event, data, options);
            if (success) {
                results.successful++;
            } else {
                results.failed++;
            }
        } catch (error) {
            results.failed++;
            results.errors.push({ sessionId: player.sessionId, error: error.message });
        }
    }

    return results;
}

/**
 * Get emission metrics for monitoring
 * @returns {object} Metrics object
 */
function getEmissionMetrics() {
    return { ...emissionMetrics };
}

/**
 * Reset emission metrics (for testing)
 */
function resetEmissionMetrics() {
    emissionMetrics = {
        total: 0,
        successful: 0,
        failed: 0,
        lastFailure: null
    };
}

module.exports = {
    safeEmitToRoom,
    safeEmitToPlayer,
    safeEmitToPlayers,
    getEmissionMetrics,
    resetEmissionMetrics
};
