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

jest.mock('../../config/redis', () => ({
    getRedis: () => mockRedis,
    isRedisHealthy: jest.fn().mockResolvedValue(true),
}));

jest.mock('../../utils/logger', () => ({
    info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn()
}));

jest.mock('../../services/playerService', () => ({
    getPlayer: jest.fn(),
    handleDisconnect: jest.fn().mockResolvedValue(undefined),
    getPlayersInRoom: jest.fn().mockResolvedValue([]),
    getRoomStats: jest.fn().mockResolvedValue({ totalPlayers: 0 }),
    generateReconnectionToken: jest.fn().mockResolvedValue('abc123'),
    atomicHostTransfer: jest.fn().mockResolvedValue({ success: true }),
}));

jest.mock('../../services/gameService', () => ({
    getGame: jest.fn(),
    endTurn: jest.fn().mockResolvedValue({ currentTurn: 'blue', previousTurn: 'red' }),
}));

jest.mock('../../services/roomService', () => ({
    getRoom: jest.fn(),
}));

jest.mock('../../socket/safeEmit', () => ({
    safeEmitToRoom: jest.fn(),
}));

const mockWithLock = jest.fn((_key: string, fn: () => Promise<unknown>) => fn());
jest.mock('../../utils/distributedLock', () => ({
    withLock: mockWithLock,
}));

const { handleDisconnect, createTimerExpireCallback } = require('../../socket/disconnectHandler');
const playerService = require('../../services/playerService');
const gameService = require('../../services/gameService');
const roomService = require('../../services/roomService');
const { safeEmitToRoom } = require('../../socket/safeEmit');
const { isRedisHealthy } = require('../../config/redis');
const logger = require('../../utils/logger');

