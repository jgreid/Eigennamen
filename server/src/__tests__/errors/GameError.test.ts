import {
    GameError,
    RoomError,
    PlayerError,
    GameStateError,
    ValidationError,
    RateLimitError,
    ServerError,
    SAFE_ERROR_CODES,
    sanitizeErrorForClient,
} from '../../errors/GameError';
import { ERROR_CODES } from '../../config/constants';

describe('GameError', () => {
    test('creates error with code, message, and details', () => {
        const error = new GameError(ERROR_CODES.SERVER_ERROR, 'test error', { roomCode: 'ABC' });

        expect(error).toBeInstanceOf(Error);
        expect(error).toBeInstanceOf(GameError);
        expect(error.name).toBe('GameError');
        expect(error.code).toBe(ERROR_CODES.SERVER_ERROR);
        expect(error.message).toBe('test error');
        expect(error.details).toEqual({ roomCode: 'ABC' });
        expect(error.timestamp).toBeGreaterThan(0);
    });

    test('defaults details to null', () => {
        const error = new GameError(ERROR_CODES.SERVER_ERROR, 'test');
        expect(error.details).toBeNull();
    });

    test('has proper stack trace', () => {
        const error = new GameError(ERROR_CODES.SERVER_ERROR, 'test');
        expect(error.stack).toBeDefined();
        expect(error.stack).toContain('GameError');
    });

    describe('toJSON', () => {
        test('serializes to plain object', () => {
            const error = new GameError(ERROR_CODES.ROOM_NOT_FOUND, 'not found', { roomCode: 'XYZ' });
            const json = error.toJSON();

            expect(json).toEqual({
                name: 'GameError',
                code: ERROR_CODES.ROOM_NOT_FOUND,
                message: 'not found',
                details: { roomCode: 'XYZ' },
                timestamp: expect.any(Number),
            });
        });
    });

    describe('isGameError', () => {
        test('returns true for GameError instances', () => {
            expect(GameError.isGameError(new GameError(ERROR_CODES.SERVER_ERROR, 'test'))).toBe(true);
        });

        test('returns true for subclass instances', () => {
            expect(GameError.isGameError(new RoomError(ERROR_CODES.ROOM_NOT_FOUND, 'test'))).toBe(true);
        });

        test('returns false for plain errors', () => {
            expect(GameError.isGameError(new Error('test'))).toBe(false);
        });

        test('returns false for non-errors', () => {
            expect(GameError.isGameError('string')).toBe(false);
            expect(GameError.isGameError(null)).toBe(false);
            expect(GameError.isGameError(undefined)).toBe(false);
        });
    });
});

describe('RoomError', () => {
    test('has correct name', () => {
        const error = new RoomError(ERROR_CODES.ROOM_NOT_FOUND, 'test');
        expect(error.name).toBe('RoomError');
        expect(error).toBeInstanceOf(GameError);
    });

    test('notFound factory', () => {
        const error = RoomError.notFound('ABC123');
        expect(error.code).toBe(ERROR_CODES.ROOM_NOT_FOUND);
        expect(error.details).toEqual({ roomCode: 'ABC123' });
    });

    test('full factory', () => {
        const error = RoomError.full('ABC123');
        expect(error.code).toBe(ERROR_CODES.ROOM_FULL);
    });

    test('gameInProgress factory', () => {
        const error = RoomError.gameInProgress('ABC123');
        expect(error.code).toBe(ERROR_CODES.GAME_IN_PROGRESS);
    });
});

describe('PlayerError', () => {
    test('has correct name', () => {
        expect(new PlayerError(ERROR_CODES.NOT_HOST, 'test').name).toBe('PlayerError');
    });

    test('notHost factory', () => {
        expect(PlayerError.notHost().code).toBe(ERROR_CODES.NOT_HOST);
    });

    test('notSpymaster factory', () => {
        expect(PlayerError.notSpymaster().code).toBe(ERROR_CODES.NOT_SPYMASTER);
    });

    test('notClicker factory', () => {
        expect(PlayerError.notClicker().code).toBe(ERROR_CODES.NOT_CLICKER);
    });

    test('notYourTurn factory includes team in details', () => {
        const error = PlayerError.notYourTurn('red');
        expect(error.code).toBe(ERROR_CODES.NOT_YOUR_TURN);
        expect(error.details).toEqual({ team: 'red' });
    });

    test('notAuthorized factory', () => {
        expect(PlayerError.notAuthorized().code).toBe(ERROR_CODES.NOT_AUTHORIZED);
    });

    test('notFound factory includes sessionId', () => {
        const error = PlayerError.notFound('sess-123');
        expect(error.code).toBe(ERROR_CODES.PLAYER_NOT_FOUND);
        expect(error.details).toEqual({ sessionId: 'sess-123' });
    });
});

