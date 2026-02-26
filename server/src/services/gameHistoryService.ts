import { getRedis } from '../config/redis';
import logger from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';
import { tryParseJSON } from '../utils/parseJSON';
import { withTimeout, TIMEOUTS } from '../utils/timeout';
import { ATOMIC_SAVE_GAME_HISTORY_SCRIPT } from '../scripts';
import { z } from 'zod';

import type { Team, CardType, RedisClient } from '../types';

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

/**
 * Initial board state for replay
 */
export interface InitialBoardState {
    words: string[];
    types: CardType[];
    seed: string;
    firstTeam: Team;
}

/**
 * Final game state
 */
export interface FinalGameState {
    redScore: number;
    blueScore: number;
    redTotal: number;
    blueTotal: number;
    winner: Team;
    gameOver: boolean;
}

/**
 * Team names configuration
 */
export interface TeamNames {
    red: string;
    blue: string;
}

/**
 * Clue given during a game
 */
export interface GameClue {
    team: Team;
    word: string;
    number: number;
    spymaster?: string;
    guessesAllowed?: number;
    timestamp?: number;
}

/**
 * History entry for game actions
 */
export interface HistoryEntry {
    action: 'clue' | 'reveal' | 'endTurn' | 'forfeit';
    timestamp?: number;
    team?: Team;
    word?: string;
    number?: number;
    spymaster?: string;
    guessesAllowed?: number;
    index?: number;
    type?: CardType;
    player?: string;
    guessNumber?: number;
    fromTeam?: Team;
    toTeam?: Team;
    forfeitingTeam?: Team;
    winner?: Team;
}

/**
 * Game data input for saving to history
 */
export interface GameDataInput {
    id?: string;
    words: string[];
    types: CardType[];
    seed: string;
    redScore: number;
    blueScore: number;
    redTotal: number;
    blueTotal: number;
    winner?: Team;
    gameOver?: boolean;
    createdAt?: number;
    clues?: GameClue[];
    history?: HistoryEntry[];
    teamNames?: TeamNames;
    wordListId?: string | null;
    stateVersion?: number;
}

/**
 * Game history entry stored in Redis
 */
export interface GameHistoryEntry {
    id: string;
    roomCode: string;
    timestamp: number;
    startedAt: number;
    endedAt: number;
    initialBoard: InitialBoardState;
    finalState: FinalGameState;
    clues: GameClue[];
    history: HistoryEntry[];
    teamNames: TeamNames;
    wordListId: string | null;
    stateVersion: number;
}

/**
 * How the game ended
 */
export type EndReason = 'completed' | 'assassin' | 'forfeit';

/**
 * Game history summary (for list views)
 */
export interface GameHistorySummary {
    id: string;
    timestamp: number;
    startedAt: number;
    endedAt: number;
    winner?: Team;
    redScore?: number;
    blueScore?: number;
    redTotal?: number;
    blueTotal?: number;
    teamNames?: TeamNames;
    clueCount: number;
    moveCount: number;
    endReason: EndReason;
    duration: number;
}

/**
 * Replay event data
 */
export interface ReplayEvent {
    timestamp?: number;
    type: string;
    data: Record<string, unknown>;
}

/**
 * Replay data structure
 */
export interface ReplayData {
    id: string;
    roomCode: string;
    timestamp: number;
    initialBoard: InitialBoardState;
    events: ReplayEvent[];
    finalState: FinalGameState;
    teamNames: TeamNames;
    duration: number;
    totalMoves: number;
    totalClues: number;
}

/**
 * Validation result
 */
export interface ValidationResult {
    valid: boolean;
    errors: string[];
}

/**
 * History statistics
 */
export interface HistoryStats {
    count: number;
    oldest: { id: string; timestamp: number } | null;
    newest: { id: string; timestamp: number } | null;
    error?: string;
}

// RedisClient and RedisMulti imported from '../types' (shared across all services)

// Configuration
export const GAME_HISTORY_TTL = 30 * 24 * 60 * 60; // 30 days in seconds
const GAME_HISTORY_KEY_PREFIX = 'gameHistory:';
const GAME_HISTORY_INDEX_PREFIX = 'gameHistoryIndex:';
export const MAX_HISTORY_PER_ROOM = 100; // Maximum games to keep per room
const BOARD_SIZE = 25; // Expected board size

