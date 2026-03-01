/**
 * Extended Room Service Tests (Part 2)
 * Tests additional edge cases for roomService not covered by roomServiceExtended.test.ts
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
    mGet: jest.fn(),
    eval: jest.fn(),
};

jest.mock('../../config/redis', () => ({
    getRedis: jest.fn(() => mockRedis),
}));

// Mock uuid
jest.mock('uuid', () => ({
    v4: jest.fn(() => 'mock-uuid-1234'),
}));

// Mock player service
jest.mock('../../services/playerService', () => ({
    createPlayer: jest.fn(),
    getPlayer: jest.fn(),
    updatePlayer: jest.fn(),
    removePlayer: jest.fn(),
    getPlayersInRoom: jest.fn(),
    // FIX: Add atomicHostTransfer for H4 fix
    atomicHostTransfer: jest.fn(),
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
        lastSeen: Date.now(),
    })),
}));

// Mock game service
jest.mock('../../services/gameService', () => ({
    getGame: jest.fn(),
    getGameStateForPlayer: jest.fn(),
}));

// Mock timer service
jest.mock('../../services/timerService', () => ({
    stopTimer: jest.fn(),
}));

// Mock logger
jest.mock('../../utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
}));

const roomService = require('../../services/roomService');
const playerService = require('../../services/playerService');
const gameService = require('../../services/gameService');

describe('Extended Room Service Tests (Part 2)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('joinRoom', () => {
        const mockRoom = {
            code: 'test-room',
            roomId: 'test-room',
            hostSessionId: 'host-session-123',
            status: 'waiting',
            settings: {},
        };

        test('handles player already in set but missing data', async () => {
            mockRedis.get.mockResolvedValue(JSON.stringify(mockRoom));
            mockRedis.eval.mockResolvedValue(-1); // Already a member
            playerService.getPlayer.mockResolvedValue(null);
            playerService.createPlayer.mockResolvedValue({
                sessionId: 'player-session',
                nickname: 'Player1',
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

            await expect(roomService.joinRoom('test-room', 'player-session', 'Player1')).rejects.toThrow(
                'unexpected error'
            );
        });

        test('creates player atomically in join script (Sprint D1)', async () => {
            mockRedis.get.mockResolvedValue(JSON.stringify(mockRoom));
            mockRedis.eval.mockResolvedValue(1);
            playerService.getPlayer.mockResolvedValue(null);
            gameService.getGame.mockResolvedValue(null);
            playerService.getPlayersInRoom.mockResolvedValue([]);

            const result = await roomService.joinRoom('test-room', 'player-session', 'Player1');

            // Player data is built by buildPlayerData and passed to the Lua script
            expect(playerService.buildPlayerData).toHaveBeenCalledWith('player-session', 'test-room', 'Player1', false);
            // createPlayer should NOT be called for result===1 (atomic in Lua)
            expect(playerService.createPlayer).not.toHaveBeenCalled();
            expect(result.player).toMatchObject({
                sessionId: 'player-session',
                roomCode: 'test-room',
                nickname: 'Player1',
            });
        });
    });

});
