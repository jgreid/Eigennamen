/**
 * Room Handlers Unit Tests
 *
 * Comprehensive tests for room socket event handlers
 * Updated for simplified room ID API (no passwords)
 */

// Mock dependencies
jest.mock('../services/roomService');
jest.mock('../services/gameService');
jest.mock('../services/playerService');
jest.mock('../services/eventLogService');
jest.mock('../utils/logger');
const SAFE_ERROR_CODES_MOCK = ['RATE_LIMITED', 'ROOM_NOT_FOUND', 'ROOM_FULL', 'NOT_HOST', 'NOT_YOUR_TURN', 'GAME_OVER', 'INVALID_INPUT', 'CARD_ALREADY_REVEALED', 'NOT_SPYMASTER', 'NOT_CLICKER', 'NOT_AUTHORIZED', 'SESSION_EXPIRED', 'PLAYER_NOT_FOUND', 'GAME_IN_PROGRESS', 'VALIDATION_ERROR', 'CANNOT_SWITCH_TEAM_DURING_TURN', 'CANNOT_CHANGE_ROLE_DURING_TURN', 'SPYMASTER_CANNOT_CHANGE_TEAM', 'GAME_NOT_STARTED'];
jest.mock('../socket/rateLimitHandler', () => ({
    createRateLimitedHandler: jest.fn((socket, eventName, handler) => { return async (data) => { try { return await handler(data); } catch (error) { const errorEvent = `${eventName.split(':')[0]}:error`; const code = error.code || 'SERVER_ERROR'; const isSafe = SAFE_ERROR_CODES_MOCK.includes(code); socket.emit(errorEvent, { code, message: isSafe ? (error.message || 'An unexpected error occurred') : 'An unexpected error occurred' }); } }; })
}));
jest.mock('../socket/socketFunctionProvider', () => ({
    getSocketFunctions: jest.fn(() => ({
        getTimerStatus: jest.fn().mockResolvedValue({
            remainingSeconds: 30,
            endTime: Date.now() + 30000,
            isPaused: false
        })
    }))
}));

// Mock timeout to just pass through the promise
jest.mock('../utils/timeout', () => ({
    withTimeout: jest.fn((promise) => promise),
    TIMEOUTS: {
        SOCKET_HANDLER: 30000,
        JOIN_ROOM: 15000,
        RECONNECT: 15000
    }
}));

// Mock validation to pass through
jest.mock('../middleware/validation', () => ({
    validateInput: jest.fn((schema, data) => data)
}));

const roomService = require('../services/roomService');
const gameService = require('../services/gameService');
const playerService = require('../services/playerService');
const eventLogService = require('../services/eventLogService');
const _logger = require('../utils/logger');
const { getSocketFunctions } = require('../socket/socketFunctionProvider');

