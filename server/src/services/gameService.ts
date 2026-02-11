/**
 * Game Service - Core game logic
 */

import type {
    Team,
    CardType,
    GameState,
    Clue,
    RevealHistoryEntry,
    ClueHistoryEntry,
    EndTurnHistoryEntry,
    ForfeitHistoryEntry,
    Player,
    PlayerGameState,
    CreateGameOptions,
    RevealResult,
    ClueWithGuesses,
    EndTurnResult,
    ForfeitResult,
    ClueValidationResult
} from '../types';

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const { getRedis } = require('../config/redis');
const logger = require('../utils/logger');
const wordListService = require('./wordListService');
const {
    BOARD_SIZE,
    FIRST_TEAM_CARDS,
    SECOND_TEAM_CARDS,
    NEUTRAL_CARDS,
    DEFAULT_WORDS,
    REDIS_TTL,
    ERROR_CODES,
    GAME_HISTORY,
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
const { toEnglishUpperCase, localeIncludes } = require('../utils/sanitize');
const { RELEASE_LOCK_SCRIPT } = require('../utils/distributedLock');
const { tryParseJSON, parseJSON } = require('../utils/parseJSON');
const { z } = require('zod');

// Zod schema for GameState deserialization validation.
// Validates critical fields when present; marks non-essential fields optional
// so tests with sparse mocks still pass. No .passthrough() — unknown keys are stripped.
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
    clues: z.array(z.unknown()).optional(),
    history: z.array(z.unknown()).optional(),
    stateVersion: z.number().optional(),
    createdAt: z.number().optional(),
    gameMode: z.string().optional(),
    wordListId: z.string().nullable().optional(),
    // Duet mode fields
    duetTypes: z.array(z.string()).optional(),
    timerTokens: z.number().optional(),
    greenFound: z.number().optional(),
    greenTotal: z.number().optional(),
});

// Lightweight schema for duet-mode pre-check (only need gameMode field)
const gameModePreCheckSchema = z.object({
    gameMode: z.string().optional(),
});

// Lua script result schemas for runtime validation of JSON returned from Redis eval.
// Results may be success objects or error objects ({ error: "..." }),
// so we use z.record() to validate it's a JSON object without requiring specific fields.
const luaResultObjectSchema = z.record(z.unknown());

// Result types imported from ../types (single source of truth)
export type { CreateGameOptions, RevealResult, EndTurnResult, ForfeitResult, ClueValidationResult };
/**
 * Reveal outcome determination (internal)
 */
interface RevealOutcome {
    turnEnded: boolean;
    endReason: RevealResult['endReason'];
}

/**
 * History entry union type
 */
type HistoryEntry = RevealHistoryEntry | ClueHistoryEntry | EndTurnHistoryEntry | ForfeitHistoryEntry;

/**
 * Redis client type (simplified for migration)
 */
interface RedisClient {
    get(key: string): Promise<string | null>;
    set(key: string, value: string, options?: { EX?: number; NX?: boolean }): Promise<string | null>;
    del(key: string): Promise<number>;
    ttl(key: string): Promise<number>;
    expire(key: string, seconds: number): Promise<number>;
    watch(key: string): Promise<string>;
    unwatch(): Promise<string>;
    multi(): RedisTransaction;
    eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
}

interface RedisTransaction {
    set(key: string, value: string, options?: { EX?: number }): RedisTransaction;
    exec(): Promise<unknown[] | null>;
}

// Use centralized constants
const MAX_HISTORY_ENTRIES: number = GAME_HISTORY.MAX_ENTRIES;
const MAX_CLUES: number = GAME_HISTORY.MAX_CLUES;
const MAX_TRANSACTION_RETRIES: number = RETRY_CONFIG.OPTIMISTIC_LOCK.maxRetries;

/**
 * Execute a Redis transaction with optimistic locking and retries
 * Reduces code duplication across game state operations
 */
async function executeGameTransaction<T>(
    gameKey: string,
    operation: (game: GameState) => T | Promise<T>,
    _operationName: string
): Promise<T> {
    const redis: RedisClient = getRedis();
    const roomCode = gameKey.replace('room:', '').replace(':game', '');
    let retries = 0;

    while (retries < MAX_TRANSACTION_RETRIES) {
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

            // Execute the operation and get result
            const result = await operation(game);

            // Increment state version for conflict detection
            incrementVersion(game);

            // Preserve existing TTL so the key doesn't become permanent
            const currentTTL = await redis.ttl(gameKey);
            const ttl = currentTTL > 0 ? currentTTL : REDIS_TTL.ROOM;

            // Execute transaction
            const txResult = await redis.multi()
                .set(gameKey, JSON.stringify(game), { EX: ttl })
                .exec();

            // If transaction failed (key was modified), retry
            if (txResult === null) {
                await redis.unwatch();
                retries++;
                continue;
            }

            return result;

        } catch (error) {
            await redis.unwatch();
            throw error;
        }
    }

    throw ServerError.concurrentModification();
}

/**
 * ISSUE #36 FIX: Lua script for optimized card reveal
 * Updates only the necessary fields instead of full JSON re-serialization
 * This reduces CPU overhead for frequent card reveal operations
 */
const OPTIMIZED_REVEAL_SCRIPT: string = fs.readFileSync(path.join(__dirname, '../scripts/revealCard.lua'), 'utf8');

/**
 * Lua script for optimized clue giving
 * Performs atomic clue validation and state update in Redis
 */
const OPTIMIZED_GIVE_CLUE_SCRIPT: string = fs.readFileSync(path.join(__dirname, '../scripts/giveClue.lua'), 'utf8');

/**
 * Lua script for optimized end turn
 * Atomically switches turn and resets clue state
 */
const OPTIMIZED_END_TURN_SCRIPT: string = fs.readFileSync(path.join(__dirname, '../scripts/endTurn.lua'), 'utf8');

/**
 * Seeded random number generator using Mulberry32 algorithm
 * Provides better distribution than Math.sin-based approach
 * Must stay in sync with client-side implementation in index.html
 */
