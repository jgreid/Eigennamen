/**
 * Event Log Service
 *
 * Tracks game events for reconnection recovery and state synchronization.
 * Maintains a rolling window of recent events per room.
 */

const { getRedis } = require('../config/redis');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

// Configuration
const EVENT_LOG_TTL = 300; // 5 minutes of event history
const MAX_EVENTS_PER_ROOM = 100;
const EVENT_LOG_KEY_PREFIX = 'room:events:';

/**
 * Event types for categorization
 */
const EVENT_TYPES = {
    // Room events
    ROOM_CREATED: 'room:created',
    PLAYER_JOINED: 'player:joined',
    PLAYER_LEFT: 'player:left',
    PLAYER_DISCONNECTED: 'player:disconnected',
    PLAYER_RECONNECTED: 'player:reconnected',
    SETTINGS_UPDATED: 'settings:updated',
    HOST_CHANGED: 'host:changed',

    // Player events
    TEAM_CHANGED: 'team:changed',
    ROLE_CHANGED: 'role:changed',
    NICKNAME_CHANGED: 'nickname:changed',

    // Game events
    GAME_STARTED: 'game:started',
    CLUE_GIVEN: 'clue:given',
    CARD_REVEALED: 'card:revealed',
    TURN_ENDED: 'turn:ended',
    GAME_OVER: 'game:over',

    // Timer events
    TIMER_STARTED: 'timer:started',
    TIMER_PAUSED: 'timer:paused',
    TIMER_RESUMED: 'timer:resumed',
    TIMER_EXPIRED: 'timer:expired',

    // Chat events
    CHAT_MESSAGE: 'chat:message'
};

/**
 * Log an event for a room
 * @param {string} roomCode - Room code
 * @param {string} eventType - Event type from EVENT_TYPES
 * @param {Object} data - Event data
 * @param {number} version - State version at time of event
 * @returns {Object} The created event entry
 */
async function logEvent(roomCode, eventType, data, version = null) {
    const redis = getRedis();
    const key = `${EVENT_LOG_KEY_PREFIX}${roomCode}`;

    const entry = {
        id: uuidv4(),
        type: eventType,
        data,
        version,
        timestamp: Date.now()
    };

    try {
        // Use pipeline for atomic operations
        const pipeline = redis.multi();

        // Push to list (newest first)
        pipeline.lPush(key, JSON.stringify(entry));

        // Trim to max size
        pipeline.lTrim(key, 0, MAX_EVENTS_PER_ROOM - 1);

        // Set TTL
        pipeline.expire(key, EVENT_LOG_TTL);

        await pipeline.exec();

        logger.debug('Event logged', {
            roomCode,
            eventType,
            eventId: entry.id,
            version
        });

        return entry;
    } catch (error) {
        logger.error('Failed to log event', {
            roomCode,
            eventType,
            error: error.message
        });
        // Don't throw - logging failures shouldn't break the application
        return null;
    }
}

/**
 * Get events since a specific version
 * @param {string} roomCode - Room code
 * @param {number} sinceVersion - Get events after this version
 * @returns {Array} Events newer than the specified version
 */
async function getEventsSince(roomCode, sinceVersion) {
    const redis = getRedis();
    const key = `${EVENT_LOG_KEY_PREFIX}${roomCode}`;

    try {
        const rawEvents = await redis.lRange(key, 0, -1);

        if (!rawEvents || rawEvents.length === 0) {
            return [];
        }

        const events = rawEvents
            .map(raw => {
                try {
                    return JSON.parse(raw);
                } catch (e) {
                    return null;
                }
            })
            .filter(e => e !== null)
            // Filter by version, handling null versions gracefully
            // Events with null version are included if sinceVersion is null/undefined
            // Otherwise only include events with version > sinceVersion
            .filter(e => {
                if (e.version === null || e.version === undefined) {
                    return sinceVersion === null || sinceVersion === undefined;
                }
                if (sinceVersion === null || sinceVersion === undefined) {
                    return true; // Include all versioned events if no sinceVersion specified
                }
                return e.version > sinceVersion;
            })
            .reverse(); // Oldest first for replay

        return events;
    } catch (error) {
        logger.error('Failed to get events', {
            roomCode,
            sinceVersion,
            error: error.message
        });
        return [];
    }
}

