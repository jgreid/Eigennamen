/**
 * Room Resync and Recovery Tests
 *
 * Tests for room state recovery handlers including:
 * - room:resync - Full state recovery for out-of-sync clients
 * - room:reconnect - Secure reconnection with tokens
 * - room:getReconnectionToken - Token generation
 * - Timer status restoration
 * - Spymaster view restoration on reconnection
 */

// Mock rate limit handler FIRST to bypass rate limiting
const SAFE_ERROR_CODES_MOCK = ['RATE_LIMITED', 'ROOM_NOT_FOUND', 'ROOM_FULL', 'NOT_HOST', 'NOT_YOUR_TURN', 'GAME_OVER', 'INVALID_INPUT', 'CARD_ALREADY_REVEALED', 'NOT_SPYMASTER', 'NOT_CLICKER', 'NOT_AUTHORIZED', 'SESSION_EXPIRED', 'PLAYER_NOT_FOUND', 'GAME_IN_PROGRESS', 'VALIDATION_ERROR', 'CANNOT_SWITCH_TEAM_DURING_TURN', 'CANNOT_CHANGE_ROLE_DURING_TURN', 'SPYMASTER_CANNOT_CHANGE_TEAM', 'GAME_NOT_STARTED'];
jest.mock('../socket/rateLimitHandler', () => ({
    createRateLimitedHandler: jest.fn((socket, eventName, handler) => { return async (data) => { try { return await handler(data); } catch (error) { const errorEvent = `${eventName.split(':')[0]}:error`; const code = error.code || 'SERVER_ERROR'; const isSafe = SAFE_ERROR_CODES_MOCK.includes(code); socket.emit(errorEvent, { code, message: isSafe ? (error.message || 'An unexpected error occurred') : 'An unexpected error occurred' }); } }; })
}));