export function seededRandom(seed: number): number {
    // Mulberry32 PRNG - better distribution than sin-based approach
    let t = (seed + 0x6D2B79F5) | 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * Hash string to number
 * Uses codePointAt to properly handle Unicode characters including emoji
 * (which are represented as surrogate pairs and have codepoints > 0xFFFF)
 */
export function hashString(str: string): number {
    let hash = 0;
    // Use spread operator to properly iterate over Unicode code points
    // This handles surrogate pairs (emoji, etc.) correctly
    for (const char of str) {
        const codePoint = char.codePointAt(0);
        if (codePoint !== undefined) {
            hash = ((hash << 5) - hash) + codePoint;
            hash = hash & hash;
        }
    }
    return Math.abs(hash);
}

/**
 * Shuffle array with seed
 */
export function shuffleWithSeed<T>(array: T[], seed: number): T[] {
    const shuffled = [...array];
    let currentSeed = seed;
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(seededRandom(currentSeed++) * (i + 1));
        const temp = shuffled[i];
        const swapItem = shuffled[j];
        if (temp !== undefined && swapItem !== undefined) {
            shuffled[i] = swapItem;
            shuffled[j] = temp;
        }
    }
    return shuffled;
}

/**
 * Generate a random game seed using crypto for better randomness
 * Uses hoisted crypto module for performance (avoids require() per call)
 */
export function generateSeed(): string {
    try {
        return crypto.randomBytes(6).toString('hex');
    } catch {
        // Fallback to Math.random if crypto is unavailable
        return Math.random().toString(36).substring(2, 10) +
               Math.random().toString(36).substring(2, 6);
    }
}

/**
 * Generate Duet mode board with dual key cards
 * Side A (types[]): 9 green (as 'red'), 3 assassin, 13 bystander (as 'neutral')
 * Side B (duetTypes[]): 9 green (as 'blue'), 3 assassin, 13 bystander (as 'neutral')
 * With specific overlap distribution per DUET_BOARD_CONFIG
 */
export function generateDuetBoard(seed: number): { types: CardType[]; duetTypes: CardType[] } {
    const { greenOverlap, greenOnlyA, greenOnlyB, assassinOverlap, assassinOnlyA, assassinOnlyB, bystanderBoth } = DUET_BOARD_CONFIG;

    // Build paired type assignments for each position
    // [typeA, typeB] pairs
    const pairs: [CardType, CardType][] = [
        ...Array(greenOverlap).fill(null).map((): [CardType, CardType] => ['red', 'blue']),         // green/green
        ...Array(greenOnlyA).fill(null).map((): [CardType, CardType] => ['red', 'neutral']),        // green(A)/bystander(B)
        ...Array(greenOnlyB).fill(null).map((): [CardType, CardType] => ['neutral', 'blue']),       // bystander(A)/green(B)
        ...Array(assassinOverlap).fill(null).map((): [CardType, CardType] => ['assassin', 'assassin']), // assassin/assassin
        ...Array(assassinOnlyA).fill(null).map((): [CardType, CardType] => ['assassin', 'neutral']),   // assassin(A)/bystander(B)
        ...Array(assassinOnlyB).fill(null).map((): [CardType, CardType] => ['neutral', 'assassin']),   // bystander(A)/assassin(B)
        ...Array(bystanderBoth).fill(null).map((): [CardType, CardType] => ['neutral', 'neutral'])     // bystander/bystander
    ];

    // Shuffle the pairs to randomize board positions
    const shuffledPairs = shuffleWithSeed(pairs, seed);

    const types: CardType[] = shuffledPairs.map(p => p[0]);
    const duetTypes: CardType[] = shuffledPairs.map(p => p[1]);

    return { types, duetTypes };
}

/**
 * Create a new game for a room
 */
