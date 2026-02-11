/**
 * Frontend Board Module Tests
 *
 * Tests the ACTUAL board rendering and interaction functions from src/frontend/board.ts.
 * No re-implementations — imports the real code directly.
 *
 * Test environment: jsdom (provides window, document, Element, etc.).
 */

import {
    canClickCards,
    renderBoard,
    updateBoardIncremental,
    updateSingleCard,
    navigateCards,
} from '../../frontend/board';
import { state, BOARD_SIZE } from '../../frontend/state';
import { getCardFontClass } from '../../frontend/utils';

// ==================== Test Helpers ====================

/**
 * Build expected ARIA label matching the real buildCardAriaLabel in board.ts.
 */
function expectedAriaLabel(word: string, isRevealed: boolean, type: string, index: number): string {
    const row = Math.floor(index / 5) + 1;
    const col = (index % 5) + 1;
    const position = `Row ${row}, column ${col}`;
    if (isRevealed) {
        const typeLabel = type === 'assassin' ? 'assassin card' : `${type} team card`;
        return `${word}, revealed as ${typeLabel}. ${position}`;
    }
    return `${word}, unrevealed card. ${position}. Press Enter to reveal.`;
}

/** Sample 25 words for a full board */
const SAMPLE_WORDS: string[] = [
    'AFRICA', 'AGENT', 'AIR', 'ALIEN', 'ALPS',
    'AMAZON', 'AMBULANCE', 'AMERICA', 'ANGEL', 'ANTARCTICA',
    'APPLE', 'ARM', 'ATLANTIS', 'AUSTRALIA', 'AZTEC',
    'BACK', 'BALL', 'BAND', 'BANK', 'BAR',
    'BARK', 'BAT', 'BATTERY', 'BEACH', 'BEAR',
];

/** Sample 25 types matching a standard game layout */
const SAMPLE_TYPES: string[] = [
    'red', 'red', 'red', 'red', 'red',
    'red', 'red', 'red', 'red', 'blue',
    'blue', 'blue', 'blue', 'blue', 'blue',
    'blue', 'blue', 'neutral', 'neutral', 'neutral',
    'neutral', 'neutral', 'neutral', 'neutral', 'assassin',
];

/** All cards unrevealed */
const ALL_UNREVEALED: boolean[] = new Array(BOARD_SIZE).fill(false);

/**
 * Creates a board DOM element with 25 child divs (simulating a pre-rendered board).
 * Used for testing incremental updates and single-card operations.
 */
function createTestBoard(
    words: string[] = SAMPLE_WORDS,
    types: string[] = SAMPLE_TYPES,
    revealed: boolean[] = ALL_UNREVEALED
): HTMLDivElement {
    const board = document.createElement('div');
    board.id = 'board';
    board.className = 'board';

    words.forEach((word, index) => {
        const card = document.createElement('div');
        const fontClass = getCardFontClass(word);
        card.className = `card ${fontClass}`;
        if (word.includes(' ')) {
            card.classList.add('multi-word');
        }
        card.textContent = word;
        card.setAttribute('data-index', String(index));
        card.setAttribute('role', 'gridcell');
        const isRevealed = revealed[index];
        card.setAttribute('tabindex', isRevealed ? '-1' : '0');
        card.setAttribute(
            'aria-label',
            expectedAriaLabel(word, isRevealed, types[index], index)
        );
        if (isRevealed) {
            card.classList.add('revealed', types[index]);
        }
        board.appendChild(card);
    });

    return board;
}

/** Reset state to defaults for test isolation */
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
}

/** Populate state with standard game data */
function setupGameState(overrides: Record<string, any> = {}): void {
    Object.assign(state.gameState, {
        words: [...SAMPLE_WORDS],
        types: [...SAMPLE_TYPES],
        revealed: [...ALL_UNREVEALED],
        currentTurn: 'red',
        redScore: 0,
        blueScore: 0,
        redTotal: 9,
        blueTotal: 8,
        gameOver: false,
        winner: null,
        seed: 12345,
        customWords: false,
        currentClue: null,
        guessesUsed: 0,
        ...overrides,
    });
}

// ==================== Tests ====================

