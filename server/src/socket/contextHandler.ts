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

import type { ZodSchema } from 'zod';
import type { Player } from '../types';
import type { GameSocket } from './rateLimitHandler';
import type { PlayerContextOptions, PlayerContextResult } from './playerContext';

/* eslint-disable @typescript-eslint/no-var-requires */
const { getPlayerContext, syncSocketRooms } = require('./playerContext');
const { createRateLimitedHandler } = require('./rateLimitHandler');
const { validateInput } = require('../middleware/validation');
/* eslint-enable @typescript-eslint/no-var-requires */

/**
 * Handler result that may include updated player for room syncing
 */
export interface HandlerResult {
    player?: Player;
    [key: string]: unknown;
}

/**
 * Context handler function type
 */
export type ContextHandlerFn<T = unknown> = (
    ctx: PlayerContextResult,
    validated: T
) => Promise<HandlerResult | void>;

/**
 * Pre-room handler function type (no context needed)
 */
export type PreRoomHandlerFn<T = unknown> = (
    validated: T
) => Promise<void>;

/**
 * Acknowledgment callback type
 */
type AckCallback = (response: { ok?: boolean; error?: boolean }) => void;

/**
 * Rate-limited handler function type
 */
type RateLimitedHandler = (data: unknown, ackCallback?: AckCallback) => Promise<void>;

/**
 * Create a handler with automatic context validation and rate limiting.
 *
 * @param socket - Socket.io socket instance
 * @param eventName - Event name for rate limiting and logging
 * @param schema - Zod schema for input validation (or null if no input)
 * @param contextOptions - Options for getPlayerContext
 * @param handler - Async handler function (ctx, validatedData) => Promise<void>
 * @returns Wrapped handler
 */
function createContextHandler<T = unknown>(
    socket: GameSocket,
    eventName: string,
    schema: ZodSchema<T> | null,
    contextOptions: PlayerContextOptions,
    handler: ContextHandlerFn<T>
): RateLimitedHandler {
    return createRateLimitedHandler(socket, eventName, async (data: unknown) => {
        const validated = schema ? validateInput(schema, data) as T : (data || {}) as T;
        const ctx: PlayerContextResult = await getPlayerContext(socket, contextOptions);

        // Snapshot previous player state before handler modifies it
        const previousPlayer = ctx.player ? { ...ctx.player } : null;

        const result = await handler(ctx, validated);

        // Sync socket rooms if handler returned updated player
        if (result && result.player) {
            syncSocketRooms(socket, result.player, previousPlayer);
        }

        return result;
        // Bug #11 fix: Errors are no longer caught here - they propagate to rateLimitHandler
        // which emits the error event and sends ACK with { error: true }
        // Previously errors were caught and error event emitted, but ACK returned { ok: true }
    });
}

/**
 * Context handler for room-required operations (most common case).
 */
function createRoomHandler<T = unknown>(
    socket: GameSocket,
    eventName: string,
    schema: ZodSchema<T> | null,
    handler: ContextHandlerFn<T>
): RateLimitedHandler {
    return createContextHandler(socket, eventName, schema, { requireRoom: true }, handler);
}

/**
 * Context handler for host-only operations.
 */
function createHostHandler<T = unknown>(
    socket: GameSocket,
    eventName: string,
    schema: ZodSchema<T> | null,
    handler: ContextHandlerFn<T>
): RateLimitedHandler {
    return createContextHandler(socket, eventName, schema, {
        requireRoom: true,
        requireHost: true
    }, handler);
}

/**
 * Context handler for game operations (requires active game).
 */
function createGameHandler<T = unknown>(
    socket: GameSocket,
    eventName: string,
    schema: ZodSchema<T> | null,
    handler: ContextHandlerFn<T>
): RateLimitedHandler {
    return createContextHandler(socket, eventName, schema, {
        requireRoom: true,
        requireGame: true
    }, handler);
}

/**
 * Context handler for pre-room operations (room:create, room:join).
 * Provides rate limiting, input validation, and consistent error handling
 * without requiring the player to already be in a room.
 */
function createPreRoomHandler<T = unknown>(
    socket: GameSocket,
    eventName: string,
    schema: ZodSchema<T> | null,
    handler: PreRoomHandlerFn<T>
): RateLimitedHandler {
    return createRateLimitedHandler(socket, eventName, async (data: unknown) => {
        const validated = schema ? validateInput(schema, data) as T : (data || {}) as T;
        await handler(validated);
        // Bug #11 fix: Errors propagate to rateLimitHandler for consistent error handling
    });
}

module.exports = {
    createContextHandler,
    createRoomHandler,
    createHostHandler,
    createGameHandler,
    createPreRoomHandler
};

export {
    createContextHandler,
    createRoomHandler,
    createHostHandler,
    createGameHandler,
    createPreRoomHandler
};
