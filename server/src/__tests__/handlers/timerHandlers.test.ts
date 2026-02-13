/**
 * Timer Handlers Tests
 * Tests for timer:pause, timer:resume, timer:addTime, timer:stop events
 */

// Mock dependencies before imports
jest.mock('../../services/playerService');
jest.mock('../../services/roomService');
jest.mock('../../services/timerService');
jest.mock('../../services/gameService');
jest.mock('../../socket/socketFunctionProvider');
const SAFE_ERROR_CODES_MOCK = ['RATE_LIMITED', 'ROOM_NOT_FOUND', 'ROOM_FULL', 'NOT_HOST', 'NOT_YOUR_TURN', 'GAME_OVER', 'INVALID_INPUT', 'CARD_ALREADY_REVEALED', 'NOT_SPYMASTER', 'NOT_CLICKER', 'NOT_AUTHORIZED', 'SESSION_EXPIRED', 'PLAYER_NOT_FOUND', 'GAME_IN_PROGRESS', 'NO_CLUE', 'CANNOT_SWITCH_TEAM_DURING_TURN', 'CANNOT_CHANGE_ROLE_DURING_TURN', 'SPYMASTER_CANNOT_CHANGE_TEAM', 'GAME_NOT_STARTED'];
jest.mock('../../socket/rateLimitHandler', () => ({
    createRateLimitedHandler: (socket, eventName, handler) => { return async (data) => { try { return await handler(data); } catch (error) { const errorEvent = `${eventName.split(':')[0]}:error`; const code = error.code || 'SERVER_ERROR'; const isSafe = SAFE_ERROR_CODES_MOCK.includes(code); socket.emit(errorEvent, { code, message: isSafe ? (error.message || 'An unexpected error occurred') : 'An unexpected error occurred' }); } }; },
    socketRateLimiter: { getLimiter: jest.fn() }
}));

const playerService = require('../../services/playerService');
const _roomService = require('../../services/roomService');
const timerService = require('../../services/timerService');
const gameService = require('../../services/gameService');
const { getSocketFunctions } = require('../../socket/socketFunctionProvider');
const timerHandlers = require('../../socket/handlers/timerHandlers');
const { ERROR_CODES } = require('../../config/constants');

