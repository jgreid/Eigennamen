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
        gameMode: 'classic',
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
    test('returns true for "red"', () => {
        expect(isValidTeam('red')).toBe(true);
    });

    test('returns true for "blue"', () => {
        expect(isValidTeam('blue')).toBe(true);
    });

    test('returns false for "green"', () => {
        expect(isValidTeam('green')).toBe(false);
    });

    test('returns false for empty string', () => {
        expect(isValidTeam('')).toBe(false);
    });

    test('returns false for null', () => {
        expect(isValidTeam(null)).toBe(false);
    });

    test('returns false for undefined', () => {
        expect(isValidTeam(undefined)).toBe(false);
    });

    test('returns false for a number', () => {
        expect(isValidTeam(42)).toBe(false);
    });

    test('returns false for a boolean', () => {
        expect(isValidTeam(true)).toBe(false);
    });

    test('returns false for an object', () => {
        expect(isValidTeam({ team: 'red' })).toBe(false);
    });

    test('returns false for uppercase "Red"', () => {
        expect(isValidTeam('Red')).toBe(false);
    });
});

describe('isValidRole', () => {
    test('returns true for "spymaster"', () => {
        expect(isValidRole('spymaster')).toBe(true);
    });

    test('returns true for "clicker"', () => {
        expect(isValidRole('clicker')).toBe(true);
    });

    test('returns true for "spectator"', () => {
        expect(isValidRole('spectator')).toBe(true);
    });

    test('returns false for "admin"', () => {
        expect(isValidRole('admin')).toBe(false);
    });

    test('returns false for empty string', () => {
        expect(isValidRole('')).toBe(false);
    });

    test('returns false for null', () => {
        expect(isValidRole(null)).toBe(false);
    });

    test('returns false for undefined', () => {
        expect(isValidRole(undefined)).toBe(false);
    });

    test('returns false for a number', () => {
        expect(isValidRole(123)).toBe(false);
    });

    test('returns false for uppercase "Spymaster"', () => {
        expect(isValidRole('Spymaster')).toBe(false);
    });
});

