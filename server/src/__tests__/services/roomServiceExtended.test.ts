/**
 * Extended Room Service Tests
 *
 * Tests for settings management, and room lifecycle
 * Updated for simplified room ID API (no passwords)
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
    mGet: jest.fn(async (keys) => keys.map(key => mockRedisStorage[key] || null)),
    eval: jest.fn().mockResolvedValue(1)
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

jest.mock('../../services/timerService', () => ({
    stopTimer: jest.fn().mockResolvedValue()
}));

// Mock playerService
jest.mock('../../services/playerService', () => ({
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
    handleDisconnect: jest.fn().mockResolvedValue(),
    // FIX: Add atomicHostTransfer for H4 fix
    atomicHostTransfer: jest.fn().mockResolvedValue({ success: true }),
    // Sprint D1: buildPlayerData used for atomic join+create
    buildPlayerData: jest.fn((sessionId, roomCode, nickname, isHost) => ({
        sessionId,
        roomCode,
        nickname,
        team: null,
        role: 'spectator',
        isHost,
        connected: true,
        connectedAt: Date.now(),
        lastSeen: Date.now()
    }))
}));

// Mock gameService
jest.mock('../../services/gameService', () => ({
    getGame: jest.fn().mockResolvedValue(null),
    getGameStateForPlayer: jest.fn()
}));

const { ERROR_CODES } = require('../../config/constants');

describe('Room Service', () => {
    let roomService;

    beforeEach(() => {
        jest.clearAllMocks();
        mockRedisStorage = {};
        mockPlayerStorage = {};
        // Reset eval to return 1 (success) by default
        mockRedis.eval.mockResolvedValue(1);
        jest.resetModules();
        roomService = require('../../services/roomService');
    });

    describe('createRoom', () => {
        test('creates room successfully with room ID', async () => {
            const result = await roomService.createRoom('my-game', 'host-session-1', {});

            expect(result.room).toBeDefined();
            expect(result.room.code).toBe('my-game');
            expect(result.room.roomId).toBe('my-game');
            expect(result.player).toBeDefined();
        });

        test('normalizes room ID to lowercase for storage', async () => {
            const result = await roomService.createRoom('MyGame', 'host-session-2', {});

            expect(result.room.code).toBe('mygame');
            expect(result.room.roomId).toBe('MyGame');
        });

        test('creates room with custom settings', async () => {
            const result = await roomService.createRoom('test-room', 'host-session-3', {
                turnTimer: 90,
                allowSpectators: false,
                teamNames: { red: 'Team A', blue: 'Team B' }
            });

            expect(result.room.settings.turnTimer).toBe(90);
            expect(result.room.settings.allowSpectators).toBe(false);
            expect(result.room.settings.teamNames).toEqual({ red: 'Team A', blue: 'Team B' });
        });

        test('throws error when room already exists', async () => {
            mockRedis.eval.mockResolvedValue(0); // Room exists

            await expect(roomService.createRoom('existing', 'host-session-4', {}))
                .rejects.toMatchObject({ code: ERROR_CODES.ROOM_ALREADY_EXISTS });
        });

        test('creates room with custom nickname', async () => {
            const result = await roomService.createRoom('my-room', 'host-session-5', {
                nickname: 'GameMaster'
            });

            expect(result.player.nickname).toBe('GameMaster');
        });
    });

    describe('getRoom', () => {
        test('returns room when exists', async () => {
            const roomData = {
                code: 'test-room',
                roomId: 'test-room',
                hostSessionId: 'host-1',
                status: 'waiting',
                settings: {}
            };
            mockRedisStorage['room:test-room'] = JSON.stringify(roomData);

            const room = await roomService.getRoom('test-room');
            expect(room).toMatchObject(roomData);
        });

        test('returns null when room does not exist', async () => {
            const room = await roomService.getRoom('notexist');
            expect(room).toBeNull();
        });

        test('throws on corrupted room data', async () => {
            mockRedisStorage['room:corrupt'] = 'not valid json';

            await expect(roomService.getRoom('corrupt')).rejects.toThrow('Game data corrupted');
        });

        test('normalizes room ID for lookup', async () => {
            const roomData = {
                code: 'test-room',
                roomId: 'Test-Room',
                hostSessionId: 'host-1',
                status: 'waiting',
                settings: {}
            };
            mockRedisStorage['room:test-room'] = JSON.stringify(roomData);

            const room = await roomService.getRoom('TEST-ROOM');
            expect(room).toBeDefined();
            expect(room.roomId).toBe('Test-Room');
        });
    });

    describe('joinRoom', () => {
        beforeEach(() => {
            const roomData = {
                code: 'game-room',
                roomId: 'game-room',
                hostSessionId: 'host-1',
                status: 'waiting',
                settings: {}
            };
            mockRedisStorage['room:game-room'] = JSON.stringify(roomData);
            mockRedis.eval.mockResolvedValue(1);
        });

        test('joins room successfully', async () => {
            const result = await roomService.joinRoom('game-room', 'player-1', 'Player1');

            expect(result.room).toBeDefined();
            expect(result.player).toBeDefined();
            expect(result.isReconnecting).toBe(false);
        });

        test('throws when room not found', async () => {
            await expect(roomService.joinRoom('notexist', 'player-1', 'Player1'))
                .rejects.toMatchObject({ code: ERROR_CODES.ROOM_NOT_FOUND });
        });

        test('throws when room is full', async () => {
            mockRedis.eval.mockResolvedValue(0);

            await expect(roomService.joinRoom('game-room', 'player-1', 'Player1'))
                .rejects.toMatchObject({ code: ERROR_CODES.ROOM_FULL });
        });

        test('handles reconnection', async () => {
            // Player already in room
            mockPlayerStorage['player-1'] = {
                sessionId: 'player-1',
                roomCode: 'game-room',
                nickname: 'Player1',
                connected: false
            };

            const result = await roomService.joinRoom('game-room', 'player-1', 'Player1');

            expect(result.isReconnecting).toBe(true);
        });

        test('normalizes room ID for lookup', async () => {
            const result = await roomService.joinRoom('GAME-ROOM', 'player-1', 'Player1');

            expect(result.room).toBeDefined();
        });
    });

    describe('leaveRoom', () => {
        beforeEach(() => {
            const roomData = {
                code: 'leave-room',
                roomId: 'leave-room',
                hostSessionId: 'host-1',
                status: 'waiting',
                settings: {}
            };
            mockRedisStorage['room:leave-room'] = JSON.stringify(roomData);

            mockPlayerStorage['host-1'] = {
                sessionId: 'host-1',
                roomCode: 'leave-room',
                nickname: 'Host',
                isHost: true
            };
            mockPlayerStorage['player-1'] = {
                sessionId: 'player-1',
                roomCode: 'leave-room',
                nickname: 'Player1',
                isHost: false
            };
        });

        test('non-host leaves successfully', async () => {
            const result = await roomService.leaveRoom('leave-room', 'player-1');

            expect(result.newHostId).toBeNull();
            expect(result.roomDeleted).toBe(false);
        });

        test('host leaving transfers host to next player', async () => {
            // Simulate player-1 still in room after host leaves
            const playerService = require('../../services/playerService');
            playerService.getPlayersInRoom.mockResolvedValueOnce([
                { sessionId: 'player-1', nickname: 'Player1', isHost: false }
            ]);

            const result = await roomService.leaveRoom('leave-room', 'host-1');

            expect(result.newHostId).toBe('player-1');
            // FIX: atomicHostTransfer is called instead of updatePlayer
            expect(playerService.atomicHostTransfer).toHaveBeenCalledWith('host-1', 'player-1', 'leave-room');
        });

        test('last player leaving deletes room', async () => {
            const playerService = require('../../services/playerService');
            // Must return [] for both calls: initial fetch + post-removal re-check
            playerService.getPlayersInRoom
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([]);

            const result = await roomService.leaveRoom('leave-room', 'host-1');

            expect(result.roomDeleted).toBe(true);
        });

        test('handles leaving non-existent room', async () => {
            const result = await roomService.leaveRoom('notexist', 'player-1');

            expect(result.newHostId).toBeNull();
            expect(result.roomDeleted).toBe(false);
        });

        test('treats corrupted room data as deleted during leave', async () => {
            // Put invalid JSON in Redis — getRoom throws GameStateError
            mockRedisStorage['room:corrupt-room'] = 'not valid json {{{';
            mockRedis.del.mockResolvedValue(1);

            const result = await roomService.leaveRoom('corrupt-room', 'player-1');

            // Corrupted data is treated as "room gone" — not an error
            expect(result.newHostId).toBeNull();
            expect(result.roomDeleted).toBe(false);
        });

        test('re-throws Redis errors during leave (not corrupted data)', async () => {
            // Simulate Redis connection failure on get
            mockRedis.get.mockRejectedValueOnce(new Error('ECONNRESET'));

            await expect(
                roomService.leaveRoom('any-room', 'player-1')
            ).rejects.toThrow('ECONNRESET');
        });
    });

    describe('updateSettings', () => {
        beforeEach(() => {
            const roomData = {
                code: 'settings-room',
                roomId: 'settings-room',
                hostSessionId: 'host-1',
                status: 'waiting',
                settings: {
                    turnTimer: 60,
                    allowSpectators: true,
                    teamNames: { red: 'Red', blue: 'Blue' }
                }
            };
            mockRedisStorage['room:settings-room'] = JSON.stringify(roomData);
        });

        test('updates settings successfully', async () => {
            // Mock Lua script result (updateSettings now uses atomic Lua script)
            mockRedis.eval.mockResolvedValueOnce(JSON.stringify({
                success: true,
                settings: { turnTimer: 120, allowSpectators: false, teamNames: { red: 'Red', blue: 'Blue' } }
            }));

            const result = await roomService.updateSettings('settings-room', 'host-1', {
                turnTimer: 120,
                allowSpectators: false
            });

            expect(result.turnTimer).toBe(120);
            expect(result.allowSpectators).toBe(false);
        });

        test('updates team names', async () => {
            mockRedis.eval.mockResolvedValueOnce(JSON.stringify({
                success: true,
                settings: { turnTimer: 60, allowSpectators: true, teamNames: { red: 'Dragons', blue: 'Knights' } }
            }));

            const result = await roomService.updateSettings('settings-room', 'host-1', {
                teamNames: { red: 'Dragons', blue: 'Knights' }
            });

            expect(result.teamNames).toEqual({ red: 'Dragons', blue: 'Knights' });
        });

        test('throws when not host', async () => {
            mockRedis.eval.mockResolvedValueOnce(JSON.stringify({ error: 'NOT_HOST' }));

            await expect(roomService.updateSettings('settings-room', 'not-host', {
                turnTimer: 90
            })).rejects.toMatchObject({ code: ERROR_CODES.NOT_HOST });
        });

        test('throws when room not found', async () => {
            mockRedis.eval.mockResolvedValueOnce(JSON.stringify({ error: 'ROOM_NOT_FOUND' }));

            await expect(roomService.updateSettings('notexist', 'host-1', {
                turnTimer: 90
            })).rejects.toMatchObject({ code: ERROR_CODES.ROOM_NOT_FOUND });
        });
    });

    describe('roomExists', () => {
        test('returns true when room exists', async () => {
            mockRedis.exists.mockResolvedValue(1);

            const exists = await roomService.roomExists('test-room');
            expect(exists).toBe(true);
        });

        test('returns false when room does not exist', async () => {
            mockRedis.exists.mockResolvedValue(0);

            const exists = await roomService.roomExists('notexist');
            expect(exists).toBe(false);
        });

        test('normalizes room ID for lookup', async () => {
            mockRedis.exists.mockResolvedValue(1);

            await roomService.roomExists('TEST-ROOM');
            expect(mockRedis.exists).toHaveBeenCalledWith('room:test-room');
        });
    });

    describe('refreshRoomTTL', () => {
        test('refreshes all room-related keys atomically using Lua script', async () => {
            mockRedis.eval.mockResolvedValue(1);

            await roomService.refreshRoomTTL('test-room');

            expect(mockRedis.eval).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    keys: expect.arrayContaining([
                        'room:test-room',
                        'room:test-room:players',
                        'room:test-room:game',
                        'room:test-room:team:red',
                        'room:test-room:team:blue'
                    ])
                })
            );
        });

        test('includes team sets in TTL refresh', async () => {
            mockRedis.eval.mockResolvedValue(1);

            await roomService.refreshRoomTTL('test-room');

            const evalCall = mockRedis.eval.mock.calls[0];
            expect(evalCall[1].keys).toContain('room:test-room:team:red');
            expect(evalCall[1].keys).toContain('room:test-room:team:blue');
        });
    });

    describe('cleanupRoom', () => {
        test('removes all room data', async () => {
            mockRedis.sMembers.mockResolvedValue(['player-1', 'player-2']);

            await roomService.cleanupRoom('test-room');

            expect(mockRedis.del).toHaveBeenCalled();
            const timerService = require('../../services/timerService');
            expect(timerService.stopTimer).toHaveBeenCalledWith('test-room');
        });
    });

    describe('deleteRoom', () => {
        test('calls cleanupRoom', async () => {
            mockRedis.sMembers.mockResolvedValue([]);

            await roomService.deleteRoom('test-room');

            expect(mockRedis.del).toHaveBeenCalled();
        });
    });
});