export async function createGame(
    roomCode: string,
    options: CreateGameOptions = {}
): Promise<GameState> {
    const redis: RedisClient = getRedis();

    // RACE CONDITION FIX: Use creation lock to prevent simultaneous game creation
    // Uses centralized LOCKS.GAME_CREATE constant
    const lockKey = `room:${roomCode}:game:creating`;
    const lockValue = `${process.pid}:${Date.now()}`;
    const lockAcquired = await redis.set(lockKey, lockValue, { NX: true, EX: LOCKS.GAME_CREATE });

    if (!lockAcquired) {
        // Another creation in progress - wait briefly and check if game exists
        await new Promise(resolve => setTimeout(resolve, RETRY_CONFIG.RACE_CONDITION.delayMs));
        const existingGame = await getGame(roomCode);
        if (existingGame && !existingGame.gameOver) {
            throw RoomError.gameInProgress(roomCode);
        }
        // Lock expired but no game - try again
        throw new Error('Game creation in progress by another player, please try again');
    }

    try {
        // Double-check no game exists (within lock)
        const existingGame = await getGame(roomCode);
        if (existingGame && !existingGame.gameOver) {
            throw RoomError.gameInProgress(roomCode);
        }

        // FIX: Verify room still exists before creating game (prevents orphaned games)
        // Using get instead of exists since we need the room data anyway
        const preCheckRoomData = await redis.get(`room:${roomCode}`);
        if (!preCheckRoomData) {
            throw RoomError.notFound(roomCode);
        }

        const seed = generateSeed();
        const numericSeed = hashString(seed);

        const { wordListId, wordList, gameMode } = options;
        const isDuet = gameMode === 'duet';

        // Get words - priority: direct wordList > wordListId > default
        let words: string[] = DEFAULT_WORDS;
        let usedWordListId: string | null = null;

        // Option 1: Direct word list passed from client (no database needed)
        if (wordList && Array.isArray(wordList) && wordList.length >= BOARD_SIZE) {
            // Clean and deduplicate words
            const cleanedWords = [...new Set(
                wordList
                    .map(w => toEnglishUpperCase(String(w).trim()))
                    .filter((w: string) => w.length > 0)
            )];

            if (cleanedWords.length >= BOARD_SIZE) {
                words = cleanedWords;
                logger.info(`Using ${cleanedWords.length} custom words for room ${roomCode}`);
            } else {
                logger.warn(`Custom word list too small after cleaning (${cleanedWords.length}), using default`);
            }
        }
        // Option 2: Word list ID from database
        else if (wordListId) {
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
                // Fall back to default words
            }
        }

        // Select 25 random words
        const shuffledWords = shuffleWithSeed(words, numericSeed);
        const boardWords = shuffledWords.slice(0, BOARD_SIZE);

        // Determine who goes first
        const firstTeam: Team = seededRandom(numericSeed + GAME_INTERNALS.FIRST_TEAM_SEED_OFFSET) > 0.5 ? 'red' : 'blue';

        let types: CardType[];
        let duetTypes: CardType[] | undefined;
        let redTotal: number;
        let blueTotal: number;

        if (isDuet) {
            // Duet mode: generate dual key cards
            const duetBoard = generateDuetBoard(numericSeed + GAME_INTERNALS.TYPES_SHUFFLE_SEED_OFFSET);
            types = duetBoard.types;
            duetTypes = duetBoard.duetTypes;
            // In Duet, redTotal/blueTotal represent greens visible to each side (9 each)
            redTotal = DUET_BOARD_CONFIG.greenOverlap + DUET_BOARD_CONFIG.greenOnlyA;  // 9
            blueTotal = DUET_BOARD_CONFIG.greenOverlap + DUET_BOARD_CONFIG.greenOnlyB; // 9
        } else {
            // Classic/Blitz: standard board generation
            if (firstTeam === 'red') {
                types = [
                    ...Array(FIRST_TEAM_CARDS).fill('red') as CardType[],
                    ...Array(SECOND_TEAM_CARDS).fill('blue') as CardType[]
                ];
                redTotal = FIRST_TEAM_CARDS;
                blueTotal = SECOND_TEAM_CARDS;
            } else {
                types = [
                    ...Array(SECOND_TEAM_CARDS).fill('red') as CardType[],
                    ...Array(FIRST_TEAM_CARDS).fill('blue') as CardType[]
                ];
                redTotal = SECOND_TEAM_CARDS;
                blueTotal = FIRST_TEAM_CARDS;
            }
            types = [...types, ...Array(NEUTRAL_CARDS).fill('neutral') as CardType[], 'assassin'];
            types = shuffleWithSeed(types, numericSeed + GAME_INTERNALS.TYPES_SHUFFLE_SEED_OFFSET);
        }

        const game: GameState = {
            id: uuidv4(),
            seed,
            wordListId: usedWordListId,
            words: boardWords,
            types,
            revealed: Array(BOARD_SIZE).fill(false),
            currentTurn: firstTeam,
            redScore: 0,
            blueScore: 0,
            redTotal,
            blueTotal,
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
                duetTypes,
                timerTokens: DUET_BOARD_CONFIG.timerTokens,
                greenFound: 0,
                greenTotal: DUET_BOARD_CONFIG.greenTotal
            } : {})
        };

        // Store in Redis with TTL (same as room)
        await redis.set(`room:${roomCode}:game`, JSON.stringify(game), { EX: REDIS_TTL.ROOM });

        // Update room status and refresh TTL
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

        // Refresh related keys TTL
        await redis.expire(`room:${roomCode}:players`, REDIS_TTL.ROOM);

        logger.info(`Game created for room ${roomCode} with seed ${seed}`);
        return game;
    } finally {
        // Always release the creation lock (owner-verified to avoid releasing another instance's lock)
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
 * Get game state for a specific player (hides card types for non-spymasters)
 */
export function getGameStateForPlayer(
    game: GameState | null,
    player: Player | null
): PlayerGameState | null {
    // BUG FIX: Validate game parameter to prevent null pointer errors
    if (!game) {
        logger.warn('getGameStateForPlayer called with null/undefined game');
        return null;
    }

    const isDuet = game.gameMode === 'duet';
    const state: PlayerGameState = {
        id: game.id,
        words: game.words,
        revealed: game.revealed,
        currentTurn: game.currentTurn,
        redScore: game.redScore,
        blueScore: game.blueScore,
        redTotal: game.redTotal,
        blueTotal: game.blueTotal,
        gameOver: game.gameOver,
        winner: game.winner,
        currentClue: game.currentClue,
        guessesUsed: game.guessesUsed || 0,
        guessesAllowed: game.guessesAllowed || 0,
        clues: game.clues || [],
        history: game.history || [],
        types: [],
        ...(isDuet ? {
            gameMode: game.gameMode,
            timerTokens: game.timerTokens,
            greenFound: game.greenFound,
            greenTotal: game.greenTotal
        } : {})
    };

    // SECURITY: Only spymasters see unrevealed card types
    // BUG FIX: Handle null/undefined player parameter gracefully
    const isSpymaster = player && player.role === 'spymaster';
    const playerTeam = player?.team;

    if (isDuet) {
        // Duet mode: each spymaster sees only their own side's key card
        // Red spymaster sees types[] (Side A), Blue spymaster sees duetTypes[] (Side B)
        if (game.gameOver) {
            state.types = game.types;
            state.duetTypes = game.duetTypes;
        } else if (isSpymaster && playerTeam === 'red') {
            // Red spymaster sees Side A key card
            state.types = game.types;
            // Sees Side B only for revealed cards
            state.duetTypes = game.duetTypes?.map((type, i) =>
                game.revealed[i] ? type : null
            );
        } else if (isSpymaster && playerTeam === 'blue') {
            // Blue spymaster sees Side B key card
            state.duetTypes = game.duetTypes;
            // Sees Side A only for revealed cards
            state.types = game.types.map((type, i) =>
                game.revealed[i] ? type : null
            );
        } else {
            // Non-spymasters see only revealed cards
            state.types = game.types.map((type, i) =>
                game.revealed[i] ? type : null
            );
            state.duetTypes = game.duetTypes?.map((type, i) =>
                game.revealed[i] ? type : null
            );
        }
    } else {
        // Classic/Blitz mode: standard visibility
        if (isSpymaster || game.gameOver) {
            state.types = game.types;
        } else {
            state.types = game.types.map((type, i) =>
                game.revealed[i] ? type : null
            );
        }
    }

    return state;
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
        // Delete corrupted data to allow recovery
        await redis.del(`room:${roomCode}:game`);
    }
    return game;
}

