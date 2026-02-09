/**
 * Chat Handlers Branch Coverage Tests
 *
 * Tests additional branches in chatHandlers.ts including:
 * - spectatorOnly messages: validation, broadcast via spectator room
 * - spectatorOnly with non-spectator role (rejection)
 * - teamOnly when getTeamMembers returns null/non-array
 * - chat:spectator handler: role validation, emit error
 * - spectator chat emit error handling
 */

// Mock rate limit handler to bypass rate limiting
const SAFE_ERROR_CODES_MOCK = ['RATE_LIMITED', 'ROOM_NOT_FOUND', 'ROOM_FULL', 'NOT_HOST', 'NOT_YOUR_TURN', 'GAME_OVER', 'INVALID_INPUT', 'CARD_ALREADY_REVEALED', 'NOT_SPYMASTER', 'NOT_CLICKER', 'NOT_AUTHORIZED', 'SESSION_EXPIRED', 'PLAYER_NOT_FOUND', 'GAME_IN_PROGRESS', 'VALIDATION_ERROR', 'CANNOT_SWITCH_TEAM_DURING_TURN', 'CANNOT_CHANGE_ROLE_DURING_TURN', 'SPYMASTER_CANNOT_CHANGE_TEAM', 'GAME_NOT_STARTED'];
jest.mock('../socket/rateLimitHandler', () => ({
    createRateLimitedHandler: jest.fn((socket: any, eventName: string, handler: any) => {
        return async (data: any) => {
            try {
                return await handler(data);
            } catch (error: any) {
                const errorEvent = `${eventName.split(':')[0]}:error`;
                const code = error.code || 'SERVER_ERROR';
                const isSafe = SAFE_ERROR_CODES_MOCK.includes(code);
                socket.emit(errorEvent, {
                    code,
                    message: isSafe ? (error.message || 'An unexpected error occurred') : 'An unexpected error occurred'
                });
            }
        };
    })
}));

