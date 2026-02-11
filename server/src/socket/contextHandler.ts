/**
 * Context-Aware Handler Wrapper
 *
 * Combines rate limiting with player context validation to eliminate
 * boilerplate across all socket handlers.
 */

import type { ZodSchema } from 'zod';
import type { Player } from '../types';
import type { GameSocket } from './rateLimitHandler';
import type { PlayerContextOptions, PlayerContextResult } from './playerContext';

const { getPlayerContext, syncSocketRooms } = require('./playerContext');
const { createRateLimitedHandler } = require('./rateLimitHandler');
const { validateInput } = require('../middleware/validation');

export interface HandlerResult {
    player?: Player;
    [key: string]: unknown;
}

export type ContextHandlerFn<T = unknown> = (
    ctx: PlayerContextResult,
    validated: T
) => Promise<HandlerResult | void>;

export type PreRoomHandlerFn<T = unknown> = (
    validated: T
) => Promise<void>;

type AckCallback = (response: { ok?: boolean; error?: boolean }) => void;
type RateLimitedHandler = (data: unknown, ackCallback?: AckCallback) => Promise<void>;

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
    });
}

/** Room-required operations (most common case) */
function createRoomHandler<T = unknown>(
    socket: GameSocket,
    eventName: string,
    schema: ZodSchema<T> | null,
    handler: ContextHandlerFn<T>
): RateLimitedHandler {
    return createContextHandler(socket, eventName, schema, { requireRoom: true }, handler);
}

/** Host-only operations */
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

/** Game operations (requires active game) */
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

/** Pre-room operations (room:create, room:join) - no player context needed */
function createPreRoomHandler<T = unknown>(
    socket: GameSocket,
    eventName: string,
    schema: ZodSchema<T> | null,
    handler: PreRoomHandlerFn<T>
): RateLimitedHandler {
    return createRateLimitedHandler(socket, eventName, async (data: unknown) => {
        const validated = schema ? validateInput(schema, data) as T : (data || {}) as T;
        await handler(validated);
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