/**
 * Safely parse game data with error handling
 */
function safeParseGameData(gameData: string, roomCode: string): GameState | null {
    return tryParseJSON(gameData, gameStateSchema, `game state for ${roomCode}`) as GameState | null;
}

/**
 * Add entry to game history with cap to prevent unbounded growth
 */
function addToHistory(game: GameState, entry: HistoryEntry): void {
    if (!game.history) game.history = [];
    game.history.push(entry);

    // Lazy history slicing: Only slice when exceeding threshold multiplier
    // This reduces O(n) allocations on every entry to occasional cleanup
    const lazyThreshold = Math.floor(MAX_HISTORY_ENTRIES * GAME_INTERNALS.LAZY_HISTORY_MULTIPLIER);
    if (game.history.length > lazyThreshold) {
        // Keep most recent entries
        game.history = game.history.slice(-MAX_HISTORY_ENTRIES);
    }
}

/**
 * Increment game state version (for optimistic locking/conflict detection)
 */
function incrementVersion(game: GameState): number {
    game.stateVersion = (game.stateVersion || 0) + 1;
    return game.stateVersion;
}

/**
 * Validate card index bounds
 */
export function validateCardIndex(index: number): void {
    if (typeof index !== 'number' || !Number.isFinite(index) ||
        index < 0 || index >= BOARD_SIZE || !Number.isInteger(index)) {
        throw ValidationError.invalidCardIndex(index, BOARD_SIZE);
    }
}

/**
 * Validate game state preconditions for revealing a card
 */
export function validateRevealPreconditions(game: GameState, index: number): void {
    if (game.gameOver) {
        throw GameStateError.gameOver();
    }

    // 0 = unlimited guesses for "0" clue
    if (game.guessesAllowed > 0 && game.guessesUsed >= game.guessesAllowed) {
        throw ValidationError.noGuessesRemaining();
    }

    if (game.revealed[index]) {
        throw GameStateError.cardAlreadyRevealed(index);
    }
}

/**
 * Execute the reveal and update scores
 * In Duet mode, uses the active team's perspective to determine card type
 */
export function executeCardReveal(game: GameState, index: number): CardType {
    game.revealed[index] = true;

    let type: CardType;
    if (game.gameMode === 'duet') {
        // Duet: use the current turn's perspective
        if (game.currentTurn === 'blue' && game.duetTypes) {
            type = game.duetTypes[index] as CardType;
        } else {
            type = game.types[index] as CardType;
        }

        // Track green cards found
        if (type === 'red' || type === 'blue') {
            // 'red' = green for Side A, 'blue' = green for Side B
            game.greenFound = (game.greenFound || 0) + 1;
            if (game.currentTurn === 'red') {
                game.redScore++;
            } else {
                game.blueScore++;
            }
        }
    } else {
        // Classic/Blitz: standard scoring
        type = game.types[index] as CardType;
        if (type === 'red') {
            game.redScore++;
        } else if (type === 'blue') {
            game.blueScore++;
        }
    }

    game.guessesUsed = (game.guessesUsed || 0) + 1;

    return type;
}

/**
 * Determine the outcome of revealing a card
 */
export function determineRevealOutcome(
    game: GameState,
    cardType: CardType,
    revealingTeam: Team
): RevealOutcome {
    const outcome: RevealOutcome = { turnEnded: false, endReason: null };

    if (game.gameMode === 'duet') {
        return determineDuetRevealOutcome(game, cardType, revealingTeam, outcome);
    }

    // Classic/Blitz mode logic
    // Check for assassin - immediate loss
    if (cardType === 'assassin') {
        game.gameOver = true;
        game.winner = revealingTeam === 'red' ? 'blue' : 'red';
        outcome.endReason = 'assassin';
        outcome.turnEnded = true;
        return outcome;
    }

    // Check for win by completing all team's words
    if (game.redScore >= game.redTotal) {
        game.gameOver = true;
        game.winner = 'red';
        outcome.endReason = 'completed';
        outcome.turnEnded = true;
        return outcome;
    }

    if (game.blueScore >= game.blueTotal) {
        game.gameOver = true;
        game.winner = 'blue';
        outcome.endReason = 'completed';
        outcome.turnEnded = true;
        return outcome;
    }

    // Wrong guess ends turn
    if (cardType !== revealingTeam) {
        switchTurn(game);
        outcome.turnEnded = true;
        return outcome;
    }

    // Check if max guesses reached (only if not unlimited)
    if (game.guessesAllowed > 0 && game.guessesUsed >= game.guessesAllowed) {
        switchTurn(game);
        outcome.turnEnded = true;
        outcome.endReason = 'maxGuesses';
        return outcome;
    }

    return outcome;
}

/**
 * Determine reveal outcome for Duet mode (cooperative rules)
 */
