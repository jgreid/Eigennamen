/**
 * Game Logic Module for Codenames
 *
 * Contains all core game logic:
 * - Seeded random number generation (Mulberry32)
 * - Board setup and card assignment
 * - Game state management
 * - Win condition checking
 */

// Game constants
const GAME_CONFIG = {
    BOARD_SIZE: 25,
    FIRST_TEAM_CARDS: 9,
    SECOND_TEAM_CARDS: 8,
    NEUTRAL_CARDS: 7,
    ASSASSIN_CARDS: 1
};

/**
 * Seeded random number generator using Mulberry32 algorithm
 * Provides deterministic, reproducible random numbers
 * Must stay in sync with server-side implementation
 */
function seededRandom(seed) {
    let t = (seed + 0x6D2B79F5) | 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * Hash a string to a numeric seed
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
 * Shuffle array deterministically using a seed
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
function generateGameSeed() {
    return Math.random().toString(36).substring(2, 10);
}

/**
 * Game state factory
 */
function createInitialGameState() {
    return {
        words: [],
        types: [],
        revealed: [],
        currentTurn: 'red',
        redScore: 0,
        blueScore: 0,
        redTotal: GAME_CONFIG.FIRST_TEAM_CARDS,
        blueTotal: GAME_CONFIG.SECOND_TEAM_CARDS,
        gameOver: false,
        winner: null,
        seed: null,
        customWords: false
    };
}

/**
 * Set up the game board with card types
 */
function setupGameBoard(numericSeed) {
    // Determine first team (gets 9 cards)
    const firstTeam = seededRandom(numericSeed + 1000) > 0.5 ? 'red' : 'blue';

    // Create card type array
    let types = [];
    let redTotal, blueTotal;

    if (firstTeam === 'red') {
        types = [
            ...Array(GAME_CONFIG.FIRST_TEAM_CARDS).fill('red'),
            ...Array(GAME_CONFIG.SECOND_TEAM_CARDS).fill('blue')
        ];
        redTotal = GAME_CONFIG.FIRST_TEAM_CARDS;
        blueTotal = GAME_CONFIG.SECOND_TEAM_CARDS;
    } else {
        types = [
            ...Array(GAME_CONFIG.SECOND_TEAM_CARDS).fill('red'),
            ...Array(GAME_CONFIG.FIRST_TEAM_CARDS).fill('blue')
        ];
        redTotal = GAME_CONFIG.SECOND_TEAM_CARDS;
        blueTotal = GAME_CONFIG.FIRST_TEAM_CARDS;
    }

    types = [
        ...types,
        ...Array(GAME_CONFIG.NEUTRAL_CARDS).fill('neutral'),
        ...Array(GAME_CONFIG.ASSASSIN_CARDS).fill('assassin')
    ];

    // Shuffle types
    types = shuffleWithSeed(types, numericSeed + 500);

    return {
        types,
        currentTurn: firstTeam,
        redTotal,
        blueTotal,
        revealed: Array(GAME_CONFIG.BOARD_SIZE).fill(false),
        redScore: 0,
        blueScore: 0,
        gameOver: false,
        winner: null
    };
}

/**
 * Initialize game with specific board words (for custom word games)
 */
function initGameWithWords(seed, boardWords) {
    if (boardWords.length !== GAME_CONFIG.BOARD_SIZE) {
        throw new Error(`Invalid game: need exactly ${GAME_CONFIG.BOARD_SIZE} words`);
    }

    const numericSeed = hashString(seed);
    const boardState = setupGameBoard(numericSeed);

    return {
        ...boardState,
        seed,
        words: boardWords,
        customWords: true
    };
}

/**
 * Initialize game with a word list (selects random words)
 */
function initGame(seed, wordList, defaultWords) {
    const words = wordList || defaultWords;

    if (words.length < GAME_CONFIG.BOARD_SIZE) {
        throw new Error(`Not enough words! Need at least ${GAME_CONFIG.BOARD_SIZE} words.`);
    }

    const numericSeed = hashString(seed);
    const shuffledWords = shuffleWithSeed(words, numericSeed);
    const boardWords = shuffledWords.slice(0, GAME_CONFIG.BOARD_SIZE);
    const boardState = setupGameBoard(numericSeed);

    return {
        ...boardState,
        seed,
        words: boardWords,
        customWords: wordList !== defaultWords
    };
}

/**
 * Reveal a card and update game state
 * Returns a new state object (immutable update)
 */
function revealCard(gameState, index) {
    if (index < 0 || index >= GAME_CONFIG.BOARD_SIZE) {
        throw new Error('Invalid card index');
    }

    if (gameState.revealed[index]) {
        throw new Error('Card already revealed');
    }

    if (gameState.gameOver) {
        throw new Error('Game is already over');
    }

    // Create new state with revealed card
    const newRevealed = [...gameState.revealed];
    newRevealed[index] = true;

    const cardType = gameState.types[index];
    let newState = {
        ...gameState,
        revealed: newRevealed
    };

    // Update scores
    if (cardType === 'red') {
        newState.redScore = gameState.redScore + 1;
    } else if (cardType === 'blue') {
        newState.blueScore = gameState.blueScore + 1;
    }

    // Check game over conditions
    if (cardType === 'assassin') {
        newState.gameOver = true;
        newState.winner = gameState.currentTurn === 'red' ? 'blue' : 'red';
    } else if (newState.redScore >= newState.redTotal) {
        newState.gameOver = true;
        newState.winner = 'red';
    } else if (newState.blueScore >= newState.blueTotal) {
        newState.gameOver = true;
        newState.winner = 'blue';
    } else if (cardType !== gameState.currentTurn) {
        // Wrong guess - switch turns
        newState.currentTurn = gameState.currentTurn === 'red' ? 'blue' : 'red';
    }

    return {
        newState,
        cardType,
        turnEnded: cardType !== gameState.currentTurn || newState.gameOver
    };
}

/**
 * End the current turn
 */
function endTurn(gameState) {
    if (gameState.gameOver) {
        throw new Error('Game is already over');
    }

    return {
        ...gameState,
        currentTurn: gameState.currentTurn === 'red' ? 'blue' : 'red'
    };
}

/**
 * Check if the game is over
 */
function checkGameOver(gameState) {
    if (gameState.redScore >= gameState.redTotal) {
        return { gameOver: true, winner: 'red' };
    }
    if (gameState.blueScore >= gameState.blueTotal) {
        return { gameOver: true, winner: 'blue' };
    }
    // Check for assassin (already handled in revealCard)
    return { gameOver: false, winner: null };
}

/**
 * Restore game state from URL parameters
 */
function restoreGameState(gameState, revealed, turn) {
    const newState = { ...gameState };

    // Restore revealed cards
    if (revealed) {
        for (let i = 0; i < revealed.length && i < GAME_CONFIG.BOARD_SIZE; i++) {
            if (revealed[i] === '1') {
                newState.revealed[i] = true;
                const type = newState.types[i];
                if (type === 'red') newState.redScore++;
                if (type === 'blue') newState.blueScore++;
            }
        }
    }

    // Restore turn
    if (turn === 'b') {
        newState.currentTurn = 'blue';
    } else if (turn === 'r') {
        newState.currentTurn = 'red';
    }

    // Check game over
    const gameOverCheck = checkGameOver(newState);
    if (gameOverCheck.gameOver) {
        newState.gameOver = true;
        newState.winner = gameOverCheck.winner;
    }

    return newState;
}

// Export for ES modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        GAME_CONFIG,
        seededRandom,
        hashString,
        shuffleWithSeed,
        generateGameSeed,
        createInitialGameState,
        setupGameBoard,
        initGame,
        initGameWithWords,
        revealCard,
        endTurn,
        checkGameOver,
        restoreGameState
    };
}

// Export for browser globals
if (typeof window !== 'undefined') {
    window.CodenamesGame = {
        GAME_CONFIG,
        seededRandom,
        hashString,
        shuffleWithSeed,
        generateGameSeed,
        createInitialGameState,
        setupGameBoard,
        initGame,
        initGameWithWords,
        revealCard,
        endTurn,
        checkGameOver,
        restoreGameState
    };
}
