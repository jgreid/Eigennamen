/**
 * Game History Service Branch Coverage Tests
 *
 * Covers uncovered branches in services/gameHistoryService.ts:
 * - validateGameData with null/undefined input
 * - validateGameData with various validation failures (words, types, seed, scores, totals, winner)
 * - saveGameResult with null gameData or roomCode
 * - saveGameResult with validation failures
 * - getGameHistory with empty roomCode
 * - getGameById with empty roomCode or gameId
 * - getReplayEvents with empty inputs
 * - cleanupOldHistory with empty roomCode
 * - getHistoryStats with empty roomCode
 * - buildReplayEvents with various action types including default case
 * - getFirstTeam fallback branches
 */

// Mock Redis
const mockRedis = {
    set: jest.fn().mockResolvedValue('OK'),
    get: jest.fn().mockResolvedValue(null),
    mGet: jest.fn().mockResolvedValue([]),
    del: jest.fn().mockResolvedValue(1),
    multi: jest.fn(),
    zAdd: jest.fn().mockResolvedValue(1),
    zRange: jest.fn().mockResolvedValue([]),
    zRemRangeByRank: jest.fn().mockResolvedValue(0),
    zRem: jest.fn().mockResolvedValue(0),
    zCard: jest.fn().mockResolvedValue(0),
    expire: jest.fn().mockResolvedValue(1)
};

const mockPipeline = {
    set: jest.fn().mockReturnThis(),
    zAdd: jest.fn().mockReturnThis(),
    zRemRangeByRank: jest.fn().mockReturnThis(),
    expire: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue([['OK'], [1], [0], [1]])
};
mockRedis.multi.mockReturnValue(mockPipeline);

jest.mock('../config/redis', () => ({
    getRedis: () => mockRedis
}));

jest.mock('../utils/logger', () => ({
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
}));

const gameHistoryService = require('../services/gameHistoryService');
const logger = require('../utils/logger');

// Helper to create valid game data
function createValidGameData(overrides: Record<string, any> = {}) {
    const words = Array.from({ length: 25 }, (_, i) => `word${i + 1}`);
    const types = [
        ...Array(9).fill('red'),
        ...Array(8).fill('blue'),
        ...Array(7).fill('neutral'),
        'assassin'
    ];

    return {
        words,
        types,
        seed: 'test-seed-123',
        redScore: 3,
        blueScore: 2,
        redTotal: 9,
        blueTotal: 8,
        winner: 'red' as const,
        gameOver: true,
        ...overrides
    };
}

