/**
 * Disconnect Handler Extended Branch Coverage Tests
 *
 * Tests additional branches in disconnectHandler.ts including:
 * - createTimerExpireCallback: game not found, game over, eventLog failure, timer restart branches
 * - handleDisconnect: abortSignal, host transfer lock, host reconnected, no suitable host,
 *   eventLog failure, atomicHostTransfer failure, lock release failure
 */

jest.mock('../utils/logger', () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
}));

jest.mock('../services/gameService', () => ({
    getGame: jest.fn(),
    endTurn: jest.fn()
}));

jest.mock('../services/roomService', () => ({
    getRoom: jest.fn()
}));

jest.mock('../services/playerService', () => ({
    getPlayer: jest.fn(),
    handleDisconnect: jest.fn(),
    getPlayersInRoom: jest.fn(),
    getRoomStats: jest.fn(),
    generateReconnectionToken: jest.fn(),
    atomicHostTransfer: jest.fn()
}));

jest.mock('../services/eventLogService', () => ({
    logEvent: jest.fn()
}));

jest.mock('../config/constants', () => ({
    SOCKET_EVENTS: {
        GAME_TURN_ENDED: 'game:turnEnded',
        TIMER_EXPIRED: 'timer:expired',
        PLAYER_DISCONNECTED: 'player:disconnected',
        ROOM_STATS_UPDATED: 'room:statsUpdated',
        ROOM_HOST_CHANGED: 'room:hostChanged'
    },
    SESSION_SECURITY: {
        RECONNECTION_TOKEN_TTL_SECONDS: 300
    }
}));

jest.mock('../socket/safeEmit', () => ({
    safeEmitToRoom: jest.fn()
}));

jest.mock('../config/redis', () => ({
    getRedis: jest.fn(),
    isRedisHealthy: jest.fn()
}));

jest.mock('../utils/distributedLock', () => ({
    RELEASE_LOCK_SCRIPT: 'mock-release-script'
}));

const gameService = require('../services/gameService');
const roomService = require('../services/roomService');
const playerService = require('../services/playerService');
const eventLogService = require('../services/eventLogService');
const { safeEmitToRoom } = require('../socket/safeEmit');
const { getRedis, isRedisHealthy } = require('../config/redis');

const { createTimerExpireCallback, handleDisconnect } = require('../socket/disconnectHandler');