function determineDuetRevealOutcome(
    game: GameState,
    cardType: CardType,
    _revealingTeam: Team,
    outcome: RevealOutcome
): RevealOutcome {
    // Assassin = instant loss (both teams lose, no winner)
    if (cardType === 'assassin') {
        game.gameOver = true;
        game.winner = null; // Cooperative loss - no winner
        outcome.endReason = 'assassin';
        outcome.turnEnded = true;
        return outcome;
    }

    // Check for cooperative win (all 15 unique greens found)
    if ((game.greenFound || 0) >= (game.greenTotal || DUET_BOARD_CONFIG.greenTotal)) {
        game.gameOver = true;
        // Both teams win - mark as 'red' (arbitrary; frontend shows "You Win!")
        game.winner = 'red';
        outcome.endReason = 'completed';
        outcome.turnEnded = true;
        return outcome;
    }

    // Bystander (neutral) = wrong guess, costs a timer token, ends turn
    if (cardType === 'neutral') {
        game.timerTokens = (game.timerTokens || 0) - 1;

        // Check if out of timer tokens
        if ((game.timerTokens || 0) <= 0) {
            game.gameOver = true;
            game.winner = null; // Cooperative loss
            outcome.endReason = 'timerTokens';
            outcome.turnEnded = true;
            return outcome;
        }

        switchTurn(game);
        outcome.turnEnded = true;
        return outcome;
    }

    // Correct guess (green card = 'red' for Side A or 'blue' for Side B)
    // Check if max guesses reached
    if (game.guessesAllowed > 0 && game.guessesUsed >= game.guessesAllowed) {
        switchTurn(game);
        outcome.turnEnded = true;
        outcome.endReason = 'maxGuesses';
        return outcome;
    }

    return outcome;
}

/**
 * Switch turn to the other team and reset clue state
 */
export function switchTurn(game: GameState): void {
    game.currentTurn = game.currentTurn === 'red' ? 'blue' : 'red';
    game.currentClue = null;
    game.guessesUsed = 0;
    game.guessesAllowed = 0;
}

/**
 * Build the reveal result object
 */
export function buildRevealResult(
    game: GameState,
    index: number,
    type: CardType,
    outcome: RevealOutcome
): RevealResult {
    // Bounds check for index to prevent undefined access
    const word = (game.words && index >= 0 && index < game.words.length)
        ? game.words[index]
        : 'UNKNOWN';

    const result: RevealResult = {
        index,
        type,
        word: word || 'UNKNOWN',
        redScore: game.redScore ?? 0,
        blueScore: game.blueScore ?? 0,
        currentTurn: game.currentTurn,
        guessesUsed: game.guessesUsed ?? 0,
        guessesAllowed: game.guessesAllowed ?? 0,
        turnEnded: outcome.turnEnded,
        gameOver: game.gameOver ?? false,
        winner: game.winner,
        endReason: outcome.endReason,
        allTypes: game.gameOver ? game.types : null
    };

    // Include Duet-specific fields
    if (game.gameMode === 'duet') {
        result.timerTokens = game.timerTokens;
        result.greenFound = game.greenFound;
        result.allDuetTypes = game.gameOver ? (game.duetTypes || null) : null;
    }

    return result;
}

/**
 * ISSUE #36 FIX: Optimized card reveal using Lua script
 * Performs the entire reveal operation atomically in Redis, avoiding
 * the overhead of multiple round-trips and full JSON re-serialization in Node.js
 * Bug #4 & #9 fix: Now takes playerTeam for turn validation in Lua
 */
export async function revealCardOptimized(
    roomCode: string,
    index: number,
    playerNickname: string = 'Unknown',
    playerTeam: string = ''
): Promise<RevealResult> {
    const redis: RedisClient = getRedis();
    const gameKey = `room:${roomCode}:game`;

    // Validate index before executing
    validateCardIndex(index);

    try {
        // Wrap Redis Lua eval with timeout to prevent hanging operations
        const resultStr = await withTimeout(
            redis.eval(
                OPTIMIZED_REVEAL_SCRIPT,
                {
                    keys: [gameKey],
                    arguments: [
                        index.toString(),
                        Date.now().toString(),
                        playerNickname,
                        MAX_HISTORY_ENTRIES.toString(),
                        playerTeam || ''  // Bug #4 fix: Pass team for turn validation
                    ]
                }
            ),
            TIMEOUTS.REDIS_OPERATION,
            `revealCard-lua-${roomCode}`
        ) as string | null;

        // BUG FIX: Validate Lua script result before accessing properties
        if (!resultStr || typeof resultStr !== 'string') {
            throw new ServerError('Invalid Lua script result: empty or non-string');
        }

        let result: RevealResult & { error?: string };
        try {
            result = parseJSON(resultStr, luaResultObjectSchema, `revealCard Lua result for ${roomCode}`) as RevealResult & { error?: string };
        } catch (parseError) {
            logger.error('Failed to parse Lua reveal script result', { roomCode, error: (parseError as Error).message });
            throw new ServerError('Failed to parse game operation result');
        }

        // Handle errors returned by the Lua script
        if (result.error) {
            const errorMap: Record<string, { code: string; message: string }> = {
                'NO_GAME': { code: ERROR_CODES.ROOM_NOT_FOUND, message: 'No active game' },
                'GAME_OVER': { code: ERROR_CODES.GAME_OVER, message: 'Game is already over' },
                'NO_GUESSES': { code: ERROR_CODES.INVALID_INPUT, message: 'No guesses remaining this turn' },
                'ALREADY_REVEALED': { code: ERROR_CODES.CARD_ALREADY_REVEALED, message: 'Card already revealed' },
                // Bug #4 fix: Turn validation error
                'NOT_YOUR_TURN': { code: ERROR_CODES.NOT_YOUR_TURN, message: "It's not your team's turn" },
                // Bug #9 fix: No clue given error
                'NO_CLUE': { code: ERROR_CODES.NO_CLUE, message: 'Spymaster must give a clue before revealing cards' },
                // Defense-in-depth: Invalid index caught by Lua bounds check
                'INVALID_INDEX': { code: ERROR_CODES.INVALID_INPUT, message: 'Invalid card index' }
            };
            const err = errorMap[result.error] || { code: ERROR_CODES.SERVER_ERROR, message: result.error };
            throw err;
        }

        logger.debug(`Optimized reveal completed for card ${index} in room ${roomCode}`);
        return result;

    } catch (error) {
        // If it's already a known error, rethrow
        if ((error as { code?: string }).code) {
            throw error;
        }
        // Otherwise, log and rethrow
        logger.error('Optimized reveal failed', { roomCode, error: (error as Error).message });
        throw new ServerError('Failed to reveal card');
    }
}

