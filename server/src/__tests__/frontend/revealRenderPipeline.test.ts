/**
 * Integration tests for the reveal → render pipeline.
 *
 * Tests the full flow: revealCardFromServer → state mutation → updateSingleCard + updateBoardIncremental
 * Focuses on scenarios that previously caused miscolored/unclickable cards:
 * - Non-spymaster with null types receiving server type on reveal
 * - Type class correction on already-revealed cards
 * - Concurrent renders seeing consistent state
 */

jest.mock('../../frontend/i18n', () => {
    const translations: Record<string, string> = {
        'board.gridPosition': 'Row {{row}}, column {{col}}',
        'board.assassinCard': 'assassin card',
        'board.teamCard': '{{type}} team card',
        'board.revealedCardLabel': '{{word}}, revealed as {{typeLabel}}. {{position}}',
        'board.unrevealedCardLabel': '{{word}}, unrevealed card. {{position}}. Press Enter to reveal.',
        'board.neutralCard': 'neutral card',
        'board.boardAriaLabel': 'Game board',
        'board.renderError': 'Board render error',
        'game.wordRevealedAs': '{{word}} revealed as {{type}}',
    };
    return {
        t: (key: string, params: Record<string, string | number> = {}): string => {
            const template = translations[key];
            if (!template) return key;
            return template.replace(/\{\{(\w+)\}\}/g, (_: string, name: string) =>
                params[name] !== undefined ? String(params[name]) : `{{${name}}}`
            );
        },
        initI18n: async () => {},
        setLanguage: async () => {},
        getLanguage: () => 'en',
        translatePage: () => {},
        getLocalizedWordList: async () => null,
        LANGUAGES: { en: { name: 'English', flag: 'EN' } },
        DEFAULT_LANGUAGE: 'en',
    };
});

import { renderBoard, updateBoardIncremental, updateSingleCard } from '../../frontend/board';
import { revealCardFromServer } from '../../frontend/game/reveal';
import { state, BOARD_SIZE } from '../../frontend/state';
import { getCardFontClass } from '../../frontend/utils';

const SAMPLE_WORDS: string[] = [
    'AFRICA',
    'AGENT',
    'AIR',
    'ALIEN',
    'ALPS',
    'AMAZON',
    'AMBULANCE',
    'AMERICA',
    'ANGEL',
    'ANTARCTICA',
    'APPLE',
    'ARM',
    'ATLANTIS',
    'AUSTRALIA',
    'AZTEC',
    'BACK',
    'BALL',
    'BAND',
    'BANK',
    'BAR',
    'BARK',
    'BAT',
    'BATTERY',
    'BEACH',
    'BEAR',
];

function resetState(): void {
    state.cachedElements.board = null;
    state.boardInitialized = false;
    state.isMultiplayerMode = false;
    state.multiplayerPlayers = [];
    state.spymasterTeam = null;
    state.clickerTeam = null;
    state.playerTeam = null;
    state.lastRevealedIndex = -1;
    state.lastRevealedWasCorrect = false;
    state.pendingRevealRAF = null;
    state.revealingCards = new Set();
    state.revealTimeouts = new Map();
    state.revealTimestamps = new Map();
    state.isRevealingCard = false;
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
    state.gameState.currentClue = null;
    state.gameState.guessesUsed = 0;
    state.gameState.guessesAllowed = 0;
    state.gameState.cardScores = [];
    state.gameState.revealedBy = [];
}

/**
 * Set up as non-spymaster: types array has null for unrevealed cards.
 */
function setupNonSpymasterState(): void {
    state.gameState.words = [...SAMPLE_WORDS];
    // Non-spymasters get null for unrevealed cards
    state.gameState.types = new Array(BOARD_SIZE).fill(null);
    state.gameState.revealed = new Array(BOARD_SIZE).fill(false);
    state.gameState.currentTurn = 'red';
    state.gameState.redScore = 0;
    state.gameState.blueScore = 0;
    state.gameState.redTotal = 9;
    state.gameState.blueTotal = 8;
    state.gameState.gameOver = false;
    state.gameState.winner = null;
}

function createTestBoard(): HTMLDivElement {
    const board = document.createElement('div');
    board.id = 'board';
    board.className = 'board';

    SAMPLE_WORDS.forEach((word, index) => {
        const card = document.createElement('div');
        const fontClass = getCardFontClass(word);
        card.className = `card ${fontClass}`;
        card.textContent = word;
        card.dataset.word = word;
        card.setAttribute('data-index', String(index));
        card.setAttribute('role', 'gridcell');
        card.setAttribute('tabindex', '0');
        board.appendChild(card);
    });

    return board;
}

