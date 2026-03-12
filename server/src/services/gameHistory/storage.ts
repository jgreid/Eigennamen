import type { RedisClient, Team } from '../../types';
import type { GameDataInput, GameHistoryEntry, GameHistorySummary, EndReason, HistoryStats } from './types';

import { getRedis } from '../../config/redis';
import logger from '../../utils/logger';
import { v4 as uuidv4 } from 'uuid';
import { tryParseJSON } from '../../utils/parseJSON';
import { withTimeout, TIMEOUTS } from '../../utils/timeout';
import { ATOMIC_SAVE_GAME_HISTORY_SCRIPT } from '../../scripts';
import { incrementCounter, METRIC_NAMES } from '../../utils/metrics';
import { z } from 'zod';

import { validateGameData, countCluesFromHistory } from './validation';

// Zod schema for GameHistoryEntry deserialization validation.
// Validates critical fields when present; non-essential fields are optional.
const gameHistoryEntrySchema = z.object({
    id: z.string(),
    roomCode: z.string().optional(),
    timestamp: z.number().optional(),
    startedAt: z.number().optional(),
    endedAt: z.number().optional(),
    initialBoard: z.unknown().optional(),
    finalState: z.unknown().optional(),
    clues: z.array(z.unknown()).nullable().optional(),
    history: z.array(z.unknown()).nullable().optional(),
    winner: z.string().nullable().optional(),
    endReason: z.string().optional(),
    teamNames: z.unknown().optional(),
    wordListId: z.string().nullable().optional(),
    stateVersion: z.number().optional(),
    gameMode: z.string().optional(),
});

// Configuration
export const GAME_HISTORY_TTL = 30 * 24 * 60 * 60; // 30 days in seconds
const GAME_HISTORY_KEY_PREFIX = 'gameHistory:';
const GAME_HISTORY_INDEX_PREFIX = 'gameHistoryIndex:';
export const MAX_HISTORY_PER_ROOM = 100; // Maximum games to keep per room

/**
 * Derive how the game ended from the stored history entries.
 * Checks for forfeit and assassin actions; defaults to 'completed'.
 */
function deriveEndReason(game: GameHistoryEntry): EndReason {
    const history = game.history || [];
    for (const entry of history) {
        if (entry.action === 'forfeit') return 'forfeit';
        if (entry.action === 'reveal' && entry.type === 'assassin') return 'assassin';
    }
    return 'completed';
}

/**
 * Determine which team went first based on board data.
 * In classic mode, the first team has more cards (9 vs 8).
 * Checks totals first (already computed), then falls back to counting
 * the types array directly for robustness against partial game data.
 */
function getFirstTeam(gameData: GameDataInput): Team {
    // Check pre-computed totals first
    if (gameData.redTotal > gameData.blueTotal) return 'red';
    if (gameData.blueTotal > gameData.redTotal) return 'blue';

    // Totals equal or missing — count from the types array as fallback
    if (Array.isArray(gameData.types)) {
        let redCount = 0;
        let blueCount = 0;
        for (const t of gameData.types) {
            if (t === 'red') redCount++;
            else if (t === 'blue') blueCount++;
        }
        if (redCount > blueCount) return 'red';
        if (blueCount > redCount) return 'blue';
    }

    // Default fallback (e.g. duet mode where both teams have equal cards)
    return 'red';
}

/**
 * Save a completed game result
 */
