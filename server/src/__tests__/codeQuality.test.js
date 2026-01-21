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
} = require('../services/gameService');

const {
    withRetry,
    createRetryWrapper,
    isRetryableError,
    isConcurrentModificationError,
    sleep
} = require('../utils/retry');

const {
    SOCKET_EVENTS,
    TTL,
    RETRY_CONFIG,
    BOARD_SIZE,
    ERROR_CODES
} = require('../config/constants');

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

        it('should throw when no clue has been given', () => {
            const game = { ...baseGame, currentClue: null };
            expect(() => validateRevealPreconditions(game, 5)).toThrow();
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
// Retry Utility Tests
// =============================================================================

describe('Retry Utility', () => {

    describe('sleep', () => {
        it('should delay execution for specified time', async () => {
            const start = Date.now();
            await sleep(50);
            const elapsed = Date.now() - start;
            expect(elapsed).toBeGreaterThanOrEqual(45); // Allow some variance
        });
    });

    describe('withRetry', () => {
        it('should return result on first successful attempt', async () => {
            const fn = jest.fn().mockResolvedValue('success');

            const result = await withRetry(fn, { maxRetries: 3 });

            expect(result).toBe('success');
            expect(fn).toHaveBeenCalledTimes(1);
        });

        it('should retry on failure and succeed eventually', async () => {
            const fn = jest.fn()
                .mockRejectedValueOnce(new Error('fail 1'))
                .mockRejectedValueOnce(new Error('fail 2'))
                .mockResolvedValue('success');

            const result = await withRetry(fn, { maxRetries: 3, baseDelayMs: 10 });

            expect(result).toBe('success');
            expect(fn).toHaveBeenCalledTimes(3);
        });

        it('should throw after max retries exhausted', async () => {
            const fn = jest.fn().mockRejectedValue(new Error('always fails'));

            await expect(withRetry(fn, { maxRetries: 3, baseDelayMs: 10 }))
                .rejects.toThrow('always fails');

            expect(fn).toHaveBeenCalledTimes(3);
        });

        it('should pass attempt number to function', async () => {
            const attempts = [];
            const fn = jest.fn().mockImplementation((attempt) => {
                attempts.push(attempt);
                if (attempt < 3) throw new Error('retry');
                return 'success';
            });

            await withRetry(fn, { maxRetries: 3, baseDelayMs: 10 });

            expect(attempts).toEqual([1, 2, 3]);
        });

        it('should respect shouldRetry predicate', async () => {
            const retryableError = new Error('retry me');
            retryableError.code = 'RETRYABLE';
            const nonRetryableError = new Error('do not retry');
            nonRetryableError.code = 'FATAL';

            const fn = jest.fn()
                .mockRejectedValueOnce(retryableError)
                .mockRejectedValueOnce(nonRetryableError);

            await expect(withRetry(fn, {
                maxRetries: 5,
                baseDelayMs: 10,
                shouldRetry: (err) => err.code === 'RETRYABLE'
            })).rejects.toThrow('do not retry');

            expect(fn).toHaveBeenCalledTimes(2);
        });

        it('should call onRetry callback before each retry', async () => {
            const onRetry = jest.fn();
            const fn = jest.fn()
                .mockRejectedValueOnce(new Error('fail 1'))
                .mockRejectedValueOnce(new Error('fail 2'))
                .mockResolvedValue('success');

            await withRetry(fn, { maxRetries: 3, baseDelayMs: 10, onRetry });

            expect(onRetry).toHaveBeenCalledTimes(2);
            expect(onRetry).toHaveBeenCalledWith(expect.any(Error), 1);
            expect(onRetry).toHaveBeenCalledWith(expect.any(Error), 2);
        });
    });

    describe('createRetryWrapper', () => {
        it('should create a wrapper with default options', async () => {
            const fn = jest.fn().mockResolvedValue('success');
            const wrappedRetry = createRetryWrapper({ maxRetries: 2, baseDelayMs: 10 });

            const result = await wrappedRetry(fn);

            expect(result).toBe('success');
        });

        it('should allow overriding options', async () => {
            const fn = jest.fn().mockRejectedValue(new Error('fail'));
            const wrappedRetry = createRetryWrapper({ maxRetries: 2, baseDelayMs: 10 });

            await expect(wrappedRetry(fn, { maxRetries: 1 })).rejects.toThrow();

            expect(fn).toHaveBeenCalledTimes(1);
        });
    });

    describe('isRetryableError', () => {
        it('should return true for network error codes', () => {
            const networkErrors = [
                { code: 'ECONNRESET' },
                { code: 'ECONNREFUSED' },
                { code: 'ETIMEDOUT' },
                { code: 'ENOTFOUND' },
                { code: 'ENETUNREACH' }
            ];

            networkErrors.forEach(error => {
                expect(isRetryableError(error)).toBe(true);
            });
        });

        it('should return true for Redis connection errors', () => {
            expect(isRetryableError({ message: 'Connection is closed' })).toBe(true);
            expect(isRetryableError({ message: 'Socket closed unexpectedly' })).toBe(true);
        });

        it('should return false for non-retryable errors', () => {
            expect(isRetryableError({ code: 'SOME_OTHER_ERROR' })).toBe(false);
            expect(isRetryableError({ message: 'Invalid input' })).toBe(false);
            expect(isRetryableError(new Error('Generic error'))).toBe(false);
        });
    });

    describe('isConcurrentModificationError', () => {
        it('should return true for concurrent modification errors', () => {
            expect(isConcurrentModificationError({ code: 'CONCURRENT_MODIFICATION' })).toBe(true);
            expect(isConcurrentModificationError({ message: 'concurrent modification detected' })).toBe(true);
            expect(isConcurrentModificationError({ message: 'version mismatch' })).toBe(true);
        });

        it('should return false for other errors', () => {
            expect(isConcurrentModificationError({ code: 'OTHER' })).toBe(false);
            expect(isConcurrentModificationError({ message: 'some error' })).toBe(false);
        });
    });
});

// =============================================================================
// Centralized Constants Tests
// =============================================================================

describe('Centralized Constants', () => {

    describe('SOCKET_EVENTS', () => {
        it('should have all room events defined', () => {
            expect(SOCKET_EVENTS.ROOM_CREATE).toBe('room:create');
            expect(SOCKET_EVENTS.ROOM_CREATED).toBe('room:created');
            expect(SOCKET_EVENTS.ROOM_JOIN).toBe('room:join');
            expect(SOCKET_EVENTS.ROOM_JOINED).toBe('room:joined');
            expect(SOCKET_EVENTS.ROOM_LEAVE).toBe('room:leave');
            expect(SOCKET_EVENTS.ROOM_SETTINGS_UPDATED).toBe('room:settingsUpdated');
        });

        it('should have all game events defined', () => {
            expect(SOCKET_EVENTS.GAME_START).toBe('game:start');
            expect(SOCKET_EVENTS.GAME_STARTED).toBe('game:started');
            expect(SOCKET_EVENTS.GAME_REVEAL).toBe('game:reveal');
            expect(SOCKET_EVENTS.GAME_CARD_REVEALED).toBe('game:cardRevealed');
            expect(SOCKET_EVENTS.GAME_CLUE).toBe('game:clue');
            expect(SOCKET_EVENTS.GAME_CLUE_GIVEN).toBe('game:clueGiven');
            expect(SOCKET_EVENTS.GAME_OVER).toBe('game:over');
        });

        it('should have all player events defined', () => {
            expect(SOCKET_EVENTS.PLAYER_SET_TEAM).toBe('player:setTeam');
            expect(SOCKET_EVENTS.PLAYER_SET_ROLE).toBe('player:setRole');
            expect(SOCKET_EVENTS.PLAYER_UPDATED).toBe('player:updated');
            expect(SOCKET_EVENTS.PLAYER_DISCONNECTED).toBe('player:disconnected');
        });

        it('should have all timer events defined', () => {
            expect(SOCKET_EVENTS.TIMER_START).toBe('timer:start');
            expect(SOCKET_EVENTS.TIMER_TICK).toBe('timer:tick');
            expect(SOCKET_EVENTS.TIMER_EXPIRED).toBe('timer:expired');
            expect(SOCKET_EVENTS.TIMER_STATUS).toBe('timer:status');
        });

        it('should have chat events defined', () => {
            expect(SOCKET_EVENTS.CHAT_MESSAGE).toBe('chat:message');
            expect(SOCKET_EVENTS.CHAT_SEND).toBe('chat:send');
        });
    });

    describe('TTL', () => {
        it('should have correct TTL values in seconds', () => {
            expect(TTL.PLAYER_CONNECTED).toBe(24 * 60 * 60);
            expect(TTL.PLAYER_DISCONNECTED).toBe(10 * 60);
            expect(TTL.GAME_STATE).toBe(24 * 60 * 60);
            expect(TTL.EVENT_LOG).toBe(5 * 60);
            expect(TTL.DISTRIBUTED_LOCK).toBe(5);
            expect(TTL.SESSION_VALIDATION_WINDOW).toBe(60);
        });
    });

    describe('RETRY_CONFIG', () => {
        it('should have optimistic lock retry config', () => {
            expect(RETRY_CONFIG.OPTIMISTIC_LOCK.maxRetries).toBe(3);
            expect(RETRY_CONFIG.OPTIMISTIC_LOCK.baseDelayMs).toBe(100);
        });

        it('should have Redis operation retry config', () => {
            expect(RETRY_CONFIG.REDIS_OPERATION.maxRetries).toBe(3);
            expect(RETRY_CONFIG.REDIS_OPERATION.baseDelayMs).toBe(50);
        });

        it('should have distributed lock retry config', () => {
            expect(RETRY_CONFIG.DISTRIBUTED_LOCK.maxRetries).toBe(50);
            expect(RETRY_CONFIG.DISTRIBUTED_LOCK.baseDelayMs).toBe(100);
        });

        it('should have network request retry config', () => {
            expect(RETRY_CONFIG.NETWORK_REQUEST.maxRetries).toBe(4);
            expect(RETRY_CONFIG.NETWORK_REQUEST.baseDelayMs).toBe(2000);
        });
    });

    describe('BOARD_SIZE and ERROR_CODES', () => {
        it('should have correct board size', () => {
            expect(BOARD_SIZE).toBe(25);
        });

        it('should have comprehensive error codes', () => {
            expect(ERROR_CODES.ROOM_NOT_FOUND).toBeDefined();
            expect(ERROR_CODES.GAME_OVER).toBeDefined();
            expect(ERROR_CODES.CARD_ALREADY_REVEALED).toBeDefined();
            expect(ERROR_CODES.NOT_YOUR_TURN).toBeDefined();
            expect(ERROR_CODES.INVALID_INPUT).toBeDefined();
            expect(ERROR_CODES.SESSION_EXPIRED).toBeDefined();
        });
    });
});