describe('canClickCards()', () => {
    beforeEach(() => {
        resetState();
        setupGameState();
    });

    it('returns false when game is over', () => {
        state.gameState.gameOver = true;
        state.clickerTeam = 'red';
        state.gameState.currentTurn = 'red';
        expect(canClickCards()).toBe(false);
    });

    it('returns true when player is clicker for current team', () => {
        state.clickerTeam = 'red';
        state.gameState.currentTurn = 'red';
        expect(canClickCards()).toBe(true);
    });

    it('returns true when player is clicker for blue team on blue turn', () => {
        state.clickerTeam = 'blue';
        state.gameState.currentTurn = 'blue';
        expect(canClickCards()).toBe(true);
    });

    it('returns false when player is clicker for wrong team', () => {
        state.clickerTeam = 'blue';
        state.gameState.currentTurn = 'red';
        expect(canClickCards()).toBe(false);
    });

    it('returns false when player is on wrong team (not clicker)', () => {
        state.playerTeam = 'blue';
        state.gameState.currentTurn = 'red';
        state.isMultiplayerMode = true;
        expect(canClickCards()).toBe(false);
    });

    it('returns false when clickerTeam is null and not in multiplayer', () => {
        state.clickerTeam = null;
        state.isMultiplayerMode = false;
        expect(canClickCards()).toBe(false);
    });

    it('returns true in multiplayer when clicker is disconnected', () => {
        state.isMultiplayerMode = true;
        state.playerTeam = 'red';
        state.gameState.currentTurn = 'red';
        state.clickerTeam = null;
        state.multiplayerPlayers = [
            {
                sessionId: 'p1',
                nickname: 'Player1',
                team: 'red',
                role: 'clicker',
                connected: false,
            },
        ];
        expect(canClickCards()).toBe(true);
    });

    it('returns false in multiplayer when clicker is connected', () => {
        state.isMultiplayerMode = true;
        state.playerTeam = 'red';
        state.gameState.currentTurn = 'red';
        state.clickerTeam = null; // This player is not the clicker
        state.multiplayerPlayers = [
            {
                sessionId: 'p1',
                nickname: 'Player1',
                team: 'red',
                role: 'clicker',
                connected: true,
            },
        ];
        expect(canClickCards()).toBe(false);
    });

    it('returns true in multiplayer when no clicker is assigned to the team', () => {
        state.isMultiplayerMode = true;
        state.playerTeam = 'red';
        state.gameState.currentTurn = 'red';
        state.clickerTeam = null;
        state.multiplayerPlayers = [
            {
                sessionId: 'p1',
                nickname: 'Player1',
                team: 'red',
                role: 'spymaster',
                connected: true,
            },
        ];
        expect(canClickCards()).toBe(true);
    });

    it('returns true in multiplayer when players list is empty', () => {
        state.isMultiplayerMode = true;
        state.playerTeam = 'red';
        state.gameState.currentTurn = 'red';
        state.clickerTeam = null;
        state.multiplayerPlayers = [];
        expect(canClickCards()).toBe(true);
    });

    it('clicker role takes precedence over multiplayer fallback', () => {
        state.isMultiplayerMode = true;
        state.clickerTeam = 'red';
        state.playerTeam = 'red';
        state.gameState.currentTurn = 'red';
        state.multiplayerPlayers = [
            {
                sessionId: 'other',
                nickname: 'Other',
                team: 'red',
                role: 'clicker',
                connected: true,
            },
        ];
        // Even though there is a connected clicker, the current player IS the clicker
        expect(canClickCards()).toBe(true);
    });
});