/**
 * Reveal a card with distributed lock to prevent race conditions
 * Uses a lock to ensure only one reveal operation runs at a time per room
 * Orchestrates the reveal process using helper functions
 *
 * ISSUE #36 FIX: Now uses optimized Lua script path with fallback to
 * original implementation if Lua evaluation fails
 * Bug #4 fix: Now takes playerTeam for turn validation in Lua
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

    // Validate index before starting transaction
    validateCardIndex(index);

    // ISSUE #17 & #32 FIX: Acquire distributed lock with longer TTL to prevent race conditions
    // Uses centralized LOCKS.CARD_REVEAL constant to accommodate retry loops and slow Redis operations
    const lockValue = `${process.pid}:${Date.now()}`;
    const lockAcquired = await redis.set(lockKey, lockValue, { NX: true, EX: LOCKS.CARD_REVEAL });
    if (!lockAcquired) {
        throw new ServerError('Another card reveal is in progress, please try again');
    }

    try {
        // Check if this is a Duet game - skip Lua optimization for Duet (uses TypeScript logic)
        const preCheckData = await redis.get(gameKey);
        const isDuetGame = preCheckData ? tryParseJSON(preCheckData, gameModePreCheckSchema, `duet pre-check for ${roomCode}`)?.gameMode === 'duet' : false;

        if (!isDuetGame) {
            // ISSUE #36 FIX: Try optimized Lua script first (classic/blitz only)
            try {
                return await revealCardOptimized(roomCode, index, playerNickname, playerTeam);
            } catch (luaError) {
                // If Lua script fails due to script-specific issues, fall back to original
                // But propagate game logic errors (like GAME_OVER, CARD_ALREADY_REVEALED)
                if ((luaError as { code?: string }).code && (luaError as { code?: string }).code !== ERROR_CODES.SERVER_ERROR) {
                    throw luaError;
                }
                logger.warn(`Lua reveal failed, falling back to standard reveal for room ${roomCode}: ${(luaError as Error).message}`);
            }
        }

        // Fallback / Duet mode implementation
        const maxRetries = 3;
        let retries = 0;

        while (retries < maxRetries) {
            try {
                // Watch the key for changes
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

                // Validate preconditions
                validateRevealPreconditions(game, index);

                const previousTurn = game.currentTurn;

                // Execute the reveal
                const cardType = executeCardReveal(game, index);

                // Determine outcome
                const outcome = determineRevealOutcome(game, cardType, previousTurn);

                // Add to history
                const gameWord = game.words[index];
                addToHistory(game, {
                    action: 'reveal',
                    index,
                    word: gameWord || 'UNKNOWN',
                    type: cardType,
                    team: previousTurn,
                    player: playerNickname,
                    guessNumber: game.guessesUsed,
                    timestamp: Date.now()
                });

                // Increment state version for conflict detection
                incrementVersion(game);

                // Preserve TTL so the key doesn't become permanent
                const currentTTL = await redis.ttl(gameKey);
                const ttl = currentTTL > 0 ? currentTTL : REDIS_TTL.ROOM;

                // Execute transaction
                const result = await redis.multi()
                    .set(gameKey, JSON.stringify(game), { EX: ttl })
                    .exec();

                // If transaction failed (key was modified), retry
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
    } finally {
        // ISSUE #32 FIX: Always release the distributed lock (owner-verified)
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
 * Validate that a clue word is not on the board
 * Rules:
 * - Exact matches are never allowed
 * - Partial matches (clue contains board word or vice versa) are blocked
 *   unless the contained word is 1 character (common articles like "A", "I")
 *
 * Uses locale-safe functions to avoid Turkish/Azerbaijani locale issues
 * and Unicode normalization for consistent comparison across different
 * Unicode representations (e.g., 'é' vs 'e' + combining accent)
 *
 * HARDENING FIX: Use NFKC normalization instead of NFC to handle
 * compatibility characters. NFC only handles canonical equivalence
 * (é composed vs decomposed), while NFKC also handles compatibility
 * equivalence (ﬁ ligature → fi, ² → 2, etc.). This prevents bypassing
 * clue validation using visually similar but technically different characters.
 */
export function validateClueWord(clueWord: string, boardWords: string[]): ClueValidationResult {
    // Normalize and convert to uppercase using English locale
    // NFKC provides the strongest normalization for security-sensitive comparisons
    const normalizedClue = toEnglishUpperCase(String(clueWord).normalize('NFKC').trim());

    // Minimum clue length check
    if (normalizedClue.length === 0) {
        return { valid: false, reason: 'Clue cannot be empty' };
    }

    for (const boardWord of boardWords) {
        // Normalize and convert to uppercase using English locale (NFKC for consistency)
        const normalizedBoardWord = toEnglishUpperCase(String(boardWord).normalize('NFKC').trim());

        // Check exact match - always invalid
        if (normalizedClue === normalizedBoardWord) {
            return { valid: false, reason: `"${clueWord}" is a word on the board` };
        }

        // Check if clue contains board word (e.g., clue "SNOWMAN" contains board word "SNOW")
        // Uses locale-safe includes check
        if (localeIncludes(normalizedClue, normalizedBoardWord, false)) {
            // Only allow if the board word is a single character (rare edge case)
            if (normalizedBoardWord.length > 1) {
                return { valid: false, reason: `"${clueWord}" contains board word "${boardWord}"` };
            }
        }

        // Check if board word contains clue (e.g., board word "SNOWMAN" contains clue "SNOW")
        // Uses locale-safe includes check
        if (localeIncludes(normalizedBoardWord, normalizedClue, false)) {
            // Only allow if the clue is a single character (rare edge case)
            if (normalizedClue.length > 1) {
                return { valid: false, reason: `Board word "${boardWord}" contains "${clueWord}"` };
            }
        }
    }

    return { valid: true };
}

/**
 * Optimized clue giving using Lua script
 * Performs atomic clue validation and state update
 */