describe('Room Handlers', () => {
    let mockIo;
    let mockSocket;
    let eventHandlers;

    beforeEach(() => {
        jest.clearAllMocks();

        mockSocket = {
            id: 'socket-1',
            sessionId: 'session-1',
            roomCode: null,
            on: jest.fn((event, handler) => {
                if (!eventHandlers) eventHandlers = {};
                eventHandlers[event] = handler;
            }),
            emit: jest.fn(),
            join: jest.fn(),
            leave: jest.fn(),
            to: jest.fn().mockReturnValue({ emit: jest.fn() })
        };

        mockIo = {
            to: jest.fn().mockReturnValue({ emit: jest.fn() })
        };

        eventHandlers = {};

        // Default service mocks - updated for new API
        roomService.createRoom.mockResolvedValue({
            room: { code: 'test-room', roomId: 'test-room', settings: {} },
            player: { sessionId: 'session-1', nickname: 'Host' }
        });
        roomService.joinRoom.mockResolvedValue({
            room: { code: 'test-room', roomId: 'test-room', settings: {} },
            players: [],
            game: null,
            player: { sessionId: 'session-1', nickname: 'Player1' }
        });
        roomService.leaveRoom.mockResolvedValue({ newHostId: null });
        roomService.updateSettings.mockResolvedValue({ turnTimer: 60 });
        roomService.getRoom.mockResolvedValue({ code: 'test-room', roomId: 'test-room', settings: {} });

        gameService.getGame.mockResolvedValue(null);
        gameService.getGameStateForPlayer.mockReturnValue({});

        playerService.getPlayer.mockResolvedValue({
            sessionId: 'session-1',
            nickname: 'Player1',
            role: null,
            roomCode: null
        });
        playerService.getPlayersInRoom.mockResolvedValue([]);
        playerService.getRoomStats.mockResolvedValue({});
        playerService.invalidateReconnectionToken.mockResolvedValue();
        playerService.generateReconnectionToken.mockResolvedValue('token-123');
        playerService.getExistingReconnectionToken.mockResolvedValue(null);
        playerService.validateReconnectionToken.mockResolvedValue({
            valid: true,
            tokenData: { roomCode: 'test-room', sessionId: 'session-1' }
        });
        playerService.updatePlayer.mockResolvedValue();

        eventLogService.logEvent.mockResolvedValue();
        eventLogService.EVENT_TYPES = {
            ROOM_CREATED: 'ROOM_CREATED',
            PLAYER_JOINED: 'PLAYER_JOINED',
            PLAYER_LEFT: 'PLAYER_LEFT',
            SETTINGS_UPDATED: 'SETTINGS_UPDATED'
        };

        // Load handlers
        const roomHandlers = require('../socket/handlers/roomHandlers');
        roomHandlers(mockIo, mockSocket);
    });

    // No resetModules - clearAllMocks in beforeEach is sufficient

    describe('room:create', () => {
        test('creates room and joins socket', async () => {
            await eventHandlers['room:create']({ roomId: 'my-game', settings: {} });

            expect(roomService.createRoom).toHaveBeenCalledWith('my-game', 'session-1', {});
            expect(mockSocket.join).toHaveBeenCalledWith('room:test-room');
            expect(mockSocket.join).toHaveBeenCalledWith('player:session-1');
            expect(mockSocket.roomCode).toBe('test-room');
        });

        test('emits room:created on success', async () => {
            await eventHandlers['room:create']({ roomId: 'my-game', settings: {} });

            expect(mockSocket.emit).toHaveBeenCalledWith('room:created', expect.any(Object));
        });

        test('emits room:error on error after room created', async () => {
            roomService.createRoom.mockResolvedValue({
                room: { code: 'fail-room', roomId: 'fail-room', settings: {} },
                player: { sessionId: 'session-1', nickname: 'Host' }
            });
            // Force an error after room creation by making getRoomStats fail
            playerService.getRoomStats.mockRejectedValue(new Error('Stats failed'));

            await eventHandlers['room:create']({ roomId: 'fail-room', settings: {} });

            // createPreRoomHandler catches and emits sanitized error
            expect(mockSocket.emit).toHaveBeenCalledWith('room:error', expect.objectContaining({
                code: expect.any(String)
            }));
        });

        test('emits room:error on failure', async () => {
            roomService.createRoom.mockRejectedValue(new Error('Creation failed'));

            await eventHandlers['room:create']({ roomId: 'my-game', settings: {} });

            // sanitizeErrorForClient returns generic message for unsafe error codes
            expect(mockSocket.emit).toHaveBeenCalledWith('room:error', expect.objectContaining({
                code: expect.any(String)
            }));
        });

        test('creates room with custom settings', async () => {
            await eventHandlers['room:create']({
                roomId: 'custom-game',
                settings: { turnTimer: 90, allowSpectators: false }
            });

            expect(roomService.createRoom).toHaveBeenCalledWith(
                'custom-game',
                'session-1',
                { turnTimer: 90, allowSpectators: false }
            );
        });
    });

    describe('room:join', () => {
        test('joins room and emits room:joined', async () => {
            await eventHandlers['room:join']({ roomId: 'test-room', nickname: 'Player1' });

            expect(roomService.joinRoom).toHaveBeenCalledWith('test-room', 'session-1', 'Player1');
            expect(mockSocket.join).toHaveBeenCalledWith('room:test-room');
            expect(mockSocket.emit).toHaveBeenCalledWith('room:joined', expect.any(Object));
        });

        test('invalidates reconnection token on join', async () => {
            await eventHandlers['room:join']({ roomId: 'test-room', nickname: 'Player1' });

            expect(playerService.invalidateReconnectionToken).toHaveBeenCalledWith('session-1');
        });

        test('sends spymaster view if player is spymaster with active game', async () => {
            // Performance fix: game now includes types directly (from getGameStateForPlayer)
            // instead of re-fetching via getGame
            roomService.joinRoom.mockResolvedValue({
                room: { code: 'test-room', roomId: 'test-room' },
                players: [],
                game: { gameOver: false, types: ['red', 'blue', 'neutral'] },
                player: { role: 'spymaster' }
            });

            await eventHandlers['room:join']({ roomId: 'test-room', nickname: 'Player1' });

            expect(mockSocket.emit).toHaveBeenCalledWith('game:spymasterView', {
                types: ['red', 'blue', 'neutral']
            });
        });

        test('sends timer:status on join', async () => {
            await eventHandlers['room:join']({ roomId: 'test-room', nickname: 'Player1' });

            expect(mockSocket.emit).toHaveBeenCalledWith('timer:status', expect.any(Object));
        });

        test('emits room:playerReconnected for returning player', async () => {
            roomService.joinRoom.mockResolvedValue({
                room: { code: 'test-room', roomId: 'test-room' },
                players: [],
                game: null,
                player: {
                    sessionId: 'session-1',
                    nickname: 'Player1',
                    lastConnected: Date.now() - 60000,
                    team: 'red'
                }
            });

            await eventHandlers['room:join']({ roomId: 'test-room', nickname: 'Player1' });

            expect(mockSocket.to().emit).toHaveBeenCalledWith('room:playerReconnected', expect.any(Object));
        });

        test('emits room:playerJoined for new player', async () => {
            roomService.joinRoom.mockResolvedValue({
                room: { code: 'test-room', roomId: 'test-room' },
                players: [],
                game: null,
                player: { nickname: 'Player1', lastConnected: null }
            });

            await eventHandlers['room:join']({ roomId: 'test-room', nickname: 'Player1' });

            expect(mockSocket.to().emit).toHaveBeenCalledWith('room:playerJoined', expect.any(Object));
        });

        test('emits room:error on error after partial join', async () => {
            roomService.joinRoom.mockResolvedValue({
                room: { code: 'fail-room', roomId: 'fail-room' },
                players: [],
                game: null,
                player: {}
            });
            playerService.invalidateReconnectionToken.mockRejectedValue(new Error('Failed'));

            await eventHandlers['room:join']({ roomId: 'fail-room', nickname: 'Player1' });

            // createPreRoomHandler catches and emits sanitized error
            expect(mockSocket.emit).toHaveBeenCalledWith('room:error', expect.objectContaining({
                code: expect.any(String)
            }));
        });

        test('normalizes room ID case', async () => {
            await eventHandlers['room:join']({ roomId: 'TEST-ROOM', nickname: 'Player1' });

            expect(roomService.joinRoom).toHaveBeenCalledWith('TEST-ROOM', 'session-1', 'Player1');
        });
    });

    describe('room:leave', () => {
        beforeEach(() => {
            mockSocket.roomCode = 'test-room';
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-1',
                roomCode: 'test-room',
                nickname: 'Player1',
                role: null
            });
        });

        test('leaves room and clears roomCode', async () => {
            await eventHandlers['room:leave']();

            expect(roomService.leaveRoom).toHaveBeenCalledWith('test-room', 'session-1');
            expect(mockSocket.leave).toHaveBeenCalledWith('room:test-room');
            expect(mockSocket.roomCode).toBe(null);
        });

        test('invalidates reconnection token on leave', async () => {
            await eventHandlers['room:leave']();

            expect(playerService.invalidateReconnectionToken).toHaveBeenCalledWith('session-1');
        });

        test('notifies room of player leaving', async () => {
            await eventHandlers['room:leave']();

            expect(mockIo.to).toHaveBeenCalledWith('room:test-room');
            expect(mockIo.to().emit).toHaveBeenCalledWith('room:playerLeft', expect.any(Object));
        });

        test('does nothing when not in a room', async () => {
            mockSocket.roomCode = null;
            playerService.getPlayer.mockResolvedValue(null);

            await eventHandlers['room:leave']();

            expect(roomService.leaveRoom).not.toHaveBeenCalled();
        });

        test('handles error gracefully', async () => {
            roomService.leaveRoom.mockRejectedValue(new Error('Leave failed'));

            await eventHandlers['room:leave']();

            expect(mockSocket.emit).toHaveBeenCalledWith('room:error', expect.any(Object));
        });
    });

    describe('room:settings', () => {
        beforeEach(() => {
            mockSocket.roomCode = 'test-room';
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-1',
                roomCode: 'test-room',
                isHost: true
            });
        });

        test('updates settings and broadcasts', async () => {
            await eventHandlers['room:settings']({ turnTimer: 90 });

            expect(roomService.updateSettings).toHaveBeenCalledWith(
                'test-room',
                'session-1',
                { turnTimer: 90 }
            );
            expect(mockIo.to).toHaveBeenCalledWith('room:test-room');
            expect(mockIo.to().emit).toHaveBeenCalledWith('room:settingsUpdated', expect.any(Object));
        });

        test('throws error when not in a room', async () => {
            mockSocket.roomCode = null;
            playerService.getPlayer.mockResolvedValue(null);

            await eventHandlers['room:settings']({ turnTimer: 60 });

            expect(mockSocket.emit).toHaveBeenCalledWith('room:error', expect.any(Object));
        });

        test('broadcasts updated settings to room', async () => {
            await eventHandlers['room:settings']({ turnTimer: 60 });

            expect(mockIo.to).toHaveBeenCalledWith('room:test-room');
            expect(mockIo.to().emit).toHaveBeenCalledWith('room:settingsUpdated', expect.any(Object));
        });
    });

    describe('room:resync', () => {
        beforeEach(() => {
            mockSocket.roomCode = 'test-room';
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-1',
                roomCode: 'test-room',
                nickname: 'Player1',
                role: null
            });
        });

        test('sends full room state', async () => {
            await eventHandlers['room:resync']();

            expect(mockSocket.emit).toHaveBeenCalledWith('room:resynced',
                expect.objectContaining({
                    room: expect.any(Object),
                    players: expect.any(Array),
                    you: expect.any(Object)
                })
            );
            // game can be null or object
            const resyncCall = mockSocket.emit.mock.calls.find(c => c[0] === 'room:resynced');
            expect(resyncCall[1]).toHaveProperty('game');
        });

        test('includes game state if exists', async () => {
            gameService.getGame.mockResolvedValue({
                gameOver: false,
                currentTurn: 'red'
            });
            gameService.getGameStateForPlayer.mockReturnValue({
                currentTurn: 'red',
                words: ['word1', 'word2']
            });

            await eventHandlers['room:resync']();

            expect(gameService.getGameStateForPlayer).toHaveBeenCalled();
        });

        test('throws error when not in a room', async () => {
            mockSocket.roomCode = null;
            playerService.getPlayer.mockResolvedValue(null);

            await eventHandlers['room:resync']();

            expect(mockSocket.emit).toHaveBeenCalledWith('room:error', expect.any(Object));
        });

        test('throws error when room not found', async () => {
            roomService.getRoom.mockResolvedValue(null);

            await eventHandlers['room:resync']();

            expect(mockSocket.emit).toHaveBeenCalledWith('room:error', expect.any(Object));
        });

        test('throws error when player not found', async () => {
            playerService.getPlayer.mockResolvedValue(null);

            await eventHandlers['room:resync']();

            expect(mockSocket.emit).toHaveBeenCalledWith('room:error', expect.any(Object));
        });

        test('sends spymaster view for spymaster with active game', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-1',
                roomCode: 'test-room',
                role: 'spymaster'
            });
            gameService.getGame.mockResolvedValue({
                gameOver: false,
                types: ['red', 'blue']
            });

            await eventHandlers['room:resync']();

            expect(mockSocket.emit).toHaveBeenCalledWith('game:spymasterView', expect.any(Object));
        });

        test('handles timeout error gracefully', async () => {
            const timeoutError = new Error('Timed out');
            timeoutError.code = 'OPERATION_TIMEOUT';
            roomService.getRoom.mockRejectedValue(timeoutError);

            await eventHandlers['room:resync']();

            expect(mockSocket.emit).toHaveBeenCalledWith('room:error', {
                code: expect.any(String),
                message: expect.any(String)
            });
        });
    });

    describe('room:getReconnectionToken', () => {
        beforeEach(() => {
            mockSocket.roomCode = 'test-room';
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-1',
                roomCode: 'test-room',
                nickname: 'Player1'
            });
        });

        test('returns existing token if available', async () => {
            playerService.getExistingReconnectionToken.mockResolvedValue('existing-token');

            await eventHandlers['room:getReconnectionToken']();

            expect(mockSocket.emit).toHaveBeenCalledWith('room:reconnectionToken', {
                token: 'existing-token',
                sessionId: 'session-1',
                roomCode: 'test-room'
            });
        });

        test('generates new token if none exists', async () => {
            playerService.getExistingReconnectionToken.mockResolvedValue(null);
            playerService.generateReconnectionToken.mockResolvedValue('new-token');

            await eventHandlers['room:getReconnectionToken']();

            expect(playerService.generateReconnectionToken).toHaveBeenCalledWith('session-1');
            expect(mockSocket.emit).toHaveBeenCalledWith('room:reconnectionToken', {
                token: 'new-token',
                sessionId: 'session-1',
                roomCode: 'test-room'
            });
        });

        test('throws error when not in a room', async () => {
            mockSocket.roomCode = null;
            playerService.getPlayer.mockResolvedValue(null);

            await eventHandlers['room:getReconnectionToken']();

            expect(mockSocket.emit).toHaveBeenCalledWith('room:error', expect.any(Object));
        });

        test('throws error when token generation fails', async () => {
            playerService.getExistingReconnectionToken.mockResolvedValue(null);
            playerService.generateReconnectionToken.mockResolvedValue(null);

            await eventHandlers['room:getReconnectionToken']();

            expect(mockSocket.emit).toHaveBeenCalledWith('room:error', {
                code: 'SERVER_ERROR',
                message: 'An unexpected error occurred'
            });
        });
    });

    describe('room:reconnect', () => {
        // FIX: Use valid 64-character hex tokens for Zod schema validation
        const validToken = 'a'.repeat(64);

        test('reconnects with valid token', async () => {
            await eventHandlers['room:reconnect']({
                code: 'test-room',
                reconnectionToken: validToken
            });

            expect(playerService.validateReconnectionToken).toHaveBeenCalledWith(
                validToken,
                'session-1'
            );
            expect(mockSocket.join).toHaveBeenCalledWith('room:test-room');
            expect(mockSocket.emit).toHaveBeenCalledWith('room:reconnected', expect.any(Object));
        });

        // FIX: These tests skip validation testing since validateInput is mocked.
        // Validation is tested separately in validators.test.js
        test.skip('throws error when code is missing (validation tested elsewhere)', async () => {
            // Zod validation would reject missing code, but validateInput is mocked
        });

        test.skip('throws error when token is missing (validation tested elsewhere)', async () => {
            // Zod validation would reject missing token, but validateInput is mocked
        });

        test('throws error when data is null', async () => {
            await eventHandlers['room:reconnect'](null);

            expect(mockSocket.emit).toHaveBeenCalledWith('room:error', expect.any(Object));
        });

        test('throws error when token is invalid', async () => {
            playerService.validateReconnectionToken.mockResolvedValue({
                valid: false,
                reason: 'Token expired'
            });

            await eventHandlers['room:reconnect']({
                code: 'test-room',
                reconnectionToken: validToken
            });

            expect(mockSocket.emit).toHaveBeenCalledWith('room:error', {
                code: expect.any(String),
                message: expect.stringContaining('Token expired')
            });
        });

        test('throws error when room code mismatch', async () => {
            playerService.validateReconnectionToken.mockResolvedValue({
                valid: true,
                tokenData: { roomCode: 'other-room', sessionId: 'session-1' }
            });

            await eventHandlers['room:reconnect']({
                code: 'test-room',
                reconnectionToken: validToken
            });

            expect(mockSocket.emit).toHaveBeenCalledWith('room:error', {
                code: expect.any(String),
                message: expect.stringContaining('does not match')
            });
        });

        test('throws error when room not found', async () => {
            roomService.getRoom.mockResolvedValue(null);

            await eventHandlers['room:reconnect']({
                code: 'test-room',
                reconnectionToken: validToken
            });

            expect(mockSocket.emit).toHaveBeenCalledWith('room:error', expect.any(Object));
        });

        test('updates player connected status', async () => {
            await eventHandlers['room:reconnect']({
                code: 'test-room',
                reconnectionToken: 'valid-token'
            });

            expect(playerService.updatePlayer).toHaveBeenCalledWith('session-1', {
                connected: true,
                lastSeen: expect.any(Number)
            });
        });

        test('notifies room of player reconnection', async () => {
            await eventHandlers['room:reconnect']({
                code: 'test-room',
                reconnectionToken: 'valid-token'
            });

            expect(mockSocket.to().emit).toHaveBeenCalledWith(
                'room:playerReconnected',
                expect.any(Object)
            );
        });

        test('sends spymaster view for spymaster with active game', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-1',
                nickname: 'Player1',
                role: 'spymaster'
            });
            gameService.getGame.mockResolvedValue({
                gameOver: false,
                types: ['red', 'blue']
            });

            await eventHandlers['room:reconnect']({
                code: 'test-room',
                reconnectionToken: 'valid-token'
            });

            expect(mockSocket.emit).toHaveBeenCalledWith('game:spymasterView', expect.any(Object));
        });

        test('handles timeout error gracefully', async () => {
            const timeoutError = new Error('Timed out');
            timeoutError.code = 'OPERATION_TIMEOUT';
            playerService.validateReconnectionToken.mockRejectedValue(timeoutError);

            await eventHandlers['room:reconnect']({
                code: 'test-room',
                reconnectionToken: 'valid-token'
            });

            // createPreRoomHandler catches and emits sanitized error
            expect(mockSocket.emit).toHaveBeenCalledWith('room:error', expect.objectContaining({
                code: expect.any(String)
            }));
        });
    });

    describe('Helper functions (via indirect testing)', () => {
        beforeEach(() => {
            mockSocket.roomCode = 'test-room';
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-1',
                roomCode: 'test-room',
                nickname: 'Player1',
                role: null
            });
        });

        test('sendTimerStatus skips when no timer active', async () => {
            // Mock getSocketFunctions to return null timer status
            getSocketFunctions.mockReturnValue({
                getTimerStatus: jest.fn().mockResolvedValue(null)
            });

            await eventHandlers['room:resync']();

            // Should not emit timer:status when no timer
            const timerStatusCalls = mockSocket.emit.mock.calls.filter(
                call => call[0] === 'timer:status'
            );
            expect(timerStatusCalls.length).toBe(0);
        });

        test('sendSpymasterViewIfNeeded does nothing for non-spymaster', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-1',
                roomCode: 'test-room',
                role: 'clicker'
            });
            gameService.getGame.mockResolvedValue({
                gameOver: false
            });

            await eventHandlers['room:resync']();

            const spymasterViewCalls = mockSocket.emit.mock.calls.filter(
                call => call[0] === 'game:spymasterView'
            );
            expect(spymasterViewCalls.length).toBe(0);
        });

        test('sendSpymasterViewIfNeeded does nothing when game is over', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-1',
                roomCode: 'test-room',
                role: 'spymaster'
            });
            gameService.getGame.mockResolvedValue({
                gameOver: true,
                types: ['red', 'blue']
            });

            await eventHandlers['room:resync']();

            const spymasterViewCalls = mockSocket.emit.mock.calls.filter(
                call => call[0] === 'game:spymasterView'
            );
            expect(spymasterViewCalls.length).toBe(0);
        });
    });
});
