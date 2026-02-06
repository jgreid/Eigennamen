/**
 * Event Log Service - Stub
 *
 * This service was removed as it's no longer used by production code.
 * This stub exists solely so test files that mock it can resolve the module.
 * Tests provide their own mock implementations via jest.mock().
 */

import type { EventLogEntry } from '../types/services';

/**
 * Event types for logging (empty - service is a stub)
 */
export const EVENT_TYPES: Record<string, never> = {};

/**
 * Log an event (stub - no-op)
 */
export async function logEvent(
    _roomCode: string,
    _eventType: string,
    _payload: Record<string, unknown>
): Promise<void> {
    // Stub - no-op
}

/**
 * Get events since a timestamp (stub - returns empty array)
 */
export function getEventsSince(
    _roomCode: string,
    _since?: number
): Promise<EventLogEntry[]> {
    return Promise.resolve([]);
}

/**
 * Get recent events (stub - returns empty array)
 */
export function getRecentEvents(
    _roomCode: string,
    _limit?: number
): Promise<EventLogEntry[]> {
    return Promise.resolve([]);
}

/**
 * Clear event log for a room (stub - no-op)
 */
export async function clearEventLog(_roomCode: string): Promise<void> {
    // Stub - no-op
}

// CommonJS exports for compatibility
module.exports = {
    logEvent,
    getEventsSince,
    getRecentEvents,
    clearEventLog,
    EVENT_TYPES
};
