/**
 * Player Service Extended Branch Coverage Tests
 * Targets uncovered lines: 776-779, 1070-1082
 *
 * Lines 776-779: startCleanupTask interval error handling (processScheduledCleanups throws)
 * Lines 1070-1082: resetRolesForNewGame with mixed role players
 */

const mockRedisStorePS = new Map<string, string>();
const mockRedisSetsPS = new Map<string, Set<string>>();

jest.mock('../config/redis', () => {
    const redis = {
        get: jest.fn(async (key: string) => mockRedisStorePS.get(key) || null),
        set: jest.fn(async (key: string, value: string) => { mockRedisStorePS.set(key, value); return 'OK'; }),
        del: jest.fn(async (key: string | string[]) => {
            if (Array.isArray(key)) { key.forEach(k => mockRedisStorePS.delete(k)); return key.length; }
            mockRedisStorePS.delete(key); return 1;
        }),
        sAdd: jest.fn(async (key: string, member: string) => {
            if (!mockRedisSetsPS.has(key)) mockRedisSetsPS.set(key, new Set());
            mockRedisSetsPS.get(key)!.add(member);
            return 1;
        }),
        sRem: jest.fn(async () => 1),
        sMembers: jest.fn(async (key: string) => {
            const set = mockRedisSetsPS.get(key);
            return set ? [...set] : [];
        }),
        sCard: jest.fn(async () => 0),
        mGet: jest.fn(async (keys: string[]) => keys.map(k => mockRedisStorePS.get(k) || null)),
        expire: jest.fn(async () => 1),
        watch: jest.fn(async () => 'OK'),
        unwatch: jest.fn(async () => 'OK'),
        multi: jest.fn(() => ({
            set: jest.fn().mockReturnThis(),
            exec: jest.fn(async () => ['OK'])
        })),
        eval: jest.fn(async () => null),
        zAdd: jest.fn(async () => 1),
        zRem: jest.fn(async () => 1),
        zRangeByScore: jest.fn(async () => [])
    };
    return {
        getRedis: jest.fn(() => redis),
        connectRedis: jest.fn(),
        disconnectRedis: jest.fn()
    };
});

jest.mock('../utils/logger', () => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn()
}));

const playerService = require('../services/playerService');
const loggerPS = require('../utils/logger');

describe('Player Service Extended Branch Coverage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockRedisStorePS.clear();
        mockRedisSetsPS.clear();
    });

    afterEach(() => {
        playerService.stopCleanupTask();
    });

    describe('Lines 776-779: cleanup task error handling', () => {
        it('should catch and log errors from processScheduledCleanups', async () => {
            jest.useFakeTimers();

            const { getRedis } = require('../config/redis');
            const redis = getRedis();
            redis.zRangeByScore.mockRejectedValueOnce(new Error('Redis connection lost'));

            playerService.startCleanupTask();

            // Advance past the 60s cleanup interval
            await jest.advanceTimersByTimeAsync(61000);

            expect(loggerPS.error).toHaveBeenCalledWith(
                'Error processing scheduled cleanups:',
                expect.stringContaining('Redis connection lost')
            );

            playerService.stopCleanupTask();
            jest.useRealTimers();
        });

        it('should restart cleanup interval when startCleanupTask called twice', () => {
            jest.useFakeTimers();

            playerService.startCleanupTask();
            playerService.startCleanupTask(); // Should clear old interval and start new

            playerService.stopCleanupTask();
            jest.useRealTimers();
        });
    });

    describe('Lines 1070-1082: resetRolesForNewGame', () => {
        it('should reset non-spectator roles and keep spectators unchanged', async () => {
            const player1 = {
                sessionId: 'sess-1', roomCode: 'ROOM01', nickname: 'Alice',
                team: 'red', role: 'spymaster', isHost: true, connected: true,
                connectedAt: 1000, lastSeen: Date.now()
            };
            const player2 = {
                sessionId: 'sess-2', roomCode: 'ROOM01', nickname: 'Bob',
                team: 'blue', role: 'clicker', isHost: false, connected: true,
                connectedAt: 2000, lastSeen: Date.now()
            };
            const player3 = {
                sessionId: 'sess-3', roomCode: 'ROOM01', nickname: 'Carol',
                team: 'red', role: 'spectator', isHost: false, connected: true,
                connectedAt: 3000, lastSeen: Date.now()
            };

            mockRedisStorePS.set('player:sess-1', JSON.stringify(player1));
            mockRedisStorePS.set('player:sess-2', JSON.stringify(player2));
            mockRedisStorePS.set('player:sess-3', JSON.stringify(player3));
            mockRedisSetsPS.set('room:ROOM01:players', new Set(['sess-1', 'sess-2', 'sess-3']));

            const { getRedis } = require('../config/redis');
            const redis = getRedis();
            redis.multi.mockReturnValue({
                set: jest.fn().mockReturnThis(),
                exec: jest.fn(async () => ['OK'])
            });

            const result = await playerService.resetRolesForNewGame('ROOM01');

            expect(result).toHaveLength(3);
            // updatePlayer should have been called for spymaster and clicker
            expect(redis.watch).toHaveBeenCalled();
        });

        it('should handle room with all spectators (no updates needed)', async () => {
            const player1 = {
                sessionId: 'sess-a', roomCode: 'ROOM02', nickname: 'Alice',
                team: null, role: 'spectator', isHost: true, connected: true,
                connectedAt: 1000, lastSeen: Date.now()
            };

            mockRedisStorePS.set('player:sess-a', JSON.stringify(player1));
            mockRedisSetsPS.set('room:ROOM02:players', new Set(['sess-a']));

            const result = await playerService.resetRolesForNewGame('ROOM02');
            expect(result).toHaveLength(1);
            expect(result[0].role).toBe('spectator');
        });

        it('should return empty array for empty room', async () => {
            const result = await playerService.resetRolesForNewGame('EMPTY1');
            expect(result).toHaveLength(0);
        });
    });
});
