/**
 * Game Service - Orchestration layer
 *
 * Delegates to focused modules:
 *   - game/boardGenerator: PRNG, shuffling, board layout
 *   - game/clueValidator: Clue word validation
 *   - game/revealEngine: Card reveal logic + outcome determination
 *   - game/luaGameOps: Lua script execution, transactions, schemas
 *
 * This file handles game lifecycle (create, get, cleanup) and
 * the async operations that coordinate Redis + Lua + fallback.
 */

import type {
    Team,
    GameState,
    Clue,
    RevealHistoryEntry,
    ClueHistoryEntry,
    EndTurnHistoryEntry,
    ForfeitHistoryEntry,
    CreateGameOptions,
    RevealResult,
    ClueWithGuesses,
    EndTurnResult,
    ForfeitResult,
    ClueValidationResult
} from '../types';

import { v4 as uuidv4 } from 'uuid';
import { getRedis } from '../infrastructure/redis';
import logger from '../utils/logger';
import * as wordListService from './wordListService';
import { BOARD_SIZE, DEFAULT_WORDS, REDIS_TTL, ERROR_CODES, LOCKS, RETRY_CONFIG, GAME_INTERNALS, DUET_BOARD_CONFIG } from '../config/constants';
import { GameStateError, ValidationError, PlayerError, ServerError, RoomError } from '../errors/GameError';
import { withTimeout, TIMEOUTS } from '../utils/timeout';
import { toEnglishUpperCase } from '../utils/sanitize';
import { RELEASE_LOCK_SCRIPT } from '../utils/distributedLock';
import { tryParseJSON } from '../utils/parseJSON';
// Focused modules
import { generateBoardLayout, selectBoardWords, generateSeed, hashString } from './game/boardGenerator';
import { validateClueWord } from './game/clueValidator';
import { validateCardIndex, validateRevealPreconditions, executeCardReveal, determineRevealOutcome, buildRevealResult } from './game/revealEngine';
import type { RedisClient, ExecuteLuaScript } from './game/luaGameOps';

import { OPTIMIZED_REVEAL_SCRIPT, OPTIMIZED_GIVE_CLUE_SCRIPT, OPTIMIZED_END_TURN_SCRIPT, gameStateSchema, MAX_HISTORY_ENTRIES, MAX_CLUES, safeParseGameData, isDuetMode, incrementVersion, executeLuaScript as _executeLuaScript, executeGameTransaction } from './game/luaGameOps';
const executeLuaScript: ExecuteLuaScript = _executeLuaScript;

export type { CreateGameOptions, RevealResult, EndTurnResult, ForfeitResult, ClueValidationResult };

/**
 * History entry union type
 */
type HistoryEntry = RevealHistoryEntry | ClueHistoryEntry | EndTurnHistoryEntry | ForfeitHistoryEntry;

/**
 * Add entry to game history with cap to prevent unbounded growth
 */
