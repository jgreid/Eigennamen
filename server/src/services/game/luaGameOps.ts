/**
 * Lua Game Operations - Lua script execution and Redis transactions
 *
 * Provides executeLuaScript for atomic game operations (revealCard,
 * endTurn) and executeGameTransaction for operations without Lua scripts
 * (forfeitGame).
 */

import type { GameState, RedisClient as SharedRedisClient } from '../../types';

import { z } from 'zod';
import { getRedis } from '../../config/redis';
import logger from '../../utils/logger';
import { withTimeout, TIMEOUTS } from '../../utils/timeout';
import { parseJSON, tryParseJSON } from '../../utils/parseJSON';
import {
    REDIS_TTL,
    GAME_HISTORY,
    RETRY_CONFIG
} from '../../config/constants';
import {
    GameStateError,
    ServerError
} from '../../errors/GameError';
import { REVEAL_CARD_SCRIPT, END_TURN_SCRIPT } from '../../scripts';

// Re-export Lua scripts from centralized barrel (previously loaded from disk here)
export const OPTIMIZED_REVEAL_SCRIPT: string = REVEAL_CARD_SCRIPT;
export const OPTIMIZED_END_TURN_SCRIPT: string = END_TURN_SCRIPT;

// Lua cjson roundtrip converts empty arrays [] to empty objects {}.
// This preprocessor normalizes empty objects back to empty arrays so
// Zod's z.array() validation succeeds after Lua script re-encodes game state.
const emptyObjToArray = (val: unknown) =>
    val && typeof val === 'object' && !Array.isArray(val) && Object.keys(val as object).length === 0
        ? []
        : val;

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
    clues: z.preprocess(emptyObjToArray, z.array(z.unknown())).optional(),
    history: z.preprocess(emptyObjToArray, z.array(z.unknown())).optional(),
    stateVersion: z.number().optional(),
    createdAt: z.number().optional(),
    gameMode: z.string().optional(),
    wordListId: z.string().nullable().optional(),
    duetTypes: z.preprocess(emptyObjToArray, z.array(z.string())).optional(),
    timerTokens: z.number().optional(),
    greenFound: z.number().optional(),
    greenTotal: z.number().optional(),
});

const luaResultObjectSchema = z.record(z.unknown());

// Re-export schemas for use by gameService
export { gameStateSchema, luaResultObjectSchema };

// Centralized constants
export const MAX_HISTORY_ENTRIES: number = GAME_HISTORY.MAX_ENTRIES;
const MAX_TRANSACTION_RETRIES: number = RETRY_CONFIG.OPTIMISTIC_LOCK.maxRetries;
const TRANSACTION_BASE_DELAY_MS: number = RETRY_CONFIG.OPTIMISTIC_LOCK.baseDelayMs;

// RedisClient imported from '../../types' (shared across all services)
type RedisClient = SharedRedisClient;
export type { RedisClient };

/** Type signature for executeLuaScript (used by gameService's import). */
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
 * Execute a Redis transaction with optimistic locking and retries.
 * Used by operations that don't have a Lua script (e.g., forfeitGame).
 */
export async function executeGameTransaction<T>(
    gameKey: string,
    operation: (game: GameState) => T | Promise<T>,
    _operationName: string
): Promise<T> {
    const redis: RedisClient = getRedis();
    const roomCode = gameKey.replace('room:', '').replace(':game', '');
    let retries = 0;

    /* eslint-disable no-await-in-loop */
    while (retries < MAX_TRANSACTION_RETRIES) {
        try {
            await withTimeout(redis.watch(gameKey), TIMEOUTS.REDIS_OPERATION, `${_operationName}-watch`);

            const gameData = await withTimeout(redis.get(gameKey), TIMEOUTS.REDIS_OPERATION, `${_operationName}-get`);
            if (!gameData) {
                await redis.unwatch().catch(() => { /* best-effort */ });
                throw GameStateError.noActiveGame();
            }

            const game = safeParseGameData(gameData, roomCode);
            if (!game) {
                await redis.unwatch().catch(() => { /* best-effort */ });
                await withTimeout(redis.del(gameKey), TIMEOUTS.REDIS_OPERATION, `${_operationName}-delCorrupted`);
                throw GameStateError.corrupted(roomCode);
            }

            const result = await operation(game);

            incrementVersion(game);

            const currentTTL = await withTimeout(redis.ttl(gameKey), TIMEOUTS.REDIS_OPERATION, `${_operationName}-ttl`);
            const ttl = currentTTL > 0 ? currentTTL : REDIS_TTL.ROOM;

            const txResult = await withTimeout(
                redis.multi()
                    .set(gameKey, JSON.stringify(game), { EX: ttl })
                    .exec(),
                TIMEOUTS.REDIS_OPERATION,
                `${_operationName}-exec`
            );

            if (txResult === null) {
                // WATCH is automatically consumed after exec(), no unwatch needed
                retries++;
                if (retries < MAX_TRANSACTION_RETRIES) {
                    // Exponential backoff to reduce contention
                    const delay = TRANSACTION_BASE_DELAY_MS * Math.pow(2, retries - 1);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
                continue;
            }

            return result;

        } catch (error) {
            try { await redis.unwatch(); } catch { /* don't mask original error */ }
            throw error;
        }
    }
    /* eslint-enable no-await-in-loop */

    throw ServerError.concurrentModification();
}