describe('GameStateError', () => {
    test('cardAlreadyRevealed factory', () => {
        const error = GameStateError.cardAlreadyRevealed(5);
        expect(error.code).toBe(ERROR_CODES.CARD_ALREADY_REVEALED);
        expect(error.details).toEqual({ index: 5 });
    });

    test('gameOver factory', () => {
        expect(GameStateError.gameOver().code).toBe(ERROR_CODES.GAME_OVER);
    });

    test('noActiveGame factory', () => {
        expect(GameStateError.noActiveGame().code).toBe(ERROR_CODES.GAME_NOT_STARTED);
    });

    test('corrupted factory includes recoverable details', () => {
        const error = GameStateError.corrupted('ABC123');
        expect(error.code).toBe(ERROR_CODES.SERVER_ERROR);
        expect(error.details?.recoverable).toBe(true);
        expect(error.details?.suggestion).toBeDefined();
        expect(error.details?.roomCode).toBe('ABC123');
    });

    test('corrupted factory merges context', () => {
        const error = GameStateError.corrupted('ABC', { operation: 'reveal' });
        expect(error.details?.operation).toBe('reveal');
        expect(error.details?.roomCode).toBe('ABC');
    });
});

describe('ValidationError', () => {
    test('uses INVALID_INPUT code', () => {
        const error = new ValidationError('bad input');
        expect(error.code).toBe(ERROR_CODES.INVALID_INPUT);
        expect(error.name).toBe('ValidationError');
    });

    test('invalidCardIndex factory', () => {
        const error = ValidationError.invalidCardIndex(30, 25);
        expect(error.details).toEqual({ index: 30, max: 25 });
    });

    test('noGuessesRemaining factory', () => {
        const error = ValidationError.noGuessesRemaining();
        expect(error.message).toContain('guesses');
    });
});

describe('RateLimitError', () => {
    test('uses RATE_LIMITED code with default message', () => {
        const error = new RateLimitError();
        expect(error.code).toBe(ERROR_CODES.RATE_LIMITED);
        expect(error.message).toContain('slow down');
    });

    test('accepts custom message', () => {
        const error = new RateLimitError('custom limit');
        expect(error.message).toBe('custom limit');
    });
});

describe('ServerError', () => {
    test('uses SERVER_ERROR code with default message', () => {
        const error = new ServerError();
        expect(error.code).toBe(ERROR_CODES.SERVER_ERROR);
        expect(error.message).toContain('internal server error');
    });

    test('concurrentModification factory', () => {
        const error = ServerError.concurrentModification('ABC', 'reveal');
        expect(error.details?.retryable).toBe(true);
        expect(error.details?.roomCode).toBe('ABC');
        expect(error.details?.operation).toBe('reveal');
    });

    test('concurrentModification with null args', () => {
        const error = ServerError.concurrentModification();
        expect(error.details?.roomCode).toBeUndefined();
        expect(error.details?.operation).toBeUndefined();
    });
});

describe('SAFE_ERROR_CODES', () => {
    test('is a non-empty readonly array', () => {
        expect(SAFE_ERROR_CODES.length).toBeGreaterThan(0);
    });

    test('includes common user-facing codes', () => {
        expect(SAFE_ERROR_CODES).toContain('ROOM_NOT_FOUND');
        expect(SAFE_ERROR_CODES).toContain('INVALID_INPUT');
        expect(SAFE_ERROR_CODES).toContain('NOT_HOST');
        expect(SAFE_ERROR_CODES).toContain('RATE_LIMITED');
    });

    test('does not include SERVER_ERROR (internal details)', () => {
        expect(SAFE_ERROR_CODES).not.toContain('SERVER_ERROR');
    });
});

describe('sanitizeErrorForClient', () => {
    test('preserves message for safe error codes', () => {
        const error = new GameError(ERROR_CODES.ROOM_NOT_FOUND, 'Room ABC not found');
        const sanitized = sanitizeErrorForClient(error);

        expect(sanitized.code).toBe(ERROR_CODES.ROOM_NOT_FOUND);
        expect(sanitized.message).toBe('Room ABC not found');
    });

    test('replaces message for unsafe error codes', () => {
        const error = new ServerError('Database connection failed at 10.0.0.1:5432');
        const sanitized = sanitizeErrorForClient(error);

        expect(sanitized.code).toBe(ERROR_CODES.SERVER_ERROR);
        expect(sanitized.message).toBe('An unexpected error occurred');
        expect(sanitized.message).not.toContain('Database');
    });

    test('handles plain Error objects', () => {
        const sanitized = sanitizeErrorForClient(new Error('some internal error'));
        expect(sanitized.code).toBe(ERROR_CODES.SERVER_ERROR);
        expect(sanitized.message).toBe('An unexpected error occurred');
    });

    test('handles null', () => {
        const sanitized = sanitizeErrorForClient(null);
        expect(sanitized.code).toBe(ERROR_CODES.SERVER_ERROR);
        expect(sanitized.message).toBe('An unexpected error occurred');
    });

    test('handles string thrown as error', () => {
        const sanitized = sanitizeErrorForClient('something went wrong');
        expect(sanitized.code).toBe(ERROR_CODES.SERVER_ERROR);
    });

    test('handles object with code and message', () => {
        const sanitized = sanitizeErrorForClient({ code: 'ROOM_NOT_FOUND', message: 'Not found' });
        expect(sanitized.code).toBe('ROOM_NOT_FOUND');
        expect(sanitized.message).toBe('Not found');
    });
});