function addToHistory(game: GameState, entry: HistoryEntry): void {
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
        await new Promise(resolve => setTimeout(resolve, RETRY_CONFIG.RACE_CONDITION.delayMs));
        const existingGame = await getGame(roomCode);
        if (existingGame && !existingGame.gameOver) {
            throw RoomError.gameInProgress(roomCode);
        }
        throw new Error('Game creation in progress by another player, please try again');
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
        let words: string[] = DEFAULT_WORDS;
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

        const roomData = await redis.get(`room:${roomCode}`);
        if (roomData) {
            try {
                const room = JSON.parse(roomData);
                room.status = 'playing';
                await redis.set(`room:${roomCode}`, JSON.stringify(room), { EX: REDIS_TTL.ROOM });
            } catch (e) {
                logger.error(`Failed to parse room data for ${roomCode}:`, (e as Error).message);
            }
        }

        await redis.expire(`room:${roomCode}:players`, REDIS_TTL.ROOM);

        logger.info(`Game created for room ${roomCode} with seed ${seed}`);
        return game;
    } finally {
        await withTimeout(
            redis.eval(RELEASE_LOCK_SCRIPT, { keys: [lockKey], arguments: [lockValue] }),
            TIMEOUTS.TIMER_OPERATION,
            `release-creation-lock-${roomCode}`
        ).catch((err: Error) => {
            logger.error(`Failed to release creation lock for room ${roomCode}:`, err.message);
        });
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
 * Optimized card reveal using Lua script
 */
async function revealCardOptimized(
    roomCode: string,
    index: number,
    playerNickname: string = 'Unknown',
    playerTeam: string = ''
): Promise<RevealResult> {
    const gameKey = `room:${roomCode}:game`;

    validateCardIndex(index);

    const errorMap: Record<string, { code: string; message: string }> = {
        'NO_GAME': { code: ERROR_CODES.GAME_NOT_STARTED, message: 'No active game' },
        'GAME_OVER': { code: ERROR_CODES.GAME_OVER, message: 'Game is already over' },
        'NO_GUESSES': { code: ERROR_CODES.INVALID_INPUT, message: 'No guesses remaining this turn' },
        'ALREADY_REVEALED': { code: ERROR_CODES.CARD_ALREADY_REVEALED, message: 'Card already revealed' },
        'NOT_YOUR_TURN': { code: ERROR_CODES.NOT_YOUR_TURN, message: "It's not your team's turn" },
        'NO_CLUE': { code: ERROR_CODES.NO_CLUE, message: 'Spymaster must give a clue before revealing cards' },
        'INVALID_INDEX': { code: ERROR_CODES.INVALID_INPUT, message: 'Invalid card index' }
    };

    try {
        const result = await executeLuaScript<RevealResult>(
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

        logger.debug(`Optimized reveal completed for card ${index} in room ${roomCode}`);
        return result;
    } catch (error) {
        if ((error as { code?: string }).code) throw error;
        logger.error('Optimized reveal failed', { roomCode, error: (error as Error).message });
        throw new ServerError('Failed to reveal card');
    }
}

/**
 * Reveal a card with distributed lock and Lua optimization + fallback
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
        // Check if Duet — skip Lua for Duet games
        const duetGame = await isDuetMode(gameKey);

        if (!duetGame) {
            try {
                return await revealCardOptimized(roomCode, index, playerNickname, playerTeam);
            } catch (luaError) {
                if ((luaError as { code?: string }).code && (luaError as { code?: string }).code !== ERROR_CODES.SERVER_ERROR) {
                    throw luaError;
                }
                logger.warn(`Lua reveal failed, falling back to standard reveal for room ${roomCode}: ${(luaError as Error).message}`);
            }
        }

        // TypeScript fallback / Duet mode
        return await revealCardFallback(roomCode, gameKey, index, playerNickname);
    } finally {
        await withTimeout(
            redis.eval(RELEASE_LOCK_SCRIPT, { keys: [lockKey], arguments: [lockValue] }),
            TIMEOUTS.TIMER_OPERATION,
            `release-reveal-lock-${roomCode}`
        ).catch((err: Error) => {
            logger.error(`Failed to release reveal lock for room ${roomCode}:`, err.message);
        });
    }
}

/**
 * TypeScript fallback for card reveal (used for Duet mode and when Lua fails)
 */
async function revealCardFallback(
    roomCode: string,
    gameKey: string,
    index: number,
    playerNickname: string
): Promise<RevealResult> {
    const redis: RedisClient = getRedis();
    const maxRetries = 3;
    let retries = 0;

    while (retries < maxRetries) {
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

            validateRevealPreconditions(game, index);

            const previousTurn = game.currentTurn;
            const cardType = executeCardReveal(game, index);
            const outcome = determineRevealOutcome(game, cardType, previousTurn);

            addToHistory(game, {
                action: 'reveal',
                index,
                word: game.words[index] || 'UNKNOWN',
                type: cardType,
                team: previousTurn,
                player: playerNickname,
                guessNumber: game.guessesUsed,
                timestamp: Date.now()
            });

            incrementVersion(game);

            const currentTTL = await redis.ttl(gameKey);
            const ttl = currentTTL > 0 ? currentTTL : REDIS_TTL.ROOM;

            const result = await redis.multi()
                .set(gameKey, JSON.stringify(game), { EX: ttl })
                .exec();

            if (result === null) {
                await redis.unwatch();
                retries++;
                continue;
            }

            return buildRevealResult(game, index, cardType, outcome);

        } catch (error) {
            await redis.unwatch();
            throw error;
        }
    }

    throw ServerError.concurrentModification();
}

// ─── Clue Giving ────────────────────────────────────────────────────

/**
 * Optimized clue giving using Lua script
 */
async function giveClueOptimized(
    roomCode: string,
    team: Team,
    word: string,
    number: number,
    spymasterNickname: string
): Promise<ClueWithGuesses> {
    const gameKey = `room:${roomCode}:game`;
    const normalizedWord = toEnglishUpperCase(String(word).normalize('NFKC').trim());

    const errorMap: Record<string, Error> = {
        'NO_GAME': GameStateError.noActiveGame(),
        'GAME_OVER': GameStateError.gameOver(),
        'NOT_YOUR_TURN': PlayerError.notYourTurn(team),
        'CLUE_ALREADY_GIVEN': ValidationError.clueAlreadyGiven(),
        'INVALID_NUMBER': new ValidationError(`Clue number must be 0-${BOARD_SIZE}`),
        'WORD_ON_BOARD': ValidationError.invalidClue(`"${word}" is a word on the board`),
    };

    // These need the result.word value, but executeLuaScript handles error mapping
    // before we can access it. For CONTAINS_BOARD_WORD and BOARD_CONTAINS_CLUE,
    // we use the word from the Lua result as a fallback message.
    const result = await executeLuaScript<ClueWithGuesses & { word?: string }>(
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
        errorMap,
        `giveClue-${roomCode}`
    );

    logger.debug(`Optimized giveClue completed for room ${roomCode}`);
    return result;
}

/**
 * Give a clue with validation — Lua with TypeScript fallback
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

    // Check if Duet mode
    const duetGame = await isDuetMode(gameKey);

    if (!duetGame) {
        try {
            return await giveClueOptimized(roomCode, team, word, number, spymasterNickname);
        } catch (luaError) {
            if ((luaError as { code?: string }).code && (luaError as { code?: string }).code !== ERROR_CODES.SERVER_ERROR) {
                throw luaError;
            }
            logger.warn(`Lua giveClue failed, falling back to standard for room ${roomCode}: ${(luaError as Error).message}`);
        }
    }

    // TypeScript fallback / Duet mode
    return giveClueTransactional(roomCode, gameKey, team, word, number, spymasterNickname);
}

/**
 * TypeScript transactional clue giving (fallback / Duet)
 */
async function giveClueTransactional(
    roomCode: string,
    gameKey: string,
    team: Team,
    word: string,
    number: number,
    spymasterNickname: string
): Promise<ClueWithGuesses> {
    const redis: RedisClient = getRedis();
    const maxRetries = 3;
    let retries = 0;

    while (retries < maxRetries) {
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

            if (game.gameOver) {
                await redis.unwatch();
                throw GameStateError.gameOver();
            }

            if (game.currentTurn !== team) {
                await redis.unwatch();
                throw PlayerError.notYourTurn(team);
            }

            if (game.currentClue) {
                await redis.unwatch();
                throw ValidationError.clueAlreadyGiven();
            }

            const validation = validateClueWord(word, game.words);
            if (!validation.valid) {
                await redis.unwatch();
                throw ValidationError.invalidClue(validation.reason || 'Invalid clue');
            }

            const clue: Clue = {
                team,
                word: toEnglishUpperCase(word),
                number,
                spymaster: spymasterNickname,
                timestamp: Date.now()
            };

            game.currentClue = clue;
            game.guessesAllowed = number === 0 ? 0 : number + 1;
            game.guessesUsed = 0;

            if (!game.clues) game.clues = [];
            game.clues.push(clue);
            if (game.clues.length > MAX_CLUES) {
                game.clues = game.clues.slice(-MAX_CLUES);
            }

            addToHistory(game, {
                action: 'clue',
                team,
                word: clue.word,
                number,
                guessesAllowed: game.guessesAllowed,
                spymaster: spymasterNickname,
                timestamp: Date.now()
            });

            incrementVersion(game);

            const currentTTL = await redis.ttl(gameKey);
            const ttl = currentTTL > 0 ? currentTTL : REDIS_TTL.ROOM;

            const result = await redis.multi()
                .set(gameKey, JSON.stringify(game), { EX: ttl })
                .exec();

            if (result === null) {
                await redis.unwatch();
                retries++;
                continue;
            }

            return { ...clue, guessesAllowed: game.guessesAllowed };

        } catch (error) {
            await redis.unwatch();
            throw error;
        }
    }

    throw ServerError.concurrentModification();
}