export async function saveGameResult(roomCode: string, gameData: GameDataInput): Promise<GameHistoryEntry | null> {
    const redis: RedisClient = getRedis();

    if (!roomCode || !gameData) {
        logger.warn('saveGameResult called with missing parameters', { roomCode, hasGameData: !!gameData });
        return null;
    }

    // Validate game data before saving
    const validation = validateGameData(gameData);
    if (!validation.valid) {
        logger.error('Invalid game data, refusing to save to history', {
            roomCode,
            errors: validation.errors,
        });
        return null;
    }

    // Generate a unique history ID if game doesn't have one
    const historyId = gameData.id || uuidv4();
    const timestamp = Date.now();

    // Build the history entry with replay data
    const historyEntry: GameHistoryEntry = {
        id: historyId,
        roomCode,
        timestamp,
        startedAt: gameData.createdAt || timestamp,
        endedAt: timestamp,

        // Initial board state for replay
        initialBoard: {
            words: gameData.words,
            types: gameData.types,
            seed: gameData.seed,
            firstTeam: getFirstTeam(gameData),
        },

        // Final scores and winner
        finalState: {
            redScore: gameData.redScore,
            blueScore: gameData.blueScore,
            redTotal: gameData.redTotal,
            blueTotal: gameData.blueTotal,
            winner: gameData.winner || 'red',
            gameOver: gameData.gameOver || false,
        },

        // All clues given during the game
        clues: gameData.clues || [],

        // Game history (reveals, clues, end turns)
        history: gameData.history || [],

        // Team names (if available from room settings)
        teamNames: gameData.teamNames || { red: 'Red', blue: 'Blue' },

        // Metadata
        wordListId: gameData.wordListId || null,
        stateVersion: gameData.stateVersion || 1,
    };

    try {
        const gameKey = `${GAME_HISTORY_KEY_PREFIX}${roomCode}:${historyId}`;
        const indexKey = `${GAME_HISTORY_INDEX_PREFIX}${roomCode}`;

        // Atomic Lua script: SET + ZADD(NX) + ZREMRANGEBYRANK + EXPIRE
        // Replaces the previous redis.multi() pipeline which was not truly atomic
        // (partial writes were possible if the server crashed mid-execution).
        await withTimeout(
            redis.eval(ATOMIC_SAVE_GAME_HISTORY_SCRIPT, {
                keys: [gameKey, indexKey],
                arguments: [
                    JSON.stringify(historyEntry),
                    historyId,
                    timestamp.toString(),
                    GAME_HISTORY_TTL.toString(),
                    MAX_HISTORY_PER_ROOM.toString(),
                ],
            }),
            TIMEOUTS.REDIS_OPERATION,
            `saveGameResult-lua-${roomCode}`
        );

        logger.info('Game result saved to history', {
            roomCode,
            gameId: historyId,
            winner: gameData.winner,
            redScore: gameData.redScore,
            blueScore: gameData.blueScore,
        });

        return historyEntry;
    } catch (error) {
        logger.error('Failed to save game result', {
            roomCode,
            gameId: historyId,
            error: (error as Error).message,
        });
        // Don't throw - history saving shouldn't break the application
        return null;
    }
}

/**
 * Get game history for a room
 */
