/**
 * Game Service - Core game logic
 */

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
        id: require('uuid').v4(),
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
        currentClue: game.currentClue
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
 * Reveal a card
 */
async function revealCard(roomCode, index) {
    const redis = getRedis();
    const game = await getGame(roomCode);

    if (!game) {
        throw { code: ERROR_CODES.ROOM_NOT_FOUND, message: 'No active game' };
    }

    if (game.gameOver) {
        throw { code: ERROR_CODES.GAME_OVER, message: 'Game is already over' };
    }

    if (game.revealed[index]) {
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

    // Save updated game state
    await redis.set(`room:${roomCode}:game`, JSON.stringify(game));

    return {
        index,
        type,
        redScore: game.redScore,
        blueScore: game.blueScore,
        currentTurn: game.currentTurn,
        gameOver: game.gameOver,
        winner: game.winner,
        endReason,
        allTypes: game.gameOver ? game.types : null
    };
}

/**
 * Give a clue
 */
async function giveClue(roomCode, team, word, number, spymasterNickname) {
    const redis = getRedis();
    const game = await getGame(roomCode);

    if (!game) {
        throw { code: ERROR_CODES.ROOM_NOT_FOUND, message: 'No active game' };
    }

    if (game.gameOver) {
        throw { code: ERROR_CODES.GAME_OVER, message: 'Game is already over' };
    }

    if (game.currentTurn !== team) {
        throw { code: ERROR_CODES.NOT_YOUR_TURN, message: "It's not your team's turn" };
    }

    const clue = {
        team,
        word: word.toUpperCase(),
        number,
        spymaster: spymasterNickname,
        timestamp: Date.now()
    };

    game.currentClue = clue;
    game.clues.push(clue);

    await redis.set(`room:${roomCode}:game`, JSON.stringify(game));

    return clue;
}

/**
 * End the current turn
 */
async function endTurn(roomCode) {
    const redis = getRedis();
    const game = await getGame(roomCode);

    if (!game) {
        throw { code: ERROR_CODES.ROOM_NOT_FOUND, message: 'No active game' };
    }

    if (game.gameOver) {
        throw { code: ERROR_CODES.GAME_OVER, message: 'Game is already over' };
    }

    game.currentTurn = game.currentTurn === 'red' ? 'blue' : 'red';
    game.currentClue = null;

    await redis.set(`room:${roomCode}:game`, JSON.stringify(game));

    return { currentTurn: game.currentTurn };
}

/**
 * Forfeit the game
 */
async function forfeitGame(roomCode, forfeitingTeam) {
    const redis = getRedis();
    const game = await getGame(roomCode);

    if (!game) {
        throw { code: ERROR_CODES.ROOM_NOT_FOUND, message: 'No active game' };
    }

    game.gameOver = true;
    game.winner = forfeitingTeam === 'red' ? 'blue' : 'red';

    await redis.set(`room:${roomCode}:game`, JSON.stringify(game));

    return {
        winner: game.winner,
        allTypes: game.types
    };
}

module.exports = {
    createGame,
    getGame,
    getGameStateForPlayer,
    revealCard,
    giveClue,
    endTurn,
    forfeitGame
};
