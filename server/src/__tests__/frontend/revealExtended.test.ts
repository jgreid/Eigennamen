/**
 * Reveal Extended Tests
 *
 * Covers uncovered branches in game/reveal.ts:
 * - Multiplayer reveal path (double-click guard, safety cap, per-card timeout)
 * - revealCardFromServer (server score sync, turnEnded, cardScore, revealedBy)
 * - sweepStaleRevealingCards
 * - startRevealSweep / stopRevealSweep
 */

jest.mock('../../frontend/i18n', () => ({
    t: (key: string) => key,
}));

jest.mock('../../frontend/url-state', () => ({
    updateURL: jest.fn(),
}));

jest.mock('../../frontend/board', () => ({
    renderBoard: jest.fn(),
    updateBoardIncremental: jest.fn(),
    updateSingleCard: jest.fn(),
    canClickCards: jest.fn(() => true),
    setCardClickHandler: jest.fn(),
}));

jest.mock('../../frontend/ui', () => ({
    showToast: jest.fn(),
    openModal: jest.fn(),
    closeModal: jest.fn(),
    announceToScreenReader: jest.fn(),
}));

jest.mock('../../frontend/roles', () => ({
    updateRoleBanner: jest.fn(),
    updateControls: jest.fn(),
}));

const mockRevealCard = jest.fn();
const mockIsClientConnected = jest.fn(() => true);

jest.mock('../../frontend/clientAccessor', () => ({
    getClient: () => null,
    isClientConnected: (...args: unknown[]) => mockIsClientConnected(...args),
}));

(globalThis as Record<string, unknown>).EigennamenClient = {
    revealCard: mockRevealCard,
};

import {
    revealCard,
    revealCardFromServer,
    sweepStaleRevealingCards,
    startRevealSweep,
    stopRevealSweep,
} from '../../frontend/game/reveal';
import { state, BOARD_SIZE } from '../../frontend/state';
import { showToast } from '../../frontend/ui';

const SAMPLE_WORDS = Array.from({ length: 25 }, (_, i) => `WORD_${i}`);
const SAMPLE_TYPES = [...Array(9).fill('red'), ...Array(8).fill('blue'), ...Array(7).fill('neutral'), 'assassin'];

function resetState() {
    state.gameState.words = [...SAMPLE_WORDS];
    state.gameState.types = [...SAMPLE_TYPES];
    state.gameState.revealed = new Array(BOARD_SIZE).fill(false);
    state.gameState.revealedBy = new Array(BOARD_SIZE).fill(null);
    state.gameState.cardScores = new Array(BOARD_SIZE).fill(0);
    state.gameState.currentTurn = 'red';
    state.gameState.redScore = 0;
    state.gameState.blueScore = 0;
    state.gameState.redTotal = 9;
    state.gameState.blueTotal = 8;
    state.gameState.gameOver = false;
    state.gameState.winner = null;
    state.gameState.guessesUsed = 0;
    state.gameState.guessesAllowed = 0;
    state.gameState.currentClue = null;
    state.isMultiplayerMode = true;
    state.spymasterTeam = null;
    state.clickerTeam = null;
    state.playerTeam = null;
    state.lastRevealedIndex = -1;
    state.lastRevealedWasCorrect = false;
    state.pendingUIUpdate = false;
    state.pendingRevealRAF = null;
    state.gameGeneration = 1;
    state.revealingCards = new Set();
    state.revealTimeouts = new Map();
    state.revealTimestamps = new Map();
    state.isRevealingCard = false;
    state.teamNames = { red: 'Red', blue: 'Blue' };
    state.cachedElements.board = null;
}

beforeEach(() => {
    jest.useFakeTimers();
    resetState();
    jest.clearAllMocks();
    mockIsClientConnected.mockReturnValue(true);
    document.body.innerHTML = '';
    (globalThis as Record<string, unknown>).EigennamenClient = {
        revealCard: mockRevealCard,
    };
});

afterEach(() => {
    jest.useRealTimers();
});

