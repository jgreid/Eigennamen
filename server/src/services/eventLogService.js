/**
 * Event Log Service - In-memory event log with per-room ring buffers
 *
 * Provides event logging for audit trails, debugging, and reconnection recovery.
 * Each room maintains a bounded ring buffer of recent events (default 200).
 * Old rooms are cleaned up when capacity is exceeded.
 *
 * This is NOT a stub — events are stored in memory and queryable.
 * For persistence across restarts, a Redis-backed implementation could replace this.
 */

const logger = require('../utils/logger');

// Per-room event buffers: Map<roomCode, Array<event>>
const roomEvents = new Map();

// Configuration
const MAX_EVENTS_PER_ROOM = 200;
const MAX_TRACKED_ROOMS = 500;

// Well-known event types for consistency
const EVENT_TYPES = {
    ROOM_CREATED: 'ROOM_CREATED',
    PLAYER_JOINED: 'PLAYER_JOINED',
    PLAYER_LEFT: 'PLAYER_LEFT',
    PLAYER_DISCONNECTED: 'PLAYER_DISCONNECTED',
    HOST_CHANGED: 'HOST_CHANGED',
    SETTINGS_UPDATED: 'SETTINGS_UPDATED',
    TEAM_CHANGED: 'TEAM_CHANGED',
    ROLE_CHANGED: 'ROLE_CHANGED',
    NICKNAME_CHANGED: 'NICKNAME_CHANGED',
    GAME_STARTED: 'GAME_STARTED',
    CLUE_GIVEN: 'CLUE_GIVEN',
    CARD_REVEALED: 'CARD_REVEALED',
    TURN_ENDED: 'TURN_ENDED',
    GAME_OVER: 'GAME_OVER',
    TIMER_EXPIRED: 'TIMER_EXPIRED'
};

/**
 * Log an event for a room.
 * @param {string} roomCode
 * @param {string} eventType - One of EVENT_TYPES or any string
 * @param {Object} data - Event payload
 * @returns {Promise<void>}
 */
async function logEvent(roomCode, eventType, data = {}) {
    if (!roomCode || !eventType) return;

    // Evict oldest rooms if we're tracking too many
    if (!roomEvents.has(roomCode) && roomEvents.size >= MAX_TRACKED_ROOMS) {
        const oldest = roomEvents.keys().next().value;
        roomEvents.delete(oldest);
    }

    let events = roomEvents.get(roomCode);
    if (!events) {
        events = [];
        roomEvents.set(roomCode, events);
    }

    const entry = {
        type: eventType,
        data,
        timestamp: Date.now()
    };

    events.push(entry);

    // Trim to max size (ring buffer behavior)
    if (events.length > MAX_EVENTS_PER_ROOM) {
        events.splice(0, events.length - MAX_EVENTS_PER_ROOM);
    }
}

/**
 * Get events for a room since a given timestamp.
 * @param {string} roomCode
 * @param {number} sinceTimestamp - Unix ms timestamp
 * @returns {Promise<Array>}
 */
async function getEventsSince(roomCode, sinceTimestamp = 0) {
    const events = roomEvents.get(roomCode);
    if (!events) return [];
    return events.filter(e => e.timestamp > sinceTimestamp);
}

/**
 * Get the N most recent events for a room.
 * @param {string} roomCode
 * @param {number} count
 * @returns {Promise<Array>}
 */
async function getRecentEvents(roomCode, count = 50) {
    const events = roomEvents.get(roomCode);
    if (!events) return [];
    return events.slice(-count);
}

/**
 * Clear event log for a room (e.g., when room is destroyed).
 * @param {string} roomCode
 * @returns {Promise<void>}
 */
async function clearEventLog(roomCode) {
    roomEvents.delete(roomCode);
}

module.exports = {
    logEvent,
    getEventsSince,
    getRecentEvents,
    clearEventLog,
    EVENT_TYPES
};
