/**
 * Game Service - Orchestration layer
 *
 * Delegates to focused modules:
 *   - game/boardGenerator: PRNG, shuffling, board layout
 *   - game/revealEngine: Player state view, card validation
 *   - game/luaGameOps: Lua script execution, transactions, schemas
 *
 * This file handles game lifecycle (create, get, cleanup) and
 * the async operations that coordinate Redis + Lua.
 */

import type {
    Team,
    GameState,
    ForfeitHistoryEntry,
    GameHistoryEntry,
    CreateGameOptions,
    RevealResult,
    EndTurnResult,
    ForfeitResult
} from '../types';

import { v4 as uuidv4 } from 'uuid';
import { getRedis } from '../config/redis';
import logger from '../utils/logger';
import * as wordListService from './wordListService';
import {
    BOARD_SIZE,
    DEFAULT_WORDS,
    REDIS_TTL,
    LOCKS,
    RETRY_CONFIG,
    GAME_INTERNALS,
    DUET_BOARD_CONFIG
} from '../config/constants';
import {
    GameStateError,
    ValidationError,
    PlayerError,
    ServerError,
    RoomError
} from '../errors/GameError';
import { withTimeout, TIMEOUTS } from '../utils/timeout';
import { toEnglishUpperCase } from '../utils/sanitize';
import { tryParseJSON } from '../utils/parseJSON';
import { ATOMIC_SET_ROOM_STATUS_SCRIPT, RELEASE_LOCK_SCRIPT } from '../scripts';

// Focused modules
import {
    hashString,
    generateSeed,
    generateBoardLayout,
    selectBoardWords
} from './game/boardGenerator';

import {
    validateCardIndex,
    getGameStateForPlayer
} from './game/revealEngine';

import type { RedisClient } from './game/luaGameOps';

import {
    OPTIMIZED_REVEAL_SCRIPT,
    OPTIMIZED_END_TURN_SCRIPT,
    gameStateSchema,
    MAX_HISTORY_ENTRIES,
    executeLuaScript,
    executeGameTransaction
} from './game/luaGameOps';

// Re-export types for consumers
export type { CreateGameOptions, RevealResult, EndTurnResult, ForfeitResult };

// Re-export getGameStateForPlayer from revealEngine for consumers that access it via gameService
export { getGameStateForPlayer };

/**
 * Release a distributed lock with retry and exponential backoff.
 * Prevents permanent lock when release fails (lock self-heals via TTL,
 * but retry reduces the window where subsequent operations are blocked).
 */
async function releaseLockWithRetry(
    redis: RedisClient,
    lockKey: string,
    lockValue: string,
    context: string,
    maxRetries: number = 3
): Promise<void> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            await withTimeout(
                redis.eval(RELEASE_LOCK_SCRIPT, { keys: [lockKey], arguments: [lockValue] }),
                TIMEOUTS.TIMER_OPERATION,
                `${context}-attempt-${attempt}`
            );
            return; // Success
        } catch (err: unknown) {
            const errorMsg = (err as Error).message;
            if (attempt < maxRetries) {
                const backoffMs = Math.min(50 * Math.pow(2, attempt), 400);
                logger.warn(`Lock release failed for ${context} (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${backoffMs}ms: ${errorMsg}`);
                await new Promise(resolve => setTimeout(resolve, backoffMs));
            } else {
                // Lock will self-heal via TTL expiration (LOCKS.CARD_REVEAL = 15s)
                logger.error(`Failed to release lock for ${context} after ${maxRetries + 1} attempts: ${errorMsg}`);
            }
        }
    }
}

/**
 * Add entry to game history with cap to prevent unbounded growth
 */
function addToHistory(game: GameState, entry: ForfeitHistoryEntry): void {
    if (!game.history) game.history = [];
    game.history.push(entry);

    const lazyThreshold = Math.floor(MAX_HISTORY_ENTRIES * GAME_INTERNALS.LAZY_HISTORY_MULTIPLIER);
    if (game.history.length > lazyThreshold) {
        game.history = game.history.slice(-MAX_HISTORY_ENTRIES);
    }
}

// ─── Game Lifecycle ─────────────────────────────────────────────────

