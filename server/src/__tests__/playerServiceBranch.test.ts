/**
 * Player Service Branch Coverage Tests
 *
 * Tests: JSON parse success, transaction success, INVALID_TEAM/INVALID_ROLE from Lua,
 * empty team cleanup, sort stability
 */

const mockRedisStorage: Record<string, string> = {};
const mockSets: Record<string, Set<string>> = {};

const mockRedis = {
    get: jest.fn(async (key: string) => mockRedisStorage[key] || null),
    set: jest.fn(async (key: string, value: string) => {
        mockRedisStorage[key] = value;
        return 'OK';
    }),
    del: jest.fn(async (keys: string | string[]) => {
        const keysArray = Array.isArray(keys) ? keys : [keys];
        keysArray.forEach(key => {
            delete mockRedisStorage[key];
            delete mockSets[key];
        });
        return keysArray.length;
    }),
    expire: jest.fn().mockResolvedValue(1),
    sAdd: jest.fn(async (key: string, member: string) => {
        if (!mockSets[key]) mockSets[key] = new Set();
        if (mockSets[key]!.has(member)) return 0;
        mockSets[key]!.add(member);
        return 1;
    }),
    sRem: jest.fn().mockResolvedValue(1),
    sMembers: jest.fn(async (key: string) => {
        const s = mockSets[key];
        return s ? Array.from(s) : [];
    }),
    sCard: jest.fn(async (key: string) => {
        const s = mockSets[key];
        return s ? s.size : 0;
    }),
    mGet: jest.fn(async (keys: string[]) => keys.map(k => mockRedisStorage[k] || null)),
    watch: jest.fn().mockResolvedValue('OK'),
    unwatch: jest.fn().mockResolvedValue('OK'),
    multi: jest.fn(() => ({
        set: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(['OK'])
    })),
    eval: jest.fn().mockResolvedValue(null),
    zAdd: jest.fn().mockResolvedValue(1),
    zRem: jest.fn().mockResolvedValue(1),
    zRangeByScore: jest.fn().mockResolvedValue([])
};

jest.mock('../config/redis', () => ({
    getRedis: () => mockRedis
}));

jest.mock('../utils/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
}));

jest.mock('../utils/timeout', () => ({
    withTimeout: (promise: Promise<unknown>) => promise,
    TIMEOUTS: { REDIS_OPERATION: 5000 }
}));

// Mock fs.readFileSync for Lua scripts
jest.mock('fs', () => ({
    readFileSync: jest.fn().mockReturnValue('-- mocked lua script')
}));

const playerService = require('../services/playerService');

