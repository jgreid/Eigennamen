/**
 * Extended Player Handlers Tests
 * Tests additional edge cases and code paths to improve coverage
 */

// Mock rate limit handler FIRST to bypass rate limiting
jest.mock('../socket/rateLimitHandler', () => ({
    createRateLimitedHandler: jest.fn((socket, eventName, handler) => handler)
}));

// Mock dependencies
jest.mock('../services/playerService');
jest.mock('../services/gameService');
jest.mock('../services/eventLogService');
jest.mock('../utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));
jest.mock('../utils/sanitize', () => ({
    sanitizeHtml: jest.fn((str) => str),
    removeControlChars: jest.fn((str) => str),  // FIX: Include for Zod schema validation
    isReservedName: jest.fn(() => false)        // FIX: Include for nickname validation
}));

const playerService = require('../services/playerService');
const gameService = require('../services/gameService');
const eventLogService = require('../services/eventLogService');

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

        eventLogService.logEvent = jest.fn().mockResolvedValue();
        eventLogService.EVENT_TYPES = {
            TEAM_CHANGED: 'TEAM_CHANGED',
            ROLE_CHANGED: 'ROLE_CHANGED',
            NICKNAME_CHANGED: 'NICKNAME_CHANGED',
            PLAYER_LEFT: 'PLAYER_LEFT'
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

        playerHandlers = require('../socket/handlers/playerHandlers');
        playerHandlers(mockIo, mockSocket);
    });

    describe('player:setTeam edge cases', () => {
        test('prevents team switch during active turn as spymaster', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-456',
                roomCode: 'TEST12',
                team: 'red',
                role: 'spymaster'
            });
            gameService.getGame.mockResolvedValue({
                currentTurn: 'red',
                gameOver: false
            });

            const handlers = mockSocket.on.mock.calls;
            const setTeamHandler = handlers.find(h => h[0] === 'player:setTeam');
            await setTeamHandler[1]({ team: 'blue' });

            expect(mockSocket.emit).toHaveBeenCalledWith('player:error', expect.objectContaining({
                message: expect.stringContaining('Cannot change')
            }));
        });

        test('prevents team switch during active turn as clicker', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-456',
                roomCode: 'TEST12',
                team: 'blue',
                role: 'clicker'
            });
            gameService.getGame.mockResolvedValue({
                currentTurn: 'blue',
                gameOver: false
            });

            const handlers = mockSocket.on.mock.calls;
            const setTeamHandler = handlers.find(h => h[0] === 'player:setTeam');
            await setTeamHandler[1]({ team: 'red' });

            expect(mockSocket.emit).toHaveBeenCalledWith('player:error', expect.objectContaining({
                message: expect.stringContaining('Cannot change')
            }));
        });

        test('allows team switch when game is over', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-456',
                roomCode: 'TEST12',
                team: 'red',
                role: 'spymaster'
            });
            gameService.getGame.mockResolvedValue({
                currentTurn: 'red',
                gameOver: true
            });
            playerService.safeSetTeam.mockResolvedValue({
                sessionId: 'session-456',
                team: 'blue',
                nickname: 'Player1'
            });

            const handlers = mockSocket.on.mock.calls;
            const setTeamHandler = handlers.find(h => h[0] === 'player:setTeam');
            await setTeamHandler[1]({ team: 'blue' });

            expect(playerService.safeSetTeam).toHaveBeenCalled();
        });

        test('allows team switch when not your turn', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-456',
                roomCode: 'TEST12',
                team: 'red',
                role: 'spymaster'
            });
            gameService.getGame.mockResolvedValue({
                currentTurn: 'blue', // Other team's turn
                gameOver: false
            });
            playerService.safeSetTeam.mockResolvedValue({
                sessionId: 'session-456',
                team: 'blue',
                nickname: 'Player1'
            });

            const handlers = mockSocket.on.mock.calls;
            const setTeamHandler = handlers.find(h => h[0] === 'player:setTeam');
            await setTeamHandler[1]({ team: 'blue' });

            expect(playerService.safeSetTeam).toHaveBeenCalled();
        });

        test('handles player not in room', async () => {
            playerService.getPlayer.mockResolvedValue(null);
            mockSocket.roomCode = null;

            const handlers = mockSocket.on.mock.calls;
            const setTeamHandler = handlers.find(h => h[0] === 'player:setTeam');
            await setTeamHandler[1]({ team: 'blue' });

            expect(mockSocket.emit).toHaveBeenCalledWith('player:error', expect.objectContaining({
                code: 'ROOM_NOT_FOUND'
            }));
        });

        test('handles null player', async () => {
            playerService.getPlayer.mockResolvedValue(null);

            const handlers = mockSocket.on.mock.calls;
            const setTeamHandler = handlers.find(h => h[0] === 'player:setTeam');
            await setTeamHandler[1]({ team: 'blue' });

            expect(mockSocket.emit).toHaveBeenCalledWith('player:error', expect.objectContaining({
                code: 'ROOM_NOT_FOUND'
            }));
        });

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
            playerService.safeSetTeam.mockResolvedValue({
                sessionId: 'session-456',
                team: 'blue',
                nickname: 'Player1'
            });

            const handlers = mockSocket.on.mock.calls;
            const setTeamHandler = handlers.find(h => h[0] === 'player:setTeam');
            await setTeamHandler[1]({ team: 'blue' });

            expect(playerService.safeSetTeam).toHaveBeenCalledWith(
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
            playerService.safeSetTeam.mockResolvedValue({
                sessionId: 'session-456',
                team: 'red',
                nickname: 'Player1'
            });

            const handlers = mockSocket.on.mock.calls;
            const setTeamHandler = handlers.find(h => h[0] === 'player:setTeam');
            await setTeamHandler[1]({ team: 'red' });

            expect(eventLogService.logEvent).toHaveBeenCalledWith(
                'TEST12',
                'TEAM_CHANGED',
                expect.objectContaining({
                    sessionId: 'session-456',
                    team: 'red'
                })
            );
        });
    });

    describe('player:setRole edge cases', () => {
        test('sends spymaster view when becoming spymaster with active game', async () => {
            playerService.setRole.mockResolvedValue({
                sessionId: 'session-456',
                roomCode: 'TEST12',
                role: 'spymaster',
                nickname: 'Player1'
            });
            gameService.getGame.mockResolvedValue({
                types: ['red', 'blue', 'neutral', 'assassin'],
                gameOver: false
            });

            const handlers = mockSocket.on.mock.calls;
            const setRoleHandler = handlers.find(h => h[0] === 'player:setRole');
            await setRoleHandler[1]({ role: 'spymaster' });

            expect(mockSocket.emit).toHaveBeenCalledWith('game:spymasterView', {
                types: ['red', 'blue', 'neutral', 'assassin']
            });
        });

        test('does not send spymaster view when game is over', async () => {
            playerService.setRole.mockResolvedValue({
                sessionId: 'session-456',
                roomCode: 'TEST12',
                role: 'spymaster',
                nickname: 'Player1'
            });
            gameService.getGame.mockResolvedValue({
                types: ['red', 'blue', 'neutral', 'assassin'],
                gameOver: true
            });

            const handlers = mockSocket.on.mock.calls;
            const setRoleHandler = handlers.find(h => h[0] === 'player:setRole');
            await setRoleHandler[1]({ role: 'spymaster' });

            expect(mockSocket.emit).not.toHaveBeenCalledWith('game:spymasterView', expect.anything());
        });

        test('does not send spymaster view for clicker role', async () => {
            playerService.setRole.mockResolvedValue({
                sessionId: 'session-456',
                roomCode: 'TEST12',
                role: 'clicker',
                nickname: 'Player1'
            });
            gameService.getGame.mockResolvedValue({
                types: ['red', 'blue', 'neutral', 'assassin'],
                gameOver: false
            });

            const handlers = mockSocket.on.mock.calls;
            const setRoleHandler = handlers.find(h => h[0] === 'player:setRole');
            await setRoleHandler[1]({ role: 'clicker' });

            expect(mockSocket.emit).not.toHaveBeenCalledWith('game:spymasterView', expect.anything());
        });

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

            expect(eventLogService.logEvent).toHaveBeenCalledWith(
                'TEST12',
                'ROLE_CHANGED',
                expect.objectContaining({
                    sessionId: 'session-456',
                    role: 'clicker'
                })
            );
        });
    });

    // Note: player:setNickname edge cases are covered in playerHandlersUnit.test.js

    describe('player:kick edge cases', () => {
        test('kicks player and disconnects their socket', async () => {
            const targetSocket = {
                emit: jest.fn(),
                leave: jest.fn(),
                disconnect: jest.fn(),
                roomCode: 'TEST12'
            };
            mockIo.sockets.sockets.set('target-socket-id', targetSocket);

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
            playerService.getSocketId.mockResolvedValue('target-socket-id');
            playerService.removePlayer.mockResolvedValue();
            playerService.getPlayersInRoom.mockResolvedValue([]);

            const handlers = mockSocket.on.mock.calls;
            const kickHandler = handlers.find(h => h[0] === 'player:kick');
            await kickHandler[1]({ targetSessionId: 'target-session' });

            expect(targetSocket.emit).toHaveBeenCalledWith('room:kicked', expect.anything());
            expect(targetSocket.leave).toHaveBeenCalled();
            expect(targetSocket.disconnect).toHaveBeenCalledWith(true);
        });

        test('handles missing target socket ID', async () => {
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
            playerService.getSocketId.mockResolvedValue(null);
            playerService.removePlayer.mockResolvedValue();
            playerService.getPlayersInRoom.mockResolvedValue([]);

            const handlers = mockSocket.on.mock.calls;
            const kickHandler = handlers.find(h => h[0] === 'player:kick');
            await kickHandler[1]({ targetSessionId: 'target-session' });

            // Should still complete without crashing
            expect(playerService.removePlayer).toHaveBeenCalled();
        });

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

        test('rejects kick without targetSessionId', async () => {
            const handlers = mockSocket.on.mock.calls;
            const kickHandler = handlers.find(h => h[0] === 'player:kick');
            await kickHandler[1]({});

            // FIX: Use flexible matcher for Zod validation messages
            expect(mockSocket.emit).toHaveBeenCalledWith('player:error', expect.objectContaining({
                code: 'INVALID_INPUT',
                message: expect.stringMatching(/required|targetSessionId/i)
            }));
        });

        test('rejects kick with null data', async () => {
            const handlers = mockSocket.on.mock.calls;
            const kickHandler = handlers.find(h => h[0] === 'player:kick');
            await kickHandler[1](null);

            // FIX: Use flexible matcher for Zod validation messages
            expect(mockSocket.emit).toHaveBeenCalledWith('player:error', expect.objectContaining({
                code: 'INVALID_INPUT',
                message: expect.stringMatching(/required|targetSessionId/i)
            }));
        });

        test('prevents kicking yourself', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-456',
                roomCode: 'TEST12',  // FIX: Include roomCode to pass validation
                isHost: true,
                nickname: 'Host'
            });

            const handlers = mockSocket.on.mock.calls;
            const kickHandler = handlers.find(h => h[0] === 'player:kick');
            await kickHandler[1]({ targetSessionId: 'session-456' });

            expect(mockSocket.emit).toHaveBeenCalledWith('player:error', expect.objectContaining({
                message: expect.stringContaining('Cannot kick yourself')
            }));
        });

        test('rejects non-host kicking', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-456',
                roomCode: 'TEST12',  // FIX: Include roomCode to pass validation
                isHost: false,
                nickname: 'Player'
            });

            const handlers = mockSocket.on.mock.calls;
            const kickHandler = handlers.find(h => h[0] === 'player:kick');
            await kickHandler[1]({ targetSessionId: 'target-session' });

            expect(mockSocket.emit).toHaveBeenCalledWith('player:error', expect.objectContaining({
                message: expect.stringContaining('host')
            }));
        });

        test('handles target player not in same room', async () => {
            playerService.getPlayer.mockImplementation(async (sessionId) => {
                if (sessionId === 'session-456') {
                    return {
                        sessionId: 'session-456',
                        roomCode: 'TEST12',
                        isHost: true,
                        nickname: 'Host'
                    };
                }
                return {
                    sessionId: 'target-session',
                    roomCode: 'OTHER_ROOM',
                    nickname: 'TargetPlayer'
                };
            });

            const handlers = mockSocket.on.mock.calls;
            const kickHandler = handlers.find(h => h[0] === 'player:kick');
            await kickHandler[1]({ targetSessionId: 'target-session' });

            expect(mockSocket.emit).toHaveBeenCalledWith('player:error', expect.objectContaining({
                message: expect.stringContaining('not found')
            }));
        });

        test('handles target player not found', async () => {
            playerService.getPlayer.mockImplementation(async (sessionId) => {
                if (sessionId === 'session-456') {
                    return {
                        sessionId: 'session-456',
                        roomCode: 'TEST12',
                        isHost: true,
                        nickname: 'Host'
                    };
                }
                return null;
            });

            const handlers = mockSocket.on.mock.calls;
            const kickHandler = handlers.find(h => h[0] === 'player:kick');
            await kickHandler[1]({ targetSessionId: 'target-session' });

            expect(mockSocket.emit).toHaveBeenCalledWith('player:error', expect.objectContaining({
                message: expect.stringContaining('not found')
            }));
        });

        test('logs kick event', async () => {
            playerService.getPlayer.mockImplementation(async (sessionId) => {
                if (sessionId === 'session-456') {
                    return {
                        sessionId: 'session-456',
                        roomCode: 'TEST12',
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
            playerService.getSocketId.mockResolvedValue(null);
            playerService.removePlayer.mockResolvedValue();
            playerService.getPlayersInRoom.mockResolvedValue([]);

            const handlers = mockSocket.on.mock.calls;
            const kickHandler = handlers.find(h => h[0] === 'player:kick');
            await kickHandler[1]({ targetSessionId: 'target-session' });

            expect(eventLogService.logEvent).toHaveBeenCalledWith(
                'TEST12',
                'PLAYER_LEFT',
                expect.objectContaining({
                    sessionId: 'target-session',
                    reason: 'kicked'
                })
            );
        });
    });

    describe('missing roomCode scenarios', () => {
        beforeEach(() => {
            mockSocket.roomCode = null;
            playerService.getPlayer.mockResolvedValue(null);
        });

        test('setTeam rejects without roomCode', async () => {
            const handlers = mockSocket.on.mock.calls;
            const setTeamHandler = handlers.find(h => h[0] === 'player:setTeam');
            await setTeamHandler[1]({ team: 'red' });

            expect(mockSocket.emit).toHaveBeenCalledWith('player:error', expect.objectContaining({
                code: 'ROOM_NOT_FOUND'
            }));
        });

        test('setRole rejects without roomCode', async () => {
            const handlers = mockSocket.on.mock.calls;
            const setRoleHandler = handlers.find(h => h[0] === 'player:setRole');
            await setRoleHandler[1]({ role: 'clicker' });

            expect(mockSocket.emit).toHaveBeenCalledWith('player:error', expect.objectContaining({
                code: 'ROOM_NOT_FOUND'
            }));
        });

        test('setNickname rejects without roomCode', async () => {
            const handlers = mockSocket.on.mock.calls;
            const setNicknameHandler = handlers.find(h => h[0] === 'player:setNickname');
            await setNicknameHandler[1]({ nickname: 'Test' });

            expect(mockSocket.emit).toHaveBeenCalledWith('player:error', expect.objectContaining({
                code: 'ROOM_NOT_FOUND'
            }));
        });

        test('kick rejects without roomCode', async () => {
            const handlers = mockSocket.on.mock.calls;
            const kickHandler = handlers.find(h => h[0] === 'player:kick');
            await kickHandler[1]({ targetSessionId: 'target' });

            expect(mockSocket.emit).toHaveBeenCalledWith('player:error', expect.objectContaining({
                code: 'ROOM_NOT_FOUND'
            }));
        });
    });
});
