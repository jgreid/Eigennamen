import type { Server as SocketIOServer } from 'socket.io';
import type { Player } from '../types';

import logger from '../utils/logger';
import { incrementCounter, setGauge, METRIC_NAMES } from '../utils/metrics';

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

// Metrics tracking for emission failures (optional monitoring).
// Resets hourly to prevent unbounded counter growth on long-running servers.
const METRICS_RESET_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
let emissionMetrics: EmissionMetrics = {
    total: 0,
    successful: 0,
    failed: 0,
    lastFailure: null
};
let metricsWindowStart = Date.now();

function maybeResetMetricsWindow(): void {
    if (Date.now() - metricsWindowStart > METRICS_RESET_INTERVAL_MS) {
        if (emissionMetrics.failed > 0) {
            logger.info('Emission metrics hourly snapshot', {
                total: emissionMetrics.total,
                successful: emissionMetrics.successful,
                failed: emissionMetrics.failed
            });
        }
        // Flush window totals into central gauges so /metrics and Prometheus see them
        setGauge('emission_window_total', emissionMetrics.total);
        setGauge('emission_window_failed', emissionMetrics.failed);
        emissionMetrics = {
            total: 0,
            successful: 0,
            failed: 0,
            lastFailure: emissionMetrics.lastFailure // Preserve last failure for debugging
        };
        metricsWindowStart = Date.now();
    }
}

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
    maybeResetMetricsWindow();
    emissionMetrics.total++;

    try {
        if (!io) {
            throw new Error('Socket.io instance not available');
        }

        const target = `room:${roomCode}`;
        io.to(target).emit(event, data);

        emissionMetrics.successful++;
        incrementCounter(METRIC_NAMES.BROADCASTS_SENT);
        if (logSuccess) {
            logger.debug(`Emitted ${event} to ${target}`, { dataKeys: Object.keys((data || {}) as object) });
        }

        return true;
    } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        emissionMetrics.failed++;
        incrementCounter(METRIC_NAMES.ERRORS, 1, { type: 'emission' });
        emissionMetrics.lastFailure = {
            event,
            roomCode,
            error: errMsg,
            timestamp: Date.now()
        };

        const errorMsg = `Failed to emit ${event} to room:${roomCode}: ${errMsg}`;
        if (throwOnError) {
            throw new Error(errorMsg);
        }

        logger.error(errorMsg, { event, roomCode, error: errMsg });
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
    maybeResetMetricsWindow();
    emissionMetrics.total++;

    try {
        if (!io) {
            throw new Error('Socket.io instance not available');
        }

        const target = `player:${sessionId}`;
        io.to(target).emit(event, data);

        emissionMetrics.successful++;
        incrementCounter(METRIC_NAMES.BROADCASTS_SENT);
        if (logSuccess) {
            logger.debug(`Emitted ${event} to ${target}`, { dataKeys: Object.keys((data || {}) as object) });
        }

        return true;
    } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        emissionMetrics.failed++;
        incrementCounter(METRIC_NAMES.ERRORS, 1, { type: 'emission' });
        emissionMetrics.lastFailure = {
            event,
            sessionId,
            error: errMsg,
            timestamp: Date.now()
        };

        const errorMsg = `Failed to emit ${event} to player:${sessionId}: ${errMsg}`;
        if (throwOnError) {
            throw new Error(errorMsg);
        }

        logger.error(errorMsg, { event, sessionId, error: errMsg });
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
            results.errors.push({ sessionId: player.sessionId, error: error instanceof Error ? error.message : String(error) });
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

/**
 * Safely emit an event to an arbitrary socket.io room/group name
 * Unlike safeEmitToRoom which prefixes with "room:", this takes the full target name.
 * Useful for spectator rooms, team rooms, etc.
 * @param io - Socket.io server instance
 * @param target - Full room/group name (e.g., "spectators:ROOM1")
 * @param event - Event name
 * @param data - Data to emit
 * @returns True if emission succeeded
 */
function safeEmitToGroup(
    io: SocketIOServer | null,
    target: string,
    event: string,
    data: unknown,
    options: SafeEmitOptions = {}
): boolean {
    const { logSuccess = false, throwOnError = false } = options;
    maybeResetMetricsWindow();
    emissionMetrics.total++;

    try {
        if (!io) {
            throw new Error('Socket.io instance not available');
        }

        io.to(target).emit(event, data);

        emissionMetrics.successful++;
        incrementCounter(METRIC_NAMES.BROADCASTS_SENT);
        if (logSuccess) {
            logger.debug(`Emitted ${event} to ${target}`, { dataKeys: Object.keys((data || {}) as object) });
        }

        return true;
    } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        emissionMetrics.failed++;
        incrementCounter(METRIC_NAMES.ERRORS, 1, { type: 'emission' });
        emissionMetrics.lastFailure = {
            event,
            error: errMsg,
            timestamp: Date.now()
        };

        const errorMsg = `Failed to emit ${event} to ${target}: ${errMsg}`;
        if (throwOnError) {
            throw new Error(errorMsg);
        }

        logger.error(errorMsg, { event, target, error: errMsg });
        return false;
    }
}

export {
    safeEmitToRoom,
    safeEmitToPlayer,
    safeEmitToPlayers,
    safeEmitToGroup,
    getEmissionMetrics,
    resetEmissionMetrics
};
