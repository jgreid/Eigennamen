/**
 * Frontend Game Module Tests
 *
 * Tests core game logic: board setup, initialization, scoring, turn management,
 * card reveal, and game-over detection.
 * Test environment: jsdom
 */

jest.mock('../../frontend/i18n', () => ({
    t: (key: string, params: Record<string, string | number> = {}) => {
        // Return key with params interpolated for assertion
        let result = key;
        for (const [k, v] of Object.entries(params)) {
            result = result.replace(`{{${k}}}`, String(v));
        }
        return result;
    },
    initI18n: async () => {},
    setLanguage: async () => {},
    getLanguage: () => 'en',
    translatePage: () => {},
    getLocalizedWordList: async () => null,
    LANGUAGES: { en: { name: 'English', flag: 'EN' } },
    DEFAULT_LANGUAGE: 'en',
}));

// Mock url-state to avoid DOM side effects
jest.mock('../../frontend/url-state', () => ({
    updateURL: jest.fn(),
    updateQRCode: jest.fn(),
    copyLink: jest.fn(),
}));

import {
    setupGameBoard,
    initGameWithWords,
    initGame,
    revealCardFromServer,
    checkGameOver,
    updateScoreboard,
    updateTurnIndicator
} from '../../frontend/game';
import { state, BOARD_SIZE, FIRST_TEAM_CARDS, SECOND_TEAM_CARDS } from '../../frontend/state';

const SAMPLE_WORDS = [
    'AFRICA', 'AGENT', 'AIR', 'ALIEN', 'ALPS',
    'AMAZON', 'AMBULANCE', 'AMERICA', 'ANGEL', 'ANTARCTICA',
    'APPLE', 'ARM', 'ATLANTIS', 'AUSTRALIA', 'AZTEC',
    'BACK', 'BALL', 'BAND', 'BANK', 'BAR',
    'BARK', 'BAT', 'BATTERY', 'BEACH', 'BEAR',
];

function resetGameState() {
    state.gameState.words = [];
    state.gameState.types = [];
    state.gameState.revealed = [];
    state.gameState.currentTurn = 'red';
    state.gameState.redScore = 0;
    state.gameState.blueScore = 0;
    state.gameState.redTotal = 9;
    state.gameState.blueTotal = 8;
    state.gameState.gameOver = false;
    state.gameState.winner = null;
    state.gameState.seed = null;
    state.gameState.customWords = false;
    state.gameState.currentClue = null;
    state.gameState.guessesUsed = 0;
    state.gameState.guessesAllowed = 0;
    state.lastRevealedIndex = -1;
    state.lastRevealedWasCorrect = false;
    state.isMultiplayerMode = false;
    state.spymasterTeam = null;
    state.clickerTeam = null;
    state.playerTeam = null;
}

beforeEach(() => {
    resetGameState();
    document.body.innerHTML = `
        <div id="board"></div>
        <div id="turn-indicator"><span class="turn-text"></span></div>
        <span id="red-remaining">9</span>
        <span id="blue-remaining">8</span>
        <span id="red-team-name">Red</span>
        <span id="blue-team-name">Blue</span>
        <div id="role-banner"></div>
        <div id="sr-announcements" aria-live="assertive"></div>
        <button id="btn-end-turn"></button>
        <button id="btn-spymaster"></button>
        <button id="btn-clicker"></button>
        <button id="btn-team-red"></button>
        <button id="btn-team-blue"></button>
    `;
    state.cachedElements.turnIndicator = document.getElementById('turn-indicator');
    state.cachedElements.redRemaining = document.getElementById('red-remaining');
    state.cachedElements.blueRemaining = document.getElementById('blue-remaining');
    state.cachedElements.redTeamName = document.getElementById('red-team-name');
    state.cachedElements.blueTeamName = document.getElementById('blue-team-name');
    state.cachedElements.srAnnouncements = document.getElementById('sr-announcements');
    state.teamNames = { red: 'Red', blue: 'Blue' };
});

// ========== BOARD SETUP ==========

