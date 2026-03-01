/**
 * GameError Classes Tests
 *
 * Tests for the GameError hierarchy (GameError, RoomError, PlayerError, etc.)
 */

const { ERROR_CODES } = require('../../config/constants');

describe('GameError Classes', () => {
    const {
        GameError,
        RoomError,
        PlayerError,
        GameStateError,
        ValidationError,
        RateLimitError,
        ServerError,
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
