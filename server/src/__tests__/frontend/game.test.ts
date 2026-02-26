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
    copyLink: jest.fn(),
}));

// Mock board module for render calls
jest.mock('../../frontend/board', () => ({
    renderBoard: jest.fn(),
    updateBoardIncremental: jest.fn(),
    updateSingleCard: jest.fn(),
    canClickCards: jest.fn(() => true),
    setCardClickHandler: jest.fn(),
}));

// Mock ui module for toast/modal/screen reader
jest.mock('../../frontend/ui', () => ({
    showToast: jest.fn(),
    openModal: jest.fn(),
    closeModal: jest.fn(),
    announceToScreenReader: jest.fn(),
}));

// Mock roles module
jest.mock('../../frontend/roles', () => ({
    updateRoleBanner: jest.fn(),
    updateControls: jest.fn(),
}));

// Mock clientAccessor
jest.mock('../../frontend/clientAccessor', () => ({
    getClient: () => null,
    isClientConnected: jest.fn(() => false),
}));

import {
    setupGameBoard,
    initGameWithWords,
    initGame,
    revealCardFromServer,
    checkGameOver,
    updateScoreboard,
    updateTurnIndicator,
    loadGameFromURL,
    endTurn,
    confirmNewGame,
    showGameOverModal,
    closeGameOver,
} from '../../frontend/game';
import { state, BOARD_SIZE, FIRST_TEAM_CARDS, SECOND_TEAM_CARDS, DEFAULT_WORDS } from '../../frontend/state';
import { encodeWordsForURL } from '../../frontend/utils';
import { renderBoard } from '../../frontend/board';
import { showToast, openModal, closeModal, announceToScreenReader } from '../../frontend/ui';
import { updateURL } from '../../frontend/url-state';

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

// ========== LOAD GAME FROM URL ==========

