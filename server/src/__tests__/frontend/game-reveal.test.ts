/**
 * Frontend Game Reveal Module Tests
 *
 * Tests the revealCard(), revealCardFromServer(), showGameOverModal(), and closeGameOver()
 * functions extracted into game/reveal.ts.
 * Test environment: jsdom
 */

jest.mock('../../frontend/i18n', () => ({
    t: (key: string, params: Record<string, string | number> = {}) => {
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

jest.mock('../../frontend/clientAccessor', () => ({
    getClient: () => null,
    isClientConnected: jest.fn(() => false),
}));

import { revealCard, showGameOverModal, closeGameOver } from '../../frontend/game/reveal';
import { state, BOARD_SIZE } from '../../frontend/state';
import { canClickCards, renderBoard } from '../../frontend/board';
import { showToast, closeModal, announceToScreenReader } from '../../frontend/ui';
import { updateURL } from '../../frontend/url-state';

const SAMPLE_WORDS = Array.from({ length: 25 }, (_, i) => `WORD_${i}`);
const SAMPLE_TYPES = [
    'red',
    'red',
    'red',
    'red',
    'red',
    'red',
    'red',
    'red',
    'red',
    'blue',
    'blue',
    'blue',
    'blue',
    'blue',
    'blue',
    'blue',
    'blue',
    'neutral',
    'neutral',
    'neutral',
    'neutral',
    'neutral',
    'neutral',
    'neutral',
    'assassin',
];

function resetState() {
    state.gameState.words = [...SAMPLE_WORDS];
    state.gameState.types = [...SAMPLE_TYPES];
    state.gameState.revealed = new Array(BOARD_SIZE).fill(false);
    state.gameState.currentTurn = 'red';
    state.gameState.redScore = 0;
    state.gameState.blueScore = 0;
    state.gameState.redTotal = 9;
    state.gameState.blueTotal = 8;
    state.gameState.gameOver = false;
    state.gameState.winner = null;
    state.isMultiplayerMode = false;
    state.spymasterTeam = null;
    state.clickerTeam = null;
    state.playerTeam = null;
    state.lastRevealedIndex = -1;
    state.lastRevealedWasCorrect = false;
    state.pendingUIUpdate = false;
    state.revealingCards = new Set();
    state.revealTimeouts = new Map();
    state.isRevealingCard = false;
    state.teamNames = { red: 'Red', blue: 'Blue' };
    state.cachedElements.board = null;
}

beforeEach(() => {
    jest.useFakeTimers();
    resetState();
    jest.clearAllMocks();
    (canClickCards as jest.Mock).mockReturnValue(true);
});

afterEach(() => {
    jest.useRealTimers();
});

describe('revealCard (standalone mode)', () => {
    test('reveals a card and updates state', () => {
        revealCard(0); // red card
        expect(state.gameState.revealed[0]).toBe(true);
        expect(state.gameState.redScore).toBe(1);
    });

    test('tracks animation state on correct reveal', () => {
        // Card 0 is red, turn is red -> correct
        revealCard(0);
        expect(state.lastRevealedIndex).toBe(0);
        expect(state.lastRevealedWasCorrect).toBe(true);
    });

    test('tracks animation state on incorrect reveal', () => {
        // Card 9 is blue, turn is red -> wrong
        revealCard(9);
        expect(state.lastRevealedIndex).toBe(9);
        expect(state.lastRevealedWasCorrect).toBe(false);
    });

    test('increments blue score for blue card', () => {
        revealCard(9); // blue card
        expect(state.gameState.blueScore).toBe(1);
    });

    test('switches turn on wrong guess', () => {
        // Reveal a blue card during red turn
        revealCard(9);
        expect(state.gameState.currentTurn).toBe('blue');
    });

    test('does not switch turn on correct guess', () => {
        revealCard(0); // red card during red turn
        expect(state.gameState.currentTurn).toBe('red');
    });

    test('handles assassin card - game over', () => {
        state.gameState.currentTurn = 'red';
        revealCard(24); // assassin
        expect(state.gameState.gameOver).toBe(true);
        expect(state.gameState.winner).toBe('blue'); // other team wins
    });

    test('calls updateURL after reveal', () => {
        revealCard(0);
        expect(updateURL).toHaveBeenCalled();
    });

    test('queues UI update via requestAnimationFrame', () => {
        revealCard(0);
        expect(state.pendingUIUpdate).toBe(true);
    });

    test('announces reveal to screen reader', () => {
        revealCard(0);
        expect(announceToScreenReader).toHaveBeenCalledWith(expect.stringContaining('game.wordRevealedAs'));
    });

    test('clears animation tracking after timeout', () => {
        revealCard(0);
        expect(state.lastRevealedIndex).toBe(0);

        // Fast-forward past animation clear timeout
        jest.advanceTimersByTime(2000);
        expect(state.lastRevealedIndex).toBe(-1);
        expect(state.lastRevealedWasCorrect).toBe(false);
    });

    test('rejects invalid index', () => {
        revealCard(-1);
        expect(state.gameState.revealed.filter((r) => r).length).toBe(0);
    });

    test('rejects out-of-bounds index', () => {
        revealCard(99);
        expect(state.gameState.revealed.filter((r) => r).length).toBe(0);
    });

    test('rejects non-number index', () => {
        revealCard('abc' as unknown as number);
        expect(state.gameState.revealed.filter((r) => r).length).toBe(0);
    });

    test('shows toast when game is over', () => {
        state.gameState.gameOver = true;
        revealCard(0);
        expect(showToast).toHaveBeenCalledWith('game.gameOverStartNew', 'warning');
    });

    test('silently returns when card already revealed', () => {
        state.gameState.revealed[0] = true;
        revealCard(0);
        expect(showToast).not.toHaveBeenCalled();
        expect(updateURL).not.toHaveBeenCalled();
    });

    test('shows toast when canClickCards returns false (spymaster)', () => {
        (canClickCards as jest.Mock).mockReturnValue(false);
        state.spymasterTeam = 'red';
        revealCard(0);
        expect(showToast).toHaveBeenCalledWith('game.spymasterCannotReveal', 'warning');
    });

    test('shows toast when clicker is on wrong team', () => {
        (canClickCards as jest.Mock).mockReturnValue(false);
        state.clickerTeam = 'blue';
        state.gameState.currentTurn = 'red';
        revealCard(0);
        expect(showToast).toHaveBeenCalledWith(expect.stringContaining('game.notYourTurn'), 'warning');
    });

    test('shows toast when no team and no clicker', () => {
        (canClickCards as jest.Mock).mockReturnValue(false);
        state.clickerTeam = null;
        state.playerTeam = null;
        revealCard(0);
        expect(showToast).toHaveBeenCalledWith('game.joinTeamToClick', 'warning');
    });

    test('shows toast when player team is wrong', () => {
        (canClickCards as jest.Mock).mockReturnValue(false);
        state.clickerTeam = null;
        state.playerTeam = 'blue';
        state.gameState.currentTurn = 'red';
        revealCard(0);
        expect(showToast).toHaveBeenCalledWith(expect.stringContaining('game.notYourTurn'), 'warning');
    });

    test('shows toast for onlyClickerCanReveal fallback', () => {
        (canClickCards as jest.Mock).mockReturnValue(false);
        // Has a player team that matches, but not clicker and not spymaster
        state.clickerTeam = null;
        state.playerTeam = 'red';
        state.gameState.currentTurn = 'red';
        revealCard(0);
        expect(showToast).toHaveBeenCalledWith('game.onlyClickerCanReveal', 'warning');
    });

    test('neutral card does not change scores', () => {
        revealCard(17); // neutral
        expect(state.gameState.redScore).toBe(0);
        expect(state.gameState.blueScore).toBe(0);
        // But turn switches (wrong guess for red)
        expect(state.gameState.currentTurn).toBe('blue');
    });

    test('game over on red completing all cards', () => {
        // Reveal all 9 red cards (indices 0-8)
        state.gameState.redTotal = 9;
        for (let i = 0; i < 9; i++) {
            state.gameState.revealed[i] = true;
            state.gameState.redScore++;
        }
        // Already at the threshold, but need checkGameOver to run
        // Reveal 9th card via revealCard - but they're already revealed
        // So set up fresh: 8 already revealed, reveal the 9th
        resetState();
        for (let i = 0; i < 8; i++) {
            state.gameState.revealed[i] = true;
        }
        state.gameState.redScore = 8;
        revealCard(8); // 9th red card
        expect(state.gameState.redScore).toBe(9);
        expect(state.gameState.gameOver).toBe(true);
        expect(state.gameState.winner).toBe('red');
    });
});

describe('showGameOverModal', () => {
    test('calls renderBoard', () => {
        showGameOverModal();
        expect(renderBoard).toHaveBeenCalled();
    });

    test('accepts winner and reason args without error', () => {
        expect(() => showGameOverModal('red', 'all_words')).not.toThrow();
    });
});

describe('closeGameOver', () => {
    test('calls closeModal with correct id', () => {
        closeGameOver();
        expect(closeModal).toHaveBeenCalledWith('game-over-modal');
    });
});
