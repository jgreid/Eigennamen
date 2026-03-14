/**
 * Frontend State Mutations Module Tests
 *
 * Tests all exports from src/frontend/stateMutations.ts:
 * type guards, atomic setters, reset, and validators.
 * Test environment: jsdom
 */

jest.mock('../../frontend/state', () => ({
    state: {
        playerTeam: null,
        spymasterTeam: null,
        clickerTeam: null,
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
    },
}));

jest.mock('../../frontend/logger', () => ({
    logger: { warn: jest.fn(), error: jest.fn(), debug: jest.fn(), info: jest.fn() },
}));

import {
    isValidTeam,
    isValidRole,
    isValidGameMode,
    setPlayerRole,
    clearPlayerRole,
    resetGameState,
    validateTurn,
    validateWinner,
    validateGameMode,
    validateArrayLength,
} from '../../frontend/stateMutations';
import { state } from '../../frontend/state';
import { logger } from '../../frontend/logger';

function resetMockState(): void {
    state.playerTeam = null;
    state.spymasterTeam = null;
    state.clickerTeam = null;
    state.gameState.words = ['a', 'b', 'c'];
    state.gameState.types = ['red', 'blue', 'neutral'];
    state.gameState.revealed = [true, false, true];
    state.gameState.currentTurn = 'blue';
    state.gameState.redScore = 5;
    state.gameState.blueScore = 3;
    state.gameState.redTotal = 9;
    state.gameState.blueTotal = 8;
    state.gameState.gameOver = true;
    state.gameState.winner = 'red';
    state.gameState.seed = 12345 as any;
    state.gameState.currentClue = { word: 'test', number: 2 } as any;
    state.gameState.guessesUsed = 1;
    state.gameState.guessesAllowed = 3;
    state.gameState.status = 'playing' as any;
    state.gameState.duetTypes = ['green', 'black'];
    state.gameState.timerTokens = 5;
    state.gameState.greenFound = 2;
    state.gameState.greenTotal = 15;
    state.gameMode = 'duet' as any;
}

beforeEach(() => {
    resetMockState();
    jest.clearAllMocks();
});

// ========== TYPE GUARDS ==========

describe('isValidTeam', () => {
    test.each([
        ['red', true],
        ['blue', true],
        ['green', false],
        ['', false],
        ['Red', false],
        [null, false],
        [undefined, false],
        [42, false],
        [true, false],
        [{ team: 'red' }, false],
    ])('isValidTeam(%j) → %s', (input, expected) => {
        expect(isValidTeam(input)).toBe(expected);
    });
});

describe('isValidRole', () => {
    test.each([
        ['spymaster', true],
        ['clicker', true],
        ['spectator', true],
        ['admin', false],
        ['', false],
        ['Spymaster', false],
        [null, false],
        [undefined, false],
        [123, false],
    ])('isValidRole(%j) → %s', (input, expected) => {
        expect(isValidRole(input)).toBe(expected);
    });
});

describe('isValidGameMode', () => {
    test.each([
        ['classic', true],
        ['duet', true],
        ['match', true],
        ['blitz', false],
        ['ranked', false],
        ['', false],
        ['Classic', false],
        [null, false],
        [undefined, false],
        [0, false],
    ])('isValidGameMode(%j) → %s', (input, expected) => {
        expect(isValidGameMode(input)).toBe(expected);
    });
});

// ========== ATOMIC SETTERS ==========