jest.mock('../services/playerService');
jest.mock('../services/gameService');
jest.mock('../utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));

const playerService = require('../services/playerService');
const gameService = require('../services/gameService');

describe('Chat Handlers Branch Coverage', () => {
    let mockSocket: any;
    let mockIo: any;
    let eventHandlers: Record<string, any>;

    beforeEach(() => {
        jest.clearAllMocks();

        mockSocket = {
            id: 'socket-1',
            sessionId: 'session-1',
            roomCode: 'TEST12',
            on: jest.fn((event: string, handler: any) => {
                if (!eventHandlers) eventHandlers = {};
                eventHandlers[event] = handler;
            }),
            emit: jest.fn(),
            join: jest.fn(),
            leave: jest.fn()
        };

        mockIo = {
            to: jest.fn().mockReturnThis(),
            emit: jest.fn()
        };

        eventHandlers = {};

        playerService.getPlayer.mockResolvedValue({
            sessionId: 'session-1',
            roomCode: 'TEST12',
            nickname: 'TestPlayer',
            team: 'red',
            role: 'clicker'
        });
        gameService.getGame.mockResolvedValue(null);

        const chatHandlers = require('../socket/handlers/chatHandlers');
        chatHandlers(mockIo, mockSocket);
    });

    describe('chat:message - spectatorOnly messages', () => {
        it('should emit spectator-only message to spectators room', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-1',
                roomCode: 'TEST12',
                nickname: 'Spectator',
                team: null,
                role: 'spectator'
            });

            const handler = mockSocket.on.mock.calls.find((h: any) => h[0] === 'chat:message');
            await handler[1]({ text: 'Spectator chat', spectatorOnly: true });

            expect(mockIo.to).toHaveBeenCalledWith('spectators:TEST12');
            expect(mockIo.emit).toHaveBeenCalledWith('chat:message', expect.objectContaining({
                text: 'Spectator chat',
                spectatorOnly: true
            }));
        });

        it('should reject spectatorOnly message from non-spectator', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-1',
                roomCode: 'TEST12',
                nickname: 'Player',
                team: 'red',
                role: 'clicker' // not a spectator
            });

            const handler = mockSocket.on.mock.calls.find((h: any) => h[0] === 'chat:message');
            await handler[1]({ text: 'Trying to use spectator chat', spectatorOnly: true });

            expect(mockSocket.emit).toHaveBeenCalledWith('chat:error', expect.objectContaining({
                code: 'NOT_AUTHORIZED'
            }));
        });

        it('should handle spectator emit error gracefully', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-1',
                roomCode: 'TEST12',
                nickname: 'Spectator',
                team: null,
                role: 'spectator'
            });

            mockIo.emit.mockImplementation(() => {
                throw new Error('Emit failed');
            });

            const handler = mockSocket.on.mock.calls.find((h: any) => h[0] === 'chat:message');
            // Should not throw
            await expect(handler[1]({ text: 'Spectator chat', spectatorOnly: true })).resolves.not.toThrow();
        });
    });

    describe('chat:message - teamOnly with null/invalid teammates', () => {
        it('should fall back to socket emit when getTeamMembers returns null', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-1',
                roomCode: 'TEST12',
                nickname: 'Player',
                team: 'red',
                role: 'clicker'
            });
            playerService.getTeamMembers.mockResolvedValue(null);

            const handler = mockSocket.on.mock.calls.find((h: any) => h[0] === 'chat:message');
            await handler[1]({ text: 'Team message', teamOnly: true });

            // Should fall back to emitting to the socket directly
            expect(mockSocket.emit).toHaveBeenCalledWith('chat:message', expect.objectContaining({
                text: 'Team message'
            }));
        });
    });

    describe('chat:spectator handler', () => {
        it('should register chat:spectator handler', () => {
            const handler = mockSocket.on.mock.calls.find((h: any) => h[0] === 'chat:spectator');
            expect(handler).toBeDefined();
        });

        it('should emit spectator message to spectators room', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-1',
                roomCode: 'TEST12',
                nickname: 'Spectator',
                team: null,
                role: 'spectator'
            });

            const handler = mockSocket.on.mock.calls.find((h: any) => h[0] === 'chat:spectator');
            await handler[1]({ message: 'Hello spectators' });

            expect(mockIo.to).toHaveBeenCalledWith('spectators:TEST12');
            expect(mockIo.emit).toHaveBeenCalledWith('chat:spectatorMessage', expect.objectContaining({
                text: 'Hello spectators',
                from: expect.objectContaining({
                    sessionId: 'session-1',
                    role: 'spectator'
                })
            }));
        });

        it('should reject spectator message from non-spectator', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-1',
                roomCode: 'TEST12',
                nickname: 'Player',
                team: 'red',
                role: 'clicker'
            });

            const handler = mockSocket.on.mock.calls.find((h: any) => h[0] === 'chat:spectator');
            await handler[1]({ message: 'Not a spectator' });

            expect(mockSocket.emit).toHaveBeenCalledWith('chat:error', expect.objectContaining({
                code: 'NOT_AUTHORIZED'
            }));
        });

        it('should handle spectator emit error gracefully', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-1',
                roomCode: 'TEST12',
                nickname: 'Spectator',
                team: null,
                role: 'spectator'
            });

            mockIo.emit.mockImplementation(() => {
                throw new Error('Emit failed');
            });

            const handler = mockSocket.on.mock.calls.find((h: any) => h[0] === 'chat:spectator');
            // Should not throw
            await expect(handler[1]({ message: 'Hello' })).resolves.not.toThrow();
        });
    });

    describe('chat:message - default spectatorOnly flag', () => {
        it('should set spectatorOnly to false when not provided', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-1',
                roomCode: 'TEST12',
                nickname: 'Player',
                team: 'red',
                role: 'clicker'
            });

            const handler = mockSocket.on.mock.calls.find((h: any) => h[0] === 'chat:message');
            await handler[1]({ text: 'Hello' });

            expect(mockIo.emit).toHaveBeenCalledWith('chat:message', expect.objectContaining({
                spectatorOnly: false
            }));
        });
    });
});
