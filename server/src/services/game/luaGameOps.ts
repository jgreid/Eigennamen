/**
 * Lua Game Operations - Generic Lua script execution with TypeScript fallback
 *
 * Eliminates the duplicated try-Lua-catch-fallback pattern that was
 * copy-pasted across revealCard, giveClue, and endTurn.
 */

import type { GameState, RedisClient as SharedRedisClient } from '../../types';

const fs = require('fs');
const path = require('path');
const { z } = require('zod');
const { getRedis } = require('../../config/redis');
const logger = require('../../utils/logger');
const { withTimeout, TIMEOUTS } = require('../../utils/timeout');
const { parseJSON } = require('../../utils/parseJSON');
const { tryParseJSON } = require('../../utils/parseJSON');
const {
    ERROR_CODES,
    REDIS_TTL,
    GAME_HISTORY,
    RETRY_CONFIG
} = require('../../config/constants');
const {
    GameStateError,
    ServerError
} = require('../../errors/GameError');

// Lua scripts loaded once at module initialization
export const OPTIMIZED_REVEAL_SCRIPT: string = fs.readFileSync(path.join(__dirname, '../../scripts/revealCard.lua'), 'utf8');
export const OPTIMIZED_GIVE_CLUE_SCRIPT: string = fs.readFileSync(path.join(__dirname, '../../scripts/giveClue.lua'), 'utf8');
export const OPTIMIZED_END_TURN_SCRIPT: string = fs.readFileSync(path.join(__dirname, '../../scripts/endTurn.lua'), 'utf8');

// Zod schemas
const gameStateSchema = z.object({
    id: z.string(),
    seed: z.string().optional(),
    words: z.array(z.string()).optional(),
    types: z.array(z.string()).optional(),
    revealed: z.array(z.boolean()).optional(),
    currentTurn: z.string().optional(),
    redScore: z.number().optional(),
    blueScore: z.number().optional(),
    redTotal: z.number().optional(),
    blueTotal: z.number().optional(),
    gameOver: z.boolean().optional(),
    winner: z.string().nullable().optional(),
    currentClue: z.unknown().optional(),
    guessesUsed: z.number().optional(),
    guessesAllowed: z.number().optional(),
    clues: z.array(z.unknown()).optional(),
    history: z.array(z.unknown()).optional(),
    stateVersion: z.number().optional(),
    createdAt: z.number().optional(),
    gameMode: z.string().optional(),
    wordListId: z.string().nullable().optional(),
    duetTypes: z.array(z.string()).optional(),
    timerTokens: z.number().optional(),
    greenFound: z.number().optional(),
    greenTotal: z.number().optional(),
});

const gameModePreCheckSchema = z.object({
    gameMode: z.string().optional(),
});

const luaResultObjectSchema = z.record(z.unknown());

// Re-export schemas for use by gameService
export { gameStateSchema, gameModePreCheckSchema, luaResultObjectSchema };

// Centralized constants
export const MAX_HISTORY_ENTRIES: number = GAME_HISTORY.MAX_ENTRIES;
export const MAX_CLUES: number = GAME_HISTORY.MAX_CLUES;
const MAX_TRANSACTION_RETRIES: number = RETRY_CONFIG.OPTIMISTIC_LOCK.maxRetries;

// RedisClient imported from '../../types' (shared across all services)
type RedisClient = SharedRedisClient;
export type { RedisClient };

/** Type signature for executeLuaScript (used by gameService's require()-based import). */
export type ExecuteLuaScript = <T>(
    script: string,
    gameKey: string,
    args: string[],
    errorMap: Record<string, Error | { code: string; message: string }>,
    operationName: string
) => Promise<T>;

/**
 * Safely parse game data from Redis
 */
export function safeParseGameData(gameData: string, roomCode: string): GameState | null {
    return tryParseJSON(gameData, gameStateSchema, `game state for ${roomCode}`) as GameState | null;
}

/**
 * Check if a game is in Duet mode without full deserialization
 */
export async function isDuetMode(gameKey: string): Promise<boolean> {
    const redis: RedisClient = getRedis();
    const preCheckData = await redis.get(gameKey);
    if (!preCheckData) return false;
    return tryParseJSON(preCheckData, gameModePreCheckSchema, `duet pre-check`)?.gameMode === 'duet';
}

/**
 * Increment game state version (for optimistic locking/conflict detection)
 */
export function incrementVersion(game: GameState): number {
    game.stateVersion = (game.stateVersion || 0) + 1;
    return game.stateVersion;
}

/**
 * Execute a Lua script against Redis with timeout and result parsing.
 *
 * @param script - The Lua script source
 * @param gameKey - Redis key for the game state
 * @param args - Arguments to pass to the Lua script
 * @param errorMap - Maps Lua error codes to JavaScript errors
 * @param operationName - Name for logging/timeout tracking
 * @returns The parsed Lua result
 */
