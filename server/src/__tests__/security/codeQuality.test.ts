/**
 * Code Quality Tests - Phase 4
 *
 * Tests for decomposed functions, retry utilities, and centralized constants
 * added in Phase 4 of the robustness improvements.
 */

const {
    validateCardIndex,
    validateRevealPreconditions,
    executeCardReveal,
    determineRevealOutcome,
    switchTurn,
    buildRevealResult
} = require('../../services/game/revealEngine');

const { ERROR_CODES } = require('../../config/constants');

// =============================================================================
// Decomposed Reveal Functions Tests
// =============================================================================

describe('Decomposed Reveal Functions', () => {

    describe('validateCardIndex', () => {
        it('should accept valid indices 0-24', () => {
            expect(() => validateCardIndex(0)).not.toThrow();
            expect(() => validateCardIndex(12)).not.toThrow();
            expect(() => validateCardIndex(24)).not.toThrow();
        });

        it('should reject negative indices', () => {
            expect(() => validateCardIndex(-1)).toThrow();
            expect(() => validateCardIndex(-100)).toThrow();
        });

        it('should reject indices >= BOARD_SIZE', () => {
            expect(() => validateCardIndex(25)).toThrow();
            expect(() => validateCardIndex(100)).toThrow();
        });

        it('should reject non-integer values', () => {
            expect(() => validateCardIndex(1.5)).toThrow();
            expect(() => validateCardIndex(0.1)).toThrow();
        });

        it('should reject NaN and Infinity', () => {
            expect(() => validateCardIndex(NaN)).toThrow();
            expect(() => validateCardIndex(Infinity)).toThrow();
            expect(() => validateCardIndex(-Infinity)).toThrow();
        });

        it('should reject non-number types', () => {
            expect(() => validateCardIndex('5')).toThrow();
            expect(() => validateCardIndex(null)).toThrow();
            expect(() => validateCardIndex(undefined)).toThrow();
            expect(() => validateCardIndex({})).toThrow();
        });
    });

    describe('validateRevealPreconditions', () => {
        const baseGame = {
            gameOver: false,
            currentClue: { word: 'TEST', number: 2 },
            guessesAllowed: 3,
            guessesUsed: 0,
            revealed: Array(25).fill(false)
        };

        it('should pass when all preconditions are met', () => {
            expect(() => validateRevealPreconditions(baseGame, 5)).not.toThrow();
        });

        it('should throw when game is over', () => {
            const game = { ...baseGame, gameOver: true };
            expect(() => validateRevealPreconditions(game, 5)).toThrow();
        });

        it('should allow reveal when no clue has been given (clue tracking removed)', () => {
            const game = { ...baseGame, currentClue: null };
            expect(() => validateRevealPreconditions(game, 5)).not.toThrow();
        });

        it('should throw when no guesses remaining', () => {
            const game = { ...baseGame, guessesAllowed: 3, guessesUsed: 3 };
            expect(() => validateRevealPreconditions(game, 5)).toThrow();
        });

        it('should allow unlimited guesses when guessesAllowed is 0', () => {
            const game = { ...baseGame, guessesAllowed: 0, guessesUsed: 10 };
            expect(() => validateRevealPreconditions(game, 5)).not.toThrow();
        });

        it('should throw when card is already revealed', () => {
            const revealed = Array(25).fill(false);
            revealed[5] = true;
            const game = { ...baseGame, revealed };
            expect(() => validateRevealPreconditions(game, 5)).toThrow();
        });
    });

    describe('executeCardReveal', () => {
        it('should reveal the card and increment guesses', () => {
            const game = {
                revealed: Array(25).fill(false),
                types: Array(25).fill('neutral'),
                redScore: 0,
                blueScore: 0,
                guessesUsed: 0
            };

            const type = executeCardReveal(game, 5);

            expect(game.revealed[5]).toBe(true);
            expect(game.guessesUsed).toBe(1);
            expect(type).toBe('neutral');
        });

        it('should increment red score for red cards', () => {
            const types = Array(25).fill('neutral');
            types[5] = 'red';
            const game = {
                revealed: Array(25).fill(false),
                types,
                redScore: 2,
                blueScore: 1,
                guessesUsed: 0
            };

            executeCardReveal(game, 5);

            expect(game.redScore).toBe(3);
            expect(game.blueScore).toBe(1);
        });

        it('should increment blue score for blue cards', () => {
            const types = Array(25).fill('neutral');
            types[5] = 'blue';
            const game = {
                revealed: Array(25).fill(false),
                types,
                redScore: 2,
                blueScore: 1,
                guessesUsed: 0
            };

            executeCardReveal(game, 5);

            expect(game.redScore).toBe(2);
            expect(game.blueScore).toBe(2);
        });

        it('should not increment scores for assassin', () => {
            const types = Array(25).fill('neutral');
            types[5] = 'assassin';
            const game = {
                revealed: Array(25).fill(false),
                types,
                redScore: 2,
                blueScore: 1,
                guessesUsed: 0
            };

            executeCardReveal(game, 5);

            expect(game.redScore).toBe(2);
            expect(game.blueScore).toBe(1);
        });
    });

    describe('determineRevealOutcome', () => {
        it('should end game when assassin is revealed', () => {
            const game = {
                gameOver: false,
                winner: null,
                redScore: 3,
                blueScore: 2,
                redTotal: 9,
                blueTotal: 8
            };

            const outcome = determineRevealOutcome(game, 'assassin', 'red');

            expect(game.gameOver).toBe(true);
            expect(game.winner).toBe('blue'); // Other team wins
            expect(outcome.endReason).toBe('assassin');
            expect(outcome.turnEnded).toBe(true);
        });

        it('should end game when red team completes all cards', () => {
            const game = {
                gameOver: false,
                winner: null,
                redScore: 9,
                blueScore: 2,
                redTotal: 9,
                blueTotal: 8
            };

            const outcome = determineRevealOutcome(game, 'red', 'red');

            expect(game.gameOver).toBe(true);
            expect(game.winner).toBe('red');
            expect(outcome.endReason).toBe('completed');
        });

        it('should end game when blue team completes all cards', () => {
            const game = {
                gameOver: false,
                winner: null,
                redScore: 3,
                blueScore: 8,
                redTotal: 9,
                blueTotal: 8
            };

            const outcome = determineRevealOutcome(game, 'blue', 'blue');

            expect(game.gameOver).toBe(true);
            expect(game.winner).toBe('blue');
            expect(outcome.endReason).toBe('completed');
        });

        it('should end turn when wrong card is revealed', () => {
            const game = {
                gameOver: false,
                winner: null,
                currentTurn: 'red',
                currentClue: { word: 'TEST' },
                guessesUsed: 1,
                guessesAllowed: 3,
                redScore: 3,
                blueScore: 2,
                redTotal: 9,
                blueTotal: 8
            };

            const outcome = determineRevealOutcome(game, 'blue', 'red');

            expect(game.gameOver).toBe(false);
            expect(game.currentTurn).toBe('blue');
            expect(game.currentClue).toBeNull();
            expect(outcome.turnEnded).toBe(true);
        });

        it('should end turn when max guesses reached', () => {
            const game = {
                gameOver: false,
                winner: null,
                currentTurn: 'red',
                currentClue: { word: 'TEST' },
                guessesUsed: 3,
                guessesAllowed: 3,
                redScore: 5,
                blueScore: 2,
                redTotal: 9,
                blueTotal: 8
            };

            const outcome = determineRevealOutcome(game, 'red', 'red');

            expect(game.currentTurn).toBe('blue');
            expect(outcome.turnEnded).toBe(true);
            expect(outcome.endReason).toBe('maxGuesses');
        });

        it('should continue turn for correct guess with guesses remaining', () => {
            const game = {
                gameOver: false,
                winner: null,
                currentTurn: 'red',
                currentClue: { word: 'TEST' },
                guessesUsed: 1,
                guessesAllowed: 3,
                redScore: 4,
                blueScore: 2,
                redTotal: 9,
                blueTotal: 8
            };

            const outcome = determineRevealOutcome(game, 'red', 'red');

            expect(game.currentTurn).toBe('red'); // Turn not switched
            expect(outcome.turnEnded).toBe(false);
            expect(outcome.endReason).toBeNull();
        });
    });

    describe('switchTurn', () => {
        it('should switch from red to blue', () => {
            const game = {
                currentTurn: 'red',
                currentClue: { word: 'TEST' },
                guessesUsed: 2,
                guessesAllowed: 3
            };

            switchTurn(game);

            expect(game.currentTurn).toBe('blue');
            expect(game.currentClue).toBeNull();
            expect(game.guessesUsed).toBe(0);
            expect(game.guessesAllowed).toBe(0);
        });

        it('should switch from blue to red', () => {
            const game = {
                currentTurn: 'blue',
                currentClue: { word: 'TEST' },
                guessesUsed: 2,
                guessesAllowed: 3
            };

            switchTurn(game);

            expect(game.currentTurn).toBe('red');
        });
    });

    describe('buildRevealResult', () => {
        it('should build complete result object', () => {
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
            const outcome = { turnEnded: true, endReason: null };

            const result = buildRevealResult(game, 1, 'blue', outcome);

            expect(result.index).toBe(1);
            expect(result.type).toBe('blue');
            expect(result.word).toBe('BANANA');
            expect(result.redScore).toBe(3);
            expect(result.blueScore).toBe(2);
            expect(result.currentTurn).toBe('blue');
            expect(result.turnEnded).toBe(true);
            expect(result.gameOver).toBe(false);
            expect(result.allTypes).toBeNull();
        });

        it('should include allTypes when game is over', () => {
            const game = {
                words: ['APPLE', 'BANANA', 'CHERRY'],
                redScore: 9,
                blueScore: 2,
                currentTurn: 'red',
                guessesUsed: 1,
                guessesAllowed: 3,
                gameOver: true,
                winner: 'red',
                types: ['red', 'blue', 'assassin']
            };
            const outcome = { turnEnded: true, endReason: 'completed' };

            const result = buildRevealResult(game, 0, 'red', outcome);

            expect(result.gameOver).toBe(true);
            expect(result.winner).toBe('red');
            expect(result.endReason).toBe('completed');
            expect(result.allTypes).toEqual(['red', 'blue', 'assassin']);
        });
    });
});

