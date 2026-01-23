/**
 * Game Service - Core game logic
 */

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
    GAME_HISTORY
} = require('../config/constants');
const {
    GameStateError,
    ValidationError,
    PlayerError,
    ServerError
} = require('../errors/GameError');

// Use centralized constant
const MAX_HISTORY_ENTRIES = GAME_HISTORY.MAX_ENTRIES;
const MAX_TRANSACTION_RETRIES = 3;

/**
 * Execute a Redis transaction with optimistic locking and retries
 * Reduces code duplication across game state operations
 * @param {string} gameKey - Redis key for the game
 * @param {Function} operation - Async function(game) that modifies game and returns result
 * @param {string} operationName - Name for logging
 * @returns {Promise<any>} Result from operation function
 */
async function executeGameTransaction(gameKey, operation, operationName) {
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

            // Execute transaction
            const txResult = await redis.multi()
                .set(gameKey, JSON.stringify(game))
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
const OPTIMIZED_REVEAL_SCRIPT = `
local gameKey = KEYS[1]
local index = tonumber(ARGV[1])
local timestamp = tonumber(ARGV[2])
local playerNickname = ARGV[3]
local maxHistoryEntries = tonumber(ARGV[4])

local gameData = redis.call('GET', gameKey)
if not gameData then
    return cjson.encode({error = 'NO_GAME'})
end

local game = cjson.decode(gameData)

-- Validate preconditions
if game.gameOver then
    return cjson.encode({error = 'GAME_OVER'})
end
if not game.currentClue then
    return cjson.encode({error = 'NO_CLUE'})
end
if game.guessesAllowed > 0 and game.guessesUsed >= game.guessesAllowed then
    return cjson.encode({error = 'NO_GUESSES'})
end
-- Lua arrays are 1-indexed, so add 1 to the index
local luaIndex = index + 1
if game.revealed[luaIndex] then
    return cjson.encode({error = 'ALREADY_REVEALED'})
end

-- Store previous state
local previousTurn = game.currentTurn
local cardType = game.types[luaIndex]

-- Execute reveal
game.revealed[luaIndex] = true
if cardType == 'red' then
    game.redScore = game.redScore + 1
elseif cardType == 'blue' then
    game.blueScore = game.blueScore + 1
end
game.guessesUsed = (game.guessesUsed or 0) + 1

-- Determine outcome
local turnEnded = false
local endReason = cjson.null

-- Check assassin
if cardType == 'assassin' then
    game.gameOver = true
    if previousTurn == 'red' then
        game.winner = 'blue'
    else
        game.winner = 'red'
    end
    endReason = 'assassin'
    turnEnded = true
-- Check win conditions
elseif game.redScore >= game.redTotal then
    game.gameOver = true
    game.winner = 'red'
    endReason = 'completed'
    turnEnded = true
elseif game.blueScore >= game.blueTotal then
    game.gameOver = true
    game.winner = 'blue'
    endReason = 'completed'
    turnEnded = true
-- Wrong guess
elseif cardType ~= previousTurn then
    if previousTurn == 'red' then
        game.currentTurn = 'blue'
    else
        game.currentTurn = 'red'
    end
    game.currentClue = cjson.null
    game.guessesUsed = 0
    game.guessesAllowed = 0
    turnEnded = true
-- Max guesses reached
elseif game.guessesAllowed > 0 and game.guessesUsed >= game.guessesAllowed then
    if previousTurn == 'red' then
        game.currentTurn = 'blue'
    else
        game.currentTurn = 'red'
    end
    game.currentClue = cjson.null
    game.guessesUsed = 0
    game.guessesAllowed = 0
    turnEnded = true
    endReason = 'maxGuesses'
end

-- Add to history (with cap)
if not game.history then
    game.history = {}
end
table.insert(game.history, {
    action = 'reveal',
    index = index,
    word = game.words[luaIndex],
    type = cardType,
    team = previousTurn,
    player = playerNickname,
    guessNumber = game.guessesUsed,
    timestamp = timestamp
})
-- Cap history
if #game.history > maxHistoryEntries then
    local newHistory = {}
    for i = #game.history - maxHistoryEntries + 1, #game.history do
        table.insert(newHistory, game.history[i])
    end
    game.history = newHistory
end

-- Increment version
game.stateVersion = (game.stateVersion or 0) + 1

-- Save updated game
redis.call('SET', gameKey, cjson.encode(game))

-- Return result
local result = {
    success = true,
    index = index,
    type = cardType,
    word = game.words[luaIndex],
    redScore = game.redScore,
    blueScore = game.blueScore,
    currentTurn = game.currentTurn,
    guessesUsed = game.guessesUsed,
    guessesAllowed = game.guessesAllowed,
    turnEnded = turnEnded,
    gameOver = game.gameOver,
    winner = game.winner,
    endReason = endReason
}

if game.gameOver then
    result.allTypes = game.types
end

return cjson.encode(result)
`;

/**
 * Lua script for optimized clue giving
 * Performs atomic clue validation and state update in Redis
 */
const OPTIMIZED_GIVE_CLUE_SCRIPT = `
local gameKey = KEYS[1]
local team = ARGV[1]
local clueWord = ARGV[2]
local clueNumber = tonumber(ARGV[3])
local spymasterNickname = ARGV[4]
local timestamp = tonumber(ARGV[5])
local maxHistoryEntries = tonumber(ARGV[6])
local boardSize = tonumber(ARGV[7])

local gameData = redis.call('GET', gameKey)
if not gameData then
    return cjson.encode({error = 'NO_GAME'})
end

local game = cjson.decode(gameData)

-- Validate preconditions
if game.gameOver then
    return cjson.encode({error = 'GAME_OVER'})
end
if game.currentTurn ~= team then
    return cjson.encode({error = 'NOT_YOUR_TURN'})
end
if game.currentClue then
    return cjson.encode({error = 'CLUE_ALREADY_GIVEN'})
end

-- Validate clue number
if clueNumber < 0 or clueNumber > boardSize then
    return cjson.encode({error = 'INVALID_NUMBER'})
end

-- Validate clue word is not on the board (case-insensitive)
local normalizedClue = string.upper(clueWord)
for i, word in ipairs(game.words) do
    local normalizedWord = string.upper(word)
    -- Exact match
    if normalizedClue == normalizedWord then
        return cjson.encode({error = 'WORD_ON_BOARD', word = word})
    end
    -- Clue contains board word
    if string.len(normalizedWord) > 1 and string.find(normalizedClue, normalizedWord, 1, true) then
        return cjson.encode({error = 'CONTAINS_BOARD_WORD', word = word})
    end
    -- Board word contains clue
    if string.len(normalizedClue) > 1 and string.find(normalizedWord, normalizedClue, 1, true) then
        return cjson.encode({error = 'BOARD_CONTAINS_CLUE', word = word})
    end
end

-- Create and set clue
local clue = {
    team = team,
    word = string.upper(clueWord),
    number = clueNumber,
    spymaster = spymasterNickname,
    timestamp = timestamp
}

game.currentClue = clue
-- 0 means unlimited guesses, otherwise number + 1
game.guessesAllowed = clueNumber == 0 and 0 or clueNumber + 1
game.guessesUsed = 0

if not game.clues then
    game.clues = {}
end
table.insert(game.clues, clue)

-- Add to history
if not game.history then
    game.history = {}
end
table.insert(game.history, {
    action = 'clue',
    team = team,
    word = clue.word,
    number = clueNumber,
    guessesAllowed = game.guessesAllowed,
    spymaster = spymasterNickname,
    timestamp = timestamp
})

-- Cap history
if #game.history > maxHistoryEntries then
    local newHistory = {}
    for i = #game.history - maxHistoryEntries + 1, #game.history do
        table.insert(newHistory, game.history[i])
    end
    game.history = newHistory
end

-- Increment version
game.stateVersion = (game.stateVersion or 0) + 1

-- Save game
redis.call('SET', gameKey, cjson.encode(game))

return cjson.encode({
    success = true,
    team = team,
    word = clue.word,
    number = clueNumber,
    spymaster = spymasterNickname,
    guessesAllowed = game.guessesAllowed,
    timestamp = timestamp
})
`;

/**
 * Lua script for optimized end turn
 * Atomically switches turn and resets clue state
 */
const OPTIMIZED_END_TURN_SCRIPT = `
local gameKey = KEYS[1]
local playerNickname = ARGV[1]
local timestamp = tonumber(ARGV[2])
local maxHistoryEntries = tonumber(ARGV[3])

local gameData = redis.call('GET', gameKey)
if not gameData then
    return cjson.encode({error = 'NO_GAME'})
end

local game = cjson.decode(gameData)

-- Validate preconditions
if game.gameOver then
    return cjson.encode({error = 'GAME_OVER'})
end

local previousTurn = game.currentTurn

-- Switch turn
if game.currentTurn == 'red' then
    game.currentTurn = 'blue'
else
    game.currentTurn = 'red'
end

-- Reset clue state
game.currentClue = cjson.null
game.guessesUsed = 0
game.guessesAllowed = 0

-- Add to history
if not game.history then
    game.history = {}
end
table.insert(game.history, {
    action = 'endTurn',
    fromTeam = previousTurn,
    toTeam = game.currentTurn,
    player = playerNickname,
    timestamp = timestamp
})

-- Cap history
if #game.history > maxHistoryEntries then
    local newHistory = {}
    for i = #game.history - maxHistoryEntries + 1, #game.history do
        table.insert(newHistory, game.history[i])
    end
    game.history = newHistory
end

-- Increment version
game.stateVersion = (game.stateVersion or 0) + 1

-- Save game
redis.call('SET', gameKey, cjson.encode(game))

return cjson.encode({
    success = true,
    previousTurn = previousTurn,
    currentTurn = game.currentTurn
})
`;

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
 */
function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
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
    } catch (e) {
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
                .map(w => String(w).trim().toUpperCase())
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
    const firstTeam = seededRandom(numericSeed + 1000) > 0.5 ? 'red' : 'blue';

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
    types = shuffleWithSeed(types, numericSeed + 500);

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
}

