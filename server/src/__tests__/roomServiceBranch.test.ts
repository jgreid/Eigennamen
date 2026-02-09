/**
 * Room Service Branch Coverage Tests
 *
 * Tests uncovered branches: Lua script return codes (-2 for ROOM_NOT_FOUND),
 * null player after join, atomicHostTransfer paths
 */

// Mock storage
const mockRedisStorage: Record<string, string> = {};

const mockRedis = {
    get: jest.fn(async (key: string) => mockRedisStorage[key] || null),
    set: jest.fn(async (key: string, value: string) => {
        mockRedisStorage[key] = typeof value === 'string' ? value : JSON.stringify(value);
        return 'OK';
    }),
    del: jest.fn(async (keys: string | string[]) => {
        const keysArray = Array.isArray(keys) ? keys : [keys];
        keysArray.forEach(key => delete mockRedisStorage[key]);
        return keysArray.length;
    }),
    exists: jest.fn(async (key: string) => mockRedisStorage[key] ? 1 : 0),
    expire: jest.fn().mockResolvedValue(1),
    sMembers: jest.fn().mockResolvedValue([]),
    sAdd: jest.fn().mockResolvedValue(1),
    sRem: jest.fn().mockResolvedValue(1),
    mGet: jest.fn(async (keys: string[]) => keys.map(key => mockRedisStorage[key] || null)),
    eval: jest.fn().mockResolvedValue(1)
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

const mockCreatePlayer = jest.fn();
const mockGetPlayer = jest.fn();
const mockUpdatePlayer = jest.fn();
const mockGetPlayersInRoom = jest.fn();
const mockRemovePlayer = jest.fn();
const mockAtomicHostTransfer = jest.fn();

jest.mock('../services/playerService', () => ({
    createPlayer: (...args: unknown[]) => mockCreatePlayer(...args),
    getPlayer: (...args: unknown[]) => mockGetPlayer(...args),
    updatePlayer: (...args: unknown[]) => mockUpdatePlayer(...args),
    getPlayersInRoom: (...args: unknown[]) => mockGetPlayersInRoom(...args),
    removePlayer: (...args: unknown[]) => mockRemovePlayer(...args),
    atomicHostTransfer: (...args: unknown[]) => mockAtomicHostTransfer(...args)
}));

const mockGetGame = jest.fn();
const mockGetGameStateForPlayer = jest.fn();

jest.mock('../services/gameService', () => ({
    getGame: (...args: unknown[]) => mockGetGame(...args),
    getGameStateForPlayer: (...args: unknown[]) => mockGetGameStateForPlayer(...args)
}));

jest.mock('../services/timerService', () => ({
    stopTimer: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../utils/timeout', () => ({
    withTimeout: (promise: Promise<unknown>) => promise,
    TIMEOUTS: { REDIS_OPERATION: 5000 }
}));

jest.mock('../utils/sanitize', () => ({
    toEnglishLowerCase: (str: string) => str.toLowerCase()
}));

const roomService = require('../services/roomService');

describe('Room Service Branch Coverage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Clear mock storage
        Object.keys(mockRedisStorage).forEach(key => delete mockRedisStorage[key]);
    });

    describe('joinRoom - Lua script return code -2 (ROOM_NOT_FOUND)', () => {
        it('should throw RoomError.notFound when Lua script returns -2', async () => {
            // Setup: room exists in getRoom but disappeared before Lua script
            const room = {
                id: 'test-id',
                code: 'testroom',
                roomId: 'TestRoom',
                hostSessionId: 'host-1',
                status: 'waiting',
                settings: { gameMode: 'classic' },
                createdAt: Date.now(),
                expiresAt: Date.now() + 3600000
            };
            mockRedisStorage['room:testroom'] = JSON.stringify(room);

            // Player not already in room
            mockGetPlayer.mockResolvedValue(null);

            // Lua script returns -2 (room deleted between getRoom and script)
            mockRedis.eval.mockResolvedValue(-2);

            await expect(roomService.joinRoom('TestRoom', 'session-1', 'Player1'))
                .rejects.toThrow('Room not found');
        });
    });

    describe('joinRoom - result === -1 (already a member)', () => {
        it('should treat as reconnection when Lua returns -1', async () => {
            const room = {
                id: 'test-id',
                code: 'testroom',
                roomId: 'TestRoom',
                hostSessionId: 'host-1',
                status: 'waiting',
                settings: { gameMode: 'classic' },
                createdAt: Date.now(),
                expiresAt: Date.now() + 3600000
            };
            mockRedisStorage['room:testroom'] = JSON.stringify(room);

            // Player not found on initial check
            mockGetPlayer.mockResolvedValue(null);

            // Lua script returns -1 (already a member but player data missing)
            mockRedis.eval.mockResolvedValue(-1);

            const createdPlayer = {
                sessionId: 'session-1',
                roomCode: 'testroom',
                nickname: 'Player1',
                team: null,
                role: 'spectator',
                isHost: false,
                connected: true
            };
            mockCreatePlayer.mockResolvedValue(createdPlayer);
            mockGetGame.mockResolvedValue(null);
            mockGetPlayersInRoom.mockResolvedValue([createdPlayer]);

            const result = await roomService.joinRoom('TestRoom', 'session-1', 'Player1');

            expect(result.isReconnecting).toBe(true);
            expect(mockCreatePlayer).toHaveBeenCalled();
        });
    });

    describe('joinRoom - unexpected Lua result', () => {
        it('should throw ServerError on unexpected Lua return value', async () => {
            const room = {
                id: 'test-id',
                code: 'testroom',
                roomId: 'TestRoom',
                hostSessionId: 'host-1',
                status: 'waiting',
                settings: { gameMode: 'classic' },
                createdAt: Date.now(),
                expiresAt: Date.now() + 3600000
            };
            mockRedisStorage['room:testroom'] = JSON.stringify(room);

            mockGetPlayer.mockResolvedValue(null);
            mockRedis.eval.mockResolvedValue(99); // unexpected

            await expect(roomService.joinRoom('TestRoom', 'session-1', 'Player1'))
                .rejects.toThrow('Failed to join room due to unexpected error');
        });
    });

    describe('joinRoom - null player at end', () => {
        it('should throw ServerError if player is null after join flow', async () => {
            const room = {
                id: 'test-id',
                code: 'testroom',
                roomId: 'TestRoom',
                hostSessionId: 'host-1',
                status: 'waiting',
                settings: { gameMode: 'classic' },
                createdAt: Date.now(),
                expiresAt: Date.now() + 3600000
            };
            mockRedisStorage['room:testroom'] = JSON.stringify(room);

            // Player not in room
            mockGetPlayer.mockResolvedValue(null);

            // Lua script returns 1 (success)
            mockRedis.eval.mockResolvedValue(1);

            // createPlayer returns null (unexpected)
            mockCreatePlayer.mockResolvedValue(null);
            mockGetGame.mockResolvedValue(null);

            await expect(roomService.joinRoom('TestRoom', 'session-1', 'Player1'))
                .rejects.toThrow('Failed to create or retrieve player');
        });
    });

    describe('joinRoom - player creation fails with rollback', () => {
        it('should rollback set addition when player creation throws', async () => {
            const room = {
                id: 'test-id',
                code: 'testroom',
                roomId: 'TestRoom',
                hostSessionId: 'host-1',
                status: 'waiting',
                settings: { gameMode: 'classic' },
                createdAt: Date.now(),
                expiresAt: Date.now() + 3600000
            };
            mockRedisStorage['room:testroom'] = JSON.stringify(room);

            mockGetPlayer.mockResolvedValue(null);
            mockRedis.eval.mockResolvedValue(1); // success
            mockCreatePlayer.mockRejectedValue(new Error('Player creation failed'));

            await expect(roomService.joinRoom('TestRoom', 'session-1', 'Player1'))
                .rejects.toThrow('Player creation failed');

            expect(mockRedis.sRem).toHaveBeenCalledWith('room:testroom:players', 'session-1');
        });
    });

    describe('joinRoom - reconnecting player', () => {
        it('should handle reconnection when player exists in room', async () => {
            const room = {
                id: 'test-id',
                code: 'testroom',
                roomId: 'TestRoom',
                hostSessionId: 'host-1',
                status: 'waiting',
                settings: { gameMode: 'classic' },
                createdAt: Date.now(),
                expiresAt: Date.now() + 3600000
            };
            mockRedisStorage['room:testroom'] = JSON.stringify(room);

            const existingPlayer = {
                sessionId: 'session-1',
                roomCode: 'testroom',
                nickname: 'Player1',
                team: 'red',
                role: 'spymaster',
                isHost: false,
                connected: false
            };

            mockGetPlayer.mockResolvedValue(existingPlayer);
            mockUpdatePlayer.mockResolvedValue({ ...existingPlayer, connected: true });
            mockGetGame.mockResolvedValue(null);
            mockGetPlayersInRoom.mockResolvedValue([{ ...existingPlayer, connected: true }]);

            const result = await roomService.joinRoom('TestRoom', 'session-1', 'Player1');
            expect(result.isReconnecting).toBe(true);
        });
    });

    describe('joinRoom - with active game', () => {
        it('should return game state for player when game exists', async () => {
            const room = {
                id: 'test-id',
                code: 'testroom',
                roomId: 'TestRoom',
                hostSessionId: 'host-1',
                status: 'playing',
                settings: { gameMode: 'classic' },
                createdAt: Date.now(),
                expiresAt: Date.now() + 3600000
            };
            mockRedisStorage['room:testroom'] = JSON.stringify(room);

            const player = {
                sessionId: 'session-1',
                roomCode: 'testroom',
                nickname: 'Player1',
                team: 'red',
                role: 'clicker',
                isHost: false,
                connected: true
            };

            mockGetPlayer.mockResolvedValue(player);
            mockUpdatePlayer.mockResolvedValue(player);

            const mockGame = { id: 'game-1', gameOver: false };
            mockGetGame.mockResolvedValue(mockGame);
            mockGetGameStateForPlayer.mockReturnValue({ id: 'game-1', types: [] });
            mockGetPlayersInRoom.mockResolvedValue([player]);

            const result = await roomService.joinRoom('TestRoom', 'session-1', 'Player1');
            expect(result.game).toBeDefined();
            expect(mockGetGameStateForPlayer).toHaveBeenCalledWith(mockGame, player);
        });
    });

    describe('leaveRoom - atomicHostTransfer fallback', () => {
        it('should use non-atomic fallback when atomicHostTransfer fails', async () => {
            const room = {
                id: 'test-id',
                code: 'testroom',
                hostSessionId: 'host-1',
                status: 'waiting',
                settings: {}
            };
            mockRedisStorage['room:testroom'] = JSON.stringify(room);

            const players = [
                { sessionId: 'host-1', nickname: 'Host', isHost: true },
                { sessionId: 'player-2', nickname: 'Player2', isHost: false }
            ];
            mockGetPlayersInRoom.mockResolvedValue(players);
            mockAtomicHostTransfer.mockResolvedValue({ success: false, reason: 'SCRIPT_FAILED' });
            mockUpdatePlayer.mockResolvedValue(players[1]);

            const result = await roomService.leaveRoom('testroom', 'host-1');
            expect(result.newHostId).toBe('player-2');
            expect(mockRedis.set).toHaveBeenCalled();
        });

        it('should succeed with atomic transfer', async () => {
            const room = {
                id: 'test-id',
                code: 'testroom',
                hostSessionId: 'host-1',
                status: 'waiting',
                settings: {}
            };
            mockRedisStorage['room:testroom'] = JSON.stringify(room);

            const players = [
                { sessionId: 'host-1', nickname: 'Host', isHost: true },
                { sessionId: 'player-2', nickname: 'Player2', isHost: false }
            ];
            mockGetPlayersInRoom.mockResolvedValue(players);
            mockAtomicHostTransfer.mockResolvedValue({ success: true });

            const result = await roomService.leaveRoom('testroom', 'host-1');
            expect(result.newHostId).toBe('player-2');
        });
    });

    describe('leaveRoom - room not found', () => {
        it('should return default result when room does not exist', async () => {
            const result = await roomService.leaveRoom('nonexistent', 'session-1');
            expect(result).toEqual({ newHostId: null, roomDeleted: false });
        });
    });

    describe('leaveRoom - last player leaves', () => {
        it('should delete room when no players remain', async () => {
            const room = {
                id: 'test-id',
                code: 'testroom',
                hostSessionId: 'player-1',
                status: 'waiting',
                settings: {}
            };
            mockRedisStorage['room:testroom'] = JSON.stringify(room);

            mockGetPlayersInRoom.mockResolvedValue([
                { sessionId: 'player-1', nickname: 'Player1', isHost: true }
            ]);

            const result = await roomService.leaveRoom('testroom', 'player-1');
            expect(result.roomDeleted).toBe(true);
        });
    });

    describe('getRoom - corrupted data', () => {
        it('should return null and log error for corrupted JSON', async () => {
            mockRedisStorage['room:badroom'] = '{invalid json';

            const result = await roomService.getRoom('badroom');
            expect(result).toBeNull();
        });
    });

    describe('createRoom - player creation failure rollback', () => {
        it('should delete room when player creation fails', async () => {
            mockRedis.eval.mockResolvedValue(1); // room created
            mockCreatePlayer.mockRejectedValue(new Error('Failed to create player'));

            await expect(roomService.createRoom('MyRoom', 'session-1'))
                .rejects.toThrow('Failed to create player');

            expect(mockRedis.del).toHaveBeenCalledWith('room:myroom');
            expect(mockRedis.del).toHaveBeenCalledWith('room:myroom:players');
        });
    });

    describe('createRoom - room already exists', () => {
        it('should throw when room already exists (Lua returns 0)', async () => {
            mockRedis.eval.mockResolvedValue(0);

            await expect(roomService.createRoom('ExistingRoom', 'session-1'))
                .rejects.toThrow('already exists');
        });
    });

    describe('joinRoom - room full', () => {
        it('should throw when Lua returns 0 (room full)', async () => {
            const room = {
                id: 'test-id',
                code: 'fullroom',
                roomId: 'FullRoom',
                hostSessionId: 'host-1',
                status: 'waiting',
                settings: {},
                createdAt: Date.now(),
                expiresAt: Date.now() + 3600000
            };
            mockRedisStorage['room:fullroom'] = JSON.stringify(room);

            mockGetPlayer.mockResolvedValue(null);
            mockRedis.eval.mockResolvedValue(0); // full

            await expect(roomService.joinRoom('FullRoom', 'session-1', 'Player1'))
                .rejects.toThrow('Room is full');
        });
    });
});
