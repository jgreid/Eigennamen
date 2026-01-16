/**
 * Game Service - Core game logic
 */

const { v4: uuidv4 } = require('uuid');
const { getRedis } = require('../config/redis');
const logger = require('../utils/logger');
const wordListService = require('./wordListService');
const {
    BOARD_SIZE,
    FIRST_TEAM_CARDS,
    SECOND_TEAM_CARDS,
    NEUTRAL_CARDS,
    ASSASSIN_CARDS,
    DEFAULT_WORDS,
    REDIS_TTL,
    ERROR_CODES
} = require('../config/constants');

/**
 * Seeded random number generator (same as client)
 */
function seededRandom(seed) {
    const x = Math.sin(seed) * 10000;
    return x - Math.floor(x);
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
 * Generate a random game seed
 */
function generateSeed() {
    return Math.random().toString(36).substring(2, 10);
}

/**
 * Create a new game for a room
 */
async function createGame(roomCode, wordListId = null) {
    const redis = getRedis();
    const seed = generateSeed();
    const numericSeed = hashString(seed);

    // Get words (from custom list or default)
    let words = DEFAULT_WORDS;
    let usedWordListId = null;

    if (wordListId) {
        try {
            const customWords = await wordListService.getWordsForGame(wordListId);
            if (customWords && customWords.length >= BOARD_SIZE) {
                words = customWords;
                usedWordListId = wordListId;
                logger.info(`Using custom word list ${wordListId} for room ${roomCode}`);
            } else {
                logger.warn(`Custom word list ${wordListId} not found or too small, using default`);
            }
        } catch (error) {
            logger.error(`Error fetching custom word list ${wordListId}:`, error);
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
        createdAt: Date.now()
    };

    // Store in Redis with TTL (same as room)
    await redis.set(`room:${roomCode}:game`, JSON.stringify(game), { EX: REDIS_TTL.ROOM });

    // Update room status and refresh TTL
    const roomData = await redis.get(`room:${roomCode}`);
    if (roomData) {
        const room = JSON.parse(roomData);
        room.status = 'playing';
        await redis.set(`room:${roomCode}`, JSON.stringify(room), { EX: REDIS_TTL.ROOM });
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
    return gameData ? JSON.parse(gameData) : null;
}

/**
 * Reveal a card with atomic operation to prevent race conditions
 */
async function revealCard(roomCode, index, playerNickname = 'Unknown') {
    const redis = getRedis();
    const gameKey = `room:${roomCode}:game`;

    // Validate index bounds
    if (typeof index !== 'number' || index < 0 || index >= BOARD_SIZE || !Number.isInteger(index)) {
        throw { code: ERROR_CODES.INVALID_INPUT, message: `Invalid card index: must be 0-${BOARD_SIZE - 1}` };
    }

    // Use optimistic locking with retries
    const maxRetries = 3;
    let retries = 0;

    while (retries < maxRetries) {
        try {
            // Watch the key for changes
            await redis.watch(gameKey);

            const gameData = await redis.get(gameKey);
            if (!gameData) {
                await redis.unwatch();
                throw { code: ERROR_CODES.ROOM_NOT_FOUND, message: 'No active game' };
            }

            const game = JSON.parse(gameData);

            if (game.gameOver) {
                await redis.unwatch();
                throw { code: ERROR_CODES.GAME_OVER, message: 'Game is already over' };
            }

            // Check if a clue has been given this turn
            if (!game.currentClue) {
                await redis.unwatch();
                throw { code: ERROR_CODES.INVALID_INPUT, message: 'Spymaster must give a clue before guessing' };
            }

            // Check if guesses remaining (0 = unlimited for "0" clue)
            if (game.guessesAllowed > 0 && game.guessesUsed >= game.guessesAllowed) {
                await redis.unwatch();
                throw { code: ERROR_CODES.INVALID_INPUT, message: 'No guesses remaining this turn' };
            }

            if (game.revealed[index]) {
                await redis.unwatch();
                throw { code: ERROR_CODES.CARD_ALREADY_REVEALED, message: 'Card already revealed' };
            }

            // Reveal the card
            game.revealed[index] = true;
            const type = game.types[index];

            // Update scores
            if (type === 'red') {
                game.redScore++;
            } else if (type === 'blue') {
                game.blueScore++;
            }

            // Increment guesses used
            game.guessesUsed = (game.guessesUsed || 0) + 1;

            let endReason = null;
            let turnEnded = false;
            const previousTurn = game.currentTurn;

            // Check for assassin
            if (type === 'assassin') {
                game.gameOver = true;
                game.winner = game.currentTurn === 'red' ? 'blue' : 'red';
                endReason = 'assassin';
                turnEnded = true;
            }
            // Check for win by completing all words
            else if (game.redScore >= game.redTotal) {
                game.gameOver = true;
                game.winner = 'red';
                endReason = 'completed';
                turnEnded = true;
            } else if (game.blueScore >= game.blueTotal) {
                game.gameOver = true;
                game.winner = 'blue';
                endReason = 'completed';
                turnEnded = true;
            }
            // Wrong guess ends turn
            else if (type !== game.currentTurn) {
                game.currentTurn = game.currentTurn === 'red' ? 'blue' : 'red';
                game.currentClue = null;
                game.guessesUsed = 0;
                game.guessesAllowed = 0;
                turnEnded = true;
            }
            // Check if max guesses reached (only if not unlimited)
            else if (game.guessesAllowed > 0 && game.guessesUsed >= game.guessesAllowed) {
                game.currentTurn = game.currentTurn === 'red' ? 'blue' : 'red';
                game.currentClue = null;
                game.guessesUsed = 0;
                game.guessesAllowed = 0;
                turnEnded = true;
                endReason = 'maxGuesses';
            }

            // Add to history
            if (!game.history) game.history = [];
            game.history.push({
                action: 'reveal',
                index,
                word: game.words[index],
                type,
                team: previousTurn,
                player: playerNickname,
                guessNumber: game.guessesUsed,
                timestamp: Date.now()
            });

            // Execute transaction
            const result = await redis.multi()
                .set(gameKey, JSON.stringify(game))
                .exec();

            // If transaction failed (key was modified), retry
            if (result === null) {
                retries++;
                continue;
            }

            return {
                index,
                type,
                word: game.words[index],
                redScore: game.redScore,
                blueScore: game.blueScore,
                currentTurn: game.currentTurn,
                guessesUsed: game.guessesUsed,
                guessesAllowed: game.guessesAllowed,
                turnEnded,
                gameOver: game.gameOver,
                winner: game.winner,
                endReason,
                allTypes: game.gameOver ? game.types : null
            };

        } catch (error) {
            await redis.unwatch();
            throw error;
        }
    }

    throw { code: ERROR_CODES.SERVER_ERROR, message: 'Failed to reveal card due to concurrent modifications' };
}

/**
 * Validate that a clue word is not on the board
 */
function validateClueWord(clueWord, boardWords) {
    const normalizedClue = clueWord.toUpperCase().trim();

    for (const boardWord of boardWords) {
        const normalizedBoardWord = boardWord.toUpperCase().trim();

        // Check exact match
        if (normalizedClue === normalizedBoardWord) {
            return { valid: false, reason: `"${clueWord}" is a word on the board` };
        }

        // Check if clue contains board word or vice versa (partial match)
        if (normalizedClue.includes(normalizedBoardWord) || normalizedBoardWord.includes(normalizedClue)) {
            // Allow if it's a very short word (like "A" or "I")
            if (normalizedClue.length > 2 && normalizedBoardWord.length > 2) {
                return { valid: false, reason: `"${clueWord}" contains or is contained in board word "${boardWord}"` };
            }
        }
    }

    return { valid: true };
}

/**
 * Give a clue with validation
 * Uses optimistic locking with retries for consistency
 */
async function giveClue(roomCode, team, word, number, spymasterNickname) {
    const redis = getRedis();
    const gameKey = `room:${roomCode}:game`;

    // Validate team is provided
    if (!team || (team !== 'red' && team !== 'blue')) {
        throw { code: ERROR_CODES.INVALID_INPUT, message: 'Spymaster must be on a team to give clues' };
    }

    const maxRetries = 3;
    let retries = 0;

    while (retries < maxRetries) {
        try {
            // Use optimistic locking
            await redis.watch(gameKey);

            const gameData = await redis.get(gameKey);
            if (!gameData) {
                await redis.unwatch();
                throw { code: ERROR_CODES.ROOM_NOT_FOUND, message: 'No active game' };
            }

            const game = JSON.parse(gameData);

            if (game.gameOver) {
                await redis.unwatch();
                throw { code: ERROR_CODES.GAME_OVER, message: 'Game is already over' };
            }

            if (game.currentTurn !== team) {
                await redis.unwatch();
                throw { code: ERROR_CODES.NOT_YOUR_TURN, message: "It's not your team's turn" };
            }

            // Check if a clue was already given this turn
            if (game.currentClue) {
                await redis.unwatch();
                throw { code: ERROR_CODES.INVALID_INPUT, message: 'A clue has already been given this turn' };
            }

            // Validate clue word is not on the board
            const validation = validateClueWord(word, game.words);
            if (!validation.valid) {
                await redis.unwatch();
                throw { code: ERROR_CODES.INVALID_INPUT, message: validation.reason };
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

            // Add to history
            if (!game.history) game.history = [];
            game.history.push({
                action: 'clue',
                team,
                word: clue.word,
                number,
                guessesAllowed: game.guessesAllowed,
                spymaster: spymasterNickname,
                timestamp: Date.now()
            });

            const result = await redis.multi()
                .set(gameKey, JSON.stringify(game))
                .exec();

            // If transaction failed (key was modified), retry
            if (result === null) {
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

    throw { code: ERROR_CODES.SERVER_ERROR, message: 'Failed to save clue due to concurrent modifications' };
}

/**
 * End the current turn
 * Uses optimistic locking with retries for consistency
 */
async function endTurn(roomCode, playerNickname = 'Unknown') {
    const redis = getRedis();
    const gameKey = `room:${roomCode}:game`;

    const maxRetries = 3;
    let retries = 0;

    while (retries < maxRetries) {
        try {
            await redis.watch(gameKey);

            const gameData = await redis.get(gameKey);
            if (!gameData) {
                await redis.unwatch();
                throw { code: ERROR_CODES.ROOM_NOT_FOUND, message: 'No active game' };
            }

            const game = JSON.parse(gameData);

            if (game.gameOver) {
                await redis.unwatch();
                throw { code: ERROR_CODES.GAME_OVER, message: 'Game is already over' };
            }

            const previousTurn = game.currentTurn;
            game.currentTurn = game.currentTurn === 'red' ? 'blue' : 'red';
            game.currentClue = null;
            game.guessesUsed = 0;
            game.guessesAllowed = 0;

            // Add to history
            if (!game.history) game.history = [];
            game.history.push({
                action: 'endTurn',
                fromTeam: previousTurn,
                toTeam: game.currentTurn,
                player: playerNickname,
                timestamp: Date.now()
            });

            const result = await redis.multi()
                .set(gameKey, JSON.stringify(game))
                .exec();

            // If transaction failed (key was modified), retry
            if (result === null) {
                retries++;
                continue;
            }

            return { currentTurn: game.currentTurn, previousTurn };

        } catch (error) {
            await redis.unwatch();
            throw error;
        }
    }

    throw { code: ERROR_CODES.SERVER_ERROR, message: 'Failed to end turn due to concurrent modifications' };
}

/**
 * Forfeit the game - uses current turn's team as forfeiting team
 * Uses optimistic locking with retries for consistency
 */
async function forfeitGame(roomCode) {
    const redis = getRedis();
    const gameKey = `room:${roomCode}:game`;

    const maxRetries = 3;
    let retries = 0;

    while (retries < maxRetries) {
        try {
            await redis.watch(gameKey);

            const gameData = await redis.get(gameKey);
            if (!gameData) {
                await redis.unwatch();
                throw { code: ERROR_CODES.ROOM_NOT_FOUND, message: 'No active game' };
            }

            const game = JSON.parse(gameData);

            if (game.gameOver) {
                await redis.unwatch();
                throw { code: ERROR_CODES.GAME_OVER, message: 'Game is already over' };
            }

            // The current turn's team forfeits, other team wins
            const forfeitingTeam = game.currentTurn;
            game.gameOver = true;
            game.winner = forfeitingTeam === 'red' ? 'blue' : 'red';

            // Add to history
            if (!game.history) game.history = [];
            game.history.push({
                action: 'forfeit',
                forfeitingTeam,
                winner: game.winner,
                timestamp: Date.now()
            });

            const result = await redis.multi()
                .set(gameKey, JSON.stringify(game))
                .exec();

            // If transaction failed (key was modified), retry
            if (result === null) {
                retries++;
                continue;
            }

            return {
                winner: game.winner,
                forfeitingTeam,
                allTypes: game.types
            };

        } catch (error) {
            await redis.unwatch();
            throw error;
        }
    }

    throw { code: ERROR_CODES.SERVER_ERROR, message: 'Failed to forfeit due to concurrent modifications' };
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
    giveClue,
    endTurn,
    forfeitGame,
    getGameHistory,
    cleanupGame,

    // Pure functions for unit testing
    seededRandom,
    hashString,
    shuffleWithSeed,
    generateSeed,
    validateClueWord
};
