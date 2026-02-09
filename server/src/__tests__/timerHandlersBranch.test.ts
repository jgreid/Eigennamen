/**
 * Timer Handlers Branch Coverage Tests
 * Covers: game null / gameOver branches (lines 69, 95, 122, 150)
 */

jest.mock('../services/playerService');
jest.mock('../services/roomService');
jest.mock('../services/timerService');
jest.mock('../services/gameService');
jest.mock('../socket/socketFunctionProvider');
const SAFE_ERROR_CODES_MOCK = ['RATE_LIMITED', 'ROOM_NOT_FOUND', 'ROOM_FULL', 'NOT_HOST', 'NOT_YOUR_TURN', 'GAME_OVER', 'INVALID_INPUT', 'CARD_ALREADY_REVEALED', 'NOT_SPYMASTER', 'NOT_CLICKER', 'NOT_AUTHORIZED', 'SESSION_EXPIRED', 'PLAYER_NOT_FOUND', 'GAME_IN_PROGRESS', 'VALIDATION_ERROR', 'CANNOT_SWITCH_TEAM_DURING_TURN', 'CANNOT_CHANGE_ROLE_DURING_TURN', 'SPYMASTER_CANNOT_CHANGE_TEAM', 'GAME_NOT_STARTED'];
jest.mock('../socket/rateLimitHandler', () => ({
    createRateLimitedHandler: (socket: any, eventName: string, handler: any) => {
        return async (data: any) => {
            try { return await handler(data); } catch (error: any) {
                const errorEvent = `${eventName.split(':')[0]}:error`;
                const code = error.code || 'SERVER_ERROR';
                const isSafe = SAFE_ERROR_CODES_MOCK.includes(code);
                socket.emit(errorEvent, { code, message: isSafe ? (error.message || 'An unexpected error occurred') : 'An unexpected error occurred' });
            }
        };
    },
    socketRateLimiter: { getLimiter: jest.fn() }
}));

const playerService = require('../services/playerService');
const gameService = require('../services/gameService');
const { getSocketFunctions } = require('../socket/socketFunctionProvider');
const timerHandlers = require('../socket/handlers/timerHandlers');
const { ERROR_CODES } = require('../config/constants');

describe('Timer Handlers Branch Coverage', () => {
    let mockSocket: any;
    let mockIo: any;

    beforeEach(() => {
        jest.clearAllMocks();
        mockSocket = {
            id: 'test-socket-id',
            sessionId: 'test-session-id',
            roomCode: 'TEST01',
            emit: jest.fn(),
            on: jest.fn((event: string, handler: any) => {
                if (!mockSocket._handlers) mockSocket._handlers = {};
                mockSocket._handlers[event] = handler;
            }),
            join: jest.fn(),
            leave: jest.fn(),
            _handlers: {} as Record<string, any>
        };
        mockIo = { to: jest.fn().mockReturnThis(), emit: jest.fn() };

        getSocketFunctions.mockReturnValue({
            startTurnTimer: jest.fn(),
            createTimerExpireCallback: jest.fn(() => jest.fn())
        });

        playerService.getPlayer.mockResolvedValue({
            sessionId: 'test-session-id',
            roomCode: 'TEST01',
            isHost: true,
            nickname: 'HostPlayer'
        });

        timerHandlers(mockIo, mockSocket);
    });

    describe('timer:pause - game null/gameOver branches', () => {
        it('should throw GAME_NOT_STARTED when game is null', async () => {
            gameService.getGame.mockResolvedValue(null);
            const handler = mockSocket._handlers['timer:pause'];
            await handler();
            expect(mockSocket.emit).toHaveBeenCalledWith('timer:error', expect.objectContaining({
                code: 'GAME_NOT_STARTED'
            }));
        });

        it('should throw GAME_NOT_STARTED when game is over', async () => {
            gameService.getGame.mockResolvedValue({ gameOver: true });
            const handler = mockSocket._handlers['timer:pause'];
            await handler();
            expect(mockSocket.emit).toHaveBeenCalledWith('timer:error', expect.objectContaining({
                code: 'GAME_NOT_STARTED'
            }));
        });
    });

    describe('timer:resume - game null/gameOver branches', () => {
        it('should throw GAME_NOT_STARTED when game is null', async () => {
            gameService.getGame.mockResolvedValue(null);
            const handler = mockSocket._handlers['timer:resume'];
            await handler();
            expect(mockSocket.emit).toHaveBeenCalledWith('timer:error', expect.objectContaining({
                code: 'GAME_NOT_STARTED'
            }));
        });

        it('should throw GAME_NOT_STARTED when game is over', async () => {
            gameService.getGame.mockResolvedValue({ gameOver: true });
            const handler = mockSocket._handlers['timer:resume'];
            await handler();
            expect(mockSocket.emit).toHaveBeenCalledWith('timer:error', expect.objectContaining({
                code: 'GAME_NOT_STARTED'
            }));
        });
    });

    describe('timer:addTime - game null/gameOver branches', () => {
        it('should throw GAME_NOT_STARTED when game is null', async () => {
            gameService.getGame.mockResolvedValue(null);
            const handler = mockSocket._handlers['timer:addTime'];
            await handler({ seconds: 30 });
            expect(mockSocket.emit).toHaveBeenCalledWith('timer:error', expect.objectContaining({
                code: 'GAME_NOT_STARTED'
            }));
        });

        it('should throw GAME_NOT_STARTED when game is over', async () => {
            gameService.getGame.mockResolvedValue({ gameOver: true });
            const handler = mockSocket._handlers['timer:addTime'];
            await handler({ seconds: 30 });
            expect(mockSocket.emit).toHaveBeenCalledWith('timer:error', expect.objectContaining({
                code: 'GAME_NOT_STARTED'
            }));
        });
    });

    describe('timer:stop - game null/gameOver branches', () => {
        it('should throw GAME_NOT_STARTED when game is null', async () => {
            gameService.getGame.mockResolvedValue(null);
            const handler = mockSocket._handlers['timer:stop'];
            await handler();
            expect(mockSocket.emit).toHaveBeenCalledWith('timer:error', expect.objectContaining({
                code: 'GAME_NOT_STARTED'
            }));
        });

        it('should throw GAME_NOT_STARTED when game is over', async () => {
            gameService.getGame.mockResolvedValue({ gameOver: true });
            const handler = mockSocket._handlers['timer:stop'];
            await handler();
            expect(mockSocket.emit).toHaveBeenCalledWith('timer:error', expect.objectContaining({
                code: 'GAME_NOT_STARTED'
            }));
        });
    });
});
