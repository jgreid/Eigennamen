/**
 * Game Service - Core game logic
 */

const { v4: uuidv4 } = require('uuid');
const { getRedis } = require('../config/redis');
const logger = require('../utils/logger');
const {
    BOARD_SIZE,
    FIRST_TEAM_CARDS,
    SECOND_TEAM_CARDS,
    NEUTRAL_CARDS,
    ASSASSIN_CARDS,
    DEFAULT_WORDS,
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
    if (wordListId) {
        // TODO: Fetch custom word list from database
        // const wordList = await prisma.wordList.findUnique({ where: { id: wordListId } });
        // if (wordList) words = wordList.words;
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
        clues: [],
        history: [],
        createdAt: Date.now()
    };

    // Store in Redis
    await redis.set(`room:${roomCode}:game`, JSON.stringify(game));

    // Update room status
    const roomData = await redis.get(`room:${roomCode}`);
    if (roomData) {
        const room = JSON.parse(roomData);
        room.status = 'playing';
        await redis.set(`room:${roomCode}`, JSON.stringify(room));
    }

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

            let endReason = null;
            const previousTurn = game.currentTurn;

            // Check for assassin
            if (type === 'assassin') {
                game.gameOver = true;
                game.winner = game.currentTurn === 'red' ? 'blue' : 'red';
                endReason = 'assassin';
            }
            // Check for win by completing all words
            else if (game.redScore >= game.redTotal) {
                game.gameOver = true;
                game.winner = 'red';
                endReason = 'completed';
            } else if (game.blueScore >= game.blueTotal) {
                game.gameOver = true;
                game.winner = 'blue';
                endReason = 'completed';
            }
            // Wrong guess ends turn
            else if (type !== game.currentTurn) {
                game.currentTurn = game.currentTurn === 'red' ? 'blue' : 'red';
                game.currentClue = null;
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
 */
async function giveClue(roomCode, team, word, number, spymasterNickname) {
    const redis = getRedis();
    const gameKey = `room:${roomCode}:game`;

    // Use optimistic locking
    await redis.watch(gameKey);

    try {
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
        if (!game.clues) game.clues = [];
        game.clues.push(clue);

        // Add to history
        if (!game.history) game.history = [];
        game.history.push({
            action: 'clue',
            team,
            word: clue.word,
            number,
            spymaster: spymasterNickname,
            timestamp: Date.now()
        });

        const result = await redis.multi()
            .set(gameKey, JSON.stringify(game))
            .exec();

        if (result === null) {
            throw { code: ERROR_CODES.SERVER_ERROR, message: 'Failed to save clue due to concurrent modification' };
        }

        return clue;

    } catch (error) {
        await redis.unwatch();
        throw error;
    }
}

/**
 * End the current turn
 */
async function endTurn(roomCode, playerNickname = 'Unknown') {
    const redis = getRedis();
    const gameKey = `room:${roomCode}:game`;

    await redis.watch(gameKey);

    try {
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

        if (result === null) {
            throw { code: ERROR_CODES.SERVER_ERROR, message: 'Failed to end turn due to concurrent modification' };
        }

        return { currentTurn: game.currentTurn, previousTurn };

    } catch (error) {
        await redis.unwatch();
        throw error;
    }
}

/**
 * Forfeit the game - uses current turn's team as forfeiting team
 */
async function forfeitGame(roomCode) {
    const redis = getRedis();
    const gameKey = `room:${roomCode}:game`;

    await redis.watch(gameKey);

    try {
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

        if (result === null) {
            throw { code: ERROR_CODES.SERVER_ERROR, message: 'Failed to forfeit due to concurrent modification' };
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

    // Pure functions for unit testing
    seededRandom,
    hashString,
    shuffleWithSeed,
    generateSeed,
    validateClueWord
};
