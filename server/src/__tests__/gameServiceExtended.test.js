/**
 * Extended Game Service Tests
 *
 * Tests for decomposed reveal functions and game operations
 * to improve coverage from 42% to 65%+
 */

const {
    validateCardIndex,
    validateRevealPreconditions,
    executeCardReveal,
    determineRevealOutcome,
    switchTurn,
    buildRevealResult,
    validateClueWord
} = require('../services/gameService');

const { BOARD_SIZE, ERROR_CODES } = require('../config/constants');

describe('validateCardIndex', () => {
    test('accepts valid indices 0-24', () => {
        for (let i = 0; i < BOARD_SIZE; i++) {
            expect(() => validateCardIndex(i)).not.toThrow();
        }
    });

    test('rejects negative indices', () => {
        expect(() => validateCardIndex(-1)).toThrow();
        expect(() => validateCardIndex(-100)).toThrow();
    });

    test('rejects indices >= BOARD_SIZE', () => {
        expect(() => validateCardIndex(25)).toThrow();
        expect(() => validateCardIndex(100)).toThrow();
    });

    test('rejects non-integer values', () => {
        expect(() => validateCardIndex(1.5)).toThrow();
        expect(() => validateCardIndex(2.999)).toThrow();
    });

    test('rejects non-number types', () => {
        expect(() => validateCardIndex('5')).toThrow();
        expect(() => validateCardIndex(null)).toThrow();
        expect(() => validateCardIndex(undefined)).toThrow();
        expect(() => validateCardIndex({})).toThrow();
    });

    test('rejects NaN and Infinity', () => {
        expect(() => validateCardIndex(NaN)).toThrow();
        expect(() => validateCardIndex(Infinity)).toThrow();
        expect(() => validateCardIndex(-Infinity)).toThrow();
    });

    test('error has correct code', () => {
        try {
            validateCardIndex(-1);
        } catch (error) {
            expect(error.code).toBe(ERROR_CODES.INVALID_INPUT);
        }
    });
});

describe('validateRevealPreconditions', () => {
    const createMockGame = (overrides = {}) => ({
        gameOver: false,
        currentClue: { word: 'TEST', number: 2 },
        guessesAllowed: 3,
        guessesUsed: 0,
        revealed: Array(BOARD_SIZE).fill(false),
        ...overrides
    });

    test('passes with valid game state', () => {
        const game = createMockGame();
        expect(() => validateRevealPreconditions(game, 0)).not.toThrow();
    });

    test('rejects when game is over', () => {
        const game = createMockGame({ gameOver: true });
        expect(() => validateRevealPreconditions(game, 0)).toThrow();

        try {
            validateRevealPreconditions(game, 0);
        } catch (error) {
            expect(error.code).toBe(ERROR_CODES.GAME_OVER);
        }
    });

    test('rejects when no clue given', () => {
        const game = createMockGame({ currentClue: null });
        expect(() => validateRevealPreconditions(game, 0)).toThrow();

        try {
            validateRevealPreconditions(game, 0);
        } catch (error) {
            expect(error.code).toBe(ERROR_CODES.INVALID_INPUT);
            expect(error.message).toContain('clue');
        }
    });

    test('rejects when max guesses reached', () => {
        const game = createMockGame({ guessesAllowed: 3, guessesUsed: 3 });
        expect(() => validateRevealPreconditions(game, 0)).toThrow();

        try {
            validateRevealPreconditions(game, 0);
        } catch (error) {
            expect(error.code).toBe(ERROR_CODES.INVALID_INPUT);
            expect(error.message).toContain('guesses');
        }
    });

    test('allows unlimited guesses when guessesAllowed is 0', () => {
        const game = createMockGame({ guessesAllowed: 0, guessesUsed: 10 });
        expect(() => validateRevealPreconditions(game, 0)).not.toThrow();
    });

    test('rejects already revealed card', () => {
        const revealed = Array(BOARD_SIZE).fill(false);
        revealed[5] = true;
        const game = createMockGame({ revealed });

        expect(() => validateRevealPreconditions(game, 5)).toThrow();

        try {
            validateRevealPreconditions(game, 5);
        } catch (error) {
            expect(error.code).toBe(ERROR_CODES.CARD_ALREADY_REVEALED);
        }
    });
});

