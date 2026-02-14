/**
 * Safe Socket.io Emission Utilities
 *
 * Provides error-handling wrappers for socket emissions
 * to prevent silent failures when emitting to rooms or players.
 *
 * These utilities log errors and optionally track failed emissions for metrics.
 */

import type { Server as SocketIOServer } from 'socket.io';
import type { Player } from '../types';

import logger from '../utils/logger';

/**
 * Emission metrics for monitoring
 */
export interface EmissionMetrics {
    total: number;
    successful: number;
    failed: number;
    lastFailure: EmissionFailure | null;
}

/**
 * Details of a failed emission
 */
export interface EmissionFailure {
    event: string;
    roomCode?: string;
    sessionId?: string;
    error: string;
    timestamp: number;
}

/**
 * Options for safe emit operations
 */
export interface SafeEmitOptions {
    /** Log successful emissions (default: false) */
    logSuccess?: boolean;
    /** Throw error instead of logging (default: false) */
    throwOnError?: boolean;
}

/**
 * Result of batch emit to players
 */
export interface BatchEmitResult {
    successful: number;
    failed: number;
    errors: Array<{ sessionId?: string; reason?: string; error?: string }>;
}

// Metrics tracking for emission failures (optional monitoring)
let emissionMetrics: EmissionMetrics = {
    total: 0,
    successful: 0,
    failed: 0,
    lastFailure: null
};

/**
 * Safely emit an event to a room with error handling
 * @param io - Socket.io server instance
 * @param roomCode - Room code (without prefix)
 * @param event - Event name
 * @param data - Data to emit
 * @param options - Optional settings
 * @returns True if emission succeeded
 */
function safeEmitToRoom(
    io: SocketIOServer | null,
    roomCode: string,
    event: string,
    data: unknown,
    options: SafeEmitOptions = {}
): boolean {
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
            logger.debug(`Emitted ${event} to ${target}`, { dataKeys: Object.keys((data || {}) as object) });
        }

        return true;
    } catch (error) {
        emissionMetrics.failed++;
        emissionMetrics.lastFailure = {
            event,
            roomCode,
            error: (error as Error).message,
            timestamp: Date.now()
        };

        const errorMsg = `Failed to emit ${event} to room:${roomCode}: ${(error as Error).message}`;
        if (throwOnError) {
            throw new Error(errorMsg);
        }

        logger.error(errorMsg, { event, roomCode, error: (error as Error).message });
        return false;
    }
}

/**
 * Safely emit an event to a specific player with error handling
 * @param io - Socket.io server instance
 * @param sessionId - Player's session ID
 * @param event - Event name
 * @param data - Data to emit
 * @param options - Optional settings
 * @returns True if emission succeeded
 */
function safeEmitToPlayer(
    io: SocketIOServer | null,
    sessionId: string,
    event: string,
    data: unknown,
    options: SafeEmitOptions = {}
): boolean {
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
            logger.debug(`Emitted ${event} to ${target}`, { dataKeys: Object.keys((data || {}) as object) });
        }

        return true;
    } catch (error) {
        emissionMetrics.failed++;
        emissionMetrics.lastFailure = {
            event,
            sessionId,
            error: (error as Error).message,
            timestamp: Date.now()
        };

        const errorMsg = `Failed to emit ${event} to player:${sessionId}: ${(error as Error).message}`;
        if (throwOnError) {
            throw new Error(errorMsg);
        }

        logger.error(errorMsg, { event, sessionId, error: (error as Error).message });
        return false;
    }
}

/**
 * Safely emit to multiple players with error handling
 * @param io - Socket.io server instance
 * @param players - Array of player objects with sessionId
 * @param event - Event name
 * @param dataFn - Function that receives player and returns data to emit, or static data
 * @param options - Optional settings
 * @returns Object with successful/failed counts and errors array
 */
function safeEmitToPlayers(
    io: SocketIOServer | null,
    players: Player[],
    event: string,
    dataFn: ((player: Player) => unknown) | unknown,
    options: SafeEmitOptions = {}
): BatchEmitResult {
    const results: BatchEmitResult = { successful: 0, failed: 0, errors: [] };

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
            results.errors.push({ sessionId: player.sessionId, error: (error as Error).message });
        }
    }

    return results;
}

/**
 * Get emission metrics for monitoring
 * @returns Metrics object
 */
function getEmissionMetrics(): EmissionMetrics {
    return { ...emissionMetrics };
}

/**
 * Reset emission metrics (for testing)
 */
function resetEmissionMetrics(): void {
    emissionMetrics = {
        total: 0,
        successful: 0,
        failed: 0,
        lastFailure: null
    };
}

export {
    safeEmitToRoom,
    safeEmitToPlayer,
    safeEmitToPlayers,
    getEmissionMetrics,
    resetEmissionMetrics
};