describe('revealCard multiplayer path', () => {
    test('sends reveal to server and marks card as pending', () => {
        revealCard(5);

        expect(mockRevealCard).toHaveBeenCalledWith(5);
        expect(state.revealingCards.has(5)).toBe(true);
        expect(state.isRevealingCard).toBe(true);
    });

    test('prevents double-click on pending card', () => {
        revealCard(5);
        jest.clearAllMocks();

        // Second click on same card
        revealCard(5);

        expect(mockRevealCard).not.toHaveBeenCalled();
    });

    test('clears stale entries when revealingCards reaches BOARD_SIZE', () => {
        // Fill revealingCards to BOARD_SIZE
        for (let i = 0; i < BOARD_SIZE; i++) {
            state.revealingCards.add(i);
            state.revealTimestamps.set(i, Date.now());
            state.revealTimeouts.set(i, setTimeout(() => {}, 99999) as unknown as number);
        }
        state.isRevealingCard = true;

        // Next reveal should clear all stale entries first
        // Use an unrevealed card index that's not already in the set
        state.revealingCards.clear(); // Clear so we can test the >= BOARD_SIZE branch properly
        for (let i = 0; i < BOARD_SIZE; i++) {
            state.revealingCards.add(i);
        }

        revealCard(0); // Already in set, so it's a double-click → returns
        // The safety cap check happens before the double-click check
        // So let's set up properly: add BOARD_SIZE entries, then try a new card
        resetState();
        for (let i = 0; i < BOARD_SIZE; i++) {
            state.revealingCards.add(100 + i); // Fake indices to fill the set
            state.revealTimeouts.set(100 + i, setTimeout(() => {}, 99999) as unknown as number);
            state.revealTimestamps.set(100 + i, Date.now());
        }

        revealCard(0);

        // After safety cap clear, the set should only have the new card
        expect(state.revealingCards.size).toBe(1);
        expect(state.revealingCards.has(0)).toBe(true);
    });

    test('per-card timeout clears pending state', () => {
        revealCard(3);
        expect(state.revealingCards.has(3)).toBe(true);

        // Fast-forward past the timeout
        jest.advanceTimersByTime(15000);

        expect(state.revealingCards.has(3)).toBe(false);
        expect(state.isRevealingCard).toBe(false);
        expect(showToast).toHaveBeenCalledWith('game.revealTimeout', 'warning');
    });

    test('adds revealing CSS class to card element', () => {
        document.body.innerHTML = '<div class="card" data-index="5"></div>';
        revealCard(5);

        const card = document.querySelector('.card[data-index="5"]');
        expect(card!.classList.contains('revealing')).toBe(true);
    });

    test('does not reveal locally in multiplayer mode', () => {
        revealCard(0);
        expect(state.gameState.revealed[0]).toBe(false);
    });
});

describe('revealCardFromServer', () => {
    test('reveals card and uses server-provided scores', () => {
        revealCardFromServer(0, {
            type: 'red',
            redScore: 5,
            blueScore: 3,
        });

        expect(state.gameState.revealed[0]).toBe(true);
        expect(state.gameState.redScore).toBe(5);
        expect(state.gameState.blueScore).toBe(3);
    });

    test('uses local scoring fallback when server scores not provided', () => {
        state.gameState.redScore = 2;
        revealCardFromServer(0, { type: 'red' });

        expect(state.gameState.redScore).toBe(3); // incremented locally
    });

    test('increments blue score locally for blue card without server scores', () => {
        state.gameState.blueScore = 1;
        revealCardFromServer(9, { type: 'blue' });

        expect(state.gameState.blueScore).toBe(2);
    });

    test('clears currentClue on turnEnded', () => {
        state.gameState.currentClue = 'spy hint';
        revealCardFromServer(0, {
            type: 'red',
            turnEnded: true,
        });

        expect(state.gameState.currentClue).toBeNull();
    });

    test('does not clear currentClue when turnEnded is false', () => {
        state.gameState.currentClue = 'spy hint';
        revealCardFromServer(0, {
            type: 'red',
            turnEnded: false,
        });

        expect(state.gameState.currentClue).toBe('spy hint');
    });

    test('tracks cardScore in state', () => {
        revealCardFromServer(2, {
            type: 'red',
            cardScore: 3,
        });

        expect(state.gameState.cardScores[2]).toBe(3);
    });

    test('tracks revealedBy using current turn before update', () => {
        state.gameState.currentTurn = 'red';
        revealCardFromServer(5, {
            type: 'blue',
            currentTurn: 'blue', // Server says turn switches
        });

        // revealedBy should capture the team that was on turn (red), not the new turn (blue)
        expect(state.gameState.revealedBy[5]).toBe('red');
        expect(state.gameState.currentTurn).toBe('blue');
    });

    test('uses server gameOver and winner state', () => {
        revealCardFromServer(24, {
            type: 'assassin',
            gameOver: true,
            winner: 'blue',
        });

        expect(state.gameState.gameOver).toBe(true);
        expect(state.gameState.winner).toBe('blue');
    });

    test('falls back to local assassin detection when server gameOver not provided', () => {
        state.gameState.currentTurn = 'red';
        revealCardFromServer(24, { type: 'assassin' });

        expect(state.gameState.gameOver).toBe(true);
        expect(state.gameState.winner).toBe('blue');
    });

    test('syncs guess tracking from server', () => {
        revealCardFromServer(0, {
            type: 'red',
            guessesUsed: 2,
            guessesAllowed: 3,
        });

        expect(state.gameState.guessesUsed).toBe(2);
        expect(state.gameState.guessesAllowed).toBe(3);
    });

    test('clears pending reveal state for the card', () => {
        state.revealingCards.add(5);
        state.revealTimestamps.set(5, Date.now());
        const timeoutId = setTimeout(() => {}, 99999);
        state.revealTimeouts.set(5, timeoutId as unknown as number);

        revealCardFromServer(5, { type: 'red' });

        expect(state.revealingCards.has(5)).toBe(false);
        expect(state.revealTimestamps.has(5)).toBe(false);
        expect(state.revealTimeouts.has(5)).toBe(false);
    });

    test('rejects invalid index', () => {
        revealCardFromServer(-1, { type: 'red' });
        expect(state.gameState.revealed.filter(Boolean).length).toBe(0);
    });

    test('rejects index >= board size', () => {
        revealCardFromServer(999, { type: 'red' });
        expect(state.gameState.revealed.filter(Boolean).length).toBe(0);
    });

    test('skips already-revealed card', () => {
        state.gameState.revealed[3] = true;
        state.gameState.redScore = 1;

        revealCardFromServer(3, { type: 'red', redScore: 5 });

        // Should not update scores
        expect(state.gameState.redScore).toBe(1);
    });

    test('uses server currentTurn when provided', () => {
        state.gameState.currentTurn = 'red';
        revealCardFromServer(0, { type: 'red', currentTurn: 'blue' });

        expect(state.gameState.currentTurn).toBe('blue');
    });

    test('falls back to local turn switch for wrong guess without server currentTurn', () => {
        state.gameState.currentTurn = 'red';
        revealCardFromServer(9, { type: 'blue' }); // Wrong guess

        expect(state.gameState.currentTurn).toBe('blue');
    });
});

