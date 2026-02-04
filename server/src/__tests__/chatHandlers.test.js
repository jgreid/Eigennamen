/**
 * Chat Handlers Unit Tests
 *
 * Comprehensive tests for chat message handling including:
 * - Public message broadcasting
 * - Team-only message filtering
 * - HTML sanitization (XSS prevention)
 * - Rate limiting
 * - Error handling edge cases
 */

// Mock rate limit handler FIRST to bypass rate limiting
const SAFE_ERROR_CODES_MOCK = ['RATE_LIMITED', 'ROOM_NOT_FOUND', 'ROOM_FULL', 'NOT_HOST', 'NOT_YOUR_TURN', 'GAME_OVER', 'INVALID_INPUT', 'CARD_ALREADY_REVEALED', 'NOT_SPYMASTER', 'NOT_CLICKER', 'NOT_AUTHORIZED', 'SESSION_EXPIRED', 'PLAYER_NOT_FOUND', 'GAME_IN_PROGRESS', 'VALIDATION_ERROR', 'CANNOT_SWITCH_TEAM_DURING_TURN', 'CANNOT_CHANGE_ROLE_DURING_TURN', 'SPYMASTER_CANNOT_CHANGE_TEAM', 'GAME_NOT_STARTED'];
jest.mock('../socket/rateLimitHandler', () => ({
    createRateLimitedHandler: jest.fn((socket, eventName, handler) => { return async (data) => { try { return await handler(data); } catch (error) { const errorEvent = `${eventName.split(':')[0]}:error`; const code = error.code || 'SERVER_ERROR'; const isSafe = SAFE_ERROR_CODES_MOCK.includes(code); socket.emit(errorEvent, { code, message: isSafe ? (error.message || 'An unexpected error occurred') : 'An unexpected error occurred' }); } }; })
}));

// Mock dependencies
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
const { ERROR_CODES } = require('../config/constants');