describe('executeCardReveal', () => {
    const createMockGame = (overrides = {}) => ({
        revealed: Array(BOARD_SIZE).fill(false),
        types: ['red', 'blue', 'neutral', 'assassin', ...Array(21).fill('neutral')],
        redScore: 0,
        blueScore: 0,
        guessesUsed: 0,
        ...overrides
    });

    test('reveals card and returns type', () => {
        const game = createMockGame();
        const type = executeCardReveal(game, 0);

        expect(type).toBe('red');
        expect(game.revealed[0]).toBe(true);
    });

    test('increments red score for red card', () => {
        const game = createMockGame();
        executeCardReveal(game, 0);

        expect(game.redScore).toBe(1);
        expect(game.blueScore).toBe(0);
    });

    test('increments blue score for blue card', () => {
        const game = createMockGame();
        executeCardReveal(game, 1);

        expect(game.blueScore).toBe(1);
        expect(game.redScore).toBe(0);
    });

    test('does not change score for neutral card', () => {
        const game = createMockGame();
        executeCardReveal(game, 2);

        expect(game.redScore).toBe(0);
        expect(game.blueScore).toBe(0);
    });

    test('does not change score for assassin card', () => {
        const game = createMockGame();
        executeCardReveal(game, 3);

        expect(game.redScore).toBe(0);
        expect(game.blueScore).toBe(0);
    });

    test('increments guessesUsed', () => {
        const game = createMockGame({ guessesUsed: 1 });
        executeCardReveal(game, 0);

        expect(game.guessesUsed).toBe(2);
    });

    test('handles undefined guessesUsed', () => {
        const game = createMockGame();
        delete game.guessesUsed;

        executeCardReveal(game, 0);
        expect(game.guessesUsed).toBe(1);
    });
});

describe('determineRevealOutcome', () => {
    const createMockGame = (overrides = {}) => ({
        gameOver: false,
        winner: null,
        redScore: 0,
        blueScore: 0,
        redTotal: 9,
        blueTotal: 8,
        currentTurn: 'red',
        guessesUsed: 1,
        guessesAllowed: 3,
        ...overrides
    });

    test('assassin ends game, other team wins', () => {
        const game = createMockGame({ currentTurn: 'red' });
        const outcome = determineRevealOutcome(game, 'assassin', 'red');

        expect(game.gameOver).toBe(true);
        expect(game.winner).toBe('blue');
        expect(outcome.turnEnded).toBe(true);
        expect(outcome.endReason).toBe('assassin');
    });

    test('assassin - blue revealing loses to red', () => {
        const game = createMockGame({ currentTurn: 'blue' });
        const outcome = determineRevealOutcome(game, 'assassin', 'blue');

        expect(game.winner).toBe('red');
    });

    test('red wins by completing all cards', () => {
        const game = createMockGame({ redScore: 9, redTotal: 9 });
        const outcome = determineRevealOutcome(game, 'red', 'red');

        expect(game.gameOver).toBe(true);
        expect(game.winner).toBe('red');
        expect(outcome.endReason).toBe('completed');
    });

    test('blue wins by completing all cards', () => {
        const game = createMockGame({ blueScore: 8, blueTotal: 8 });
        const outcome = determineRevealOutcome(game, 'blue', 'blue');

        expect(game.gameOver).toBe(true);
        expect(game.winner).toBe('blue');
        expect(outcome.endReason).toBe('completed');
    });

    test('wrong guess ends turn', () => {
        const game = createMockGame({ currentTurn: 'red' });
        const outcome = determineRevealOutcome(game, 'blue', 'red');

        expect(game.gameOver).toBe(false);
        expect(game.currentTurn).toBe('blue');
        expect(outcome.turnEnded).toBe(true);
    });

    test('neutral card ends turn', () => {
        const game = createMockGame({ currentTurn: 'red' });
        const outcome = determineRevealOutcome(game, 'neutral', 'red');

        expect(game.currentTurn).toBe('blue');
        expect(outcome.turnEnded).toBe(true);
    });

    test('correct guess continues turn', () => {
        const game = createMockGame({ currentTurn: 'red', guessesUsed: 1, guessesAllowed: 3 });
        const outcome = determineRevealOutcome(game, 'red', 'red');

        expect(game.currentTurn).toBe('red');
        expect(outcome.turnEnded).toBe(false);
    });

    test('max guesses reached ends turn', () => {
        const game = createMockGame({ currentTurn: 'red', guessesUsed: 3, guessesAllowed: 3 });
        const outcome = determineRevealOutcome(game, 'red', 'red');

        expect(game.currentTurn).toBe('blue');
        expect(outcome.turnEnded).toBe(true);
        expect(outcome.endReason).toBe('maxGuesses');
    });

    test('unlimited guesses (guessesAllowed=0) allows continuing', () => {
        const game = createMockGame({ currentTurn: 'red', guessesUsed: 10, guessesAllowed: 0 });
        const outcome = determineRevealOutcome(game, 'red', 'red');

        expect(game.currentTurn).toBe('red');
        expect(outcome.turnEnded).toBe(false);
    });
});