describe('Game History Service Branch Coverage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockRedis.get.mockResolvedValue(null);
        mockRedis.mGet.mockResolvedValue([]);
        mockRedis.zRange.mockResolvedValue([]);
        mockRedis.zCard.mockResolvedValue(0);
        mockPipeline.exec.mockResolvedValue([['OK'], [1], [0], [1]]);
    });

    describe('validateGameData', () => {
        it('should return invalid for null input', () => {
            const result = gameHistoryService.validateGameData(null);
            expect(result.valid).toBe(false);
            expect(result.errors).toContain('Game data is null or undefined');
        });

        it('should return invalid for undefined input', () => {
            const result = gameHistoryService.validateGameData(undefined);
            expect(result.valid).toBe(false);
            expect(result.errors).toContain('Game data is null or undefined');
        });

        it('should return valid for correct game data', () => {
            const result = gameHistoryService.validateGameData(createValidGameData());
            expect(result.valid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        it('should report error when words is not an array', () => {
            const data = createValidGameData({ words: 'not-array' });
            const result = gameHistoryService.validateGameData(data);
            expect(result.valid).toBe(false);
            expect(result.errors).toContain('words must be an array');
        });

        it('should report error when words has wrong length', () => {
            const data = createValidGameData({ words: ['a', 'b', 'c'] });
            const result = gameHistoryService.validateGameData(data);
            expect(result.valid).toBe(false);
            expect(result.errors[0]).toContain('words array must have 25 elements');
        });

        it('should report error when words contain empty strings', () => {
            const words = Array.from({ length: 25 }, (_, i) => i === 0 ? '' : `word${i}`);
            const data = createValidGameData({ words });
            const result = gameHistoryService.validateGameData(data);
            expect(result.valid).toBe(false);
            expect(result.errors).toContain('All words must be non-empty strings');
        });

        it('should report error when words contain non-strings', () => {
            const words = Array.from({ length: 25 }, (_, i) => i === 0 ? 123 : `word${i}`);
            const data = createValidGameData({ words });
            const result = gameHistoryService.validateGameData(data);
            expect(result.valid).toBe(false);
            expect(result.errors).toContain('All words must be non-empty strings');
        });

        it('should report error when types is not an array', () => {
            const data = createValidGameData({ types: 'not-array' });
            const result = gameHistoryService.validateGameData(data);
            expect(result.valid).toBe(false);
            expect(result.errors).toContain('types must be an array');
        });

        it('should report error when types has wrong length', () => {
            const data = createValidGameData({ types: ['red', 'blue'] });
            const result = gameHistoryService.validateGameData(data);
            expect(result.valid).toBe(false);
            expect(result.errors[0]).toContain('types array must have 25 elements');
        });

        it('should report error for invalid card types', () => {
            const types = Array.from({ length: 25 }, (_, i) => i === 0 ? 'invalid_type' : 'red');
            const data = createValidGameData({ types });
            const result = gameHistoryService.validateGameData(data);
            expect(result.valid).toBe(false);
            expect(result.errors[0]).toContain('Invalid card types found');
        });

        it('should report error when seed is empty', () => {
            const data = createValidGameData({ seed: '' });
            const result = gameHistoryService.validateGameData(data);
            expect(result.valid).toBe(false);
            expect(result.errors).toContain('seed must be a non-empty string');
        });

        it('should report error when seed is not a string', () => {
            const data = createValidGameData({ seed: 123 });
            const result = gameHistoryService.validateGameData(data);
            expect(result.valid).toBe(false);
            expect(result.errors).toContain('seed must be a non-empty string');
        });

        it('should report error when redScore is negative', () => {
            const data = createValidGameData({ redScore: -1 });
            const result = gameHistoryService.validateGameData(data);
            expect(result.valid).toBe(false);
            expect(result.errors).toContain('redScore must be a non-negative integer');
        });

        it('should report error when redScore is not an integer', () => {
            const data = createValidGameData({ redScore: 1.5 });
            const result = gameHistoryService.validateGameData(data);
            expect(result.valid).toBe(false);
            expect(result.errors).toContain('redScore must be a non-negative integer');
        });

        it('should report error when blueScore is not a number', () => {
            const data = createValidGameData({ blueScore: 'abc' });
            const result = gameHistoryService.validateGameData(data);
            expect(result.valid).toBe(false);
            expect(result.errors).toContain('blueScore must be a non-negative integer');
        });

        it('should report error when redTotal is invalid', () => {
            const data = createValidGameData({ redTotal: -5 });
            const result = gameHistoryService.validateGameData(data);
            expect(result.valid).toBe(false);
            expect(result.errors).toContain('redTotal must be a non-negative integer');
        });

        it('should report error when blueTotal is not a number', () => {
            const data = createValidGameData({ blueTotal: 'abc' });
            const result = gameHistoryService.validateGameData(data);
            expect(result.valid).toBe(false);
            expect(result.errors).toContain('blueTotal must be a non-negative integer');
        });

        it('should report error when game is over but winner is invalid', () => {
            const data = createValidGameData({ gameOver: true, winner: 'green' });
            const result = gameHistoryService.validateGameData(data);
            expect(result.valid).toBe(false);
            expect(result.errors).toContain('winner must be "red" or "blue" when game is over');
        });

        it('should not check winner when game is not over', () => {
            const data = createValidGameData({ gameOver: false, winner: undefined });
            const result = gameHistoryService.validateGameData(data);
            expect(result.valid).toBe(true);
        });

        it('should report error when history is not an array', () => {
            const data = createValidGameData({ history: 'not-array' });
            const result = gameHistoryService.validateGameData(data);
            expect(result.valid).toBe(false);
            expect(result.errors).toContain('history must be an array if provided');
        });

        it('should report error when clues is not an array', () => {
            const data = createValidGameData({ clues: 'not-array' });
            const result = gameHistoryService.validateGameData(data);
            expect(result.valid).toBe(false);
            expect(result.errors).toContain('clues must be an array if provided');
        });

        it('should accept undefined history and clues', () => {
            const data = createValidGameData();
            delete data.history;
            delete data.clues;
            const result = gameHistoryService.validateGameData(data);
            expect(result.valid).toBe(true);
        });

        it('should collect multiple errors at once', () => {
            const data = createValidGameData({
                words: 'bad',
                types: 'bad',
                seed: '',
                redScore: -1,
                blueScore: -1,
                redTotal: -1,
                blueTotal: -1
            });
            const result = gameHistoryService.validateGameData(data);
            expect(result.valid).toBe(false);
            expect(result.errors.length).toBeGreaterThan(3);
        });
    });

    describe('saveGameResult', () => {
        it('should return null for missing roomCode', async () => {
            const result = await gameHistoryService.saveGameResult('', createValidGameData());
            expect(result).toBeNull();
            expect(logger.warn).toHaveBeenCalledWith(
                'saveGameResult called with missing parameters',
                expect.any(Object)
            );
        });

        it('should return null for null gameData', async () => {
            const result = await gameHistoryService.saveGameResult('ROOM1', null);
            expect(result).toBeNull();
        });

        it('should return null for invalid gameData', async () => {
            const invalidData = createValidGameData({ seed: '' });
            const result = await gameHistoryService.saveGameResult('ROOM1', invalidData);
            expect(result).toBeNull();
            expect(logger.error).toHaveBeenCalledWith(
                'Invalid game data, refusing to save to history',
                expect.objectContaining({ errors: expect.any(Array) })
            );
        });

        it('should save valid game data successfully', async () => {
            const result = await gameHistoryService.saveGameResult('ROOM1', createValidGameData());
            expect(result).not.toBeNull();
            expect(result.roomCode).toBe('ROOM1');
            expect(result.finalState.winner).toBe('red');
            expect(mockPipeline.set).toHaveBeenCalled();
            expect(mockPipeline.zAdd).toHaveBeenCalled();
        });

        it('should use provided game id', async () => {
            const data = createValidGameData({ id: 'custom-id' });
            const result = await gameHistoryService.saveGameResult('ROOM1', data);
            expect(result).not.toBeNull();
            expect(result.id).toBe('custom-id');
        });

        it('should generate id when not provided', async () => {
            const data = createValidGameData();
            delete data.id;
            const result = await gameHistoryService.saveGameResult('ROOM1', data);
            expect(result).not.toBeNull();
            expect(result.id).toBeDefined();
            expect(result.id.length).toBeGreaterThan(0);
        });

        it('should handle pipeline exec errors', async () => {
            mockPipeline.exec.mockRejectedValue(new Error('Pipeline failed'));
            const result = await gameHistoryService.saveGameResult('ROOM1', createValidGameData());
            expect(result).toBeNull();
            expect(logger.error).toHaveBeenCalledWith(
                'Failed to save game result',
                expect.objectContaining({ error: 'Pipeline failed' })
            );
        });

        it('should use default values for missing optional fields', async () => {
            const data = createValidGameData({
                winner: undefined,
                gameOver: false,
                clues: undefined,
                history: undefined,
                teamNames: undefined,
                wordListId: undefined,
                stateVersion: undefined,
                createdAt: undefined
            });
            const result = await gameHistoryService.saveGameResult('ROOM1', data);
            expect(result).not.toBeNull();
            expect(result.finalState.winner).toBe('red'); // default fallback
            expect(result.finalState.gameOver).toBe(false);
            expect(result.clues).toEqual([]);
            expect(result.history).toEqual([]);
            expect(result.teamNames).toEqual({ red: 'Red', blue: 'Blue' });
            expect(result.wordListId).toBeNull();
            expect(result.stateVersion).toBe(1);
        });

        it('should determine first team based on redTotal=9', async () => {
            const data = createValidGameData({ redTotal: 9, blueTotal: 8 });
            const result = await gameHistoryService.saveGameResult('ROOM1', data);
            expect(result).not.toBeNull();
            expect(result.initialBoard.firstTeam).toBe('red');
        });

        it('should determine first team based on blueTotal=9', async () => {
            const data = createValidGameData({ redTotal: 8, blueTotal: 9 });
            const result = await gameHistoryService.saveGameResult('ROOM1', data);
            expect(result).not.toBeNull();
            expect(result.initialBoard.firstTeam).toBe('blue');
        });

        it('should default to red when neither team has 9 cards', async () => {
            const data = createValidGameData({ redTotal: 8, blueTotal: 8 });
            const result = await gameHistoryService.saveGameResult('ROOM1', data);
            expect(result).not.toBeNull();
            expect(result.initialBoard.firstTeam).toBe('red');
        });
    });

    describe('getGameHistory', () => {
        it('should return empty array for empty roomCode', async () => {
            const result = await gameHistoryService.getGameHistory('');
            expect(result).toEqual([]);
        });

        it('should return empty array when no game IDs found', async () => {
            mockRedis.zRange.mockResolvedValue([]);
            const result = await gameHistoryService.getGameHistory('ROOM1');
            expect(result).toEqual([]);
        });

        it('should handle null entries in mGet results', async () => {
            mockRedis.zRange.mockResolvedValue(['game-1', 'game-2']);
            mockRedis.mGet.mockResolvedValue([null, null]);

            const result = await gameHistoryService.getGameHistory('ROOM1');
            expect(result).toEqual([]);
        });

        it('should handle parse errors in game data', async () => {
            mockRedis.zRange.mockResolvedValue(['game-1']);
            mockRedis.mGet.mockResolvedValue(['not valid json']);

            const result = await gameHistoryService.getGameHistory('ROOM1');
            expect(result).toEqual([]);
            expect(logger.warn).toHaveBeenCalledWith(
                'Failed to parse game history entry',
                expect.any(Object)
            );
        });

        it('should return summaries for valid games', async () => {
            const game = {
                id: 'game-1',
                timestamp: 1000,
                startedAt: 900,
                endedAt: 1000,
                finalState: { winner: 'red', redScore: 9, blueScore: 5, redTotal: 9, blueTotal: 8 },
                teamNames: { red: 'Red', blue: 'Blue' },
                clues: [{ team: 'red', word: 'test', number: 3 }],
                history: [{ action: 'clue' }, { action: 'reveal' }]
            };
            mockRedis.zRange.mockResolvedValue(['game-1']);
            mockRedis.mGet.mockResolvedValue([JSON.stringify(game)]);

            const result = await gameHistoryService.getGameHistory('ROOM1');
            expect(result).toHaveLength(1);
            expect(result[0].id).toBe('game-1');
            expect(result[0].winner).toBe('red');
            expect(result[0].clueCount).toBe(1);
            expect(result[0].moveCount).toBe(2);
        });

        it('should handle Redis errors', async () => {
            mockRedis.zRange.mockRejectedValue(new Error('Redis error'));

            const result = await gameHistoryService.getGameHistory('ROOM1');
            expect(result).toEqual([]);
            expect(logger.error).toHaveBeenCalledWith(
                'Failed to get game history',
                expect.any(Object)
            );
        });

        it('should handle missing finalState fields', async () => {
            const game = {
                id: 'game-2',
                timestamp: 1000,
                startedAt: 900,
                endedAt: 1000,
                finalState: {},
                clues: null,
                history: null
            };
            mockRedis.zRange.mockResolvedValue(['game-2']);
            mockRedis.mGet.mockResolvedValue([JSON.stringify(game)]);

            const result = await gameHistoryService.getGameHistory('ROOM1');
            expect(result).toHaveLength(1);
            expect(result[0].clueCount).toBe(0);
            expect(result[0].moveCount).toBe(0);
        });
    });

    describe('getGameById', () => {
        it('should return null for empty roomCode', async () => {
            const result = await gameHistoryService.getGameById('', 'game-1');
            expect(result).toBeNull();
        });

        it('should return null for empty gameId', async () => {
            const result = await gameHistoryService.getGameById('ROOM1', '');
            expect(result).toBeNull();
        });

        it('should return null when game not found', async () => {
            mockRedis.get.mockResolvedValue(null);
            const result = await gameHistoryService.getGameById('ROOM1', 'nonexistent');
            expect(result).toBeNull();
        });

        it('should return game entry when found', async () => {
            const game = { id: 'game-1', roomCode: 'ROOM1' };
            mockRedis.get.mockResolvedValue(JSON.stringify(game));

            const result = await gameHistoryService.getGameById('ROOM1', 'game-1');
            expect(result).not.toBeNull();
            expect(result.id).toBe('game-1');
        });

        it('should handle parse errors', async () => {
            mockRedis.get.mockResolvedValue('not valid json');

            const result = await gameHistoryService.getGameById('ROOM1', 'game-1');
            expect(result).toBeNull();
            expect(logger.error).toHaveBeenCalledWith(
                'Failed to get game by ID',
                expect.any(Object)
            );
        });
    });

    describe('getReplayEvents', () => {
        it('should return null for empty roomCode', async () => {
            const result = await gameHistoryService.getReplayEvents('', 'game-1');
            expect(result).toBeNull();
        });

        it('should return null for empty gameId', async () => {
            const result = await gameHistoryService.getReplayEvents('ROOM1', '');
            expect(result).toBeNull();
        });

        it('should return null when game not found', async () => {
            mockRedis.get.mockResolvedValue(null);
            const result = await gameHistoryService.getReplayEvents('ROOM1', 'nonexistent');
            expect(result).toBeNull();
        });

        it('should build replay data with all action types', async () => {
            const game = {
                id: 'game-1',
                roomCode: 'ROOM1',
                timestamp: 1000,
                startedAt: 900,
                endedAt: 1000,
                initialBoard: { words: [], types: [], seed: 'test', firstTeam: 'red' },
                finalState: { redScore: 9, blueScore: 5, redTotal: 9, blueTotal: 8, winner: 'red', gameOver: true },
                teamNames: { red: 'Red', blue: 'Blue' },
                clues: [{ team: 'red', word: 'test', number: 3 }],
                history: [
                    { action: 'clue', timestamp: 100, team: 'red', word: 'animal', number: 3, spymaster: 'player1', guessesAllowed: 4 },
                    { action: 'reveal', timestamp: 200, index: 5, word: 'cat', type: 'red', team: 'red', player: 'player2', guessNumber: 1 },
                    { action: 'endTurn', timestamp: 300, fromTeam: 'red', toTeam: 'blue', player: 'player2' },
                    { action: 'forfeit', timestamp: 400, forfeitingTeam: 'blue', winner: 'red' },
                    { action: 'unknownAction', timestamp: 500, customField: 'value' }
                ]
            };
            mockRedis.get.mockResolvedValue(JSON.stringify(game));

            const result = await gameHistoryService.getReplayEvents('ROOM1', 'game-1');
            expect(result).not.toBeNull();
            expect(result.events).toHaveLength(5);

            // Check clue event
            expect(result.events[0].type).toBe('clue');
            expect(result.events[0].data.team).toBe('red');
            expect(result.events[0].data.word).toBe('animal');

            // Check reveal event
            expect(result.events[1].type).toBe('reveal');
            expect(result.events[1].data.index).toBe(5);

            // Check endTurn event
            expect(result.events[2].type).toBe('endTurn');
            expect(result.events[2].data.fromTeam).toBe('red');

            // Check forfeit event
            expect(result.events[3].type).toBe('forfeit');
            expect(result.events[3].data.forfeitingTeam).toBe('blue');

            // Check unknown action (default case)
            expect(result.events[4].type).toBe('unknownAction');

            // Check metadata
            expect(result.duration).toBe(100);
            expect(result.totalMoves).toBe(5);
            expect(result.totalClues).toBe(1);
        });

        it('should handle missing history and clues', async () => {
            const game = {
                id: 'game-1',
                roomCode: 'ROOM1',
                timestamp: 1000,
                startedAt: 1000,
                endedAt: 1000,
                initialBoard: { words: [], types: [], seed: 'test', firstTeam: 'red' },
                finalState: { redScore: 0, blueScore: 0, redTotal: 9, blueTotal: 8, winner: 'red', gameOver: true },
                teamNames: { red: 'Red', blue: 'Blue' }
            };
            mockRedis.get.mockResolvedValue(JSON.stringify(game));

            const result = await gameHistoryService.getReplayEvents('ROOM1', 'game-1');
            expect(result).not.toBeNull();
            expect(result.events).toHaveLength(0);
            expect(result.totalMoves).toBe(0);
            expect(result.totalClues).toBe(0);
        });

        it('should handle errors gracefully', async () => {
            mockRedis.get.mockRejectedValue(new Error('Redis error'));

            const result = await gameHistoryService.getReplayEvents('ROOM1', 'game-1');
            expect(result).toBeNull();
        });
    });

    describe('cleanupOldHistory', () => {
        it('should return 0 for empty roomCode', async () => {
            const result = await gameHistoryService.cleanupOldHistory('');
            expect(result).toBe(0);
        });

        it('should return 0 when no old games found', async () => {
            mockRedis.zRange.mockResolvedValue([]);
            const result = await gameHistoryService.cleanupOldHistory('ROOM1');
            expect(result).toBe(0);
        });

        it('should delete old game entries', async () => {
            mockRedis.zRange.mockResolvedValue(['old-game-1', 'old-game-2']);
            const result = await gameHistoryService.cleanupOldHistory('ROOM1');
            expect(result).toBe(2);
            expect(mockRedis.del).toHaveBeenCalled();
            expect(mockRedis.zRem).toHaveBeenCalled();
        });

        it('should handle errors gracefully', async () => {
            mockRedis.zRange.mockRejectedValue(new Error('Redis error'));
            const result = await gameHistoryService.cleanupOldHistory('ROOM1');
            expect(result).toBe(0);
        });
    });

    describe('getHistoryStats', () => {
        it('should return empty stats for empty roomCode', async () => {
            const result = await gameHistoryService.getHistoryStats('');
            expect(result.count).toBe(0);
            expect(result.oldest).toBeNull();
            expect(result.newest).toBeNull();
        });

        it('should return empty stats when no entries exist', async () => {
            mockRedis.zCard.mockResolvedValue(0);
            const result = await gameHistoryService.getHistoryStats('ROOM1');
            expect(result.count).toBe(0);
        });

        it('should return stats with oldest and newest', async () => {
            mockRedis.zCard.mockResolvedValue(5);
            mockRedis.zRange
                .mockResolvedValueOnce([{ value: 'oldest-game', score: 1000 }])
                .mockResolvedValueOnce([{ value: 'newest-game', score: 5000 }]);

            const result = await gameHistoryService.getHistoryStats('ROOM1');
            expect(result.count).toBe(5);
            expect(result.oldest).toEqual({ id: 'oldest-game', timestamp: 1000 });
            expect(result.newest).toEqual({ id: 'newest-game', timestamp: 5000 });
        });

        it('should handle empty zRange results', async () => {
            mockRedis.zCard.mockResolvedValue(5);
            mockRedis.zRange
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([]);

            const result = await gameHistoryService.getHistoryStats('ROOM1');
            expect(result.count).toBe(5);
            expect(result.oldest).toBeNull();
            expect(result.newest).toBeNull();
        });

        it('should handle errors and include error message', async () => {
            mockRedis.zCard.mockRejectedValue(new Error('Redis error'));

            const result = await gameHistoryService.getHistoryStats('ROOM1');
            expect(result.count).toBe(0);
            expect(result.error).toBe('Redis error');
        });
    });
});
