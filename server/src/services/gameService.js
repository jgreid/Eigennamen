/**
 * Game Service - Core game logic
 */

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
    GAME_INTERNALS
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

// Use centralized constants
const MAX_HISTORY_ENTRIES = GAME_HISTORY.MAX_ENTRIES;
const MAX_CLUES = GAME_HISTORY.MAX_CLUES;
const MAX_TRANSACTION_RETRIES = RETRY_CONFIG.OPTIMISTIC_LOCK.maxRetries;

/**
 * Execute a Redis transaction with optimistic locking and retries
 * Reduces code duplication across game state operations
 * @param {string} gameKey - Redis key for the game
 * @param {Function} operation - Async function(game) that modifies game and returns result
 * @param {string} operationName - Name for logging
 * @returns {Promise<any>} Result from operation function
 */
async function executeGameTransaction(gameKey, operation, _operationName) {
    const redis = getRedis();
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
const OPTIMIZED_REVEAL_SCRIPT = fs.readFileSync(path.join(__dirname, '../scripts/revealCard.lua'), 'utf8');

/**
 * Lua script for optimized clue giving
 * Performs atomic clue validation and state update in Redis
 */
const OPTIMIZED_GIVE_CLUE_SCRIPT = fs.readFileSync(path.join(__dirname, '../scripts/giveClue.lua'), 'utf8');

/**
 * Lua script for optimized end turn
 * Atomically switches turn and resets clue state
 */
const OPTIMIZED_END_TURN_SCRIPT = fs.readFileSync(path.join(__dirname, '../scripts/endTurn.lua'), 'utf8');

/**
 * Seeded random number generator using Mulberry32 algorithm
 * Provides better distribution than Math.sin-based approach
 * Must stay in sync with client-side implementation in index.html
 */
function seededRandom(seed) {
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
function hashString(str) {
    let hash = 0;
    // Use spread operator to properly iterate over Unicode code points
    // This handles surrogate pairs (emoji, etc.) correctly
    for (const char of str) {
        const codePoint = char.codePointAt(0);
        hash = ((hash << 5) - hash) + codePoint;
        hash = hash & hash;
    }
    return Math.abs(hash);
}

/**
 * Shuffle array with seed
 */
function shuffleWithSeed(array, seed) {
    const shuffled = [...array];
    let currentSeed = seed;
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(seededRandom(currentSeed++) * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

/**
 * Generate a random game seed using crypto for better randomness
 * Uses hoisted crypto module for performance (avoids require() per call)
 */
function generateSeed() {
    try {
        return crypto.randomBytes(6).toString('hex');
    } catch {
        // Fallback to Math.random if crypto is unavailable
        return Math.random().toString(36).substring(2, 10) +
               Math.random().toString(36).substring(2, 6);
    }
}

/**
 * Create a new game for a room
 * @param {string} roomCode - Room code
 * @param {Object} options - Game options
 * @param {string} options.wordListId - UUID of database word list (requires database)
 * @param {Array<string>} options.wordList - Custom words array (works without database)
 */
async function createGame(roomCode, options = {}) {
    const redis = getRedis();

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

        const { wordListId, wordList } = options;

        // Get words - priority: direct wordList > wordListId > default
        let words = DEFAULT_WORDS;
        let usedWordListId = null;

        // Option 1: Direct word list passed from client (no database needed)
        if (wordList && Array.isArray(wordList) && wordList.length >= BOARD_SIZE) {
            // Clean and deduplicate words
            const cleanedWords = [...new Set(
                wordList
                    .map(w => toEnglishUpperCase(String(w).trim()))
                    .filter(w => w.length > 0)
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
        const firstTeam = seededRandom(numericSeed + GAME_INTERNALS.FIRST_TEAM_SEED_OFFSET) > 0.5 ? 'red' : 'blue';

        // Create card types
        let types = [];
        let redTotal, blueTotal;

        if (firstTeam === 'red') {
            types = [
                ...Array(FIRST_TEAM_CARDS).fill('red'),
                ...Array(SECOND_TEAM_CARDS).fill('blue')
            ];
            redTotal = FIRST_TEAM_CARDS;
            blueTotal = SECOND_TEAM_CARDS;
        } else {
            types = [
                ...Array(SECOND_TEAM_CARDS).fill('red'),
                ...Array(FIRST_TEAM_CARDS).fill('blue')
            ];
            redTotal = SECOND_TEAM_CARDS;
            blueTotal = FIRST_TEAM_CARDS;
        }
        types = [...types, ...Array(NEUTRAL_CARDS).fill('neutral'), 'assassin'];
        types = shuffleWithSeed(types, numericSeed + GAME_INTERNALS.TYPES_SHUFFLE_SEED_OFFSET);

        const game = {
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
            guessesUsed: 0,        // Track guesses used this turn
            guessesAllowed: 0,     // Max guesses allowed (clue number + 1)
            clues: [],
            history: [],
            stateVersion: 1,       // State versioning for conflict detection
            createdAt: Date.now()
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
                logger.error(`Failed to parse room data for ${roomCode}:`, e.message);
            }
        }

        // Refresh related keys TTL
        await redis.expire(`room:${roomCode}:players`, REDIS_TTL.ROOM);

        logger.info(`Game created for room ${roomCode} with seed ${seed}`);
        return game;
    } finally {
        // Always release the creation lock (owner-verified to avoid releasing another instance's lock)
        await redis.eval(RELEASE_LOCK_SCRIPT, { keys: [lockKey], arguments: [lockValue] }).catch(err => {
            logger.error(`Failed to release creation lock for room ${roomCode}:`, err.message);
        });
    }
}

/**
 * Get game state for a specific player (hides card types for non-spymasters)
 * @param {Object} game - Game state object
 * @param {Object} player - Player object (can be null for spectator-like view)
 * @returns {Object} Game state tailored for the player's role
 */
function getGameStateForPlayer(game, player) {
    // BUG FIX: Validate game parameter to prevent null pointer errors
    if (!game) {
        logger.warn('getGameStateForPlayer called with null/undefined game');
        return null;
    }

    const state = {
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
        history: game.history || []
    };

    // SECURITY: Only spymasters see unrevealed card types
    // BUG FIX: Handle null/undefined player parameter gracefully
    const isSpymaster = player && player.role === 'spymaster';
    if (isSpymaster || game.gameOver) {
        state.types = game.types;
    } else {
        // Non-spymasters (or null player) only see types of revealed cards
        state.types = game.types.map((type, i) =>
            game.revealed[i] ? type : null
        );
    }

    return state;
}

/**
 * Get current game for a room
 */
async function getGame(roomCode) {
    const redis = getRedis();
    const gameData = await redis.get(`room:${roomCode}:game`);
    if (!gameData) return null;

    try {
        return JSON.parse(gameData);
    } catch (error) {
        logger.error(`Corrupted game data for room ${roomCode}:`, error.message);
        // Delete corrupted data to allow recovery
        await redis.del(`room:${roomCode}:game`);
        return null;
    }
}

/**
 * Safely parse game data with error handling
 * @returns {Object|null} Parsed game object or null if corrupted
 */
function safeParseGameData(gameData, roomCode) {
    try {
        return JSON.parse(gameData);
    } catch (error) {
        logger.error(`Corrupted game data for room ${roomCode}:`, error.message);
        return null;
    }
}

/**
 * Add entry to game history with cap to prevent unbounded growth
 */
function addToHistory(game, entry) {
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
 * @param {Object} game - Game state
 * @returns {number} New version number
 */
function incrementVersion(game) {
    game.stateVersion = (game.stateVersion || 0) + 1;
    return game.stateVersion;
}

/**
 * Validate card index bounds
 * @param {number} index - Card index to validate
 * @throws {Object} Error if index is invalid
 */
function validateCardIndex(index) {
    if (typeof index !== 'number' || !Number.isFinite(index) ||
        index < 0 || index >= BOARD_SIZE || !Number.isInteger(index)) {
        throw ValidationError.invalidCardIndex(index, BOARD_SIZE);
    }
}

/**
 * Validate game state preconditions for revealing a card
 * @param {Object} game - Game state
 * @param {number} index - Card index
 * @throws {Object} Error if preconditions not met
 */
function validateRevealPreconditions(game, index) {
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
 * @param {Object} game - Game state
 * @param {number} index - Card index
 * @returns {string} - The type of card revealed
 */
function executeCardReveal(game, index) {
    game.revealed[index] = true;
    const type = game.types[index];

    if (type === 'red') {
        game.redScore++;
    } else if (type === 'blue') {
        game.blueScore++;
    }

    game.guessesUsed = (game.guessesUsed || 0) + 1;

    return type;
}

/**
 * Determine the outcome of revealing a card
 * @param {Object} game - Game state
 * @param {string} cardType - Type of card revealed
 * @param {string} revealingTeam - Team that revealed the card
 * @returns {Object} - Outcome with turnEnded, endReason, and any state changes
 */
function determineRevealOutcome(game, cardType, revealingTeam) {
    const outcome = { turnEnded: false, endReason: null };

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
 * Switch turn to the other team and reset clue state
 * @param {Object} game - Game state to modify
 */
function switchTurn(game) {
    game.currentTurn = game.currentTurn === 'red' ? 'blue' : 'red';
    game.currentClue = null;
    game.guessesUsed = 0;
    game.guessesAllowed = 0;
}

/**
 * Build the reveal result object
 * @param {Object} game - Game state
 * @param {number} index - Card index
 * @param {string} type - Card type
 * @param {Object} outcome - Reveal outcome
 * @returns {Object} - Result to return to caller
 */
function buildRevealResult(game, index, type, outcome) {
    // Bounds check for index to prevent undefined access
    const word = (game.words && index >= 0 && index < game.words.length)
        ? game.words[index]
        : 'UNKNOWN';

    return {
        index,
        type,
        word,
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
}

/**
 * ISSUE #36 FIX: Optimized card reveal using Lua script
 * Performs the entire reveal operation atomically in Redis, avoiding
 * the overhead of multiple round-trips and full JSON re-serialization in Node.js
 * Bug #4 & #9 fix: Now takes playerTeam for turn validation in Lua
 */
async function revealCardOptimized(roomCode, index, playerNickname = 'Unknown', playerTeam = '') {
    const redis = getRedis();
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
        );

        // BUG FIX: Validate Lua script result before accessing properties
        if (!resultStr || typeof resultStr !== 'string') {
            throw new ServerError('Invalid Lua script result: empty or non-string');
        }

        let result;
        try {
            result = JSON.parse(resultStr);
        } catch (parseError) {
            logger.error('Failed to parse Lua reveal script result', { roomCode, error: parseError.message });
            throw new ServerError('Failed to parse game operation result');
        }

        // Validate result structure
        if (!result || typeof result !== 'object') {
            throw new ServerError('Invalid Lua script result: not an object');
        }

        // Handle errors returned by the Lua script
        if (result.error) {
            const errorMap = {
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
        if (error.code) {
            throw error;
        }
        // Otherwise, log and rethrow
        logger.error('Optimized reveal failed', { roomCode, error: error.message });
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
async function revealCard(roomCode, index, playerNickname = 'Unknown', playerTeam = '') {
    const redis = getRedis();
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
        // ISSUE #36 FIX: Try optimized Lua script first
        try {
            return await revealCardOptimized(roomCode, index, playerNickname, playerTeam);
        } catch (luaError) {
            // If Lua script fails due to script-specific issues, fall back to original
            // But propagate game logic errors (like GAME_OVER, CARD_ALREADY_REVEALED)
            if (luaError.code && luaError.code !== ERROR_CODES.SERVER_ERROR) {
                throw luaError;
            }
            logger.warn(`Lua reveal failed, falling back to standard reveal for room ${roomCode}: ${luaError.message}`);
        }

        // Fallback to original implementation
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
                addToHistory(game, {
                    action: 'reveal',
                    index,
                    word: game.words[index],
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
        await redis.eval(RELEASE_LOCK_SCRIPT, { keys: [lockKey], arguments: [lockValue] }).catch(err => {
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
function validateClueWord(clueWord, boardWords) {
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
async function giveClueOptimized(roomCode, team, word, number, spymasterNickname) {
    const redis = getRedis();
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
        );

        // BUG FIX: Validate Lua script result before accessing properties
        if (!resultStr || typeof resultStr !== 'string') {
            throw new ServerError('Invalid Lua script result: empty or non-string');
        }

        let result;
        try {
            result = JSON.parse(resultStr);
        } catch (parseError) {
            logger.error('Failed to parse Lua giveClue script result', { roomCode, error: parseError.message });
            throw new ServerError('Failed to parse game operation result');
        }

        if (!result || typeof result !== 'object') {
            throw new ServerError('Invalid Lua script result: not an object');
        }

        if (result.error) {
            const errorMap = {
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
        if (error.code) {
            throw error;
        }
        logger.error('Optimized giveClue failed', { roomCode, error: error.message });
        throw error;
    }
}

/**
 * Give a clue with validation
 * Uses optimized Lua script with fallback to standard implementation
 */
async function giveClue(roomCode, team, word, number, spymasterNickname) {
    const redis = getRedis();
    const gameKey = `room:${roomCode}:game`;

    // Validate team is provided
    if (!team || (team !== 'red' && team !== 'blue')) {
        throw ValidationError.invalidTeam();
    }

    // BUG-3 FIX: Validate clue number is within valid range (0-25)
    if (typeof number !== 'number' || !Number.isInteger(number) || number < 0 || number > BOARD_SIZE) {
        throw new ValidationError(`Clue number must be 0-${BOARD_SIZE}`);
    }

    // Try optimized Lua script first
    try {
        return await giveClueOptimized(roomCode, team, word, number, spymasterNickname);
    } catch (luaError) {
        // Propagate game logic errors
        if (luaError.code && luaError.code !== ERROR_CODES.SERVER_ERROR) {
            throw luaError;
        }
        logger.warn(`Lua giveClue failed, falling back to standard for room ${roomCode}: ${luaError.message}`);
    }

    // Fallback to original implementation
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

            // Note: Number validation already done at function entry (line 1147-1150)

            // Validate clue word is not on the board
            const validation = validateClueWord(word, game.words);
            if (!validation.valid) {
                await redis.unwatch();
                throw ValidationError.invalidClue(validation.reason);
            }

            const clue = {
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
async function endTurnOptimized(roomCode, playerNickname = 'Unknown', expectedTeam = '') {
    const redis = getRedis();
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
        );

        // BUG FIX: Validate Lua script result before accessing properties
        if (!resultStr || typeof resultStr !== 'string') {
            throw new ServerError('Invalid Lua script result: empty or non-string');
        }

        let result;
        try {
            result = JSON.parse(resultStr);
        } catch (parseError) {
            logger.error('Failed to parse Lua endTurn script result', { roomCode, error: parseError.message });
            throw new ServerError('Failed to parse game operation result');
        }

        if (!result || typeof result !== 'object') {
            throw new ServerError('Invalid Lua script result: not an object');
        }

        if (result.error) {
            const errorMap = {
                'NO_GAME': GameStateError.noActiveGame(),
                'GAME_OVER': GameStateError.gameOver(),
                'NOT_YOUR_TURN': PlayerError.notYourTurn(expectedTeam)
            };
            throw errorMap[result.error] || new ServerError(result.error);
        }

        logger.debug(`Optimized endTurn completed for room ${roomCode}`);
        return result;
    } catch (error) {
        if (error.code) {
            throw error;
        }
        logger.error('Optimized endTurn failed', { roomCode, error: error.message });
        throw error;
    }
}

/**
 * End the current turn
 * Uses optimized Lua script with fallback to standard implementation
 */
async function endTurn(roomCode, playerNickname = 'Unknown', expectedTeam = '') {
    // Try optimized Lua script first
    try {
        return await endTurnOptimized(roomCode, playerNickname, expectedTeam);
    } catch (luaError) {
        // Propagate game logic errors
        if (luaError.code && luaError.code !== ERROR_CODES.SERVER_ERROR) {
            throw luaError;
        }
        logger.warn(`Lua endTurn failed, falling back to standard for room ${roomCode}: ${luaError.message}`);
    }

    // Fallback to original implementation
    const gameKey = `room:${roomCode}:game`;

    return executeGameTransaction(gameKey, (game) => {
        if (game.gameOver) {
            throw GameStateError.gameOver();
        }

        // Validate expected team inside transaction to prevent race condition
        if (expectedTeam && game.currentTurn !== expectedTeam) {
            throw PlayerError.notYourTurn(expectedTeam);
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
 * @param {string} roomCode - Room code
 * @param {string} [forfeitTeam] - Team to forfeit (defaults to current turn's team)
 * Uses optimistic locking with retries for consistency
 */
function forfeitGame(roomCode, forfeitTeam) {
    const gameKey = `room:${roomCode}:game`;

    return executeGameTransaction(gameKey, (game) => {
        if (game.gameOver) {
            throw GameStateError.gameOver();
        }

        // Use explicit team if provided, otherwise default to current turn's team
        const forfeitingTeam = (forfeitTeam === 'red' || forfeitTeam === 'blue') ? forfeitTeam : game.currentTurn;
        game.gameOver = true;
        game.winner = forfeitingTeam === 'red' ? 'blue' : 'red';

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
async function getGameHistory(roomCode) {
    const game = await getGame(roomCode);
    if (!game) {
        return [];
    }
    return game.history || [];
}

/**
 * Clean up game data for a room
 */
async function cleanupGame(roomCode) {
    const redis = getRedis();
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

    // Decomposed reveal functions for unit testing
    validateCardIndex,
    validateRevealPreconditions,
    executeCardReveal,
    determineRevealOutcome,
    switchTurn,
    buildRevealResult
};