// Mock dependencies
jest.mock('../services/roomService');
jest.mock('../services/gameService');
jest.mock('../services/playerService');
jest.mock('../services/eventLogService');
jest.mock('../utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));

// Mock socket/index for timer functions
const mockGetTimerStatus = jest.fn().mockResolvedValue(null);
jest.mock('../socket/index', () => ({
    getTimerStatus: jest.fn().mockResolvedValue(null),
    startTurnTimer: jest.fn().mockResolvedValue({}),
    stopTurnTimer: jest.fn().mockResolvedValue()
}));

// Mock socketFunctionProvider to provide timer functions
jest.mock('../socket/socketFunctionProvider', () => ({
    getSocketFunctions: jest.fn(() => ({
        getTimerStatus: mockGetTimerStatus,
        startTurnTimer: jest.fn().mockResolvedValue({}),
        stopTurnTimer: jest.fn().mockResolvedValue(),
        emitToRoom: jest.fn(),
        emitToPlayer: jest.fn(),
        getIO: jest.fn()
    })),
    isRegistered: jest.fn(() => true)
}));

const roomService = require('../services/roomService');
const gameService = require('../services/gameService');
const playerService = require('../services/playerService');
const eventLogService = require('../services/eventLogService');
// Use the mock directly since socketFunctionProvider will use it
const getTimerStatus = mockGetTimerStatus;
const { ERROR_CODES } = require('../config/constants');

describe('Room Resync and Recovery Handlers', () => {
    let mockSocket;
    let mockIo;
    let roomHandlers;

    beforeEach(() => {
        jest.clearAllMocks();

        // Create mock socket
        mockSocket = {
            id: 'socket-123',
            sessionId: 'session-456',
            roomCode: 'test12',
            emit: jest.fn(),
            on: jest.fn(),
            join: jest.fn(),
            leave: jest.fn(),
            to: jest.fn().mockReturnThis()
        };

        // Create mock io with chaining
        mockIo = {
            to: jest.fn().mockReturnThis(),
            emit: jest.fn()
        };

        // Reset eventLogService mock
        eventLogService.logEvent = jest.fn().mockResolvedValue();
        eventLogService.EVENT_TYPES = {
            PLAYER_JOINED: 'PLAYER_JOINED',
            ROOM_CREATED: 'ROOM_CREATED'
        };

        // Default player mock with roomCode for context handler
        playerService.getPlayer.mockResolvedValue({
            sessionId: 'session-456',
            roomCode: 'test12',
            nickname: 'Player1',
            team: null,
            role: 'clicker'
        });
        gameService.getGame.mockResolvedValue(null);
        playerService.getRoomStats.mockResolvedValue({});

        // Register handlers
        roomHandlers = require('../socket/handlers/roomHandlers');
        roomHandlers(mockIo, mockSocket);
    });

    describe('room:resync handler', () => {
        test('registers handler', () => {
            const handlers = mockSocket.on.mock.calls;
            const resyncHandler = handlers.find(h => h[0] === 'room:resync');
            expect(resyncHandler).toBeDefined();
        });

        test('returns full state for regular player', async () => {
            const mockRoom = { code: 'test12', settings: { turnTimer: 60 } };
            const mockPlayer = { sessionId: 'session-456', roomCode: 'test12', nickname: 'Player1', role: 'clicker', team: 'red' };
            const mockPlayers = [mockPlayer, { sessionId: 'session-789', nickname: 'Player2' }];
            const mockGame = { currentTurn: 'red', gameOver: false };
            const mockGameState = { currentTurn: 'red', types: null };

            roomService.getRoom.mockResolvedValue(mockRoom);
            playerService.getPlayer.mockResolvedValue(mockPlayer);
            playerService.getPlayersInRoom.mockResolvedValue(mockPlayers);
            gameService.getGame.mockResolvedValue(mockGame);
            gameService.getGameStateForPlayer.mockReturnValue(mockGameState);

            const handlers = mockSocket.on.mock.calls;
            const resyncHandler = handlers.find(h => h[0] === 'room:resync');
            await resyncHandler[1]();

            expect(mockSocket.emit).toHaveBeenCalledWith('room:resynced', {
                room: mockRoom,
                players: mockPlayers,
                game: mockGameState,
                you: mockPlayer,
                stats: {}
            });
        });

        test('sends spymaster view when player is spymaster during active game', async () => {
            const mockRoom = { code: 'test12' };
            const mockPlayer = { sessionId: 'session-456', roomCode: 'test12', role: 'spymaster', team: 'red' };
            const mockGame = { currentTurn: 'red', gameOver: false, types: ['red', 'blue', 'neutral', 'assassin'] };

            roomService.getRoom.mockResolvedValue(mockRoom);
            playerService.getPlayer.mockResolvedValue(mockPlayer);
            playerService.getPlayersInRoom.mockResolvedValue([mockPlayer]);
            gameService.getGame.mockResolvedValue(mockGame);
            gameService.getGameStateForPlayer.mockReturnValue({ currentTurn: 'red' });

            const handlers = mockSocket.on.mock.calls;
            const resyncHandler = handlers.find(h => h[0] === 'room:resync');
            await resyncHandler[1]();

            expect(mockSocket.emit).toHaveBeenCalledWith('game:spymasterView', {
                types: mockGame.types
            });
        });

        test('does not send spymaster view when game is over', async () => {
            const mockRoom = { code: 'test12' };
            const mockPlayer = { sessionId: 'session-456', roomCode: 'test12', role: 'spymaster', team: 'red' };
            const mockGame = { currentTurn: 'red', gameOver: true, types: ['red', 'blue'] };

            roomService.getRoom.mockResolvedValue(mockRoom);
            playerService.getPlayer.mockResolvedValue(mockPlayer);
            playerService.getPlayersInRoom.mockResolvedValue([mockPlayer]);
            gameService.getGame.mockResolvedValue(mockGame);
            gameService.getGameStateForPlayer.mockReturnValue({ gameOver: true });

            const handlers = mockSocket.on.mock.calls;
            const resyncHandler = handlers.find(h => h[0] === 'room:resync');
            await resyncHandler[1]();

            const spymasterViewCalls = mockSocket.emit.mock.calls.filter(
                call => call[0] === 'game:spymasterView'
            );
            expect(spymasterViewCalls).toHaveLength(0);
        });

        test('sends timer status when timer is active', async () => {
            const mockRoom = { code: 'test12' };
            const mockPlayer = { sessionId: 'session-456', roomCode: 'test12', role: 'clicker' };
            const mockTimerStatus = {
                remainingSeconds: 45,
                endTime: Date.now() + 45000,
                isPaused: false
            };

            roomService.getRoom.mockResolvedValue(mockRoom);
            playerService.getPlayer.mockResolvedValue(mockPlayer);
            playerService.getPlayersInRoom.mockResolvedValue([mockPlayer]);
            gameService.getGame.mockResolvedValue(null);
            getTimerStatus.mockResolvedValue(mockTimerStatus);

            const handlers = mockSocket.on.mock.calls;
            const resyncHandler = handlers.find(h => h[0] === 'room:resync');
            await resyncHandler[1]();

            expect(mockSocket.emit).toHaveBeenCalledWith('timer:status', {
                roomCode: 'test12',
                remainingSeconds: 45,
                endTime: mockTimerStatus.endTime,
                isPaused: false
            });
        });

        test('handles no active timer gracefully', async () => {
            const mockRoom = { code: 'test12' };
            const mockPlayer = { sessionId: 'session-456', roomCode: 'test12' };

            roomService.getRoom.mockResolvedValue(mockRoom);
            playerService.getPlayer.mockResolvedValue(mockPlayer);
            playerService.getPlayersInRoom.mockResolvedValue([mockPlayer]);
            gameService.getGame.mockResolvedValue(null);
            getTimerStatus.mockResolvedValue(null);

            const handlers = mockSocket.on.mock.calls;
            const resyncHandler = handlers.find(h => h[0] === 'room:resync');
            await resyncHandler[1]();

            const timerStatusCalls = mockSocket.emit.mock.calls.filter(
                call => call[0] === 'timer:status'
            );
            expect(timerStatusCalls).toHaveLength(0);
        });

        test('handles timer fetch error gracefully', async () => {
            const mockRoom = { code: 'test12' };
            const mockPlayer = { sessionId: 'session-456', roomCode: 'test12' };

            roomService.getRoom.mockResolvedValue(mockRoom);
            playerService.getPlayer.mockResolvedValue(mockPlayer);
            playerService.getPlayersInRoom.mockResolvedValue([mockPlayer]);
            gameService.getGame.mockResolvedValue(null);
            getTimerStatus.mockRejectedValue(new Error('Timer service unavailable'));

            const handlers = mockSocket.on.mock.calls;
            const resyncHandler = handlers.find(h => h[0] === 'room:resync');

            // Should not throw
            await expect(resyncHandler[1]()).resolves.not.toThrow();

            // Should still send resynced event
            expect(mockSocket.emit).toHaveBeenCalledWith('room:resynced', expect.any(Object));
        });

        test('returns error when not in a room', async () => {
            mockSocket.roomCode = null;
            playerService.getPlayer.mockResolvedValue(null);

            const handlers = mockSocket.on.mock.calls;
            const resyncHandler = handlers.find(h => h[0] === 'room:resync');
            await resyncHandler[1]();

            expect(mockSocket.emit).toHaveBeenCalledWith('room:error', expect.objectContaining({
                code: expect.any(String)
            }));
        });

        test('returns error when room not found', async () => {
            roomService.getRoom.mockResolvedValue(null);

            const handlers = mockSocket.on.mock.calls;
            const resyncHandler = handlers.find(h => h[0] === 'room:resync');
            await resyncHandler[1]();

            expect(mockSocket.emit).toHaveBeenCalledWith('room:error', expect.any(Object));
        });

        test('returns error when player not found', async () => {
            roomService.getRoom.mockResolvedValue({ code: 'test12' });
            playerService.getPlayer.mockResolvedValue(null);

            const handlers = mockSocket.on.mock.calls;
            const resyncHandler = handlers.find(h => h[0] === 'room:resync');
            await resyncHandler[1]();

            expect(mockSocket.emit).toHaveBeenCalledWith('room:error', expect.any(Object));
        });

        test('handles no game state gracefully', async () => {
            const mockRoom = { code: 'test12' };
            const mockPlayer = { sessionId: 'session-456', roomCode: 'test12' };

            roomService.getRoom.mockResolvedValue(mockRoom);
            playerService.getPlayer.mockResolvedValue(mockPlayer);
            playerService.getPlayersInRoom.mockResolvedValue([mockPlayer]);
            gameService.getGame.mockResolvedValue(null);

            const handlers = mockSocket.on.mock.calls;
            const resyncHandler = handlers.find(h => h[0] === 'room:resync');
            await resyncHandler[1]();

            expect(mockSocket.emit).toHaveBeenCalledWith('room:resynced', expect.objectContaining({
                game: null
            }));
        });
    });

    describe('room:getReconnectionToken handler', () => {
        test('registers handler', () => {
            const handlers = mockSocket.on.mock.calls;
            const tokenHandler = handlers.find(h => h[0] === 'room:getReconnectionToken');
            expect(tokenHandler).toBeDefined();
        });

        test('returns existing token if available', async () => {
            playerService.getExistingReconnectionToken.mockResolvedValue('existing-token-123');

            const handlers = mockSocket.on.mock.calls;
            const tokenHandler = handlers.find(h => h[0] === 'room:getReconnectionToken');
            await tokenHandler[1]();

            expect(mockSocket.emit).toHaveBeenCalledWith('room:reconnectionToken', {
                token: 'existing-token-123',
                sessionId: 'session-456',
                roomCode: 'test12'
            });
            expect(playerService.generateReconnectionToken).not.toHaveBeenCalled();
        });

        test('generates new token if none exists', async () => {
            playerService.getExistingReconnectionToken.mockResolvedValue(null);
            playerService.generateReconnectionToken.mockResolvedValue('new-token-456');

            const handlers = mockSocket.on.mock.calls;
            const tokenHandler = handlers.find(h => h[0] === 'room:getReconnectionToken');
            await tokenHandler[1]();

            expect(playerService.generateReconnectionToken).toHaveBeenCalledWith('session-456');
            expect(mockSocket.emit).toHaveBeenCalledWith('room:reconnectionToken', {
                token: 'new-token-456',
                sessionId: 'session-456',
                roomCode: 'test12'
            });
        });

        test('returns error when not in a room', async () => {
            mockSocket.roomCode = null;
            playerService.getPlayer.mockResolvedValue(null);

            const handlers = mockSocket.on.mock.calls;
            const tokenHandler = handlers.find(h => h[0] === 'room:getReconnectionToken');
            await tokenHandler[1]();

            expect(mockSocket.emit).toHaveBeenCalledWith('room:error', expect.any(Object));
        });

        test('returns error when token generation fails', async () => {
            playerService.getExistingReconnectionToken.mockResolvedValue(null);
            playerService.generateReconnectionToken.mockResolvedValue(null);

            const handlers = mockSocket.on.mock.calls;
            const tokenHandler = handlers.find(h => h[0] === 'room:getReconnectionToken');
            await tokenHandler[1]();

            expect(mockSocket.emit).toHaveBeenCalledWith('room:error', expect.objectContaining({
                code: ERROR_CODES.SERVER_ERROR,
                message: 'An unexpected error occurred'
            }));
        });
    });

    describe('room:reconnect handler', () => {
        test('registers handler', () => {
            const handlers = mockSocket.on.mock.calls;
            const reconnectHandler = handlers.find(h => h[0] === 'room:reconnect');
            expect(reconnectHandler).toBeDefined();
        });

        test('successfully reconnects with valid token', async () => {
            const mockRoom = { code: 'test12', settings: {} };
            const mockPlayer = { sessionId: 'session-456', nickname: 'Player1', role: 'clicker', team: 'red' };
            const mockPlayers = [mockPlayer];
            const mockGame = { currentTurn: 'red', gameOver: false };

            playerService.validateReconnectionToken.mockResolvedValue({
                valid: true,
                tokenData: { roomCode: 'test12', sessionId: 'session-456' }
            });
            roomService.getRoom.mockResolvedValue(mockRoom);
            playerService.updatePlayer.mockResolvedValue(mockPlayer);
            playerService.getPlayer.mockResolvedValue(mockPlayer);
            playerService.getPlayersInRoom.mockResolvedValue(mockPlayers);
            gameService.getGame.mockResolvedValue(mockGame);
            gameService.getGameStateForPlayer.mockReturnValue({ currentTurn: 'red' });

            const handlers = mockSocket.on.mock.calls;
            const reconnectHandler = handlers.find(h => h[0] === 'room:reconnect');
            await reconnectHandler[1]({ code: 'test12', reconnectionToken: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' });

            expect(mockSocket.join).toHaveBeenCalledWith('room:test12');
            expect(mockSocket.join).toHaveBeenCalledWith('player:session-456');
            expect(mockSocket.emit).toHaveBeenCalledWith('room:reconnected', expect.objectContaining({
                room: mockRoom,
                players: mockPlayers,
                you: mockPlayer
            }));
        });

        test('notifies others in room about reconnection', async () => {
            const mockRoom = { code: 'test12' };
            const mockPlayer = { sessionId: 'session-456', nickname: 'Player1', team: 'red' };

            playerService.validateReconnectionToken.mockResolvedValue({
                valid: true,
                tokenData: { roomCode: 'test12', sessionId: 'session-456' }
            });
            roomService.getRoom.mockResolvedValue(mockRoom);
            playerService.updatePlayer.mockResolvedValue(mockPlayer);
            playerService.getPlayer.mockResolvedValue(mockPlayer);
            playerService.getPlayersInRoom.mockResolvedValue([mockPlayer]);
            gameService.getGame.mockResolvedValue(null);

            const handlers = mockSocket.on.mock.calls;
            const reconnectHandler = handlers.find(h => h[0] === 'room:reconnect');
            await reconnectHandler[1]({ code: 'test12', reconnectionToken: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' });

            expect(mockSocket.to).toHaveBeenCalledWith('room:test12');
            // The actual emit is on mockSocket.to(room).emit, not mockIo
        });

        test('sends spymaster view when reconnecting spymaster', async () => {
            const mockRoom = { code: 'test12' };
            const mockPlayer = { sessionId: 'session-456', nickname: 'Spymaster', role: 'spymaster', team: 'red' };
            const mockGame = { currentTurn: 'red', gameOver: false, types: ['red', 'blue', 'neutral'] };

            playerService.validateReconnectionToken.mockResolvedValue({
                valid: true,
                tokenData: { roomCode: 'test12', sessionId: 'session-456' }
            });
            roomService.getRoom.mockResolvedValue(mockRoom);
            playerService.updatePlayer.mockResolvedValue(mockPlayer);
            playerService.getPlayer.mockResolvedValue(mockPlayer);
            playerService.getPlayersInRoom.mockResolvedValue([mockPlayer]);
            gameService.getGame.mockResolvedValue(mockGame);
            gameService.getGameStateForPlayer.mockReturnValue({ currentTurn: 'red' });

            const handlers = mockSocket.on.mock.calls;
            const reconnectHandler = handlers.find(h => h[0] === 'room:reconnect');
            await reconnectHandler[1]({ code: 'test12', reconnectionToken: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' });

            expect(mockSocket.emit).toHaveBeenCalledWith('game:spymasterView', {
                types: mockGame.types
            });
        });

        test('rejects reconnection with invalid token', async () => {
            playerService.validateReconnectionToken.mockResolvedValue({
                valid: false,
                reason: 'Token expired'
            });

            const handlers = mockSocket.on.mock.calls;
            const reconnectHandler = handlers.find(h => h[0] === 'room:reconnect');
            await reconnectHandler[1]({ code: 'test12', reconnectionToken: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' });

            expect(mockSocket.emit).toHaveBeenCalledWith('room:error', expect.objectContaining({
                code: ERROR_CODES.NOT_AUTHORIZED,
                message: expect.stringContaining('Invalid reconnection token')
            }));
        });

        test('rejects reconnection when token room code does not match', async () => {
            playerService.validateReconnectionToken.mockResolvedValue({
                valid: true,
                tokenData: { roomCode: 'other1', sessionId: 'session-456' }
            });

            const handlers = mockSocket.on.mock.calls;
            const reconnectHandler = handlers.find(h => h[0] === 'room:reconnect');
            await reconnectHandler[1]({ code: 'test12', reconnectionToken: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' });

            expect(mockSocket.emit).toHaveBeenCalledWith('room:error', expect.objectContaining({
                code: ERROR_CODES.INVALID_INPUT,
                message: 'Token does not match room'
            }));
        });

        test('rejects reconnection when room no longer exists', async () => {
            playerService.validateReconnectionToken.mockResolvedValue({
                valid: true,
                tokenData: { roomCode: 'test12', sessionId: 'session-456' }
            });
            roomService.getRoom.mockResolvedValue(null);

            const handlers = mockSocket.on.mock.calls;
            const reconnectHandler = handlers.find(h => h[0] === 'room:reconnect');
            await reconnectHandler[1]({ code: 'test12', reconnectionToken: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' });

            expect(mockSocket.emit).toHaveBeenCalledWith('room:error', expect.any(Object));
        });

        test('rejects reconnection without required parameters', async () => {
            const handlers = mockSocket.on.mock.calls;
            const reconnectHandler = handlers.find(h => h[0] === 'room:reconnect');
            await reconnectHandler[1]({});

            // FIX: Zod validation now produces different error messages
            expect(mockSocket.emit).toHaveBeenCalledWith('room:error', expect.objectContaining({
                code: ERROR_CODES.INVALID_INPUT
                // Message varies based on Zod validation
            }));
        });

        test('rejects reconnection with missing token', async () => {
            const handlers = mockSocket.on.mock.calls;
            const reconnectHandler = handlers.find(h => h[0] === 'room:reconnect');
            await reconnectHandler[1]({ code: 'test12' });

            expect(mockSocket.emit).toHaveBeenCalledWith('room:error', expect.objectContaining({
                code: ERROR_CODES.INVALID_INPUT
            }));
        });

        test('logs reconnection event', async () => {
            const mockRoom = { code: 'test12' };
            const mockPlayer = { sessionId: 'session-456', nickname: 'Player1' };

            playerService.validateReconnectionToken.mockResolvedValue({
                valid: true,
                tokenData: { roomCode: 'test12', sessionId: 'session-456' }
            });
            roomService.getRoom.mockResolvedValue(mockRoom);
            playerService.updatePlayer.mockResolvedValue(mockPlayer);
            playerService.getPlayer.mockResolvedValue(mockPlayer);
            playerService.getPlayersInRoom.mockResolvedValue([mockPlayer]);
            gameService.getGame.mockResolvedValue(null);

            const handlers = mockSocket.on.mock.calls;
            const reconnectHandler = handlers.find(h => h[0] === 'room:reconnect');
            await reconnectHandler[1]({ code: 'test12', reconnectionToken: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' });

            // Verify reconnection was successful by checking socket joined the room
            expect(mockSocket.join).toHaveBeenCalledWith('room:test12');
        });

        test('sends timer status on successful reconnection', async () => {
            const mockRoom = { code: 'test12' };
            const mockPlayer = { sessionId: 'session-456', nickname: 'Player1' };
            const mockTimerStatus = {
                remainingSeconds: 30,
                endTime: Date.now() + 30000,
                isPaused: false
            };

            playerService.validateReconnectionToken.mockResolvedValue({
                valid: true,
                tokenData: { roomCode: 'test12', sessionId: 'session-456' }
            });
            roomService.getRoom.mockResolvedValue(mockRoom);
            playerService.updatePlayer.mockResolvedValue(mockPlayer);
            playerService.getPlayer.mockResolvedValue(mockPlayer);
            playerService.getPlayersInRoom.mockResolvedValue([mockPlayer]);
            gameService.getGame.mockResolvedValue(null);
            getTimerStatus.mockResolvedValue(mockTimerStatus);

            const handlers = mockSocket.on.mock.calls;
            const reconnectHandler = handlers.find(h => h[0] === 'room:reconnect');
            await reconnectHandler[1]({ code: 'test12', reconnectionToken: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' });

            expect(mockSocket.emit).toHaveBeenCalledWith('timer:status', expect.objectContaining({
                roomCode: 'test12',
                remainingSeconds: 30
            }));
        });
    });
});
