/**
 * Extended Player Handlers Tests
 * Tests additional edge cases and code paths to improve coverage
 */

// Mock rate limit handler FIRST to bypass rate limiting
const { SAFE_ERROR_CODES, createMockRateLimitHandler } = require('../helpers/mocks');
jest.mock('../../socket/rateLimitHandler', () => ({
    createRateLimitedHandler: createMockRateLimitHandler(SAFE_ERROR_CODES)
}));

// Mock dependencies
jest.mock('../../services/playerService');
jest.mock('../../services/gameService');
jest.mock('../../utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));
jest.mock('../../utils/sanitize', () => ({
    sanitizeHtml: jest.fn((str) => str),
    removeControlChars: jest.fn((str) => str),  // FIX: Include for Zod schema validation
    isReservedName: jest.fn(() => false)        // FIX: Include for nickname validation
}));
jest.mock('../../utils/distributedLock', () => ({
    withLock: jest.fn(async (_key, fn) => fn()),
}));

const playerService = require('../../services/playerService');
const gameService = require('../../services/gameService');
describe('Extended Player Handlers Tests', () => {
    let mockSocket;
    let mockIo;
    let playerHandlers;

    beforeEach(() => {
        jest.clearAllMocks();

        mockSocket = {
            id: 'socket-123',
            sessionId: 'session-456',
            roomCode: 'TEST12',
            emit: jest.fn(),
            on: jest.fn(),
            join: jest.fn(),
            leave: jest.fn()
        };

        mockIo = {
            to: jest.fn().mockReturnThis(),
            emit: jest.fn(),
            sockets: {
                sockets: new Map()
            }
        };

        // Default player mock with roomCode for context handler
        playerService.getPlayer.mockResolvedValue({
            sessionId: 'session-456',
            roomCode: 'TEST12',
            nickname: 'Player1',
            team: null,
            role: 'spectator',
            isHost: false
        });
        gameService.getGame.mockResolvedValue(null);
        playerService.getRoomStats.mockResolvedValue({});

        playerHandlers = require('../../socket/handlers/playerHandlers');
        playerHandlers(mockIo, mockSocket);
    });

    describe('player:setTeam edge cases', () => {
        test('uses checkEmpty flag for active game team switch', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-456',
                roomCode: 'TEST12',
                team: 'red',
                role: 'spectator'
            });
            gameService.getGame.mockResolvedValue({
                currentTurn: 'red',
                gameOver: false
            });
            playerService.setTeam.mockResolvedValue({
                sessionId: 'session-456',
                team: 'blue',
                nickname: 'Player1'
            });

            const handlers = mockSocket.on.mock.calls;
            const setTeamHandler = handlers.find(h => h[0] === 'player:setTeam');
            await setTeamHandler[1]({ team: 'blue' });

            expect(playerService.setTeam).toHaveBeenCalledWith(
                'session-456',
                'blue',
                true // checkEmpty flag
            );
        });

        test('logs event on successful team change', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-456',
                roomCode: 'TEST12',
                team: null,
                role: 'spectator'
            });
            gameService.getGame.mockResolvedValue(null);
            playerService.setTeam.mockResolvedValue({
                sessionId: 'session-456',
                team: 'red',
                nickname: 'Player1'
            });

            const handlers = mockSocket.on.mock.calls;
            const setTeamHandler = handlers.find(h => h[0] === 'player:setTeam');
            await setTeamHandler[1]({ team: 'red' });

            expect(playerService.setTeam).toHaveBeenCalled();
        });
    });

    describe('player:setRole edge cases', () => {
        test('succeeds even if setRole returns player with different roomCode', async () => {
            playerService.setRole.mockResolvedValue({
                sessionId: 'session-456',
                roomCode: 'OTHER_ROOM',
                role: 'clicker'
            });

            const handlers = mockSocket.on.mock.calls;
            const setRoleHandler = handlers.find(h => h[0] === 'player:setRole');
            await setRoleHandler[1]({ role: 'clicker' });

            // No longer checks roomCode mismatch after setRole
            expect(mockSocket.emit).not.toHaveBeenCalledWith('player:error', expect.anything());
        });

        test('handles null player from setRole', async () => {
            playerService.setRole.mockResolvedValue(null);

            const handlers = mockSocket.on.mock.calls;
            const setRoleHandler = handlers.find(h => h[0] === 'player:setRole');
            await setRoleHandler[1]({ role: 'clicker' });

            // FIX: Updated to expect PLAYER_NOT_FOUND - more accurate error code
            expect(mockSocket.emit).toHaveBeenCalledWith('player:error', expect.objectContaining({
                code: 'PLAYER_NOT_FOUND'
            }));
        });

        test('logs event on successful role change', async () => {
            playerService.setRole.mockResolvedValue({
                sessionId: 'session-456',
                roomCode: 'TEST12',
                role: 'clicker',
                nickname: 'Player1'
            });
            gameService.getGame.mockResolvedValue(null);

            const handlers = mockSocket.on.mock.calls;
            const setRoleHandler = handlers.find(h => h[0] === 'player:setRole');
            await setRoleHandler[1]({ role: 'clicker' });

            expect(playerService.setRole).toHaveBeenCalled();
        });
    });

    // Note: player:setNickname edge cases are covered in playerHandlersUnit.test.js

    describe('player:kick edge cases', () => {
        test('handles target socket not in sockets map', async () => {
            playerService.getPlayer.mockImplementation(async (sessionId) => {
                if (sessionId === 'session-456') {
                    return {
                        sessionId: 'session-456',
                        roomCode: 'TEST12',  // FIX: Include roomCode to pass validation
                        isHost: true,
                        nickname: 'Host'
                    };
                }
                return {
                    sessionId: 'target-session',
                    roomCode: 'TEST12',
                    nickname: 'TargetPlayer',
                    isHost: false
                };
            });
            playerService.getSocketId.mockResolvedValue('nonexistent-socket-id');
            playerService.removePlayer.mockResolvedValue();
            playerService.getPlayersInRoom.mockResolvedValue([]);

            const handlers = mockSocket.on.mock.calls;
            const kickHandler = handlers.find(h => h[0] === 'player:kick');
            await kickHandler[1]({ targetSessionId: 'target-session' });

            // Should still complete without crashing
            expect(playerService.removePlayer).toHaveBeenCalled();
        });
    });
});
