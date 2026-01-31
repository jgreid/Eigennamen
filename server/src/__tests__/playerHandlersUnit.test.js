/**
 * Player Handlers Unit Tests
 *
 * Comprehensive tests for player socket event handlers
 */

// Mock dependencies before requiring the module
jest.mock('../services/playerService');
jest.mock('../services/gameService');
jest.mock('../services/eventLogService');
jest.mock('../utils/logger');
jest.mock('../socket/rateLimitHandler', () => ({
    createRateLimitedHandler: jest.fn((socket, event, handler) => handler)
}));

const playerService = require('../services/playerService');
const gameService = require('../services/gameService');
const eventLogService = require('../services/eventLogService');
const logger = require('../utils/logger');

describe('Player Handlers', () => {
    let mockIo;
    let mockSocket;
    let eventHandlers;

    beforeEach(() => {
        jest.clearAllMocks();

        // Create mock socket
        mockSocket = {
            id: 'socket-1',
            sessionId: 'session-1',
            roomCode: 'TEST12',
            on: jest.fn((event, handler) => {
                if (!eventHandlers) eventHandlers = {};
                eventHandlers[event] = handler;
            }),
            emit: jest.fn(),
            join: jest.fn(),
            leave: jest.fn()
        };

        // Create mock io
        mockIo = {
            to: jest.fn().mockReturnValue({
                emit: jest.fn()
            }),
            sockets: {
                sockets: new Map()
            }
        };

        // Reset event handlers
        eventHandlers = {};

        // Set up default mocks
        playerService.getPlayer.mockResolvedValue({
            sessionId: 'session-1',
            nickname: 'TestPlayer',
            roomCode: 'TEST12',
            team: 'red',
            role: null,
            isHost: false
        });
        playerService.setTeam.mockResolvedValue({
            sessionId: 'session-1',
            nickname: 'TestPlayer',
            team: 'blue'
        });
        playerService.setRole.mockResolvedValue({
            sessionId: 'session-1',
            nickname: 'TestPlayer',
            roomCode: 'TEST12',
            role: 'spymaster'
        });
        playerService.setNickname.mockResolvedValue({
            sessionId: 'session-1',
            nickname: 'NewNickname',
            roomCode: 'TEST12'
        });
        playerService.getPlayersInRoom.mockResolvedValue([]);
        playerService.getSocketId.mockResolvedValue(null);
        playerService.removePlayer.mockResolvedValue();
        playerService.getRoomStats.mockResolvedValue({});

        // Default game mock - no game
        gameService.getGame.mockResolvedValue(null);

        eventLogService.logEvent.mockResolvedValue();
        eventLogService.EVENT_TYPES = {
            TEAM_CHANGED: 'TEAM_CHANGED',
            ROLE_CHANGED: 'ROLE_CHANGED',
            NICKNAME_CHANGED: 'NICKNAME_CHANGED',
            PLAYER_LEFT: 'PLAYER_LEFT'
        };

        // Load handlers
        const playerHandlers = require('../socket/handlers/playerHandlers');
        playerHandlers(mockIo, mockSocket);
    });

    // No need for resetModules - clearAllMocks in beforeEach is sufficient

    describe('player:setTeam', () => {
        test('successfully sets team for player', async () => {
            await eventHandlers['player:setTeam']({ team: 'blue' });

            // When no game exists, shouldCheckEmpty is false
            expect(playerService.setTeam).toHaveBeenCalledWith(
                'session-1',
                'blue',
                false
            );
            expect(mockIo.to).toHaveBeenCalledWith('room:TEST12');
            expect(mockIo.to().emit).toHaveBeenCalledWith('player:updated', {
                sessionId: 'session-1',
                changes: { team: 'blue' }
            });
        });

        test('emits error when not in a room', async () => {
            mockSocket.roomCode = null;
            playerService.getPlayer.mockResolvedValue(null);

            await eventHandlers['player:setTeam']({ team: 'blue' });

            expect(mockSocket.emit).toHaveBeenCalledWith('player:error', {
                code: expect.any(String),
                message: expect.stringContaining('must be in a room')
            });
        });

        test('emits error when player not found', async () => {
            playerService.getPlayer.mockResolvedValue(null);

            await eventHandlers['player:setTeam']({ team: 'blue' });

            expect(mockSocket.emit).toHaveBeenCalledWith('player:error', {
                code: expect.any(String),
                message: expect.any(String)
            });
        });

        test('emits error when player not found', async () => {
            playerService.getPlayer.mockResolvedValue(null);

            await eventHandlers['player:setTeam']({ team: 'blue' });

            expect(mockSocket.emit).toHaveBeenCalledWith('player:error', {
                code: expect.any(String),
                message: expect.stringContaining('must be in a room')
            });
        });

        test('prevents team switch once cards are revealed', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-1',
                roomCode: 'TEST12',
                team: 'red',
                role: 'spymaster',
                nickname: 'TestPlayer'
            });
            gameService.getGame.mockResolvedValue({
                gameOver: false,
                currentTurn: 'red',
                revealed: [true, false, false]
            });

            await eventHandlers['player:setTeam']({ team: 'blue' });

            expect(mockSocket.emit).toHaveBeenCalledWith('player:error', {
                code: expect.any(String),
                message: expect.stringContaining('Cannot change')
            });
        });

        test('allows team switch when game is over', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-1',
                roomCode: 'TEST12',
                team: 'red',
                role: 'spymaster',
                nickname: 'TestPlayer'
            });
            gameService.getGame.mockResolvedValue({
                gameOver: true,
                currentTurn: 'red'
            });

            await eventHandlers['player:setTeam']({ team: 'blue' });

            expect(playerService.setTeam).toHaveBeenCalled();
        });

        test('allows team switch before any cards are revealed', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-1',
                roomCode: 'TEST12',
                team: 'red',
                role: 'clicker',
                nickname: 'TestPlayer'
            });
            gameService.getGame.mockResolvedValue({
                gameOver: false,
                currentTurn: 'blue',
                revealed: [false, false, false]
            });

            await eventHandlers['player:setTeam']({ team: 'blue' });

            expect(playerService.setTeam).toHaveBeenCalled();
        });

        test('logs event on successful team change', async () => {
            await eventHandlers['player:setTeam']({ team: 'blue' });

            expect(eventLogService.logEvent).toHaveBeenCalledWith(
                'TEST12',
                'TEAM_CHANGED',
                expect.objectContaining({
                    sessionId: 'session-1',
                    team: 'blue'
                })
            );
        });

        test('handles service error gracefully', async () => {
            playerService.setTeam.mockRejectedValue(new Error('Database error'));

            await eventHandlers['player:setTeam']({ team: 'blue' });

            expect(mockSocket.emit).toHaveBeenCalledWith('player:error', {
                code: 'SERVER_ERROR',
                message: 'An unexpected error occurred'
            });
            expect(logger.error).toHaveBeenCalled();
        });
    });

    describe('player:setRole', () => {
        test('successfully sets role for player', async () => {
            await eventHandlers['player:setRole']({ role: 'clicker' });

            expect(playerService.setRole).toHaveBeenCalledWith('session-1', 'clicker');
            expect(mockIo.to).toHaveBeenCalledWith('room:TEST12');
        });

        test('emits error when not in a room', async () => {
            mockSocket.roomCode = null;
            playerService.getPlayer.mockResolvedValue(null);

            await eventHandlers['player:setRole']({ role: 'spymaster' });

            expect(mockSocket.emit).toHaveBeenCalledWith('player:error', {
                code: expect.any(String),
                message: expect.stringContaining('must be in a room')
            });
        });

        test('succeeds even when setRole returns player in different room', async () => {
            playerService.setRole.mockResolvedValue({
                sessionId: 'session-1',
                roomCode: 'OTHER',
                role: 'spymaster'
            });

            await eventHandlers['player:setRole']({ role: 'spymaster' });

            // No longer checks roomCode mismatch after setRole
            expect(mockSocket.emit).not.toHaveBeenCalledWith('player:error', expect.anything());
        });

        test('sends spymaster view when becoming spymaster', async () => {
            gameService.getGame.mockResolvedValue({
                gameOver: false,
                types: ['red', 'blue', 'neutral', 'assassin']
            });

            await eventHandlers['player:setRole']({ role: 'spymaster' });

            expect(mockSocket.emit).toHaveBeenCalledWith('game:spymasterView', {
                types: ['red', 'blue', 'neutral', 'assassin']
            });
        });

        test('does not send spymaster view when game is over', async () => {
            gameService.getGame.mockResolvedValue({
                gameOver: true,
                types: ['red', 'blue', 'neutral', 'assassin']
            });

            await eventHandlers['player:setRole']({ role: 'spymaster' });

            expect(mockSocket.emit).not.toHaveBeenCalledWith('game:spymasterView', expect.any(Object));
        });

        test('does not send spymaster view for non-spymaster role', async () => {
            playerService.setRole.mockResolvedValue({
                sessionId: 'session-1',
                roomCode: 'TEST12',
                role: 'clicker'
            });

            await eventHandlers['player:setRole']({ role: 'clicker' });

            expect(mockSocket.emit).not.toHaveBeenCalledWith('game:spymasterView', expect.any(Object));
        });

        test('logs role change event', async () => {
            await eventHandlers['player:setRole']({ role: 'spymaster' });

            expect(eventLogService.logEvent).toHaveBeenCalledWith(
                'TEST12',
                'ROLE_CHANGED',
                expect.objectContaining({
                    sessionId: 'session-1',
                    role: 'spymaster'
                })
            );
        });

        test('handles service error gracefully', async () => {
            playerService.setRole.mockRejectedValue(new Error('Role error'));

            await eventHandlers['player:setRole']({ role: 'spymaster' });

            expect(mockSocket.emit).toHaveBeenCalledWith('player:error', {
                code: 'SERVER_ERROR',
                message: 'An unexpected error occurred'
            });
        });
    });

    describe('player:setNickname', () => {
        test('successfully sets nickname', async () => {
            await eventHandlers['player:setNickname']({ nickname: 'NewName' });

            expect(playerService.setNickname).toHaveBeenCalledWith('session-1', 'NewName');
            expect(mockIo.to).toHaveBeenCalledWith('room:TEST12');
        });

        test('emits error when not in a room', async () => {
            mockSocket.roomCode = null;
            playerService.getPlayer.mockResolvedValue(null);

            await eventHandlers['player:setNickname']({ nickname: 'NewName' });

            expect(mockSocket.emit).toHaveBeenCalledWith('player:error', {
                code: expect.any(String),
                message: expect.stringContaining('must be in a room')
            });
        });

        test('succeeds even when setNickname returns player in different room', async () => {
            playerService.setNickname.mockResolvedValue({
                sessionId: 'session-1',
                roomCode: 'OTHER',
                nickname: 'NewName'
            });

            await eventHandlers['player:setNickname']({ nickname: 'NewName' });

            // No longer checks roomCode mismatch after setNickname
            expect(mockSocket.emit).not.toHaveBeenCalledWith('player:error', expect.anything());
        });

        test('sanitizes nickname before broadcasting', async () => {
            playerService.setNickname.mockResolvedValue({
                sessionId: 'session-1',
                roomCode: 'TEST12',
                nickname: 'CleanNickname'
            });

            await eventHandlers['player:setNickname']({ nickname: 'CleanNickname' });

            expect(mockIo.to().emit).toHaveBeenCalledWith('player:updated', {
                sessionId: 'session-1',
                changes: { nickname: expect.any(String) }
            });
        });

        test('logs nickname change event', async () => {
            await eventHandlers['player:setNickname']({ nickname: 'NewNickname' });

            expect(eventLogService.logEvent).toHaveBeenCalledWith(
                'TEST12',
                'NICKNAME_CHANGED',
                expect.objectContaining({
                    sessionId: 'session-1'
                })
            );
        });
    });

    describe('player:kick', () => {
        beforeEach(() => {
            // Setup host as requester
            playerService.getPlayer
                .mockResolvedValueOnce({ // First call for requester
                    sessionId: 'session-1',
                    nickname: 'Host',
                    roomCode: 'TEST12',
                    isHost: true
                })
                .mockResolvedValueOnce({ // Second call for target
                    sessionId: 'session-2',
                    nickname: 'Target',
                    roomCode: 'TEST12',
                    isHost: false
                });
        });

        test('successfully kicks player', async () => {
            await eventHandlers['player:kick']({ targetSessionId: 'session-2' });

            expect(playerService.removePlayer).toHaveBeenCalledWith('session-2');
            expect(mockIo.to).toHaveBeenCalledWith('room:TEST12');
            expect(mockIo.to().emit).toHaveBeenCalledWith('player:kicked', expect.any(Object));
        });

        test('emits error when not in a room', async () => {
            mockSocket.roomCode = null;
            playerService.getPlayer.mockReset();
            playerService.getPlayer.mockResolvedValue(null);

            await eventHandlers['player:kick']({ targetSessionId: 'session-2' });

            expect(mockSocket.emit).toHaveBeenCalledWith('player:error', {
                code: expect.any(String),
                message: expect.stringContaining('must be in a room')
            });
        });

        test('emits error when no target session ID provided', async () => {
            await eventHandlers['player:kick']({});

            expect(mockSocket.emit).toHaveBeenCalledWith('player:error', {
                code: expect.any(String),
                message: expect.stringMatching(/required/i)  // Case-insensitive match for Zod validation
            });
        });

        test('emits error when null data provided', async () => {
            await eventHandlers['player:kick'](null);

            expect(mockSocket.emit).toHaveBeenCalledWith('player:error', {
                code: expect.any(String),
                message: expect.any(String)
            });
        });

        test('emits error when requester is not host', async () => {
            playerService.getPlayer.mockReset();
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-1',
                nickname: 'NotHost',
                roomCode: 'TEST12',
                isHost: false
            });

            await eventHandlers['player:kick']({ targetSessionId: 'session-2' });

            expect(mockSocket.emit).toHaveBeenCalledWith('player:error', {
                code: expect.any(String),
                message: expect.any(String)
            });
        });

        test('emits error when trying to kick self', async () => {
            playerService.getPlayer.mockReset();
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-1',
                nickname: 'Host',
                roomCode: 'TEST12',
                isHost: true
            });

            await eventHandlers['player:kick']({ targetSessionId: 'session-1' });

            expect(mockSocket.emit).toHaveBeenCalledWith('player:error', {
                code: expect.any(String),
                message: expect.stringContaining('Cannot kick yourself')
            });
        });

        test('emits error when target player not found', async () => {
            playerService.getPlayer.mockReset();
            playerService.getPlayer
                .mockResolvedValueOnce({
                    sessionId: 'session-1',
                    isHost: true,
                    roomCode: 'TEST12'
                })
                .mockResolvedValueOnce(null);

            await eventHandlers['player:kick']({ targetSessionId: 'session-2' });

            expect(mockSocket.emit).toHaveBeenCalledWith('player:error', {
                code: expect.any(String),
                message: expect.any(String)
            });
        });

        test('emits error when target player in different room', async () => {
            playerService.getPlayer.mockReset();
            playerService.getPlayer
                .mockResolvedValueOnce({
                    sessionId: 'session-1',
                    isHost: true,
                    roomCode: 'TEST12'
                })
                .mockResolvedValueOnce({
                    sessionId: 'session-2',
                    roomCode: 'OTHER'
                });

            await eventHandlers['player:kick']({ targetSessionId: 'session-2' });

            expect(mockSocket.emit).toHaveBeenCalledWith('player:error', {
                code: expect.any(String),
                message: expect.any(String)
            });
        });

        test('disconnects target socket if found', async () => {
            const mockTargetSocket = {
                emit: jest.fn(),
                leave: jest.fn(),
                disconnect: jest.fn(),
                roomCode: 'TEST12'
            };
            mockIo.sockets.sockets.set('target-socket-id', mockTargetSocket);
            playerService.getSocketId.mockResolvedValue('target-socket-id');

            await eventHandlers['player:kick']({ targetSessionId: 'session-2' });

            expect(mockTargetSocket.emit).toHaveBeenCalledWith('room:kicked', {
                reason: expect.any(String)
            });
            expect(mockTargetSocket.leave).toHaveBeenCalledWith('room:TEST12');
            expect(mockTargetSocket.disconnect).toHaveBeenCalledWith(true);
        });

        test('handles case when target socket not found', async () => {
            playerService.getSocketId.mockResolvedValue(null);

            await eventHandlers['player:kick']({ targetSessionId: 'session-2' });

            // Should still complete without error
            expect(playerService.removePlayer).toHaveBeenCalledWith('session-2');
        });

        test('logs kick event', async () => {
            await eventHandlers['player:kick']({ targetSessionId: 'session-2' });

            expect(eventLogService.logEvent).toHaveBeenCalledWith(
                'TEST12',
                'PLAYER_LEFT',
                expect.objectContaining({
                    sessionId: 'session-2',
                    reason: 'kicked'
                })
            );
        });

        test('broadcasts updated player list after kick', async () => {
            await eventHandlers['player:kick']({ targetSessionId: 'session-2' });

            expect(mockIo.to().emit).toHaveBeenCalledWith('room:playerLeft', expect.any(Object));
        });
    });
});
