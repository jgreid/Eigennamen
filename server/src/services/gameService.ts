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

const { v4: uuidv4 } = require('uuid');
const { getRedis } = require('../config/redis');
const logger = require('../utils/logger');
const wordListService = require('./wordListService');
const {
    BOARD_SIZE,
    DEFAULT_WORDS,
    REDIS_TTL,
    ERROR_CODES,
    LOCKS,
    RETRY_CONFIG,
    GAME_INTERNALS,
    DUET_BOARD_CONFIG
} = require('../config/constants');
const {
    GameStateError,
    ValidationError,
    PlayerError,
    ServerError,
    RoomError
} = require('../errors/GameError');
const { withTimeout, TIMEOUTS } = require('../utils/timeout');
const { toEnglishUpperCase } = require('../utils/sanitize');
const { RELEASE_LOCK_SCRIPT } = require('../utils/distributedLock');
const { tryParseJSON } = require('../utils/parseJSON');

// Focused modules
const {
    seededRandom,
    hashString,
    shuffleWithSeed,
    generateSeed,
    generateDuetBoard,
    generateBoardLayout,
    selectBoardWords
} = require('./game/boardGenerator');

const { validateClueWord } = require('./game/clueValidator');

const {
    validateCardIndex,
    validateRevealPreconditions,
    executeCardReveal,
    switchTurn,
    determineRevealOutcome,
    buildRevealResult,
    getGameStateForPlayer
} = require('./game/revealEngine');

import type { RedisClient, ExecuteLuaScript } from './game/luaGameOps';

const {
    OPTIMIZED_REVEAL_SCRIPT,
    OPTIMIZED_GIVE_CLUE_SCRIPT,
    OPTIMIZED_END_TURN_SCRIPT,
    gameStateSchema,
    MAX_HISTORY_ENTRIES,
    MAX_CLUES,
    safeParseGameData,
    isDuetMode,
    incrementVersion,
    executeLuaScript: _executeLuaScript,
    withLuaFallback,
    executeGameTransaction
} = require('./game/luaGameOps');

const executeLuaScript: ExecuteLuaScript = _executeLuaScript;

// Re-export types for consumers
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
        const errorMap: Record<string, { code: string; message: string }> = {
            'NO_GAME': { code: ERROR_CODES.GAME_NOT_STARTED, message: 'No active game' },
            'GAME_OVER': { code: ERROR_CODES.GAME_OVER, message: 'Game is already over' },
            'NO_GUESSES': { code: ERROR_CODES.INVALID_INPUT, message: 'No guesses remaining this turn' },
            'ALREADY_REVEALED': { code: ERROR_CODES.CARD_ALREADY_REVEALED, message: 'Card already revealed' },
            'NOT_YOUR_TURN': { code: ERROR_CODES.NOT_YOUR_TURN, message: "It's not your team's turn" },
            'NO_CLUE': { code: ERROR_CODES.NO_CLUE, message: 'Spymaster must give a clue before revealing cards' },
            'INVALID_INDEX': { code: ERROR_CODES.INVALID_INPUT, message: 'Invalid card index' }
        };

        return await withLuaFallback<RevealResult>(
            gameKey,
            OPTIMIZED_REVEAL_SCRIPT,
            [
                index.toString(),
                Date.now().toString(),
                playerNickname,
                MAX_HISTORY_ENTRIES.toString(),
                playerTeam || ''
            ],
            errorMap,
            () => revealCardFallback(roomCode, gameKey, index, playerNickname),
            `revealCard-${roomCode}`
        );
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

    const normalizedWord = toEnglishUpperCase(String(word).normalize('NFKC').trim());

    const luaErrorMap: Record<string, Error> = {
        'NO_GAME': GameStateError.noActiveGame(),
        'GAME_OVER': GameStateError.gameOver(),
        'NOT_YOUR_TURN': PlayerError.notYourTurn(team),
        'CLUE_ALREADY_GIVEN': ValidationError.clueAlreadyGiven(),
        'INVALID_NUMBER': new ValidationError(`Clue number must be 0-${BOARD_SIZE}`),
        'WORD_ON_BOARD': ValidationError.invalidClue(`"${word}" is a word on the board`),
    };

    return withLuaFallback<ClueWithGuesses>(
        gameKey,
        OPTIMIZED_GIVE_CLUE_SCRIPT,
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
        () => giveClueTransactional(roomCode, gameKey, team, word, number, spymasterNickname),
        `giveClue-${roomCode}`
    );
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
 * End the current turn — Lua with TypeScript fallback
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

    return withLuaFallback<EndTurnResult>(
        gameKey,
        OPTIMIZED_END_TURN_SCRIPT,
        [playerNickname, Date.now().toString(), MAX_HISTORY_ENTRIES.toString(), expectedTeam],
        luaErrorMap,
        () => executeGameTransaction(gameKey, (game: GameState) => {
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
        }, 'endTurn'),
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

module.exports = {
    // Game lifecycle
    createGame,
    getGame,
    getGameStateForPlayer,
    cleanupGame,

    // Game actions
    revealCard,
    giveClue,
    endTurn,
    forfeitGame,
    getGameHistory,

    // Pure functions (re-exported from focused modules for backward compat)
    seededRandom,
    hashString,
    shuffleWithSeed,
    generateSeed,
    validateClueWord,
    generateDuetBoard,

    // Decomposed reveal functions
    validateCardIndex,
    validateRevealPreconditions,
    executeCardReveal,
    determineRevealOutcome,
    switchTurn,
    buildRevealResult
};
