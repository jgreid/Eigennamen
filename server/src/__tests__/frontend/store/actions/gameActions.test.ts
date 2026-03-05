/**
 * Game actions unit tests
 */

jest.mock('../../../../frontend/state', () => ({
    state: {
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
            currentClue: null,
            guessesUsed: 0,
            guessesAllowed: 0,
            status: 'waiting',
            duetTypes: [],
            timerTokens: 0,
            greenFound: 0,
            greenTotal: 0,
        },
        gameMode: 'match',
        boardInitialized: true,
        isRevealingCard: false,
        revealingCards: new Set<number>(),
        revealTimeouts: new Map<number, ReturnType<typeof setTimeout>>(),
        revealTimestamps: new Map<number, number>(),
    },
}));

jest.mock('../../../../frontend/logger', () => ({
    logger: { warn: jest.fn(), error: jest.fn(), debug: jest.fn(), info: jest.fn() },
}));

import { state } from '../../../../frontend/state';
import { clearAllListeners } from '../../../../frontend/store/eventBus';
import {
    resetGame,
    setGameOver,
    syncScores,
    syncBoardData,
    syncTurnAndMetadata,
    clearRevealTracking,
} from '../../../../frontend/store/actions/gameActions';

function resetTestState(): void {
    state.gameState.words = ['a', 'b', 'c'];
    state.gameState.types = ['red', 'blue', 'neutral'];
    state.gameState.revealed = [true, false, false];
    state.gameState.currentTurn = 'blue';
    state.gameState.redScore = 3;
    state.gameState.blueScore = 2;
    state.gameState.redTotal = 9;
    state.gameState.blueTotal = 8;
    state.gameState.gameOver = true;
    state.gameState.winner = 'red';
    state.gameState.seed = 12345 as any;
    state.gameState.currentClue = { word: 'test', number: 2 } as any;
    state.gameState.guessesUsed = 1;
    state.gameState.guessesAllowed = 3;
    state.gameState.status = 'playing' as any;
    state.gameState.duetTypes = ['green'];
    state.gameState.timerTokens = 5;
    state.gameState.greenFound = 2;
    state.gameState.greenTotal = 15;
    state.gameMode = 'duet' as any;
    state.boardInitialized = true;
}

beforeEach(() => {
    resetTestState();
    clearAllListeners();
    jest.clearAllMocks();
});

describe('resetGame', () => {
    test('resets all game state fields to defaults', () => {
        resetGame();

        expect(state.gameState.words).toEqual([]);
        expect(state.gameState.types).toEqual([]);
        expect(state.gameState.revealed).toEqual([]);
        expect(state.gameState.currentTurn).toBe('red');
        expect(state.gameState.redScore).toBe(0);
        expect(state.gameState.blueScore).toBe(0);
        expect(state.gameState.gameOver).toBe(false);
        expect(state.gameState.winner).toBeNull();
        expect(state.gameState.seed).toBeNull();
        expect(state.gameState.currentClue).toBeNull();
        expect(state.gameState.guessesUsed).toBe(0);
        expect(state.gameMode).toBe('match');
    });

    // Note: batch:complete event emission is tested in batch.test.ts
    // (integration between reactive proxy and event bus). Here we use
    // mocked state, so the event bus doesn't fire — that's expected.
});

describe('setGameOver', () => {
    test('sets gameOver true and validated winner', () => {
        state.gameState.gameOver = false;
        state.gameState.winner = null;

        setGameOver('blue');

        expect(state.gameState.gameOver).toBe(true);
        expect(state.gameState.winner).toBe('blue');
    });

    test('normalizes invalid winner to null', () => {
        setGameOver('green');

        expect(state.gameState.gameOver).toBe(true);
        expect(state.gameState.winner).toBeNull();
    });
});

