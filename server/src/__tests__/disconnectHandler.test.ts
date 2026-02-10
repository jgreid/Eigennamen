/**
 * Disconnect Handler Tests
 *
 * Tests for the socket disconnect handler and timer expiration callback.
 */

const mockRedis = {
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    eval: jest.fn().mockResolvedValue(null),
    get: jest.fn().mockResolvedValue(null),
    incr: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(1),
};

jest.mock('../config/redis', () => ({
    getRedis: () => mockRedis,
    isRedisHealthy: jest.fn().mockResolvedValue(true),
}));

jest.mock('../utils/logger', () => ({
    info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn()
}));

jest.mock('../services/playerService', () => ({
    getPlayer: jest.fn(),
    handleDisconnect: jest.fn().mockResolvedValue(undefined),
    getPlayersInRoom: jest.fn().mockResolvedValue([]),
    getRoomStats: jest.fn().mockResolvedValue({ totalPlayers: 0 }),
    generateReconnectionToken: jest.fn().mockResolvedValue('abc123'),
    atomicHostTransfer: jest.fn().mockResolvedValue({ success: true }),
}));

jest.mock('../services/gameService', () => ({
    getGame: jest.fn(),
    endTurn: jest.fn().mockResolvedValue({ currentTurn: 'blue', previousTurn: 'red' }),
}));

jest.mock('../services/roomService', () => ({
    getRoom: jest.fn(),
}));

jest.mock('../services/eventLogService', () => ({
    logEvent: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../socket/safeEmit', () => ({
    safeEmitToRoom: jest.fn(),
}));

jest.mock('../utils/distributedLock', () => ({
    RELEASE_LOCK_SCRIPT: 'mock-release-script',
}));

const { handleDisconnect, createTimerExpireCallback } = require('../socket/disconnectHandler');
const playerService = require('../services/playerService');
const gameService = require('../services/gameService');
const { safeEmitToRoom } = require('../socket/safeEmit');
const logger = require('../utils/logger');