describe('Disconnect Handler Extended Branch Coverage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // IMPORTANT: mockReset clears unconsumed mockResolvedValueOnce queue
        // AND resets implementation (clearAllMocks only clears calls/results)
        gameService.getGame.mockReset();
        gameService.endTurn.mockReset();
        roomService.getRoom.mockReset();
        playerService.getPlayer.mockReset();
        playerService.handleDisconnect.mockReset();
        playerService.getPlayersInRoom.mockReset();
        playerService.getRoomStats.mockReset();
        playerService.generateReconnectionToken.mockReset();
        playerService.atomicHostTransfer.mockReset();
        eventLogService.logEvent.mockReset();
        isRedisHealthy.mockReset();
        getRedis.mockReset();
    });

    describe('createTimerExpireCallback', () => {
        let emitToRoom: jest.Mock;
        let startTurnTimer: jest.Mock;
        let callback: (roomCode: string) => Promise<void>;

        beforeEach(() => {
            emitToRoom = jest.fn();
            startTurnTimer = jest.fn().mockResolvedValue({});
            callback = createTimerExpireCallback(emitToRoom, startTurnTimer);
        });

        it('should return early when game is not found', async () => {
            gameService.getGame.mockResolvedValue(null);

            await callback('ROOM01');

            expect(gameService.endTurn).not.toHaveBeenCalled();
            expect(emitToRoom).not.toHaveBeenCalled();
        });

        it('should return early when game is over', async () => {
            gameService.getGame.mockResolvedValue({ gameOver: true });

            await callback('ROOM01');

            expect(gameService.endTurn).not.toHaveBeenCalled();
            expect(emitToRoom).not.toHaveBeenCalled();
        });

        it('should end turn and emit events on timer expiry', async () => {
            gameService.getGame.mockResolvedValue({ gameOver: false });
            gameService.endTurn.mockResolvedValue({
                currentTurn: 'blue',
                previousTurn: 'red'
            });
            eventLogService.logEvent.mockResolvedValue(undefined);
            isRedisHealthy.mockResolvedValue(false); // prevent timer restart

            await callback('ROOM01');

            // Wait for setImmediate async IIFE to settle
            await new Promise(resolve => setTimeout(resolve, 50));

            expect(gameService.endTurn).toHaveBeenCalledWith('ROOM01', 'Timer');
            expect(emitToRoom).toHaveBeenCalledWith('ROOM01', 'game:turnEnded', {
                currentTurn: 'blue',
                previousTurn: 'red',
                reason: 'timerExpired'
            });
            expect(emitToRoom).toHaveBeenCalledWith('ROOM01', 'timer:expired', { roomCode: 'ROOM01' });
        });

        it('should log warning when eventLog fails', async () => {
            gameService.getGame.mockResolvedValue({ gameOver: false });
            gameService.endTurn.mockResolvedValue({
                currentTurn: 'blue',
                previousTurn: 'red'
            });
            eventLogService.logEvent.mockRejectedValue(new Error('Log failed'));
            isRedisHealthy.mockResolvedValue(false);

            await callback('ROOM01');

            // Wait for setImmediate async IIFE to settle
            await new Promise(resolve => setTimeout(resolve, 50));

            // Should not throw - eventLog errors are caught
            expect(emitToRoom).toHaveBeenCalled();
        });

        it('should restart timer when redis is healthy and game active', async () => {
            gameService.getGame
                .mockResolvedValueOnce({ gameOver: false }) // initial check
                .mockResolvedValueOnce({ gameOver: false, currentTurn: 'blue' }); // restart check
            gameService.endTurn.mockResolvedValue({
                currentTurn: 'blue',
                previousTurn: 'red'
            });
            eventLogService.logEvent.mockResolvedValue(undefined);

            // Track if the async IIFE completed
            let iifeCompleted = false;
            const origStartTurnTimer = startTurnTimer;
            startTurnTimer = jest.fn().mockImplementation(async (...args: any[]) => {
                iifeCompleted = true;
                return {};
            });
            // Re-create callback with the new startTurnTimer
            callback = createTimerExpireCallback(emitToRoom, startTurnTimer);

            const mockRedis = {
                set: jest.fn().mockResolvedValue('OK'),
                eval: jest.fn().mockResolvedValue(1)
            };
            getRedis.mockReturnValue(mockRedis);
            isRedisHealthy.mockResolvedValue(true);

            roomService.getRoom.mockResolvedValue({
                settings: { turnTimer: 60 }
            });

            await callback('ROOM01');

            // The timer restart happens in setImmediate + async IIFE
            // Poll until the async IIFE completes or timeout
            const deadline = Date.now() + 2000;
            while (!iifeCompleted && Date.now() < deadline) {
                await new Promise(resolve => setTimeout(resolve, 10));
            }

            expect(startTurnTimer).toHaveBeenCalledWith('ROOM01', 60);
        });

        it('should skip timer restart when lock not acquired', async () => {
            gameService.getGame.mockResolvedValue({ gameOver: false });
            gameService.endTurn.mockResolvedValue({
                currentTurn: 'blue',
                previousTurn: 'red'
            });
            eventLogService.logEvent.mockResolvedValue(undefined);

            const mockRedis = {
                set: jest.fn().mockResolvedValue(null), // lock not acquired
                eval: jest.fn()
            };
            getRedis.mockReturnValue(mockRedis);
            isRedisHealthy.mockResolvedValue(true);

            await callback('ROOM01');

            await new Promise(resolve => setImmediate(resolve));
            await new Promise(resolve => setTimeout(resolve, 50));

            expect(startTurnTimer).not.toHaveBeenCalled();
        });

        it('should skip timer restart when room not found', async () => {
            gameService.getGame
                .mockResolvedValueOnce({ gameOver: false })
                .mockResolvedValueOnce({ gameOver: false });
            gameService.endTurn.mockResolvedValue({
                currentTurn: 'blue',
                previousTurn: 'red'
            });
            eventLogService.logEvent.mockResolvedValue(undefined);

            const mockRedis = {
                set: jest.fn().mockResolvedValue('OK'),
                eval: jest.fn().mockResolvedValue(1)
            };
            getRedis.mockReturnValue(mockRedis);
            isRedisHealthy.mockResolvedValue(true);
            roomService.getRoom.mockResolvedValue(null);

            await callback('ROOM01');

            await new Promise(resolve => setImmediate(resolve));
            await new Promise(resolve => setTimeout(resolve, 50));

            expect(startTurnTimer).not.toHaveBeenCalled();
        });

        it('should skip timer restart when timer not configured', async () => {
            gameService.getGame
                .mockResolvedValueOnce({ gameOver: false })
                .mockResolvedValueOnce({ gameOver: false });
            gameService.endTurn.mockResolvedValue({
                currentTurn: 'blue',
                previousTurn: 'red'
            });
            eventLogService.logEvent.mockResolvedValue(undefined);

            const mockRedis = {
                set: jest.fn().mockResolvedValue('OK'),
                eval: jest.fn().mockResolvedValue(1)
            };
            getRedis.mockReturnValue(mockRedis);
            isRedisHealthy.mockResolvedValue(true);
            roomService.getRoom.mockResolvedValue({ settings: {} }); // no turnTimer

            await callback('ROOM01');

            await new Promise(resolve => setImmediate(resolve));
            await new Promise(resolve => setTimeout(resolve, 50));

            expect(startTurnTimer).not.toHaveBeenCalled();
        });

        it('should skip timer restart when game not found on restart check', async () => {
            gameService.getGame
                .mockResolvedValueOnce({ gameOver: false })
                .mockResolvedValueOnce(null); // game not found on restart check
            gameService.endTurn.mockResolvedValue({
                currentTurn: 'blue',
                previousTurn: 'red'
            });
            eventLogService.logEvent.mockResolvedValue(undefined);

            const mockRedis = {
                set: jest.fn().mockResolvedValue('OK'),
                eval: jest.fn().mockResolvedValue(1)
            };
            getRedis.mockReturnValue(mockRedis);
            isRedisHealthy.mockResolvedValue(true);
            roomService.getRoom.mockResolvedValue({ settings: { turnTimer: 60 } });

            await callback('ROOM01');

            await new Promise(resolve => setImmediate(resolve));
            await new Promise(resolve => setTimeout(resolve, 50));

            expect(startTurnTimer).not.toHaveBeenCalled();
        });

        it('should skip timer restart when game is over on restart check', async () => {
            gameService.getGame
                .mockResolvedValueOnce({ gameOver: false })
                .mockResolvedValueOnce({ gameOver: true, winner: 'red' });
            gameService.endTurn.mockResolvedValue({
                currentTurn: 'blue',
                previousTurn: 'red'
            });
            eventLogService.logEvent.mockResolvedValue(undefined);

            const mockRedis = {
                set: jest.fn().mockResolvedValue('OK'),
                eval: jest.fn().mockResolvedValue(1)
            };
            getRedis.mockReturnValue(mockRedis);
            isRedisHealthy.mockResolvedValue(true);
            roomService.getRoom.mockResolvedValue({ settings: { turnTimer: 60 } });

            await callback('ROOM01');

            await new Promise(resolve => setImmediate(resolve));
            await new Promise(resolve => setTimeout(resolve, 50));

            expect(startTurnTimer).not.toHaveBeenCalled();
        });

        it('should handle lock release failure gracefully', async () => {
            gameService.getGame
                .mockResolvedValueOnce({ gameOver: false })
                .mockResolvedValueOnce({ gameOver: false, currentTurn: 'blue' });
            gameService.endTurn.mockResolvedValue({
                currentTurn: 'blue',
                previousTurn: 'red'
            });
            eventLogService.logEvent.mockResolvedValue(undefined);

            const mockRedis = {
                set: jest.fn().mockResolvedValue('OK'),
                eval: jest.fn().mockRejectedValue(new Error('Lock release failed'))
            };
            getRedis.mockReturnValue(mockRedis);
            isRedisHealthy.mockResolvedValue(true);
            roomService.getRoom.mockResolvedValue({ settings: { turnTimer: 60 } });

            await callback('ROOM01');

            await new Promise(resolve => setImmediate(resolve));
            await new Promise(resolve => setTimeout(resolve, 50));

            // Should not throw - lock release errors are caught
            expect(startTurnTimer).toHaveBeenCalled();
        });

        it('should handle timer restart error in async IIFE', async () => {
            gameService.getGame.mockResolvedValue({ gameOver: false });
            gameService.endTurn.mockResolvedValue({
                currentTurn: 'blue',
                previousTurn: 'red'
            });
            eventLogService.logEvent.mockResolvedValue(undefined);

            const mockRedis = {
                set: jest.fn().mockRejectedValue(new Error('Redis error')),
                eval: jest.fn()
            };
            getRedis.mockReturnValue(mockRedis);
            isRedisHealthy.mockResolvedValue(true);

            await callback('ROOM01');

            await new Promise(resolve => setImmediate(resolve));
            await new Promise(resolve => setTimeout(resolve, 50));

            // Should not throw - errors are caught by the .catch() handler
        });

        it('should handle outer endTurn error', async () => {
            gameService.getGame.mockResolvedValue({ gameOver: false });
            gameService.endTurn.mockRejectedValue(new Error('endTurn failed'));

            await callback('ROOM01');

            // Should not throw - outer try/catch handles it
            expect(emitToRoom).not.toHaveBeenCalled();
        });
    });

    describe('handleDisconnect', () => {
        let mockIo: any;
        let mockSocket: any;

        beforeEach(() => {
            mockIo = {
                to: jest.fn().mockReturnValue({ emit: jest.fn() })
            };
            mockSocket = {
                id: 'socket-1',
                sessionId: 'session-1'
            };
        });

        it('should return early when player not found', async () => {
            playerService.getPlayer.mockResolvedValue(null);

            await handleDisconnect(mockIo, mockSocket, 'transport close');

            expect(playerService.handleDisconnect).not.toHaveBeenCalled();
        });

        it('should handle disconnect for player without roomCode', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-1',
                roomCode: null,
                isHost: false
            });
            playerService.handleDisconnect.mockResolvedValue(undefined);
            playerService.generateReconnectionToken.mockResolvedValue('token');

            await handleDisconnect(mockIo, mockSocket, 'transport close');

            expect(playerService.handleDisconnect).toHaveBeenCalledWith('session-1');
            expect(safeEmitToRoom).not.toHaveBeenCalled();
        });

        it('should notify room and broadcast stats on disconnect', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-1',
                roomCode: 'ROOM01',
                nickname: 'TestPlayer',
                team: 'red',
                isHost: false
            });
            playerService.handleDisconnect.mockResolvedValue(undefined);
            playerService.generateReconnectionToken.mockResolvedValue('token-abc');
            playerService.getPlayersInRoom.mockResolvedValue([]);
            playerService.getRoomStats.mockResolvedValue({ totalPlayers: 0 });
            eventLogService.logEvent.mockResolvedValue(undefined);

            await handleDisconnect(mockIo, mockSocket, 'transport close');

            expect(safeEmitToRoom).toHaveBeenCalledWith(
                mockIo, 'ROOM01', 'player:disconnected',
                expect.objectContaining({
                    sessionId: 'session-1',
                    nickname: 'TestPlayer',
                    reconnecting: true
                })
            );
            expect(safeEmitToRoom).toHaveBeenCalledWith(
                mockIo, 'ROOM01', 'room:statsUpdated',
                expect.objectContaining({ stats: expect.any(Object) })
            );
        });

        it('should handle abortSignal aborting before room notification', async () => {
            const abortController = new AbortController();
            abortController.abort(); // Abort immediately

            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-1',
                roomCode: 'ROOM01',
                isHost: false
            });
            playerService.handleDisconnect.mockResolvedValue(undefined);
            playerService.generateReconnectionToken.mockResolvedValue('token');

            await handleDisconnect(mockIo, mockSocket, 'transport close', abortController.signal);

            expect(playerService.handleDisconnect).toHaveBeenCalled();
            // Should return early before room notifications
            expect(safeEmitToRoom).not.toHaveBeenCalled();
        });

        it('should handle abortSignal aborting before host transfer', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-1',
                roomCode: 'ROOM01',
                nickname: 'TestPlayer',
                team: 'red',
                isHost: true
            });
            playerService.handleDisconnect.mockResolvedValue(undefined);
            playerService.generateReconnectionToken.mockResolvedValue('token');
            playerService.getPlayersInRoom.mockResolvedValue([]);
            playerService.getRoomStats.mockResolvedValue({});
            eventLogService.logEvent.mockResolvedValue(undefined);

            // Create abort signal that aborts after handleDisconnect and room notifications
            const abortController = new AbortController();

            // Override getPlayersInRoom to abort before host transfer check
            const originalGetPlayersInRoom = playerService.getPlayersInRoom;
            playerService.getPlayersInRoom.mockImplementation(async () => {
                // After room notification stuff completes, abort
                abortController.abort();
                return [];
            });

            await handleDisconnect(mockIo, mockSocket, 'transport close', abortController.signal);

            // Should have done room notifications but skipped host transfer
            expect(safeEmitToRoom).toHaveBeenCalled();
        });

        it('should handle reconnection token generation failure', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-1',
                roomCode: 'ROOM01',
                nickname: 'TestPlayer',
                team: 'red',
                isHost: false
            });
            playerService.handleDisconnect.mockResolvedValue(undefined);
            playerService.generateReconnectionToken.mockRejectedValue(new Error('Token gen failed'));
            playerService.getPlayersInRoom.mockResolvedValue([]);
            playerService.getRoomStats.mockResolvedValue({});
            eventLogService.logEvent.mockResolvedValue(undefined);

            await handleDisconnect(mockIo, mockSocket, 'transport close');

            // Should still complete disconnect - token failure is non-fatal
            expect(playerService.handleDisconnect).toHaveBeenCalled();
            expect(safeEmitToRoom).toHaveBeenCalledWith(
                mockIo, 'ROOM01', 'player:disconnected',
                expect.objectContaining({ reconnecting: false })
            );
        });

        it('should handle eventLog failure for disconnect event', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-1',
                roomCode: 'ROOM01',
                nickname: 'TestPlayer',
                team: 'red',
                isHost: false
            });
            playerService.handleDisconnect.mockResolvedValue(undefined);
            playerService.generateReconnectionToken.mockResolvedValue('token');
            playerService.getPlayersInRoom.mockResolvedValue([]);
            playerService.getRoomStats.mockResolvedValue({});
            eventLogService.logEvent.mockRejectedValue(new Error('Log failed'));

            await handleDisconnect(mockIo, mockSocket, 'transport close');

            // Should not throw - eventLog errors are caught
            expect(safeEmitToRoom).toHaveBeenCalled();
        });

        it('should skip host transfer when lock not acquired', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-1',
                roomCode: 'ROOM01',
                nickname: 'TestPlayer',
                team: 'red',
                isHost: true
            });
            playerService.handleDisconnect.mockResolvedValue(undefined);
            playerService.generateReconnectionToken.mockResolvedValue('token');
            playerService.getPlayersInRoom.mockResolvedValue([]);
            playerService.getRoomStats.mockResolvedValue({});
            eventLogService.logEvent.mockResolvedValue(undefined);

            const mockRedis = {
                set: jest.fn().mockResolvedValue(null), // lock not acquired
                eval: jest.fn()
            };
            getRedis.mockReturnValue(mockRedis);

            await handleDisconnect(mockIo, mockSocket, 'transport close');

            expect(playerService.atomicHostTransfer).not.toHaveBeenCalled();
        });

        it('should skip host transfer when host reconnected', async () => {
            playerService.getPlayer
                .mockResolvedValueOnce({
                    sessionId: 'session-1',
                    roomCode: 'ROOM01',
                    nickname: 'TestPlayer',
                    team: 'red',
                    isHost: true
                })
                .mockResolvedValueOnce({
                    sessionId: 'session-1',
                    connected: true // host reconnected
                });
            playerService.handleDisconnect.mockResolvedValue(undefined);
            playerService.generateReconnectionToken.mockResolvedValue('token');
            playerService.getPlayersInRoom.mockResolvedValue([]);
            playerService.getRoomStats.mockResolvedValue({});
            eventLogService.logEvent.mockResolvedValue(undefined);

            const mockRedis = {
                set: jest.fn().mockResolvedValue('OK'),
                eval: jest.fn().mockResolvedValue(1)
            };
            getRedis.mockReturnValue(mockRedis);

            await handleDisconnect(mockIo, mockSocket, 'transport close');

            expect(playerService.atomicHostTransfer).not.toHaveBeenCalled();
        });

        it('should handle no connected players for host transfer', async () => {
            playerService.getPlayer
                .mockResolvedValueOnce({
                    sessionId: 'session-1',
                    roomCode: 'ROOM01',
                    nickname: 'TestPlayer',
                    team: 'red',
                    isHost: true
                })
                .mockResolvedValueOnce({
                    sessionId: 'session-1',
                    connected: false
                });
            playerService.handleDisconnect.mockResolvedValue(undefined);
            playerService.generateReconnectionToken.mockResolvedValue('token');
            playerService.getPlayersInRoom
                .mockResolvedValueOnce([]) // for disconnect notification
                .mockResolvedValueOnce([]); // for host transfer - no connected players
            playerService.getRoomStats.mockResolvedValue({});
            eventLogService.logEvent.mockResolvedValue(undefined);

            const mockRedis = {
                set: jest.fn().mockResolvedValue('OK'),
                eval: jest.fn().mockResolvedValue(1)
            };
            getRedis.mockReturnValue(mockRedis);

            await handleDisconnect(mockIo, mockSocket, 'transport close');

            expect(playerService.atomicHostTransfer).not.toHaveBeenCalled();
        });

        it('should handle null players for host transfer', async () => {
            playerService.getPlayer
                .mockResolvedValueOnce({
                    sessionId: 'session-1',
                    roomCode: 'ROOM01',
                    nickname: 'TestPlayer',
                    team: 'red',
                    isHost: true
                })
                .mockResolvedValueOnce({
                    sessionId: 'session-1',
                    connected: false
                });
            playerService.handleDisconnect.mockResolvedValue(undefined);
            playerService.generateReconnectionToken.mockResolvedValue('token');
            playerService.getPlayersInRoom
                .mockResolvedValueOnce([]) // for disconnect notification
                .mockResolvedValueOnce(null); // null players
            playerService.getRoomStats.mockResolvedValue({});
            eventLogService.logEvent.mockResolvedValue(undefined);

            const mockRedis = {
                set: jest.fn().mockResolvedValue('OK'),
                eval: jest.fn().mockResolvedValue(1)
            };
            getRedis.mockReturnValue(mockRedis);

            await handleDisconnect(mockIo, mockSocket, 'transport close');

            // Should warn but not throw
            expect(playerService.atomicHostTransfer).not.toHaveBeenCalled();
        });

        it('should perform host transfer successfully', async () => {
            playerService.getPlayer
                .mockResolvedValueOnce({
                    sessionId: 'session-1',
                    roomCode: 'ROOM01',
                    nickname: 'Host',
                    team: 'red',
                    isHost: true
                })
                .mockResolvedValueOnce({
                    sessionId: 'session-1',
                    connected: false
                });
            playerService.handleDisconnect.mockResolvedValue(undefined);
            playerService.generateReconnectionToken.mockResolvedValue('token');
            playerService.getPlayersInRoom
                .mockResolvedValueOnce([]) // for disconnect notification
                .mockResolvedValueOnce([
                    { sessionId: 'session-1', connected: false },
                    { sessionId: 'session-2', connected: true, nickname: 'NewHost' }
                ]);
            playerService.getRoomStats.mockResolvedValue({});
            playerService.atomicHostTransfer.mockResolvedValue({ success: true });
            eventLogService.logEvent.mockResolvedValue(undefined);

            const mockRedis = {
                set: jest.fn().mockResolvedValue('OK'),
                eval: jest.fn().mockResolvedValue(1)
            };
            getRedis.mockReturnValue(mockRedis);

            await handleDisconnect(mockIo, mockSocket, 'transport close');

            expect(playerService.atomicHostTransfer).toHaveBeenCalledWith(
                'session-1', 'session-2', 'ROOM01'
            );
            expect(safeEmitToRoom).toHaveBeenCalledWith(
                mockIo, 'ROOM01', 'room:hostChanged',
                expect.objectContaining({
                    newHostSessionId: 'session-2',
                    newHostNickname: 'NewHost'
                })
            );
        });

        it('should handle atomicHostTransfer failure', async () => {
            playerService.getPlayer
                .mockResolvedValueOnce({
                    sessionId: 'session-1',
                    roomCode: 'ROOM01',
                    nickname: 'Host',
                    team: 'red',
                    isHost: true
                })
                .mockResolvedValueOnce({
                    sessionId: 'session-1',
                    connected: false
                });
            playerService.handleDisconnect.mockResolvedValue(undefined);
            playerService.generateReconnectionToken.mockResolvedValue('token');
            playerService.getPlayersInRoom
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([
                    { sessionId: 'session-1', connected: false },
                    { sessionId: 'session-2', connected: true, nickname: 'NewHost' }
                ]);
            playerService.getRoomStats.mockResolvedValue({});
            playerService.atomicHostTransfer.mockResolvedValue({
                success: false,
                reason: 'Concurrent modification'
            });
            eventLogService.logEvent.mockResolvedValue(undefined);

            const mockRedis = {
                set: jest.fn().mockResolvedValue('OK'),
                eval: jest.fn().mockResolvedValue(1)
            };
            getRedis.mockReturnValue(mockRedis);

            await handleDisconnect(mockIo, mockSocket, 'transport close');

            // Should not emit host changed
            expect(safeEmitToRoom).not.toHaveBeenCalledWith(
                expect.anything(), expect.anything(), 'room:hostChanged', expect.anything()
            );
        });

        it('should handle host transfer lock release failure', async () => {
            playerService.getPlayer
                .mockResolvedValueOnce({
                    sessionId: 'session-1',
                    roomCode: 'ROOM01',
                    nickname: 'Host',
                    team: 'red',
                    isHost: true
                })
                .mockResolvedValueOnce({
                    sessionId: 'session-1',
                    connected: false
                });
            playerService.handleDisconnect.mockResolvedValue(undefined);
            playerService.generateReconnectionToken.mockResolvedValue('token');
            playerService.getPlayersInRoom
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([
                    { sessionId: 'session-2', connected: true, nickname: 'NewHost' }
                ]);
            playerService.getRoomStats.mockResolvedValue({});
            playerService.atomicHostTransfer.mockResolvedValue({ success: true });
            eventLogService.logEvent.mockResolvedValue(undefined);

            const mockRedis = {
                set: jest.fn().mockResolvedValue('OK'),
                eval: jest.fn().mockRejectedValue(new Error('Lock release failed'))
            };
            getRedis.mockReturnValue(mockRedis);

            await handleDisconnect(mockIo, mockSocket, 'transport close');

            // Should not throw - lock release errors are caught
            expect(playerService.atomicHostTransfer).toHaveBeenCalled();
        });

        it('should handle host transfer error', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-1',
                roomCode: 'ROOM01',
                nickname: 'Host',
                team: 'red',
                isHost: true
            });
            playerService.handleDisconnect.mockResolvedValue(undefined);
            playerService.generateReconnectionToken.mockResolvedValue('token');
            playerService.getPlayersInRoom.mockResolvedValue([]);
            playerService.getRoomStats.mockResolvedValue({});
            eventLogService.logEvent.mockResolvedValue(undefined);

            const mockRedis = {
                set: jest.fn().mockRejectedValue(new Error('Redis error')),
                eval: jest.fn()
            };
            getRedis.mockReturnValue(mockRedis);

            await handleDisconnect(mockIo, mockSocket, 'transport close');

            // Should not throw - host transfer errors are caught
        });

        it('should handle eventLog failure for host change', async () => {
            playerService.getPlayer
                .mockResolvedValueOnce({
                    sessionId: 'session-1',
                    roomCode: 'ROOM01',
                    nickname: 'Host',
                    team: 'red',
                    isHost: true
                })
                .mockResolvedValueOnce({
                    sessionId: 'session-1',
                    connected: false
                });
            playerService.handleDisconnect.mockResolvedValue(undefined);
            playerService.generateReconnectionToken.mockResolvedValue('token');
            playerService.getPlayersInRoom
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([
                    { sessionId: 'session-2', connected: true, nickname: 'NewHost' }
                ]);
            playerService.getRoomStats.mockResolvedValue({});
            playerService.atomicHostTransfer.mockResolvedValue({ success: true });
            eventLogService.logEvent
                .mockResolvedValueOnce(undefined) // disconnect event
                .mockRejectedValueOnce(new Error('Log failed')); // host change event

            const mockRedis = {
                set: jest.fn().mockResolvedValue('OK'),
                eval: jest.fn().mockResolvedValue(1)
            };
            getRedis.mockReturnValue(mockRedis);

            await handleDisconnect(mockIo, mockSocket, 'transport close');

            // Should not throw - eventLog errors are caught
            expect(playerService.atomicHostTransfer).toHaveBeenCalled();
        });

        it('should handle general disconnect error', async () => {
            playerService.getPlayer.mockRejectedValue(new Error('General error'));

            await handleDisconnect(mockIo, mockSocket, 'transport close');

            // Should not throw - outer try/catch handles it
        });
    });
});
