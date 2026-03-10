import type {
    Team,
    GameState,
    ForfeitHistoryEntry,
    CreateGameOptions,
    RevealResult,
    EndTurnResult,
    ForfeitResult,
    RoundResult,
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
    DUET_BOARD_CONFIG,
    MATCH_TARGET,
    MATCH_WIN_MARGIN,
    ROUND_WIN_BONUS,
} from '../config/constants';
import { GameStateError, ValidationError, PlayerError, RoomError } from '../errors/GameError';
import { withTimeout, TIMEOUTS } from '../utils/timeout';
import { toEnglishUpperCase } from '../utils/sanitize';
import { tryParseJSON } from '../utils/parseJSON';
import { ATOMIC_PERSIST_GAME_STATE_SCRIPT } from '../scripts';
import { withLock } from '../utils/distributedLock';
import { retryAsync } from '../utils/retryAsync';
import { notifyGameMutation } from '../socket/gameMutationNotifier';
import { z } from 'zod';

// Focused modules
import {
    hashString,
    generateSeed,
    generateBoardLayout,
    selectBoardWords,
    generateCardScores,
} from './game/boardGenerator';

import { validateCardIndex, getGameStateForPlayer } from './game/revealEngine';

import type { RedisClient } from './game/luaGameOps';

import {
    OPTIMIZED_REVEAL_SCRIPT,
    OPTIMIZED_END_TURN_SCRIPT,
    gameStateSchema,
    MAX_HISTORY_ENTRIES,
    executeLuaScript,
    executeGameTransaction,
    revealResultSchema,
    endTurnResultSchema,
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

async function resolveGameWords(
    roomCode: string,
    options: CreateGameOptions
): Promise<{ words: string[]; usedWordListId: string | null }> {
    const { wordList } = options;
    let words: string[] = [...DEFAULT_WORDS];

    if (wordList && Array.isArray(wordList) && wordList.length >= BOARD_SIZE) {
        const cleanedWords = [
            ...new Set(
                wordList.map((w: string) => toEnglishUpperCase(String(w).trim())).filter((w: string) => w.length > 0)
            ),
        ];
        if (cleanedWords.length >= BOARD_SIZE) {
            words = cleanedWords;
            logger.info(`Using ${cleanedWords.length} custom words for room ${roomCode}`);
        } else {
            logger.warn(`Custom word list too small after cleaning (${cleanedWords.length}), using default`);
        }
    }

    return { words, usedWordListId: null };
}

// Zod schema for match carry-over data to prevent score manipulation
const roundResultSchema = z.object({
    roundNumber: z.number().int().min(1),
    roundWinner: z.enum(['red', 'blue']).nullable(),
    redRoundScore: z.number().int().min(0),
    blueRoundScore: z.number().int().min(0),
    redBonusAwarded: z.boolean(),
    blueBonusAwarded: z.boolean(),
    endReason: z.string(),
    completedAt: z.number(),
});

const matchCarryOverSchema = z.object({
    matchRound: z.number().int().min(1).max(100),
    redMatchScore: z.number().int().min(0),
    blueMatchScore: z.number().int().min(0),
    roundHistory: z.array(roundResultSchema),
    firstTeamHistory: z.array(z.enum(['red', 'blue'])),
});

/**
 * Build a GameState object from resolved words and layout.
 */
function buildGameState(
    seed: string,
    usedWordListId: string | null,
    boardWords: string[],
    layout: ReturnType<typeof generateBoardLayout>,
    options: CreateGameOptions
): GameState {
    const isDuet = options.gameMode === 'duet';
    const isMatch = options.gameMode === 'match';
    const numericSeed = hashString(seed);

    const base: GameState = {
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
    };

    if (isDuet) {
        base.gameMode = 'duet';
        base.duetTypes = layout.duetTypes;
        base.timerTokens = DUET_BOARD_CONFIG.timerTokens;
        base.greenFound = 0;
        base.greenTotal = DUET_BOARD_CONFIG.greenTotal;
    }

    if (isMatch) {
        const scores = generateCardScores(numericSeed, layout.types);
        base.gameMode = 'match';
        base.cardScores = scores.cardScores;
        base.revealedBy = Array(BOARD_SIZE).fill(null);

        // Carry forward match state or initialize fresh
        if (options.matchCarryOver) {
            // Validate carry-over data to prevent score manipulation
            const carry = matchCarryOverSchema.parse(options.matchCarryOver);
            base.matchRound = carry.matchRound;
            base.redMatchScore = carry.redMatchScore;
            base.blueMatchScore = carry.blueMatchScore;
            base.roundHistory = carry.roundHistory;
            base.firstTeamHistory = [...carry.firstTeamHistory, layout.firstTeam];
            base.matchOver = false;
            base.matchWinner = null;
        } else {
            base.matchRound = 1;
            base.redMatchScore = 0;
            base.blueMatchScore = 0;
            base.roundHistory = [];
            base.firstTeamHistory = [layout.firstTeam];
            base.matchOver = false;
            base.matchWinner = null;
        }
    }

    return base;
}

/**
 * Persist game state to Redis and update room status atomically.
 * Uses a Lua script to write game state, set room status to 'playing',
 * and refresh players TTL in a single atomic operation.
 */
async function persistGameState(redis: RedisClient, roomCode: string, game: GameState): Promise<void> {
    const result = await retryAsync(
        () =>
            withTimeout(
                redis.eval(ATOMIC_PERSIST_GAME_STATE_SCRIPT, {
                    keys: [`room:${roomCode}:game`, `room:${roomCode}`, `room:${roomCode}:players`],
                    arguments: [JSON.stringify(game), REDIS_TTL.ROOM.toString()],
                }),
                TIMEOUTS.REDIS_OPERATION,
                `persistGameState-lua-${roomCode}`
            ),
        { maxRetries: 2, baseDelayMs: 100, operationName: `persistGameState-${roomCode}` }
    );

    if (result === 'NO_ROOM') {
        throw RoomError.notFound(roomCode);
    }
}

/**
 * Create a new game for a room
 */
export async function createGame(roomCode: string, options: CreateGameOptions = {}): Promise<GameState> {
    return withLock(
        `game-create:${roomCode}`,
        async () => {
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
            const game = buildGameState(seed, usedWordListId, boardWords, layout, options);

            await persistGameState(redis, roomCode, game);
            notifyGameMutation(roomCode);

            logger.info(`Game created for room ${roomCode} with seed ${seed}`);
            return game;
        },
        { lockTimeout: LOCKS.GAME_CREATE * 1000, maxRetries: 10 }
    );
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

    return withLock(
        `reveal:${roomCode}`,
        async () => {
            const errorMap: Record<string, Error> = {
                NO_GAME: GameStateError.noActiveGame(),
                GAME_OVER: GameStateError.gameOver(),
                NO_GUESSES: new ValidationError('No guesses remaining this turn'),
                ALREADY_REVEALED: GameStateError.cardAlreadyRevealed(index),
                NOT_YOUR_TURN: PlayerError.notYourTurn(playerTeam),
                INVALID_INDEX: new ValidationError('Invalid card index'),
            };

            const result = await executeLuaScript<RevealResult>(
                OPTIMIZED_REVEAL_SCRIPT,
                gameKey,
                [
                    index.toString(),
                    Date.now().toString(),
                    playerNickname,
                    MAX_HISTORY_ENTRIES.toString(),
                    playerTeam || '',
                ],
                errorMap,
                `revealCard-${roomCode}`,
                revealResultSchema
            );
            notifyGameMutation(roomCode);
            return result;
        },
        { lockTimeout: LOCKS.CARD_REVEAL * 1000, maxRetries: 5 }
    );
}

/**
 * End the current turn — atomic Lua execution under distributed lock.
 * The lock prevents double turn flip when timer expiration and player
 * action fire simultaneously.
 */
export async function endTurn(
    roomCode: string,
    playerNickname: string = 'Unknown',
    expectedTeam: string = ''
): Promise<EndTurnResult> {
    const gameKey = `room:${roomCode}:game`;

    return withLock(
        `reveal:${roomCode}`,
        async () => {
            const luaErrorMap: Record<string, Error> = {
                NO_GAME: GameStateError.noActiveGame(),
                GAME_OVER: GameStateError.gameOver(),
                NOT_YOUR_TURN: PlayerError.notYourTurn(expectedTeam as Team),
            };

            const result = await executeLuaScript<EndTurnResult>(
                OPTIMIZED_END_TURN_SCRIPT,
                gameKey,
                [playerNickname, Date.now().toString(), MAX_HISTORY_ENTRIES.toString(), expectedTeam],
                luaErrorMap,
                `endTurn-${roomCode}`,
                endTurnResultSchema
            );
            notifyGameMutation(roomCode);
            return result;
        },
        { lockTimeout: LOCKS.CARD_REVEAL * 1000, maxRetries: 5 }
    );
}

/**
 * Forfeit the game under the same distributed lock used by reveal/endTurn,
 * eliminating WATCH/MULTI contention with concurrent Lua operations.
 */
export async function forfeitGame(roomCode: string, forfeitTeam?: Team): Promise<ForfeitResult> {
    const gameKey = `room:${roomCode}:game`;

    return withLock(
        `reveal:${roomCode}`,
        async () => {
            const result = await executeGameTransaction(
                gameKey,
                (game: GameState) => {
                    if (game.gameOver) {
                        throw GameStateError.gameOver();
                    }

                    const forfeitingTeam: Team =
                        forfeitTeam === 'red' || forfeitTeam === 'blue' ? forfeitTeam : game.currentTurn;
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
                        timestamp: Date.now(),
                    });

                    return {
                        winner: game.winner,
                        forfeitingTeam,
                        allTypes: game.types,
                    };
                },
                'forfeitGame'
            );
            notifyGameMutation(roomCode);
            return result;
        },
        { lockTimeout: LOCKS.CARD_REVEAL * 1000, maxRetries: 5 }
    );
}