describe('Timer Handlers', () => {
    let mockSocket;
    let mockIo;

    beforeEach(() => {
        jest.clearAllMocks();

        // Create mock socket
        mockSocket = {
            id: 'test-socket-id',
            sessionId: 'test-session-id',
            roomCode: 'TEST01',
            emit: jest.fn(),
            on: jest.fn((event, handler) => {
                // Store handlers for testing
                if (!mockSocket._handlers) mockSocket._handlers = {};
                mockSocket._handlers[event] = handler;
            }),
            join: jest.fn(),
            leave: jest.fn(),
            _handlers: {}
        };

        // Create mock io
        mockIo = {
            to: jest.fn().mockReturnThis(),
            emit: jest.fn()
        };

        // Setup default mocks
        getSocketFunctions.mockReturnValue({
            startTurnTimer: jest.fn(),
            createTimerExpireCallback: jest.fn(() => jest.fn())
        });

        // Default player mock with roomCode for context handler
        playerService.getPlayer.mockResolvedValue({
            sessionId: 'test-session-id',
            roomCode: 'TEST01',
            isHost: true,
            nickname: 'HostPlayer'
        });
        gameService.getGame.mockResolvedValue({
            currentTurn: 'red',
            gameOver: false
        });

        // Register handlers
        timerHandlers(mockIo, mockSocket);
    });

    describe('timer:pause', () => {
        it('should reject when not in a room', async () => {
            mockSocket.roomCode = null;
            playerService.getPlayer.mockResolvedValue(null);

            const handler = mockSocket._handlers['timer:pause'];
            await handler();

            expect(mockSocket.emit).toHaveBeenCalledWith('timer:error', {
                code: ERROR_CODES.ROOM_NOT_FOUND,
                message: 'You must be in a room to perform this action'
            });
        });

        it('should reject when player is not host', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'test-session-id',
                roomCode: 'TEST01',
                isHost: false,
                nickname: 'TestPlayer'
            });

            const handler = mockSocket._handlers['timer:pause'];
            await handler();

            expect(mockSocket.emit).toHaveBeenCalledWith('timer:error', expect.objectContaining({
                code: 'NOT_HOST'
            }));
        });

        it('should pause timer successfully when host', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'test-session-id',
                roomCode: 'TEST01',
                isHost: true,
                nickname: 'HostPlayer'
            });

            timerService.pauseTimer.mockResolvedValue({
                remainingSeconds: 45
            });

            const handler = mockSocket._handlers['timer:pause'];
            await handler();

            expect(timerService.pauseTimer).toHaveBeenCalledWith('TEST01');
            expect(mockIo.to).toHaveBeenCalledWith('room:TEST01');
            expect(mockIo.emit).toHaveBeenCalledWith('timer:paused', expect.objectContaining({
                roomCode: 'TEST01',
                remainingSeconds: 45
            }));
        });

        it('should emit error when no active timer', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'test-session-id',
                roomCode: 'TEST01',
                isHost: true,
                nickname: 'HostPlayer'
            });

            timerService.pauseTimer.mockResolvedValue(null);

            const handler = mockSocket._handlers['timer:pause'];
            await handler();

            // Note: SERVER_ERROR is not in SAFE_ERROR_CODES, so message is sanitized
            expect(mockSocket.emit).toHaveBeenCalledWith('timer:error', {
                code: ERROR_CODES.SERVER_ERROR,
                message: 'An unexpected error occurred'
            });
        });

        it('should handle service errors gracefully', async () => {
            playerService.getPlayer.mockRejectedValue(new Error('Database error'));

            const handler = mockSocket._handlers['timer:pause'];
            await handler();

            expect(mockSocket.emit).toHaveBeenCalledWith('timer:error', expect.objectContaining({
                code: ERROR_CODES.SERVER_ERROR
            }));
        });
    });

    describe('timer:resume', () => {
        it('should reject when not in a room', async () => {
            mockSocket.roomCode = null;
            playerService.getPlayer.mockResolvedValue(null);

            const handler = mockSocket._handlers['timer:resume'];
            await handler();

            expect(mockSocket.emit).toHaveBeenCalledWith('timer:error', {
                code: ERROR_CODES.ROOM_NOT_FOUND,
                message: 'You must be in a room to perform this action'
            });
        });

        it('should reject when player is not host', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'test-session-id',
                roomCode: 'TEST01',
                isHost: false,
                nickname: 'TestPlayer'
            });

            const handler = mockSocket._handlers['timer:resume'];
            await handler();

            expect(mockSocket.emit).toHaveBeenCalledWith('timer:error', expect.objectContaining({
                code: 'NOT_HOST'
            }));
        });

        it('should resume timer successfully when host', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'test-session-id',
                roomCode: 'TEST01',
                isHost: true,
                nickname: 'HostPlayer'
            });

            const endTime = Date.now() + 45000;
            timerService.resumeTimer.mockResolvedValue({
                remainingSeconds: 45,
                endTime: endTime
            });

            const handler = mockSocket._handlers['timer:resume'];
            await handler();

            expect(timerService.resumeTimer).toHaveBeenCalledWith('TEST01', expect.any(Function));
            expect(mockIo.to).toHaveBeenCalledWith('room:TEST01');
            expect(mockIo.emit).toHaveBeenCalledWith('timer:resumed', expect.objectContaining({
                roomCode: 'TEST01',
                remainingSeconds: 45,
                endTime: endTime
            }));
        });

        it('should emit error when no paused timer', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'test-session-id',
                roomCode: 'TEST01',
                isHost: true,
                nickname: 'HostPlayer'
            });

            timerService.resumeTimer.mockResolvedValue(null);

            const handler = mockSocket._handlers['timer:resume'];
            await handler();

            // Note: SERVER_ERROR is not in SAFE_ERROR_CODES, so message is sanitized
            expect(mockSocket.emit).toHaveBeenCalledWith('timer:error', {
                code: ERROR_CODES.SERVER_ERROR,
                message: 'An unexpected error occurred'
            });
        });

        it('should pass createTimerExpireCallback result to resumeTimer', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'test-session-id',
                roomCode: 'TEST01',
                isHost: true,
                nickname: 'HostPlayer'
            });

            const mockExpireCallback = jest.fn();
            getSocketFunctions.mockReturnValue({
                startTurnTimer: jest.fn(),
                createTimerExpireCallback: jest.fn(() => mockExpireCallback)
            });

            timerService.resumeTimer.mockResolvedValue({
                remainingSeconds: 45,
                endTime: Date.now() + 45000
            });

            const handler = mockSocket._handlers['timer:resume'];
            await handler();

            // Verify createTimerExpireCallback was called and its result passed to resumeTimer
            expect(getSocketFunctions().createTimerExpireCallback).toHaveBeenCalled;
            expect(timerService.resumeTimer).toHaveBeenCalledWith('TEST01', mockExpireCallback);
        });
    });

    describe('timer:addTime', () => {
        it('should reject when not in a room', async () => {
            mockSocket.roomCode = null;
            playerService.getPlayer.mockResolvedValue(null);

            const handler = mockSocket._handlers['timer:addTime'];
            await handler({ seconds: 30 });

            expect(mockSocket.emit).toHaveBeenCalledWith('timer:error', {
                code: ERROR_CODES.ROOM_NOT_FOUND,
                message: 'You must be in a room to perform this action'
            });
        });

        it('should reject when player is not host', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'test-session-id',
                roomCode: 'TEST01',
                isHost: false,
                nickname: 'TestPlayer'
            });

            const handler = mockSocket._handlers['timer:addTime'];
            await handler({ seconds: 30 });

            expect(mockSocket.emit).toHaveBeenCalledWith('timer:error', expect.objectContaining({
                code: 'NOT_HOST'
            }));
        });

        it('should add time successfully when host', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'test-session-id',
                roomCode: 'TEST01',
                isHost: true,
                nickname: 'HostPlayer'
            });

            const endTime = Date.now() + 75000;
            timerService.addTime.mockResolvedValue({
                remainingSeconds: 75,
                endTime: endTime
            });

            const handler = mockSocket._handlers['timer:addTime'];
            await handler({ seconds: 30 });

            expect(timerService.addTime).toHaveBeenCalledWith('TEST01', 30, expect.any(Function));
            expect(mockIo.to).toHaveBeenCalledWith('room:TEST01');
            expect(mockIo.emit).toHaveBeenCalledWith('timer:timeAdded', expect.objectContaining({
                roomCode: 'TEST01',
                secondsAdded: 30,
                newEndTime: endTime,
                remainingSeconds: 75
            }));
        });

        it('should reject invalid seconds (too low)', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'test-session-id',
                roomCode: 'TEST01',
                isHost: true,
                nickname: 'HostPlayer'
            });

            const handler = mockSocket._handlers['timer:addTime'];
            await handler({ seconds: 5 });

            expect(mockSocket.emit).toHaveBeenCalledWith('timer:error', expect.objectContaining({
                message: expect.stringContaining('10 seconds')
            }));
        });

        it('should reject invalid seconds (too high)', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'test-session-id',
                roomCode: 'TEST01',
                isHost: true,
                nickname: 'HostPlayer'
            });

            const handler = mockSocket._handlers['timer:addTime'];
            await handler({ seconds: 500 });

            expect(mockSocket.emit).toHaveBeenCalledWith('timer:error', expect.objectContaining({
                message: expect.stringContaining('5 minutes')
            }));
        });

        it('should emit error when no active timer', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'test-session-id',
                roomCode: 'TEST01',
                isHost: true,
                nickname: 'HostPlayer'
            });

            timerService.addTime.mockResolvedValue(null);

            const handler = mockSocket._handlers['timer:addTime'];
            await handler({ seconds: 30 });

            // Note: SERVER_ERROR is not in SAFE_ERROR_CODES, so message is sanitized
            expect(mockSocket.emit).toHaveBeenCalledWith('timer:error', {
                code: ERROR_CODES.SERVER_ERROR,
                message: 'An unexpected error occurred'
            });
        });
    });

    describe('timer:stop', () => {
        it('should reject when not in a room', async () => {
            mockSocket.roomCode = null;
            playerService.getPlayer.mockResolvedValue(null);

            const handler = mockSocket._handlers['timer:stop'];
            await handler();

            expect(mockSocket.emit).toHaveBeenCalledWith('timer:error', {
                code: ERROR_CODES.ROOM_NOT_FOUND,
                message: 'You must be in a room to perform this action'
            });
        });

        it('should reject when player is not host', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'test-session-id',
                roomCode: 'TEST01',
                isHost: false,
                nickname: 'TestPlayer'
            });

            const handler = mockSocket._handlers['timer:stop'];
            await handler();

            expect(mockSocket.emit).toHaveBeenCalledWith('timer:error', expect.objectContaining({
                code: 'NOT_HOST'
            }));
        });

        it('should stop timer successfully when host', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'test-session-id',
                roomCode: 'TEST01',
                isHost: true,
                nickname: 'HostPlayer'
            });

            timerService.stopTimer.mockResolvedValue(undefined);

            const handler = mockSocket._handlers['timer:stop'];
            await handler();

            expect(timerService.stopTimer).toHaveBeenCalledWith('TEST01');
            expect(mockIo.to).toHaveBeenCalledWith('room:TEST01');
            expect(mockIo.emit).toHaveBeenCalledWith('timer:stopped', expect.objectContaining({
                roomCode: 'TEST01'
            }));
        });

        it('should handle service errors gracefully', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'test-session-id',
                roomCode: 'TEST01',
                isHost: true,
                nickname: 'HostPlayer'
            });

            timerService.stopTimer.mockRejectedValue(new Error('Redis error'));

            const handler = mockSocket._handlers['timer:stop'];
            await handler();

            expect(mockSocket.emit).toHaveBeenCalledWith('timer:error', expect.objectContaining({
                code: ERROR_CODES.SERVER_ERROR
            }));
        });
    });

    describe('player not found scenarios', () => {
        it('should handle null player on pause', async () => {
            playerService.getPlayer.mockResolvedValue(null);

            const handler = mockSocket._handlers['timer:pause'];
            await handler();

            expect(mockSocket.emit).toHaveBeenCalledWith('timer:error', expect.objectContaining({
                code: ERROR_CODES.ROOM_NOT_FOUND
            }));
        });

        it('should handle null player on resume', async () => {
            playerService.getPlayer.mockResolvedValue(null);

            const handler = mockSocket._handlers['timer:resume'];
            await handler();

            expect(mockSocket.emit).toHaveBeenCalledWith('timer:error', expect.objectContaining({
                code: ERROR_CODES.ROOM_NOT_FOUND
            }));
        });

        it('should handle null player on addTime', async () => {
            playerService.getPlayer.mockResolvedValue(null);

            const handler = mockSocket._handlers['timer:addTime'];
            await handler({ seconds: 30 });

            expect(mockSocket.emit).toHaveBeenCalledWith('timer:error', expect.objectContaining({
                code: ERROR_CODES.ROOM_NOT_FOUND
            }));
        });

        it('should handle null player on stop', async () => {
            playerService.getPlayer.mockResolvedValue(null);

            const handler = mockSocket._handlers['timer:stop'];
            await handler();

            expect(mockSocket.emit).toHaveBeenCalledWith('timer:error', expect.objectContaining({
                code: ERROR_CODES.ROOM_NOT_FOUND
            }));
        });
    });
});
