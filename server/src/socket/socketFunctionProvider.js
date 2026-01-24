/**
 * Socket Function Provider
 *
 * Solves the circular dependency problem between socket/index.js and handlers:
 * - socket/index.js defines utility functions (emitToRoom, startTurnTimer, etc.)
 * - handlers need these functions but are imported by socket/index.js
 *
 * Solution: Dependency Injection via this provider
 * 1. socket/index.js registers functions after defining them
 * 2. Handlers call getSocketFunctions() at runtime (after registration)
 *
 * This pattern allows:
 * - Clean separation of concerns
 * - Testability (can mock the provider)
 * - No require-time circular dependency issues
 *
 * @module socketFunctionProvider
 */

// Registered socket functions (set during initialization)
let socketFunctions = null;

// Expected function names for validation
const REQUIRED_FUNCTIONS = [
    'emitToRoom',
    'emitToPlayer',
    'startTurnTimer',
    'stopTurnTimer',
    'getTimerStatus',
    'getIO'
];

/**
 * Register socket functions during initialization
 * Called from socket/index.js after functions are defined
 *
 * @param {Object} functions - Object containing socket utility functions
 * @param {Function} functions.emitToRoom - Emit to all sockets in a room
 * @param {Function} functions.emitToPlayer - Emit to a specific player
 * @param {Function} functions.startTurnTimer - Start the turn timer
 * @param {Function} functions.stopTurnTimer - Stop the turn timer
 * @param {Function} functions.getTimerStatus - Get timer status
 * @param {Function} functions.getIO - Get the Socket.io server instance
 * @throws {Error} If required functions are missing
 */
function registerSocketFunctions(functions) {
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

    socketFunctions = Object.freeze({ ...functions });
}

/**
 * Get socket functions for use in handlers
 * Call this at runtime within handler functions, not at module load time
 *
 * @returns {Object} Socket utility functions
 * @throws {Error} If functions not yet registered
 *
 * @example
 * // In a handler function:
 * socket.on('game:start', async (data) => {
 *     const { startTurnTimer, emitToRoom } = getSocketFunctions();
 *     await startTurnTimer(roomCode, 60);
 *     emitToRoom(roomCode, 'game:started', gameData);
 * });
 */
function getSocketFunctions() {
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
 * @returns {boolean} True if functions are registered
 */
function isRegistered() {
    return socketFunctions !== null;
}

/**
 * Clear socket functions
 * Used for testing and cleanup during shutdown
 */
function clearSocketFunctions() {
    socketFunctions = null;
}

/**
 * Get list of required function names
 * Useful for testing and documentation
 *
 * @returns {string[]} Array of required function names
 */
function getRequiredFunctions() {
    return [...REQUIRED_FUNCTIONS];
}

module.exports = {
    registerSocketFunctions,
    getSocketFunctions,
    isRegistered,
    clearSocketFunctions,
    getRequiredFunctions
};
