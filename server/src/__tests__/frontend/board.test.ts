/**
 * Frontend Board Module Tests
 *
 * Tests for board rendering and interaction functions from
 * server/public/js/modules/board.js.
 *
 * Since the source is a plain ES module not directly importable in Jest/ts-jest,
 * each function is re-implemented here (matching the source exactly) for testing.
 *
 * Test environment: jsdom (provides window, document, Element, etc.).
 */

// ==================== Constants ====================

const BOARD_SIZE = 25;

// ==================== Re-implemented utility from utils.js ====================

function getCardFontClass(word: string): string {
    const len = word.length;
    if (len <= 8) return 'font-lg';
    if (len <= 11) return 'font-md';
    if (len <= 14) return 'font-sm';
    if (len <= 17) return 'font-xs';
    return 'font-min';
}

// fitCardText is a no-op stub since jsdom does not support layout measurements.
// The real function uses requestAnimationFrame + scrollWidth/clientWidth.
function fitCardText(_board: HTMLElement): void {
    // no-op in test environment
}

// ==================== State (mirrors state.js) ====================

interface MultiplayerPlayer {
    sessionId: string;
    nickname: string;
    team: string;
    role: string;
    connected: boolean;
}

interface GameState {
    words: string[];
    types: string[];
    revealed: boolean[];
    currentTurn: string;
    redScore: number;
    blueScore: number;
    redTotal: number;
    blueTotal: number;
    gameOver: boolean;
    winner: string | null;
    seed: number | null;
    customWords: boolean;
    currentClue: string | null;
    guessesUsed: number;
}

interface State {
    cachedElements: {
        board: HTMLElement | null;
    };
    boardInitialized: boolean;
    isMultiplayerMode: boolean;
    multiplayerPlayers: MultiplayerPlayer[];
    spymasterTeam: string | null;
    clickerTeam: string | null;
    playerTeam: string | null;
    gameState: GameState;
    lastRevealedIndex: number;
    lastRevealedWasCorrect: boolean;
}

function createState(): State {
    return {
        cachedElements: {
            board: null,
        },
        boardInitialized: false,
        isMultiplayerMode: false,
        multiplayerPlayers: [],
        spymasterTeam: null,
        clickerTeam: null,
        playerTeam: null,
        gameState: {
            words: [],
            types: [],
            revealed: [],
            currentTurn: 'red',
            redScore: 0,
            blueScore: 0,
            redTotal: 9,
            blueTotal: 8,
            gameOver: false,
            winner: null,
            seed: null,
            customWords: false,
            currentClue: null,
            guessesUsed: 0,
        },
        lastRevealedIndex: -1,
        lastRevealedWasCorrect: false,
    };
}

// Module-level state used by all re-implemented functions
let state: State;

// ==================== Re-implemented board functions ====================

function canClickCards(): boolean {
    if (state.gameState.gameOver) return false;

    // Clicker for the current team can always click
    if (state.clickerTeam && state.clickerTeam === state.gameState.currentTurn) {
        return true;
    }

    // In multiplayer: any team member can click if clicker is disconnected
    if (state.isMultiplayerMode && state.playerTeam === state.gameState.currentTurn) {
        const teamClicker = state.multiplayerPlayers.find(
            (p) => p.team === state.gameState.currentTurn && p.role === 'clicker'
        );
        // Allow if no clicker assigned or clicker is disconnected
        if (!teamClicker || !teamClicker.connected) {
            return true;
        }
    }

    return false;
}

let cardClickHandler: ((index: number) => void) | null = null;

function _setCardClickHandler(fn: ((index: number) => void) | null): void {
    cardClickHandler = fn;
}

function initBoardEventDelegation(): void {
    const board = state.cachedElements.board || document.getElementById('board');
    if (!board || board.hasAttribute('data-delegated')) return;

    board.addEventListener('click', (e: Event) => {
        const target = e.target as HTMLElement;
        const card = target.closest('.card') as HTMLElement | null;
        if (!card || card.classList.contains('revealed')) return;
        const index = parseInt(card.dataset.index || '', 10);
        if (!isNaN(index) && index >= 0 && cardClickHandler) cardClickHandler(index);
    });

    board.addEventListener('keydown', (e: Event) => {
        const keyEvent = e as KeyboardEvent;
        const target = keyEvent.target as HTMLElement;
        const card = target.closest('.card') as HTMLElement | null;
        if (!card) return;
        const index = parseInt(card.dataset.index || '', 10);
        if (isNaN(index) || index < 0) return;

        if (keyEvent.key === 'Enter' || keyEvent.key === ' ') {
            keyEvent.preventDefault();
            if (!card.classList.contains('revealed')) {
                if (cardClickHandler) cardClickHandler(index);
            }
        } else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(keyEvent.key)) {
            keyEvent.preventDefault();
            navigateCards(index, keyEvent.key);
        }
    });

    board.setAttribute('data-delegated', 'true');
}

