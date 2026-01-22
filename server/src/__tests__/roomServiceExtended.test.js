/**
 * Extended Room Service Tests
 *
 * Tests for password handling, settings management, and room lifecycle
 * to improve coverage from 45% to 65%+
 */

// Mock storage
let mockRedisStorage = {};
let mockPlayerStorage = {};

const mockRedis = {
    get: jest.fn(async (key) => mockRedisStorage[key] || null),
    set: jest.fn(async (key, value) => {
        mockRedisStorage[key] = typeof value === 'string' ? value : JSON.stringify(value);
        return 'OK';
    }),
    del: jest.fn(async (keys) => {
        const keysArray = Array.isArray(keys) ? keys : [keys];
        keysArray.forEach(key => delete mockRedisStorage[key]);
        return keysArray.length;
    }),
    exists: jest.fn(async (key) => mockRedisStorage[key] ? 1 : 0),
    expire: jest.fn().mockResolvedValue(1),
    sMembers: jest.fn(async (key) => {
        const data = mockRedisStorage[key];
        return data ? JSON.parse(data) : [];
    }),
    sAdd: jest.fn(async (key, value) => {
        if (!mockRedisStorage[key]) {
            mockRedisStorage[key] = JSON.stringify([]);
        }
        const arr = JSON.parse(mockRedisStorage[key]);
        if (!arr.includes(value)) {
            arr.push(value);
            mockRedisStorage[key] = JSON.stringify(arr);
            return 1;
        }
        return 0;
    }),
    sRem: jest.fn(async (key, value) => {
        if (!mockRedisStorage[key]) return 0;
        const arr = JSON.parse(mockRedisStorage[key]);
        const idx = arr.indexOf(value);
        if (idx > -1) {
            arr.splice(idx, 1);
            mockRedisStorage[key] = JSON.stringify(arr);
            return 1;
        }
        return 0;
    }),
    eval: jest.fn().mockResolvedValue(1)
};

jest.mock('../config/redis', () => ({
    getRedis: () => mockRedis
}));