describe('disconnectHandler', () => {
    let mockIo: any;
    let mockSocket: any;

    beforeEach(() => {
        jest.clearAllMocks();
        mockRedis.set.mockResolvedValue('OK');
        mockWithLock.mockImplementation((_key: string, fn: () => Promise<unknown>) => fn());
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
            // Simulate withLock failing to acquire the host-transfer lock
            mockWithLock.mockRejectedValueOnce(new Error('Lock not acquired'));

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

        it('should skip host transfer when no connected players remain', async () => {
            playerService.getPlayer
                .mockResolvedValueOnce({
                    sessionId: 'sess-1', roomCode: 'ROOM01', nickname: 'Host',
                    team: 'red', isHost: true, connected: true,
                })
                .mockResolvedValueOnce(null); // host didn't reconnect

            playerService.getPlayersInRoom
                .mockResolvedValueOnce([]) // for notification
                .mockResolvedValueOnce([]); // no connected players for host transfer

            await handleDisconnect(mockIo, mockSocket, 'transport close');

            // No connected players to transfer to - silently skips
            expect(playerService.atomicHostTransfer).not.toHaveBeenCalled();
        });

        it('should skip host transfer when players list is non-array', async () => {
            playerService.getPlayer
                .mockResolvedValueOnce({
                    sessionId: 'sess-1', roomCode: 'ROOM01', nickname: 'Host',
                    team: 'red', isHost: true, connected: true,
                })
                .mockResolvedValueOnce(null);

            playerService.getPlayersInRoom
                .mockResolvedValueOnce([]) // for notification
                .mockResolvedValueOnce(null); // Redis returned null

            await handleDisconnect(mockIo, mockSocket, 'transport close');

            expect(playerService.atomicHostTransfer).not.toHaveBeenCalled();
            expect(logger.warn).toHaveBeenCalledWith(
                expect.stringContaining('Unable to fetch players')
            );
        });

        it('should handle withLock errors without crashing', async () => {
            playerService.getPlayer.mockResolvedValueOnce({
                sessionId: 'sess-1', roomCode: 'ROOM01', nickname: 'Host',
                team: 'red', isHost: true, connected: true,
            });
            playerService.getPlayersInRoom.mockResolvedValue([]);

            // withLock rejects (e.g. internal Redis failure)
            mockWithLock.mockRejectedValueOnce(new Error('Lock internal error'));

            // Should not throw despite lock error
            await expect(
                handleDisconnect(mockIo, mockSocket, 'transport close')
            ).resolves.not.toThrow();
        });

        it('should handle reconnection token generation failure gracefully', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'sess-1', roomCode: 'ROOM01', nickname: 'Alice',
                team: 'red', isHost: false, connected: true,
            });
            playerService.generateReconnectionToken.mockRejectedValue(new Error('token error'));
            playerService.getPlayersInRoom.mockResolvedValue([]);

            await handleDisconnect(mockIo, mockSocket, 'transport close');

            expect(logger.warn).toHaveBeenCalledWith(
                expect.stringContaining('Failed to generate reconnection token'),
                expect.any(String)
            );
            // Should still proceed with disconnect
            expect(playerService.handleDisconnect).toHaveBeenCalledWith('sess-1');
        });

        it('should skip room notification when player has no roomCode', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'sess-1', roomCode: null, nickname: 'Alice',
                team: null, isHost: false, connected: true,
            });

            await handleDisconnect(mockIo, mockSocket, 'transport close');

            expect(playerService.handleDisconnect).toHaveBeenCalledWith('sess-1');
            expect(safeEmitToRoom).not.toHaveBeenCalled();
        });

        it('should abort before host transfer when signal is triggered late', async () => {
            const ac = new AbortController();
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'sess-1', roomCode: 'ROOM01', nickname: 'Host',
                team: 'red', isHost: true, connected: true,
            });
            playerService.getPlayersInRoom.mockResolvedValue([]);
            playerService.getRoomStats.mockImplementation(async () => {
                // Abort after room notification but before host transfer
                ac.abort();
                return { totalPlayers: 0 };
            });

            await handleDisconnect(mockIo, mockSocket, 'transport close', ac.signal);

            // Room notification should have happened
            expect(safeEmitToRoom).toHaveBeenCalled();
            // But host transfer should not (aborted)
            expect(playerService.atomicHostTransfer).not.toHaveBeenCalled();
        });

        it('should handle host transfer error gracefully', async () => {
            playerService.getPlayer.mockResolvedValueOnce({
                sessionId: 'sess-1', roomCode: 'ROOM01', nickname: 'Host',
                team: 'red', isHost: true, connected: true,
            });
            playerService.getPlayersInRoom.mockResolvedValue([]);

            // Simulate withLock throwing (e.g. Redis error inside the callback)
            mockWithLock.mockRejectedValueOnce(new Error('Redis error during recheck'));

            await expect(
                handleDisconnect(mockIo, mockSocket, 'transport close')
            ).resolves.not.toThrow();

            expect(logger.info).toHaveBeenCalledWith(
                expect.stringContaining('Host transfer lock not acquired'),
            );
        });

        it('should broadcast updated room stats after disconnect notification', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'sess-1', roomCode: 'ROOM01', nickname: 'Alice',
                team: 'blue', isHost: false, connected: true,
            });
            const updatedPlayers = [
                { sessionId: 'sess-2', nickname: 'Bob', connected: true },
            ];
            playerService.getPlayersInRoom.mockResolvedValue(updatedPlayers);
            playerService.getRoomStats.mockResolvedValue({ totalPlayers: 1, connectedPlayers: 1 });

            await handleDisconnect(mockIo, mockSocket, 'transport close');

            // Should emit both player:disconnected and room:statsUpdated
            expect(safeEmitToRoom).toHaveBeenCalledTimes(2);
            expect(safeEmitToRoom).toHaveBeenCalledWith(
                mockIo, 'ROOM01', expect.stringContaining('statsUpdated'),
                expect.objectContaining({ stats: expect.any(Object) })
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

            // Error from withLock callback is caught by the inner try-catch and
            // logged as info (lock contention path), then returns early.
            expect(logger.info).toHaveBeenCalledWith(
                expect.stringContaining('Timer expiration lock not acquired')
            );
        });

        it('should schedule timer restart via setImmediate after ending turn', async () => {
            gameService.getGame.mockResolvedValue({ gameOver: false, currentTurn: 'red' });
            gameService.endTurn.mockResolvedValue({ currentTurn: 'blue', previousTurn: 'red' });
            roomService.getRoom.mockResolvedValue({
                code: 'ROOM01', settings: { turnTimer: 60 },
            });
            (isRedisHealthy as jest.Mock).mockResolvedValue(true);
            mockRedis.set.mockResolvedValue('OK');

            await callback('ROOM01');

            // Timer restart runs in setImmediate — flush it
            await new Promise(resolve => setImmediate(resolve));
            // Allow the async IIFE to settle
            await new Promise(resolve => setTimeout(resolve, 10));

            expect(startTurnTimer).toHaveBeenCalledWith('ROOM01', 60);
        });

        it('should skip timer restart when Redis is unhealthy', async () => {
            gameService.getGame.mockResolvedValue({ gameOver: false });
            gameService.endTurn.mockResolvedValue({ currentTurn: 'blue', previousTurn: 'red' });
            (isRedisHealthy as jest.Mock).mockResolvedValue(false);

            await callback('ROOM01');
            await new Promise(resolve => setImmediate(resolve));
            await new Promise(resolve => setTimeout(resolve, 10));

            expect(logger.warn).toHaveBeenCalledWith(
                expect.stringContaining('Redis not healthy')
            );
            expect(startTurnTimer).not.toHaveBeenCalled();
        });

        it('should skip timer restart when lock not acquired', async () => {
            gameService.getGame.mockResolvedValue({ gameOver: false });
            gameService.endTurn.mockResolvedValue({ currentTurn: 'blue', previousTurn: 'red' });
            (isRedisHealthy as jest.Mock).mockResolvedValue(true);

            // Make withLock reject for the timer-restart lock (second call — first is timer-expire)
            mockWithLock
                .mockImplementationOnce((_key: string, fn: () => Promise<unknown>) => fn()) // timer-expire: pass through
                .mockRejectedValueOnce(new Error('Lock not acquired')); // timer-restart: reject

            await callback('ROOM01');
            await new Promise(resolve => setImmediate(resolve));
            await new Promise(resolve => setTimeout(resolve, 10));

            expect(startTurnTimer).not.toHaveBeenCalled();
        });

        it('should skip timer restart when room not found', async () => {
            gameService.getGame
                .mockResolvedValueOnce({ gameOver: false }) // for endTurn check
                .mockResolvedValueOnce({ gameOver: false }); // for restart check
            gameService.endTurn.mockResolvedValue({ currentTurn: 'blue', previousTurn: 'red' });
            (isRedisHealthy as jest.Mock).mockResolvedValue(true);
            mockRedis.set.mockResolvedValue('OK');
            roomService.getRoom.mockResolvedValue(null);

            await callback('ROOM01');
            await new Promise(resolve => setImmediate(resolve));
            await new Promise(resolve => setTimeout(resolve, 10));

            expect(startTurnTimer).not.toHaveBeenCalled();
        });

        it('should skip timer restart when no turn timer configured', async () => {
            gameService.getGame.mockResolvedValue({ gameOver: false, currentTurn: 'red' });
            gameService.endTurn.mockResolvedValue({ currentTurn: 'blue', previousTurn: 'red' });
            (isRedisHealthy as jest.Mock).mockResolvedValue(true);
            mockRedis.set.mockResolvedValue('OK');
            roomService.getRoom.mockResolvedValue({
                code: 'ROOM01', settings: { turnTimer: null },
            });

            await callback('ROOM01');
            await new Promise(resolve => setImmediate(resolve));
            await new Promise(resolve => setTimeout(resolve, 10));

            expect(startTurnTimer).not.toHaveBeenCalled();
        });

        it('should skip timer restart when game is over after turn end', async () => {
            gameService.getGame
                .mockResolvedValueOnce({ gameOver: false }) // for endTurn check
                .mockResolvedValueOnce({ gameOver: true, winner: 'blue' }); // for restart check
            gameService.endTurn.mockResolvedValue({ currentTurn: 'blue', previousTurn: 'red' });
            (isRedisHealthy as jest.Mock).mockResolvedValue(true);
            mockRedis.set.mockResolvedValue('OK');
            roomService.getRoom.mockResolvedValue({
                code: 'ROOM01', settings: { turnTimer: 60 },
            });

            await callback('ROOM01');
            await new Promise(resolve => setImmediate(resolve));
            await new Promise(resolve => setTimeout(resolve, 10));

            expect(startTurnTimer).not.toHaveBeenCalled();
        });
    });
});