/**
 * Validate game data structure before saving to history
 * Prevents corrupted or malformed data from being saved
 */
export function validateGameData(gameData: GameDataInput | null | undefined): ValidationResult {
    const errors: string[] = [];

    // Check required fields exist
    if (!gameData) {
        return { valid: false, errors: ['Game data is null or undefined'] };
    }

    // Validate words array
    if (!Array.isArray(gameData.words)) {
        errors.push('words must be an array');
    } else if (gameData.words.length !== BOARD_SIZE) {
        errors.push(`words array must have ${BOARD_SIZE} elements, got ${gameData.words.length}`);
    } else if (!gameData.words.every(w => typeof w === 'string' && w.length > 0)) {
        errors.push('All words must be non-empty strings');
    }

    // Validate types array
    if (!Array.isArray(gameData.types)) {
        errors.push('types must be an array');
    } else if (gameData.types.length !== BOARD_SIZE) {
        errors.push(`types array must have ${BOARD_SIZE} elements, got ${gameData.types.length}`);
    } else {
        const validTypes = ['red', 'blue', 'neutral', 'assassin'];
        const invalidTypes = gameData.types.filter(t => !validTypes.includes(t));
        if (invalidTypes.length > 0) {
            errors.push(`Invalid card types found: ${invalidTypes.join(', ')}`);
        }
    }

    // Validate seed
    if (typeof gameData.seed !== 'string' || gameData.seed.length === 0) {
        errors.push('seed must be a non-empty string');
    }

    // Validate scores are non-negative integers
    if (typeof gameData.redScore !== 'number' || !Number.isInteger(gameData.redScore) || gameData.redScore < 0) {
        errors.push('redScore must be a non-negative integer');
    }
    if (typeof gameData.blueScore !== 'number' || !Number.isInteger(gameData.blueScore) || gameData.blueScore < 0) {
        errors.push('blueScore must be a non-negative integer');
    }

    // Validate totals
    if (typeof gameData.redTotal !== 'number' || !Number.isInteger(gameData.redTotal) || gameData.redTotal < 0) {
        errors.push('redTotal must be a non-negative integer');
    }
    if (typeof gameData.blueTotal !== 'number' || !Number.isInteger(gameData.blueTotal) || gameData.blueTotal < 0) {
        errors.push('blueTotal must be a non-negative integer');
    }

    // Validate winner if game is over
    if (gameData.gameOver) {
        if (gameData.winner !== 'red' && gameData.winner !== 'blue') {
            errors.push('winner must be "red" or "blue" when game is over');
        }
    }

    // Validate history array if present
    if (gameData.history !== undefined && !Array.isArray(gameData.history)) {
        errors.push('history must be an array if provided');
    }

    // Validate clues array if present
    if (gameData.clues !== undefined && !Array.isArray(gameData.clues)) {
        errors.push('clues must be an array if provided');
    }

    return { valid: errors.length === 0, errors };
}

/**
 * Save a completed game result
 */
export async function saveGameResult(
    roomCode: string,
    gameData: GameDataInput
): Promise<GameHistoryEntry | null> {
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
            errors: validation.errors
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
            firstTeam: getFirstTeam(gameData)
        },

        // Final scores and winner
        finalState: {
            redScore: gameData.redScore,
            blueScore: gameData.blueScore,
            redTotal: gameData.redTotal,
            blueTotal: gameData.blueTotal,
            winner: gameData.winner || 'red',
            gameOver: gameData.gameOver || false
        },

        // All clues given during the game
        clues: gameData.clues || [],

        // Game history (reveals, clues, end turns)
        history: gameData.history || [],

        // Team names (if available from room settings)
        teamNames: gameData.teamNames || { red: 'Red', blue: 'Blue' },

        // Metadata
        wordListId: gameData.wordListId || null,
        stateVersion: gameData.stateVersion || 1
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
                    MAX_HISTORY_PER_ROOM.toString()
                ]
            }),
            TIMEOUTS.REDIS_OPERATION,
            `saveGameResult-lua-${roomCode}`
        );

        logger.info('Game result saved to history', {
            roomCode,
            gameId: historyId,
            winner: gameData.winner,
            redScore: gameData.redScore,
            blueScore: gameData.blueScore
        });

        return historyEntry;

    } catch (error) {
        logger.error('Failed to save game result', {
            roomCode,
            gameId: historyId,
            error: (error as Error).message
        });
        // Don't throw - history saving shouldn't break the application
        return null;
    }
}

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
 * In classic/blitz mode, the first team has more cards (9 vs 8).
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
 * Get game history for a room
 */