describe('setupGameBoard', () => {
    test('sets current turn to either red or blue', () => {
        setupGameBoard(12345);
        expect(['red', 'blue']).toContain(state.gameState.currentTurn);
    });

    test('creates correct number of card types', () => {
        setupGameBoard(12345);
        expect(state.gameState.types.length).toBe(BOARD_SIZE);
    });

    test('first team gets more cards', () => {
        setupGameBoard(12345);
        const firstTeam = state.gameState.currentTurn;
        const firstTeamTotal = firstTeam === 'red' ? state.gameState.redTotal : state.gameState.blueTotal;
        const secondTeamTotal = firstTeam === 'red' ? state.gameState.blueTotal : state.gameState.redTotal;
        expect(firstTeamTotal).toBe(FIRST_TEAM_CARDS);
        expect(secondTeamTotal).toBe(SECOND_TEAM_CARDS);
    });

    test('card type counts match expected distribution', () => {
        setupGameBoard(42);
        const counts: Record<string, number> = {};
        for (const t of state.gameState.types) {
            counts[t] = (counts[t] || 0) + 1;
        }
        expect(counts['red']! + counts['blue']!).toBe(FIRST_TEAM_CARDS + SECOND_TEAM_CARDS);
        expect(counts['neutral']).toBe(7); // NEUTRAL_CARDS
        expect(counts['assassin']).toBe(1); // ASSASSIN_CARDS
    });

    test('initializes revealed array to all false', () => {
        setupGameBoard(12345);
        expect(state.gameState.revealed.length).toBe(BOARD_SIZE);
        expect(state.gameState.revealed.every(r => r === false)).toBe(true);
    });

    test('resets scores to zero', () => {
        state.gameState.redScore = 5;
        state.gameState.blueScore = 3;
        setupGameBoard(12345);
        expect(state.gameState.redScore).toBe(0);
        expect(state.gameState.blueScore).toBe(0);
    });

    test('resets gameOver and winner', () => {
        state.gameState.gameOver = true;
        state.gameState.winner = 'red';
        setupGameBoard(12345);
        expect(state.gameState.gameOver).toBe(false);
        expect(state.gameState.winner).toBeNull();
    });

    test('produces deterministic results for the same seed', () => {
        setupGameBoard(99999);
        const types1 = [...state.gameState.types];
        const turn1 = state.gameState.currentTurn;

        resetGameState();
        setupGameBoard(99999);
        expect(state.gameState.types).toEqual(types1);
        expect(state.gameState.currentTurn).toBe(turn1);
    });

    test('produces different results for different seeds', () => {
        setupGameBoard(11111);
        const types1 = [...state.gameState.types];

        resetGameState();
        setupGameBoard(22222);
        // Very unlikely to be identical
        expect(state.gameState.types).not.toEqual(types1);
    });
});

// ========== GAME INITIALIZATION ==========

describe('initGameWithWords', () => {
    test('returns true and sets up game with valid words', () => {
        const result = initGameWithWords('test-seed', SAMPLE_WORDS);
        expect(result).toBe(true);
        expect(state.gameState.words).toEqual(SAMPLE_WORDS);
        expect(state.gameState.seed).toBe('test-seed');
        expect(state.gameState.customWords).toBe(true);
    });

    test('returns false for wrong number of words', () => {
        const result = initGameWithWords('seed', ['one', 'two']);
        expect(result).toBe(false);
    });

    test('sets up board types correctly', () => {
        initGameWithWords('seed', SAMPLE_WORDS);
        expect(state.gameState.types.length).toBe(BOARD_SIZE);
    });
});

describe('initGame', () => {
    test('returns true and selects words from word list', () => {
        const largeWordList = Array.from({ length: 100 }, (_, i) => `WORD${i}`);
        const result = initGame('my-seed', largeWordList);
        expect(result).toBe(true);
        expect(state.gameState.words.length).toBe(BOARD_SIZE);
        expect(state.gameState.seed).toBe('my-seed');
    });

    test('returns false when not enough words', () => {
        const result = initGame('seed', ['one', 'two', 'three']);
        expect(result).toBe(false);
    });

    test('produces deterministic word selection for same seed', () => {
        const words = Array.from({ length: 100 }, (_, i) => `WORD${i}`);
        initGame('fixed-seed', words);
        const words1 = [...state.gameState.words];

        resetGameState();
        initGame('fixed-seed', words);
        expect(state.gameState.words).toEqual(words1);
    });
});