describe('disconnectHandler', () => {
    let mockIo: any;
    let mockSocket: any;

    beforeEach(() => {
        jest.clearAllMocks();
        mockRedis.set.mockResolvedValue('OK');
        mockIo = { to: jest.fn().mockReturnThis(), emit: jest.fn() };
        mockSocket = { id: 'sock-1', sessionId: 'sess-1', roomCode: 'ROOM01' };
    });

    describe('handleDisconnect', () => {
        it('should return early when player not found', async () => {
            playerService.getPlayer.mockResolvedValue(null);
            await handleDisconnect(mockIo, mockSocket, 'transport close');
            expect(playerService.handleDisconnect).not.toHaveBeenCalled();
        });

        it('should mark player as disconnected and notify room', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'sess-1', roomCode: 'ROOM01', nickname: 'Alice',
                team: 'red', isHost: false, connected: true,
            });
            playerService.getPlayersInRoom.mockResolvedValue([]);

            await handleDisconnect(mockIo, mockSocket, 'transport close');

            expect(playerService.handleDisconnect).toHaveBeenCalledWith('sess-1');
            expect(safeEmitToRoom).toHaveBeenCalledWith(
                mockIo, 'ROOM01', expect.stringContaining('disconnected'),
                expect.objectContaining({ sessionId: 'sess-1', nickname: 'Alice' })
            );
        });

        it('should attempt host transfer when host disconnects', async () => {
            playerService.getPlayer
                .mockResolvedValueOnce({
                    sessionId: 'sess-1', roomCode: 'ROOM01', nickname: 'Host',
                    team: 'red', isHost: true, connected: true,
                })
                .mockResolvedValueOnce(null); // re-check: host didn't reconnect

            playerService.getPlayersInRoom
                .mockResolvedValueOnce([]) // for notification
                .mockResolvedValueOnce([
                    { sessionId: 'sess-2', nickname: 'Bob', connected: true },
                ]);
            playerService.atomicHostTransfer.mockResolvedValue({ success: true });

            await handleDisconnect(mockIo, mockSocket, 'transport close');

            expect(playerService.atomicHostTransfer).toHaveBeenCalledWith('sess-1', 'sess-2', 'ROOM01');
            expect(safeEmitToRoom).toHaveBeenCalledWith(
                mockIo, 'ROOM01', expect.stringContaining('hostChanged'),
                expect.objectContaining({ newHostSessionId: 'sess-2' })
            );
        });

        it('should skip host transfer if host reconnected', async () => {
            playerService.getPlayer
                .mockResolvedValueOnce({
                    sessionId: 'sess-1', roomCode: 'ROOM01', nickname: 'Host',
                    team: 'red', isHost: true, connected: true,
                })
                .mockResolvedValueOnce({ sessionId: 'sess-1', connected: true }); // reconnected
            playerService.getPlayersInRoom.mockResolvedValue([]);

            await handleDisconnect(mockIo, mockSocket, 'transport close');

            expect(playerService.atomicHostTransfer).not.toHaveBeenCalled();
        });

        it('should skip host transfer when lock not acquired', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'sess-1', roomCode: 'ROOM01', nickname: 'Host',
                team: 'red', isHost: true, connected: true,
            });
            playerService.getPlayersInRoom.mockResolvedValue([]);
            mockRedis.set.mockResolvedValue(null); // lock failed

            await handleDisconnect(mockIo, mockSocket, 'transport close');

            expect(playerService.atomicHostTransfer).not.toHaveBeenCalled();
        });

        it('should abort early when abortSignal is triggered', async () => {
            const ac = new AbortController();
            ac.abort(); // pre-abort
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'sess-1', roomCode: 'ROOM01', nickname: 'Alice',
                team: 'red', isHost: false, connected: true,
            });

            await handleDisconnect(mockIo, mockSocket, 'transport close', ac.signal);

            expect(playerService.handleDisconnect).toHaveBeenCalled();
            // Should have returned early before room notification
            expect(safeEmitToRoom).not.toHaveBeenCalled();
        });

        it('should handle errors gracefully', async () => {
            playerService.getPlayer.mockRejectedValue(new Error('Redis down'));

            await handleDisconnect(mockIo, mockSocket, 'transport close');

            expect(logger.error).toHaveBeenCalledWith('Error handling disconnect:', expect.any(Error));
        });

        it('should handle failed atomic host transfer', async () => {
            playerService.getPlayer
                .mockResolvedValueOnce({
                    sessionId: 'sess-1', roomCode: 'ROOM01', nickname: 'Host',
                    team: 'red', isHost: true, connected: true,
                })
                .mockResolvedValueOnce(null);

            playerService.getPlayersInRoom
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([
                    { sessionId: 'sess-2', nickname: 'Bob', connected: true },
                ]);
            playerService.atomicHostTransfer.mockResolvedValue({ success: false, reason: 'version mismatch' });

            await handleDisconnect(mockIo, mockSocket, 'transport close');

            expect(logger.error).toHaveBeenCalledWith(
                expect.stringContaining('Atomic host transfer failed'),
                expect.any(Object)
            );
        });
    });

    describe('createTimerExpireCallback', () => {
        let callback: Function;
        let emitToRoom: jest.Mock;
        let startTurnTimer: jest.Mock;

        beforeEach(() => {
            emitToRoom = jest.fn();
            startTurnTimer = jest.fn().mockResolvedValue({});
            callback = createTimerExpireCallback(emitToRoom, startTurnTimer);
        });

        it('should return early if no game found', async () => {
            gameService.getGame.mockResolvedValue(null);
            await callback('ROOM01');
            expect(gameService.endTurn).not.toHaveBeenCalled();
        });

        it('should return early if game is already over', async () => {
            gameService.getGame.mockResolvedValue({ gameOver: true });
            await callback('ROOM01');
            expect(gameService.endTurn).not.toHaveBeenCalled();
        });

        it('should end turn and emit events on timer expiry', async () => {
            gameService.getGame.mockResolvedValue({ gameOver: false });
            gameService.endTurn.mockResolvedValue({ currentTurn: 'blue', previousTurn: 'red' });

            await callback('ROOM01');

            expect(gameService.endTurn).toHaveBeenCalledWith('ROOM01', 'Timer');
            expect(emitToRoom).toHaveBeenCalledWith('ROOM01', expect.stringContaining('turnEnded'), expect.any(Object));
            expect(emitToRoom).toHaveBeenCalledWith('ROOM01', expect.stringContaining('expired'), expect.any(Object));
        });

        it('should handle errors in timer expiry', async () => {
            gameService.getGame.mockRejectedValue(new Error('Redis error'));

            await callback('ROOM01');

            expect(logger.error).toHaveBeenCalledWith(
                expect.stringContaining('Timer expiry error'), expect.any(Error)
            );
        });
    });
});