/**
 * Get all recent events for a room
 * @param {string} roomCode - Room code
 * @param {number} limit - Maximum number of events to return
 * @returns {Array} Recent events (newest first)
 */
async function getRecentEvents(roomCode, limit = MAX_EVENTS_PER_ROOM) {
    const redis = getRedis();
    const key = `${EVENT_LOG_KEY_PREFIX}${roomCode}`;

    try {
        const rawEvents = await redis.lRange(key, 0, limit - 1);

        if (!rawEvents || rawEvents.length === 0) {
            return [];
        }

        return rawEvents
            .map(raw => {
                try {
                    return JSON.parse(raw);
                } catch (e) {
                    return null;
                }
            })
            .filter(e => e !== null);
    } catch (error) {
        logger.error('Failed to get recent events', {
            roomCode,
            error: error.message
        });
        return [];
    }
}

/**
 * Get the latest event version for a room
 * @param {string} roomCode - Room code
 * @returns {number|null} Latest version or null if no events
 */
async function getLatestVersion(roomCode) {
    const redis = getRedis();
    const key = `${EVENT_LOG_KEY_PREFIX}${roomCode}`;

    try {
        const latestEvent = await redis.lIndex(key, 0);
        if (!latestEvent) return null;

        const event = JSON.parse(latestEvent);
        return event.version;
    } catch (error) {
        logger.error('Failed to get latest version', {
            roomCode,
            error: error.message
        });
        return null;
    }
}

/**
 * Check if events can be replayed from a given version
 * @param {string} roomCode - Room code
 * @param {number} fromVersion - Starting version
 * @returns {Object} { canReplay: boolean, gapExists: boolean }
 */
async function canReplayFrom(roomCode, fromVersion) {
    const events = await getEventsSince(roomCode, fromVersion);

    if (events.length === 0) {
        return { canReplay: false, gapExists: false };
    }

    // Check for gaps in version sequence
    const versions = events.map(e => e.version).filter(v => v !== null);
    if (versions.length === 0) {
        return { canReplay: true, gapExists: false };
    }

    // Check if first event is the expected next version
    const firstEventVersion = versions[0];
    if (firstEventVersion !== fromVersion + 1) {
        return { canReplay: false, gapExists: true };
    }

    // Check for gaps in sequence
    for (let i = 1; i < versions.length; i++) {
        if (versions[i] !== versions[i - 1] + 1) {
            return { canReplay: false, gapExists: true };
        }
    }

    return { canReplay: true, gapExists: false };
}

/**
 * Clear event log for a room
 * @param {string} roomCode - Room code
 */
async function clearEventLog(roomCode) {
    const redis = getRedis();
    const key = `${EVENT_LOG_KEY_PREFIX}${roomCode}`;

    try {
        await redis.del(key);
        logger.debug('Event log cleared', { roomCode });
    } catch (error) {
        logger.error('Failed to clear event log', {
            roomCode,
            error: error.message
        });
    }
}

/**
 * Get event log stats for a room
 * @param {string} roomCode - Room code
 * @returns {Object} Stats including count, oldest, newest
 */
async function getEventLogStats(roomCode) {
    const redis = getRedis();
    const key = `${EVENT_LOG_KEY_PREFIX}${roomCode}`;

    try {
        const count = await redis.lLen(key);
        if (count === 0) {
            return { count: 0, oldest: null, newest: null };
        }

        const [newest, oldest] = await Promise.all([
            redis.lIndex(key, 0),
            redis.lIndex(key, -1)
        ]);

        return {
            count,
            newest: newest ? JSON.parse(newest) : null,
            oldest: oldest ? JSON.parse(oldest) : null
        };
    } catch (error) {
        logger.error('Failed to get event log stats', {
            roomCode,
            error: error.message
        });
        return { count: 0, oldest: null, newest: null, error: error.message };
    }
}

module.exports = {
    EVENT_TYPES,
    logEvent,
    getEventsSince,
    getRecentEvents,
    getLatestVersion,
    canReplayFrom,
    clearEventLog,
    getEventLogStats,
    // Constants
    EVENT_LOG_TTL,
    MAX_EVENTS_PER_ROOM
};
