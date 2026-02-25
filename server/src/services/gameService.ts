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
import {
    BOARD_SIZE,
    DEFAULT_WORDS,
    REDIS_TTL,
    LOCKS,
    GAME_INTERNALS,
    DUET_BOARD_CONFIG
} from '../config/constants';
import {
    GameStateError,
    ValidationError,
    PlayerError,
    RoomError
} from '../errors/GameError';
import { withTimeout, TIMEOUTS } from '../utils/timeout';
import { toEnglishUpperCase } from '../utils/sanitize';
import { tryParseJSON } from '../utils/parseJSON';
import { ATOMIC_SET_ROOM_STATUS_SCRIPT } from '../scripts';
import { withLock } from '../utils/distributedLock';

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
 * Resolve the word list to use for a game.
 * Priority: direct wordList > default words.
 */
async function resolveGameWords(
    roomCode: string,
    options: CreateGameOptions
): Promise<{ words: string[]; usedWordListId: string | null }> {
    const { wordList } = options;
    let words: string[] = [...DEFAULT_WORDS];

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
    }

    return { words, usedWordListId: null };
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
    return withLock(`game-create:${roomCode}`, async () => {
        const redis: RedisClient = getRedis();

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
    }, { lockTimeout: LOCKS.GAME_CREATE * 1000, maxRetries: 10 });
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
        logger.error(`Corrupted game data for room ${roomCode}, cleaning up`);
        await redis.del(`room:${roomCode}:game`);
        throw GameStateError.corrupted(roomCode);
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
    const gameKey = `room:${roomCode}:game`;

    validateCardIndex(index);

    return withLock(`reveal:${roomCode}`, async () => {
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
    }, { lockTimeout: LOCKS.CARD_REVEAL * 1000, maxRetries: 5 });
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
    let game: GameState | null;
    try {
        game = await getGame(roomCode);
    } catch {
        // Corrupted game data — already cleaned up by getGame
        return [];
    }
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
