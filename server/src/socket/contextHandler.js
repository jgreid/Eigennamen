/**
 * Context-Aware Handler Wrapper
 *
 * ARCHITECTURAL FIX: Combines rate limiting with player context validation
 * to eliminate boilerplate and ensure consistent state handling.
 *
 * Before (in every handler):
 *   if (!socket.roomCode) throw...
 *   const validated = validateInput(schema, data)
 *   const player = await playerService.getPlayer(socket.sessionId)
 *   if (!player || player.roomCode !== socket.roomCode) throw...
 *   const game = await gameService.getGame(socket.roomCode)
 *   // actual logic
 *
 * After (using this wrapper):
 *   createContextHandler(socket, 'player:setTeam', playerTeamSchema, { requireRoom: true },
 *     async (ctx, validated) => {
 *       // ctx.player, ctx.game, ctx.roomCode already validated
 *       // actual logic only
 *     }
 *   )
 */

const { getPlayerContext, syncSocketRooms } = require('./playerContext');
const { createRateLimitedHandler } = require('./rateLimitHandler');
const { validateInput } = require('../middleware/validation');
const logger = require('../utils/logger');
const { ERROR_CODES } = require('../config/constants');

/**
 * Create a handler with automatic context validation and rate limiting
 *
 * @param {Object} socket - Socket.io socket instance
 * @param {string} eventName - Event name for rate limiting and logging
 * @param {Object} schema - Zod schema for input validation (or null if no input)
 * @param {Object} contextOptions - Options for getPlayerContext
 * @param {Function} handler - Async handler function (ctx, validatedData) => Promise<void>
 * @returns {Function} Wrapped handler
 */
function createContextHandler(socket, eventName, schema, contextOptions, handler) {
    return createRateLimitedHandler(socket, eventName, async (data) => {
        try {
            // Step 1: Validate input (if schema provided)
            const validated = schema ? validateInput(schema, data) : data;

            // Step 2: Build and validate player context
            const ctx = await getPlayerContext(socket, contextOptions);

            // Step 3: Store previous player state for room sync
            const previousPlayer = ctx.player ? { ...ctx.player } : null;

            // Step 4: Call the actual handler
            const result = await handler(ctx, validated);

            // Step 5: If handler returns updated player, sync socket rooms
            if (result?.player) {
                syncSocketRooms(socket, result.player, previousPlayer);
            }

            return result;

        } catch (error) {
            // Determine the error event name based on the event prefix
            const errorEvent = `${eventName.split(':')[0]}:error`;

            logger.error(`Error in ${eventName}:`, {
                error: error.message,
                code: error.code,
                sessionId: socket.sessionId,
                roomCode: socket.roomCode
            });

            socket.emit(errorEvent, {
                code: error.code || ERROR_CODES.SERVER_ERROR,
                message: error.message || 'An unexpected error occurred'
            });
        }
    });
}

/**
 * Simplified context handler for operations that don't need input validation
 */
function createSimpleContextHandler(socket, eventName, contextOptions, handler) {
    return createContextHandler(socket, eventName, null, contextOptions, handler);
}

/**
 * Context handler for room-required operations (most common case)
 */
function createRoomHandler(socket, eventName, schema, handler) {
    return createContextHandler(socket, eventName, schema, { requireRoom: true }, handler);
}

/**
 * Context handler for host-only operations
 */
function createHostHandler(socket, eventName, schema, handler) {
    return createContextHandler(socket, eventName, schema, {
        requireRoom: true,
        requireHost: true
    }, handler);
}

/**
 * Context handler for game operations
 */
function createGameHandler(socket, eventName, schema, handler) {
    return createContextHandler(socket, eventName, schema, {
        requireRoom: true,
        requireGame: true
    }, handler);
}

module.exports = {
    createContextHandler,
    createSimpleContextHandler,
    createRoomHandler,
    createHostHandler,
    createGameHandler
};