describe('setPlayerRole', () => {
    test('spymaster on red sets spymasterTeam=red and clickerTeam=null', () => {
        setPlayerRole('spymaster', 'red');
        expect(state.playerTeam).toBe('red');
        expect(state.spymasterTeam).toBe('red');
        expect(state.clickerTeam).toBeNull();
    });

    test('clicker on blue sets clickerTeam=blue and spymasterTeam=null', () => {
        setPlayerRole('clicker', 'blue');
        expect(state.playerTeam).toBe('blue');
        expect(state.clickerTeam).toBe('blue');
        expect(state.spymasterTeam).toBeNull();
    });

    test('spectator clears both role teams', () => {
        state.spymasterTeam = 'red';
        state.clickerTeam = 'blue';
        setPlayerRole('spectator', 'red');
        expect(state.playerTeam).toBe('red');
        expect(state.spymasterTeam).toBeNull();
        expect(state.clickerTeam).toBeNull();
    });

    test('invalid team normalizes playerTeam to null and clears roles', () => {
        setPlayerRole('spymaster', 'green');
        expect(state.playerTeam).toBeNull();
        expect(state.spymasterTeam).toBeNull();
        expect(state.clickerTeam).toBeNull();
    });

    test('null role with valid team sets playerTeam but clears role teams', () => {
        setPlayerRole(null, 'red');
        expect(state.playerTeam).toBe('red');
        expect(state.spymasterTeam).toBeNull();
        expect(state.clickerTeam).toBeNull();
    });

    test('switching from spymaster to clicker clears spymasterTeam', () => {
        setPlayerRole('spymaster', 'red');
        expect(state.spymasterTeam).toBe('red');
        setPlayerRole('clicker', 'red');
        expect(state.clickerTeam).toBe('red');
        expect(state.spymasterTeam).toBeNull();
    });
});

describe('clearPlayerRole', () => {
    test('resets all role fields to null', () => {
        state.playerTeam = 'red';
        state.spymasterTeam = 'red';
        state.clickerTeam = 'blue';
        clearPlayerRole();
        expect(state.playerTeam).toBeNull();
        expect(state.spymasterTeam).toBeNull();
        expect(state.clickerTeam).toBeNull();
    });
});

// ========== RESET ==========

describe('resetGameState', () => {
    test('resets all game state fields from dirty state', () => {
        resetGameState();
        expect(state.gameState).toEqual({
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
            cardScores: [],
            revealedBy: [],
            matchRound: 0,
            redMatchScore: 0,
            blueMatchScore: 0,
            roundHistory: [],
            matchOver: false,
            matchWinner: null,
        });
        expect(state.gameMode).toBe('match');
    });
});

// ========== VALIDATORS ==========

describe('validateTurn', () => {
    test.each([
        ['red', undefined, 'red'],
        ['blue', undefined, 'blue'],
        ['green', undefined, 'red'],
        [null, undefined, 'red'],
        [42, undefined, 'red'],
        ['invalid', 'blue', 'blue'],
    ])('validateTurn(%j, %j) → %s', (input, fallback, expected) => {
        expect(validateTurn(input, fallback)).toBe(expected);
    });
});

describe('validateWinner', () => {
    test.each([
        ['red', 'red'],
        ['blue', 'blue'],
        ['green', null],
        [null, null],
        [undefined, null],
        [99, null],
        [{ winner: 'red' }, null],
    ])('validateWinner(%j) → %j', (input, expected) => {
        expect(validateWinner(input)).toBe(expected);
    });
});

describe('validateGameMode', () => {
    test.each([
        ['classic', 'classic'],
        ['duet', 'duet'],
        ['match', 'match'],
        ['blitz', 'match'],
        [null, 'match'],
        [1, 'match'],
        ['Classic', 'match'],
    ])('validateGameMode(%j) → %s', (input, expected) => {
        expect(validateGameMode(input)).toBe(expected);
    });
});

describe('validateArrayLength', () => {
    test('returns true when length matches', () => {
        expect(validateArrayLength('test', [1, 2, 3], 3)).toBe(true);
        expect(logger.warn).not.toHaveBeenCalled();
    });

    test('returns false and logs warning on mismatch', () => {
        expect(validateArrayLength('words', [1, 2], 5)).toBe(false);
        expect(logger.warn).toHaveBeenCalledWith('words array length mismatch: got 2, expected 5');
    });

    test('returns false for null/undefined without logging', () => {
        expect(validateArrayLength('test', null as any, 5)).toBe(false);
        expect(validateArrayLength('test', undefined, 5)).toBe(false);
        expect(logger.warn).not.toHaveBeenCalled();
    });

    test('returns false for non-array value', () => {
        expect(validateArrayLength('test', 'not-an-array' as any, 3)).toBe(false);
    });
});