export async function getGameHistory(roomCode: string, limit: number = 10): Promise<GameHistorySummary[]> {
    const redis: RedisClient = getRedis();

    if (!roomCode) {
        return [];
    }

    try {
        const indexKey = `${GAME_HISTORY_INDEX_PREFIX}${roomCode}`;

        // Get game IDs from sorted set (most recent first)
        const gameIds = (await withTimeout(
            redis.zRange(indexKey, 0, limit - 1, { REV: true }),
            TIMEOUTS.REDIS_OPERATION,
            `getGameHistory-zRange-${roomCode}`
        )) as string[];

        if (!gameIds || gameIds.length === 0) {
            return [];
        }

        // Fetch all game entries in parallel
        const gameKeys = gameIds.map((id) => `${GAME_HISTORY_KEY_PREFIX}${roomCode}:${id}`);
        const gameDataArray = await withTimeout(
            redis.mGet(gameKeys),
            TIMEOUTS.REDIS_OPERATION,
            `getGameHistory-mGet-${roomCode}`
        );

        // Parse and create summaries, tracking dropped entries
        const droppedIds: string[] = [];
        const summaries: (GameHistorySummary | null)[] = gameDataArray.map((data, index): GameHistorySummary | null => {
            const gameId = gameIds[index] ?? `unknown-${index}`;
            if (!data) {
                droppedIds.push(gameId);
                return null;
            }
            const game = tryParseJSON(
                data,
                gameHistoryEntrySchema,
                `game history ${gameId}`
            ) as GameHistoryEntry | null;
            if (!game) {
                droppedIds.push(gameId);
                return null;
            }
            // Return summary (not full replay data)
            const summary: GameHistorySummary = {
                id: game.id,
                timestamp: game.timestamp,
                startedAt: game.startedAt,
                endedAt: game.endedAt,
                winner: game.finalState?.winner,
                redScore: game.finalState?.redScore,
                blueScore: game.finalState?.blueScore,
                redTotal: game.finalState?.redTotal,
                blueTotal: game.finalState?.blueTotal,
                teamNames: game.teamNames,
                clueCount: countCluesFromHistory(game.history),
                moveCount: game.history?.length || 0,
                endReason: deriveEndReason(game),
                duration: (game.endedAt || 0) - (game.startedAt || 0),
            };
            return summary;
        });

        if (droppedIds.length > 0) {
            logger.warn('Dropped corrupted or missing game history entries', {
                roomCode,
                droppedCount: droppedIds.length,
                droppedIds,
            });
            incrementCounter(METRIC_NAMES.HISTORY_ENTRIES_DROPPED, droppedIds.length, { roomCode });
        }

        // Filter out nulls
        const history: GameHistorySummary[] = summaries.filter((g): g is GameHistorySummary => g !== null);

        return history;
    } catch (error) {
        logger.error('Failed to get game history', {
            roomCode,
            limit,
            error: (error as Error).message,
        });
        return [];
    }
}

/**
 * Get a specific game by ID for replay
 */
export async function getGameById(roomCode: string, gameId: string): Promise<GameHistoryEntry | null> {
    const redis: RedisClient = getRedis();

    if (!roomCode || !gameId) {
        return null;
    }

    try {
        const gameKey = `${GAME_HISTORY_KEY_PREFIX}${roomCode}:${gameId}`;
        const gameData = await withTimeout(
            redis.get(gameKey),
            TIMEOUTS.REDIS_OPERATION,
            `getGameById-${roomCode}-${gameId}`
        );

        if (!gameData) {
            logger.debug('Game not found in history', { roomCode, gameId });
            return null;
        }

        const game = tryParseJSON(
            gameData,
            gameHistoryEntrySchema,
            `game ${roomCode}:${gameId}`
        ) as GameHistoryEntry | null;
        if (!game) {
            logger.warn('Game history entry failed schema validation', { roomCode, gameId });
            incrementCounter(METRIC_NAMES.HISTORY_ENTRIES_DROPPED, 1, { roomCode });
        }
        return game;
    } catch (error) {
        logger.error('Failed to get game by ID', {
            roomCode,
            gameId,
            error: (error as Error).message,
        });
        return null;
    }
}

/**
 * Delete old game history for a room (cleanup function)
 */
export async function cleanupOldHistory(roomCode: string): Promise<number> {
    const redis: RedisClient = getRedis();

    if (!roomCode) {
        return 0;
    }

    try {
        const indexKey = `${GAME_HISTORY_INDEX_PREFIX}${roomCode}`;

        // Get all game IDs that exceed the limit
        const oldGameIds = (await withTimeout(
            redis.zRange(indexKey, 0, -(MAX_HISTORY_PER_ROOM + 1)),
            TIMEOUTS.REDIS_OPERATION,
            `cleanupOldHistory-zRange-${roomCode}`
        )) as string[];

        if (!oldGameIds || oldGameIds.length === 0) {
            return 0;
        }

        // Delete old game entries
        const gameKeys = oldGameIds.map((id) => `${GAME_HISTORY_KEY_PREFIX}${roomCode}:${id}`);
        await withTimeout(redis.del(gameKeys), TIMEOUTS.REDIS_OPERATION, `cleanupOldHistory-del-${roomCode}`);

        // Remove from index
        await withTimeout(
            redis.zRem(indexKey, oldGameIds),
            TIMEOUTS.REDIS_OPERATION,
            `cleanupOldHistory-zRem-${roomCode}`
        );

        logger.info('Cleaned up old game history', {
            roomCode,
            deletedCount: oldGameIds.length,
        });

        return oldGameIds.length;
    } catch (error) {
        logger.error('Failed to cleanup old history', {
            roomCode,
            error: (error as Error).message,
        });
        return 0;
    }
}