describe('sweepStaleRevealingCards', () => {
    test('removes entries older than timeout threshold', () => {
        const oldTime = Date.now() - 20000; // 20s ago, well past threshold
        state.revealingCards.add(3);
        state.revealTimestamps.set(3, oldTime);
        state.isRevealingCard = true;

        sweepStaleRevealingCards();

        expect(state.revealingCards.has(3)).toBe(false);
        expect(state.isRevealingCard).toBe(false);
    });

    test('keeps fresh entries', () => {
        state.revealingCards.add(5);
        state.revealTimestamps.set(5, Date.now()); // Just now
        state.isRevealingCard = true;

        sweepStaleRevealingCards();

        expect(state.revealingCards.has(5)).toBe(true);
        expect(state.isRevealingCard).toBe(true);
    });

    test('removes entries without timestamps', () => {
        state.revealingCards.add(7);
        // No timestamp set — should be treated as stale
        state.isRevealingCard = true;

        sweepStaleRevealingCards();

        expect(state.revealingCards.has(7)).toBe(false);
    });

    test('does nothing when set is empty', () => {
        expect(() => sweepStaleRevealingCards()).not.toThrow();
    });

    test('clears associated timeout when sweeping stale entry', () => {
        const oldTime = Date.now() - 20000;
        state.revealingCards.add(3);
        state.revealTimestamps.set(3, oldTime);
        const timeoutId = setTimeout(() => {}, 99999);
        state.revealTimeouts.set(3, timeoutId as unknown as number);

        sweepStaleRevealingCards();

        expect(state.revealTimeouts.has(3)).toBe(false);
    });

    test('removes revealing CSS class from stale card elements', () => {
        document.body.innerHTML = '<div class="card revealing" data-index="3"></div>';
        const oldTime = Date.now() - 20000;
        state.revealingCards.add(3);
        state.revealTimestamps.set(3, oldTime);

        sweepStaleRevealingCards();

        const card = document.querySelector('.card[data-index="3"]');
        expect(card!.classList.contains('revealing')).toBe(false);
    });
});

describe('startRevealSweep / stopRevealSweep', () => {
    test('starts periodic interval', () => {
        startRevealSweep();

        // Add a stale entry
        state.revealingCards.add(1);
        state.revealTimestamps.set(1, Date.now() - 20000);
        state.isRevealingCard = true;

        // Advance timer past the sweep interval
        jest.advanceTimersByTime(15000);

        // Sweep should have cleaned the stale entry
        expect(state.revealingCards.has(1)).toBe(false);

        stopRevealSweep();
    });

    test('stopRevealSweep clears interval', () => {
        startRevealSweep();
        stopRevealSweep();

        // Add stale entry after stop
        state.revealingCards.add(2);
        state.revealTimestamps.set(2, Date.now() - 20000);
        state.isRevealingCard = true;

        jest.advanceTimersByTime(20000);

        // Should NOT have been swept (interval was stopped)
        expect(state.revealingCards.has(2)).toBe(true);
    });

    test('startRevealSweep clears previous interval before starting new one', () => {
        startRevealSweep();
        startRevealSweep(); // Should not double-up intervals

        // Verify no errors
        stopRevealSweep();
    });
});