describe('renderBoard()', () => {
    let boardEl: HTMLDivElement;

    beforeEach(() => {
        resetState();
        setupGameState();
        document.body.innerHTML = '';
        boardEl = document.createElement('div');
        boardEl.id = 'board';
        document.body.appendChild(boardEl);
        state.cachedElements.board = boardEl;
    });

    it('creates 25 card elements in the board', () => {
        renderBoard();
        expect(boardEl.children.length).toBe(25);
    });

    it('each card has data-index attribute', () => {
        renderBoard();
        for (let i = 0; i < 25; i++) {
            const card = boardEl.children[i] as HTMLElement;
            expect(card.getAttribute('data-index')).toBe(String(i));
        }
    });

    it('each card has role="gridcell" and tabindex', () => {
        renderBoard();
        for (let i = 0; i < 25; i++) {
            const card = boardEl.children[i] as HTMLElement;
            expect(card.getAttribute('role')).toBe('gridcell');
            expect(card.getAttribute('tabindex')).toBe('0');
        }
    });

    it('revealed cards have "revealed" class', () => {
        state.gameState.revealed[0] = true;
        state.gameState.revealed[5] = true;
        renderBoard();

        const card0 = boardEl.children[0] as HTMLElement;
        const card5 = boardEl.children[5] as HTMLElement;
        const card1 = boardEl.children[1] as HTMLElement;

        expect(card0.classList.contains('revealed')).toBe(true);
        expect(card5.classList.contains('revealed')).toBe(true);
        expect(card1.classList.contains('revealed')).toBe(false);
    });

    it('revealed cards have their type class', () => {
        state.gameState.revealed[0] = true; // type = 'red'
        state.gameState.revealed[9] = true; // type = 'blue'
        renderBoard();

        expect((boardEl.children[0] as HTMLElement).classList.contains('red')).toBe(true);
        expect((boardEl.children[9] as HTMLElement).classList.contains('blue')).toBe(true);
    });

    it('revealed cards have tabindex="-1"', () => {
        state.gameState.revealed[3] = true;
        renderBoard();
        expect((boardEl.children[3] as HTMLElement).getAttribute('tabindex')).toBe('-1');
    });

    it('revealed cards have descriptive aria-label', () => {
        state.gameState.revealed[0] = true;
        renderBoard();
        const label = (boardEl.children[0] as HTMLElement).getAttribute('aria-label');
        expect(label).toBe(expectedAriaLabel('AFRICA', true, 'red', 0));
    });

    it('unrevealed cards have descriptive aria-label', () => {
        renderBoard();
        const label = (boardEl.children[2] as HTMLElement).getAttribute('aria-label');
        expect(label).toBe(expectedAriaLabel('AIR', false, 'red', 2));
    });

    it('spymaster mode adds spy- classes to all cards', () => {
        state.spymasterTeam = 'red';
        renderBoard();
        for (let i = 0; i < 25; i++) {
            const card = boardEl.children[i] as HTMLElement;
            const type = state.gameState.types[i];
            expect(card.classList.contains(`spy-${type}`)).toBe(true);
        }
    });

    it('game over adds spy- classes to all cards', () => {
        state.gameState.gameOver = true;
        renderBoard();
        for (let i = 0; i < 25; i++) {
            const card = boardEl.children[i] as HTMLElement;
            const type = state.gameState.types[i];
            expect(card.classList.contains(`spy-${type}`)).toBe(true);
        }
    });

    it('does not add spy- classes when not spymaster and game not over', () => {
        state.spymasterTeam = null;
        state.gameState.gameOver = false;
        renderBoard();
        for (let i = 0; i < 25; i++) {
            const card = boardEl.children[i] as HTMLElement;
            expect(card.classList.contains('spy-red')).toBe(false);
            expect(card.classList.contains('spy-blue')).toBe(false);
            expect(card.classList.contains('spy-neutral')).toBe(false);
            expect(card.classList.contains('spy-assassin')).toBe(false);
        }
    });

    it('sets boardInitialized to true after render', () => {
        expect(state.boardInitialized).toBe(false);
        renderBoard();
        expect(state.boardInitialized).toBe(true);
    });

    it('uses incremental update when board is already initialized', () => {
        // First render - full
        renderBoard();
        expect(state.boardInitialized).toBe(true);
        expect(boardEl.children.length).toBe(25);

        // Reveal a card
        state.gameState.revealed[2] = true;

        // Second render should do incremental update (not clear innerHTML)
        const firstChild = boardEl.children[0];
        renderBoard();

        // The same DOM node should still be the first child (not re-created)
        expect(boardEl.children[0]).toBe(firstChild);
        // The revealed card should now have the revealed class
        expect((boardEl.children[2] as HTMLElement).classList.contains('revealed')).toBe(true);
    });

    it('sets board className with spymaster-mode when spymasterTeam is set', () => {
        state.spymasterTeam = 'red';
        renderBoard();
        expect(boardEl.className).toContain('spymaster-mode');
    });

    it('sets board className with no-click when cards cannot be clicked', () => {
        // No clickerTeam, not multiplayer mode, game not over
        state.clickerTeam = null;
        state.isMultiplayerMode = false;
        renderBoard();
        expect(boardEl.className).toContain('no-click');
    });

    it('does not set no-click when player can click', () => {
        state.clickerTeam = 'red';
        state.gameState.currentTurn = 'red';
        renderBoard();
        expect(boardEl.className).not.toContain('no-click');
    });

    it('each card has the correct word as textContent', () => {
        renderBoard();
        for (let i = 0; i < 25; i++) {
            expect(boardEl.children[i].textContent).toBe(SAMPLE_WORDS[i]);
        }
    });

    it('assigns correct font class based on word length', () => {
        renderBoard();
        for (let i = 0; i < 25; i++) {
            const card = boardEl.children[i] as HTMLElement;
            const expectedClass = getCardFontClass(SAMPLE_WORDS[i]);
            expect(card.classList.contains(expectedClass)).toBe(true);
        }
    });

    it('adds multi-word class for words containing spaces', () => {
        state.gameState.words[0] = 'ICE CREAM';
        renderBoard();
        expect((boardEl.children[0] as HTMLElement).classList.contains('multi-word')).toBe(true);
    });

    it('does not add multi-word class for single words', () => {
        renderBoard();
        // 'AFRICA' is a single word
        expect((boardEl.children[0] as HTMLElement).classList.contains('multi-word')).toBe(false);
    });

    it('does not render anything when board element is null', () => {
        state.cachedElements.board = null;
        document.body.innerHTML = ''; // remove the board element from DOM too
        renderBoard();
        // No crash, no board rendered
        expect(document.getElementById('board')).toBeNull();
    });
});

