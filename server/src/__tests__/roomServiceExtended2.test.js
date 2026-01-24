/**
 * Extended Room Service Tests
 * Tests additional edge cases for roomService to improve coverage
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

// Mock bcrypt
jest.mock('bcryptjs', () => ({
    hash: jest.fn(),
    compare: jest.fn()
}));

// Mock uuid and nanoid
jest.mock('uuid', () => ({
    v4: jest.fn(() => 'mock-uuid-1234')
}));

jest.mock('nanoid', () => ({
    customAlphabet: jest.fn(() => jest.fn(() => 'ABCD12'))
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
const bcrypt = require('bcryptjs');

describe('Extended Room Service Tests', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('createRoom', () => {
        test('creates room successfully without password', async () => {
            mockRedis.eval.mockResolvedValue(1);
            playerService.createPlayer.mockResolvedValue({
                sessionId: 'host-session',
                nickname: 'Host',
                isHost: true
            });

            const result = await roomService.createRoom('host-session', {});

            expect(result.room.code).toBe('ABCD12');
            expect(result.room.hasPassword).toBeFalsy();
        });

        test('creates room with password', async () => {
            mockRedis.eval.mockResolvedValue(1);
            mockRedis.set.mockResolvedValue('OK');
            bcrypt.hash.mockResolvedValue('hashed-password');
            playerService.createPlayer.mockResolvedValue({
                sessionId: 'host-session',
                nickname: 'Host',
                isHost: true
            });

            const result = await roomService.createRoom('host-session', { password: 'secret123' });

            expect(result.room.hasPassword).toBe(true);
            expect(bcrypt.hash).toHaveBeenCalledWith('secret123', expect.any(Number));
        });

        test('creates room with custom nickname', async () => {
            mockRedis.eval.mockResolvedValue(1);
            playerService.createPlayer.mockResolvedValue({
                sessionId: 'host-session',
                nickname: 'CustomHost',
                isHost: true
            });

            await roomService.createRoom('host-session', { nickname: 'CustomHost' });

            expect(playerService.createPlayer).toHaveBeenCalledWith(
                'host-session',
                'ABCD12',
                'CustomHost',
                true
            );
        });

        test('retries on room code collision', async () => {
            // First attempt fails (collision), second succeeds
            mockRedis.eval
                .mockResolvedValueOnce(0)
                .mockResolvedValueOnce(1);
            playerService.createPlayer.mockResolvedValue({
                sessionId: 'host-session',
                nickname: 'Host',
                isHost: true
            });

            const result = await roomService.createRoom('host-session', {});

            expect(mockRedis.eval).toHaveBeenCalledTimes(2);
            expect(result.room).toBeDefined();
        });

        test('throws error after max collision attempts', async () => {
            mockRedis.eval.mockResolvedValue(0); // Always fails

            await expect(roomService.createRoom('host-session', {}))
                .rejects.toThrow('Failed to generate room code');
        });

        test('handles bcrypt hash error', async () => {
            bcrypt.hash.mockRejectedValue(new Error('Hash failed'));

            await expect(roomService.createRoom('host-session', { password: 'secret' }))
                .rejects.toThrow('Failed to create password-protected room');
        });

        test('handles whitespace-only password', async () => {
            mockRedis.eval.mockResolvedValue(1);
            playerService.createPlayer.mockResolvedValue({
                sessionId: 'host-session',
                nickname: 'Host',
                isHost: true
            });

            const result = await roomService.createRoom('host-session', { password: '   ' });

            // Whitespace-only password should be treated as no password
            expect(result.room.hasPassword).toBeFalsy();
            expect(bcrypt.hash).not.toHaveBeenCalled();
        });
    });

    describe('joinRoom', () => {
        const mockRoom = {
            code: 'ABC123',
            settings: {},
            passwordHash: null,
            hasPassword: false
        };

        test('allows reconnection for existing player', async () => {
            mockRedis.get.mockResolvedValue(JSON.stringify(mockRoom));
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'player-session',
                roomCode: 'ABC123'
            });
            playerService.updatePlayer.mockResolvedValue({
                sessionId: 'player-session',
                roomCode: 'ABC123',
                connected: true
            });
            gameService.getGame.mockResolvedValue(null);
            playerService.getPlayersInRoom.mockResolvedValue([]);

            const result = await roomService.joinRoom('ABC123', 'player-session', 'Player1');

            expect(result.isReconnecting).toBe(true);
            expect(playerService.updatePlayer).toHaveBeenCalledWith('player-session', expect.objectContaining({
                connected: true
            }));
        });

        test('requires password for password-protected room', async () => {
            const protectedRoom = {
                ...mockRoom,
                passwordHash: 'hashed-password',
                hasPassword: true
            };
            mockRedis.get.mockResolvedValue(JSON.stringify(protectedRoom));
            playerService.getPlayer.mockResolvedValue(null);

            await expect(roomService.joinRoom('ABC123', 'player-session', 'Player1'))
                .rejects.toThrow('This room requires a password');
        });

        test('validates password correctly', async () => {
            const protectedRoom = {
                ...mockRoom,
                passwordHash: 'hashed-password',
                hasPassword: true
            };
            mockRedis.get.mockResolvedValue(JSON.stringify(protectedRoom));
            mockRedis.eval.mockResolvedValue(1);
            playerService.getPlayer.mockResolvedValue(null);
            bcrypt.compare.mockResolvedValue(true);
            playerService.createPlayer.mockResolvedValue({
                sessionId: 'player-session',
                nickname: 'Player1'
            });
            playerService.updatePlayer.mockResolvedValue({
                sessionId: 'player-session'
            });
            gameService.getGame.mockResolvedValue(null);
            playerService.getPlayersInRoom.mockResolvedValue([]);

            const result = await roomService.joinRoom('ABC123', 'player-session', 'Player1', 'correct-password');

            expect(result.room).toBeDefined();
        });

        test('rejects incorrect password', async () => {
            const protectedRoom = {
                ...mockRoom,
                passwordHash: 'hashed-password',
                hasPassword: true
            };
            mockRedis.get.mockResolvedValue(JSON.stringify(protectedRoom));
            playerService.getPlayer.mockResolvedValue(null);
            bcrypt.compare.mockResolvedValue(false);

            await expect(roomService.joinRoom('ABC123', 'player-session', 'Player1', 'wrong-password'))
                .rejects.toThrow('Incorrect room password');
        });

        test('handles bcrypt compare error', async () => {
            const protectedRoom = {
                ...mockRoom,
                passwordHash: 'hashed-password',
                hasPassword: true
            };
            mockRedis.get.mockResolvedValue(JSON.stringify(protectedRoom));
            playerService.getPlayer.mockResolvedValue(null);
            bcrypt.compare.mockRejectedValue(new Error('Compare failed'));

            await expect(roomService.joinRoom('ABC123', 'player-session', 'Player1', 'password'))
                .rejects.toThrow('Password verification failed');
        });

        test('handles room full', async () => {
            mockRedis.get.mockResolvedValue(JSON.stringify(mockRoom));
            mockRedis.eval.mockResolvedValue(0); // Room full
            playerService.getPlayer.mockResolvedValue(null);

            await expect(roomService.joinRoom('ABC123', 'player-session', 'Player1'))
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

            const result = await roomService.joinRoom('ABC123', 'player-session', 'Player1');

            expect(result.isReconnecting).toBe(true);
        });

        test('handles unexpected eval result', async () => {
            mockRedis.get.mockResolvedValue(JSON.stringify(mockRoom));
            mockRedis.eval.mockResolvedValue(99); // Unexpected result
            playerService.getPlayer.mockResolvedValue(null);

            await expect(roomService.joinRoom('ABC123', 'player-session', 'Player1'))
                .rejects.toThrow('unexpected error');
        });

        test('rolls back on player creation failure', async () => {
            mockRedis.get.mockResolvedValue(JSON.stringify(mockRoom));
            mockRedis.eval.mockResolvedValue(1);
            mockRedis.sRem.mockResolvedValue(1);
            playerService.getPlayer.mockResolvedValue(null);
            playerService.createPlayer.mockRejectedValue(new Error('Create failed'));

            await expect(roomService.joinRoom('ABC123', 'player-session', 'Player1'))
                .rejects.toThrow('Create failed');

            expect(mockRedis.sRem).toHaveBeenCalled();
        });

        test('handles room not found', async () => {
            mockRedis.get.mockResolvedValue(null);

            await expect(roomService.joinRoom('NOTFND', 'player-session', 'Player1'))
                .rejects.toThrow('not found');
        });

        test('requires re-auth when password changed', async () => {
            const protectedRoom = {
                ...mockRoom,
                passwordHash: 'hashed-password',
                hasPassword: true,
                passwordVersion: 2
            };
            mockRedis.get.mockResolvedValue(JSON.stringify(protectedRoom));
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'player-session',
                roomCode: 'ABC123',
                passwordVersion: 1 // Old version
            });

            await expect(roomService.joinRoom('ABC123', 'player-session', 'Player1'))
                .rejects.toThrow('password has changed');
        });

        test('re-authenticates successfully after password change', async () => {
            const protectedRoom = {
                ...mockRoom,
                passwordHash: 'hashed-password',
                hasPassword: true,
                passwordVersion: 2
            };
            mockRedis.get.mockResolvedValue(JSON.stringify(protectedRoom));
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'player-session',
                roomCode: 'ABC123',
                passwordVersion: 1
            });
            bcrypt.compare.mockResolvedValue(true);
            playerService.updatePlayer.mockResolvedValue({
                sessionId: 'player-session',
                roomCode: 'ABC123',
                passwordVersion: 2
            });
            gameService.getGame.mockResolvedValue(null);
            playerService.getPlayersInRoom.mockResolvedValue([]);

            const result = await roomService.joinRoom('ABC123', 'player-session', 'Player1', 'new-password');

            expect(result.isReconnecting).toBe(true);
        });

        test('stores password version for new player in protected room', async () => {
            const protectedRoom = {
                ...mockRoom,
                passwordHash: 'hashed-password',
                hasPassword: true,
                passwordVersion: 1
            };
            mockRedis.get.mockResolvedValue(JSON.stringify(protectedRoom));
            mockRedis.eval.mockResolvedValue(1);
            playerService.getPlayer.mockResolvedValue(null);
            bcrypt.compare.mockResolvedValue(true);
            playerService.createPlayer.mockResolvedValue({
                sessionId: 'player-session',
                nickname: 'Player1'
            });
            playerService.updatePlayer.mockResolvedValue({
                sessionId: 'player-session',
                passwordVersion: 1
            });
            gameService.getGame.mockResolvedValue(null);
            playerService.getPlayersInRoom.mockResolvedValue([]);

            await roomService.joinRoom('ABC123', 'player-session', 'Player1', 'password');

            expect(playerService.updatePlayer).toHaveBeenCalledWith('player-session', expect.objectContaining({
                passwordVersion: 1
            }));
        });
    });

    describe('leaveRoom', () => {
        test('transfers host when host leaves', async () => {
            const mockRoom = {
                code: 'ABC123',
                hostSessionId: 'host-session'
            };
            mockRedis.get.mockResolvedValue(JSON.stringify(mockRoom));
            mockRedis.set.mockResolvedValue('OK');
            playerService.removePlayer.mockResolvedValue();
            playerService.getPlayersInRoom.mockResolvedValue([
                { sessionId: 'other-player' }
            ]);
            playerService.updatePlayer.mockResolvedValue({});

            const result = await roomService.leaveRoom('ABC123', 'host-session');

            expect(result.newHostId).toBe('other-player');
            expect(playerService.updatePlayer).toHaveBeenCalledWith('other-player', { isHost: true });
        });

        test('cleans up room when last player leaves', async () => {
            const mockRoom = {
                code: 'ABC123',
                hostSessionId: 'host-session'
            };
            mockRedis.get.mockResolvedValue(JSON.stringify(mockRoom));
            mockRedis.sMembers.mockResolvedValue([]);
            mockRedis.del.mockResolvedValue(1);
            playerService.removePlayer.mockResolvedValue();
            playerService.getPlayersInRoom.mockResolvedValue([]);
            timerService.stopTimer.mockResolvedValue();

            const result = await roomService.leaveRoom('ABC123', 'host-session');

            expect(result.roomDeleted).toBe(true);
        });

        test('handles room not found', async () => {
            mockRedis.get.mockResolvedValue(null);

            const result = await roomService.leaveRoom('NOTFND', 'session');

            expect(result.newHostId).toBeNull();
            expect(result.roomDeleted).toBe(false);
        });
    });

    describe('updateSettings', () => {
        test('updates settings successfully', async () => {
            const mockRoom = {
                code: 'ABC123',
                hostSessionId: 'host-session',
                settings: { turnTimer: 60 }
            };
            mockRedis.get.mockResolvedValue(JSON.stringify(mockRoom));
            mockRedis.set.mockResolvedValue('OK');

            const result = await roomService.updateSettings('ABC123', 'host-session', { turnTimer: 90 });

            expect(result.turnTimer).toBe(90);
        });

        test('rejects non-host update', async () => {
            const mockRoom = {
                code: 'ABC123',
                hostSessionId: 'host-session',
                settings: {}
            };
            mockRedis.get.mockResolvedValue(JSON.stringify(mockRoom));

            await expect(roomService.updateSettings('ABC123', 'other-session', { turnTimer: 90 }))
                .rejects.toThrow('host');
        });

        test('handles setting new password', async () => {
            const mockRoom = {
                code: 'ABC123',
                hostSessionId: 'host-session',
                settings: {},
                passwordHash: null
            };
            mockRedis.get.mockResolvedValue(JSON.stringify(mockRoom));
            mockRedis.set.mockResolvedValue('OK');
            bcrypt.hash.mockResolvedValue('new-hash');

            const result = await roomService.updateSettings('ABC123', 'host-session', { password: 'newpass' });

            expect(result.hasPassword).toBe(true);
            expect(result.passwordVersion).toBe(1);
        });

        test('handles removing password', async () => {
            const mockRoom = {
                code: 'ABC123',
                hostSessionId: 'host-session',
                settings: {},
                passwordHash: 'old-hash',
                hasPassword: true,
                passwordVersion: 1,
                passwordLookupKey: 'old-lookup'
            };
            mockRedis.get.mockResolvedValue(JSON.stringify(mockRoom));
            mockRedis.set.mockResolvedValue('OK');
            mockRedis.del.mockResolvedValue(1);

            const result = await roomService.updateSettings('ABC123', 'host-session', { password: '' });

            expect(result.hasPassword).toBe(false);
            expect(mockRedis.del).toHaveBeenCalledWith('password-lookup:old-lookup');
        });

        test('handles password update failure', async () => {
            const mockRoom = {
                code: 'ABC123',
                hostSessionId: 'host-session',
                settings: {}
            };
            mockRedis.get.mockResolvedValue(JSON.stringify(mockRoom));
            bcrypt.hash.mockRejectedValue(new Error('Hash failed'));

            await expect(roomService.updateSettings('ABC123', 'host-session', { password: 'newpass' }))
                .rejects.toThrow('Failed to set room password');
        });

        test('cleans up old lookup key when changing password', async () => {
            const mockRoom = {
                code: 'ABC123',
                hostSessionId: 'host-session',
                settings: {},
                passwordHash: 'old-hash',
                passwordLookupKey: 'old-lookup',
                passwordVersion: 1
            };
            mockRedis.get.mockResolvedValue(JSON.stringify(mockRoom));
            mockRedis.set.mockResolvedValue('OK');
            mockRedis.del.mockResolvedValue(1);
            bcrypt.hash.mockResolvedValue('new-hash');

            await roomService.updateSettings('ABC123', 'host-session', { password: 'newpass' });

            expect(mockRedis.del).toHaveBeenCalledWith('password-lookup:old-lookup');
        });
    });

    describe('roomExists', () => {
        test('returns true for existing room', async () => {
            mockRedis.exists.mockResolvedValue(1);

            const result = await roomService.roomExists('ABC123');

            expect(result).toBe(true);
        });

        test('returns false for non-existing room', async () => {
            mockRedis.exists.mockResolvedValue(0);

            const result = await roomService.roomExists('NOTFND');

            expect(result).toBe(false);
        });
    });

    describe('getRoom', () => {
        test('returns room when found', async () => {
            const mockRoom = { code: 'ABC123', settings: {} };
            mockRedis.get.mockResolvedValue(JSON.stringify(mockRoom));

            const result = await roomService.getRoom('ABC123');

            expect(result.code).toBe('ABC123');
        });

        test('returns null when not found', async () => {
            mockRedis.get.mockResolvedValue(null);

            const result = await roomService.getRoom('NOTFND');

            expect(result).toBeNull();
        });

        test('handles JSON parse error', async () => {
            mockRedis.get.mockResolvedValue('invalid-json');

            const result = await roomService.getRoom('ABC123');

            expect(result).toBeNull();
        });
    });

    describe('findRoomByPassword', () => {
        test('finds room with matching password', async () => {
            const mockRoom = { code: 'ABC123', hasPassword: true };
            mockRedis.get
                .mockResolvedValueOnce('ABC123')
                .mockResolvedValueOnce(JSON.stringify(mockRoom));

            const result = await roomService.findRoomByPassword('password123');

            expect(result.code).toBe('ABC123');
        });

        test('returns null for empty password', async () => {
            const result = await roomService.findRoomByPassword('');

            expect(result).toBeNull();
        });

        test('returns null for null password', async () => {
            const result = await roomService.findRoomByPassword(null);

            expect(result).toBeNull();
        });

        test('returns null when no room found', async () => {
            mockRedis.get.mockResolvedValue(null);

            const result = await roomService.findRoomByPassword('unknown');

            expect(result).toBeNull();
        });

        test('cleans up stale lookup key', async () => {
            mockRedis.get
                .mockResolvedValueOnce('EXPIRED')
                .mockResolvedValueOnce(null); // Room expired
            mockRedis.del.mockResolvedValue(1);

            const result = await roomService.findRoomByPassword('password');

            expect(result).toBeNull();
            expect(mockRedis.del).toHaveBeenCalled();
        });
    });

    describe('cleanupRoom', () => {
        test('cleans up all room data including password lookup', async () => {
            const mockRoom = {
                code: 'ABC123',
                passwordLookupKey: 'lookup-key'
            };
            mockRedis.get.mockResolvedValue(JSON.stringify(mockRoom));
            mockRedis.sMembers.mockResolvedValue(['player1', 'player2']);
            mockRedis.del.mockResolvedValue(6);
            timerService.stopTimer.mockResolvedValue();

            await roomService.cleanupRoom('ABC123');

            expect(timerService.stopTimer).toHaveBeenCalledWith('ABC123');
            expect(mockRedis.del).toHaveBeenCalled();
        });

        test('handles cleanup when room has no password lookup', async () => {
            const mockRoom = {
                code: 'ABC123'
            };
            mockRedis.get.mockResolvedValue(JSON.stringify(mockRoom));
            mockRedis.sMembers.mockResolvedValue([]);
            mockRedis.del.mockResolvedValue(3);
            timerService.stopTimer.mockResolvedValue();

            await roomService.cleanupRoom('ABC123');

            expect(mockRedis.del).toHaveBeenCalled();
        });
    });

    describe('deleteRoom', () => {
        test('delegates to cleanupRoom', async () => {
            const mockRoom = { code: 'ABC123' };
            mockRedis.get.mockResolvedValue(JSON.stringify(mockRoom));
            mockRedis.sMembers.mockResolvedValue([]);
            mockRedis.del.mockResolvedValue(3);
            timerService.stopTimer.mockResolvedValue();

            await roomService.deleteRoom('ABC123');

            expect(timerService.stopTimer).toHaveBeenCalledWith('ABC123');
        });
    });
});
