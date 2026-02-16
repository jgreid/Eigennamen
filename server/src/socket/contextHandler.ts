/**
 * Context-Aware Handler Wrapper
 *
 * Combines rate limiting with player context validation to eliminate
 * boilerplate across all socket handlers.
 */

import type { ZodSchema } from 'zod';
import type { Player, GameState } from '../types';
import type { GameSocket } from './rateLimitHandler';
import type { PlayerContextOptions, PlayerContextResult } from './playerContext';
import type { RoomContext, GameContext } from './handlers/types';

import { getPlayerContext, syncSocketRooms } from './playerContext';
import { createRateLimitedHandler } from './rateLimitHandler';
import { validateInput } from '../middleware/validation';

export interface HandlerResult {
    player?: Player;
    [key: string]: unknown;
}

export type ContextHandlerFn<T = unknown> = (
    ctx: PlayerContextResult,
    validated: T
) => Promise<HandlerResult | void>;

export type RoomHandlerFn<T = unknown> = (
    ctx: RoomContext,
    validated: T
) => Promise<HandlerResult | void>;

export type GameHandlerFn<T = unknown> = (
    ctx: GameContext,
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
    return createRateLimitedHandler(socket, eventName, async (data: unknown): Promise<void> => {
        const validated = schema ? validateInput(schema, data) as T : (data || {}) as T;
        const ctx: PlayerContextResult = await getPlayerContext(socket, contextOptions);

        // Snapshot previous player state before handler modifies it
        const previousPlayer = ctx.player ? { ...ctx.player } : null;

        const result = await handler(ctx, validated);

        // Sync socket rooms if handler returned updated player
        if (result && result.player) {
            syncSocketRooms(socket, result.player, previousPlayer);
        }
    });
}

/**
 * Narrow PlayerContextResult to RoomContext.
 * Safe when requireRoom: true guarantees non-null roomCode and player.
 */
function toRoomContext(ctx: PlayerContextResult): RoomContext {
    return {
        sessionId: ctx.sessionId,
        roomCode: ctx.roomCode as string,
        player: ctx.player as Player,
        game: ctx.game
    };
}

/**
 * Narrow PlayerContextResult to GameContext.
 * Safe when requireGame: true guarantees non-null game.
 */
function toGameContext(ctx: PlayerContextResult): GameContext {
    return {
        sessionId: ctx.sessionId,
        roomCode: ctx.roomCode as string,
        player: ctx.player as Player,
        game: ctx.game as GameState
    };
}

/** Room-required operations (most common case) */
function createRoomHandler<T = unknown>(
    socket: GameSocket,
    eventName: string,
    schema: ZodSchema<T> | null,
    handler: RoomHandlerFn<T>
): RateLimitedHandler {
    return createContextHandler(socket, eventName, schema, { requireRoom: true },
        (ctx, validated) => handler(toRoomContext(ctx), validated));
}

/** Host-only operations */
function createHostHandler<T = unknown>(
    socket: GameSocket,
    eventName: string,
    schema: ZodSchema<T> | null,
    handler: RoomHandlerFn<T>
): RateLimitedHandler {
    return createContextHandler(socket, eventName, schema, {
        requireRoom: true,
        requireHost: true
    }, (ctx, validated) => handler(toRoomContext(ctx), validated));
}

/** Game operations (requires active game) */
function createGameHandler<T = unknown>(
    socket: GameSocket,
    eventName: string,
    schema: ZodSchema<T> | null,
    handler: GameHandlerFn<T>
): RateLimitedHandler {
    return createContextHandler(socket, eventName, schema, {
        requireRoom: true,
        requireGame: true
    }, (ctx, validated) => handler(toGameContext(ctx), validated));
}

/** Pre-room operations (room:create, room:join) - no player context needed */
function createPreRoomHandler<T = unknown>(
    socket: GameSocket,
    eventName: string,
    schema: ZodSchema<T> | null,
    handler: PreRoomHandlerFn<T>
): RateLimitedHandler {
    return createRateLimitedHandler(socket, eventName, async (data: unknown): Promise<void> => {
        const validated = schema ? validateInput(schema, data) as T : (data || {}) as T;
        await handler(validated);
    });
}

export {
    createContextHandler,
    createRoomHandler,
    createHostHandler,
    createGameHandler,
    createPreRoomHandler
};