describe('loadGameFromURL', () => {
    function setURL(search: string) {
        // Use history.replaceState to change URL in jsdom without triggering navigation
        window.history.replaceState({}, '', 'http://localhost' + search);
    }

    afterEach(() => {
        // Reset URL to clean state
        window.history.replaceState({}, '', 'http://localhost/');
        jest.clearAllMocks();
    });

    test('loads a game from URL with seed parameter', () => {
        setURL('?game=test-seed');
        state.activeWords = [...DEFAULT_WORDS];

        loadGameFromURL();

        expect(state.gameState.seed).toBe('test-seed');
        expect(state.gameState.words.length).toBe(BOARD_SIZE);
        expect(state.gameState.types.length).toBe(BOARD_SIZE);
        expect(renderBoard).toHaveBeenCalled();
    });

    test('restores revealed cards from URL', () => {
        setURL('?game=test-seed&r=1010000000000000000000000');
        state.activeWords = [...DEFAULT_WORDS];

        loadGameFromURL();

        expect(state.gameState.revealed[0]).toBe(true);
        expect(state.gameState.revealed[1]).toBe(false);
        expect(state.gameState.revealed[2]).toBe(true);
        expect(state.gameState.revealed[3]).toBe(false);
        // Remaining should be false
        for (let i = 4; i < BOARD_SIZE; i++) {
            expect(state.gameState.revealed[i]).toBe(false);
        }
    });

    test('restores scores from revealed cards', () => {
        setURL('?game=test-seed&r=1010000000000000000000000');
        state.activeWords = [...DEFAULT_WORDS];

        loadGameFromURL();

        // Scores depend on which types were at indices 0 and 2
        const type0 = state.gameState.types[0];
        const type2 = state.gameState.types[2];
        let expectedRed = 0;
        let expectedBlue = 0;
        if (type0 === 'red') expectedRed++;
        if (type0 === 'blue') expectedBlue++;
        if (type2 === 'red') expectedRed++;
        if (type2 === 'blue') expectedBlue++;
        expect(state.gameState.redScore).toBe(expectedRed);
        expect(state.gameState.blueScore).toBe(expectedBlue);
    });

    test('restores turn from URL with t=b for blue', () => {
        setURL('?game=test-seed&t=b');
        state.activeWords = [...DEFAULT_WORDS];

        loadGameFromURL();

        expect(state.gameState.currentTurn).toBe('blue');
    });

    test('restores turn from URL with t=r for red', () => {
        setURL('?game=test-seed&t=r');
        state.activeWords = [...DEFAULT_WORDS];

        loadGameFromURL();

        expect(state.gameState.currentTurn).toBe('red');
    });

    test('loads team names from URL', () => {
        setURL('?game=test-seed&rn=FireTeam&bn=IceTeam');
        state.activeWords = [...DEFAULT_WORDS];

        loadGameFromURL();

        expect(state.teamNames.red).toBe('FireTeam');
        expect(state.teamNames.blue).toBe('IceTeam');
    });

    test('sanitizes team names by stripping special characters', () => {
        setURL('?game=test-seed&rn=Fire%3CScript%3E&bn=Ice%26Squad');
        state.activeWords = [...DEFAULT_WORDS];

        loadGameFromURL();

        // <Script> characters stripped; & stripped
        expect(state.teamNames.red).toBe('FireScript');
        expect(state.teamNames.blue).toBe('IceSquad');
    });

    test('sanitizes team names to max 32 characters', () => {
        const longName = 'A'.repeat(50);
        setURL(`?game=test-seed&rn=${longName}`);
        state.activeWords = [...DEFAULT_WORDS];

        loadGameFromURL();

        expect(state.teamNames.red.length).toBeLessThanOrEqual(32);
    });

    test('falls back to default team name when sanitized name is empty', () => {
        // Name with only special characters that get stripped
        setURL('?game=test-seed&rn=%3C%3E%26%23');
        state.activeWords = [...DEFAULT_WORDS];

        loadGameFromURL();

        expect(state.teamNames.red).toBe('Red Team');
    });

    test('falls back to default on malformed URL encoding for team names', () => {
        setURL('?game=test-seed&rn=%E0%A4%A');
        state.activeWords = [...DEFAULT_WORDS];

        loadGameFromURL();

        expect(state.teamNames.red).toBe('Red Team');
    });

    test('loads custom words from URL', () => {
        const customWords = SAMPLE_WORDS.slice(0, BOARD_SIZE);
        const encoded = encodeWordsForURL(customWords);
        setURL(`?game=test-seed&w=${encoded}`);
        state.activeWords = [...DEFAULT_WORDS];

        loadGameFromURL();

        expect(state.gameState.words).toEqual(customWords);
        expect(state.gameState.customWords).toBe(true);
    });

    test('falls back to default words when custom words decode fails', () => {
        setURL('?game=test-seed&w=invalid-base64!!!');
        state.activeWords = [...DEFAULT_WORDS];

        loadGameFromURL();

        // Should still initialize with DEFAULT_WORDS
        expect(state.gameState.seed).toBe('test-seed');
        expect(state.gameState.words.length).toBe(BOARD_SIZE);
    });

    test('falls back to newGame() when no seed parameter', () => {
        setURL('');
        state.activeWords = [...DEFAULT_WORDS];
        state.newGameDebounce = false;

        loadGameFromURL();

        // newGame() generates a random seed and sets up the board
        expect(state.gameState.words.length).toBe(BOARD_SIZE);
        expect(state.gameState.types.length).toBe(BOARD_SIZE);
        expect(state.gameState.seed).toBeTruthy();
        expect(renderBoard).toHaveBeenCalled();
    });

    test('sets player as non-host when loading from URL', () => {
        setURL('?game=test-seed');
        state.activeWords = [...DEFAULT_WORDS];

        loadGameFromURL();

        expect(state.isHost).toBe(false);
        expect(state.spymasterTeam).toBeNull();
        expect(state.clickerTeam).toBeNull();
        expect(state.playerTeam).toBeNull();
    });

    test('calls checkGameOver after restoring revealed cards', () => {
        // Set up URL where all red cards will be revealed (game over via URL)
        setURL('?game=test-seed&r=1111111111111111111111111');
        state.activeWords = [...DEFAULT_WORDS];

        loadGameFromURL();

        // With all cards revealed, the game should be over
        expect(state.gameState.gameOver).toBe(true);
        expect(state.gameState.winner).toBeTruthy();
    });

    test('shows game over modal when game loaded from URL is already over', () => {
        // Reveal all cards to trigger game over
        setURL('?game=test-seed&r=1111111111111111111111111');
        state.activeWords = [...DEFAULT_WORDS];

        loadGameFromURL();

        // showGameOverModal calls renderBoard
        expect(state.gameState.gameOver).toBe(true);
        // renderBoard is called at least once for the initial render and once more via showGameOverModal
        expect(renderBoard).toHaveBeenCalled();
    });

    test('custom words with wrong count falls back to default words', () => {
        // Encode only 10 words (not enough for BOARD_SIZE=25)
        const tooFewWords = SAMPLE_WORDS.slice(0, 10);
        const encoded = encodeWordsForURL(tooFewWords);
        setURL(`?game=test-seed&w=${encoded}`);
        state.activeWords = [...DEFAULT_WORDS];

        loadGameFromURL();

        // Should fall back to DEFAULT_WORDS since custom words count doesn't match
        expect(state.gameState.seed).toBe('test-seed');
        expect(state.gameState.words.length).toBe(BOARD_SIZE);
    });
});