/**
 * Clear all game history for a room
 */
export async function clearRoomHistory(roomCode: string): Promise<number> {
    const redis: RedisClient = getRedis();

    if (!roomCode) {
        return 0;
    }

    try {
        const indexKey = `${GAME_HISTORY_INDEX_PREFIX}${roomCode}`;

        // Get all game IDs from the sorted set
        const gameIds = (await withTimeout(
            redis.zRange(indexKey, 0, -1),
            TIMEOUTS.REDIS_OPERATION,
            `clearRoomHistory-zRange-${roomCode}`
        )) as string[];

        if (!gameIds || gameIds.length === 0) {
            return 0;
        }

        // Delete all individual game entries
        const gameKeys = gameIds.map((id) => `${GAME_HISTORY_KEY_PREFIX}${roomCode}:${id}`);
        await withTimeout(redis.del(gameKeys), TIMEOUTS.REDIS_OPERATION, `clearRoomHistory-del-${roomCode}`);

        // Delete the index itself
        await withTimeout(redis.del(indexKey), TIMEOUTS.REDIS_OPERATION, `clearRoomHistory-delIndex-${roomCode}`);

        logger.info('Cleared all game history for room', {
            roomCode,
            deletedCount: gameIds.length,
        });

        return gameIds.length;
    } catch (error) {
        logger.error('Failed to clear room history', {
            roomCode,
            error: (error as Error).message,
        });
        return 0;
    }
}

/**
 * Get statistics for game history
 */
export async function getHistoryStats(roomCode: string): Promise<HistoryStats> {
    const redis: RedisClient = getRedis();

    if (!roomCode) {
        return { count: 0, oldest: null, newest: null };
    }

    try {
        const indexKey = `${GAME_HISTORY_INDEX_PREFIX}${roomCode}`;

        const count = await withTimeout(
            redis.zCard(indexKey),
            TIMEOUTS.REDIS_OPERATION,
            `getHistoryStats-zCard-${roomCode}`
        );
        if (count === 0) {
            return { count: 0, oldest: null, newest: null };
        }

        // Get oldest and newest entries
        const [oldestRaw, newestRaw] = await withTimeout(
            Promise.all([
                redis.zRange(indexKey, 0, 0, { WITHSCORES: true }),
                redis.zRange(indexKey, -1, -1, { WITHSCORES: true }),
            ]),
            TIMEOUTS.REDIS_OPERATION,
            `getHistoryStats-zRange-${roomCode}`
        );

        // Safely extract value/score from the result — handles both
        // { value, score } objects and flat string arrays depending on Redis client version
        function extractEntry(entries: unknown[]): { id: string; timestamp: number } | null {
            const first = entries[0];
            if (!first) return null;
            if (typeof first === 'object' && first !== null && 'value' in first && 'score' in first) {
                const entry = first as { value: string; score: number };
                return { id: entry.value, timestamp: entry.score };
            }
            // Flat array fallback: [member, score, ...]
            if (typeof first === 'string' && entries.length >= 2) {
                const score = Number(entries[1]);
                return { id: first, timestamp: Number.isFinite(score) ? score : 0 };
            }
            return null;
        }

        return {
            count,
            oldest: extractEntry(oldestRaw as unknown[]),
            newest: extractEntry(newestRaw as unknown[]),
        };
    } catch (error) {
        logger.error('Failed to get history stats', {
            roomCode,
            error: (error as Error).message,
        });
        return { count: 0, oldest: null, newest: null, error: (error as Error).message };
    }
}