describe('updateBoardIncremental()', () => {
    let boardEl: HTMLDivElement;

    beforeEach(() => {
        resetState();
        setupGameState();
        document.body.innerHTML = '';
        boardEl = createTestBoard(SAMPLE_WORDS, SAMPLE_TYPES, [...ALL_UNREVEALED]);
        document.body.appendChild(boardEl);
        state.cachedElements.board = boardEl;
        state.boardInitialized = true;
    });

    it('updates revealed state without full re-render', () => {
        const firstChild = boardEl.children[0];
        state.gameState.revealed[3] = true;

        updateBoardIncremental();

        // Same DOM node should still exist (no innerHTML wipe)
        expect(boardEl.children[0]).toBe(firstChild);
        // Card 3 should now be revealed
        expect((boardEl.children[3] as HTMLElement).classList.contains('revealed')).toBe(true);
    });

    it('updates ARIA labels for revealed cards', () => {
        state.gameState.revealed[0] = true;
        updateBoardIncremental();

        const label = (boardEl.children[0] as HTMLElement).getAttribute('aria-label');
        expect(label).toBe(expectedAriaLabel('AFRICA', true, 'red', 0));
    });

    it('sets tabindex to -1 for revealed cards', () => {
        state.gameState.revealed[5] = true;
        updateBoardIncremental();

        expect((boardEl.children[5] as HTMLElement).getAttribute('tabindex')).toBe('-1');
    });

    it('keeps tabindex at 0 for unrevealed cards', () => {
        updateBoardIncremental();
        expect((boardEl.children[0] as HTMLElement).getAttribute('tabindex')).toBe('0');
    });

    it('adds success-reveal class for just-revealed correct card', () => {
        state.gameState.revealed[2] = true;
        state.lastRevealedIndex = 2;
        state.lastRevealedWasCorrect = true;

        updateBoardIncremental();

        expect((boardEl.children[2] as HTMLElement).classList.contains('success-reveal')).toBe(true);
        expect((boardEl.children[2] as HTMLElement).classList.contains('just-revealed')).toBe(false);
    });

    it('adds just-revealed class for just-revealed incorrect card', () => {
        state.gameState.revealed[2] = true;
        state.lastRevealedIndex = 2;
        state.lastRevealedWasCorrect = false;

        updateBoardIncremental();

        expect((boardEl.children[2] as HTMLElement).classList.contains('just-revealed')).toBe(true);
        expect((boardEl.children[2] as HTMLElement).classList.contains('success-reveal')).toBe(false);
    });

    it('does not add animation class to non-last-revealed cards', () => {
        state.gameState.revealed[0] = true;
        state.gameState.revealed[1] = true;
        state.lastRevealedIndex = 1;
        state.lastRevealedWasCorrect = true;

        updateBoardIncremental();

        // Card 0 is revealed but is not the lastRevealedIndex
        expect((boardEl.children[0] as HTMLElement).classList.contains('success-reveal')).toBe(false);
        expect((boardEl.children[0] as HTMLElement).classList.contains('just-revealed')).toBe(false);
        // Card 1 is the last revealed
        expect((boardEl.children[1] as HTMLElement).classList.contains('success-reveal')).toBe(true);
    });

    it('updates spymaster classes when spymasterTeam is set', () => {
        state.spymasterTeam = 'red';
        updateBoardIncremental();

        for (let i = 0; i < 25; i++) {
            const card = boardEl.children[i] as HTMLElement;
            const type = state.gameState.types[i];
            expect(card.classList.contains(`spy-${type}`)).toBe(true);
        }
    });

    it('removes spy- classes when not in spymaster mode', () => {
        // First add spy classes
        state.spymasterTeam = 'red';
        updateBoardIncremental();
        expect((boardEl.children[0] as HTMLElement).classList.contains('spy-red')).toBe(true);

        // Then remove spymaster mode
        state.spymasterTeam = null;
        state.gameState.gameOver = false;
        updateBoardIncremental();

        for (let i = 0; i < 25; i++) {
            const card = boardEl.children[i] as HTMLElement;
            expect(card.classList.contains('spy-red')).toBe(false);
            expect(card.classList.contains('spy-blue')).toBe(false);
            expect(card.classList.contains('spy-neutral')).toBe(false);
            expect(card.classList.contains('spy-assassin')).toBe(false);
        }
    });

    it('adds type class to revealed card', () => {
        state.gameState.revealed[9] = true; // type = 'blue'
        updateBoardIncremental();
        expect((boardEl.children[9] as HTMLElement).classList.contains('blue')).toBe(true);
    });

    it('does not re-reveal an already revealed card', () => {
        // Mark card as already revealed in DOM
        (boardEl.children[0] as HTMLElement).classList.add('revealed', 'red');
        state.gameState.revealed[0] = true;
        state.lastRevealedIndex = 0;
        state.lastRevealedWasCorrect = true;

        updateBoardIncremental();

        // The card already had 'revealed', so the animation class should NOT be added
        expect((boardEl.children[0] as HTMLElement).classList.contains('success-reveal')).toBe(false);
    });

    it('updates board className', () => {
        state.spymasterTeam = 'red';
        updateBoardIncremental();
        expect(boardEl.className).toContain('spymaster-mode');
    });

    it('updates card text if word changed', () => {
        state.gameState.words[0] = 'NEWWORD';
        updateBoardIncremental();
        expect(boardEl.children[0].textContent).toBe('NEWWORD');
    });
});