function renderBoard(): void {
    const board = state.cachedElements.board || document.getElementById('board');
    if (!board) return;

    // Update board class
    let className = 'board';
    if (state.spymasterTeam || state.gameState.gameOver) className += ' spymaster-mode';
    if (!canClickCards()) className += ' no-click';
    board.className = className;

    // Check if we can do an incremental update
    if (state.boardInitialized && board.children.length === BOARD_SIZE) {
        updateBoardIncremental();
        return;
    }

    // Full re-render (only for new games)
    board.innerHTML = '';

    state.gameState.words.forEach((word, index) => {
        const card = document.createElement('div');
        const fontClass = getCardFontClass(word);
        card.className = `card ${fontClass}`;
        if (word.includes(' ')) {
            card.classList.add('multi-word');
        }
        card.textContent = word;
        card.setAttribute('data-index', String(index));

        // Accessibility: make cards focusable and add ARIA attributes
        const isRevealed = state.gameState.revealed[index];
        card.setAttribute('role', 'gridcell');
        card.setAttribute('tabindex', isRevealed ? '-1' : '0');
        card.setAttribute(
            'aria-label',
            `${word}${isRevealed ? ', revealed as ' + state.gameState.types[index] : ''}`
        );

        // Add spymaster hints (show all card types when game is over)
        if (state.spymasterTeam || state.gameState.gameOver) {
            card.classList.add(`spy-${state.gameState.types[index]}`);
        }

        // Show revealed cards
        if (isRevealed) {
            card.classList.add('revealed', state.gameState.types[index]);
        }

        board.appendChild(card);
    });

    // Shrink font on any single-word cards that overflow their container
    fitCardText(board);

    state.boardInitialized = true;
    initBoardEventDelegation();
}

function updateBoardIncremental(): void {
    const board = state.cachedElements.board || document.getElementById('board');
    if (!board) return;

    // Update board class
    let className = 'board';
    if (state.spymasterTeam || state.gameState.gameOver) className += ' spymaster-mode';
    if (!canClickCards()) className += ' no-click';
    board.className = className;

    const cards = board.children;
    for (let index = 0; index < cards.length; index++) {
        const card = cards[index] as HTMLElement;
        const isRevealed = state.gameState.revealed[index];
        const type = state.gameState.types[index];
        const word = state.gameState.words[index];

        // Update card text if it changed
        if (card.textContent !== word) {
            card.textContent = word;
            card.classList.remove('font-lg', 'font-md', 'font-sm', 'font-xs', 'font-min');
            card.style.fontSize = '';
            const fontClass = getCardFontClass(word);
            if (fontClass) card.classList.add(fontClass);
            if (word.includes(' ')) {
                card.classList.add('multi-word');
            } else {
                card.classList.remove('multi-word');
            }
        }

        // Update ARIA
        card.setAttribute('tabindex', isRevealed ? '-1' : '0');
        card.setAttribute('aria-label', `${word}${isRevealed ? ', revealed as ' + type : ''}`);

        // Handle spymaster mode
        if (state.spymasterTeam || state.gameState.gameOver) {
            card.classList.add(`spy-${type}`);
        } else {
            card.classList.remove('spy-red', 'spy-blue', 'spy-neutral', 'spy-assassin');
        }

        // Handle reveal state
        if (isRevealed && !card.classList.contains('revealed')) {
            card.classList.add('revealed', type);

            // Add animation class for just-revealed card
            if (index === state.lastRevealedIndex) {
                if (state.lastRevealedWasCorrect) {
                    card.classList.add('success-reveal');
                } else {
                    card.classList.add('just-revealed');
                }
            }
        }
    }
}

function updateSingleCard(index: number): void {
    const board = state.cachedElements.board || document.getElementById('board');
    if (!board || !board.children[index]) return;

    const card = board.children[index] as HTMLElement;
    const type = state.gameState.types[index];

    card.classList.add('revealed', type);
    card.setAttribute('tabindex', '-1');
    card.setAttribute('aria-label', `${state.gameState.words[index]}, revealed as ${type}`);

    // Add animation class
    if (state.lastRevealedWasCorrect) {
        card.classList.add('success-reveal');
    } else {
        card.classList.add('just-revealed');
    }
}

function navigateCards(currentIndex: number, key: string): void {
    const COLS = 5;
    const ROWS = 5;
    const row = Math.floor(currentIndex / COLS);
    const col = currentIndex % COLS;

    let newIndex = currentIndex;

    switch (key) {
        case 'ArrowUp':
            newIndex = row > 0 ? currentIndex - COLS : currentIndex;
            break;
        case 'ArrowDown':
            newIndex = row < ROWS - 1 ? currentIndex + COLS : currentIndex;
            break;
        case 'ArrowLeft':
            newIndex = col > 0 ? currentIndex - 1 : currentIndex;
            break;
        case 'ArrowRight':
            newIndex = col < COLS - 1 ? currentIndex + 1 : currentIndex;
            break;
    }

    if (newIndex !== currentIndex) {
        const board = state.cachedElements.board || document.getElementById('board');
        if (board && board.children[newIndex]) {
            (board.children[newIndex] as HTMLElement).focus();
        }
    }
}