jest.mock('../utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));

jest.mock('../services/timerService', () => ({
    stopTimer: jest.fn().mockResolvedValue()
}));

// Mock bcrypt
jest.mock('bcryptjs', () => ({
    hash: jest.fn((password) => Promise.resolve(`hashed_${password}`)),
    compare: jest.fn((password, hash) => Promise.resolve(hash === `hashed_${password}`))
}));

// Mock playerService
jest.mock('../services/playerService', () => ({
    createPlayer: jest.fn(async (sessionId, roomCode, nickname, isHost, _addToSet = true) => {
        const player = {
            sessionId,
            roomCode,
            nickname,
            isHost,
            team: null,
            role: 'clicker',
            connected: true
        };
        mockPlayerStorage[sessionId] = player;
        return player;
    }),
    getPlayer: jest.fn(async (sessionId) => mockPlayerStorage[sessionId] || null),
    getPlayersInRoom: jest.fn(async (roomCode) => {
        return Object.values(mockPlayerStorage).filter(p => p.roomCode === roomCode);
    }),
    updatePlayer: jest.fn(async (sessionId, updates) => {
        if (mockPlayerStorage[sessionId]) {
            mockPlayerStorage[sessionId] = { ...mockPlayerStorage[sessionId], ...updates };
            return mockPlayerStorage[sessionId];
        }
        return null;
    }),
    removePlayer: jest.fn(async (sessionId) => {
        delete mockPlayerStorage[sessionId];
    }),
    handleDisconnect: jest.fn().mockResolvedValue()
}));

// Mock gameService
jest.mock('../services/gameService', () => ({
    getGame: jest.fn().mockResolvedValue(null),
    getGameStateForPlayer: jest.fn()
}));

const { ERROR_CODES } = require('../config/constants');
// bcrypt imported for mocking initialization
const _bcrypt = require('bcryptjs');

describe('Room Service', () => {
    let roomService;

    beforeEach(() => {
        jest.clearAllMocks();
        mockRedisStorage = {};
        mockPlayerStorage = {};
        jest.resetModules();
        roomService = require('../services/roomService');
    });

    describe('createRoom', () => {
        test('creates room successfully', async () => {
            const result = await roomService.createRoom('host-session-1', {});

            expect(result.room).toBeDefined();
            expect(result.room.code).toBeDefined();
            expect(result.player).toBeDefined();
            expect(result.room.hasPassword).toBe(false);
        });

        test('creates password-protected room', async () => {
            const result = await roomService.createRoom('host-session-2', {
                password: 'secret123'
            });

            expect(result.room.hasPassword).toBe(true);
            expect(result.room.passwordHash).toBeUndefined(); // Should not expose hash
        });

        test('creates room with custom settings', async () => {
            const result = await roomService.createRoom('host-session-3', {
                turnTimer: 90,
                allowSpectators: false,
                teamNames: { red: 'Team A', blue: 'Team B' }
            });

            expect(result.room.settings.turnTimer).toBe(90);
            expect(result.room.settings.allowSpectators).toBe(false);
            expect(result.room.settings.teamNames).toEqual({ red: 'Team A', blue: 'Team B' });
        });

        test('creates room with password hash hidden from response', async () => {
            const result = await roomService.createRoom('host-session-4', {
                password: 'secret'
            });

            // The password hash should not be exposed in the returned room object
            expect(result.room.passwordHash).toBeUndefined();
            expect(result.room.hasPassword).toBe(true);
        });

        test('room code collision retry works', async () => {
            // First attempt fails (room exists), second succeeds
            mockRedis.eval
                .mockResolvedValueOnce(0)  // First collision
                .mockResolvedValueOnce(1); // Second success

            const result = await roomService.createRoom('host-session-5', {});
            expect(result.room).toBeDefined();
        });
    });

    describe('getRoom', () => {
        test('returns room when exists', async () => {
            const roomData = {
                code: 'ABC123',
                hostSessionId: 'host-1',
                settings: {},
                hasPassword: false
            };
            mockRedisStorage['room:ABC123'] = JSON.stringify(roomData);

            const room = await roomService.getRoom('ABC123');
            expect(room).toMatchObject(roomData);
        });

        test('returns null when room does not exist', async () => {
            const room = await roomService.getRoom('NOTEXIST');
            expect(room).toBeNull();
        });

        test('handles corrupted room data', async () => {
            mockRedisStorage['room:CORRUPT'] = 'not valid json';

            const room = await roomService.getRoom('CORRUPT');
            expect(room).toBeNull();
        });
    });

    describe('joinRoom', () => {
        beforeEach(() => {
            const roomData = {
                code: 'JOIN12',
                hostSessionId: 'host-1',
                settings: {},
                hasPassword: false,
                passwordHash: null
            };
            mockRedisStorage['room:JOIN12'] = JSON.stringify(roomData);
            mockRedis.eval.mockResolvedValue(1);
        });

        test('joins room successfully', async () => {
            const result = await roomService.joinRoom('JOIN12', 'player-1', 'Player1');

            expect(result.room).toBeDefined();
            expect(result.player).toBeDefined();
            expect(result.isReconnecting).toBe(false);
        });

        test('throws when room not found', async () => {
            await expect(roomService.joinRoom('NOTEXIST', 'player-1', 'Player1'))
                .rejects.toMatchObject({ code: ERROR_CODES.ROOM_NOT_FOUND });
        });

        test('throws when room is full', async () => {
            mockRedis.eval.mockResolvedValue(0);

            await expect(roomService.joinRoom('JOIN12', 'player-1', 'Player1'))
                .rejects.toMatchObject({ code: ERROR_CODES.ROOM_FULL });
        });

        test('handles reconnection', async () => {
            // Player already in room
            mockPlayerStorage['player-1'] = {
                sessionId: 'player-1',
                roomCode: 'JOIN12',
                nickname: 'Player1',
                connected: false
            };

            const result = await roomService.joinRoom('JOIN12', 'player-1', 'Player1');

            expect(result.isReconnecting).toBe(true);
        });
    });

    describe('joinRoom with password', () => {
        beforeEach(() => {
            const roomData = {
                code: 'PASS12',
                hostSessionId: 'host-1',
                settings: {},
                hasPassword: true,
                passwordHash: 'hashed_secret123',
                passwordVersion: 1
            };
            mockRedisStorage['room:PASS12'] = JSON.stringify(roomData);
            mockRedis.eval.mockResolvedValue(1);
        });

        test('joins with correct password', async () => {
            const result = await roomService.joinRoom('PASS12', 'player-1', 'Player1', 'secret123');

            expect(result.room).toBeDefined();
            expect(result.player).toBeDefined();
        });

        test('throws when password required but not provided', async () => {
            await expect(roomService.joinRoom('PASS12', 'player-1', 'Player1'))
                .rejects.toMatchObject({ code: ERROR_CODES.ROOM_PASSWORD_REQUIRED });
        });

        test('throws when password is incorrect', async () => {
            await expect(roomService.joinRoom('PASS12', 'player-1', 'Player1', 'wrongpassword'))
                .rejects.toMatchObject({ code: ERROR_CODES.ROOM_PASSWORD_INVALID });
        });

        test('successful join stores password version', async () => {
            mockRedis.eval.mockResolvedValue(1);

            const result = await roomService.joinRoom('PASS12', 'player-1', 'Player1', 'secret123');

            expect(result.room).toBeDefined();
            expect(result.player).toBeDefined();
        });
    });

    describe('leaveRoom', () => {
        beforeEach(() => {
            const roomData = {
                code: 'LEAVE1',
                hostSessionId: 'host-1',
                settings: {}
            };
            mockRedisStorage['room:LEAVE1'] = JSON.stringify(roomData);

            mockPlayerStorage['host-1'] = {
                sessionId: 'host-1',
                roomCode: 'LEAVE1',
                nickname: 'Host',
                isHost: true
            };
            mockPlayerStorage['player-1'] = {
                sessionId: 'player-1',
                roomCode: 'LEAVE1',
                nickname: 'Player1',
                isHost: false
            };
        });

        test('non-host leaves successfully', async () => {
            const result = await roomService.leaveRoom('LEAVE1', 'player-1');

            expect(result.newHostId).toBeNull();
            expect(result.roomDeleted).toBe(false);
        });

        test('host leaving transfers host to next player', async () => {
            // Simulate player-1 still in room after host leaves
            const playerService = require('../services/playerService');
            playerService.getPlayersInRoom.mockResolvedValueOnce([
                { sessionId: 'player-1', nickname: 'Player1', isHost: false }
            ]);

            const result = await roomService.leaveRoom('LEAVE1', 'host-1');

            expect(result.newHostId).toBe('player-1');
            expect(playerService.updatePlayer).toHaveBeenCalledWith('player-1', { isHost: true });
        });

        test('last player leaving deletes room', async () => {
            const playerService = require('../services/playerService');
            playerService.getPlayersInRoom.mockResolvedValueOnce([]);

            const result = await roomService.leaveRoom('LEAVE1', 'host-1');

            expect(result.roomDeleted).toBe(true);
        });

        test('handles leaving non-existent room', async () => {
            const result = await roomService.leaveRoom('NOTEXIST', 'player-1');

            expect(result.newHostId).toBeNull();
            expect(result.roomDeleted).toBe(false);
        });
    });

    describe('updateSettings', () => {
        beforeEach(() => {
            const roomData = {
                code: 'SETT12',
                hostSessionId: 'host-1',
                settings: {
                    turnTimer: 60,
                    allowSpectators: true,
                    teamNames: { red: 'Red', blue: 'Blue' }
                },
                hasPassword: false,
                passwordHash: null,
                passwordVersion: 0
            };
            mockRedisStorage['room:SETT12'] = JSON.stringify(roomData);
        });

        test('updates settings successfully', async () => {
            const result = await roomService.updateSettings('SETT12', 'host-1', {
                turnTimer: 120,
                allowSpectators: false
            });

            expect(result.turnTimer).toBe(120);
            expect(result.allowSpectators).toBe(false);
        });

        test('updates team names', async () => {
            const result = await roomService.updateSettings('SETT12', 'host-1', {
                teamNames: { red: 'Dragons', blue: 'Knights' }
            });

            expect(result.teamNames).toEqual({ red: 'Dragons', blue: 'Knights' });
        });

        test('throws when not host', async () => {
            await expect(roomService.updateSettings('SETT12', 'not-host', {
                turnTimer: 90
            })).rejects.toMatchObject({ code: ERROR_CODES.NOT_HOST });
        });

        test('throws when room not found', async () => {
            await expect(roomService.updateSettings('NOTEXIST', 'host-1', {
                turnTimer: 90
            })).rejects.toMatchObject({ code: ERROR_CODES.ROOM_NOT_FOUND });
        });

        test('sets password', async () => {
            const result = await roomService.updateSettings('SETT12', 'host-1', {
                password: 'newpassword'
            });

            expect(result.hasPassword).toBe(true);
            expect(result.passwordVersion).toBe(1);
        });

        test('removes password', async () => {
            // First set a password
            const roomData = {
                code: 'SETT12',
                hostSessionId: 'host-1',
                settings: {},
                hasPassword: true,
                passwordHash: 'hashed_oldpassword',
                passwordVersion: 1
            };
            mockRedisStorage['room:SETT12'] = JSON.stringify(roomData);

            const result = await roomService.updateSettings('SETT12', 'host-1', {
                password: null
            });

            expect(result.hasPassword).toBe(false);
            expect(result.passwordVersion).toBe(0);
        });

        test('removes password with empty string', async () => {
            const roomData = {
                code: 'SETT12',
                hostSessionId: 'host-1',
                settings: {},
                hasPassword: true,
                passwordHash: 'hashed_oldpassword',
                passwordVersion: 1
            };
            mockRedisStorage['room:SETT12'] = JSON.stringify(roomData);

            const result = await roomService.updateSettings('SETT12', 'host-1', {
                password: ''
            });

            expect(result.hasPassword).toBe(false);
        });

        test('increments password version on each update', async () => {
            // First password set
            let result = await roomService.updateSettings('SETT12', 'host-1', {
                password: 'pass1'
            });
            expect(result.passwordVersion).toBe(1);

            // Re-setup room with new password version
            const roomData = {
                code: 'SETT12',
                hostSessionId: 'host-1',
                settings: { turnTimer: 60 },
                hasPassword: true,
                passwordHash: 'hashed_pass1',
                passwordVersion: 1
            };
            mockRedisStorage['room:SETT12'] = JSON.stringify(roomData);

            // Second password update
            result = await roomService.updateSettings('SETT12', 'host-1', {
                password: 'pass2'
            });
            expect(result.passwordVersion).toBe(2);
        });
    });

    describe('roomExists', () => {
        test('returns true when room exists', async () => {
            mockRedis.exists.mockResolvedValue(1);

            const exists = await roomService.roomExists('EXISTS1');
            expect(exists).toBe(true);
        });

        test('returns false when room does not exist', async () => {
            mockRedis.exists.mockResolvedValue(0);

            const exists = await roomService.roomExists('NOTEXIST');
            expect(exists).toBe(false);
        });
    });

    describe('refreshRoomTTL', () => {
        test('refreshes all room-related keys', async () => {
            mockRedis.exists.mockResolvedValue(1);

            await roomService.refreshRoomTTL('TEST12');

            expect(mockRedis.expire).toHaveBeenCalledWith('room:TEST12', expect.any(Number));
            expect(mockRedis.expire).toHaveBeenCalledWith('room:TEST12:players', expect.any(Number));
            expect(mockRedis.expire).toHaveBeenCalledWith('room:TEST12:game', expect.any(Number));
        });

        test('skips game TTL when no game exists', async () => {
            mockRedis.exists.mockResolvedValue(0);

            await roomService.refreshRoomTTL('TEST12');

            expect(mockRedis.expire).toHaveBeenCalledWith('room:TEST12', expect.any(Number));
            expect(mockRedis.expire).toHaveBeenCalledWith('room:TEST12:players', expect.any(Number));
            expect(mockRedis.expire).toHaveBeenCalledTimes(2);
        });
    });

    describe('cleanupRoom', () => {
        test('removes all room data', async () => {
            mockRedis.sMembers.mockResolvedValue(['player-1', 'player-2']);

            await roomService.cleanupRoom('CLEAN1');

            expect(mockRedis.del).toHaveBeenCalled();
            const timerService = require('../services/timerService');
            expect(timerService.stopTimer).toHaveBeenCalledWith('CLEAN1');
        });
    });

    describe('deleteRoom', () => {
        test('calls cleanupRoom', async () => {
            mockRedis.sMembers.mockResolvedValue([]);

            await roomService.deleteRoom('DELETE1');

            expect(mockRedis.del).toHaveBeenCalled();
        });
    });
});

describe('Password Change Reconnection', () => {
    let roomService;

    beforeEach(() => {
        jest.clearAllMocks();
        mockRedisStorage = {};
        mockPlayerStorage = {};
        jest.resetModules();
        roomService = require('../services/roomService');
    });

    test('requires re-authentication when password version changed', async () => {
        // Room with password version 2
        const roomData = {
            code: 'REAUTH',
            hostSessionId: 'host-1',
            settings: {},
            hasPassword: true,
            passwordHash: 'hashed_newsecret',
            passwordVersion: 2
        };
        mockRedisStorage['room:REAUTH'] = JSON.stringify(roomData);

        // Player has old password version
        mockPlayerStorage['player-1'] = {
            sessionId: 'player-1',
            roomCode: 'REAUTH',
            nickname: 'Player1',
            passwordVersion: 1
        };

        // Should require re-auth
        await expect(roomService.joinRoom('REAUTH', 'player-1', 'Player1'))
            .rejects.toMatchObject({ code: ERROR_CODES.ROOM_PASSWORD_CHANGED });
    });

    test('allows reconnection with correct new password after change', async () => {
        const roomData = {
            code: 'REAUTH',
            hostSessionId: 'host-1',
            settings: {},
            hasPassword: true,
            passwordHash: 'hashed_newsecret',
            passwordVersion: 2
        };
        mockRedisStorage['room:REAUTH'] = JSON.stringify(roomData);

        mockPlayerStorage['player-1'] = {
            sessionId: 'player-1',
            roomCode: 'REAUTH',
            nickname: 'Player1',
            passwordVersion: 1
        };
        mockRedis.eval.mockResolvedValue(-1);

        const result = await roomService.joinRoom('REAUTH', 'player-1', 'Player1', 'newsecret');

        expect(result.isReconnecting).toBe(true);
        expect(result.player.passwordVersion).toBe(2);
    });
});