// ========== GAME OVER DETECTION ==========

describe('checkGameOver', () => {
    beforeEach(() => {
        state.gameState.types = [
            'red', 'red', 'red', 'red', 'red',
            'red', 'red', 'red', 'red', 'blue',
            'blue', 'blue', 'blue', 'blue', 'blue',
            'blue', 'blue', 'neutral', 'neutral', 'neutral',
            'neutral', 'neutral', 'neutral', 'neutral', 'assassin',
        ];
        state.gameState.revealed = Array(BOARD_SIZE).fill(false);
        state.gameState.redTotal = 9;
        state.gameState.blueTotal = 8;
        state.gameState.redScore = 0;
        state.gameState.blueScore = 0;
        state.gameState.gameOver = false;
        state.gameState.winner = null;
        state.gameState.currentTurn = 'red';
    });

    test('detects assassin reveal as game over', () => {
        state.gameState.revealed[24] = true; // assassin at index 24
        checkGameOver();
        expect(state.gameState.gameOver).toBe(true);
        expect(state.gameState.winner).toBe('blue'); // red revealed assassin = blue wins
    });

    test('detects red team completing all words', () => {
        state.gameState.redScore = 9;
        checkGameOver();
        expect(state.gameState.gameOver).toBe(true);
        expect(state.gameState.winner).toBe('red');
    });

    test('detects blue team completing all words', () => {
        state.gameState.blueScore = 8;
        checkGameOver();
        expect(state.gameState.gameOver).toBe(true);
        expect(state.gameState.winner).toBe('blue');
    });

    test('does not set game over when neither condition met', () => {
        state.gameState.redScore = 5;
        state.gameState.blueScore = 3;
        checkGameOver();
        expect(state.gameState.gameOver).toBe(false);
        expect(state.gameState.winner).toBeNull();
    });
});

// ========== SERVER REVEAL ==========

describe('revealCardFromServer', () => {
    beforeEach(() => {
        state.gameState.words = SAMPLE_WORDS;
        state.gameState.types = [
            'red', 'red', 'red', 'red', 'red',
            'red', 'red', 'red', 'red', 'blue',
            'blue', 'blue', 'blue', 'blue', 'blue',
            'blue', 'blue', 'neutral', 'neutral', 'neutral',
            'neutral', 'neutral', 'neutral', 'neutral', 'assassin',
        ];
        state.gameState.revealed = Array(BOARD_SIZE).fill(false);
        state.gameState.currentTurn = 'red';
        state.gameState.redScore = 0;
        state.gameState.blueScore = 0;
        state.gameState.gameOver = false;
    });

    test('marks card as revealed', () => {
        revealCardFromServer(0, { type: 'red' });
        expect(state.gameState.revealed[0]).toBe(true);
    });

    test('uses server-provided scores', () => {
        revealCardFromServer(0, { type: 'red', redScore: 3, blueScore: 1 });
        expect(state.gameState.redScore).toBe(3);
        expect(state.gameState.blueScore).toBe(1);
    });

    test('falls back to local scoring when server scores not provided', () => {
        revealCardFromServer(0, { type: 'red' });
        expect(state.gameState.redScore).toBe(1);

        revealCardFromServer(9, { type: 'blue' });
        expect(state.gameState.blueScore).toBe(1);
    });

    test('uses server-provided turn state', () => {
        revealCardFromServer(0, { type: 'red', currentTurn: 'blue' });
        expect(state.gameState.currentTurn).toBe('blue');
    });

    test('switches turn on wrong guess when no server turn provided', () => {
        state.gameState.currentTurn = 'red';
        revealCardFromServer(17, { type: 'neutral' }); // neutral = wrong guess
        expect(state.gameState.currentTurn).toBe('blue');
    });

    test('uses server-provided game over state', () => {
        revealCardFromServer(24, { type: 'assassin', gameOver: true, winner: 'blue' });
        expect(state.gameState.gameOver).toBe(true);
        expect(state.gameState.winner).toBe('blue');
    });

    test('detects assassin locally if server does not provide gameOver', () => {
        revealCardFromServer(24, { type: 'assassin' });
        expect(state.gameState.gameOver).toBe(true);
    });

    test('updates types array with server-provided type', () => {
        state.gameState.types[5] = 'neutral'; // wrong type locally
        revealCardFromServer(5, { type: 'red' });
        expect(state.gameState.types[5]).toBe('red');
    });

    test('ignores already revealed cards', () => {
        state.gameState.revealed[0] = true;
        state.gameState.redScore = 1;
        revealCardFromServer(0, { type: 'red' });
        expect(state.gameState.redScore).toBe(1); // Not incremented again
    });

    test('rejects invalid index', () => {
        const initialRevealed = [...state.gameState.revealed];
        revealCardFromServer(-1, { type: 'red' });
        revealCardFromServer(100, { type: 'red' });
        expect(state.gameState.revealed).toEqual(initialRevealed);
    });

    test('tracks animation state', () => {
        revealCardFromServer(3, { type: 'red' });
        expect(state.lastRevealedIndex).toBe(3);
        expect(state.lastRevealedWasCorrect).toBe(true); // red revealing red card
    });

    test('tracks wrong guess animation', () => {
        state.gameState.currentTurn = 'red';
        revealCardFromServer(17, { type: 'neutral' });
        expect(state.lastRevealedWasCorrect).toBe(false);
    });

    test('syncs guess tracking from server', () => {
        revealCardFromServer(0, { type: 'red', guessesUsed: 2, guessesAllowed: 5 });
        expect(state.gameState.guessesUsed).toBe(2);
        expect(state.gameState.guessesAllowed).toBe(5);
    });

    test('clears clue state on turn end', () => {
        state.gameState.currentClue = { word: 'test', number: 3 } as any;
        revealCardFromServer(17, { type: 'neutral', turnEnded: true });
        expect(state.gameState.currentClue).toBeNull();
    });
});