/**
 * Abandon a game in progress without recording it in history.
 * Sets gameOver=true but does not assign a winner or add history entries.
 */
export async function abandonGame(roomCode: string): Promise<void> {
    const gameKey = `room:${roomCode}:game`;

    await withLock(
        `reveal:${roomCode}`,
        async () => {
            await executeGameTransaction(
                gameKey,
                (game: GameState) => {
                    if (game.gameOver) {
                        throw GameStateError.gameOver();
                    }
                    game.gameOver = true;
                    game.winner = null;
                    return {};
                },
                'abandonGame'
            );
            notifyGameMutation(roomCode);
        },
        { lockTimeout: LOCKS.CARD_REVEAL * 1000, maxRetries: 5 }
    );
}

/**
 * Clean up game data for a room
 */
export async function cleanupGame(roomCode: string): Promise<void> {
    const redis: RedisClient = getRedis();
    await withTimeout(redis.del(`room:${roomCode}:game`), TIMEOUTS.REDIS_OPERATION, `cleanupGame-${roomCode}`);
    notifyGameMutation(roomCode);
    logger.info(`Game data cleaned up for room ${roomCode}`);
}

/**
 * Derive the end reason for a completed match round from game history.
 * Checks the last relevant history entry to distinguish forfeit, assassin, and normal completion.
 */