describe('isValidGameMode', () => {
    test('returns true for "classic"', () => {
        expect(isValidGameMode('classic')).toBe(true);
    });

    test('returns false for "blitz" (removed mode)', () => {
        expect(isValidGameMode('blitz')).toBe(false);
    });

    test('returns true for "duet"', () => {
        expect(isValidGameMode('duet')).toBe(true);
    });

    test('returns false for "ranked"', () => {
        expect(isValidGameMode('ranked')).toBe(false);
    });

    test('returns false for empty string', () => {
        expect(isValidGameMode('')).toBe(false);
    });

    test('returns false for null', () => {
        expect(isValidGameMode(null)).toBe(false);
    });

    test('returns false for undefined', () => {
        expect(isValidGameMode(undefined)).toBe(false);
    });

    test('returns false for a number', () => {
        expect(isValidGameMode(0)).toBe(false);
    });

    test('returns false for uppercase "Classic"', () => {
        expect(isValidGameMode('Classic')).toBe(false);
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

    test('spymaster on blue sets spymasterTeam=blue and clickerTeam=null', () => {
        setPlayerRole('spymaster', 'blue');
        expect(state.playerTeam).toBe('blue');
        expect(state.spymasterTeam).toBe('blue');
        expect(state.clickerTeam).toBeNull();
    });

    test('clicker on red sets clickerTeam=red and spymasterTeam=null', () => {
        setPlayerRole('clicker', 'red');
        expect(state.playerTeam).toBe('red');
        expect(state.clickerTeam).toBe('red');
        expect(state.spymasterTeam).toBeNull();
    });

    test('clicker on blue sets clickerTeam=blue and spymasterTeam=null', () => {
        setPlayerRole('clicker', 'blue');
        expect(state.playerTeam).toBe('blue');
        expect(state.clickerTeam).toBe('blue');
        expect(state.spymasterTeam).toBeNull();
    });

    test('spectator sets both spymasterTeam and clickerTeam to null', () => {
        // First set a role so we can verify it gets cleared
        state.spymasterTeam = 'red';
        state.clickerTeam = 'blue';
        setPlayerRole('spectator', 'red');
        expect(state.playerTeam).toBe('red');
        expect(state.spymasterTeam).toBeNull();
        expect(state.clickerTeam).toBeNull();
    });

    test('spectator with null team sets all to null', () => {
        setPlayerRole('spectator', null);
        expect(state.playerTeam).toBeNull();
        expect(state.spymasterTeam).toBeNull();
        expect(state.clickerTeam).toBeNull();
    });

    test('invalid team normalizes playerTeam to null', () => {
        setPlayerRole('spymaster', 'green');
        expect(state.playerTeam).toBeNull();
        // spymaster requires a valid team, so both should be null
        expect(state.spymasterTeam).toBeNull();
        expect(state.clickerTeam).toBeNull();
    });

    test('clicker with invalid team normalizes to null', () => {
        setPlayerRole('clicker', 'invalid');
        expect(state.playerTeam).toBeNull();
        expect(state.clickerTeam).toBeNull();
        expect(state.spymasterTeam).toBeNull();
    });

    test('null role with valid team sets playerTeam but clears role teams', () => {
        setPlayerRole(null, 'red');
        expect(state.playerTeam).toBe('red');
        expect(state.spymasterTeam).toBeNull();
        expect(state.clickerTeam).toBeNull();
    });

    test('null role with null team sets everything to null', () => {
        state.spymasterTeam = 'red';
        state.clickerTeam = 'blue';
        state.playerTeam = 'red';
        setPlayerRole(null, null);
        expect(state.playerTeam).toBeNull();
        expect(state.spymasterTeam).toBeNull();
        expect(state.clickerTeam).toBeNull();
    });

    test('switching from spymaster to clicker on same team clears spymasterTeam', () => {
        setPlayerRole('spymaster', 'red');
        expect(state.spymasterTeam).toBe('red');
        setPlayerRole('clicker', 'red');
        expect(state.clickerTeam).toBe('red');
        expect(state.spymasterTeam).toBeNull();
    });

    test('switching from clicker to spymaster on same team clears clickerTeam', () => {
        setPlayerRole('clicker', 'blue');
        expect(state.clickerTeam).toBe('blue');
        setPlayerRole('spymaster', 'blue');
        expect(state.spymasterTeam).toBe('blue');
        expect(state.clickerTeam).toBeNull();
    });
});

describe('clearPlayerRole', () => {
    test('resets playerTeam, spymasterTeam, and clickerTeam to null', () => {
        state.playerTeam = 'red';
        state.spymasterTeam = 'red';
        state.clickerTeam = 'blue';
        clearPlayerRole();
        expect(state.playerTeam).toBeNull();
        expect(state.spymasterTeam).toBeNull();
        expect(state.clickerTeam).toBeNull();
    });

    test('is idempotent when already null', () => {
        state.playerTeam = null;
        state.spymasterTeam = null;
        state.clickerTeam = null;
        clearPlayerRole();
        expect(state.playerTeam).toBeNull();
        expect(state.spymasterTeam).toBeNull();
        expect(state.clickerTeam).toBeNull();
    });
});

// ========== RESET ==========

describe('resetGameState', () => {
    test('resets words, types, and revealed to empty arrays', () => {
        resetGameState();
        expect(state.gameState.words).toEqual([]);
        expect(state.gameState.types).toEqual([]);
        expect(state.gameState.revealed).toEqual([]);
    });

    test('resets currentTurn to "red"', () => {
        resetGameState();
        expect(state.gameState.currentTurn).toBe('red');
    });

    test('resets scores to zero', () => {
        resetGameState();
        expect(state.gameState.redScore).toBe(0);
        expect(state.gameState.blueScore).toBe(0);
    });

    test('resets totals to default values', () => {
        resetGameState();
        expect(state.gameState.redTotal).toBe(9);
        expect(state.gameState.blueTotal).toBe(8);
    });

    test('resets gameOver and winner', () => {
        resetGameState();
        expect(state.gameState.gameOver).toBe(false);
        expect(state.gameState.winner).toBeNull();
    });

    test('resets seed to null', () => {
        resetGameState();
        expect(state.gameState.seed).toBeNull();
    });

    test('resets clue state', () => {
        resetGameState();
        expect(state.gameState.currentClue).toBeNull();
        expect(state.gameState.guessesUsed).toBe(0);
        expect(state.gameState.guessesAllowed).toBe(0);
    });

    test('resets status to "waiting"', () => {
        resetGameState();
        expect(state.gameState.status).toBe('waiting');
    });

    test('resets duet-specific fields', () => {
        resetGameState();
        expect(state.gameState.duetTypes).toEqual([]);
        expect(state.gameState.timerTokens).toBe(0);
        expect(state.gameState.greenFound).toBe(0);
        expect(state.gameState.greenTotal).toBe(0);
    });

    test('resets gameMode to "classic"', () => {
        resetGameState();
        expect(state.gameMode).toBe('classic');
    });

    test('resets all fields in a single call from dirty state', () => {
        // State was already dirtied by resetMockState in beforeEach
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
            // Match mode
            cardScores: [],
            revealedBy: [],
            matchRound: 0,
            redMatchScore: 0,
            blueMatchScore: 0,
            roundHistory: [],
            matchOver: false,
            matchWinner: null,
        });
        expect(state.gameMode).toBe('classic');
    });
});

// ========== VALIDATORS ==========

