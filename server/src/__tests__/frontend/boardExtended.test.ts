/**
 * Board Module Extended Tests
 *
 * Tests resize listener management and match mode score badges.
 * Core renderBoard tests (card count, types, spymaster mode, ARIA) are in board.test.ts.
 */

jest.mock('../../frontend/i18n', () => ({
    t: (key: string, params?: Record<string, unknown>) => {
        if (key === 'board.gridPosition') return `row ${params?.row}, col ${params?.col}`;
        if (key === 'board.revealedCardLabel') return `${params?.word} ${params?.typeLabel} ${params?.position}`;
        if (key === 'board.unrevealedCardLabel') return `${params?.word} ${params?.position}`;
        if (key === 'board.assassinCard') return 'assassin';
        if (key === 'board.teamCard') return `${params?.type} team`;
        return key;
    },
}));

jest.mock('../../frontend/logger', () => ({
    logger: { warn: jest.fn(), error: jest.fn(), debug: jest.fn(), info: jest.fn() },
}));

import { attachResizeListener, detachResizeListener, renderBoard } from '../../frontend/board';
import { state, BOARD_SIZE } from '../../frontend/state';

function setupBoardDOM(): void {
    document.body.innerHTML = `
        <div id="board"></div>
        <div id="sr-announcements" aria-live="assertive"></div>
    `;
    state.cachedElements.board = document.getElementById('board');
    state.cachedElements.srAnnouncements = document.getElementById('sr-announcements');
}

function setupGameState(
    opts: {
        words?: string[];
        types?: string[];
        revealed?: boolean[];
        cardScores?: (number | null)[];
        gameMode?: string;
        gameOver?: boolean;
    } = {}
): void {
    const size = BOARD_SIZE;
    state.gameState.words = opts.words ?? Array.from({ length: size }, (_, i) => `word${i}`);
    state.gameState.types = opts.types ?? Array.from({ length: size }, () => 'neutral');
    state.gameState.revealed = opts.revealed ?? Array.from({ length: size }, () => false);
    state.gameState.cardScores = opts.cardScores ?? [];
    state.gameState.gameOver = opts.gameOver ?? false;
    state.gameState.currentTurn = 'red';
    state.gameState.gameMode = opts.gameMode ?? 'classic';
    state.gameMode = opts.gameMode ?? 'classic';
    state.playerTeam = null;
    state.spymasterTeam = null;
    state.clickerTeam = null;
    state.isMultiplayerMode = false;
}

beforeEach(() => {
    jest.useFakeTimers();
    setupBoardDOM();
    setupGameState();
    // Ensure listener state is clean
    detachResizeListener();
});

afterEach(() => {
    detachResizeListener();
    jest.useRealTimers();
});

// ========== RESIZE LISTENER ==========

describe('attachResizeListener / detachResizeListener', () => {
    test('attachResizeListener adds resize event listener', () => {
        const addSpy = jest.spyOn(window, 'addEventListener');

        attachResizeListener();

        expect(addSpy).toHaveBeenCalledWith('resize', expect.any(Function));
        addSpy.mockRestore();
    });

    test('calling attachResizeListener twice only adds one listener', () => {
        const addSpy = jest.spyOn(window, 'addEventListener');

        attachResizeListener();
        attachResizeListener();

        expect(addSpy).toHaveBeenCalledTimes(1);
        addSpy.mockRestore();
    });

    test('detachResizeListener removes the listener', () => {
        const removeSpy = jest.spyOn(window, 'removeEventListener');

        attachResizeListener();
        detachResizeListener();

        expect(removeSpy).toHaveBeenCalledWith('resize', expect.any(Function));
        removeSpy.mockRestore();
    });

    test('detachResizeListener when not attached is a no-op', () => {
        const removeSpy = jest.spyOn(window, 'removeEventListener');

        detachResizeListener();

        expect(removeSpy).not.toHaveBeenCalled();
        removeSpy.mockRestore();
    });

    test('can re-attach after detach', () => {
        const addSpy = jest.spyOn(window, 'addEventListener');

        attachResizeListener();
        detachResizeListener();
        attachResizeListener();

        expect(addSpy).toHaveBeenCalledTimes(2);
        addSpy.mockRestore();
    });
});

// ========== MATCH MODE SCORE BADGES ==========

describe('renderBoard with match mode score badges', () => {
    test('shows score badges in match mode for revealed cards', () => {
        const scores = Array.from({ length: 25 }, (_, i) => (i < 5 ? 3 : i < 10 ? 2 : 1));
        const revealed = Array.from({ length: 25 }, (_, i) => i < 3);

        setupGameState({
            cardScores: scores,
            revealed,
            gameMode: 'match',
        });

        renderBoard();

        const board = document.getElementById('board')!;
        // Revealed cards with scores should have badges
        const firstCard = board.children[0] as HTMLElement;
        const badge = firstCard.querySelector('.card-score-badge');
        expect(badge).not.toBeNull();
        expect(badge!.textContent).toBe('+3');
    });

    test('does not show score badges in classic mode', () => {
        setupGameState({
            cardScores: Array(25).fill(2),
            revealed: Array(25).fill(true),
            gameMode: 'classic',
        });

        renderBoard();

        const board = document.getElementById('board')!;
        const badges = board.querySelectorAll('.card-score-badge');
        expect(badges.length).toBe(0);
    });

    test('shows score badges for spymaster on unrevealed cards', () => {
        const scores = Array(25).fill(2);
        setupGameState({
            cardScores: scores,
            gameMode: 'match',
        });
        state.spymasterTeam = 'red';
        state.playerTeam = 'red';

        renderBoard();

        const board = document.getElementById('board')!;
        const badges = board.querySelectorAll('.card-score-badge');
        expect(badges.length).toBeGreaterThan(0);
    });

    test('negative scores get trap badge class', () => {
        const scores = [-2, ...Array(24).fill(1)];
        const revealed = [true, ...Array(24).fill(false)];
        setupGameState({
            cardScores: scores,
            revealed,
            gameMode: 'match',
        });

        renderBoard();

        const board = document.getElementById('board')!;
        const badge = board.children[0].querySelector('.card-score-badge');
        expect(badge).not.toBeNull();
        expect(badge!.classList.contains('card-score-trap')).toBe(true);
        expect(badge!.textContent).toBe('-2');
    });
});