export async function giveClueOptimized(
    roomCode: string,
    team: Team,
    word: string,
    number: number,
    spymasterNickname: string
): Promise<ClueWithGuesses> {
    const redis: RedisClient = getRedis();
    const gameKey = `room:${roomCode}:game`;

    // Pre-normalize clue word in JS for Unicode-correct comparison
    // Lua's string.upper() is ASCII-only and won't handle Unicode properly
    // HARDENING FIX: Use NFKC for consistency with validateClueWord
    const normalizedWord = toEnglishUpperCase(String(word).normalize('NFKC').trim());

    try {
        // Wrap Redis Lua eval with timeout to prevent hanging operations
        const resultStr = await withTimeout(
            redis.eval(
                OPTIMIZED_GIVE_CLUE_SCRIPT,
                {
                    keys: [gameKey],
                    arguments: [
                        team,
                        normalizedWord,
                        number.toString(),
                        spymasterNickname || 'Unknown',
                        Date.now().toString(),
                        MAX_HISTORY_ENTRIES.toString(),
                        BOARD_SIZE.toString(),
                        MAX_CLUES.toString()
                    ]
                }
            ),
            TIMEOUTS.REDIS_OPERATION,
            `giveClue-lua-${roomCode}`
        ) as string | null;

        // BUG FIX: Validate Lua script result before accessing properties
        if (!resultStr || typeof resultStr !== 'string') {
            throw new ServerError('Invalid Lua script result: empty or non-string');
        }

        let result: ClueWithGuesses & { error?: string; word?: string };
        try {
            result = parseJSON(resultStr, luaResultObjectSchema, `giveClue Lua result for ${roomCode}`) as ClueWithGuesses & { error?: string; word?: string };
        } catch (parseError) {
            logger.error('Failed to parse Lua giveClue script result', { roomCode, error: (parseError as Error).message });
            throw new ServerError('Failed to parse game operation result');
        }

        if (result.error) {
            const errorMap: Record<string, Error> = {
                'NO_GAME': GameStateError.noActiveGame(),
                'GAME_OVER': GameStateError.gameOver(),
                'NOT_YOUR_TURN': PlayerError.notYourTurn(team),
                'CLUE_ALREADY_GIVEN': ValidationError.clueAlreadyGiven(),
                'INVALID_NUMBER': new ValidationError(`Clue number must be 0-${BOARD_SIZE}`),
                'WORD_ON_BOARD': ValidationError.invalidClue(`"${word}" is a word on the board`),
                'CONTAINS_BOARD_WORD': ValidationError.invalidClue(`"${word}" contains board word "${result.word}"`),
                'BOARD_CONTAINS_CLUE': ValidationError.invalidClue(`Board word "${result.word}" contains "${word}"`)
            };
            throw errorMap[result.error] || new ServerError(result.error);
        }

        logger.debug(`Optimized giveClue completed for room ${roomCode}`);
        return result;
    } catch (error) {
        if ((error as { code?: string }).code) {
            throw error;
        }
        logger.error('Optimized giveClue failed', { roomCode, error: (error as Error).message });
        throw error;
    }
}

/**
 * Give a clue with validation
 * Uses optimized Lua script with fallback to standard implementation
 */
export async function giveClue(
    roomCode: string,
    team: Team,
    word: string,
    number: number,
    spymasterNickname: string
): Promise<ClueWithGuesses> {
    const redis: RedisClient = getRedis();
    const gameKey = `room:${roomCode}:game`;

    // Validate team is provided
    if (!team || (team !== 'red' && team !== 'blue')) {
        throw ValidationError.invalidTeam();
    }

    // BUG-3 FIX: Validate clue number is within valid range (0-25)
    if (typeof number !== 'number' || !Number.isInteger(number) || number < 0 || number > BOARD_SIZE) {
        throw new ValidationError(`Clue number must be 0-${BOARD_SIZE}`);
    }

    // Check if Duet mode - skip Lua for Duet games
    const preCheckData = await redis.get(gameKey);
    const isDuetGame = preCheckData ? tryParseJSON(preCheckData, gameModePreCheckSchema, `duet pre-check for ${roomCode}`)?.gameMode === 'duet' : false;

    if (!isDuetGame) {
        // Try optimized Lua script first (classic/blitz only)
        try {
            return await giveClueOptimized(roomCode, team, word, number, spymasterNickname);
        } catch (luaError) {
            // Propagate game logic errors
            if ((luaError as { code?: string }).code && (luaError as { code?: string }).code !== ERROR_CODES.SERVER_ERROR) {
                throw luaError;
            }
            logger.warn(`Lua giveClue failed, falling back to standard for room ${roomCode}: ${(luaError as Error).message}`);
        }
    }

    // Fallback / Duet mode implementation
    const maxRetries = 3;
    let retries = 0;

    while (retries < maxRetries) {
        try {
            // Use optimistic locking
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

            // Check if a clue was already given this turn
            if (game.currentClue) {
                await redis.unwatch();
                throw ValidationError.clueAlreadyGiven();
            }

            // Note: Number validation already done at function entry

            // Validate clue word is not on the board
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
            // 0 means unlimited guesses, otherwise number + 1
            game.guessesAllowed = number === 0 ? 0 : number + 1;
            game.guessesUsed = 0;

            if (!game.clues) game.clues = [];
            game.clues.push(clue);

            // Performance fix: Cap clues array to prevent unbounded memory growth
            // Unlike history which uses lazy capping, clues are capped eagerly
            // since they're smaller and less frequently added
            if (game.clues.length > MAX_CLUES) {
                game.clues = game.clues.slice(-MAX_CLUES);
            }

            // Add to history with cap
            addToHistory(game, {
                action: 'clue',
                team,
                word: clue.word,
                number,
                guessesAllowed: game.guessesAllowed,
                spymaster: spymasterNickname,
                timestamp: Date.now()
            });

            // Increment state version for conflict detection
            incrementVersion(game);

            // Preserve TTL so the key doesn't become permanent
            const currentTTL = await redis.ttl(gameKey);
            const ttl = currentTTL > 0 ? currentTTL : REDIS_TTL.ROOM;

            const result = await redis.multi()
                .set(gameKey, JSON.stringify(game), { EX: ttl })
                .exec();

            // If transaction failed (key was modified), retry
            if (result === null) {
                await redis.unwatch();
                retries++;
                continue;
            }

            return {
                ...clue,
                guessesAllowed: game.guessesAllowed
            };

        } catch (error) {
            await redis.unwatch();
            throw error;
        }
    }

    throw ServerError.concurrentModification();
}