describe('updateSingleCard(index)', () => {
    let boardEl: HTMLDivElement;

    beforeEach(() => {
        resetState();
        setupGameState();
        document.body.innerHTML = '';
        boardEl = createTestBoard(SAMPLE_WORDS, SAMPLE_TYPES, [...ALL_UNREVEALED]);
        document.body.appendChild(boardEl);
        state.cachedElements.board = boardEl;
    });

    it('adds "revealed" class and type class', () => {
        updateSingleCard(0);
        const card = boardEl.children[0] as HTMLElement;
        expect(card.classList.contains('revealed')).toBe(true);
        expect(card.classList.contains('red')).toBe(true);
    });

    it('adds correct type class for blue card', () => {
        updateSingleCard(9); // type = 'blue'
        const card = boardEl.children[9] as HTMLElement;
        expect(card.classList.contains('revealed')).toBe(true);
        expect(card.classList.contains('blue')).toBe(true);
    });

    it('adds correct type class for neutral card', () => {
        updateSingleCard(17); // type = 'neutral'
        const card = boardEl.children[17] as HTMLElement;
        expect(card.classList.contains('neutral')).toBe(true);
    });

    it('adds correct type class for assassin card', () => {
        updateSingleCard(24); // type = 'assassin'
        const card = boardEl.children[24] as HTMLElement;
        expect(card.classList.contains('assassin')).toBe(true);
    });

    it('sets tabindex to -1', () => {
        updateSingleCard(5);
        const card = boardEl.children[5] as HTMLElement;
        expect(card.getAttribute('tabindex')).toBe('-1');
    });

    it('updates aria-label with revealed info', () => {
        updateSingleCard(0);
        const card = boardEl.children[0] as HTMLElement;
        expect(card.getAttribute('aria-label')).toBe('AFRICA, revealed as red');
    });

    it('adds success-reveal class when lastRevealedWasCorrect is true', () => {
        state.lastRevealedWasCorrect = true;
        updateSingleCard(3);
        const card = boardEl.children[3] as HTMLElement;
        expect(card.classList.contains('success-reveal')).toBe(true);
        expect(card.classList.contains('just-revealed')).toBe(false);
    });

    it('adds just-revealed class when lastRevealedWasCorrect is false', () => {
        state.lastRevealedWasCorrect = false;
        updateSingleCard(3);
        const card = boardEl.children[3] as HTMLElement;
        expect(card.classList.contains('just-revealed')).toBe(true);
        expect(card.classList.contains('success-reveal')).toBe(false);
    });

    it('does nothing when board is null', () => {
        state.cachedElements.board = null;
        document.body.innerHTML = '';
        // Should not throw
        expect(() => updateSingleCard(0)).not.toThrow();
    });

    it('does nothing when index is out of bounds', () => {
        expect(() => updateSingleCard(99)).not.toThrow();
    });
});

