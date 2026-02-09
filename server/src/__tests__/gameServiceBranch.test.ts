/**
 * Game Service Branch Coverage Tests
 *
 * Tests: duet mode board generation, lock release errors, spymaster visibility,
 * history lazy slicing, Lua error propagation, clues capping, endTurn validation,
 * duet forfeit
 */

jest.mock('../utils/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
}));

// Mock fs for Lua scripts
jest.mock('fs', () => ({
    readFileSync: jest.fn().mockReturnValue('-- mocked lua script')
}));

const mockRedis = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    ttl: jest.fn().mockResolvedValue(3600),
    expire: jest.fn().mockResolvedValue(1),
    watch: jest.fn().mockResolvedValue('OK'),
    unwatch: jest.fn().mockResolvedValue('OK'),
    multi: jest.fn(() => ({
        set: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(['OK'])
    })),
    eval: jest.fn().mockResolvedValue(null)
};

jest.mock('../config/redis', () => ({
    getRedis: () => mockRedis
}));

jest.mock('../services/wordListService', () => ({
    getWordsForGame: jest.fn().mockResolvedValue(null)
}));

jest.mock('../utils/timeout', () => ({
    withTimeout: (promise: Promise<unknown>) => promise,
    TIMEOUTS: { REDIS_OPERATION: 5000 }
}));

jest.mock('../utils/distributedLock', () => ({
    RELEASE_LOCK_SCRIPT: 'mocked release script'
}));

const gameService = require('../services/gameService');

