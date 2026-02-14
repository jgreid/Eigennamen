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
    ClueWithGuesses,
    EndTurnResult,
    ForfeitResult,
    ClueValidationResult
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
import { RELEASE_LOCK_SCRIPT } from '../utils/distributedLock';
import { tryParseJSON } from '../utils/parseJSON';
import { ATOMIC_SET_ROOM_STATUS_SCRIPT } from '../scripts';

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
    OPTIMIZED_GIVE_CLUE_SCRIPT,
    OPTIMIZED_END_TURN_SCRIPT,
    gameStateSchema,
    MAX_HISTORY_ENTRIES,
    MAX_CLUES,
    executeLuaScript,
    executeGameTransaction
} from './game/luaGameOps';

// Re-export types for consumers
export type { CreateGameOptions, RevealResult, EndTurnResult, ForfeitResult, ClueValidationResult };

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
 * Create a new game for a room
 */
export async function createGame(
    roomCode: string,
    options: CreateGameOptions = {}
): Promise<GameState> {
    const redis: RedisClient = getRedis();

    const lockKey = `room:${roomCode}:game:creating`;
    const lockValue = `${process.pid}:${Date.now()}`;
    const lockAcquired = await redis.set(lockKey, lockValue, { NX: true, EX: LOCKS.GAME_CREATE });

    if (!lockAcquired) {
        // Exponential backoff retry: wait, then check if the other creator finished
        const maxRetries = 3;
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            const delayMs = RETRY_CONFIG.RACE_CONDITION.delayMs * Math.pow(2, attempt);
            await new Promise(resolve => setTimeout(resolve, delayMs));
            const existingGame = await getGame(roomCode);
            if (existingGame && !existingGame.gameOver) {
                throw RoomError.gameInProgress(roomCode);
            }
            // Lock may have been released, try to acquire again
            const retryLock = await redis.set(lockKey, lockValue, { NX: true, EX: LOCKS.GAME_CREATE });
            if (retryLock) {
                // Acquired on retry — fall through to game creation below
                break;
            }
            if (attempt === maxRetries - 1) {
                throw RoomError.gameInProgress(roomCode);
            }
        }
    }

    try {
        const existingGame = await getGame(roomCode);
        if (existingGame && !existingGame.gameOver) {
            throw RoomError.gameInProgress(roomCode);
        }

        const preCheckRoomData = await redis.get(`room:${roomCode}`);
        if (!preCheckRoomData) {
            throw RoomError.notFound(roomCode);
        }

        const seed = generateSeed();
        const numericSeed = hashString(seed);
        const { wordListId, wordList, gameMode } = options;
        const isDuet = gameMode === 'duet';

        // Resolve words: direct wordList > wordListId > default
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

        const boardWords = selectBoardWords(words, numericSeed);
        const layout = generateBoardLayout(numericSeed, isDuet);

        const game: GameState = {
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

        await redis.set(`room:${roomCode}:game`, JSON.stringify(game), { EX: REDIS_TTL.ROOM });

        // Atomically update room status to 'playing' via Lua to prevent TOCTOU race
        try {
            await redis.eval(ATOMIC_SET_ROOM_STATUS_SCRIPT, {
                keys: [`room:${roomCode}`],
                arguments: ['playing', REDIS_TTL.ROOM.toString()]
            });
        } catch (e) {
            logger.error(`Failed to update room status for ${roomCode}:`, (e as Error).message);
        }

        await redis.expire(`room:${roomCode}:players`, REDIS_TTL.ROOM);

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
    const gameData = await redis.get(`room:${roomCode}:game`);
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
    const lockAcquired = await redis.set(lockKey, lockValue, { NX: true, EX: LOCKS.CARD_REVEAL });
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
            'NO_CLUE': new ValidationError('Spymaster must give a clue before revealing cards'),
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

// ─── Clue Giving ────────────────────────────────────────────────────

/**
 * Give a clue with validation — atomic Lua execution
 */
export async function giveClue(
    roomCode: string,
    team: Team,
    word: string,
    number: number,
    spymasterNickname: string
): Promise<ClueWithGuesses> {
    const gameKey = `room:${roomCode}:game`;

    if (!team || (team !== 'red' && team !== 'blue')) {
        throw ValidationError.invalidTeam();
    }

    if (typeof number !== 'number' || !Number.isInteger(number) || number < 0 || number > BOARD_SIZE) {
        throw new ValidationError(`Clue number must be 0-${BOARD_SIZE}`);
    }

    const normalizedWord = toEnglishUpperCase(String(word).normalize('NFKC').trim());

    const luaErrorMap: Record<string, Error> = {
        'NO_GAME': GameStateError.noActiveGame(),
        'GAME_OVER': GameStateError.gameOver(),
        'NOT_YOUR_TURN': PlayerError.notYourTurn(team),
        'CLUE_ALREADY_GIVEN': ValidationError.clueAlreadyGiven(),
        'INVALID_NUMBER': new ValidationError(`Clue number must be 0-${BOARD_SIZE}`),
        'WORD_ON_BOARD': ValidationError.invalidClue(`"${word}" is a word on the board`),
    };

    return executeLuaScript<ClueWithGuesses>(
        OPTIMIZED_GIVE_CLUE_SCRIPT,
        gameKey,
        [
            team,
            normalizedWord,
            number.toString(),
            spymasterNickname || 'Unknown',
            Date.now().toString(),
            MAX_HISTORY_ENTRIES.toString(),
            BOARD_SIZE.toString(),
            MAX_CLUES.toString()
        ],
        luaErrorMap,
        `giveClue-${roomCode}`
    );
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
export function forfeitGame(roomCode: string, forfeitTeam?: Team): Promise<ForfeitResult> {
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
    await redis.del(`room:${roomCode}:game`);
    logger.info(`Game data cleaned up for room ${roomCode}`);
}

// ─── Exports ────────────────────────────────────────────────────────
// All exports use `export` keyword on function declarations above.