describe('navigateCards(currentIndex, key)', () => {
    let boardEl: HTMLDivElement;

    beforeEach(() => {
        resetState();
        setupGameState();
        document.body.innerHTML = '';
        boardEl = createTestBoard();
        document.body.appendChild(boardEl);
        state.cachedElements.board = boardEl;

        // Add focus() spy to each card
        for (let i = 0; i < boardEl.children.length; i++) {
            jest.spyOn(boardEl.children[i] as HTMLElement, 'focus');
        }
    });

    it('ArrowRight moves to next card', () => {
        navigateCards(0, 'ArrowRight');
        expect((boardEl.children[1] as HTMLElement).focus).toHaveBeenCalled();
    });

    it('ArrowLeft moves to previous card', () => {
        navigateCards(1, 'ArrowLeft');
        expect((boardEl.children[0] as HTMLElement).focus).toHaveBeenCalled();
    });

    it('ArrowUp moves up one row (5 columns)', () => {
        navigateCards(7, 'ArrowUp'); // row 1, col 2 -> row 0, col 2 = index 2
        expect((boardEl.children[2] as HTMLElement).focus).toHaveBeenCalled();
    });

    it('ArrowDown moves down one row', () => {
        navigateCards(2, 'ArrowDown'); // row 0, col 2 -> row 1, col 2 = index 7
        expect((boardEl.children[7] as HTMLElement).focus).toHaveBeenCalled();
    });

    it('ArrowLeft at index 0 wraps to last card', () => {
        navigateCards(0, 'ArrowLeft');
        expect((boardEl.children[24] as HTMLElement).focus).toHaveBeenCalled();
    });

    it('ArrowRight at last index wraps to first card', () => {
        navigateCards(24, 'ArrowRight');
        expect((boardEl.children[0] as HTMLElement).focus).toHaveBeenCalled();
    });

    it('ArrowUp at row 0 wraps to bottom of same column', () => {
        navigateCards(2, 'ArrowUp'); // row 0, col 2 -> row 4, col 2 = index 22
        expect((boardEl.children[22] as HTMLElement).focus).toHaveBeenCalled();
    });

    it('ArrowDown at last row wraps to top of same column', () => {
        navigateCards(22, 'ArrowDown'); // row 4, col 2 -> row 0, col 2 = index 2
        expect((boardEl.children[2] as HTMLElement).focus).toHaveBeenCalled();
    });

    it('ArrowRight at end of row continues to next row', () => {
        navigateCards(9, 'ArrowRight'); // row 1, col 4 -> index 10
        expect((boardEl.children[10] as HTMLElement).focus).toHaveBeenCalled();
    });

    it('ArrowLeft at start of row continues to previous row', () => {
        navigateCards(10, 'ArrowLeft'); // row 2, col 0 -> index 9
        expect((boardEl.children[9] as HTMLElement).focus).toHaveBeenCalled();
    });

    it('navigates correctly from center of board', () => {
        // Index 12 = row 2, col 2 (center)
        navigateCards(12, 'ArrowUp');
        expect((boardEl.children[7] as HTMLElement).focus).toHaveBeenCalled();
    });

    it('navigates from last card left', () => {
        navigateCards(24, 'ArrowLeft'); // row 4, col 4 -> index 23
        expect((boardEl.children[23] as HTMLElement).focus).toHaveBeenCalled();
    });

    it('navigates from last card up', () => {
        navigateCards(24, 'ArrowUp'); // row 4, col 4 -> row 3, col 4 = index 19
        expect((boardEl.children[19] as HTMLElement).focus).toHaveBeenCalled();
    });

    it('does nothing for unrecognized keys', () => {
        navigateCards(12, 'Enter');
        for (let i = 0; i < 25; i++) {
            expect((boardEl.children[i] as HTMLElement).focus).not.toHaveBeenCalled();
        }
    });
});