/**
 * Optimized end turn using Lua script
 * Atomically switches turn and resets clue state
 */
export async function endTurnOptimized(
    roomCode: string,
    playerNickname: string = 'Unknown',
    expectedTeam: string = ''
): Promise<EndTurnResult> {
    const redis: RedisClient = getRedis();
    const gameKey = `room:${roomCode}:game`;

    try {
        // BUG FIX: Wrap Redis Lua eval with timeout to prevent hanging operations
        // Consistent with revealCardOptimized and giveClueOptimized
        const resultStr = await withTimeout(
            redis.eval(
                OPTIMIZED_END_TURN_SCRIPT,
                {
                    keys: [gameKey],
                    arguments: [
                        playerNickname,
                        Date.now().toString(),
                        MAX_HISTORY_ENTRIES.toString(),
                        expectedTeam
                    ]
                }
            ),
            TIMEOUTS.REDIS_OPERATION,
            `endTurn-lua-${roomCode}`
        ) as string | null;

        // BUG FIX: Validate Lua script result before accessing properties
        if (!resultStr || typeof resultStr !== 'string') {
            throw new ServerError('Invalid Lua script result: empty or non-string');
        }

        let result: EndTurnResult & { error?: string };
        try {
            result = parseJSON(resultStr, luaResultObjectSchema, `endTurn Lua result for ${roomCode}`) as EndTurnResult & { error?: string };
        } catch (parseError) {
            logger.error('Failed to parse Lua endTurn script result', { roomCode, error: (parseError as Error).message });
            throw new ServerError('Failed to parse game operation result');
        }

        if (result.error) {
            const errorMap: Record<string, Error> = {
                'NO_GAME': GameStateError.noActiveGame(),
                'GAME_OVER': GameStateError.gameOver(),
                'NOT_YOUR_TURN': PlayerError.notYourTurn(expectedTeam as Team)
            };
            throw errorMap[result.error] || new ServerError(result.error);
        }

        logger.debug(`Optimized endTurn completed for room ${roomCode}`);
        return result;
    } catch (error) {
        if ((error as { code?: string }).code) {
            throw error;
        }
        logger.error('Optimized endTurn failed', { roomCode, error: (error as Error).message });
        throw error;
    }
}

/**
 * End the current turn
 * Uses optimized Lua script with fallback to standard implementation
 */
export async function endTurn(
    roomCode: string,
    playerNickname: string = 'Unknown',
    expectedTeam: string = ''
): Promise<EndTurnResult> {
    // Check if Duet mode - skip Lua for Duet games
    const redis: RedisClient = getRedis();
    const gameKey = `room:${roomCode}:game`;
    const preCheckData = await redis.get(gameKey);
    const isDuetGame = preCheckData ? tryParseJSON(preCheckData, gameModePreCheckSchema, `duet pre-check for ${roomCode}`)?.gameMode === 'duet' : false;

    if (!isDuetGame) {
        // Try optimized Lua script first (classic/blitz only)
        try {
            return await endTurnOptimized(roomCode, playerNickname, expectedTeam);
        } catch (luaError) {
            // Propagate game logic errors
            if ((luaError as { code?: string }).code && (luaError as { code?: string }).code !== ERROR_CODES.SERVER_ERROR) {
                throw luaError;
            }
            logger.warn(`Lua endTurn failed, falling back to standard for room ${roomCode}: ${(luaError as Error).message}`);
        }
    }

    // Fallback / Duet mode implementation

    return executeGameTransaction(gameKey, (game) => {
        if (game.gameOver) {
            throw GameStateError.gameOver();
        }

        // Validate expected team inside transaction to prevent race condition
        if (expectedTeam && game.currentTurn !== expectedTeam) {
            throw PlayerError.notYourTurn(expectedTeam as Team);
        }

        const previousTurn = game.currentTurn;
        game.currentTurn = game.currentTurn === 'red' ? 'blue' : 'red';
        game.currentClue = null;
        game.guessesUsed = 0;
        game.guessesAllowed = 0;

        // Add to history with cap
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

/**
 * Forfeit the game
 * Uses optimistic locking with retries for consistency
 */
export function forfeitGame(roomCode: string, forfeitTeam?: Team): Promise<ForfeitResult> {
    const gameKey = `room:${roomCode}:game`;

    return executeGameTransaction(gameKey, (game) => {
        if (game.gameOver) {
            throw GameStateError.gameOver();
        }

        const forfeitingTeam: Team = (forfeitTeam === 'red' || forfeitTeam === 'blue') ? forfeitTeam : game.currentTurn;
        game.gameOver = true;

        if (game.gameMode === 'duet') {
            // Duet: cooperative forfeit = no winner
            game.winner = null;
        } else {
            // Classic/Blitz: opposing team wins
            game.winner = forfeitingTeam === 'red' ? 'blue' : 'red';
        }

        // Add to history with cap
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
    if (!game) {
        return [];
    }
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

// Export pure functions for testing
module.exports = {
    // Main functions
    createGame,
    getGame,
    getGameStateForPlayer,
    revealCard,
    revealCardOptimized,
    giveClue,
    giveClueOptimized,
    endTurn,
    endTurnOptimized,
    forfeitGame,
    getGameHistory,
    cleanupGame,

    // Pure functions for unit testing
    seededRandom,
    hashString,
    shuffleWithSeed,
    generateSeed,
    validateClueWord,
    generateDuetBoard,

    // Decomposed reveal functions for unit testing
    validateCardIndex,
    validateRevealPreconditions,
    executeCardReveal,
    determineRevealOutcome,
    switchTurn,
    buildRevealResult
};
