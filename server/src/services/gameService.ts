import type {
    Team,
    GameState,
    ForfeitHistoryEntry,
    CreateGameOptions,
    RevealResult,
    EndTurnResult,
    ClueResult,
    ForfeitResult,
    RoundResult,
} from '../types';

import { randomUUID } from 'crypto';
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
    OPTIMIZED_SUBMIT_CLUE_SCRIPT,
    gameStateSchema,
    MAX_HISTORY_ENTRIES,
    executeLuaScript,
    executeGameTransaction,
    revealResultSchema,
    endTurnResultSchema,
    clueResultSchema,
} from './game/luaGameOps';

import { isClueLegalForBoard, isValidClueWordShape, isValidClueNumberShape } from '../shared/gameRules';

// Re-export types for consumers
export type { CreateGameOptions, RevealResult, EndTurnResult, ForfeitResult };

// Re-export getGameStateForPlayer from revealEngine for consumers that access it via gameService
export { getGameStateForPlayer };

/**
 * Add entry to game history with cap to prevent unbounded growth
 */
function addToHistory(game: GameState, entry: ForfeitHistoryEntry): void {
    game.history ??= [];
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

// Zod schema for match carry-over data to prevent score manipulation.
// Scores are SIGNED: trap cards are worth -1 and the assassin can be worth -2
// (see gameRules CARD_SCORE_DISTRIBUTION / ASSASSIN_SCORE_POOL), so a round can
// net negative card points. The live game-state schema (luaGameOps) and the
// per-reveal Lua accumulation both allow negatives, so these fields must too —
// a .min(0) floor here would throw at the round transition for an otherwise
// valid match and permanently strand it.
const roundResultSchema = z.object({
    roundNumber: z.number().int().min(1),
    roundWinner: z.enum(['red', 'blue']).nullable(),
    redRoundScore: z.number().int(),
    blueRoundScore: z.number().int(),
    redBonusAwarded: z.boolean(),
    blueBonusAwarded: z.boolean(),
    endReason: z.string(),
    completedAt: z.number(),
});

const matchCarryOverSchema = z.object({
    matchRound: z.number().int().min(1).max(100),
    redMatchScore: z.number().int(),
    blueMatchScore: z.number().int(),
    roundHistory: z.array(roundResultSchema),
    firstTeamHistory: z.array(z.enum(['red', 'blue'])),
});

/**
 * Validate carry-over data consistency (scores match round history).
 * Logs warnings for inconsistencies rather than rejecting, since carry-over
 * only comes from server-internal startNextRound (not client input).
 */
function validateCarryOverConsistency(carry: z.infer<typeof matchCarryOverSchema>): void {
    if (carry.roundHistory.length > 0) {
        const expectedRed = carry.roundHistory.reduce((sum, r) => sum + r.redRoundScore, 0);
        const expectedBlue = carry.roundHistory.reduce((sum, r) => sum + r.blueRoundScore, 0);
        if (carry.redMatchScore !== expectedRed || carry.blueMatchScore !== expectedBlue) {
            logger.warn('Match carry-over score inconsistency detected', {
                redMatchScore: carry.redMatchScore,
                expectedRed,
                blueMatchScore: carry.blueMatchScore,
                expectedBlue,
                roundCount: carry.roundHistory.length,
            });
        }
    }
    if (carry.matchRound !== carry.roundHistory.length + 1) {
        logger.warn('Match carry-over round number inconsistency', {
            matchRound: carry.matchRound,
            roundHistoryLength: carry.roundHistory.length,
        });
    }
}

/**
 * Build a GameState object from resolved words and layout.
 */
function buildGameState(
    seed: string,
    usedWordListId: string | null,
    boardWords: string[],
    layout: ReturnType<typeof generateBoardLayout>,
    options: CreateGameOptions,
    wordPool?: string[]
): GameState {
    const isDuet = options.gameMode === 'duet';
    const isMatch = options.gameMode === 'match';
    const numericSeed = hashString(seed);

    const base: GameState = {
        id: randomUUID(),
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
        // Always record the mode (including 'classic') so clients can render the
        // correct UI. Previously only duet/match set it, leaving classic games
        // with an undefined gameMode that the client mistook for match mode.
        gameMode: options.gameMode ?? 'classic',
    };

    // Persist the full resolved word pool (not just the 25 selected board words)
    // so match rounds can draw a fresh board from the same source. Falls back to
    // the board words if the pool is not supplied (older callers).
    if (wordPool && wordPool.length >= boardWords.length) {
        base.wordPool = wordPool;
    }

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
            validateCarryOverConsistency(carry);
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

        // Snapshot the match score as it stands at the moment this round begins
        // (i.e. before any card in it is revealed) — revealCard.lua accrues card
        // points into redMatchScore/blueMatchScore live on every reveal, so
        // abandonGame needs this baseline to roll an abandoned round back to a
        // scoreless do-over instead of letting accrued points stick permanently.
        base.roundStartRedMatchScore = base.redMatchScore;
        base.roundStartBlueMatchScore = base.blueMatchScore;
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

            const seed = options.seed || generateSeed();
            const numericSeed = hashString(seed);
            const isDuet = options.gameMode === 'duet';

            const { words, usedWordListId } = await resolveGameWords(roomCode, options);
            const boardWords = selectBoardWords(words, numericSeed);
            const layout = generateBoardLayout(numericSeed, isDuet);
            const game = buildGameState(seed, usedWordListId, boardWords, layout, options, words);

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
                GAME_PAUSED: GameStateError.gamePaused(),
                NO_CLUE_GIVEN: GameStateError.noClueGiven(),
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
                    REDIS_TTL.ROOM.toString(),
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
                GAME_PAUSED: GameStateError.gamePaused(),
            };

            const result = await executeLuaScript<EndTurnResult>(
                OPTIMIZED_END_TURN_SCRIPT,
                gameKey,
                [
                    playerNickname,
                    Date.now().toString(),
                    MAX_HISTORY_ENTRIES.toString(),
                    expectedTeam,
                    REDIS_TTL.ROOM.toString(),
                ],
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
 * Submit a spymaster's clue for the current turn — atomic Lua execution under
 * the same distributed lock used by reveal/endTurn so it serializes with them.
 *
 * Role enforcement (spymaster-only) is the caller's responsibility; this
 * function validates game state, turn ownership, and clue legality (the clue
 * may not reference a word on the board) so that both the socket handler and
 * future internal callers (bots) share the same rules.
 */
export async function submitClue(
    roomCode: string,
    team: Team,
    word: string,
    clueNumber: number,
    spymasterName: string = 'Unknown'
): Promise<ClueResult> {
    const gameKey = `room:${roomCode}:game`;

    return withLock(
        `reveal:${roomCode}`,
        async () => {
            // Humans get these bounds at the socket boundary via gameClueSchema
            // (Zod), but bots call submitClue directly, skipping Zod entirely.
            // Re-check the same shared bounds here so a bot-originated clue (e.g.
            // from a hand-edited custom semantic map) can't violate an invariant
            // every other consumer (display, replay) assumes holds. See
            // docs/HARDENING_PLAN.md P1-8.
            const wordShape = isValidClueWordShape(word);
            if (!wordShape.valid) {
                throw new ValidationError(wordShape.reason ?? 'Invalid clue');
            }
            const numberShape = isValidClueNumberShape(clueNumber);
            if (!numberShape.valid) {
                throw new ValidationError(numberShape.reason ?? 'Invalid clue number');
            }

            // Read the board to enforce clue legality. Board words are immutable
            // for the lifetime of a game, so this read is not racy; the Lua op
            // below re-validates turn/game-over/paused atomically.
            const game = await getGame(roomCode);
            if (!game) throw GameStateError.noActiveGame();
            if (game.gameOver) throw GameStateError.gameOver();
            if (game.paused) throw GameStateError.gamePaused();
            if (game.currentTurn !== team) throw PlayerError.notYourTurn(team);
            if (!isClueLegalForBoard(word, game.words)) {
                throw new ValidationError('Clue cannot match or derive from a word on the board');
            }

            const luaErrorMap: Record<string, Error> = {
                NO_GAME: GameStateError.noActiveGame(),
                GAME_OVER: GameStateError.gameOver(),
                GAME_PAUSED: GameStateError.gamePaused(),
                NOT_YOUR_TURN: PlayerError.notYourTurn(team),
                CLUE_ALREADY_GIVEN: new ValidationError('A clue has already been given this turn'),
            };

            const result = await executeLuaScript<ClueResult>(
                OPTIMIZED_SUBMIT_CLUE_SCRIPT,
                gameKey,
                [
                    word,
                    Math.trunc(clueNumber).toString(),
                    spymasterName,
                    team,
                    Date.now().toString(),
                    MAX_HISTORY_ENTRIES.toString(),
                    REDIS_TTL.ROOM.toString(),
                ],
                luaErrorMap,
                `submitClue-${roomCode}`,
                clueResultSchema
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
                    // Unlike reveal/clue/endTurn, forfeit has no Lua paused
                    // backstop — guard it here so a paused game can't be forfeited.
                    if (game.paused) {
                        throw GameStateError.gamePaused();
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
                    // Abandon likewise has no Lua paused backstop.
                    if (game.paused) {
                        throw GameStateError.gamePaused();
                    }
                    game.gameOver = true;
                    game.winner = null;
                    // Match mode: card points accrue live into redMatchScore/blueMatchScore
                    // on every reveal (revealCard.lua), independent of round completion.
                    // Roll back to the snapshot taken when this round started so an
                    // abandoned round is a scoreless do-over, not a way to bank points
                    // and keep a permanent edge. Games persisted before the snapshot
                    // field existed fall back to a no-op (their current score is all
                    // there is to roll back to).
                    if (game.gameMode === 'match') {
                        game.redMatchScore = game.roundStartRedMatchScore ?? game.redMatchScore ?? 0;
                        game.blueMatchScore = game.roundStartBlueMatchScore ?? game.blueMatchScore ?? 0;
                    }
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
 * Pause an active game
 */
export async function pauseGame(roomCode: string): Promise<void> {
    const gameKey = `room:${roomCode}:game`;
    await withLock(
        `reveal:${roomCode}`,
        async () => {
            await executeGameTransaction(
                gameKey,
                (game: GameState) => {
                    if (game.gameOver) throw GameStateError.gameOver();
                    game.paused = true;
                },
                `pauseGame-${roomCode}`
            );
            notifyGameMutation(roomCode);
        },
        { lockTimeout: LOCKS.CARD_REVEAL * 1000, maxRetries: 5 }
    );
}

/**
 * Resume a paused game
 */
export async function resumeGame(roomCode: string): Promise<void> {
    const gameKey = `room:${roomCode}:game`;
    await withLock(
        `reveal:${roomCode}`,
        async () => {
            await executeGameTransaction(
                gameKey,
                (game: GameState) => {
                    game.paused = false;
                },
                `resumeGame-${roomCode}`
            );
            // Resuming is a state change bots and clients must react to; without
            // this a bot on the acting seat never wakes up after a pause.
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
                    // Only finalize a round that has actually ended, and only once.
                    // A racing startNextRound can create round N+1 (gameOver=false)
                    // before finalization runs — without these guards finalizeRound
                    // would push a phantom 0/0 entry for the just-started round, skip
                    // the +ROUND_WIN_BONUS for round N, and broadcast roundEnded for
                    // a round that just began. Checked inside the transaction so the
                    // executeGameTransaction retry re-reads current state each attempt.
                    if (!game.gameOver) return null;
                    const lastRound = game.roundHistory?.[game.roundHistory.length - 1];
                    if (lastRound && lastRound.roundNumber === (game.matchRound ?? 1)) {
                        // This round was already finalized (its result is at the tail
                        // of roundHistory) — don't double-award or double-broadcast.
                        return null;
                    }

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

            // Re-read the authoritative state under the lock rather than trusting
            // the caller's snapshot: two concurrent game:nextRound calls would
            // otherwise both pass these guards on the same stale `currentGame` and
            // each regenerate a board (phantom round, lost bonus).
            const freshGame = (await getGame(roomCode)) ?? currentGame;

            if (!freshGame.gameOver) {
                throw RoomError.gameInProgress(roomCode);
            }
            if (freshGame.matchOver) {
                throw GameStateError.gameOver();
            }

            const nextRound = (freshGame.matchRound ?? 1) + 1;

            const seed = generateSeed();
            const numericSeed = hashString(seed);

            // Reuse the full word pool from the prior round so a fresh board is
            // drawn from the same source. `freshGame.words` is only the 25 board
            // words, so passing those would reshuffle the identical set every
            // round — draw from the persisted pool instead.
            const poolOverride = freshGame.wordPool && freshGame.wordPool.length > 0 ? freshGame.wordPool : undefined;
            const { words, usedWordListId } = await resolveGameWords(roomCode, {
                ...options,
                wordList: poolOverride ?? options.wordList,
            });
            const boardWords = selectBoardWords(words, numericSeed);

            // Alternate the first team from the previous round, forcing it into
            // board generation so the card counts (9/8) and types array stay
            // consistent with firstTeam.
            const previousFirstTeam = freshGame.firstTeamHistory?.slice(-1)[0];
            const forcedFirstTeam: 'red' | 'blue' | undefined = previousFirstTeam
                ? previousFirstTeam === 'red'
                    ? 'blue'
                    : 'red'
                : undefined;
            const layout = generateBoardLayout(numericSeed, false, forcedFirstTeam);

            const matchOptions: CreateGameOptions = {
                ...options,
                gameMode: 'match',
                matchCarryOver: {
                    matchRound: nextRound,
                    redMatchScore: freshGame.redMatchScore ?? 0,
                    blueMatchScore: freshGame.blueMatchScore ?? 0,
                    roundHistory: freshGame.roundHistory ?? [],
                    firstTeamHistory: freshGame.firstTeamHistory ?? [],
                },
            };

            const game = buildGameState(seed, usedWordListId, boardWords, layout, matchOptions, words);

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
