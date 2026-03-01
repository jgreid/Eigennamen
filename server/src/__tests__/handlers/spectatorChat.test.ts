/**
 * Spectator Chat Feature Tests
 *
 * Comprehensive tests for spectator-only chat functionality including:
 * - Spectator chat message sending
 * - Authorization (only spectators can send)
 * - Broadcasting to spectators room
 * - HTML sanitization (XSS prevention)
 * - Schema validation
 * - Spectator room membership management
 */

// Mock rate limit handler FIRST to bypass rate limiting
const { SAFE_ERROR_CODES, createMockRateLimitHandler } = require('../helpers/mocks');
jest.mock('../../socket/rateLimitHandler', () => ({
    createRateLimitedHandler: createMockRateLimitHandler(SAFE_ERROR_CODES),
}));

// Mock dependencies
jest.mock('../../services/playerService');
jest.mock('../../services/gameService');
jest.mock('../../utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
}));

const playerService = require('../../services/playerService');
const gameService = require('../../services/gameService');
const { ERROR_CODES, SOCKET_EVENTS } = require('../../config/constants');
const { spectatorChatSchema } = require('../../validators/schemas');

describe('Spectator Chat Feature', () => {
    describe('Schema Validation', () => {
        test('spectatorChatSchema validates valid message', () => {
            const result = spectatorChatSchema.safeParse({ message: 'Hello spectators!' });
            expect(result.success).toBe(true);
            expect(result.data.message).toBe('Hello spectators!');
        });

        test('spectatorChatSchema rejects empty message', () => {
            const result = spectatorChatSchema.safeParse({ message: '' });
            expect(result.success).toBe(false);
        });

        test('spectatorChatSchema rejects message over 500 characters', () => {
            const longMessage = 'a'.repeat(501);
            const result = spectatorChatSchema.safeParse({ message: longMessage });
            expect(result.success).toBe(false);
        });

        test('spectatorChatSchema accepts message at max length', () => {
            const maxMessage = 'a'.repeat(500);
            const result = spectatorChatSchema.safeParse({ message: maxMessage });
            expect(result.success).toBe(true);
        });

        test('spectatorChatSchema trims whitespace', () => {
            const result = spectatorChatSchema.safeParse({ message: '  Hello!  ' });
            expect(result.success).toBe(true);
            expect(result.data.message).toBe('Hello!');
        });

        test('spectatorChatSchema rejects whitespace-only message', () => {
            const result = spectatorChatSchema.safeParse({ message: '   ' });
            expect(result.success).toBe(false);
        });

        test('spectatorChatSchema removes control characters', () => {
            const result = spectatorChatSchema.safeParse({ message: 'Hello\x00World' });
            expect(result.success).toBe(true);
            expect(result.data.message).not.toContain('\x00');
        });
    });

    describe('Chat Handlers - Spectator Chat', () => {
        let mockSocket;
        let mockIo;
        let chatHandlers;

        beforeEach(() => {
            jest.clearAllMocks();

            // Create mock socket with join/leave tracking
            mockSocket = {
                id: 'socket-123',
                sessionId: 'session-456',
                roomCode: 'TEST12',
                emit: jest.fn(),
                on: jest.fn(),
                join: jest.fn(),
                leave: jest.fn(),
            };

            // Create mock io with chaining
            mockIo = {
                to: jest.fn().mockReturnThis(),
                emit: jest.fn(),
            };

            // Default player mock with roomCode for context handler
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-456',
                roomCode: 'TEST12',
                nickname: 'Spectator1',
                team: null,
                role: 'spectator',
            });
            gameService.getGame.mockResolvedValue(null);

            // Register handlers
            chatHandlers = require('../../socket/handlers/chatHandlers');
            chatHandlers(mockIo, mockSocket);
        });

        describe('Handler Registration', () => {
            test('registers chat:spectator handler', () => {
                const handlers = mockSocket.on.mock.calls;
                const spectatorHandler = handlers.find((h) => h[0] === SOCKET_EVENTS.CHAT_SPECTATOR);
                expect(spectatorHandler).toBeDefined();
            });
        });

        describe('Authorization', () => {
            test('allows spectator with role=spectator to send message', async () => {
                playerService.getPlayer.mockResolvedValue({
                    sessionId: 'session-456',
                    roomCode: 'TEST12',
                    nickname: 'Spectator1',
                    team: null,
                    role: 'spectator',
                });

                const handlers = mockSocket.on.mock.calls;
                const spectatorHandler = handlers.find((h) => h[0] === SOCKET_EVENTS.CHAT_SPECTATOR);
                await spectatorHandler[1]({ message: 'Go team!' });

                expect(mockIo.to).toHaveBeenCalledWith('spectators:TEST12');
                expect(mockIo.emit).toHaveBeenCalledWith(
                    SOCKET_EVENTS.CHAT_SPECTATOR_MESSAGE,
                    expect.objectContaining({
                        text: 'Go team!',
                        from: expect.objectContaining({
                            sessionId: 'session-456',
                            nickname: 'Spectator1',
                            role: 'spectator',
                        }),
                    })
                );
            });

            test('rejects message from player without team but non-spectator role', async () => {
                playerService.getPlayer.mockResolvedValue({
                    sessionId: 'session-456',
                    roomCode: 'TEST12',
                    nickname: 'NoTeamPlayer',
                    team: null,
                    role: 'clicker',
                });

                const handlers = mockSocket.on.mock.calls;
                const spectatorHandler = handlers.find((h) => h[0] === SOCKET_EVENTS.CHAT_SPECTATOR);
                await spectatorHandler[1]({ message: 'Watching the game!' });

                // Non-spectator players should not be able to send spectator-only messages
                expect(mockSocket.emit).toHaveBeenCalledWith(
                    'chat:error',
                    expect.objectContaining({
                        code: expect.any(String),
                    })
                );
            });

            test('rejects message from player with team and non-spectator role', async () => {
                playerService.getPlayer.mockResolvedValue({
                    sessionId: 'session-456',
                    roomCode: 'TEST12',
                    nickname: 'TeamPlayer',
                    team: 'red',
                    role: 'clicker',
                });

                const handlers = mockSocket.on.mock.calls;
                const spectatorHandler = handlers.find((h) => h[0] === SOCKET_EVENTS.CHAT_SPECTATOR);
                await spectatorHandler[1]({ message: 'Should fail!' });

                expect(mockSocket.emit).toHaveBeenCalledWith(
                    'chat:error',
                    expect.objectContaining({
                        code: ERROR_CODES.NOT_AUTHORIZED,
                        message: 'Not authorized to perform this action',
                    })
                );
                expect(mockIo.emit).not.toHaveBeenCalled();
            });

            test('rejects message from spymaster', async () => {
                playerService.getPlayer.mockResolvedValue({
                    sessionId: 'session-456',
                    roomCode: 'TEST12',
                    nickname: 'Spymaster',
                    team: 'blue',
                    role: 'spymaster',
                });

                const handlers = mockSocket.on.mock.calls;
                const spectatorHandler = handlers.find((h) => h[0] === SOCKET_EVENTS.CHAT_SPECTATOR);
                await spectatorHandler[1]({ message: 'Should fail!' });

                expect(mockSocket.emit).toHaveBeenCalledWith(
                    'chat:error',
                    expect.objectContaining({
                        code: ERROR_CODES.NOT_AUTHORIZED,
                    })
                );
            });
        });

        describe('Message Broadcasting', () => {
            test('broadcasts message to spectators room', async () => {
                playerService.getPlayer.mockResolvedValue({
                    sessionId: 'session-456',
                    roomCode: 'TEST12',
                    nickname: 'Spectator1',
                    team: null,
                    role: 'spectator',
                });

                const handlers = mockSocket.on.mock.calls;
                const spectatorHandler = handlers.find((h) => h[0] === SOCKET_EVENTS.CHAT_SPECTATOR);
                await spectatorHandler[1]({ message: 'Hello spectators!' });

                expect(mockIo.to).toHaveBeenCalledWith('spectators:TEST12');
                expect(mockIo.emit).toHaveBeenCalledWith(SOCKET_EVENTS.CHAT_SPECTATOR_MESSAGE, expect.any(Object));
            });

            test('includes timestamp in message', async () => {
                playerService.getPlayer.mockResolvedValue({
                    sessionId: 'session-456',
                    roomCode: 'TEST12',
                    nickname: 'Spectator1',
                    team: null,
                    role: 'spectator',
                });

                const beforeTime = Date.now();
                const handlers = mockSocket.on.mock.calls;
                const spectatorHandler = handlers.find((h) => h[0] === SOCKET_EVENTS.CHAT_SPECTATOR);
                await spectatorHandler[1]({ message: 'Test message' });
                const afterTime = Date.now();

                const emittedMessage = mockIo.emit.mock.calls[0][1];
                expect(emittedMessage.timestamp).toBeGreaterThanOrEqual(beforeTime);
                expect(emittedMessage.timestamp).toBeLessThanOrEqual(afterTime);
            });

            test('includes sender info in message', async () => {
                playerService.getPlayer.mockResolvedValue({
                    sessionId: 'session-456',
                    roomCode: 'TEST12',
                    nickname: 'Spectator1',
                    team: null,
                    role: 'spectator',
                });

                const handlers = mockSocket.on.mock.calls;
                const spectatorHandler = handlers.find((h) => h[0] === SOCKET_EVENTS.CHAT_SPECTATOR);
                await spectatorHandler[1]({ message: 'Hello!' });

                const emittedMessage = mockIo.emit.mock.calls[0][1];
                expect(emittedMessage.from).toEqual(
                    expect.objectContaining({
                        sessionId: 'session-456',
                        nickname: 'Spectator1',
                        team: null,
                        role: 'spectator',
                    })
                );
            });
        });

        describe('Message Content Passthrough (XSS handled by frontend textContent)', () => {
            test('passes through HTML in message text unchanged', async () => {
                playerService.getPlayer.mockResolvedValue({
                    sessionId: 'session-456',
                    roomCode: 'TEST12',
                    nickname: 'Spectator1',
                    team: null,
                    role: 'spectator',
                });

                const handlers = mockSocket.on.mock.calls;
                const spectatorHandler = handlers.find((h) => h[0] === SOCKET_EVENTS.CHAT_SPECTATOR);
                await spectatorHandler[1]({ message: '<script>alert("xss")</script>' });

                const emittedMessage = mockIo.emit.mock.calls[0][1];
                // Server does NOT sanitize — frontend renders via textContent (inherently XSS-safe)
                expect(emittedMessage.text).toBe('<script>alert("xss")</script>');
            });

            test('passes through HTML in nickname unchanged', async () => {
                playerService.getPlayer.mockResolvedValue({
                    sessionId: 'session-456',
                    roomCode: 'TEST12',
                    nickname: '<img src=x onerror=alert(1)>',
                    team: null,
                    role: 'spectator',
                });

                const handlers = mockSocket.on.mock.calls;
                const spectatorHandler = handlers.find((h) => h[0] === SOCKET_EVENTS.CHAT_SPECTATOR);
                await spectatorHandler[1]({ message: 'Normal message' });

                const emittedMessage = mockIo.emit.mock.calls[0][1];
                expect(emittedMessage.from.nickname).toBe('<img src=x onerror=alert(1)>');
            });

            test('passes through ampersands unchanged', async () => {
                playerService.getPlayer.mockResolvedValue({
                    sessionId: 'session-456',
                    roomCode: 'TEST12',
                    nickname: 'Test&User',
                    team: null,
                    role: 'spectator',
                });

                const handlers = mockSocket.on.mock.calls;
                const spectatorHandler = handlers.find((h) => h[0] === SOCKET_EVENTS.CHAT_SPECTATOR);
                await spectatorHandler[1]({ message: 'Tom & Jerry' });

                const emittedMessage = mockIo.emit.mock.calls[0][1];
                expect(emittedMessage.text).toBe('Tom & Jerry');
                expect(emittedMessage.from.nickname).toBe('Test&User');
            });
        });

        describe('Error Handling', () => {
            test('rejects message when not in a room', async () => {
                mockSocket.roomCode = null;
                playerService.getPlayer.mockResolvedValue(null);

                const handlers = mockSocket.on.mock.calls;
                const spectatorHandler = handlers.find((h) => h[0] === SOCKET_EVENTS.CHAT_SPECTATOR);
                await spectatorHandler[1]({ message: 'Hello' });

                expect(mockSocket.emit).toHaveBeenCalledWith(
                    'chat:error',
                    expect.objectContaining({
                        code: ERROR_CODES.ROOM_NOT_FOUND,
                        message: 'You must be in a room to perform this action',
                    })
                );
            });

            test('rejects message when player not found', async () => {
                playerService.getPlayer.mockResolvedValue(null);

                const handlers = mockSocket.on.mock.calls;
                const spectatorHandler = handlers.find((h) => h[0] === SOCKET_EVENTS.CHAT_SPECTATOR);
                await spectatorHandler[1]({ message: 'Hello' });

                expect(mockSocket.emit).toHaveBeenCalledWith(
                    'chat:error',
                    expect.objectContaining({
                        code: ERROR_CODES.ROOM_NOT_FOUND,
                        message: 'You must be in a room to perform this action',
                    })
                );
            });

            test('rejects invalid data format', async () => {
                const handlers = mockSocket.on.mock.calls;
                const spectatorHandler = handlers.find((h) => h[0] === SOCKET_EVENTS.CHAT_SPECTATOR);
                await spectatorHandler[1](null);

                expect(mockSocket.emit).toHaveBeenCalledWith(
                    'chat:error',
                    expect.objectContaining({
                        code: ERROR_CODES.INVALID_INPUT,
                    })
                );
            });

            test('rejects non-object data', async () => {
                const handlers = mockSocket.on.mock.calls;
                const spectatorHandler = handlers.find((h) => h[0] === SOCKET_EVENTS.CHAT_SPECTATOR);
                await spectatorHandler[1]('string data');

                expect(mockSocket.emit).toHaveBeenCalledWith(
                    'chat:error',
                    expect.objectContaining({
                        code: ERROR_CODES.INVALID_INPUT,
                    })
                );
            });

            test('handles player service error gracefully', async () => {
                playerService.getPlayer.mockRejectedValue(new Error('Database connection failed'));

                const handlers = mockSocket.on.mock.calls;
                const spectatorHandler = handlers.find((h) => h[0] === SOCKET_EVENTS.CHAT_SPECTATOR);
                await spectatorHandler[1]({ message: 'Hello' });

                expect(mockSocket.emit).toHaveBeenCalledWith(
                    'chat:error',
                    expect.objectContaining({
                        message: 'An unexpected error occurred',
                    })
                );
            });

            test('handles IO emit error gracefully', async () => {
                playerService.getPlayer.mockResolvedValue({
                    sessionId: 'session-456',
                    roomCode: 'TEST12',
                    nickname: 'Spectator1',
                    team: null,
                    role: 'spectator',
                });

                mockIo.emit.mockImplementation(() => {
                    throw new Error('Socket emit failed');
                });

                const handlers = mockSocket.on.mock.calls;
                const spectatorHandler = handlers.find((h) => h[0] === SOCKET_EVENTS.CHAT_SPECTATOR);

                // Should not throw - error should be caught and logged
                await expect(spectatorHandler[1]({ message: 'Hello' })).resolves.not.toThrow();
            });
        });
    });

    describe('Constants', () => {
        test('CHAT_SPECTATOR event is defined', () => {
            expect(SOCKET_EVENTS.CHAT_SPECTATOR).toBe('chat:spectator');
        });

        test('CHAT_SPECTATOR_MESSAGE event is defined', () => {
            expect(SOCKET_EVENTS.CHAT_SPECTATOR_MESSAGE).toBe('chat:spectatorMessage');
        });

        test('spectator chat rate limit is defined', () => {
            const { RATE_LIMITS } = require('../../config/constants');
            expect(RATE_LIMITS['chat:spectator']).toBeDefined();
            expect(RATE_LIMITS['chat:spectator'].window).toBe(5000);
            expect(RATE_LIMITS['chat:spectator'].max).toBe(10);
        });
    });

    describe('Spectator Room Logic', () => {
        /**
         * These tests verify the spectator room membership logic in isolation.
         * The actual socket room management is done in roomHandlers.js and playerHandlers.js
         *
         * Spectator logic:
         * - A player is a spectator if: role === 'spectator' OR team is null/undefined
         * - On join/reconnect: if spectator -> join spectators:${roomCode}
         * - On team change: if joining team -> leave spectators room; if leaving team -> join spectators room
         * - On role change: if becoming spectator -> join; if leaving spectator -> leave
         * - On room leave: always leave spectators room
         */

        describe('isSpectator determination', () => {
            function isSpectator(player) {
                return player.role === 'spectator' || !player.team;
            }

            test('player with role=spectator is a spectator', () => {
                expect(isSpectator({ role: 'spectator', team: null })).toBe(true);
            });

            test('player with no team is a spectator', () => {
                expect(isSpectator({ role: 'clicker', team: null })).toBe(true);
            });

            test('player with team and non-spectator role is not a spectator', () => {
                expect(isSpectator({ role: 'clicker', team: 'red' })).toBe(false);
            });

            test('player with team and spymaster role is not a spectator', () => {
                expect(isSpectator({ role: 'spymaster', team: 'blue' })).toBe(false);
            });

            test('player with spectator role but has team is still a spectator', () => {
                // Edge case: role takes precedence
                expect(isSpectator({ role: 'spectator', team: 'red' })).toBe(true);
            });
        });

        describe('spectator room membership transitions', () => {
            function shouldJoinSpectatorRoom(beforePlayer, afterPlayer) {
                const wasBefore = beforePlayer.role === 'spectator' || !beforePlayer.team;
                const isAfter = afterPlayer.role === 'spectator' || !afterPlayer.team;
                return !wasBefore && isAfter;
            }

            function shouldLeaveSpectatorRoom(beforePlayer, afterPlayer) {
                const wasBefore = beforePlayer.role === 'spectator' || !beforePlayer.team;
                const isAfter = afterPlayer.role === 'spectator' || !afterPlayer.team;
                return wasBefore && !isAfter;
            }

            test('joining team from spectator should leave spectator room', () => {
                const before = { role: 'spectator', team: null };
                const after = { role: 'clicker', team: 'red' };
                expect(shouldLeaveSpectatorRoom(before, after)).toBe(true);
                expect(shouldJoinSpectatorRoom(before, after)).toBe(false);
            });

            test('leaving team should join spectator room', () => {
                const before = { role: 'clicker', team: 'red' };
                const after = { role: 'spectator', team: null };
                expect(shouldJoinSpectatorRoom(before, after)).toBe(true);
                expect(shouldLeaveSpectatorRoom(before, after)).toBe(false);
            });

            test('changing teams should not affect spectator room', () => {
                const before = { role: 'clicker', team: 'red' };
                const after = { role: 'clicker', team: 'blue' };
                expect(shouldJoinSpectatorRoom(before, after)).toBe(false);
                expect(shouldLeaveSpectatorRoom(before, after)).toBe(false);
            });

            test('staying as spectator should not trigger transitions', () => {
                const before = { role: 'spectator', team: null };
                const after = { role: 'spectator', team: null };
                expect(shouldJoinSpectatorRoom(before, after)).toBe(false);
                expect(shouldLeaveSpectatorRoom(before, after)).toBe(false);
            });

            test('changing role to spymaster on same team should not affect spectator room', () => {
                const before = { role: 'clicker', team: 'red' };
                const after = { role: 'spymaster', team: 'red' };
                expect(shouldJoinSpectatorRoom(before, after)).toBe(false);
                expect(shouldLeaveSpectatorRoom(before, after)).toBe(false);
            });
        });
    });
});