function deriveRoundEndReason(game: GameState): string {
    const history = game.history || [];
    // Walk backwards to find the decisive action
    for (let i = history.length - 1; i >= 0; i--) {
        const entry = history[i] as { action: string; type?: string };
        if (entry.action === 'forfeit') return 'forfeit';
        if (entry.action === 'reveal' && entry.type === 'assassin') return 'assassin';
        if (entry.action === 'reveal') return 'completed';
    }
    return 'completed';
}

/**
 * Finalize a completed round in match mode.
 * Calculates card scores earned by each team, awards round bonus,
 * updates cumulative match scores, and checks for match end.
 */
export function finalizeRound(game: GameState): RoundResult {
    if (game.gameMode !== 'match') {
        throw GameStateError.corrupted('unknown', { operation: 'finalizeRound_wrong_mode' });
    }

    const cardScores = game.cardScores || [];
    const revealedBy = game.revealedBy || [];

    // Card points are already accumulated per-reveal in the Lua script.
    // Recompute here only for the round result summary.
    let redCardPoints = 0;
    let blueCardPoints = 0;
    for (let i = 0; i < BOARD_SIZE; i++) {
        if (game.revealed[i] && revealedBy[i]) {
            const score = cardScores[i] ?? 0;
            if (revealedBy[i] === 'red') {
                redCardPoints += score;
            } else if (revealedBy[i] === 'blue') {
                blueCardPoints += score;
            }
        }
    }

    // Only add round bonus — card points were already accumulated per-reveal
    const roundWinner = game.winner;
    const redBonus = roundWinner === 'red';
    const blueBonus = roundWinner === 'blue';

    const redRoundTotal = redCardPoints + (redBonus ? ROUND_WIN_BONUS : 0);
    const blueRoundTotal = blueCardPoints + (blueBonus ? ROUND_WIN_BONUS : 0);

    if (redBonus) game.redMatchScore = (game.redMatchScore ?? 0) + ROUND_WIN_BONUS;
    if (blueBonus) game.blueMatchScore = (game.blueMatchScore ?? 0) + ROUND_WIN_BONUS;

    const roundResult: RoundResult = {
        roundNumber: game.matchRound ?? 1,
        roundWinner,
        redRoundScore: redRoundTotal,
        blueRoundScore: blueRoundTotal,
        redBonusAwarded: redBonus,
        blueBonusAwarded: blueBonus,
        endReason: deriveRoundEndReason(game),
        completedAt: Date.now(),
    };

    // Push to round history
    if (!game.roundHistory) game.roundHistory = [];
    game.roundHistory.push(roundResult);

    // Check match end condition: either team ≥ target AND lead ≥ margin
    const red = game.redMatchScore ?? 0;
    const blue = game.blueMatchScore ?? 0;
    if (red >= MATCH_TARGET || blue >= MATCH_TARGET) {
        const lead = Math.abs(red - blue);
        if (lead >= MATCH_WIN_MARGIN) {
            game.matchOver = true;
            game.matchWinner = red > blue ? 'red' : 'blue';
        }
    }

    return roundResult;
}