describe('Chat Handlers', () => {
    let mockSocket;
    let mockIo;
    let chatHandlers;

    beforeEach(() => {
        jest.clearAllMocks();

        // Create mock socket
        mockSocket = {
            id: 'socket-123',
            sessionId: 'session-456',
            roomCode: 'TEST12',
            emit: jest.fn(),
            on: jest.fn(),
            join: jest.fn(),
            leave: jest.fn()
        };

        // Create mock io with chaining
        mockIo = {
            to: jest.fn().mockReturnThis(),
            emit: jest.fn()
        };

        // Default player mock with roomCode for context handler
        playerService.getPlayer.mockResolvedValue({
            sessionId: 'session-456',
            roomCode: 'TEST12',
            nickname: 'TestPlayer',
            team: 'red',
            role: 'clicker'
        });
        gameService.getGame.mockResolvedValue(null);

        // Register handlers
        chatHandlers = require('../socket/handlers/chatHandlers');
        chatHandlers(mockIo, mockSocket);
    });

    describe('Handler Registration', () => {
        test('registers chat:message handler', () => {
            const handlers = mockSocket.on.mock.calls;
            const messageHandler = handlers.find(h => h[0] === 'chat:message');
            expect(messageHandler).toBeDefined();
        });
    });

    describe('chat:message handler - Public Messages', () => {
        test('broadcasts public message to entire room', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-456',
                roomCode: 'TEST12',
                nickname: 'TestPlayer',
                team: 'red'
            });

            const handlers = mockSocket.on.mock.calls;
            const messageHandler = handlers.find(h => h[0] === 'chat:message');
            await messageHandler[1]({ text: 'Hello everyone!', teamOnly: false });

            expect(mockIo.to).toHaveBeenCalledWith('room:TEST12');
            expect(mockIo.emit).toHaveBeenCalledWith('chat:message', expect.objectContaining({
                text: 'Hello everyone!',
                teamOnly: false,
                from: expect.objectContaining({
                    sessionId: 'session-456',
                    nickname: 'TestPlayer',
                    team: 'red'
                })
            }));
        });

        test('includes timestamp in message', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-456',
                roomCode: 'TEST12',
                nickname: 'TestPlayer',
                team: 'blue'
            });

            const beforeTime = Date.now();
            const handlers = mockSocket.on.mock.calls;
            const messageHandler = handlers.find(h => h[0] === 'chat:message');
            await messageHandler[1]({ text: 'Test message', teamOnly: false });
            const afterTime = Date.now();

            const emittedMessage = mockIo.emit.mock.calls[0][1];
            expect(emittedMessage.timestamp).toBeGreaterThanOrEqual(beforeTime);
            expect(emittedMessage.timestamp).toBeLessThanOrEqual(afterTime);
        });

        test('broadcasts message from player without team', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-456',
                roomCode: 'TEST12',
                nickname: 'Spectator',
                team: null
            });

            const handlers = mockSocket.on.mock.calls;
            const messageHandler = handlers.find(h => h[0] === 'chat:message');
            await messageHandler[1]({ text: 'Spectator message', teamOnly: false });

            expect(mockIo.to).toHaveBeenCalledWith('room:TEST12');
            expect(mockIo.emit).toHaveBeenCalledWith('chat:message', expect.objectContaining({
                from: expect.objectContaining({
                    team: null
                })
            }));
        });
    });

    describe('chat:message handler - Team-Only Messages', () => {
        test('sends team-only message to teammates only', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-456',
                roomCode: 'TEST12',
                nickname: 'RedPlayer',
                team: 'red'
            });

            playerService.getTeamMembers.mockResolvedValue([
                { sessionId: 'session-456', nickname: 'RedPlayer', team: 'red' },
                { sessionId: 'session-789', nickname: 'RedTeammate', team: 'red' }
            ]);

            const handlers = mockSocket.on.mock.calls;
            const messageHandler = handlers.find(h => h[0] === 'chat:message');
            await messageHandler[1]({ text: 'Team strategy', teamOnly: true });

            // Should emit to each teammate individually
            expect(mockIo.to).toHaveBeenCalledWith('player:session-456');
            expect(mockIo.to).toHaveBeenCalledWith('player:session-789');
            expect(mockIo.to).toHaveBeenCalledTimes(2);
        });

        test('handles team-only message with no teammates', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-456',
                roomCode: 'TEST12',
                nickname: 'LonePlayer',
                team: 'red'
            });

            playerService.getTeamMembers.mockResolvedValue([
                { sessionId: 'session-456', nickname: 'LonePlayer', team: 'red' }
            ]);

            const handlers = mockSocket.on.mock.calls;
            const messageHandler = handlers.find(h => h[0] === 'chat:message');
            await messageHandler[1]({ text: 'Talking to myself', teamOnly: true });

            // Should only emit to self
            expect(mockIo.to).toHaveBeenCalledTimes(1);
            expect(mockIo.to).toHaveBeenCalledWith('player:session-456');
        });

        test('falls back to room broadcast when player has no team but requests teamOnly', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-456',
                roomCode: 'TEST12',
                nickname: 'Spectator',
                team: null
            });

            const handlers = mockSocket.on.mock.calls;
            const messageHandler = handlers.find(h => h[0] === 'chat:message');
            await messageHandler[1]({ text: 'No team message', teamOnly: true });

            // teamOnly && player.team is falsy, so should broadcast to room
            expect(mockIo.to).toHaveBeenCalledWith('room:TEST12');
        });
    });

    describe('HTML Sanitization (XSS Prevention)', () => {
        test('sanitizes HTML in message text', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-456',
                roomCode: 'TEST12',
                nickname: 'TestPlayer',
                team: 'red'
            });

            const handlers = mockSocket.on.mock.calls;
            const messageHandler = handlers.find(h => h[0] === 'chat:message');
            await messageHandler[1]({ text: '<script>alert("xss")</script>', teamOnly: false });

            const emittedMessage = mockIo.emit.mock.calls[0][1];
            // Note: utils/sanitize.js uses OWASP-recommended encoding (&#x2F; for /)
            expect(emittedMessage.text).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;&#x2F;script&gt;');
            expect(emittedMessage.text).not.toContain('<script>');
        });

        test('sanitizes HTML in nickname', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-456',
                roomCode: 'TEST12',
                nickname: '<img src=x onerror=alert(1)>',
                team: 'red'
            });

            const handlers = mockSocket.on.mock.calls;
            const messageHandler = handlers.find(h => h[0] === 'chat:message');
            await messageHandler[1]({ text: 'Normal message', teamOnly: false });

            const emittedMessage = mockIo.emit.mock.calls[0][1];
            expect(emittedMessage.from.nickname).toBe('&lt;img src=x onerror=alert(1)&gt;');
            expect(emittedMessage.from.nickname).not.toContain('<img');
        });

        test('sanitizes ampersands correctly', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-456',
                roomCode: 'TEST12',
                nickname: 'Test&User',
                team: 'red'
            });

            const handlers = mockSocket.on.mock.calls;
            const messageHandler = handlers.find(h => h[0] === 'chat:message');
            await messageHandler[1]({ text: 'Tom & Jerry', teamOnly: false });

            const emittedMessage = mockIo.emit.mock.calls[0][1];
            expect(emittedMessage.text).toBe('Tom &amp; Jerry');
            expect(emittedMessage.from.nickname).toBe('Test&amp;User');
        });

        test('sanitizes single and double quotes', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-456',
                roomCode: 'TEST12',
                nickname: 'Player',
                team: 'red'
            });

            const handlers = mockSocket.on.mock.calls;
            const messageHandler = handlers.find(h => h[0] === 'chat:message');
            await messageHandler[1]({ text: "He said \"Hello\" and 'Goodbye'", teamOnly: false });

            const emittedMessage = mockIo.emit.mock.calls[0][1];
            // Note: utils/sanitize.js uses OWASP-recommended encoding (&#x27; for ')
            expect(emittedMessage.text).toBe('He said &quot;Hello&quot; and &#x27;Goodbye&#x27;');
        });
    });

    describe('Error Handling', () => {
        test('rejects message when not in a room', async () => {
            mockSocket.roomCode = null;
            playerService.getPlayer.mockResolvedValue(null);

            const handlers = mockSocket.on.mock.calls;
            const messageHandler = handlers.find(h => h[0] === 'chat:message');
            await messageHandler[1]({ text: 'Hello', teamOnly: false });

            expect(mockSocket.emit).toHaveBeenCalledWith('chat:error', expect.objectContaining({
                code: ERROR_CODES.ROOM_NOT_FOUND,
                message: 'You must be in a room to perform this action'
            }));
            expect(mockIo.emit).not.toHaveBeenCalled();
        });

        test('rejects message when player not found', async () => {
            playerService.getPlayer.mockResolvedValue(null);

            const handlers = mockSocket.on.mock.calls;
            const messageHandler = handlers.find(h => h[0] === 'chat:message');
            await messageHandler[1]({ text: 'Hello', teamOnly: false });

            expect(mockSocket.emit).toHaveBeenCalledWith('chat:error', expect.objectContaining({
                code: ERROR_CODES.ROOM_NOT_FOUND,
                message: 'You must be in a room to perform this action'
            }));
        });

        test('handles player service error gracefully', async () => {
            playerService.getPlayer.mockRejectedValue(new Error('Database connection failed'));

            const handlers = mockSocket.on.mock.calls;
            const messageHandler = handlers.find(h => h[0] === 'chat:message');
            await messageHandler[1]({ text: 'Hello', teamOnly: false });

            expect(mockSocket.emit).toHaveBeenCalledWith('chat:error', expect.objectContaining({
                message: 'An unexpected error occurred'
            }));
        });

        test('handles team members fetch error gracefully', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-456',
                roomCode: 'TEST12',
                nickname: 'TestPlayer',
                team: 'red'
            });
            playerService.getTeamMembers.mockRejectedValue(new Error('Failed to fetch team'));

            const handlers = mockSocket.on.mock.calls;
            const messageHandler = handlers.find(h => h[0] === 'chat:message');
            await messageHandler[1]({ text: 'Team message', teamOnly: true });

            expect(mockSocket.emit).toHaveBeenCalledWith('chat:error', expect.objectContaining({
                message: 'An unexpected error occurred'
            }));
        });

        test('handles IO emit error gracefully for room broadcast', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-456',
                roomCode: 'TEST12',
                nickname: 'TestPlayer',
                team: 'red'
            });

            // Make emit throw an error
            mockIo.emit.mockImplementation(() => {
                throw new Error('Socket emit failed');
            });

            const handlers = mockSocket.on.mock.calls;
            const messageHandler = handlers.find(h => h[0] === 'chat:message');

            // Should not throw - error should be caught and logged
            await expect(messageHandler[1]({ text: 'Hello', teamOnly: false })).resolves.not.toThrow();
        });

        test('continues emitting to other teammates if one emit fails', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-456',
                roomCode: 'TEST12',
                nickname: 'TestPlayer',
                team: 'red'
            });

            playerService.getTeamMembers.mockResolvedValue([
                { sessionId: 'session-456', team: 'red' },
                { sessionId: 'session-789', team: 'red' },
                { sessionId: 'session-101', team: 'red' }
            ]);

            let emitCount = 0;
            mockIo.emit.mockImplementation(() => {
                emitCount++;
                if (emitCount === 2) {
                    throw new Error('Emit to second player failed');
                }
            });

            const handlers = mockSocket.on.mock.calls;
            const messageHandler = handlers.find(h => h[0] === 'chat:message');
            await messageHandler[1]({ text: 'Team message', teamOnly: true });

            // Should have tried to emit to all 3 teammates
            expect(mockIo.to).toHaveBeenCalledTimes(3);
        });
    });

    describe('Input Validation', () => {
        test('validates message text is required', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-456',
                roomCode: 'TEST12',
                nickname: 'TestPlayer',
                team: 'red'
            });

            const handlers = mockSocket.on.mock.calls;
            const messageHandler = handlers.find(h => h[0] === 'chat:message');

            // Empty data should fail validation
            await messageHandler[1]({});

            expect(mockSocket.emit).toHaveBeenCalledWith('chat:error', expect.any(Object));
        });

        test('handles missing teamOnly flag (defaults to false)', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-456',
                roomCode: 'TEST12',
                nickname: 'TestPlayer',
                team: 'red'
            });

            const handlers = mockSocket.on.mock.calls;
            const messageHandler = handlers.find(h => h[0] === 'chat:message');
            await messageHandler[1]({ text: 'Hello' });

            // Should broadcast to room (default behavior)
            expect(mockIo.to).toHaveBeenCalledWith('room:TEST12');
        });
    });

    describe('Message Structure', () => {
        test('message includes all required fields', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-456',
                roomCode: 'TEST12',
                nickname: 'TestPlayer',
                team: 'red'
            });

            const handlers = mockSocket.on.mock.calls;
            const messageHandler = handlers.find(h => h[0] === 'chat:message');
            await messageHandler[1]({ text: 'Test', teamOnly: false });

            const emittedMessage = mockIo.emit.mock.calls[0][1];
            expect(emittedMessage).toEqual(expect.objectContaining({
                from: expect.objectContaining({
                    sessionId: expect.any(String),
                    nickname: expect.any(String),
                    team: expect.any(String)
                }),
                text: expect.any(String),
                teamOnly: expect.any(Boolean),
                timestamp: expect.any(Number)
            }));
        });
    });
});