/**
 * Acquire game creation lock with exponential backoff retry.
 * Returns the lock value for release, or throws if a game is already in progress.
 */
async function acquireGameCreationLock(
    redis: RedisClient,
    roomCode: string
): Promise<{ lockKey: string; lockValue: string }> {
    const lockKey = `room:${roomCode}:game:creating`;
    const lockValue = `${process.pid}:${Date.now()}`;
    const lockAcquired = await withTimeout(
        redis.set(lockKey, lockValue, { NX: true, EX: LOCKS.GAME_CREATE }),
        TIMEOUTS.REDIS_OPERATION,
        `createGame-lock-${roomCode}`
    );

    if (lockAcquired) {
        return { lockKey, lockValue };
    }

    const maxRetries = 3;
    let acquiredOnRetry = false;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        const delayMs = RETRY_CONFIG.RACE_CONDITION.delayMs * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, delayMs));
        const existingGame = await getGame(roomCode);
        if (existingGame && !existingGame.gameOver) {
            throw RoomError.gameInProgress(roomCode);
        }
        const retryLock = await withTimeout(
            redis.set(lockKey, lockValue, { NX: true, EX: LOCKS.GAME_CREATE }),
            TIMEOUTS.REDIS_OPERATION,
            `createGame-retryLock-${roomCode}`
        );
        if (retryLock) {
            acquiredOnRetry = true;
            break;
        }
        if (attempt === maxRetries - 1) {
            throw RoomError.gameInProgress(roomCode);
        }
    }

    // Re-check after acquiring on retry: the previous holder's game creation may still be in-flight
    if (acquiredOnRetry) {
        await new Promise(resolve => setTimeout(resolve, RETRY_CONFIG.RACE_CONDITION.delayMs));
        const lateGame = await getGame(roomCode);
        if (lateGame && !lateGame.gameOver) {
            await releaseLockWithRetry(redis, lockKey, lockValue, `creation-lock-${roomCode}`);
            throw RoomError.gameInProgress(roomCode);
        }
    }

    return { lockKey, lockValue };
}

/**
 * Resolve the word list to use for a game.
 * Priority: direct wordList > wordListId from DB > default words.
 */
async function resolveGameWords(
    roomCode: string,
    options: CreateGameOptions
): Promise<{ words: string[]; usedWordListId: string | null }> {
    const { wordListId, wordList } = options;
    let words: string[] = [...DEFAULT_WORDS];
    let usedWordListId: string | null = null;

    if (wordList && Array.isArray(wordList) && wordList.length >= BOARD_SIZE) {
        const cleanedWords = [...new Set(
            wordList
                .map((w: string) => toEnglishUpperCase(String(w).trim()))
                .filter((w: string) => w.length > 0)
        )];
        if (cleanedWords.length >= BOARD_SIZE) {
            words = cleanedWords;
            logger.info(`Using ${cleanedWords.length} custom words for room ${roomCode}`);
        } else {
            logger.warn(`Custom word list too small after cleaning (${cleanedWords.length}), using default`);
        }
    } else if (wordListId) {
        try {
            const customWords = await wordListService.getWordsForGame(wordListId);
            if (customWords && customWords.length >= BOARD_SIZE) {
                words = customWords;
                usedWordListId = wordListId;
                logger.info(`Using database word list ${wordListId} for room ${roomCode}`);
            } else {
                logger.warn(`Database word list ${wordListId} not found or too small, using default`);
            }
        } catch (error) {
            logger.error(`Error fetching database word list ${wordListId}:`, error);
        }
    }

    return { words, usedWordListId };
}

/**
 * Build a GameState object from resolved words and layout.
 */
function buildGameState(
    seed: string,
    usedWordListId: string | null,
    boardWords: string[],
    layout: ReturnType<typeof generateBoardLayout>,
    isDuet: boolean
): GameState {
    return {
        id: uuidv4(),
        seed,
        wordListId: usedWordListId,
        words: boardWords,
        types: layout.types,
        revealed: Array(BOARD_SIZE).fill(false),
        currentTurn: layout.firstTeam,
        redScore: 0,
        blueScore: 0,
        redTotal: layout.redTotal,
        blueTotal: layout.blueTotal,
        gameOver: false,
        winner: null,
        currentClue: null,
        guessesUsed: 0,
        guessesAllowed: 0,
        clues: [],
        history: [],
        stateVersion: 1,
        createdAt: Date.now(),
        ...(isDuet ? {
            gameMode: 'duet',
            duetTypes: layout.duetTypes,
            timerTokens: DUET_BOARD_CONFIG.timerTokens,
            greenFound: 0,
            greenTotal: DUET_BOARD_CONFIG.greenTotal
        } : {})
    };
}

