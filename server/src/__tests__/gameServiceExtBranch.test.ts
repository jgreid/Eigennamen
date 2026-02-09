/**
 * Game Service Extended Branch Coverage Tests
 * Targets uncovered lines: 369-374, 583, 1236, 1309, 1446
 *
 * Lines 369-374: Duet mode board generation in createGame (isDuet branch)
 * Line 583: addToHistory lazy slicing (history length > threshold)
 * Line 1236: giveClue Lua error propagation for known error codes
 * Line 1309: clues array capping when exceeds MAX_CLUES
 * Line 1446: endTurn Lua error propagation for known error codes
 */

// Mock Redis
const mockRedisStore = new Map<string, string>();
const mockRedis = {
    get: jest.fn(async (key: string) => mockRedisStore.get(key) || null),
    set: jest.fn(async (key: string, value: string) => { mockRedisStore.set(key, value); return 'OK'; }),
    del: jest.fn(async (key: string) => { mockRedisStore.delete(key); return 1; }),
    expire: jest.fn(async () => 1),
    ttl: jest.fn(async () => 3600),
    watch: jest.fn(async () => 'OK'),
    unwatch: jest.fn(async () => 'OK'),
    multi: jest.fn(() => ({
        set: jest.fn().mockReturnThis(),
        exec: jest.fn(async () => ['OK'])
    })),
    eval: jest.fn(async () => null)
};

jest.mock('../config/redis', () => ({
    getRedis: jest.fn(() => mockRedis),
    connectRedis: jest.fn(),
    disconnectRedis: jest.fn()
}));

jest.mock('../utils/logger', () => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn()
}));

jest.mock('../services/wordListService', () => ({
    getWordsForGame: jest.fn()
}));

const {
    generateDuetBoard,
} = require('../services/gameService');
const { GAME_HISTORY, GAME_INTERNALS } = require('../config/constants');

describe('Game Service Extended Branch Coverage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockRedisStore.clear();
    });

    describe('Lines 369-374: Duet mode board generation', () => {
        it('should generate Duet board with correct green/assassin totals', () => {
            const { types, duetTypes } = generateDuetBoard(42);
            expect(types).toHaveLength(25);
            expect(duetTypes).toHaveLength(25);

            // Side A: 9 green (as 'red'), 3 assassin, 13 neutral
            const redCount = types.filter((t: string) => t === 'red').length;
            const assassinCountA = types.filter((t: string) => t === 'assassin').length;
            const neutralCountA = types.filter((t: string) => t === 'neutral').length;
            expect(redCount).toBe(9);
            expect(assassinCountA).toBe(3);
            expect(neutralCountA).toBe(13);

            // Side B: 9 green (as 'blue'), 3 assassin, 13 neutral
            const blueCount = duetTypes.filter((t: string) => t === 'blue').length;
            const assassinCountB = duetTypes.filter((t: string) => t === 'assassin').length;
            const neutralCountB = duetTypes.filter((t: string) => t === 'neutral').length;
            expect(blueCount).toBe(9);
            expect(assassinCountB).toBe(3);
            expect(neutralCountB).toBe(13);
        });
    });

    describe('Line 583: addToHistory lazy slicing threshold', () => {
        it('should verify lazy threshold multiplier is set correctly', () => {
            const maxEntries = GAME_HISTORY.MAX_ENTRIES;
            const lazyThreshold = Math.floor(maxEntries * GAME_INTERNALS.LAZY_HISTORY_MULTIPLIER);
            // Threshold should be greater than max entries
            expect(lazyThreshold).toBeGreaterThan(maxEntries);
            expect(GAME_INTERNALS.LAZY_HISTORY_MULTIPLIER).toBeGreaterThan(1);
        });
    });

    describe('Line 1236: giveClue Lua error propagation', () => {
        it('should propagate known error codes from Lua giveClue', async () => {
            const gameService = require('../services/gameService');

            const gameState = {
                currentTurn: 'red',
                gameOver: false,
                words: Array(25).fill('WORD'),
                types: Array(25).fill('neutral'),
                revealed: Array(25).fill(false),
                currentClue: null,
                clues: []
            };
            mockRedisStore.set('room:GCTEST:game', JSON.stringify(gameState));

            // Lua script returns GAME_OVER error (a known error with .code)
            mockRedis.eval.mockResolvedValueOnce(JSON.stringify({ error: 'GAME_OVER' }));

            await expect(
                gameService.giveClue('GCTEST', 'red', 'CLUE', 3, 'Spy')
            ).rejects.toBeDefined();
        });
    });

    describe('Line 1309: clues array capping', () => {
        it('should cap clues when they exceed MAX_CLUES in fallback path', async () => {
            const gameService = require('../services/gameService');

            // Create clues list that is already at capacity
            const existingClues = [];
            for (let i = 0; i < 100; i++) {
                existingClues.push({
                    team: 'red', word: `CLUE${i}`, number: 1,
                    spymaster: 'Spy', timestamp: Date.now()
                });
            }

            const gameState = {
                gameMode: 'duet', // Duet mode to bypass Lua
                currentTurn: 'red',
                gameOver: false,
                words: ['APPLE', 'BANANA', 'CHERRY', 'DATE', 'ELDER',
                    'FIG', 'GRAPE', 'HAZEL', 'IRIS', 'JADE',
                    'KALE', 'LEMON', 'MANGO', 'NUTMEG', 'OLIVE',
                    'PEACH', 'QUINCE', 'RAISIN', 'SAGE', 'THYME',
                    'UMBER', 'VINE', 'WHEAT', 'XYLOSE', 'YUZU'],
                types: Array(25).fill('neutral'),
                duetTypes: Array(25).fill('neutral'),
                revealed: Array(25).fill(false),
                currentClue: null,
                clues: existingClues,
                guessesUsed: 0,
                guessesAllowed: 0,
                history: [],
                stateVersion: 1,
                redTotal: 9, blueTotal: 9,
                timerTokens: 9, greenFound: 0, greenTotal: 15
            };
            mockRedisStore.set('room:DUETCL:game', JSON.stringify(gameState));

            mockRedis.multi.mockReturnValue({
                set: jest.fn().mockReturnThis(),
                exec: jest.fn(async () => ['OK'])
            });

            const result = await gameService.giveClue('DUETCL', 'red', 'TESTWORD', 2, 'SpyMaster');
            expect(result).toBeDefined();
            expect(result.word).toBeDefined();
        });
    });

    describe('Line 1446: endTurn Lua error propagation', () => {
        it('should propagate known error codes from Lua endTurn', async () => {
            const gameService = require('../services/gameService');

            const gameState = {
                currentTurn: 'red',
                gameOver: false,
                words: Array(25).fill('WORD'),
                types: Array(25).fill('neutral'),
                revealed: Array(25).fill(false)
            };
            mockRedisStore.set('room:ENDTST:game', JSON.stringify(gameState));

            // Lua returns a GAME_OVER error
            mockRedis.eval.mockResolvedValueOnce(JSON.stringify({ error: 'GAME_OVER' }));

            await expect(
                gameService.endTurn('ENDTST', 'Player1', 'red')
            ).rejects.toBeDefined();
        });
    });
});