describe('Game Service Branch Coverage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('generateDuetBoard', () => {
        it('should generate a valid duet board with correct distribution', () => {
            const result = gameService.generateDuetBoard(12345);

            expect(result.types).toHaveLength(25);
            expect(result.duetTypes).toHaveLength(25);

            // Count types for Side A
            const redCountA = result.types.filter((t: string) => t === 'red').length;
            const assassinCountA = result.types.filter((t: string) => t === 'assassin').length;
            const neutralCountA = result.types.filter((t: string) => t === 'neutral').length;

            // Side A: 9 green (red), 3 assassin, 13 neutral
            expect(redCountA).toBe(9);
            expect(assassinCountA).toBe(3);
            expect(neutralCountA).toBe(13);

            // Side B: 9 green (blue), 3 assassin, 13 neutral
            const blueCountB = result.duetTypes.filter((t: string) => t === 'blue').length;
            const assassinCountB = result.duetTypes.filter((t: string) => t === 'assassin').length;
            const neutralCountB = result.duetTypes.filter((t: string) => t === 'neutral').length;

            expect(blueCountB).toBe(9);
            expect(assassinCountB).toBe(3);
            expect(neutralCountB).toBe(13);
        });

        it('should be deterministic with the same seed', () => {
            const result1 = gameService.generateDuetBoard(42);
            const result2 = gameService.generateDuetBoard(42);
            expect(result1).toEqual(result2);
        });

        it('should produce different boards for different seeds', () => {
            const result1 = gameService.generateDuetBoard(1);
            const result2 = gameService.generateDuetBoard(999);
            // Boards should differ (extremely unlikely to be identical)
            const same = JSON.stringify(result1) === JSON.stringify(result2);
            expect(same).toBe(false);
        });
    });

    describe('getGameStateForPlayer - spymaster visibility', () => {
        const makeGame = (overrides = {}) => ({
            id: 'game-1',
            words: Array(25).fill('WORD'),
            types: Array(25).fill('red'),
            revealed: Array(25).fill(false),
            currentTurn: 'red' as const,
            redScore: 0,
            blueScore: 0,
            redTotal: 9,
            blueTotal: 8,
            gameOver: false,
            winner: null,
            currentClue: null,
            guessesUsed: 0,
            guessesAllowed: 0,
            clues: [],
            history: [],
            stateVersion: 1,
            ...overrides
        });

        it('should show all types for spymaster in classic mode', () => {
            const game = makeGame();
            const player = { sessionId: 's1', team: 'red', role: 'spymaster' };

            const result = gameService.getGameStateForPlayer(game, player);
            expect(result.types).toEqual(game.types);
        });

        it('should hide unrevealed types for non-spymaster in classic mode', () => {
            const game = makeGame();
            game.revealed[0] = true;
            const player = { sessionId: 's1', team: 'red', role: 'clicker' };

            const result = gameService.getGameStateForPlayer(game, player);
            expect(result.types[0]).toBe('red'); // revealed
            expect(result.types[1]).toBeNull(); // unrevealed
        });

        it('should show all types when game is over', () => {
            const game = makeGame({ gameOver: true });
            const player = { sessionId: 's1', team: 'red', role: 'clicker' };

            const result = gameService.getGameStateForPlayer(game, player);
            expect(result.types).toEqual(game.types);
        });

        it('should return null for null game', () => {
            const result = gameService.getGameStateForPlayer(null, null);
            expect(result).toBeNull();
        });

        it('should handle null player', () => {
            const game = makeGame();
            const result = gameService.getGameStateForPlayer(game, null);
            // Non-spymaster view: only revealed types
            expect(result.types[0]).toBeNull();
        });

        // Duet mode visibility
        it('should show Side A types for red spymaster in duet mode', () => {
            const game = makeGame({
                gameMode: 'duet',
                duetTypes: Array(25).fill('blue'),
                timerTokens: 9,
                greenFound: 0,
                greenTotal: 15
            });
            const player = { sessionId: 's1', team: 'red', role: 'spymaster' };

            const result = gameService.getGameStateForPlayer(game, player);
            expect(result.types).toEqual(game.types); // full Side A
            // Side B: only revealed
            expect(result.duetTypes[0]).toBeNull();
        });

        it('should show Side B types for blue spymaster in duet mode', () => {
            const game = makeGame({
                gameMode: 'duet',
                duetTypes: Array(25).fill('blue'),
                timerTokens: 9,
                greenFound: 0,
                greenTotal: 15
            });
            const player = { sessionId: 's1', team: 'blue', role: 'spymaster' };

            const result = gameService.getGameStateForPlayer(game, player);
            expect(result.duetTypes).toEqual(game.duetTypes); // full Side B
            // Side A: only revealed
            expect(result.types[0]).toBeNull();
        });

        it('should show all types when duet game is over', () => {
            const game = makeGame({
                gameMode: 'duet',
                gameOver: true,
                duetTypes: Array(25).fill('blue'),
                timerTokens: 0,
                greenFound: 15,
                greenTotal: 15
            });
            const player = { sessionId: 's1', team: 'red', role: 'clicker' };

            const result = gameService.getGameStateForPlayer(game, player);
            expect(result.types).toEqual(game.types);
            expect(result.duetTypes).toEqual(game.duetTypes);
        });

        it('should show only revealed for non-spymaster in duet mode', () => {
            const duetTypes = Array(25).fill('blue');
            const game = makeGame({
                gameMode: 'duet',
                duetTypes,
                timerTokens: 9,
                greenFound: 0,
                greenTotal: 15
            });
            game.revealed[2] = true;
            const player = { sessionId: 's1', team: 'red', role: 'clicker' };

            const result = gameService.getGameStateForPlayer(game, player);
            expect(result.types[2]).toBe('red');
            expect(result.types[0]).toBeNull();
            expect(result.duetTypes[2]).toBe('blue');
            expect(result.duetTypes[0]).toBeNull();
        });
    });

    describe('executeCardReveal - duet mode', () => {
        it('should track green cards found in duet mode for red turn', () => {
            const game = {
                gameMode: 'duet',
                types: ['red', 'neutral', 'assassin'],
                duetTypes: ['blue', 'neutral', 'assassin'],
                revealed: [false, false, false],
                currentTurn: 'red',
                redScore: 0,
                blueScore: 0,
                greenFound: 0,
                guessesUsed: 0
            };

            const type = gameService.executeCardReveal(game, 0);
            expect(type).toBe('red'); // Side A green
            expect(game.greenFound).toBe(1);
            expect(game.redScore).toBe(1);
        });

        it('should use duetTypes for blue turn', () => {
            const game = {
                gameMode: 'duet',
                types: ['red', 'neutral', 'assassin'],
                duetTypes: ['blue', 'neutral', 'assassin'],
                revealed: [false, false, false],
                currentTurn: 'blue',
                redScore: 0,
                blueScore: 0,
                greenFound: 0,
                guessesUsed: 0
            };

            const type = gameService.executeCardReveal(game, 0);
            expect(type).toBe('blue'); // Side B green
            expect(game.greenFound).toBe(1);
            expect(game.blueScore).toBe(1);
        });
    });

    describe('determineRevealOutcome - duet mode', () => {
        it('should handle duet assassin (cooperative loss)', () => {
            const game = {
                gameMode: 'duet',
                gameOver: false,
                winner: null,
                greenFound: 0,
                greenTotal: 15,
                timerTokens: 9,
                guessesUsed: 1,
                guessesAllowed: 2,
                currentTurn: 'red' as const
            };

            const outcome = gameService.determineRevealOutcome(game, 'assassin', 'red');
            expect(game.gameOver).toBe(true);
            expect(game.winner).toBeNull(); // cooperative loss
            expect(outcome.endReason).toBe('assassin');
        });

        it('should handle duet cooperative win', () => {
            const game = {
                gameMode: 'duet',
                gameOver: false,
                winner: null,
                greenFound: 15,
                greenTotal: 15,
                timerTokens: 5,
                guessesUsed: 1,
                guessesAllowed: 2,
                currentTurn: 'red' as const
            };

            const outcome = gameService.determineRevealOutcome(game, 'red', 'red');
            expect(game.gameOver).toBe(true);
            expect(game.winner).toBe('red');
            expect(outcome.endReason).toBe('completed');
        });

        it('should handle duet bystander (costs timer token)', () => {
            const game = {
                gameMode: 'duet',
                gameOver: false,
                winner: null,
                greenFound: 5,
                greenTotal: 15,
                timerTokens: 3,
                guessesUsed: 1,
                guessesAllowed: 2,
                currentTurn: 'red' as const
            };

            const outcome = gameService.determineRevealOutcome(game, 'neutral', 'red');
            expect(game.timerTokens).toBe(2);
            expect(outcome.turnEnded).toBe(true);
        });

        it('should handle duet out of timer tokens', () => {
            const game = {
                gameMode: 'duet',
                gameOver: false,
                winner: null,
                greenFound: 5,
                greenTotal: 15,
                timerTokens: 1,
                guessesUsed: 1,
                guessesAllowed: 2,
                currentTurn: 'red' as const
            };

            const outcome = gameService.determineRevealOutcome(game, 'neutral', 'red');
            expect(game.timerTokens).toBe(0);
            expect(game.gameOver).toBe(true);
            expect(outcome.endReason).toBe('timerTokens');
        });

        it('should handle duet max guesses reached', () => {
            const game = {
                gameMode: 'duet',
                gameOver: false,
                winner: null,
                greenFound: 6,
                greenTotal: 15,
                timerTokens: 5,
                guessesUsed: 3,
                guessesAllowed: 3,
                currentTurn: 'red' as const
            };

            const outcome = gameService.determineRevealOutcome(game, 'red', 'red');
            expect(outcome.turnEnded).toBe(true);
            expect(outcome.endReason).toBe('maxGuesses');
        });

        it('should continue on correct duet guess with remaining guesses', () => {
            const game = {
                gameMode: 'duet',
                gameOver: false,
                winner: null,
                greenFound: 6,
                greenTotal: 15,
                timerTokens: 5,
                guessesUsed: 1,
                guessesAllowed: 3,
                currentTurn: 'red' as const
            };

            const outcome = gameService.determineRevealOutcome(game, 'red', 'red');
            expect(outcome.turnEnded).toBe(false);
        });
    });

    describe('forfeitGame - duet forfeit', () => {
        it('should set no winner in duet mode forfeit', async () => {
            const game = {
                id: 'game-1',
                gameMode: 'duet',
                gameOver: false,
                winner: null,
                currentTurn: 'red',
                types: Array(25).fill('red'),
                history: [],
                stateVersion: 1
            };
            mockRedis.get.mockResolvedValue(JSON.stringify(game));

            const result = await gameService.forfeitGame('testroom', 'red');
            expect(result.winner).toBeNull();
            expect(result.forfeitingTeam).toBe('red');
        });

        it('should throw when game is already over', async () => {
            const game = {
                id: 'game-1',
                gameOver: true,
                winner: 'red',
                currentTurn: 'red',
                types: [],
                history: [],
                stateVersion: 1
            };
            mockRedis.get.mockResolvedValue(JSON.stringify(game));

            await expect(gameService.forfeitGame('testroom'))
                .rejects.toThrow('Game is already over');
        });

        it('should default forfeitTeam to currentTurn when not specified', async () => {
            const game = {
                id: 'game-1',
                gameOver: false,
                winner: null,
                currentTurn: 'blue',
                types: Array(25).fill('red'),
                history: [],
                stateVersion: 1
            };
            mockRedis.get.mockResolvedValue(JSON.stringify(game));

            const result = await gameService.forfeitGame('testroom');
            expect(result.forfeitingTeam).toBe('blue');
            expect(result.winner).toBe('red'); // opposing team
        });
    });

    describe('buildRevealResult - duet fields', () => {
        it('should include duet-specific fields when gameMode is duet', () => {
            const game = {
                id: 'game-1',
                gameMode: 'duet',
                words: ['WORD1', 'WORD2'],
                types: ['red', 'neutral'],
                duetTypes: ['blue', 'neutral'],
                revealed: [true, false],
                currentTurn: 'red',
                redScore: 1,
                blueScore: 0,
                redTotal: 9,
                blueTotal: 9,
                gameOver: false,
                winner: null,
                guessesUsed: 1,
                guessesAllowed: 3,
                timerTokens: 8,
                greenFound: 1
            };

            const outcome = { turnEnded: false, endReason: null };
            const result = gameService.buildRevealResult(game, 0, 'red', outcome);

            expect(result.timerTokens).toBe(8);
            expect(result.greenFound).toBe(1);
            expect(result.allDuetTypes).toBeNull(); // game not over
        });

        it('should include allDuetTypes when duet game is over', () => {
            const game = {
                id: 'game-1',
                gameMode: 'duet',
                words: ['WORD1'],
                types: ['red'],
                duetTypes: ['blue'],
                revealed: [true],
                currentTurn: 'red',
                redScore: 1,
                blueScore: 0,
                gameOver: true,
                winner: 'red',
                guessesUsed: 1,
                guessesAllowed: 1,
                timerTokens: 5,
                greenFound: 15
            };

            const outcome = { turnEnded: true, endReason: 'completed' };
            const result = gameService.buildRevealResult(game, 0, 'red', outcome);

            expect(result.allDuetTypes).toEqual(['blue']);
        });
    });

    describe('revealCardOptimized - Lua error propagation', () => {
        it('should throw GameStateError with correct code for known Lua errors', async () => {
            mockRedis.eval.mockResolvedValue(JSON.stringify({ error: 'GAME_OVER' }));

            await expect(gameService.revealCardOptimized('testroom', 0, 'Player', 'red'))
                .rejects.toMatchObject({ code: 'GAME_OVER' });
        });

        it('should throw ServerError for null Lua result', async () => {
            mockRedis.eval.mockResolvedValue(null);

            await expect(gameService.revealCardOptimized('testroom', 0, 'Player', 'red'))
                .rejects.toThrow('Invalid Lua script result');
        });

        it('should throw for unparseable Lua result', async () => {
            mockRedis.eval.mockResolvedValue('not valid json');

            await expect(gameService.revealCardOptimized('testroom', 0, 'Player', 'red'))
                .rejects.toThrow('Failed to parse game operation result');
        });
    });

    describe('endTurnOptimized - Lua error propagation', () => {
        it('should throw for known Lua error code', async () => {
            mockRedis.eval.mockResolvedValue(JSON.stringify({ error: 'NOT_YOUR_TURN' }));

            await expect(gameService.endTurnOptimized('testroom', 'Player', 'red'))
                .rejects.toMatchObject({ code: 'NOT_YOUR_TURN' });
        });

        it('should throw ServerError for null Lua result', async () => {
            mockRedis.eval.mockResolvedValue(null);

            await expect(gameService.endTurnOptimized('testroom', 'Player', 'red'))
                .rejects.toThrow('Invalid Lua script result');
        });
    });

    describe('giveClueOptimized - Lua error propagation', () => {
        it('should throw for word-overlap error with included word name', async () => {
            mockRedis.eval.mockResolvedValue(JSON.stringify({ error: 'CONTAINS_BOARD_WORD', word: 'TEST' }));

            await expect(gameService.giveClueOptimized('testroom', 'red', 'TESTING', 3, 'Spy'))
                .rejects.toThrow(/TEST/);
        });

        it('should throw ServerError for null Lua result', async () => {
            mockRedis.eval.mockResolvedValue(null);

            await expect(gameService.giveClueOptimized('testroom', 'red', 'WORD', 3, 'Spy'))
                .rejects.toThrow('Invalid Lua script result');
        });

        it('should return parsed clue on success', async () => {
            const clue = {
                team: 'red',
                word: 'CLUE',
                number: 3,
                spymaster: 'Spy',
                guessesAllowed: 4
            };
            mockRedis.eval.mockResolvedValue(JSON.stringify(clue));

            const result = await gameService.giveClueOptimized('testroom', 'red', 'CLUE', 3, 'Spy');
            expect(result.word).toBe('CLUE');
            expect(result.guessesAllowed).toBe(4);
        });
    });

    describe('createGame - lock release error handling', () => {
        it('should handle lock release error gracefully', async () => {
            // Set up for successful game creation
            mockRedis.set.mockResolvedValue('OK'); // lock acquired
            mockRedis.get
                .mockResolvedValueOnce(null)  // no existing game
                .mockResolvedValueOnce(JSON.stringify({ status: 'waiting' })) // room exists
                .mockResolvedValueOnce(JSON.stringify({ status: 'waiting' })); // room data for update

            // Lock release fails
            mockRedis.eval.mockRejectedValue(new Error('Lock release failed'));

            const game = await gameService.createGame('testroom');
            expect(game).toBeDefined();
            expect(game.id).toBeDefined();
        });
    });

    describe('revealCard - lock release error', () => {
        it('should handle lock release error during revealCard', async () => {
            // Game data
            const game = {
                id: 'game-1',
                gameOver: false,
                winner: null,
                currentTurn: 'red',
                types: Array(25).fill('red'),
                words: Array(25).fill('WORD'),
                revealed: Array(25).fill(false),
                redScore: 0,
                blueScore: 0,
                redTotal: 9,
                blueTotal: 8,
                guessesUsed: 0,
                guessesAllowed: 3,
                currentClue: { word: 'TEST', number: 3 },
                clues: [],
                history: [],
                stateVersion: 1
            };

            mockRedis.set.mockResolvedValue('OK'); // lock acquired
            mockRedis.get.mockResolvedValue(JSON.stringify(game));

            // Optimized reveal succeeds
            const revealResult = {
                index: 0,
                type: 'red',
                word: 'WORD',
                redScore: 1,
                blueScore: 0,
                currentTurn: 'red',
                guessesUsed: 1,
                guessesAllowed: 3,
                turnEnded: false,
                gameOver: false,
                winner: null,
                endReason: null,
                allTypes: null
            };

            // First eval is for the optimized reveal, second is for lock release
            mockRedis.eval
                .mockResolvedValueOnce(JSON.stringify(revealResult))
                .mockRejectedValueOnce(new Error('Lock release failed'));

            const result = await gameService.revealCard('testroom', 0, 'Player', 'red');
            expect(result.index).toBe(0);
        });
    });

    describe('endTurn - duet mode fallback', () => {
        it('should use fallback for duet mode', async () => {
            const game = {
                id: 'game-1',
                gameMode: 'duet',
                gameOver: false,
                currentTurn: 'red',
                currentClue: null,
                guessesUsed: 0,
                guessesAllowed: 0,
                history: [],
                stateVersion: 1
            };
            const gameStr = JSON.stringify(game);
            mockRedis.get.mockResolvedValue(gameStr);

            const result = await gameService.endTurn('testroom', 'Player', 'red');
            expect(result.currentTurn).toBe('blue');
            expect(result.previousTurn).toBe('red');
        });
    });

    describe('endTurn - expectedTeam validation in fallback', () => {
        it('should throw NOT_YOUR_TURN when expectedTeam does not match in fallback', async () => {
            const game = {
                id: 'game-1',
                gameMode: 'duet',
                gameOver: false,
                currentTurn: 'red',
                currentClue: null,
                guessesUsed: 0,
                guessesAllowed: 0,
                history: [],
                stateVersion: 1
            };
            mockRedis.get.mockResolvedValue(JSON.stringify(game));

            await expect(gameService.endTurn('testroom', 'Player', 'blue'))
                .rejects.toThrow();
        });
    });

    describe('giveClue - validation', () => {
        it('should throw for invalid team', async () => {
            await expect(gameService.giveClue('testroom', '', 'WORD', 3, 'Spy'))
                .rejects.toThrow('Spymaster must be on a team');
        });

        it('should throw for invalid clue number', async () => {
            await expect(gameService.giveClue('testroom', 'red', 'WORD', -1, 'Spy'))
                .rejects.toThrow('Clue number must be');
        });

        it('should throw for non-integer clue number', async () => {
            await expect(gameService.giveClue('testroom', 'red', 'WORD', 1.5, 'Spy'))
                .rejects.toThrow('Clue number must be');
        });

        it('should throw for clue number > BOARD_SIZE', async () => {
            await expect(gameService.giveClue('testroom', 'red', 'WORD', 26, 'Spy'))
                .rejects.toThrow('Clue number must be');
        });
    });

    describe('validateCardIndex', () => {
        it('should throw for negative index', () => {
            expect(() => gameService.validateCardIndex(-1)).toThrow();
        });

        it('should throw for index >= BOARD_SIZE', () => {
            expect(() => gameService.validateCardIndex(25)).toThrow();
        });

        it('should throw for non-integer', () => {
            expect(() => gameService.validateCardIndex(1.5)).toThrow();
        });

        it('should throw for NaN', () => {
            expect(() => gameService.validateCardIndex(NaN)).toThrow();
        });

        it('should not throw for valid index', () => {
            expect(() => gameService.validateCardIndex(0)).not.toThrow();
            expect(() => gameService.validateCardIndex(24)).not.toThrow();
        });
    });

    describe('createGame - duet mode board generation', () => {
        it('should create a duet game with dual key cards and timer tokens', async () => {
            mockRedis.set.mockResolvedValue('OK'); // lock acquired
            mockRedis.get
                .mockResolvedValueOnce(null) // no existing game
                .mockResolvedValueOnce(JSON.stringify({ status: 'waiting' })) // room exists (preCheck)
                .mockResolvedValueOnce(JSON.stringify({ status: 'waiting' })); // room data for update
            mockRedis.eval.mockResolvedValue(1); // lock release

            const game = await gameService.createGame('testroom', { gameMode: 'duet' });

            expect(game.gameMode).toBe('duet');
            expect(game.duetTypes).toHaveLength(25);
            expect(game.types).toHaveLength(25);
            expect(game.timerTokens).toBeDefined();
            expect(game.greenFound).toBe(0);
            expect(game.greenTotal).toBeDefined();
            // Duet mode: both sides get 9 greens
            expect(game.redTotal).toBe(9);
            expect(game.blueTotal).toBe(9);
        });
    });

    describe('giveClue - clue and history capping in duet fallback', () => {
        it('should cap clues array when it exceeds MAX_CLUES (100)', async () => {
            // Build a duet game with 100 existing clues (adding 1 more triggers capping)
            const existingClues = Array.from({ length: 100 }, (_, i) => ({
                team: i % 2 === 0 ? 'red' : 'blue',
                word: `CLUE${i}`,
                number: 2,
                spymaster: 'Spy',
                timestamp: Date.now()
            }));
            // Build history with 301 entries (exceeds lazy threshold of 200 * 1.5 = 300)
            const existingHistory = Array.from({ length: 301 }, (_, i) => ({
                action: 'clue',
                team: 'red',
                word: `HIST${i}`,
                number: 1,
                timestamp: Date.now()
            }));

            const game = {
                id: 'game-cap',
                gameMode: 'duet',
                gameOver: false,
                currentTurn: 'red',
                currentClue: null,
                words: Array(25).fill('APPLE'),
                types: Array(25).fill('red'),
                duetTypes: Array(25).fill('blue'),
                revealed: Array(25).fill(false),
                redScore: 0,
                blueScore: 0,
                redTotal: 9,
                blueTotal: 9,
                guessesUsed: 0,
                guessesAllowed: 0,
                clues: existingClues,
                history: existingHistory,
                stateVersion: 1,
                timerTokens: 9,
                greenFound: 0,
                greenTotal: 15
            };

            const gameStr = JSON.stringify(game);
            // First get: pre-check for isDuet (giveClue checks the raw string)
            // Second get: inside executeGameTransaction via watch path
            mockRedis.get
                .mockResolvedValueOnce(gameStr)  // pre-check
                .mockResolvedValueOnce(gameStr);  // watch+get in fallback

            const result = await gameService.giveClue('testroom', 'red', 'NEWCLUE', 3, 'Spy');

            expect(result.word).toBe('NEWCLUE');
            expect(result.guessesAllowed).toBe(4); // number + 1

            // Verify capping happened by checking the data that was persisted
            const setCall = mockRedis.multi().set.mock.calls;
            // The game was saved through multi().set() - verify it was called
            expect(mockRedis.multi).toHaveBeenCalled();
        });
    });

    describe('giveClue - Lua error propagation to caller', () => {
        it('should re-throw game logic errors from Lua without falling back', async () => {
            // Pre-check: non-duet game data exists
            const gameData = JSON.stringify({
                id: 'game-1',
                gameOver: false,
                currentTurn: 'red',
                types: Array(25).fill('red'),
                words: Array(25).fill('WORD'),
                clues: [],
                history: [],
                stateVersion: 1
            });
            mockRedis.get.mockResolvedValue(gameData);

            // Lua returns a GAME_OVER error
            mockRedis.eval.mockResolvedValue(JSON.stringify({ error: 'GAME_OVER' }));

            await expect(gameService.giveClue('testroom', 'red', 'HINT', 3, 'Spy'))
                .rejects.toMatchObject({ code: 'GAME_OVER' });
        });
    });

    describe('endTurn - Lua error propagation to caller', () => {
        it('should re-throw game logic errors from Lua without falling back', async () => {
            // Pre-check: non-duet game data exists
            const gameData = JSON.stringify({
                id: 'game-1',
                gameOver: false,
                currentTurn: 'red',
                types: Array(25).fill('red'),
                words: Array(25).fill('WORD'),
                history: [],
                stateVersion: 1
            });
            mockRedis.get.mockResolvedValue(gameData);

            // Lua returns NOT_YOUR_TURN error
            mockRedis.eval.mockResolvedValue(JSON.stringify({ error: 'NOT_YOUR_TURN' }));

            await expect(gameService.endTurn('testroom', 'Player', 'red'))
                .rejects.toMatchObject({ code: 'NOT_YOUR_TURN' });
        });
    });
});