/**
 * Persist game state to Redis and update room status.
 */
async function persistGameState(
    redis: RedisClient,
    roomCode: string,
    game: GameState
): Promise<void> {
    await withTimeout(
        redis.set(`room:${roomCode}:game`, JSON.stringify(game), { EX: REDIS_TTL.ROOM }),
        TIMEOUTS.REDIS_OPERATION,
        `createGame-saveGame-${roomCode}`
    );

    // Atomically update room status to 'playing' via Lua to prevent TOCTOU race
    try {
        await withTimeout(
            redis.eval(ATOMIC_SET_ROOM_STATUS_SCRIPT, {
                keys: [`room:${roomCode}`],
                arguments: ['playing', REDIS_TTL.ROOM.toString()]
            }),
            TIMEOUTS.REDIS_OPERATION,
            `setRoomStatus-lua-${roomCode}`
        );
    } catch (e) {
        logger.error(`Failed to update room status for ${roomCode}:`, (e as Error).message);
    }

    await withTimeout(
        redis.expire(`room:${roomCode}:players`, REDIS_TTL.ROOM),
        TIMEOUTS.REDIS_OPERATION,
        `createGame-expirePlayers-${roomCode}`
    );
}

/**
 * Create a new game for a room
 */
export async function createGame(
    roomCode: string,
    options: CreateGameOptions = {}
): Promise<GameState> {
    const redis: RedisClient = getRedis();
    const { lockKey, lockValue } = await acquireGameCreationLock(redis, roomCode);

    try {
        const existingGame = await getGame(roomCode);
        if (existingGame && !existingGame.gameOver) {
            throw RoomError.gameInProgress(roomCode);
        }

        const preCheckRoomData = await withTimeout(
            redis.get(`room:${roomCode}`),
            TIMEOUTS.REDIS_OPERATION,
            `createGame-roomCheck-${roomCode}`
        );
        if (!preCheckRoomData) {
            throw RoomError.notFound(roomCode);
        }

        const seed = generateSeed();
        const numericSeed = hashString(seed);
        const isDuet = options.gameMode === 'duet';

        const { words, usedWordListId } = await resolveGameWords(roomCode, options);
        const boardWords = selectBoardWords(words, numericSeed);
        const layout = generateBoardLayout(numericSeed, isDuet);
        const game = buildGameState(seed, usedWordListId, boardWords, layout, isDuet);

        await persistGameState(redis, roomCode, game);

        logger.info(`Game created for room ${roomCode} with seed ${seed}`);
        return game;
    } finally {
        await releaseLockWithRetry(redis, lockKey, lockValue, `creation-lock-${roomCode}`);
    }
}

/**
 * Get current game for a room
 */
export async function getGame(roomCode: string): Promise<GameState | null> {
    const redis: RedisClient = getRedis();
    const gameData = await withTimeout(
        redis.get(`room:${roomCode}:game`),
        TIMEOUTS.REDIS_OPERATION,
        `getGame-${roomCode}`
    );
    if (!gameData) return null;

    const game = tryParseJSON(gameData, gameStateSchema, `game state for ${roomCode}`) as GameState | null;
    if (!game) {
        logger.error(`Corrupted game data for room ${roomCode}`);
        await redis.del(`room:${roomCode}:game`);
    }
    return game;
}

// ─── Card Reveal ────────────────────────────────────────────────────

/**
 * Reveal a card with distributed lock and atomic Lua execution
 */
