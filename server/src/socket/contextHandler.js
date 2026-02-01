/**
 * Context-Aware Handler Wrapper
 *
 * Combines rate limiting with player context validation to eliminate
 * boilerplate and ensure consistent state handling across all handlers.
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
 *   createRoomHandler(socket, 'player:setTeam', playerTeamSchema,
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
const { sanitizeErrorForClient } = require('../errors/GameError');

/**
 * Create a handler with automatic context validation and rate limiting.
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
            const validated = schema ? validateInput(schema, data) : (data || {});
            const ctx = await getPlayerContext(socket, contextOptions);

            // Snapshot previous player state before handler modifies it
            const previousPlayer = ctx.player ? { ...ctx.player } : null;

            const result = await handler(ctx, validated);

            // Sync socket rooms if handler returned updated player
            if (result && result.player) {
                syncSocketRooms(socket, result.player, previousPlayer);
            }

            return result;
        } catch (error) {
            const errorEvent = `${eventName.split(':')[0]}:error`;

            logger.error(`Error in ${eventName}:`, {
                error: error.message,
                code: error.code,
                sessionId: socket.sessionId,
                roomCode: socket.roomCode
            });

            socket.emit(errorEvent, sanitizeErrorForClient(error));
        }
    });
}

/**
 * Context handler for room-required operations (most common case).
 */
function createRoomHandler(socket, eventName, schema, handler) {
    return createContextHandler(socket, eventName, schema, { requireRoom: true }, handler);
}

/**
 * Context handler for host-only operations.
 */
function createHostHandler(socket, eventName, schema, handler) {
    return createContextHandler(socket, eventName, schema, {
        requireRoom: true,
        requireHost: true
    }, handler);
}

/**
 * Context handler for game operations (requires active game).
 */
function createGameHandler(socket, eventName, schema, handler) {
    return createContextHandler(socket, eventName, schema, {
        requireRoom: true,
        requireGame: true
    }, handler);
}

/**
 * Context handler for operations without input validation.
 */
function createSimpleContextHandler(socket, eventName, contextOptions, handler) {
    return createContextHandler(socket, eventName, null, contextOptions, handler);
}

/**
 * Context handler for pre-room operations (room:create, room:join).
 * Provides rate limiting, input validation, and consistent error handling
 * without requiring the player to already be in a room.
 */
function createPreRoomHandler(socket, eventName, schema, handler) {
    return createRateLimitedHandler(socket, eventName, async (data) => {
        try {
            const validated = schema ? validateInput(schema, data) : (data || {});
            await handler(validated);
        } catch (error) {
            const errorEvent = `${eventName.split(':')[0]}:error`;

            logger.error(`Error in ${eventName}:`, {
                error: error.message,
                code: error.code,
                sessionId: socket.sessionId
            });

            socket.emit(errorEvent, sanitizeErrorForClient(error));
        }
    });
}

module.exports = {
    createContextHandler,
    createRoomHandler,
    createHostHandler,
    createGameHandler,
    createSimpleContextHandler,
    createPreRoomHandler
};