export async function executeLuaScript<T>(
    script: string,
    gameKey: string,
    args: string[],
    errorMap: Record<string, Error | { code: string; message: string }>,
    operationName: string
): Promise<T> {
    const redis: RedisClient = getRedis();

    const resultStr = await withTimeout(
        redis.eval(script, { keys: [gameKey], arguments: args }),
        TIMEOUTS.REDIS_OPERATION,
        `${operationName}-lua`
    ) as string | null;

    if (!resultStr || typeof resultStr !== 'string') {
        throw new ServerError('Invalid Lua script result: empty or non-string');
    }

    let result: T & { error?: string; word?: string };
    try {
        result = parseJSON(resultStr, luaResultObjectSchema, `${operationName} Lua result`) as T & { error?: string; word?: string };
    } catch (parseError) {
        logger.error(`Failed to parse Lua ${operationName} result`, { error: (parseError as Error).message });
        throw new ServerError('Failed to parse game operation result');
    }

    if (result.error) {
        const err = errorMap[result.error];
        if (err) throw err;
        throw new ServerError(result.error);
    }

    return result;
}

/**
 * Execute a game operation with Lua optimization and TypeScript fallback.
 *
 * This is the generic pattern that replaces the duplicated try-Lua-catch-fallback
 * code in revealCard, giveClue, and endTurn.
 *
 * @param gameKey - Redis key for the game state
 * @param luaScript - Lua script to try first
 * @param luaArgs - Arguments for the Lua script
 * @param luaErrorMap - Error mapping for Lua error codes
 * @param fallback - TypeScript fallback function if Lua fails
 * @param operationName - Name for logging
 * @param skipLuaForDuet - Whether to skip Lua for Duet mode (default true)
 */
export async function withLuaFallback<T>(
    gameKey: string,
    luaScript: string,
    luaArgs: string[],
    luaErrorMap: Record<string, Error | { code: string; message: string }>,
    fallback: () => Promise<T>,
    operationName: string,
    skipLuaForDuet: boolean = true
): Promise<T> {
    // Check if Duet mode — skip Lua for Duet games
    if (skipLuaForDuet && await isDuetMode(gameKey)) {
        return fallback();
    }

    // Try Lua script first
    try {
        return await executeLuaScript<T>(luaScript, gameKey, luaArgs, luaErrorMap, operationName);
    } catch (luaError) {
        // Propagate game logic errors (known error codes)
        if ((luaError as { code?: string }).code && (luaError as { code?: string }).code !== ERROR_CODES.SERVER_ERROR) {
            throw luaError;
        }
        logger.warn(`Lua ${operationName} failed, falling back to TypeScript: ${(luaError as Error).message}`);
    }

    // Fall back to TypeScript implementation
    return fallback();
}

/**
 * Execute a Redis transaction with optimistic locking and retries.
 * Used by the TypeScript fallback path.
 */
export async function executeGameTransaction<T>(
    gameKey: string,
    operation: (game: GameState) => T | Promise<T>,
    _operationName: string
): Promise<T> {
    const redis: RedisClient = getRedis();
    const roomCode = gameKey.replace('room:', '').replace(':game', '');
    let retries = 0;

    while (retries < MAX_TRANSACTION_RETRIES) {
        try {
            await redis.watch(gameKey);

            const gameData = await redis.get(gameKey);
            if (!gameData) {
                await redis.unwatch();
                throw GameStateError.noActiveGame();
            }

            const game = safeParseGameData(gameData, roomCode);
            if (!game) {
                await redis.unwatch();
                await redis.del(gameKey);
                throw GameStateError.corrupted(roomCode);
            }

            const result = await operation(game);

            incrementVersion(game);

            const currentTTL = await redis.ttl(gameKey);
            const ttl = currentTTL > 0 ? currentTTL : REDIS_TTL.ROOM;

            const txResult = await redis.multi()
                .set(gameKey, JSON.stringify(game), { EX: ttl })
                .exec();

            if (txResult === null) {
                await redis.unwatch();
                retries++;
                continue;
            }

            return result;

        } catch (error) {
            await redis.unwatch();
            throw error;
        }
    }

    throw ServerError.concurrentModification();
}

module.exports = {
    OPTIMIZED_REVEAL_SCRIPT,
    OPTIMIZED_GIVE_CLUE_SCRIPT,
    OPTIMIZED_END_TURN_SCRIPT,
    gameStateSchema,
    gameModePreCheckSchema,
    luaResultObjectSchema,
    MAX_HISTORY_ENTRIES,
    MAX_CLUES,
    safeParseGameData,
    isDuetMode,
    incrementVersion,
    executeLuaScript,
    withLuaFallback,
    executeGameTransaction
};
