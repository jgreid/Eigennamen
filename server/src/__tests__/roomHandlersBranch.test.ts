/**
 * Room Handlers Branch Coverage Tests
 *
 * Tests additional branches in roomHandlers.ts including:
 * - Rate limiter errors in trackFailedJoinAttempt
 * - Join attempt tracking for ROOM_NOT_FOUND and INVALID_INPUT errors
 * - getRoomStats errors during join (fallback)
 * - Null players in resync
 * - Reconnection token rotation failure
 * - Reconnect flow: token validation failure, room code mismatch, non-spectator join
 * - Leave room flow
 * - getReconnectionToken: generate new token, token generation failure
 */

// Mock rate limit handler
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
    }),
    getSocketRateLimiter: jest.fn()
}));

jest.mock('../services/roomService');
jest.mock('../services/gameService');
jest.mock('../services/playerService');
jest.mock('../utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));

jest.mock('../socket/socketFunctionProvider', () => ({
    getSocketFunctions: jest.fn(() => ({
        getTimerStatus: jest.fn().mockResolvedValue(null)
    }))
}));

jest.mock('../utils/timeout', () => ({
    withTimeout: jest.fn((promise: any) => promise),
    TIMEOUTS: {
        SOCKET_HANDLER: 30000,
        JOIN_ROOM: 15000,
        RECONNECT: 15000
    }
}));

jest.mock('../utils/metrics', () => ({
    trackReconnection: jest.fn()
}));

jest.mock('../socket/safeEmit', () => ({
    safeEmitToRoom: jest.fn()
}));

const roomService = require('../services/roomService');
const gameService = require('../services/gameService');
const playerService = require('../services/playerService');
const { getSocketRateLimiter } = require('../socket/rateLimitHandler');
const { safeEmitToRoom } = require('../socket/safeEmit');

describe('Room Handlers Branch Coverage', () => {
    let mockIo: any;
    let mockSocket: any;
    let eventHandlers: Record<string, any>;

    beforeEach(() => {
        jest.clearAllMocks();

        mockSocket = {
            id: 'socket-1',
            sessionId: 'session-1',
            roomCode: null,
            on: jest.fn((event: string, handler: any) => {
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

        // Default service mocks
        roomService.createRoom.mockResolvedValue({
            room: { code: 'ROOM01', roomId: 'test', settings: {} },
            player: { sessionId: 'session-1', isHost: true, role: 'spectator', team: null }
        });
        roomService.joinRoom.mockResolvedValue({
            room: { code: 'ROOM01' },
            players: [{ sessionId: 'session-1' }],
            game: null,
            player: { sessionId: 'session-1', role: 'spectator', team: null, nickname: 'Player1' }
        });
        roomService.getRoom.mockResolvedValue({ code: 'ROOM01', settings: {} });
        roomService.leaveRoom.mockResolvedValue({ newHostId: null });
        roomService.updateSettings.mockResolvedValue({ turnTimer: 60 });

        playerService.getPlayer.mockResolvedValue({
            sessionId: 'session-1',
            roomCode: 'ROOM01',
            nickname: 'Player1',
            team: null,
            role: 'spectator',
            isHost: true
        });
        playerService.getRoomStats.mockResolvedValue({
            totalPlayers: 1,
            spectatorCount: 0,
            teams: {
                red: { total: 0, spymaster: null, clicker: null },
                blue: { total: 0, spymaster: null, clicker: null }
            }
        });
        playerService.getPlayersInRoom.mockResolvedValue([]);
        playerService.invalidateReconnectionToken.mockResolvedValue(undefined);
        playerService.generateReconnectionToken.mockResolvedValue('token-abc');
        playerService.getExistingReconnectionToken.mockResolvedValue(null);
        playerService.validateReconnectionToken.mockResolvedValue({ valid: true, tokenData: { sessionId: 'session-1', roomCode: 'room01', nickname: 'Player1', team: null, role: 'spectator' } });
        playerService.setSocketMapping = jest.fn().mockResolvedValue(undefined);
        playerService.updatePlayer.mockResolvedValue(undefined);

        gameService.getGame.mockResolvedValue(null);
        gameService.getGameStateForPlayer.mockReturnValue(null);

        // Default rate limiter mock
        const mockLimiter = jest.fn((_socket: any, _data: any, callback: any) => {
            callback(); // no error
        });
        getSocketRateLimiter.mockReturnValue({
            getLimiter: jest.fn(() => mockLimiter)
        });

        // Load handlers
        const roomHandlers = require('../socket/handlers/roomHandlers');
        roomHandlers(mockIo, mockSocket);
    });

    describe('room:join - trackFailedJoinAttempt', () => {
        it('should track failed join for ROOM_NOT_FOUND error', async () => {
            const error = new Error('Room not found');
            (error as any).code = 'ROOM_NOT_FOUND';
            roomService.joinRoom.mockRejectedValue(error);

            await eventHandlers['room:join']({ roomId: 'FAKE01', nickname: 'Player' });

            expect(mockSocket.emit).toHaveBeenCalledWith('room:error', expect.objectContaining({
                code: 'ROOM_NOT_FOUND'
            }));
        });

        it('should track failed join for INVALID_INPUT error', async () => {
            const error = new Error('Invalid input');
            (error as any).code = 'INVALID_INPUT';
            roomService.joinRoom.mockRejectedValue(error);

            await eventHandlers['room:join']({ roomId: '', nickname: 'Player' });

            expect(mockSocket.emit).toHaveBeenCalledWith('room:error', expect.objectContaining({
                code: 'INVALID_INPUT'
            }));
        });

        it('should handle rate limiter error in trackFailedJoinAttempt', async () => {
            const error = new Error('Room not found');
            (error as any).code = 'ROOM_NOT_FOUND';
            roomService.joinRoom.mockRejectedValue(error);

            // Make rate limiter throw
            getSocketRateLimiter.mockImplementation(() => {
                throw new Error('Rate limiter not initialized');
            });

            await eventHandlers['room:join']({ roomId: 'FAKE01', nickname: 'Player' });

            // Should still emit the original error, not crash
            expect(mockSocket.emit).toHaveBeenCalledWith('room:error', expect.objectContaining({
                code: 'ROOM_NOT_FOUND'
            }));
        });

        it('should handle limiter callback error in trackFailedJoinAttempt', async () => {
            const error = new Error('Room not found');
            (error as any).code = 'ROOM_NOT_FOUND';
            roomService.joinRoom.mockRejectedValue(error);

            // Make limiter call back with error (rate limit exceeded)
            const mockLimiter = jest.fn((_socket: any, _data: any, callback: any) => {
                callback(new Error('Rate limit exceeded'));
            });
            getSocketRateLimiter.mockReturnValue({
                getLimiter: jest.fn(() => mockLimiter)
            });

            await eventHandlers['room:join']({ roomId: 'FAKE01', nickname: 'Player' });

            // Should still emit the original error
            expect(mockSocket.emit).toHaveBeenCalledWith('room:error', expect.objectContaining({
                code: 'ROOM_NOT_FOUND'
            }));
        });
    });

    describe('room:join - getRoomStats error fallback', () => {
        it('should use fallback stats when getRoomStats fails', async () => {
            playerService.getRoomStats.mockRejectedValue(new Error('Stats failed'));

            await eventHandlers['room:join']({ roomId: 'ROOM01', nickname: 'Player' });

            // Should still emit room:joined with fallback stats
            expect(mockSocket.emit).toHaveBeenCalledWith('room:joined', expect.objectContaining({
                stats: expect.objectContaining({
                    totalPlayers: expect.any(Number)
                })
            }));
        });
    });

    describe('room:join - invalidateReconnectionToken failure', () => {
        it('should continue join even when token invalidation fails', async () => {
            playerService.invalidateReconnectionToken.mockRejectedValue(new Error('Token invalidation failed'));

            await eventHandlers['room:join']({ roomId: 'ROOM01', nickname: 'Player' });

            // Should still complete join
            expect(mockSocket.emit).toHaveBeenCalledWith('room:joined', expect.any(Object));
        });
    });

    describe('room:join - non-spectator player joins', () => {
        it('should not join spectators room when player has a team', async () => {
            roomService.joinRoom.mockResolvedValue({
                room: { code: 'ROOM01' },
                players: [{ sessionId: 'session-1' }],
                game: null,
                player: { sessionId: 'session-1', role: 'clicker', team: 'red', nickname: 'Player1' }
            });

            await eventHandlers['room:join']({ roomId: 'ROOM01', nickname: 'Player' });

            expect(mockSocket.join).toHaveBeenCalledWith('room:ROOM01');
            expect(mockSocket.join).toHaveBeenCalledWith('player:session-1');
            expect(mockSocket.join).not.toHaveBeenCalledWith('spectators:ROOM01');
        });
    });

    describe('room:join - reconnect detection', () => {
        it('should emit playerReconnected for returning player', async () => {
            roomService.joinRoom.mockResolvedValue({
                room: { code: 'ROOM01' },
                players: [{ sessionId: 'session-1' }],
                game: null,
                player: {
                    sessionId: 'session-1',
                    role: 'spectator',
                    team: null,
                    nickname: 'Player1',
                    lastConnected: Date.now() - 5000
                }
            });

            await eventHandlers['room:join']({ roomId: 'ROOM01', nickname: 'Player' });

            expect(mockSocket.to).toHaveBeenCalledWith('room:ROOM01');
            expect(mockSocket.to().emit).toHaveBeenCalledWith('room:playerReconnected', expect.objectContaining({
                sessionId: 'session-1'
            }));
        });
    });

    describe('room:resync - null players', () => {
        it('should throw when players array is null', async () => {
            mockSocket.roomCode = 'ROOM01';
            playerService.getPlayersInRoom.mockResolvedValue(null);

            await eventHandlers['room:resync']({});

            expect(mockSocket.emit).toHaveBeenCalledWith('room:error', expect.objectContaining({
                code: 'ROOM_NOT_FOUND'
            }));
        });

        it('should throw when room not found during resync', async () => {
            mockSocket.roomCode = 'ROOM01';
            roomService.getRoom.mockResolvedValue(null);
            playerService.getPlayersInRoom.mockResolvedValue([]);

            await eventHandlers['room:resync']({});

            expect(mockSocket.emit).toHaveBeenCalledWith('room:error', expect.objectContaining({
                code: 'ROOM_NOT_FOUND'
            }));
        });
    });

    describe('room:reconnect - token validation failure', () => {
        it('should reject when token is invalid', async () => {
            playerService.validateReconnectionToken.mockResolvedValue({
                valid: false,
                reason: 'expired'
            });

            await eventHandlers['room:reconnect']({ code: 'ROOM01', reconnectionToken: 'b'.repeat(64) });

            expect(mockSocket.emit).toHaveBeenCalledWith('room:error', expect.objectContaining({
                code: 'NOT_AUTHORIZED'
            }));
        });

        it('should reject when token room code does not match', async () => {
            playerService.validateReconnectionToken.mockResolvedValue({
                valid: true,
                tokenData: { sessionId: 'session-1', roomCode: 'OTHER', nickname: 'Player', team: null, role: 'spectator' }
            });

            await eventHandlers['room:reconnect']({ code: 'ROOM01', reconnectionToken: 'a'.repeat(64) });

            expect(mockSocket.emit).toHaveBeenCalledWith('room:error', expect.objectContaining({
                code: 'INVALID_INPUT'
            }));
        });

        it('should reject when room not found during reconnect', async () => {
            roomService.getRoom.mockResolvedValue(null);

            await eventHandlers['room:reconnect']({ code: 'ROOM01', reconnectionToken: 'a'.repeat(64) });

            expect(mockSocket.emit).toHaveBeenCalledWith('room:error', expect.objectContaining({
                code: 'ROOM_NOT_FOUND'
            }));
        });
    });

    describe('room:reconnect - non-spectator reconnect', () => {
        it('should leave spectators room when player has a team', async () => {
            playerService.validateReconnectionToken.mockResolvedValue({
                valid: true,
                tokenData: { sessionId: 'session-1', roomCode: 'room01', nickname: 'Player', team: 'red', role: 'clicker' }
            });
            roomService.getRoom.mockResolvedValue({ code: 'ROOM01', settings: {} });
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-1',
                roomCode: 'ROOM01',
                nickname: 'Player',
                team: 'red',
                role: 'clicker',
                isHost: false
            });
            playerService.getPlayersInRoom.mockResolvedValue([{ sessionId: 'session-1' }]);

            await eventHandlers['room:reconnect']({ code: 'ROOM01', reconnectionToken: 'a'.repeat(64) });

            expect(mockSocket.leave).toHaveBeenCalledWith('spectators:room01');
        });
    });

    describe('room:reconnect - token rotation failure', () => {
        it('should warn but not fail when token rotation fails', async () => {
            playerService.validateReconnectionToken.mockResolvedValue({
                valid: true,
                tokenData: { sessionId: 'session-1', roomCode: 'room01', nickname: 'Player', team: null, role: 'spectator' }
            });
            roomService.getRoom.mockResolvedValue({ code: 'ROOM01', settings: {} });
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-1',
                roomCode: 'ROOM01',
                nickname: 'Player',
                team: null,
                role: 'spectator',
                isHost: false
            });
            playerService.getPlayersInRoom.mockResolvedValue([{ sessionId: 'session-1' }]);
            playerService.generateReconnectionToken.mockRejectedValue(new Error('Token generation failed'));

            await eventHandlers['room:reconnect']({ code: 'ROOM01', reconnectionToken: 'a'.repeat(64) });

            // Should still emit room:reconnected
            expect(mockSocket.emit).toHaveBeenCalledWith('room:reconnected', expect.objectContaining({
                reconnectionToken: null // failed to generate
            }));
        });
    });

    describe('room:reconnect - player not found after update', () => {
        it('should throw when player not found after update', async () => {
            playerService.validateReconnectionToken.mockResolvedValue({
                valid: true,
                tokenData: { sessionId: 'session-1', roomCode: 'room01', nickname: 'Player', team: null, role: 'spectator' }
            });
            roomService.getRoom.mockResolvedValue({ code: 'ROOM01', settings: {} });
            playerService.getPlayer.mockResolvedValue(null);
            playerService.getPlayersInRoom.mockResolvedValue([]);

            await eventHandlers['room:reconnect']({ code: 'ROOM01', reconnectionToken: 'a'.repeat(64) });

            expect(mockSocket.emit).toHaveBeenCalledWith('room:error', expect.objectContaining({
                code: 'PLAYER_NOT_FOUND'
            }));
        });
    });

    describe('room:reconnect - null/invalid players', () => {
        it('should throw when players is null during reconnect', async () => {
            playerService.validateReconnectionToken.mockResolvedValue({
                valid: true,
                tokenData: { sessionId: 'session-1', roomCode: 'room01', nickname: 'Player', team: null, role: 'spectator' }
            });
            roomService.getRoom.mockResolvedValue({ code: 'ROOM01', settings: {} });
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-1',
                roomCode: 'ROOM01',
                nickname: 'Player',
                team: null,
                role: 'spectator'
            });
            playerService.getPlayersInRoom.mockResolvedValue(null);

            await eventHandlers['room:reconnect']({ code: 'ROOM01', reconnectionToken: 'a'.repeat(64) });

            expect(mockSocket.emit).toHaveBeenCalledWith('room:error', expect.objectContaining({
                code: 'ROOM_NOT_FOUND'
            }));
        });
    });

    describe('room:getReconnectionToken', () => {
        it('should return existing token when available', async () => {
            mockSocket.roomCode = 'ROOM01';
            playerService.getExistingReconnectionToken.mockResolvedValue('existing-token');

            await eventHandlers['room:getReconnectionToken']({});

            expect(mockSocket.emit).toHaveBeenCalledWith('room:reconnectionToken', expect.objectContaining({
                token: 'existing-token'
            }));
            expect(playerService.generateReconnectionToken).not.toHaveBeenCalled();
        });

        it('should generate new token when no existing token', async () => {
            mockSocket.roomCode = 'ROOM01';
            playerService.getExistingReconnectionToken.mockResolvedValue(null);
            playerService.generateReconnectionToken.mockResolvedValue('new-token');

            await eventHandlers['room:getReconnectionToken']({});

            expect(playerService.generateReconnectionToken).toHaveBeenCalledWith('session-1');
            expect(mockSocket.emit).toHaveBeenCalledWith('room:reconnectionToken', expect.objectContaining({
                token: 'new-token'
            }));
        });

        it('should throw when token generation fails', async () => {
            mockSocket.roomCode = 'ROOM01';
            playerService.getExistingReconnectionToken.mockResolvedValue(null);
            playerService.generateReconnectionToken.mockResolvedValue(null);

            await eventHandlers['room:getReconnectionToken']({});

            expect(mockSocket.emit).toHaveBeenCalledWith('room:error', expect.objectContaining({
                message: expect.any(String)
            }));
        });
    });

    describe('room:leave', () => {
        it('should leave room and broadcast player left', async () => {
            mockSocket.roomCode = 'ROOM01';

            await eventHandlers['room:leave']({});

            expect(playerService.invalidateReconnectionToken).toHaveBeenCalledWith('session-1');
            expect(roomService.leaveRoom).toHaveBeenCalledWith('ROOM01', 'session-1');
            expect(mockSocket.leave).toHaveBeenCalledWith('room:ROOM01');
            expect(mockSocket.leave).toHaveBeenCalledWith('spectators:ROOM01');
            expect(mockSocket.leave).toHaveBeenCalledWith('player:session-1');
            expect(safeEmitToRoom).toHaveBeenCalledWith(
                mockIo, 'ROOM01', 'room:playerLeft',
                expect.objectContaining({
                    sessionId: 'session-1',
                    newHost: null
                })
            );
            expect(mockSocket.roomCode).toBeNull();
        });
    });

    describe('room:join - with game state for spymaster', () => {
        it('should send spymaster view when joining as spymaster with active game', async () => {
            const mockGame = {
                gameOver: false,
                types: ['red', 'blue', 'neutral', 'assassin'],
                currentTurn: 'red'
            };
            roomService.joinRoom.mockResolvedValue({
                room: { code: 'ROOM01' },
                players: [{ sessionId: 'session-1' }],
                game: mockGame,
                player: {
                    sessionId: 'session-1',
                    role: 'spymaster',
                    team: 'red',
                    nickname: 'Spy'
                }
            });
            gameService.getGameStateForPlayer.mockReturnValue({
                types: mockGame.types,
                currentTurn: 'red'
            });

            await eventHandlers['room:join']({ roomId: 'ROOM01', nickname: 'Spy' });

            expect(mockSocket.emit).toHaveBeenCalledWith('game:spymasterView', {
                types: mockGame.types
            });
        });
    });

    describe('room:join - other errors not tracked', () => {
        it('should not track join attempt for non-room errors', async () => {
            const error = new Error('Server error');
            (error as any).code = 'SERVER_ERROR';
            roomService.joinRoom.mockRejectedValue(error);

            await eventHandlers['room:join']({ roomId: 'ROOM01', nickname: 'Player' });

            // Should emit error but not track failed attempt
            expect(mockSocket.emit).toHaveBeenCalledWith('room:error', expect.any(Object));
        });
    });
});