describe('syncScores', () => {
    test('updates scores within valid range', () => {
        syncScores({ redScore: 5, blueScore: 3, redTotal: 9, blueTotal: 8 });

        expect(state.gameState.redScore).toBe(5);
        expect(state.gameState.blueScore).toBe(3);
        expect(state.gameState.redTotal).toBe(9);
        expect(state.gameState.blueTotal).toBe(8);
    });

    test('rejects negative scores', () => {
        const before = state.gameState.redScore;
        syncScores({ redScore: -1 });
        expect(state.gameState.redScore).toBe(before);
    });

    test('rejects oversized scores', () => {
        const before = state.gameState.redScore;
        syncScores({ redScore: 101 });
        expect(state.gameState.redScore).toBe(before);
    });
});

describe('syncBoardData', () => {
    test('updates words, types, and revealed', () => {
        const words = ['APPLE', 'BANANA', 'CHERRY'];
        const types = ['red', 'blue', 'neutral'];
        const revealed = [false, false, false];

        syncBoardData({ words, types, revealed });

        expect(state.gameState.words).toEqual(words);
        expect(state.gameState.types).toEqual(types);
        expect(state.gameState.revealed).toEqual(revealed);
    });

    test('returns true when words changed', () => {
        state.gameState.words = ['OLD'];
        const result = syncBoardData({ words: ['NEW'], types: ['red'], revealed: [false] });
        expect(result).toBe(true);
    });

    test('returns false when words unchanged', () => {
        state.gameState.words = ['SAME'];
        const result = syncBoardData({ words: ['SAME'], types: ['red'], revealed: [false] });
        expect(result).toBe(false);
    });

    test('returns false when no words provided', () => {
        const result = syncBoardData({});
        expect(result).toBe(false);
    });

    test('clears boardInitialized when words change', () => {
        state.boardInitialized = true;
        state.gameState.words = ['OLD'];
        syncBoardData({ words: ['NEW'], types: ['red'], revealed: [false] });
        expect(state.boardInitialized).toBe(false);
    });
});

describe('syncTurnAndMetadata', () => {
    test('syncs currentTurn with validation', () => {
        state.gameState.currentTurn = 'red';
        syncTurnAndMetadata({ currentTurn: 'blue' });
        expect(state.gameState.currentTurn).toBe('blue');
    });

    test('rejects invalid currentTurn', () => {
        state.gameState.currentTurn = 'red';
        syncTurnAndMetadata({ currentTurn: 'green' });
        expect(state.gameState.currentTurn).toBe('red');
    });

    test('syncs game over state', () => {
        state.gameState.gameOver = false;
        syncTurnAndMetadata({ gameOver: true, winner: 'red' });
        expect(state.gameState.gameOver).toBe(true);
        expect(state.gameState.winner).toBe('red');
    });

    test('clears game over when not set', () => {
        state.gameState.gameOver = true;
        state.gameState.winner = 'red';
        syncTurnAndMetadata({ gameOver: false });
        expect(state.gameState.gameOver).toBe(false);
        expect(state.gameState.winner).toBeNull();
    });

    test('syncs duet mode fields', () => {
        syncTurnAndMetadata({
            duetTypes: ['green', 'black'],
            timerTokens: 3,
            greenFound: 5,
            greenTotal: 15,
            gameMode: 'duet',
        });

        expect(state.gameState.duetTypes).toEqual(['green', 'black']);
        expect(state.gameState.timerTokens).toBe(3);
        expect(state.gameState.greenFound).toBe(5);
        expect(state.gameState.greenTotal).toBe(15);
        expect(state.gameMode).toBe('duet');
    });
});

describe('clearRevealTracking', () => {
    test('clears all reveal state', () => {
        state.revealingCards.add(0);
        state.revealingCards.add(1);
        state.isRevealingCard = true;

        clearRevealTracking();

        expect(state.revealingCards.size).toBe(0);
        expect(state.isRevealingCard).toBe(false);
        expect(state.revealTimeouts.size).toBe(0);
    });
});
