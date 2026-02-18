/**
 * Tests for player/mutations.ts edge cases
 *
 * Covers: Lua result parsing failures, INVALID_TEAM, INVALID_ROLE,
 * success-without-player-data, and roomCode-missing paths
 */

const mockRedis = {
    get: jest.fn(),
    set: jest.fn().mockResolvedValue('OK'),
    eval: jest.fn(),
    sMembers: jest.fn().mockResolvedValue([]),
    expire: jest.fn().mockResolvedValue(1),
};

jest.mock('../../config/redis', () => ({
    getRedis: () => mockRedis
}));

jest.mock('../../utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));

jest.mock('../../services/playerService', () => ({
    getPlayer: jest.fn(),
    updatePlayer: jest.fn(),
    createPlayer: jest.fn(),
    removePlayer: jest.fn(),
    getPlayersInRoom: jest.fn(),
}));

const { setTeam, setRole } = require('../../services/player/mutations');
const { getPlayer, updatePlayer } = require('../../services/playerService');

describe('setTeam edge cases', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('throws when player has no roomCode', async () => {
        getPlayer.mockResolvedValue({
            sessionId: 'p1',
            team: 'red',
            roomCode: null
        });

        await expect(setTeam('p1', 'blue')).rejects.toThrow('not associated with a room');
    });

    test('throws when Lua returns INVALID_TEAM', async () => {
        getPlayer.mockResolvedValue({
            sessionId: 'p1',
            team: 'red',
            roomCode: 'ROOM1'
        });
        mockRedis.eval.mockResolvedValue(JSON.stringify({
            success: false,
            reason: 'INVALID_TEAM'
        }));

        await expect(setTeam('p1', 'invalid')).rejects.toThrow('Invalid team');
    });

    test('throws when Lua returns success without player data', async () => {
        getPlayer.mockResolvedValue({
            sessionId: 'p1',
            team: 'red',
            roomCode: 'ROOM1'
        });
        mockRedis.eval.mockResolvedValue(JSON.stringify({
            success: true,
            player: null
        }));

        await expect(setTeam('p1', 'blue')).rejects.toThrow();
    });

    test('throws generic error when Lua returns unknown failure reason', async () => {
        getPlayer.mockResolvedValue({
            sessionId: 'p1',
            team: 'red',
            roomCode: 'ROOM1'
        });
        mockRedis.eval.mockResolvedValue(JSON.stringify({
            success: false,
            reason: 'SOMETHING_UNKNOWN'
        }));

        await expect(setTeam('p1', 'blue')).rejects.toThrow('Failed to update player team');
    });
});

describe('setRole edge cases', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('throws when player has no roomCode', async () => {
        getPlayer.mockResolvedValue({
            sessionId: 'p1',
            team: 'red',
            role: 'clicker',
            roomCode: null
        });

        await expect(setRole('p1', 'spymaster')).rejects.toThrow('not associated with a room');
    });

    test('delegates to updatePlayer for spectator role', async () => {
        getPlayer.mockResolvedValue({
            sessionId: 'p1',
            team: 'red',
            role: 'clicker',
            roomCode: 'ROOM1'
        });
        updatePlayer.mockResolvedValue({
            sessionId: 'p1',
            role: 'spectator'
        });

        const result = await setRole('p1', 'spectator');
        expect(updatePlayer).toHaveBeenCalledWith('p1', { role: 'spectator' });
        expect(result.role).toBe('spectator');
    });

    test('throws when Lua returns INVALID_ROLE', async () => {
        getPlayer.mockResolvedValue({
            sessionId: 'p1',
            team: 'red',
            role: 'clicker',
            roomCode: 'ROOM1'
        });
        mockRedis.eval.mockResolvedValue(JSON.stringify({
            success: false,
            reason: 'INVALID_ROLE'
        }));

        await expect(setRole('p1', 'spymaster')).rejects.toThrow('Invalid role');
    });

    test('throws when Lua returns NO_TEAM', async () => {
        getPlayer.mockResolvedValue({
            sessionId: 'p1',
            team: null,
            role: 'clicker',
            roomCode: 'ROOM1'
        });
        mockRedis.eval.mockResolvedValue(JSON.stringify({
            success: false,
            reason: 'NO_TEAM'
        }));

        await expect(setRole('p1', 'spymaster')).rejects.toThrow('Must join a team');
    });

    test('throws when Lua returns success without player data', async () => {
        getPlayer.mockResolvedValue({
            sessionId: 'p1',
            team: 'red',
            role: 'clicker',
            roomCode: 'ROOM1'
        });
        mockRedis.eval.mockResolvedValue(JSON.stringify({
            success: true,
            player: null
        }));

        await expect(setRole('p1', 'spymaster')).rejects.toThrow();
    });

    test('throws generic error on Lua result parse failure', async () => {
        getPlayer.mockResolvedValue({
            sessionId: 'p1',
            team: 'red',
            role: 'clicker',
            roomCode: 'ROOM1'
        });
        mockRedis.eval.mockResolvedValue('not-json');

        await expect(setRole('p1', 'spymaster')).rejects.toThrow('Failed to update player role');
    });
});