export async function getGameHistory(
    roomCode: string,
    limit: number = 10
): Promise<GameHistorySummary[]> {
    const redis: RedisClient = getRedis();

    if (!roomCode) {
        return [];
    }

    try {
        const indexKey = `${GAME_HISTORY_INDEX_PREFIX}${roomCode}`;

        // Get game IDs from sorted set (most recent first)
        const gameIds = await withTimeout(
            redis.zRange(indexKey, 0, limit - 1, { REV: true }),
            TIMEOUTS.REDIS_OPERATION,
            `getGameHistory-zRange-${roomCode}`
        ) as string[];

        if (!gameIds || gameIds.length === 0) {
            return [];
        }

        // Fetch all game entries in parallel
        const gameKeys = gameIds.map(id => `${GAME_HISTORY_KEY_PREFIX}${roomCode}:${id}`);
        const gameDataArray = await withTimeout(
            redis.mGet(gameKeys),
            TIMEOUTS.REDIS_OPERATION,
            `getGameHistory-mGet-${roomCode}`
        );

        // Parse and create summaries
        const summaries: (GameHistorySummary | null)[] = gameDataArray
            .map((data, index): GameHistorySummary | null => {
                if (!data) return null;
                const game = tryParseJSON(data, gameHistoryEntrySchema, `game history ${gameIds[index]}`) as GameHistoryEntry | null;
                if (!game) return null;
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
                    clueCount: game.clues?.length || 0,
                    moveCount: game.history?.length || 0,
                    endReason: deriveEndReason(game),
                    duration: (game.endedAt || 0) - (game.startedAt || 0)
                };
                return summary;
            });

        // Filter out nulls
        const history: GameHistorySummary[] = summaries.filter(
            (g): g is GameHistorySummary => g !== null
        );

        return history;

    } catch (error) {
        logger.error('Failed to get game history', {
            roomCode,
            limit,
            error: (error as Error).message
        });
        return [];
    }
}

/**
 * Get a specific game by ID for replay
 */
export async function getGameById(
    roomCode: string,
    gameId: string
): Promise<GameHistoryEntry | null> {
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

        const game = tryParseJSON(gameData, gameHistoryEntrySchema, `game ${roomCode}:${gameId}`) as GameHistoryEntry | null;
        return game;

    } catch (error) {
        logger.error('Failed to get game by ID', {
            roomCode,
            gameId,
            error: (error as Error).message
        });
        return null;
    }
}

/**
 * Get replay events for a specific game
 * Combines stored history with any additional event log data
 */
export async function getReplayEvents(
    roomCode: string,
    gameId: string
): Promise<ReplayData | null> {
    if (!roomCode || !gameId) {
        return null;
    }

    try {
        // Get the game from history
        const game = await getGameById(roomCode, gameId);

        if (!game) {
            return null;
        }

        // Build structured replay data
        const replayData: ReplayData = {
            id: game.id,
            roomCode: game.roomCode,
            timestamp: game.timestamp,

            // Initial board state
            initialBoard: game.initialBoard,

            // Ordered list of events for replay
            events: buildReplayEvents(game),

            // Final state
            finalState: game.finalState,

            // Team names
            teamNames: game.teamNames,

            // Metadata
            duration: game.endedAt - game.startedAt,
            totalMoves: game.history?.length || 0,
            totalClues: game.clues?.length || 0
        };

        return replayData;

    } catch (error) {
        logger.error('Failed to get replay events', {
            roomCode,
            gameId,
            error: (error as Error).message
        });
        return null;
    }
}

