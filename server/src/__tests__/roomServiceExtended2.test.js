/**
 * Extended Room Service Tests
 * Tests additional edge cases for roomService to improve coverage
 * Updated for simplified room ID API (no passwords)
 */

// Mock Redis
const mockRedis = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    exists: jest.fn(),
    sMembers: jest.fn(),
    sRem: jest.fn(),
    eval: jest.fn()
};

jest.mock('../config/redis', () => ({
    getRedis: jest.fn(() => mockRedis)
}));

// Mock uuid
jest.mock('uuid', () => ({
    v4: jest.fn(() => 'mock-uuid-1234')
}));

// Mock player service
jest.mock('../services/playerService', () => ({
    createPlayer: jest.fn(),
    getPlayer: jest.fn(),
    updatePlayer: jest.fn(),
    removePlayer: jest.fn(),
    getPlayersInRoom: jest.fn()
}));

// Mock game service
jest.mock('../services/gameService', () => ({
    getGame: jest.fn(),
    getGameStateForPlayer: jest.fn()
}));

// Mock timer service
jest.mock('../services/timerService', () => ({
    stopTimer: jest.fn()
}));

// Mock logger
jest.mock('../utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));

const roomService = require('../services/roomService');
const playerService = require('../services/playerService');
const gameService = require('../services/gameService');
const timerService = require('../services/timerService');

describe('Extended Room Service Tests', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('createRoom', () => {
        test('creates room successfully with room ID', async () => {
            mockRedis.eval.mockResolvedValue(1);
            playerService.createPlayer.mockResolvedValue({
                sessionId: 'host-session',
                nickname: 'Host',
                isHost: true
            });

            const result = await roomService.createRoom('my-game', 'host-session', {});

            expect(result.room.code).toBe('my-game');
            expect(result.room.roomId).toBe('my-game');
        });

        test('normalizes room ID to lowercase', async () => {
            mockRedis.eval.mockResolvedValue(1);
            playerService.createPlayer.mockResolvedValue({
                sessionId: 'host-session',
                nickname: 'Host',
                isHost: true
            });

            const result = await roomService.createRoom('MyGame', 'host-session', {});

            expect(result.room.code).toBe('mygame');
            expect(result.room.roomId).toBe('MyGame');
        });

        test('creates room with custom nickname', async () => {
            mockRedis.eval.mockResolvedValue(1);
            playerService.createPlayer.mockResolvedValue({
                sessionId: 'host-session',
                nickname: 'CustomHost',
                isHost: true
            });

            await roomService.createRoom('test-room', 'host-session', { nickname: 'CustomHost' });

            expect(playerService.createPlayer).toHaveBeenCalledWith(
                'host-session',
                'test-room',
                'CustomHost',
                true
            );
        });

        test('throws error when room already exists', async () => {
            mockRedis.eval.mockResolvedValue(0); // Room already exists

            await expect(roomService.createRoom('existing-room', 'host-session', {}))
                .rejects.toThrow('already exists');
        });

        test('creates room with custom settings', async () => {
            mockRedis.eval.mockResolvedValue(1);
            playerService.createPlayer.mockResolvedValue({
                sessionId: 'host-session',
                nickname: 'Host',
                isHost: true
            });

            const result = await roomService.createRoom('test-room', 'host-session', {
                turnTimer: 120,
                allowSpectators: false
            });

            expect(result.room.settings.turnTimer).toBe(120);
            expect(result.room.settings.allowSpectators).toBe(false);
        });
    });

    describe('joinRoom', () => {
        const mockRoom = {
            code: 'test-room',
            roomId: 'test-room',
            settings: {}
        };

        test('allows reconnection for existing player', async () => {
            mockRedis.get.mockResolvedValue(JSON.stringify(mockRoom));
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'player-session',
                roomCode: 'test-room'
            });
            playerService.updatePlayer.mockResolvedValue({
                sessionId: 'player-session',
                roomCode: 'test-room',
                connected: true
            });
            gameService.getGame.mockResolvedValue(null);
            playerService.getPlayersInRoom.mockResolvedValue([]);

            const result = await roomService.joinRoom('test-room', 'player-session', 'Player1');

            expect(result.isReconnecting).toBe(true);
            expect(playerService.updatePlayer).toHaveBeenCalledWith('player-session', expect.objectContaining({
                connected: true
            }));
        });

        test('handles room full', async () => {
            mockRedis.get.mockResolvedValue(JSON.stringify(mockRoom));
            mockRedis.eval.mockResolvedValue(0); // Room full
            playerService.getPlayer.mockResolvedValue(null);

            await expect(roomService.joinRoom('test-room', 'player-session', 'Player1'))
                .rejects.toThrow('full');
        });

        test('handles player already in set but missing data', async () => {
            mockRedis.get.mockResolvedValue(JSON.stringify(mockRoom));
            mockRedis.eval.mockResolvedValue(-1); // Already a member
            playerService.getPlayer.mockResolvedValue(null);
            playerService.createPlayer.mockResolvedValue({
                sessionId: 'player-session',
                nickname: 'Player1'
            });
            gameService.getGame.mockResolvedValue(null);
            playerService.getPlayersInRoom.mockResolvedValue([]);

            const result = await roomService.joinRoom('test-room', 'player-session', 'Player1');

            expect(result.isReconnecting).toBe(true);
        });

        test('handles unexpected eval result', async () => {
            mockRedis.get.mockResolvedValue(JSON.stringify(mockRoom));
            mockRedis.eval.mockResolvedValue(99); // Unexpected result
            playerService.getPlayer.mockResolvedValue(null);

            await expect(roomService.joinRoom('test-room', 'player-session', 'Player1'))
                .rejects.toThrow('unexpected error');
        });

        test('rolls back on player creation failure', async () => {
            mockRedis.get.mockResolvedValue(JSON.stringify(mockRoom));
            mockRedis.eval.mockResolvedValue(1);
            mockRedis.sRem.mockResolvedValue(1);
            playerService.getPlayer.mockResolvedValue(null);
            playerService.createPlayer.mockRejectedValue(new Error('Create failed'));

            await expect(roomService.joinRoom('test-room', 'player-session', 'Player1'))
                .rejects.toThrow('Create failed');

            expect(mockRedis.sRem).toHaveBeenCalled();
        });

        test('handles room not found', async () => {
            mockRedis.get.mockResolvedValue(null);

            await expect(roomService.joinRoom('notfound', 'player-session', 'Player1'))
                .rejects.toThrow('not found');
        });

        test('normalizes room ID for lookup', async () => {
            mockRedis.get.mockResolvedValue(JSON.stringify(mockRoom));
            mockRedis.eval.mockResolvedValue(1);
            playerService.getPlayer.mockResolvedValue(null);
            playerService.createPlayer.mockResolvedValue({
                sessionId: 'player-session',
                nickname: 'Player1'
            });
            gameService.getGame.mockResolvedValue(null);
            playerService.getPlayersInRoom.mockResolvedValue([]);

            // Should normalize "TEST-ROOM" to "test-room" for lookup
            await roomService.joinRoom('TEST-ROOM', 'player-session', 'Player1');

            expect(mockRedis.get).toHaveBeenCalledWith('room:test-room');
        });
    });

    describe('leaveRoom', () => {
        test('transfers host when host leaves', async () => {
            const mockRoom = {
                code: 'test-room',
                hostSessionId: 'host-session'
            };
            mockRedis.get.mockResolvedValue(JSON.stringify(mockRoom));
            mockRedis.set.mockResolvedValue('OK');
            playerService.removePlayer.mockResolvedValue();
            playerService.getPlayersInRoom.mockResolvedValue([
                { sessionId: 'other-player' }
            ]);
            playerService.updatePlayer.mockResolvedValue({});

            const result = await roomService.leaveRoom('test-room', 'host-session');

            expect(result.newHostId).toBe('other-player');
            expect(playerService.updatePlayer).toHaveBeenCalledWith('other-player', { isHost: true });
        });

        test('cleans up room when last player leaves', async () => {
            const mockRoom = {
                code: 'test-room',
                hostSessionId: 'host-session'
            };
            mockRedis.get.mockResolvedValue(JSON.stringify(mockRoom));
            mockRedis.sMembers.mockResolvedValue([]);
            mockRedis.del.mockResolvedValue(1);
            playerService.removePlayer.mockResolvedValue();
            playerService.getPlayersInRoom.mockResolvedValue([]);
            timerService.stopTimer.mockResolvedValue();

            const result = await roomService.leaveRoom('test-room', 'host-session');

            expect(result.roomDeleted).toBe(true);
        });

        test('handles room not found', async () => {
            mockRedis.get.mockResolvedValue(null);

            const result = await roomService.leaveRoom('notfound', 'session');

            expect(result.newHostId).toBeNull();
            expect(result.roomDeleted).toBe(false);
        });
    });

    describe('updateSettings', () => {
        test('updates settings successfully', async () => {
            const mockRoom = {
                code: 'test-room',
                hostSessionId: 'host-session',
                settings: { turnTimer: 60 }
            };
            mockRedis.get.mockResolvedValue(JSON.stringify(mockRoom));
            mockRedis.set.mockResolvedValue('OK');

            const result = await roomService.updateSettings('test-room', 'host-session', { turnTimer: 90 });

            expect(result.turnTimer).toBe(90);
        });

        test('rejects non-host update', async () => {
            const mockRoom = {
                code: 'test-room',
                hostSessionId: 'host-session',
                settings: {}
            };
            mockRedis.get.mockResolvedValue(JSON.stringify(mockRoom));

            await expect(roomService.updateSettings('test-room', 'other-session', { turnTimer: 90 }))
                .rejects.toThrow('host');
        });

        test('updates team names', async () => {
            const mockRoom = {
                code: 'test-room',
                hostSessionId: 'host-session',
                settings: { teamNames: { red: 'Red', blue: 'Blue' } }
            };
            mockRedis.get.mockResolvedValue(JSON.stringify(mockRoom));
            mockRedis.set.mockResolvedValue('OK');

            const result = await roomService.updateSettings('test-room', 'host-session', {
                teamNames: { red: 'Cats', blue: 'Dogs' }
            });

            expect(result.teamNames.red).toBe('Cats');
            expect(result.teamNames.blue).toBe('Dogs');
        });

        test('updates allow spectators setting', async () => {
            const mockRoom = {
                code: 'test-room',
                hostSessionId: 'host-session',
                settings: { allowSpectators: true }
            };
            mockRedis.get.mockResolvedValue(JSON.stringify(mockRoom));
            mockRedis.set.mockResolvedValue('OK');

            const result = await roomService.updateSettings('test-room', 'host-session', {
                allowSpectators: false
            });

            expect(result.allowSpectators).toBe(false);
        });
    });

    describe('roomExists', () => {
        test('returns true for existing room', async () => {
            mockRedis.exists.mockResolvedValue(1);

            const result = await roomService.roomExists('test-room');

            expect(result).toBe(true);
        });

        test('returns false for non-existing room', async () => {
            mockRedis.exists.mockResolvedValue(0);

            const result = await roomService.roomExists('notfound');

            expect(result).toBe(false);
        });

        test('normalizes room ID for lookup', async () => {
            mockRedis.exists.mockResolvedValue(1);

            await roomService.roomExists('TEST-ROOM');

            expect(mockRedis.exists).toHaveBeenCalledWith('room:test-room');
        });
    });

    describe('getRoom', () => {
        test('returns room when found', async () => {
            const mockRoom = { code: 'test-room', settings: {} };
            mockRedis.get.mockResolvedValue(JSON.stringify(mockRoom));

            const result = await roomService.getRoom('test-room');

            expect(result.code).toBe('test-room');
        });

        test('returns null when not found', async () => {
            mockRedis.get.mockResolvedValue(null);

            const result = await roomService.getRoom('notfound');

            expect(result).toBeNull();
        });

        test('handles JSON parse error', async () => {
            mockRedis.get.mockResolvedValue('invalid-json');

            const result = await roomService.getRoom('test-room');

            expect(result).toBeNull();
        });

        test('normalizes room ID for lookup', async () => {
            const mockRoom = { code: 'test-room', settings: {} };
            mockRedis.get.mockResolvedValue(JSON.stringify(mockRoom));

            await roomService.getRoom('TEST-ROOM');

            expect(mockRedis.get).toHaveBeenCalledWith('room:test-room');
        });
    });

    describe('cleanupRoom', () => {
        test('cleans up all room data', async () => {
            const mockRoom = {
                code: 'test-room'
            };
            mockRedis.get.mockResolvedValue(JSON.stringify(mockRoom));
            mockRedis.sMembers.mockResolvedValue(['player1', 'player2']);
            mockRedis.del.mockResolvedValue(6);
            timerService.stopTimer.mockResolvedValue();

            await roomService.cleanupRoom('test-room');

            expect(timerService.stopTimer).toHaveBeenCalledWith('test-room');
            expect(mockRedis.del).toHaveBeenCalled();
        });

        test('handles cleanup when room has no players', async () => {
            const mockRoom = {
                code: 'test-room'
            };
            mockRedis.get.mockResolvedValue(JSON.stringify(mockRoom));
            mockRedis.sMembers.mockResolvedValue([]);
            mockRedis.del.mockResolvedValue(3);
            timerService.stopTimer.mockResolvedValue();

            await roomService.cleanupRoom('test-room');

            expect(mockRedis.del).toHaveBeenCalled();
        });
    });

    describe('deleteRoom', () => {
        test('delegates to cleanupRoom', async () => {
            const mockRoom = { code: 'test-room' };
            mockRedis.get.mockResolvedValue(JSON.stringify(mockRoom));
            mockRedis.sMembers.mockResolvedValue([]);
            mockRedis.del.mockResolvedValue(3);
            timerService.stopTimer.mockResolvedValue();

            await roomService.deleteRoom('test-room');

            expect(timerService.stopTimer).toHaveBeenCalledWith('test-room');
        });
    });
});