// ========== END TURN ==========

describe('endTurn', () => {
    beforeEach(() => {
        state.gameState.currentTurn = 'red';
        state.gameState.gameOver = false;
        state.isMultiplayerMode = false;
        state.clickerTeam = 'red';
        state.teamNames = { red: 'Red', blue: 'Blue' };
        jest.clearAllMocks();
    });

    test('returns early with toast when game is over', () => {
        state.gameState.gameOver = true;

        endTurn();

        expect(showToast).toHaveBeenCalledWith(
            expect.stringContaining('game.gameOverStartNew'),
            'warning'
        );
        // Turn should not change
        expect(state.gameState.currentTurn).toBe('red');
    });

    test('returns early with toast when no clicker team set', () => {
        state.clickerTeam = null;

        endTurn();

        expect(showToast).toHaveBeenCalledWith(
            expect.stringContaining('game.onlyClickerCanEndTurn'),
            'warning'
        );
        expect(state.gameState.currentTurn).toBe('red');
    });

    test('returns early with toast when clicker is not on current team', () => {
        state.clickerTeam = 'blue';
        state.gameState.currentTurn = 'red';

        endTurn();

        expect(showToast).toHaveBeenCalledWith(
            expect.stringContaining('game.notYourTurn'),
            'warning'
        );
        expect(state.gameState.currentTurn).toBe('red');
    });

    test('switches turn from red to blue in standalone mode', () => {
        state.isMultiplayerMode = false;
        state.clickerTeam = 'red';
        state.gameState.currentTurn = 'red';

        endTurn();

        expect(state.gameState.currentTurn).toBe('blue');
        expect(updateURL).toHaveBeenCalled();
    });

    test('switches turn from blue to red in standalone mode', () => {
        state.isMultiplayerMode = false;
        state.clickerTeam = 'blue';
        state.gameState.currentTurn = 'blue';

        endTurn();

        expect(state.gameState.currentTurn).toBe('red');
    });

    test('announces turn change to screen reader', () => {
        state.isMultiplayerMode = false;
        state.clickerTeam = 'red';
        state.gameState.currentTurn = 'red';

        endTurn();

        expect(announceToScreenReader).toHaveBeenCalledWith(
            expect.stringContaining('game.turnEndedAnnounce')
        );
    });

    test('uses team name in turn change announcement', () => {
        state.isMultiplayerMode = false;
        state.clickerTeam = 'red';
        state.gameState.currentTurn = 'red';
        state.teamNames.blue = 'IceSquad';

        endTurn();

        // The t() mock replaces {{team}} in the key with the team name
        // t('game.turnEndedAnnounce', { team: 'IceSquad' }) -> key with {{team}} replaced
        expect(announceToScreenReader).toHaveBeenCalledTimes(1);
        // Verify endTurn switched to blue and called announceToScreenReader
        expect(state.gameState.currentTurn).toBe('blue');
    });
});

// ========== CONFIRM NEW GAME ==========

describe('confirmNewGame', () => {
    beforeEach(() => {
        state.gameState.revealed = Array(BOARD_SIZE).fill(false);
        state.activeWords = [...DEFAULT_WORDS];
        state.newGameDebounce = false;
        state.isMultiplayerMode = false;
        jest.clearAllMocks();
    });

    test('starts new game directly when no cards are revealed', () => {
        state.gameState.revealed = Array(BOARD_SIZE).fill(false);

        confirmNewGame();

        // newGame() was called, which sets up a new game
        expect(state.gameState.seed).toBeTruthy();
        expect(state.gameState.words.length).toBe(BOARD_SIZE);
        expect(renderBoard).toHaveBeenCalled();
    });

    test('opens confirm modal when cards are revealed', () => {
        state.gameState.revealed = Array(BOARD_SIZE).fill(false);
        state.gameState.revealed[0] = true; // At least one card revealed

        confirmNewGame();

        expect(openModal).toHaveBeenCalledWith('confirm-modal');
    });

    test('does not open modal when no cards revealed', () => {
        state.gameState.revealed = Array(BOARD_SIZE).fill(false);

        confirmNewGame();

        expect(openModal).not.toHaveBeenCalled();
    });
});

// ========== SHOW GAME OVER / CLOSE GAME OVER ==========

describe('showGameOverModal', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('calls renderBoard to reveal the full board', () => {
        showGameOverModal();

        expect(renderBoard).toHaveBeenCalled();
    });

    test('calls renderBoard with no arguments', () => {
        showGameOverModal();

        expect(renderBoard).toHaveBeenCalledWith();
    });
});