describe('switchTurn', () => {
    test('switches from red to blue', () => {
        const game = {
            currentTurn: 'red',
            currentClue: { word: 'TEST', number: 2 },
            guessesUsed: 2,
            guessesAllowed: 3
        };

        switchTurn(game);

        expect(game.currentTurn).toBe('blue');
        expect(game.currentClue).toBeNull();
        expect(game.guessesUsed).toBe(0);
        expect(game.guessesAllowed).toBe(0);
    });

    test('switches from blue to red', () => {
        const game = {
            currentTurn: 'blue',
            currentClue: { word: 'OTHER', number: 1 },
            guessesUsed: 1,
            guessesAllowed: 2
        };

        switchTurn(game);

        expect(game.currentTurn).toBe('red');
        expect(game.currentClue).toBeNull();
    });
});

describe('buildRevealResult', () => {
    test('builds complete result object', () => {
        const game = {
            words: ['APPLE', 'BANANA', 'CHERRY'],
            redScore: 3,
            blueScore: 2,
            currentTurn: 'blue',
            guessesUsed: 1,
            guessesAllowed: 3,
            gameOver: false,
            winner: null,
            types: ['red', 'blue', 'neutral']
        };

        const outcome = { turnEnded: false, endReason: null };
        const result = buildRevealResult(game, 0, 'red', outcome);

        expect(result).toEqual({
            index: 0,
            type: 'red',
            word: 'APPLE',
            redScore: 3,
            blueScore: 2,
            currentTurn: 'blue',
            guessesUsed: 1,
            guessesAllowed: 3,
            turnEnded: false,
            gameOver: false,
            winner: null,
            endReason: null,
            allTypes: null
        });
    });

    test('includes allTypes when game is over', () => {
        const game = {
            words: ['APPLE'],
            redScore: 9,
            blueScore: 8,
            currentTurn: 'red',
            guessesUsed: 1,
            guessesAllowed: 3,
            gameOver: true,
            winner: 'red',
            types: ['red', 'blue', 'neutral']
        };

        const outcome = { turnEnded: true, endReason: 'completed' };
        const result = buildRevealResult(game, 0, 'red', outcome);

        expect(result.allTypes).toEqual(['red', 'blue', 'neutral']);
    });
});

describe('validateClueWord edge cases', () => {
    const boardWords = ['APPLE', 'BANANA', 'CHERRY'];

    test('handles special characters in board words gracefully', () => {
        const specialBoard = ['NEW YORK', "O'BRIEN", 'ROCK-PAPER'];
        const result = validateClueWord('CITY', specialBoard);
        expect(result.valid).toBe(true);
    });

    test('trims whitespace before validation', () => {
        const result = validateClueWord('  FRUIT  ', boardWords);
        expect(result.valid).toBe(true);
    });

    test('handles numbers in words', () => {
        const boardWithNumbers = ['CATCH22', 'AREA51'];
        const result = validateClueWord('CATCH', boardWithNumbers);
        expect(result.valid).toBe(false);
    });

    test('validates against all board words', () => {
        // Should check all words, not just first
        const result = validateClueWord('CHER', boardWords);
        expect(result.valid).toBe(false);
        expect(result.reason).toContain('CHERRY');
    });

    test('handles unicode characters', () => {
        const unicodeBoard = ['CAFÉ', 'NAÏVE'];
        const result = validateClueWord('COFFEE', unicodeBoard);
        expect(result.valid).toBe(true);
    });
});

describe('Game State Edge Cases', () => {
    test('executeCardReveal handles multiple reveals correctly', () => {
        const game = {
            revealed: Array(25).fill(false),
            types: Array(9).fill('red').concat(Array(8).fill('blue'), Array(7).fill('neutral'), ['assassin']),
            redScore: 0,
            blueScore: 0,
            guessesUsed: 0
        };

        // Reveal multiple red cards
        executeCardReveal(game, 0);
        executeCardReveal(game, 1);
        executeCardReveal(game, 2);

        expect(game.redScore).toBe(3);
        expect(game.guessesUsed).toBe(3);
        expect(game.revealed[0]).toBe(true);
        expect(game.revealed[1]).toBe(true);
        expect(game.revealed[2]).toBe(true);
        expect(game.revealed[3]).toBe(false);
    });

    test('determineRevealOutcome handles edge case of exact total match', () => {
        // Game where red needs exactly 1 more card
        const game = {
            gameOver: false,
            winner: null,
            redScore: 8,
            blueScore: 7,
            redTotal: 9,
            blueTotal: 8,
            currentTurn: 'red',
            guessesUsed: 1,
            guessesAllowed: 3
        };

        // Red reveals their last card
        game.redScore = 9;
        const outcome = determineRevealOutcome(game, 'red', 'red');

        expect(game.gameOver).toBe(true);
        expect(game.winner).toBe('red');
    });
});