// =============================================================================
// GameError Classes Tests
// =============================================================================

describe('GameError Classes', () => {
    const {
        GameError,
        RoomError,
        PlayerError,
        GameStateError,
        ValidationError,
        RateLimitError,
        ServerError
    } = require('../../errors/GameError');

    describe('GameError base class', () => {
        it('should create error with code and message', () => {
            const error = new GameError('TEST_CODE', 'Test message');
            expect(error.code).toBe('TEST_CODE');
            expect(error.message).toBe('Test message');
            expect(error.name).toBe('GameError');
            expect(error.timestamp).toBeDefined();
        });

        it('should support details parameter', () => {
            const error = new GameError('TEST_CODE', 'Test message', { foo: 'bar' });
            expect(error.details).toEqual({ foo: 'bar' });
        });

        it('should serialize to JSON', () => {
            const error = new GameError('TEST_CODE', 'Test message', { foo: 'bar' });
            const json = error.toJSON();
            expect(json.code).toBe('TEST_CODE');
            expect(json.message).toBe('Test message');
            expect(json.details).toEqual({ foo: 'bar' });
        });

        it('should detect GameError instances', () => {
            const gameError = new GameError('TEST', 'test');
            const regularError = new Error('test');
            expect(GameError.isGameError(gameError)).toBe(true);
            expect(GameError.isGameError(regularError)).toBe(false);
        });
    });

    describe('RoomError', () => {
        it('should create notFound error', () => {
            const error = RoomError.notFound('ABC123');
            expect(error.code).toBe(ERROR_CODES.ROOM_NOT_FOUND);
            expect(error.name).toBe('RoomError');
            expect(error.details.roomCode).toBe('ABC123');
        });

        it('should create full error', () => {
            const error = RoomError.full('ABC123');
            expect(error.code).toBe(ERROR_CODES.ROOM_FULL);
        });

        it('should create gameInProgress error', () => {
            const error = RoomError.gameInProgress('ABC123');
            expect(error.code).toBe(ERROR_CODES.GAME_IN_PROGRESS);
        });
    });

    describe('PlayerError', () => {
        it('should create notHost error', () => {
            const error = PlayerError.notHost();
            expect(error.code).toBe(ERROR_CODES.NOT_HOST);
            expect(error.name).toBe('PlayerError');
        });

        it('should create notSpymaster error', () => {
            const error = PlayerError.notSpymaster();
            expect(error.code).toBe(ERROR_CODES.NOT_SPYMASTER);
        });

        it('should create notYourTurn error with team details', () => {
            const error = PlayerError.notYourTurn('red');
            expect(error.code).toBe(ERROR_CODES.NOT_YOUR_TURN);
            expect(error.details.team).toBe('red');
        });
    });

    describe('GameStateError', () => {
        it('should create cardAlreadyRevealed error', () => {
            const error = GameStateError.cardAlreadyRevealed(5);
            expect(error.code).toBe(ERROR_CODES.CARD_ALREADY_REVEALED);
            expect(error.details.index).toBe(5);
        });

        it('should create gameOver error', () => {
            const error = GameStateError.gameOver();
            expect(error.code).toBe(ERROR_CODES.GAME_OVER);
        });

        it('should create corrupted error', () => {
            const error = GameStateError.corrupted('ABC123');
            expect(error.code).toBe(ERROR_CODES.SERVER_ERROR);
            expect(error.details.roomCode).toBe('ABC123');
        });
    });

    describe('ValidationError', () => {
        it('should create with INVALID_INPUT code', () => {
            const error = new ValidationError('Invalid data');
            expect(error.code).toBe(ERROR_CODES.INVALID_INPUT);
            expect(error.name).toBe('ValidationError');
        });

        it('should create invalidCardIndex error', () => {
            const error = ValidationError.invalidCardIndex(30, 25);
            expect(error.message).toContain('Invalid card index');
            expect(error.details.index).toBe(30);
        });

        it('should create noGuessesRemaining error', () => {
            const error = ValidationError.noGuessesRemaining();
            expect(error.message).toContain('No guesses remaining');
        });
    });

    describe('RateLimitError', () => {
        it('should create with RATE_LIMITED code', () => {
            const error = new RateLimitError();
            expect(error.code).toBe(ERROR_CODES.RATE_LIMITED);
            expect(error.name).toBe('RateLimitError');
        });
    });

    describe('ServerError', () => {
        it('should create with SERVER_ERROR code', () => {
            const error = new ServerError('Something went wrong');
            expect(error.code).toBe(ERROR_CODES.SERVER_ERROR);
        });

        it('should create concurrentModification error', () => {
            const error = ServerError.concurrentModification();
            expect(error.message).toContain('concurrent modifications');
        });
    });

});