// ========== SCOREBOARD ==========

describe('updateScoreboard', () => {
    test('displays remaining cards correctly', () => {
        state.gameState.redTotal = 9;
        state.gameState.blueTotal = 8;
        state.gameState.redScore = 3;
        state.gameState.blueScore = 2;

        updateScoreboard();

        expect(document.getElementById('red-remaining')!.textContent).toBe('6');
        expect(document.getElementById('blue-remaining')!.textContent).toBe('6');
    });

    test('displays team names', () => {
        state.teamNames.red = 'Fire';
        state.teamNames.blue = 'Ice';

        updateScoreboard();

        expect(document.getElementById('red-team-name')!.textContent).toBe('Fire');
        expect(document.getElementById('blue-team-name')!.textContent).toBe('Ice');
    });

    test('shows zero remaining when all found', () => {
        state.gameState.redTotal = 9;
        state.gameState.redScore = 9;

        updateScoreboard();

        expect(document.getElementById('red-remaining')!.textContent).toBe('0');
    });
});

// ========== TURN INDICATOR ==========

describe('updateTurnIndicator', () => {
    test('shows current team turn', () => {
        state.gameState.currentTurn = 'red';
        state.gameState.gameOver = false;

        updateTurnIndicator();

        const indicator = document.getElementById('turn-indicator')!;
        expect(indicator.className).toContain('red-turn');
    });

    test('shows game over state', () => {
        state.gameState.gameOver = true;
        state.gameState.winner = 'blue';

        updateTurnIndicator();

        const indicator = document.getElementById('turn-indicator')!;
        expect(indicator.className).toContain('game-over');
    });

    test('highlights your turn when clicker team matches', () => {
        state.gameState.currentTurn = 'red';
        state.gameState.gameOver = false;
        state.clickerTeam = 'red';

        updateTurnIndicator();

        const indicator = document.getElementById('turn-indicator')!;
        expect(indicator.className).toContain('your-turn');
    });

    test('does not highlight your turn for other team', () => {
        state.gameState.currentTurn = 'blue';
        state.gameState.gameOver = false;
        state.clickerTeam = 'red';

        updateTurnIndicator();

        const indicator = document.getElementById('turn-indicator')!;
        expect(indicator.className).not.toContain('your-turn');
    });
});