describe('Player Service Branch Coverage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        Object.keys(mockRedisStorage).forEach(key => delete mockRedisStorage[key]);
        Object.keys(mockSets).forEach(key => delete mockSets[key]);
    });

    describe('getPlayer - JSON parse success', () => {
        it('should return parsed player when JSON is valid', async () => {
            const player = {
                sessionId: 'session-1',
                roomCode: 'testroom',
                nickname: 'Test',
                team: 'red',
                role: 'spectator',
                isHost: false,
                connected: true
            };
            mockRedisStorage['player:session-1'] = JSON.stringify(player);

            const result = await playerService.getPlayer('session-1');
            expect(result).toEqual(player);
        });

        it('should return null for corrupted player data', async () => {
            mockRedisStorage['player:session-1'] = '{bad json';

            const result = await playerService.getPlayer('session-1');
            expect(result).toBeNull();
        });
    });

    describe('updatePlayer - transaction success', () => {
        it('should update player atomically on first try', async () => {
            const player = {
                sessionId: 'session-1',
                roomCode: 'testroom',
                nickname: 'Test',
                team: 'red',
                role: 'spectator',
                isHost: false,
                connected: true
            };
            mockRedisStorage['player:session-1'] = JSON.stringify(player);

            const result = await playerService.updatePlayer('session-1', { nickname: 'NewName' });
            expect(result.nickname).toBe('NewName');
        });

        it('should throw when player not found', async () => {
            await expect(playerService.updatePlayer('nonexistent', { nickname: 'Name' }))
                .rejects.toThrow('Player not found');
        });

        it('should throw on corrupted player data during update', async () => {
            mockRedisStorage['player:session-1'] = '{bad json';

            await expect(playerService.updatePlayer('session-1', { nickname: 'Name' }))
                .rejects.toThrow('Corrupted player data');
        });

        it('should retry on transaction conflict and eventually fail', async () => {
            const player = {
                sessionId: 'session-1',
                roomCode: 'testroom',
                nickname: 'Test',
                team: 'red',
                role: 'spectator',
                isHost: false,
                connected: true
            };
            mockRedisStorage['player:session-1'] = JSON.stringify(player);

            // All transaction attempts return null (conflict)
            mockRedis.multi.mockReturnValue({
                set: jest.fn().mockReturnThis(),
                exec: jest.fn().mockResolvedValue(null)
            });

            await expect(playerService.updatePlayer('session-1', { nickname: 'Name' }))
                .rejects.toThrow('concurrent modifications');
        });
    });

    describe('setTeam - INVALID_TEAM from Lua', () => {
        it('should throw ValidationError when Lua returns INVALID_TEAM', async () => {
            const player = {
                sessionId: 'session-1',
                roomCode: 'testroom',
                nickname: 'Test',
                team: null,
                role: 'spectator',
                isHost: false,
                connected: true
            };
            mockRedisStorage['player:session-1'] = JSON.stringify(player);

            mockRedis.eval.mockResolvedValue(JSON.stringify({
                success: false,
                reason: 'INVALID_TEAM'
            }));

            await expect(playerService.setTeam('session-1', 'invalidteam'))
                .rejects.toThrow('Invalid team specified');
        });

        it('should throw TEAM_WOULD_BE_EMPTY when applicable', async () => {
            const player = {
                sessionId: 'session-1',
                roomCode: 'testroom',
                nickname: 'Test',
                team: 'red',
                role: 'spectator',
                isHost: false,
                connected: true
            };
            mockRedisStorage['player:session-1'] = JSON.stringify(player);

            mockRedis.eval.mockResolvedValue(JSON.stringify({
                success: false,
                reason: 'TEAM_WOULD_BE_EMPTY'
            }));

            await expect(playerService.setTeam('session-1', 'blue', true))
                .rejects.toThrow('cannot be empty');
        });

        it('should throw ServerError for unknown failure reason', async () => {
            const player = {
                sessionId: 'session-1',
                roomCode: 'testroom',
                nickname: 'Test',
                team: 'red',
                role: 'spectator',
                isHost: false,
                connected: true
            };
            mockRedisStorage['player:session-1'] = JSON.stringify(player);

            mockRedis.eval.mockResolvedValue(JSON.stringify({
                success: false,
                reason: 'UNKNOWN_REASON'
            }));

            await expect(playerService.setTeam('session-1', 'blue'))
                .rejects.toThrow('Failed to update player team');
        });

        it('should throw when result is null (player not found in Lua)', async () => {
            const player = {
                sessionId: 'session-1',
                roomCode: 'testroom',
                nickname: 'Test',
                team: 'red',
                role: 'spectator'
            };
            mockRedisStorage['player:session-1'] = JSON.stringify(player);

            mockRedis.eval.mockResolvedValue(null);

            await expect(playerService.setTeam('session-1', 'blue'))
                .rejects.toThrow('Player not found');
        });

        it('should return player on successful team change', async () => {
            const player = {
                sessionId: 'session-1',
                roomCode: 'testroom',
                nickname: 'Test',
                team: null,
                role: 'spectator',
                isHost: false,
                connected: true
            };
            mockRedisStorage['player:session-1'] = JSON.stringify(player);

            const updatedPlayer = { ...player, team: 'red' };
            mockRedis.eval.mockResolvedValue(JSON.stringify({
                success: true,
                player: updatedPlayer
            }));

            const result = await playerService.setTeam('session-1', 'red');
            expect(result.team).toBe('red');
        });

        it('should throw when player has no roomCode', async () => {
            const player = {
                sessionId: 'session-1',
                roomCode: '',
                nickname: 'Test',
                team: null,
                role: 'spectator'
            };
            mockRedisStorage['player:session-1'] = JSON.stringify(player);

            await expect(playerService.setTeam('session-1', 'red'))
                .rejects.toThrow('not associated with a room');
        });

        it('should handle non-ValidationError thrown during parse', async () => {
            const player = {
                sessionId: 'session-1',
                roomCode: 'testroom',
                nickname: 'Test',
                team: null,
                role: 'spectator'
            };
            mockRedisStorage['player:session-1'] = JSON.stringify(player);

            // Return something that is not valid JSON
            mockRedis.eval.mockResolvedValue('not json {{{');

            await expect(playerService.setTeam('session-1', 'red'))
                .rejects.toThrow('Failed to update player team');
        });
    });

    describe('setRole - INVALID_ROLE from Lua', () => {
        it('should throw ValidationError when Lua returns INVALID_ROLE', async () => {
            const player = {
                sessionId: 'session-1',
                roomCode: 'testroom',
                nickname: 'Test',
                team: 'red',
                role: 'spectator',
                isHost: false
            };
            mockRedisStorage['player:session-1'] = JSON.stringify(player);

            mockRedis.eval.mockResolvedValue(JSON.stringify({
                success: false,
                reason: 'INVALID_ROLE'
            }));

            await expect(playerService.setRole('session-1', 'invalidrole'))
                .rejects.toThrow('Invalid role specified');
        });

        it('should throw when ROLE_TAKEN', async () => {
            const player = {
                sessionId: 'session-1',
                roomCode: 'testroom',
                nickname: 'Test',
                team: 'red',
                role: 'spectator'
            };
            mockRedisStorage['player:session-1'] = JSON.stringify(player);

            mockRedis.eval.mockResolvedValue(JSON.stringify({
                success: false,
                reason: 'ROLE_TAKEN',
                existingNickname: 'OtherPlayer'
            }));

            await expect(playerService.setRole('session-1', 'spymaster'))
                .rejects.toThrow('already has a spymaster');
        });

        it('should throw when NO_TEAM', async () => {
            const player = {
                sessionId: 'session-1',
                roomCode: 'testroom',
                nickname: 'Test',
                team: null,
                role: 'spectator'
            };
            mockRedisStorage['player:session-1'] = JSON.stringify(player);

            mockRedis.eval.mockResolvedValue(JSON.stringify({
                success: false,
                reason: 'NO_TEAM'
            }));

            await expect(playerService.setRole('session-1', 'spymaster'))
                .rejects.toThrow('Must join a team');
        });

        it('should throw ServerError for unknown failure', async () => {
            const player = {
                sessionId: 'session-1',
                roomCode: 'testroom',
                nickname: 'Test',
                team: 'red',
                role: 'spectator'
            };
            mockRedisStorage['player:session-1'] = JSON.stringify(player);

            mockRedis.eval.mockResolvedValue(JSON.stringify({
                success: false,
                reason: 'UNKNOWN'
            }));

            await expect(playerService.setRole('session-1', 'spymaster'))
                .rejects.toThrow('Failed to update player role');
        });

        it('should handle null result', async () => {
            const player = {
                sessionId: 'session-1',
                roomCode: 'testroom',
                nickname: 'Test',
                team: 'red',
                role: 'spectator'
            };
            mockRedisStorage['player:session-1'] = JSON.stringify(player);

            mockRedis.eval.mockResolvedValue(null);

            await expect(playerService.setRole('session-1', 'spymaster'))
                .rejects.toThrow('Player not found');
        });

        it('should return player on success', async () => {
            const player = {
                sessionId: 'session-1',
                roomCode: 'testroom',
                nickname: 'Test',
                team: 'red',
                role: 'spectator'
            };
            mockRedisStorage['player:session-1'] = JSON.stringify(player);

            const updatedPlayer = { ...player, role: 'spymaster' };
            mockRedis.eval.mockResolvedValue(JSON.stringify({
                success: true,
                player: updatedPlayer
            }));

            const result = await playerService.setRole('session-1', 'spymaster');
            expect(result.role).toBe('spymaster');
        });

        it('should use updatePlayer for spectator role', async () => {
            const player = {
                sessionId: 'session-1',
                roomCode: 'testroom',
                nickname: 'Test',
                team: 'red',
                role: 'clicker',
                isHost: false,
                connected: true
            };
            mockRedisStorage['player:session-1'] = JSON.stringify(player);

            // Multi/exec for updatePlayer succeeds
            mockRedis.multi.mockReturnValue({
                set: jest.fn().mockReturnThis(),
                exec: jest.fn().mockResolvedValue(['OK'])
            });

            const result = await playerService.setRole('session-1', 'spectator');
            expect(result.role).toBe('spectator');
        });

        it('should handle non-ValidationError during JSON parse in setRole', async () => {
            const player = {
                sessionId: 'session-1',
                roomCode: 'testroom',
                nickname: 'Test',
                team: 'red',
                role: 'spectator'
            };
            mockRedisStorage['player:session-1'] = JSON.stringify(player);

            mockRedis.eval.mockResolvedValue('invalid json {{{');

            await expect(playerService.setRole('session-1', 'spymaster'))
                .rejects.toThrow('Failed to update player role');
        });

        it('should throw when player has no roomCode in setRole', async () => {
            const player = {
                sessionId: 'session-1',
                roomCode: '',
                nickname: 'Test',
                team: 'red',
                role: 'spectator'
            };
            mockRedisStorage['player:session-1'] = JSON.stringify(player);

            await expect(playerService.setRole('session-1', 'spymaster'))
                .rejects.toThrow('not associated with a room');
        });
    });

    describe('getTeamMembers - empty team cleanup', () => {
        it('should clean up orphaned entries and delete empty team set', async () => {
            mockSets['room:testroom:team:red'] = new Set(['session-1', 'session-2']);

            // session-1 has valid data but wrong team, session-2 has no data
            mockRedis.mGet.mockResolvedValue([
                JSON.stringify({ sessionId: 'session-1', team: 'blue', connected: true }),
                null
            ]);

            // After cleanup, team set is empty
            mockRedis.sCard.mockResolvedValue(0);

            const result = await playerService.getTeamMembers('testroom', 'red');
            expect(result).toEqual([]);
            expect(mockRedis.del).toHaveBeenCalled();
        });

        it('should parse valid players correctly', async () => {
            mockSets['room:testroom:team:red'] = new Set(['session-1']);

            mockRedis.mGet.mockResolvedValue([
                JSON.stringify({ sessionId: 'session-1', team: 'red', connected: true, nickname: 'Test' })
            ]);

            const result = await playerService.getTeamMembers('testroom', 'red');
            expect(result).toHaveLength(1);
            expect(result[0].nickname).toBe('Test');
        });

        it('should handle JSON parse errors in team members', async () => {
            mockSets['room:testroom:team:red'] = new Set(['session-1']);

            mockRedis.mGet.mockResolvedValue(['{bad json']);

            mockRedis.sCard.mockResolvedValue(0);

            const result = await playerService.getTeamMembers('testroom', 'red');
            expect(result).toEqual([]);
        });
    });

    describe('getPlayersInRoom - sort stability', () => {
        it('should sort by connectedAt then sessionId for stability', async () => {
            const time = Date.now();
            mockSets['room:testroom:players'] = new Set(['a-session', 'b-session', 'c-session']);

            mockRedis.mGet.mockResolvedValue([
                JSON.stringify({ sessionId: 'a-session', connectedAt: time, nickname: 'A', connected: true }),
                JSON.stringify({ sessionId: 'b-session', connectedAt: time, nickname: 'B', connected: true }),
                JSON.stringify({ sessionId: 'c-session', connectedAt: time - 1000, nickname: 'C', connected: true })
            ]);

            const result = await playerService.getPlayersInRoom('testroom');
            expect(result[0].nickname).toBe('C'); // earliest connectedAt
            // a-session < b-session for same connectedAt
            expect(result[1].sessionId).toBe('a-session');
            expect(result[2].sessionId).toBe('b-session');
        });

        it('should handle players with null connectedAt', async () => {
            mockSets['room:testroom:players'] = new Set(['session-1']);

            mockRedis.mGet.mockResolvedValue([
                JSON.stringify({ sessionId: 'session-1', connectedAt: null, nickname: 'A', connected: true })
            ]);

            const result = await playerService.getPlayersInRoom('testroom');
            expect(result).toHaveLength(1);
        });
    });

    describe('atomicHostTransfer', () => {
        it('should return success false with reason when script returns null', async () => {
            mockRedis.eval.mockResolvedValue(null);

            const result = await playerService.atomicHostTransfer('old-host', 'new-host', 'testroom');
            expect(result.success).toBe(false);
            expect(result.reason).toBe('SCRIPT_FAILED');
        });

        it('should handle errors gracefully', async () => {
            mockRedis.eval.mockRejectedValue(new Error('Script error'));

            const result = await playerService.atomicHostTransfer('old-host', 'new-host', 'testroom');
            expect(result.success).toBe(false);
            expect(result.reason).toBe('SCRIPT_ERROR');
        });

        it('should return parsed result on success', async () => {
            mockRedis.eval.mockResolvedValue(JSON.stringify({
                success: true,
                oldHost: { isHost: false },
                newHost: { isHost: true }
            }));

            const result = await playerService.atomicHostTransfer('old-host', 'new-host', 'testroom');
            expect(result.success).toBe(true);
        });

        it('should return parsed result when transfer fails', async () => {
            mockRedis.eval.mockResolvedValue(JSON.stringify({
                success: false,
                reason: 'OLD_HOST_NOT_FOUND'
            }));

            const result = await playerService.atomicHostTransfer('old-host', 'new-host', 'testroom');
            expect(result.success).toBe(false);
            expect(result.reason).toBe('OLD_HOST_NOT_FOUND');
        });
    });

    describe('getPlayersInRoom - orphan cleanup', () => {
        it('should clean up orphaned session IDs', async () => {
            mockSets['room:testroom:players'] = new Set(['session-1', 'orphan-1']);

            mockRedis.mGet.mockResolvedValue([
                JSON.stringify({ sessionId: 'session-1', connectedAt: Date.now(), nickname: 'A', connected: true }),
                null // orphan
            ]);

            const result = await playerService.getPlayersInRoom('testroom');
            expect(result).toHaveLength(1);
            expect(mockRedis.sRem).toHaveBeenCalled();
        });
    });
});