// ==================== Test Helpers ====================

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
 * Creates a board DOM element with 25 child divs (simulating a rendered board).
 * Each child has data-index, role, tabindex, aria-label, class, and textContent.
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
            `${word}${isRevealed ? ', revealed as ' + types[index] : ''}`
        );
        if (isRevealed) {
            card.classList.add('revealed', types[index]);
        }
        board.appendChild(card);
    });

    return board;
}

/**
 * Populate state with standard game data.
 */
function setupGameState(overrides: Partial<GameState> = {}): void {
    state.gameState = {
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
    };
}

// ==================== Tests ====================

describe('canClickCards()', () => {
    beforeEach(() => {
        state = createState();
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
        state = createState();
        setupGameState();
        cardClickHandler = null;
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

    it('revealed cards have updated aria-label', () => {
        state.gameState.revealed[0] = true;
        renderBoard();
        const label = (boardEl.children[0] as HTMLElement).getAttribute('aria-label');
        expect(label).toBe('AFRICA, revealed as red');
    });

    it('unrevealed cards have word-only aria-label', () => {
        renderBoard();
        const label = (boardEl.children[2] as HTMLElement).getAttribute('aria-label');
        expect(label).toBe('AIR');
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
        state = createState();
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
        expect(label).toBe('AFRICA, revealed as red');
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
        state = createState();
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
        state = createState();
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

    it('does not go out of bounds - ArrowLeft at column 0', () => {
        navigateCards(0, 'ArrowLeft');
        // No card should be focused (index stays the same, so focus is not called)
        for (let i = 0; i < 25; i++) {
            expect((boardEl.children[i] as HTMLElement).focus).not.toHaveBeenCalled();
        }
    });

    it('does not go out of bounds - ArrowRight at column 4', () => {
        navigateCards(4, 'ArrowRight');
        for (let i = 0; i < 25; i++) {
            expect((boardEl.children[i] as HTMLElement).focus).not.toHaveBeenCalled();
        }
    });

    it('does not go out of bounds - ArrowUp at row 0', () => {
        navigateCards(2, 'ArrowUp');
        for (let i = 0; i < 25; i++) {
            expect((boardEl.children[i] as HTMLElement).focus).not.toHaveBeenCalled();
        }
    });

    it('does not go out of bounds - ArrowDown at row 4', () => {
        navigateCards(22, 'ArrowDown');
        for (let i = 0; i < 25; i++) {
            expect((boardEl.children[i] as HTMLElement).focus).not.toHaveBeenCalled();
        }
    });

    it('ArrowRight at end of row does not wrap to next row', () => {
        navigateCards(9, 'ArrowRight'); // index 9 = row 1, col 4 (rightmost)
        for (let i = 0; i < 25; i++) {
            expect((boardEl.children[i] as HTMLElement).focus).not.toHaveBeenCalled();
        }
    });

    it('ArrowLeft at start of row does not wrap to previous row', () => {
        navigateCards(10, 'ArrowLeft'); // index 10 = row 2, col 0 (leftmost)
        for (let i = 0; i < 25; i++) {
            expect((boardEl.children[i] as HTMLElement).focus).not.toHaveBeenCalled();
        }
    });

    it('navigates correctly from center of board', () => {
        // Index 12 = row 2, col 2 (center)
        navigateCards(12, 'ArrowUp');
        expect((boardEl.children[7] as HTMLElement).focus).toHaveBeenCalled();
    });

    it('navigates from last card (index 24)', () => {
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

describe('getCardFontClass(word) - sanity check', () => {
    it('returns font-lg for short words (<=8 chars)', () => {
        expect(getCardFontClass('SPY')).toBe('font-lg');
        expect(getCardFontClass('CODENAME')).toBe('font-lg');
    });

    it('returns font-md for medium words (9-11 chars)', () => {
        expect(getCardFontClass('AMBULANCE')).toBe('font-md');
    });

    it('returns font-sm for long words (12-14 chars)', () => {
        expect(getCardFontClass('INTERNATIONAL')).toBe('font-sm');
    });

    it('returns font-xs for very long words (15-17 chars)', () => {
        expect(getCardFontClass('EXTRAORDINARILY')).toBe('font-xs');
    });

    it('returns font-min for extremely long words (>17 chars)', () => {
        expect(getCardFontClass('SUPERCALIFRAGILISTIC')).toBe('font-min');
    });

    it('handles empty string', () => {
        expect(getCardFontClass('')).toBe('font-lg');
    });
});