/**
 * Result of atomically finalizing a match round via executeGameTransaction.
 */
export interface MatchRoundFinalizationResult {
    roundResult: RoundResult;
    matchOver: boolean;
    matchWinner: Team | null;
    redMatchScore: number;
    blueMatchScore: number;
    roundHistory: RoundResult[];
    matchRound: number;
}

/**
 * Atomically finalize a completed round in match mode.
 * Acquires the reveal lock to prevent contention with concurrent
 * Lua-based operations (reveal, endTurn).
 *
 * Returns null if the game is not in match mode.
 */
export async function finalizeMatchRound(roomCode: string): Promise<MatchRoundFinalizationResult | null> {
    // Quick check to avoid unnecessary lock acquisition for non-match games
    const currentGame = await getGame(roomCode);
    if (!currentGame || currentGame.gameMode !== 'match') return null;

    return withLock(
        `reveal:${roomCode}`,
        async () => {
            const gameKey = `room:${roomCode}:game`;

            const result = await executeGameTransaction(
                gameKey,
                (game: GameState) => {
                    if (game.gameMode !== 'match') return null;

                    const roundResult = finalizeRound(game);
                    return {
                        roundResult,
                        matchOver: game.matchOver ?? false,
                        matchWinner: game.matchWinner ?? null,
                        redMatchScore: game.redMatchScore ?? 0,
                        blueMatchScore: game.blueMatchScore ?? 0,
                        roundHistory: game.roundHistory ?? [],
                        matchRound: game.matchRound ?? 1,
                    };
                },
                'finalizeMatchRound'
            );
            if (result) notifyGameMutation(roomCode);
            return result;
        },
        { lockTimeout: LOCKS.CARD_REVEAL * 1000, maxRetries: 5 }
    );
}

/**
 * Start the next round in a match.
 * Generates a new board with fresh words and scores, carrying forward match state.
 */
export async function startNextRound(
    roomCode: string,
    currentGame: GameState,
    options: CreateGameOptions = {}
): Promise<GameState> {
    return withLock(
        `game-create:${roomCode}`,
        async () => {
            const redis: RedisClient = getRedis();

            if (!currentGame.gameOver) {
                throw RoomError.gameInProgress(roomCode);
            }
            if (currentGame.matchOver) {
                throw GameStateError.gameOver();
            }

            const nextRound = (currentGame.matchRound ?? 1) + 1;

            const seed = generateSeed();
            const numericSeed = hashString(seed);

            const { words, usedWordListId } = await resolveGameWords(roomCode, options);
            const boardWords = selectBoardWords(words, numericSeed);
            const layout = generateBoardLayout(numericSeed, false);

            // Explicitly alternate first team based on previous round
            const previousFirstTeam = currentGame.firstTeamHistory?.slice(-1)[0];
            if (previousFirstTeam) {
                layout.firstTeam = previousFirstTeam === 'red' ? 'blue' : 'red';
            }

            const matchOptions: CreateGameOptions = {
                ...options,
                gameMode: 'match',
                matchCarryOver: {
                    matchRound: nextRound,
                    redMatchScore: currentGame.redMatchScore ?? 0,
                    blueMatchScore: currentGame.blueMatchScore ?? 0,
                    roundHistory: currentGame.roundHistory ?? [],
                    firstTeamHistory: currentGame.firstTeamHistory ?? [],
                },
            };

            const game = buildGameState(seed, usedWordListId, boardWords, layout, matchOptions);

            await persistGameState(redis, roomCode, game);
            notifyGameMutation(roomCode);

            logger.info(`Match round ${nextRound} started for room ${roomCode} with seed ${seed}`);
            return game;
        },
        { lockTimeout: LOCKS.GAME_CREATE * 1000, maxRetries: 10 }
    );
}

// Re-export for consumers
export type { RoundResult };

// All exports use `export` keyword on function declarations above.