describe('reveal → render pipeline (integration)', () => {
    let boardEl: HTMLDivElement;

    beforeEach(() => {
        resetState();
        setupNonSpymasterState();
        document.body.innerHTML = '';
        boardEl = createTestBoard();
        document.body.appendChild(boardEl);
        state.cachedElements.board = boardEl;
        state.boardInitialized = true;

        // Mock requestAnimationFrame to run synchronously for testing
        jest.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
            cb(0);
            return 0;
        });
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('non-spymaster: card gets correct type class when server sends type on reveal', () => {
        // Non-spymaster has null types for unrevealed cards
        expect(state.gameState.types[0]).toBeNull();

        revealCardFromServer(0, {
            type: 'red',
            redScore: 1,
            blueScore: 0,
            currentTurn: 'red',
            guessesUsed: 1,
            guessesAllowed: 3,
        });

        const card = boardEl.children[0] as HTMLElement;
        expect(card.classList.contains('revealed')).toBe(true);
        expect(card.classList.contains('red')).toBe(true);
        expect(card.classList.contains('neutral')).toBe(false);
    });

    it('non-spymaster: blue card gets correct blue class', () => {
        revealCardFromServer(9, {
            type: 'blue',
            redScore: 0,
            blueScore: 1,
            currentTurn: 'red',
            guessesUsed: 1,
            guessesAllowed: 3,
            turnEnded: true,
        });

        const card = boardEl.children[9] as HTMLElement;
        expect(card.classList.contains('revealed')).toBe(true);
        expect(card.classList.contains('blue')).toBe(true);
    });

    it('non-spymaster: assassin card gets correct assassin class', () => {
        revealCardFromServer(24, {
            type: 'assassin',
            redScore: 0,
            blueScore: 0,
            currentTurn: 'red',
            gameOver: true,
            winner: 'blue',
        });

        const card = boardEl.children[24] as HTMLElement;
        expect(card.classList.contains('revealed')).toBe(true);
        expect(card.classList.contains('assassin')).toBe(true);
    });

    it('corrects stale neutral type class on already-revealed card', () => {
        // Simulate a card that was incorrectly rendered as neutral
        const card = boardEl.children[3] as HTMLElement;
        card.classList.add('revealed', 'neutral');

        // Now the correct type arrives from server
        state.gameState.revealed[3] = true;
        state.gameState.types[3] = 'red';

        updateBoardIncremental();

        expect(card.classList.contains('red')).toBe(true);
        expect(card.classList.contains('neutral')).toBe(false);
    });

    it('corrects stale neutral class to blue on type update', () => {
        const card = boardEl.children[10] as HTMLElement;
        card.classList.add('revealed', 'neutral');

        state.gameState.revealed[10] = true;
        state.gameState.types[10] = 'blue';

        updateBoardIncremental();

        expect(card.classList.contains('blue')).toBe(true);
        expect(card.classList.contains('neutral')).toBe(false);
    });

    it('updateSingleCard cleans up stale type before adding correct one', () => {
        // Card already has a wrong type class
        const card = boardEl.children[5] as HTMLElement;
        card.classList.add('neutral');

        state.gameState.types[5] = 'red';
        updateSingleCard(5);

        expect(card.classList.contains('red')).toBe(true);
        expect(card.classList.contains('neutral')).toBe(false);
    });

    it('state is atomically updated (types before revealed)', () => {
        revealCardFromServer(2, {
            type: 'red',
            redScore: 1,
            blueScore: 0,
            currentTurn: 'red',
        });

        // After the call, both should be updated
        expect(state.gameState.types[2]).toBe('red');
        expect(state.gameState.revealed[2]).toBe(true);
    });

    it('multiple rapid reveals all get correct types', () => {
        revealCardFromServer(0, { type: 'red', redScore: 1, blueScore: 0, currentTurn: 'red' });
        revealCardFromServer(9, { type: 'blue', redScore: 1, blueScore: 1, currentTurn: 'blue', turnEnded: true });
        revealCardFromServer(17, { type: 'neutral', redScore: 1, blueScore: 1, currentTurn: 'red', turnEnded: true });

        expect((boardEl.children[0] as HTMLElement).classList.contains('red')).toBe(true);
        expect((boardEl.children[9] as HTMLElement).classList.contains('blue')).toBe(true);
        expect((boardEl.children[17] as HTMLElement).classList.contains('neutral')).toBe(true);
    });

    it('full renderBoard after reveal preserves correct type classes', () => {
        // Reveal a card first
        revealCardFromServer(0, { type: 'red', redScore: 1, blueScore: 0, currentTurn: 'red' });

        // Force a full re-render (new game scenario)
        state.boardInitialized = false;
        renderBoard();

        const card = boardEl.children[0] as HTMLElement;
        expect(card.classList.contains('revealed')).toBe(true);
        expect(card.classList.contains('red')).toBe(true);
    });

    it('card without server type falls back to neutral with existing types', () => {
        // Edge case: server doesn't send type (shouldn't happen but test the fallback)
        state.gameState.types[7] = null;
        revealCardFromServer(7, {
            redScore: 0,
            blueScore: 0,
            currentTurn: 'red',
        });

        const card = boardEl.children[7] as HTMLElement;
        expect(card.classList.contains('revealed')).toBe(true);
        // Falls back to 'neutral' since types[7] is null and no serverData.type
        expect(card.classList.contains('neutral')).toBe(true);
    });

    it('revealed card is not clickable via DOM class', () => {
        revealCardFromServer(0, { type: 'red', redScore: 1, blueScore: 0, currentTurn: 'red' });

        const card = boardEl.children[0] as HTMLElement;
        expect(card.classList.contains('revealed')).toBe(true);
        // The click delegation handler checks card.classList.contains('revealed')
        // to skip clicks on revealed cards
    });
});