// ─── End Turn ───────────────────────────────────────────────────────

/**
 * Optimized end turn using Lua script
 */
async function endTurnOptimized(
    roomCode: string,
    playerNickname: string = 'Unknown',
    expectedTeam: string = ''
): Promise<EndTurnResult> {
    const gameKey = `room:${roomCode}:game`;

    const errorMap: Record<string, Error> = {
        'NO_GAME': GameStateError.noActiveGame(),
        'GAME_OVER': GameStateError.gameOver(),
        'NOT_YOUR_TURN': PlayerError.notYourTurn(expectedTeam as Team)
    };

    const result = await executeLuaScript<EndTurnResult>(
        OPTIMIZED_END_TURN_SCRIPT,
        gameKey,
        [playerNickname, Date.now().toString(), MAX_HISTORY_ENTRIES.toString(), expectedTeam],
        errorMap,
        `endTurn-${roomCode}`
    );

    logger.debug(`Optimized endTurn completed for room ${roomCode}`);
    return result;
}

/**
 * End the current turn — Lua with TypeScript fallback
 */
export async function endTurn(
    roomCode: string,
    playerNickname: string = 'Unknown',
    expectedTeam: string = ''
): Promise<EndTurnResult> {
    const gameKey = `room:${roomCode}:game`;

    const duetGame = await isDuetMode(gameKey);

    if (!duetGame) {
        try {
            return await endTurnOptimized(roomCode, playerNickname, expectedTeam);
        } catch (luaError) {
            if ((luaError as { code?: string }).code && (luaError as { code?: string }).code !== ERROR_CODES.SERVER_ERROR) {
                throw luaError;
            }
            logger.warn(`Lua endTurn failed, falling back to standard for room ${roomCode}: ${(luaError as Error).message}`);
        }
    }

    return executeGameTransaction(gameKey, (game: GameState) => {
        if (game.gameOver) {
            throw GameStateError.gameOver();
        }

        if (expectedTeam && game.currentTurn !== expectedTeam) {
            throw PlayerError.notYourTurn(expectedTeam as Team);
        }

        const previousTurn = game.currentTurn;
        game.currentTurn = game.currentTurn === 'red' ? 'blue' : 'red';
        game.currentClue = null;
        game.guessesUsed = 0;
        game.guessesAllowed = 0;

        addToHistory(game, {
            action: 'endTurn',
            fromTeam: previousTurn,
            toTeam: game.currentTurn,
            player: playerNickname,
            timestamp: Date.now()
        });

        return { currentTurn: game.currentTurn, previousTurn };
    }, 'endTurn');
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
export async function getGameHistory(roomCode: string): Promise<HistoryEntry[]> {
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
// All functions are re-exported so existing `require('./gameService')` continues to work.

// Re-export sub-module functions for consumers
export { getGameStateForPlayer } from './game/revealEngine';
export { seededRandom, hashString, shuffleWithSeed, generateSeed, generateDuetBoard } from './game/boardGenerator';
export { validateClueWord } from './game/clueValidator';
export { validateCardIndex, validateRevealPreconditions, executeCardReveal, determineRevealOutcome, buildRevealResult, switchTurn } from './game/revealEngine';
