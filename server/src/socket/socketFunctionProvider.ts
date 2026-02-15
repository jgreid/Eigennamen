/**
 * Socket Function Provider
 *
 * Solves the circular dependency problem between socket/index.ts and handlers:
 * - socket/index.ts defines utility functions (emitToRoom, startTurnTimer, etc.)
 * - handlers need these functions but are imported by socket/index.ts
 *
 * Solution: Dependency Injection via this provider
 * 1. socket/index.ts registers functions after defining them
 * 2. Handlers call getSocketFunctions() at runtime (after registration)
 *
 * This pattern allows:
 * - Clean separation of concerns
 * - Testability (can mock the provider)
 * - No require-time circular dependency issues
 *
 * @module socketFunctionProvider
 */

import type { Server as SocketIOServer } from 'socket.io';
import type { TimerCallback } from '../types';
import type { TimerStatus } from '../services/timerService';

/**
 * Socket functions interface - all functions provided by the socket module
 */
export interface SocketFunctions {
    emitToRoom: (roomCode: string, event: string, data: unknown) => void;
    emitToPlayer: (sessionId: string, event: string, data: unknown) => void;
    startTurnTimer: (roomCode: string, durationSeconds: number) => Promise<TimerInfo>;
    stopTurnTimer: (roomCode: string) => Promise<void>;
    getTimerStatus: (roomCode: string) => Promise<TimerStatus | null>;
    getIO: () => SocketIOServer;
    createTimerExpireCallback: () => TimerCallback;
}

/**
 * Timer info returned from startTurnTimer
 */
export interface TimerInfo {
    roomCode?: string;
    durationSeconds?: number;
    startTime?: number;
    endTime?: number;
    remainingSeconds?: number;
}

// Registered socket functions (set during initialization)
let socketFunctions: SocketFunctions | null = null;

// Expected function names for validation
const REQUIRED_FUNCTIONS: (keyof SocketFunctions)[] = [
    'emitToRoom',
    'emitToPlayer',
    'startTurnTimer',
    'stopTurnTimer',
    'getTimerStatus',
    'getIO',
    'createTimerExpireCallback'
];

/**
 * Register socket functions during initialization
 * Called from socket/index.js after functions are defined
 *
 * @param functions - Object containing socket utility functions
 * @throws Error if required functions are missing
 */
function registerSocketFunctions(functions: SocketFunctions): void {
    if (!functions || typeof functions !== 'object') {
        throw new Error('Socket functions must be an object');
    }

    // Validate all required functions are present
    const missingFunctions = REQUIRED_FUNCTIONS.filter(
        name => typeof functions[name] !== 'function'
    );

    if (missingFunctions.length > 0) {
        throw new Error(`Missing required socket functions: ${missingFunctions.join(', ')}`);
    }

    socketFunctions = Object.freeze({ ...functions }) as SocketFunctions;
}

/**
 * Get socket functions for use in handlers
 * Call this at runtime within handler functions, not at module load time
 *
 * @returns Socket utility functions
 * @throws Error if functions not yet registered
 *
 * @example
 * // In a handler function:
 * socket.on('game:start', async (data) => {
 *     const { startTurnTimer, emitToRoom } = getSocketFunctions();
 *     await startTurnTimer(roomCode, 60);
 *     emitToRoom(roomCode, 'game:started', gameData);
 * });
 */
function getSocketFunctions(): SocketFunctions {
    if (!socketFunctions) {
        throw new Error(
            'Socket functions not yet registered. ' +
            'Ensure registerSocketFunctions() is called during socket initialization ' +
            'before any handlers are invoked.'
        );
    }
    return socketFunctions;
}

/**
 * Check if socket functions are available
 * Useful for conditional logic or graceful degradation
 *
 * @returns True if functions are registered
 */
function isRegistered(): boolean {
    return socketFunctions !== null;
}

/**
 * Clear socket functions
 * Used for testing and cleanup during shutdown
 */
function clearSocketFunctions(): void {
    socketFunctions = null;
}

/**
 * Get list of required function names
 * Useful for testing and documentation
 *
 * @returns Array of required function names
 */
function getRequiredFunctions(): (keyof SocketFunctions)[] {
    return [...REQUIRED_FUNCTIONS];
}

export {
    registerSocketFunctions,
    getSocketFunctions,
    isRegistered,
    clearSocketFunctions,
    getRequiredFunctions
};