describe('validateTurn', () => {
    test('returns "red" for "red"', () => {
        expect(validateTurn('red')).toBe('red');
    });

    test('returns "blue" for "blue"', () => {
        expect(validateTurn('blue')).toBe('blue');
    });

    test('returns default fallback "red" for invalid string', () => {
        expect(validateTurn('green')).toBe('red');
    });

    test('returns default fallback "red" for null', () => {
        expect(validateTurn(null)).toBe('red');
    });

    test('returns default fallback "red" for undefined', () => {
        expect(validateTurn(undefined)).toBe('red');
    });

    test('returns default fallback "red" for a number', () => {
        expect(validateTurn(42)).toBe('red');
    });

    test('returns custom fallback when provided', () => {
        expect(validateTurn('invalid', 'blue')).toBe('blue');
    });

    test('returns default fallback for empty string', () => {
        expect(validateTurn('')).toBe('red');
    });

    test('returns default fallback for boolean', () => {
        expect(validateTurn(true)).toBe('red');
    });
});

describe('validateWinner', () => {
    test('returns "red" for "red"', () => {
        expect(validateWinner('red')).toBe('red');
    });

    test('returns "blue" for "blue"', () => {
        expect(validateWinner('blue')).toBe('blue');
    });

    test('returns null for invalid string', () => {
        expect(validateWinner('green')).toBeNull();
    });

    test('returns null for null', () => {
        expect(validateWinner(null)).toBeNull();
    });

    test('returns null for undefined', () => {
        expect(validateWinner(undefined)).toBeNull();
    });

    test('returns null for a number', () => {
        expect(validateWinner(99)).toBeNull();
    });

    test('returns null for empty string', () => {
        expect(validateWinner('')).toBeNull();
    });

    test('returns null for a boolean', () => {
        expect(validateWinner(false)).toBeNull();
    });

    test('returns null for an object', () => {
        expect(validateWinner({ winner: 'red' })).toBeNull();
    });
});

describe('validateGameMode', () => {
    test('returns "classic" for "classic"', () => {
        expect(validateGameMode('classic')).toBe('classic');
    });

    test('returns "classic" for invalid "blitz"', () => {
        expect(validateGameMode('blitz')).toBe('classic');
    });

    test('returns "duet" for "duet"', () => {
        expect(validateGameMode('duet')).toBe('duet');
    });

    test('returns "classic" for invalid string', () => {
        expect(validateGameMode('ranked')).toBe('classic');
    });

    test('returns "classic" for null', () => {
        expect(validateGameMode(null)).toBe('classic');
    });

    test('returns "classic" for undefined', () => {
        expect(validateGameMode(undefined)).toBe('classic');
    });

    test('returns "classic" for a number', () => {
        expect(validateGameMode(1)).toBe('classic');
    });

    test('returns "classic" for empty string', () => {
        expect(validateGameMode('')).toBe('classic');
    });

    test('returns "classic" for uppercase "Classic"', () => {
        expect(validateGameMode('Classic')).toBe('classic');
    });

    test('returns "classic" for boolean', () => {
        expect(validateGameMode(true)).toBe('classic');
    });
});

describe('validateArrayLength', () => {
    test('returns true when array length matches expected', () => {
        expect(validateArrayLength('test', [1, 2, 3], 3)).toBe(true);
    });

    test('returns true for empty array with expected length 0', () => {
        expect(validateArrayLength('test', [], 0)).toBe(true);
    });

    test('returns false when array length does not match and logs warning', () => {
        const result = validateArrayLength('words', [1, 2], 5);
        expect(result).toBe(false);
        expect(logger.warn).toHaveBeenCalledWith('words array length mismatch: got 2, expected 5');
    });

    test('returns false for null array', () => {
        expect(validateArrayLength('test', null as any, 5)).toBe(false);
    });

    test('returns false for undefined array', () => {
        expect(validateArrayLength('test', undefined, 5)).toBe(false);
    });

    test('does not log warning for null array', () => {
        validateArrayLength('test', null as any, 5);
        expect(logger.warn).not.toHaveBeenCalled();
    });

    test('does not log warning for undefined array', () => {
        validateArrayLength('test', undefined, 5);
        expect(logger.warn).not.toHaveBeenCalled();
    });

    test('returns false for non-array value', () => {
        expect(validateArrayLength('test', 'not-an-array' as any, 3)).toBe(false);
    });

    test('logs warning with correct name and lengths for mismatch', () => {
        validateArrayLength('types', ['a', 'b', 'c'], 25);
        expect(logger.warn).toHaveBeenCalledWith('types array length mismatch: got 3, expected 25');
    });

    test('returns true for array of length 25 when expected is 25', () => {
        const arr = Array(25).fill('x');
        expect(validateArrayLength('board', arr, 25)).toBe(true);
    });

    test('does not log warning when lengths match', () => {
        validateArrayLength('test', [1, 2, 3], 3);
        expect(logger.warn).not.toHaveBeenCalled();
    });
});