describe('closeGameOver', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('calls closeModal with game-over-modal id', () => {
        closeGameOver();

        expect(closeModal).toHaveBeenCalledWith('game-over-modal');
    });
});

// ========== TURN INDICATOR DUET MODE & ADDITIONAL BRANCHES ==========

describe('updateTurnIndicator duet mode branches', () => {
    beforeEach(() => {
        state.gameState.types = [
            'red', 'red', 'red', 'red', 'red',
            'red', 'red', 'red', 'red', 'blue',
            'blue', 'blue', 'blue', 'blue', 'blue',
            'blue', 'blue', 'neutral', 'neutral', 'neutral',
            'neutral', 'neutral', 'neutral', 'neutral', 'assassin',
        ];
        state.gameState.revealed = Array(BOARD_SIZE).fill(false);
        jest.clearAllMocks();
    });

    test('shows duet victory when winner exists in duet mode', () => {
        state.gameMode = 'duet';
        state.gameState.gameOver = true;
        state.gameState.winner = 'red';

        updateTurnIndicator();

        const indicator = document.getElementById('turn-indicator')!;
        const turnText = indicator.querySelector('.turn-text')!;
        expect(indicator.className).toContain('game-over');
        expect(turnText.textContent).toBe('game.duetVictory');
    });

    test('shows duet game over assassin when assassin is revealed', () => {
        state.gameMode = 'duet';
        state.gameState.gameOver = true;
        state.gameState.winner = null;
        state.gameState.revealed[24] = true; // assassin at index 24

        updateTurnIndicator();

        const turnText = document.getElementById('turn-indicator')!.querySelector('.turn-text')!;
        expect(turnText.textContent).toBe('game.duetGameOverAssassin');
    });

    test('shows duet game over timeout (no winner, no assassin revealed)', () => {
        state.gameMode = 'duet';
        state.gameState.gameOver = true;
        state.gameState.winner = null;
        // assassin not revealed

        updateTurnIndicator();

        const turnText = document.getElementById('turn-indicator')!.querySelector('.turn-text')!;
        expect(turnText.textContent).toBe('game.duetGameOverTimeout');
    });

    test('shows winner assassin message in classic mode when assassin revealed', () => {
        state.gameMode = 'classic';
        state.gameState.gameOver = true;
        state.gameState.winner = 'blue';
        state.gameState.currentTurn = 'red';
        state.gameState.revealed[24] = true; // assassin at index 24

        updateTurnIndicator();

        const indicator = document.getElementById('turn-indicator')!;
        const turnText = indicator.querySelector('.turn-text')!;
        expect(indicator.className).toContain('game-over');
        // t('game.winnerAssassin', { team: 'Blue' }) returns the interpolated key
        expect(turnText.textContent).toContain('game.winnerAssassin');
    });

    test('shows standard winner message in classic mode when no assassin', () => {
        state.gameMode = 'classic';
        state.gameState.gameOver = true;
        state.gameState.winner = 'red';
        state.teamNames.red = 'FireTeam';

        updateTurnIndicator();

        const indicator = document.getElementById('turn-indicator')!;
        const turnText = indicator.querySelector('.turn-text')!;
        expect(indicator.className).toContain('game-over');
        // t('game.winner', { team: 'FireTeam' }) returns the interpolated key
        expect(turnText.textContent).toContain('game.winner');
        // The key itself does not contain 'Assassin' - that differentiates it
        expect(turnText.textContent).not.toContain('Assassin');
    });

    test('shows your-turn text when clicker matches current team', () => {
        state.gameMode = 'classic';
        state.gameState.gameOver = false;
        state.gameState.currentTurn = 'blue';
        state.clickerTeam = 'blue';
        state.teamNames.blue = 'IceSquad';

        updateTurnIndicator();

        const indicator = document.getElementById('turn-indicator')!;
        const turnText = indicator.querySelector('.turn-text')!;
        expect(indicator.className).toContain('your-turn');
        expect(indicator.className).toContain('blue-turn');
        expect(turnText.textContent).toContain('game.yourTurnGo');
    });

    test('shows generic team turn when clicker does not match', () => {
        state.gameMode = 'classic';
        state.gameState.gameOver = false;
        state.gameState.currentTurn = 'red';
        state.clickerTeam = 'blue';
        state.teamNames.red = 'FireTeam';

        updateTurnIndicator();

        const indicator = document.getElementById('turn-indicator')!;
        const turnText = indicator.querySelector('.turn-text')!;
        expect(indicator.className).not.toContain('your-turn');
        expect(indicator.className).toContain('red-turn');
        expect(turnText.textContent).toContain('game.teamsTurn');
    });
});