export async function revealCard(
    roomCode: string,
    index: number,
    playerNickname: string = 'Unknown',
    playerTeam: string = ''
): Promise<RevealResult> {
    const redis: RedisClient = getRedis();
    const gameKey = `room:${roomCode}:game`;
    const lockKey = `lock:reveal:${roomCode}`;

    validateCardIndex(index);

    const lockValue = `${process.pid}:${Date.now()}`;
    const lockAcquired = await withTimeout(
        redis.set(lockKey, lockValue, { NX: true, EX: LOCKS.CARD_REVEAL }),
        TIMEOUTS.REDIS_OPERATION,
        `revealCard-lock-${roomCode}`
    );
    if (!lockAcquired) {
        throw new ServerError('Another card reveal is in progress, please try again');
    }

    try {
        const errorMap: Record<string, Error> = {
            'NO_GAME': GameStateError.noActiveGame(),
            'GAME_OVER': GameStateError.gameOver(),
            'NO_GUESSES': new ValidationError('No guesses remaining this turn'),
            'ALREADY_REVEALED': GameStateError.cardAlreadyRevealed(index),
            'NOT_YOUR_TURN': PlayerError.notYourTurn(playerTeam),
            'INVALID_INDEX': new ValidationError('Invalid card index')
        };

        return await executeLuaScript<RevealResult>(
            OPTIMIZED_REVEAL_SCRIPT,
            gameKey,
            [
                index.toString(),
                Date.now().toString(),
                playerNickname,
                MAX_HISTORY_ENTRIES.toString(),
                playerTeam || ''
            ],
            errorMap,
            `revealCard-${roomCode}`
        );
    } finally {
        await releaseLockWithRetry(redis, lockKey, lockValue, `reveal-lock-${roomCode}`);
    }
}

// ─── End Turn ───────────────────────────────────────────────────────

/**
 * End the current turn — atomic Lua execution
 */
export async function endTurn(
    roomCode: string,
    playerNickname: string = 'Unknown',
    expectedTeam: string = ''
): Promise<EndTurnResult> {
    const gameKey = `room:${roomCode}:game`;

    const luaErrorMap: Record<string, Error> = {
        'NO_GAME': GameStateError.noActiveGame(),
        'GAME_OVER': GameStateError.gameOver(),
        'NOT_YOUR_TURN': PlayerError.notYourTurn(expectedTeam as Team)
    };

    return executeLuaScript<EndTurnResult>(
        OPTIMIZED_END_TURN_SCRIPT,
        gameKey,
        [playerNickname, Date.now().toString(), MAX_HISTORY_ENTRIES.toString(), expectedTeam],
        luaErrorMap,
        `endTurn-${roomCode}`
    );
}

// ─── Forfeit / History / Cleanup ────────────────────────────────────

/**
 * Forfeit the game
 */
export async function forfeitGame(roomCode: string, forfeitTeam?: Team): Promise<ForfeitResult> {
    const gameKey = `room:${roomCode}:game`;

    return executeGameTransaction(gameKey, (game: GameState) => {
        if (game.gameOver) {
            throw GameStateError.gameOver();
        }

        const forfeitingTeam: Team = (forfeitTeam === 'red' || forfeitTeam === 'blue') ? forfeitTeam : game.currentTurn;
        game.gameOver = true;

        if (game.gameMode === 'duet') {
            game.winner = null;
        } else {
            game.winner = forfeitingTeam === 'red' ? 'blue' : 'red';
        }

        addToHistory(game, {
            action: 'forfeit',
            forfeitingTeam,
            winner: game.winner,
            timestamp: Date.now()
        });

        return {
            winner: game.winner,
            forfeitingTeam,
            allTypes: game.types
        };
    }, 'forfeitGame');
}

/**
 * Get game history
 */
export async function getGameHistory(roomCode: string): Promise<GameHistoryEntry[]> {
    const game = await getGame(roomCode);
    if (!game) return [];
    return game.history || [];
}

/**
 * Clean up game data for a room
 */
export async function cleanupGame(roomCode: string): Promise<void> {
    const redis: RedisClient = getRedis();
    await withTimeout(
        redis.del(`room:${roomCode}:game`),
        TIMEOUTS.REDIS_OPERATION,
        `cleanupGame-${roomCode}`
    );
    logger.info(`Game data cleaned up for room ${roomCode}`);
}

// ─── Exports ────────────────────────────────────────────────────────
// All exports use `export` keyword on function declarations above.