/**
 * Build ordered replay events from game history
 */
function buildReplayEvents(game: GameHistoryEntry): ReplayEvent[] {
    const events: ReplayEvent[] = [];
    const history = game.history || [];

    // Convert history entries to replay events (skip corrupted entries)
    for (const entry of history) {
        if (!entry || typeof entry !== 'object' || !entry.action) {
            logger.warn('Skipping corrupted game history entry (missing action)', { entry });
            continue;
        }

        const event: ReplayEvent = {
            timestamp: entry.timestamp || 0,
            type: entry.action,
            data: {}
        };

        switch (entry.action) {
            case 'clue':
                event.data = {
                    team: entry.team,
                    word: entry.word,
                    number: entry.number,
                    spymaster: entry.spymaster,
                    guessesAllowed: entry.guessesAllowed
                };
                break;

            case 'reveal':
                event.data = {
                    index: entry.index,
                    word: entry.word,
                    type: entry.type,
                    team: entry.team,
                    player: entry.player,
                    guessNumber: entry.guessNumber
                };
                break;

            case 'endTurn':
                event.data = {
                    fromTeam: entry.fromTeam,
                    toTeam: entry.toTeam,
                    player: entry.player
                };
                break;

            case 'forfeit':
                event.data = {
                    forfeitingTeam: entry.forfeitingTeam,
                    winner: entry.winner
                };
                break;

            default: {
                // Log unrecognized entry types so new types are caught early.
                // Still pass through all data for forward compatibility via
                // explicit field extraction (avoids unsafe double-cast).
                const { action: _action, ...rest } = entry;
                logger.warn(`Unrecognized game history entry type: ${_action}`);
                event.data = rest as Record<string, unknown>;
            }
        }

        events.push(event);
    }

    // Sort by timestamp to ensure correct order
    events.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

    return events;
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
        const oldGameIds = await withTimeout(
            redis.zRange(indexKey, 0, -(MAX_HISTORY_PER_ROOM + 1)),
            TIMEOUTS.REDIS_OPERATION,
            `cleanupOldHistory-zRange-${roomCode}`
        ) as string[];

        if (!oldGameIds || oldGameIds.length === 0) {
            return 0;
        }

        // Delete old game entries
        const gameKeys = oldGameIds.map(id => `${GAME_HISTORY_KEY_PREFIX}${roomCode}:${id}`);
        await withTimeout(
            redis.del(gameKeys),
            TIMEOUTS.REDIS_OPERATION,
            `cleanupOldHistory-del-${roomCode}`
        );

        // Remove from index
        await withTimeout(
            redis.zRem(indexKey, oldGameIds),
            TIMEOUTS.REDIS_OPERATION,
            `cleanupOldHistory-zRem-${roomCode}`
        );

        logger.info('Cleaned up old game history', {
            roomCode,
            deletedCount: oldGameIds.length
        });

        return oldGameIds.length;

    } catch (error) {
        logger.error('Failed to cleanup old history', {
            roomCode,
            error: (error as Error).message
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
        const [oldestEntries, newestEntries] = await withTimeout(
            Promise.all([
                redis.zRange(indexKey, 0, 0, { WITHSCORES: true }) as Promise<Array<{ value: string; score: number }>>,
                redis.zRange(indexKey, -1, -1, { WITHSCORES: true }) as Promise<Array<{ value: string; score: number }>>
            ]),
            TIMEOUTS.REDIS_OPERATION,
            `getHistoryStats-zRange-${roomCode}`
        );

        return {
            count,
            oldest: oldestEntries.length > 0 && oldestEntries[0] ? {
                id: oldestEntries[0].value,
                timestamp: oldestEntries[0].score
            } : null,
            newest: newestEntries.length > 0 && newestEntries[0] ? {
                id: newestEntries[0].value,
                timestamp: newestEntries[0].score
            } : null
        };

    } catch (error) {
        logger.error('Failed to get history stats', {
            roomCode,
            error: (error as Error).message
        });
        return { count: 0, oldest: null, newest: null, error: (error as Error).message };
    }
}