/**
 * Get game state for a specific player (hides card types for non-spymasters)
 */
function getGameStateForPlayer(game, player) {
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
    if (player.role === 'spymaster' || game.gameOver) {
        state.types = game.types;
    } else {
        // Non-spymasters only see types of revealed cards
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

    // Cap history to prevent memory growth
    if (game.history.length > MAX_HISTORY_ENTRIES) {
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

    if (!game.currentClue) {
        throw ValidationError.noClueGiven();
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
    return {
        index,
        type,
        word: game.words[index],
        redScore: game.redScore,
        blueScore: game.blueScore,
        currentTurn: game.currentTurn,
        guessesUsed: game.guessesUsed,
        guessesAllowed: game.guessesAllowed,
        turnEnded: outcome.turnEnded,
        gameOver: game.gameOver,
        winner: game.winner,
        endReason: outcome.endReason,
        allTypes: game.gameOver ? game.types : null
    };
}

/**
 * ISSUE #36 FIX: Optimized card reveal using Lua script
 * Performs the entire reveal operation atomically in Redis, avoiding
 * the overhead of multiple round-trips and full JSON re-serialization in Node.js
 */
async function revealCardOptimized(roomCode, index, playerNickname = 'Unknown') {
    const redis = getRedis();
    const gameKey = `room:${roomCode}:game`;

    // Validate index before executing
    validateCardIndex(index);

    try {
        const resultStr = await redis.eval(
            OPTIMIZED_REVEAL_SCRIPT,
            {
                keys: [gameKey],
                arguments: [
                    index.toString(),
                    Date.now().toString(),
                    playerNickname,
                    MAX_HISTORY_ENTRIES.toString()
                ]
            }
        );

        const result = JSON.parse(resultStr);

        // Handle errors returned by the Lua script
        if (result.error) {
            const errorMap = {
                'NO_GAME': { code: ERROR_CODES.ROOM_NOT_FOUND, message: 'No active game' },
                'GAME_OVER': { code: ERROR_CODES.GAME_OVER, message: 'Game is already over' },
                'NO_CLUE': { code: ERROR_CODES.INVALID_INPUT, message: 'Spymaster must give a clue before guessing' },
                'NO_GUESSES': { code: ERROR_CODES.INVALID_INPUT, message: 'No guesses remaining this turn' },
                'ALREADY_REVEALED': { code: ERROR_CODES.CARD_ALREADY_REVEALED, message: 'Card already revealed' }
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
 */
async function revealCard(roomCode, index, playerNickname = 'Unknown') {
    const redis = getRedis();
    const gameKey = `room:${roomCode}:game`;
    const lockKey = `lock:reveal:${roomCode}`;

    // Validate index before starting transaction
    validateCardIndex(index);

    // ISSUE #32 FIX: Acquire distributed lock before reveal to prevent race conditions
    const lockAcquired = await redis.set(lockKey, process.pid.toString(), { NX: true, EX: 5 });
    if (!lockAcquired) {
        throw new ServerError('Another card reveal is in progress, please try again');
    }

    try {
        // ISSUE #36 FIX: Try optimized Lua script first
        try {
            return await revealCardOptimized(roomCode, index, playerNickname);
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

                // Execute transaction
                const result = await redis.multi()
                    .set(gameKey, JSON.stringify(game))
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
        // ISSUE #32 FIX: Always release the distributed lock
        await redis.del(lockKey).catch(err => {
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
 */
function validateClueWord(clueWord, boardWords) {
    const normalizedClue = clueWord.toUpperCase().trim();

    // Minimum clue length check
    if (normalizedClue.length === 0) {
        return { valid: false, reason: 'Clue cannot be empty' };
    }

    for (const boardWord of boardWords) {
        const normalizedBoardWord = boardWord.toUpperCase().trim();

        // Check exact match - always invalid
        if (normalizedClue === normalizedBoardWord) {
            return { valid: false, reason: `"${clueWord}" is a word on the board` };
        }

        // Check if clue contains board word (e.g., clue "SNOWMAN" contains board word "SNOW")
        if (normalizedClue.includes(normalizedBoardWord)) {
            // Only allow if the board word is a single character (rare edge case)
            if (normalizedBoardWord.length > 1) {
                return { valid: false, reason: `"${clueWord}" contains board word "${boardWord}"` };
            }
        }

        // Check if board word contains clue (e.g., board word "SNOWMAN" contains clue "SNOW")
        if (normalizedBoardWord.includes(normalizedClue)) {
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

    try {
        const resultStr = await redis.eval(
            OPTIMIZED_GIVE_CLUE_SCRIPT,
            {
                keys: [gameKey],
                arguments: [
                    team,
                    word,
                    number.toString(),
                    spymasterNickname || 'Unknown',
                    Date.now().toString(),
                    MAX_HISTORY_ENTRIES.toString(),
                    BOARD_SIZE.toString()
                ]
            }
        );

        const result = JSON.parse(resultStr);

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

            // BUG-3 FIX: Validate clue number is within valid range (0-25)
            // 0 = unlimited guesses, max is 25 (board size)
            if (typeof number !== 'number' || !Number.isInteger(number) || number < 0 || number > BOARD_SIZE) {
                await redis.unwatch();
                throw new ValidationError(`Clue number must be 0-${BOARD_SIZE}`);
            }

            // Validate clue word is not on the board
            const validation = validateClueWord(word, game.words);
            if (!validation.valid) {
                await redis.unwatch();
                throw ValidationError.invalidClue(validation.reason);
            }

            const clue = {
                team,
                word: word.toUpperCase(),
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

            const result = await redis.multi()
                .set(gameKey, JSON.stringify(game))
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
async function endTurnOptimized(roomCode, playerNickname = 'Unknown') {
    const redis = getRedis();
    const gameKey = `room:${roomCode}:game`;

    try {
        const resultStr = await redis.eval(
            OPTIMIZED_END_TURN_SCRIPT,
            {
                keys: [gameKey],
                arguments: [
                    playerNickname,
                    Date.now().toString(),
                    MAX_HISTORY_ENTRIES.toString()
                ]
            }
        );

        const result = JSON.parse(resultStr);

        if (result.error) {
            const errorMap = {
                'NO_GAME': GameStateError.noActiveGame(),
                'GAME_OVER': GameStateError.gameOver()
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
async function endTurn(roomCode, playerNickname = 'Unknown') {
    // Try optimized Lua script first
    try {
        return await endTurnOptimized(roomCode, playerNickname);
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
 * Forfeit the game - uses current turn's team as forfeiting team
 * Uses optimistic locking with retries for consistency
 */
async function forfeitGame(roomCode) {
    const gameKey = `room:${roomCode}:game`;

    return executeGameTransaction(gameKey, (game) => {
        if (game.gameOver) {
            throw GameStateError.gameOver();
        }

        // The current turn's team forfeits, other team wins
        const forfeitingTeam = game.currentTurn;
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
