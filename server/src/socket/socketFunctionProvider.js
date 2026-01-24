/**
 * Socket Function Provider
 *
 * Provides socket utility functions to handlers without circular dependencies.
 * Uses dependency injection pattern - functions are registered during socket initialization.
 */

// Registered socket functions (set during initialization)
let socketFunctions = null;

/**
 * Register socket functions during initialization
 * Called from socket/index.js after functions are defined
 * @param {Object} functions - Object containing socket utility functions
 */
function registerSocketFunctions(functions) {
    socketFunctions = functions;
}

/**
 * Get socket functions for use in handlers
 * @returns {Object} Socket utility functions
 * @throws {Error} If functions not yet registered
 */
function getSocketFunctions() {
    if (!socketFunctions) {
        throw new Error('Socket functions not yet registered. Ensure registerSocketFunctions() is called during initialization.');
    }
    return socketFunctions;
}

/**
 * Check if socket functions are available
 * @returns {boolean}
 */
function isRegistered() {
    return socketFunctions !== null;
}

/**
 * Clear socket functions (for testing)
 */
function clearSocketFunctions() {
    socketFunctions = null;
}

module.exports = {
    registerSocketFunctions,
    getSocketFunctions,
    isRegistered,
    clearSocketFunctions
};
