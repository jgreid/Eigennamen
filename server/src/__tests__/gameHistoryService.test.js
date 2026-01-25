/**
 * Unit Tests for Game History Service
 *
 * These tests mock Redis to test the game history service in isolation.
 */

// Mock Redis before requiring the service
jest.mock('../config/redis', () => {
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

    // Mock multi/exec for pipeline
    const mockPipeline = {
        set: jest.fn().mockReturnThis(),
        zAdd: jest.fn().mockReturnThis(),
        zRemRangeByRank: jest.fn().mockReturnThis(),
        expire: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([['OK'], [1], [0], [1]])
    };
    mockRedis.multi.mockReturnValue(mockPipeline);

    return {
        getRedis: () => mockRedis
    };
});

// Mock logger
jest.mock('../utils/logger', () => ({
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
}));

const gameHistoryService = require('../services/gameHistoryService');
const { getRedis } = require('../config/redis');

describe('Game History Service', () => {
    let mockRedis;
    let storage;

    beforeEach(() => {
        mockRedis = getRedis();
        storage = {};

        // Reset mocks
        jest.clearAllMocks();

        // Setup mock implementations
        mockRedis.set.mockImplementation(async (key, value) => {
            storage[key] = value;
            return 'OK';
        });

        mockRedis.get.mockImplementation(async (key) => {
            return storage[key] || null;
        });

        mockRedis.mGet.mockImplementation(async (keys) => {
            return keys.map(key => storage[key] || null);
        });

        mockRedis.del.mockImplementation(async (keys) => {
            const keysArray = Array.isArray(keys) ? keys : [keys];
            let count = 0;
            keysArray.forEach(key => {
                if (storage[key]) {
                    delete storage[key];
                    count++;
                }
            });
            return count;
        });

        mockRedis.zAdd.mockImplementation(async (key, entry) => {
            if (!storage[`zset:${key}`]) {
                storage[`zset:${key}`] = [];
            }
            storage[`zset:${key}`].push({ score: entry.score, value: entry.value });
            storage[`zset:${key}`].sort((a, b) => a.score - b.score);
            return 1;
        });

        mockRedis.zRange.mockImplementation(async (key, start, end, options = {}) => {
            const data = storage[`zset:${key}`] || [];
            let result = [...data];

            if (options.REV) {
                result = result.reverse();
            }

            // Handle negative indices
            const len = result.length;
            const actualStart = start < 0 ? Math.max(0, len + start) : start;
            const actualEnd = end < 0 ? len + end : end;

            result = result.slice(actualStart, actualEnd + 1);

            if (options.WITHSCORES) {
                return result;
            }
            return result.map(item => item.value);
        });

        mockRedis.zCard.mockImplementation(async (key) => {
            return (storage[`zset:${key}`] || []).length;
        });

        mockRedis.zRem.mockImplementation(async (key, values) => {
            if (!storage[`zset:${key}`]) return 0;
            const valuesToRemove = Array.isArray(values) ? values : [values];
            const before = storage[`zset:${key}`].length;
            storage[`zset:${key}`] = storage[`zset:${key}`].filter(
                item => !valuesToRemove.includes(item.value)
            );
            return before - storage[`zset:${key}`].length;
        });

        // Reset pipeline mock
        const mockPipeline = {
            set: jest.fn().mockReturnThis(),
            zAdd: jest.fn().mockReturnThis(),
            zRemRangeByRank: jest.fn().mockReturnThis(),
            expire: jest.fn().mockReturnThis(),
            exec: jest.fn().mockImplementation(async () => {
                return [['OK'], [1], [0], [1]];
            })
        };
        mockRedis.multi.mockReturnValue(mockPipeline);
    });

    describe('saveGameResult', () => {
        const mockGameData = {
            id: 'game-123',
            seed: 'test-seed',
            words: ['APPLE', 'BANANA', 'CHERRY'],
            types: ['red', 'blue', 'neutral'],
            revealed: [true, true, false],
            redScore: 1,
            blueScore: 1,
            redTotal: 9,
            blueTotal: 8,
            winner: 'red',
            gameOver: true,
            clues: [
                { team: 'red', word: 'FRUIT', number: 2, spymaster: 'Alice' }
            ],
            history: [
                { action: 'clue', team: 'red', word: 'FRUIT', number: 2 },
                { action: 'reveal', index: 0, word: 'APPLE', type: 'red' }
            ],
            createdAt: Date.now() - 60000,
            stateVersion: 10
        };

        test('saves game result with correct structure', async () => {
            const result = await gameHistoryService.saveGameResult('ROOM1', mockGameData);

            expect(result).not.toBeNull();
            expect(result.id).toBe('game-123');
            expect(result.roomCode).toBe('ROOM1');
            expect(result.initialBoard.words).toEqual(['APPLE', 'BANANA', 'CHERRY']);
            expect(result.initialBoard.types).toEqual(['red', 'blue', 'neutral']);
            expect(result.finalState.winner).toBe('red');
            expect(result.finalState.redScore).toBe(1);
            expect(result.clues).toHaveLength(1);
            expect(result.history).toHaveLength(2);
        });

        test('generates unique ID if game has none', async () => {
            const gameWithoutId = { ...mockGameData };
            delete gameWithoutId.id;

            const result = await gameHistoryService.saveGameResult('ROOM1', gameWithoutId);

            expect(result).not.toBeNull();
            expect(result.id).toBeDefined();
            expect(result.id.length).toBeGreaterThan(0);
        });

        test('returns null for missing parameters', async () => {
            const result1 = await gameHistoryService.saveGameResult(null, mockGameData);
            const result2 = await gameHistoryService.saveGameResult('ROOM1', null);

            expect(result1).toBeNull();
            expect(result2).toBeNull();
        });

        test('determines first team based on totals', async () => {
            const redFirstGame = { ...mockGameData, redTotal: 9, blueTotal: 8 };
            const blueFirstGame = { ...mockGameData, redTotal: 8, blueTotal: 9 };

            const redResult = await gameHistoryService.saveGameResult('ROOM1', redFirstGame);
            const blueResult = await gameHistoryService.saveGameResult('ROOM2', blueFirstGame);

            expect(redResult.initialBoard.firstTeam).toBe('red');
            expect(blueResult.initialBoard.firstTeam).toBe('blue');
        });

        test('includes team names if provided', async () => {
            const gameWithTeamNames = {
                ...mockGameData,
                teamNames: { red: 'Fire', blue: 'Ice' }
            };

            const result = await gameHistoryService.saveGameResult('ROOM1', gameWithTeamNames);

            expect(result.teamNames).toEqual({ red: 'Fire', blue: 'Ice' });
        });

        test('uses default team names if not provided', async () => {
            const result = await gameHistoryService.saveGameResult('ROOM1', mockGameData);

            expect(result.teamNames).toEqual({ red: 'Red', blue: 'Blue' });
        });
    });

    describe('getGameHistory', () => {
        beforeEach(async () => {
            // Pre-populate some game history
            const games = [
                { id: 'game-1', timestamp: 1000, finalState: { winner: 'red', redScore: 5, blueScore: 3 } },
                { id: 'game-2', timestamp: 2000, finalState: { winner: 'blue', redScore: 4, blueScore: 6 } },
                { id: 'game-3', timestamp: 3000, finalState: { winner: 'red', redScore: 9, blueScore: 7 } }
            ];

            storage[`zset:gameHistoryIndex:ROOM1`] = games.map(g => ({ score: g.timestamp, value: g.id }));
            games.forEach(g => {
                storage[`gameHistory:ROOM1:${g.id}`] = JSON.stringify({
                    ...g,
                    roomCode: 'ROOM1',
                    startedAt: g.timestamp - 60000,
                    endedAt: g.timestamp,
                    clues: [],
                    history: [],
                    teamNames: { red: 'Red', blue: 'Blue' }
                });
            });
        });

        test('returns game history in reverse chronological order', async () => {
            const history = await gameHistoryService.getGameHistory('ROOM1', 10);

            expect(history).toHaveLength(3);
            expect(history[0].id).toBe('game-3');
            expect(history[1].id).toBe('game-2');
            expect(history[2].id).toBe('game-1');
        });

        test('respects limit parameter', async () => {
            const history = await gameHistoryService.getGameHistory('ROOM1', 2);

            expect(history).toHaveLength(2);
            expect(history[0].id).toBe('game-3');
            expect(history[1].id).toBe('game-2');
        });

        test('returns empty array for non-existent room', async () => {
            const history = await gameHistoryService.getGameHistory('NONEXISTENT', 10);

            expect(history).toEqual([]);
        });

        test('returns empty array for null room code', async () => {
            const history = await gameHistoryService.getGameHistory(null, 10);

            expect(history).toEqual([]);
        });

        test('returns summaries with correct fields', async () => {
            const history = await gameHistoryService.getGameHistory('ROOM1', 1);

            expect(history[0]).toHaveProperty('id');
            expect(history[0]).toHaveProperty('timestamp');
            expect(history[0]).toHaveProperty('winner');
            expect(history[0]).toHaveProperty('redScore');
            expect(history[0]).toHaveProperty('blueScore');
            expect(history[0]).toHaveProperty('clueCount');
            expect(history[0]).toHaveProperty('moveCount');
        });

        test('handles corrupted data gracefully', async () => {
            storage['gameHistory:ROOM1:game-2'] = 'invalid json';

            const history = await gameHistoryService.getGameHistory('ROOM1', 10);

            // Should return 2 valid entries, skipping the corrupted one
            expect(history).toHaveLength(2);
        });
    });

    describe('getGameById', () => {
        const mockStoredGame = {
            id: 'game-123',
            roomCode: 'ROOM1',
            timestamp: Date.now(),
            initialBoard: {
                words: ['APPLE', 'BANANA'],
                types: ['red', 'blue'],
                seed: 'test-seed',
                firstTeam: 'red'
            },
            finalState: {
                winner: 'red',
                redScore: 5,
                blueScore: 3
            },
            clues: [],
            history: [],
            teamNames: { red: 'Red', blue: 'Blue' }
        };

        beforeEach(() => {
            storage['gameHistory:ROOM1:game-123'] = JSON.stringify(mockStoredGame);
        });

        test('retrieves game by ID', async () => {
            const game = await gameHistoryService.getGameById('ROOM1', 'game-123');

            expect(game).not.toBeNull();
            expect(game.id).toBe('game-123');
            expect(game.roomCode).toBe('ROOM1');
            expect(game.initialBoard.words).toEqual(['APPLE', 'BANANA']);
        });

        test('returns null for non-existent game', async () => {
            const game = await gameHistoryService.getGameById('ROOM1', 'non-existent');

            expect(game).toBeNull();
        });

        test('returns null for missing parameters', async () => {
            const result1 = await gameHistoryService.getGameById(null, 'game-123');
            const result2 = await gameHistoryService.getGameById('ROOM1', null);

            expect(result1).toBeNull();
            expect(result2).toBeNull();
        });
    });

    describe('getReplayEvents', () => {
        const mockStoredGame = {
            id: 'game-123',
            roomCode: 'ROOM1',
            timestamp: 5000,
            startedAt: 1000,
            endedAt: 5000,
            initialBoard: {
                words: ['APPLE', 'BANANA', 'CHERRY'],
                types: ['red', 'blue', 'neutral'],
                seed: 'test-seed',
                firstTeam: 'red'
            },
            finalState: {
                winner: 'red',
                redScore: 2,
                blueScore: 1,
                redTotal: 9,
                blueTotal: 8
            },
            clues: [
                { team: 'red', word: 'FRUIT', number: 2, spymaster: 'Alice', timestamp: 2000 },
                { team: 'blue', word: 'YELLOW', number: 1, spymaster: 'Bob', timestamp: 4000 }
            ],
            history: [
                { action: 'clue', team: 'red', word: 'FRUIT', number: 2, spymaster: 'Alice', timestamp: 2000 },
                { action: 'reveal', index: 0, word: 'APPLE', type: 'red', team: 'red', player: 'Carol', timestamp: 2500 },
                { action: 'reveal', index: 1, word: 'BANANA', type: 'blue', team: 'red', player: 'Carol', timestamp: 3000 },
                { action: 'clue', team: 'blue', word: 'YELLOW', number: 1, spymaster: 'Bob', timestamp: 4000 },
                { action: 'reveal', index: 2, word: 'CHERRY', type: 'neutral', team: 'blue', player: 'Dave', timestamp: 4500 }
            ],
            teamNames: { red: 'Red', blue: 'Blue' }
        };

        beforeEach(() => {
            storage['gameHistory:ROOM1:game-123'] = JSON.stringify(mockStoredGame);
        });

        test('returns structured replay data', async () => {
            const replay = await gameHistoryService.getReplayEvents('ROOM1', 'game-123');

            expect(replay).not.toBeNull();
            expect(replay.id).toBe('game-123');
            expect(replay.roomCode).toBe('ROOM1');
            expect(replay.initialBoard).toBeDefined();
            expect(replay.events).toBeDefined();
            expect(replay.finalState).toBeDefined();
        });

        test('builds events array from history', async () => {
            const replay = await gameHistoryService.getReplayEvents('ROOM1', 'game-123');

            expect(replay.events).toHaveLength(5);
            expect(replay.events[0].type).toBe('clue');
            expect(replay.events[1].type).toBe('reveal');
        });

        test('sorts events by timestamp', async () => {
            const replay = await gameHistoryService.getReplayEvents('ROOM1', 'game-123');

            for (let i = 1; i < replay.events.length; i++) {
                expect(replay.events[i].timestamp).toBeGreaterThanOrEqual(replay.events[i - 1].timestamp);
            }
        });

        test('includes clue event data correctly', async () => {
            const replay = await gameHistoryService.getReplayEvents('ROOM1', 'game-123');

            const clueEvent = replay.events.find(e => e.type === 'clue');
            expect(clueEvent.data.team).toBe('red');
            expect(clueEvent.data.word).toBe('FRUIT');
            expect(clueEvent.data.number).toBe(2);
            expect(clueEvent.data.spymaster).toBe('Alice');
        });

        test('includes reveal event data correctly', async () => {
            const replay = await gameHistoryService.getReplayEvents('ROOM1', 'game-123');

            const revealEvent = replay.events.find(e => e.type === 'reveal');
            expect(revealEvent.data.index).toBe(0);
            expect(revealEvent.data.word).toBe('APPLE');
            expect(revealEvent.data.type).toBe('red');
            expect(revealEvent.data.team).toBe('red');
            expect(revealEvent.data.player).toBe('Carol');
        });

        test('calculates duration correctly', async () => {
            const replay = await gameHistoryService.getReplayEvents('ROOM1', 'game-123');

            expect(replay.duration).toBe(4000); // 5000 - 1000
        });

        test('includes move and clue counts', async () => {
            const replay = await gameHistoryService.getReplayEvents('ROOM1', 'game-123');

            expect(replay.totalMoves).toBe(5);
            expect(replay.totalClues).toBe(2);
        });

        test('returns null for non-existent game', async () => {
            const replay = await gameHistoryService.getReplayEvents('ROOM1', 'non-existent');

            expect(replay).toBeNull();
        });

        test('returns null for missing parameters', async () => {
            const result1 = await gameHistoryService.getReplayEvents(null, 'game-123');
            const result2 = await gameHistoryService.getReplayEvents('ROOM1', null);

            expect(result1).toBeNull();
            expect(result2).toBeNull();
        });
    });

    describe('getHistoryStats', () => {
        beforeEach(() => {
            storage[`zset:gameHistoryIndex:ROOM1`] = [
                { score: 1000, value: 'game-1' },
                { score: 2000, value: 'game-2' },
                { score: 3000, value: 'game-3' }
            ];
        });

        test('returns correct stats', async () => {
            const stats = await gameHistoryService.getHistoryStats('ROOM1');

            expect(stats.count).toBe(3);
            expect(stats.oldest).toBeDefined();
            expect(stats.newest).toBeDefined();
        });

        test('returns empty stats for non-existent room', async () => {
            const stats = await gameHistoryService.getHistoryStats('NONEXISTENT');

            expect(stats.count).toBe(0);
            expect(stats.oldest).toBeNull();
            expect(stats.newest).toBeNull();
        });

        test('returns empty stats for null room code', async () => {
            const stats = await gameHistoryService.getHistoryStats(null);

            expect(stats.count).toBe(0);
        });
    });

    describe('Constants', () => {
        test('exports TTL constant', () => {
            expect(gameHistoryService.GAME_HISTORY_TTL).toBe(30 * 24 * 60 * 60);
        });

        test('exports max history constant', () => {
            expect(gameHistoryService.MAX_HISTORY_PER_ROOM).toBe(100);
        });
    });
});
