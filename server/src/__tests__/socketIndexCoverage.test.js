/**
 * Socket Index Coverage Tests
 *
 * Additional tests for socket/index.js to cover uncovered lines:
 * - Line 80: Redis adapter fallback error handling
 * - Lines 91-153: Connection handling with disconnect timeout
 * - Lines 311-422: handleDisconnect with host transfer and error handling
 *
 * These tests focus on the _handleDisconnect exported function which allows
 * direct testing without needing actual socket connections.
 */

// Mock storage for Redis operations
let mockRedisStorage = {};

// Mock Redis client
const mockRedis = {
    get: jest.fn(async (key) => mockRedisStorage[key] || null),
    set: jest.fn(async (key, value, _options) => {
        mockRedisStorage[key] = typeof value === 'string' ? value : JSON.stringify(value);
        return 'OK';
    }),
    del: jest.fn(async (key) => {
        delete mockRedisStorage[key];
        return 1;
    }),
    exists: jest.fn(async (key) => mockRedisStorage[key] ? 1 : 0),
    expire: jest.fn().mockResolvedValue(1),
    incr: jest.fn().mockResolvedValue(1),
    eval: jest.fn().mockResolvedValue(null),
    scanIterator: jest.fn(function* () { /* empty iterator */ }),
    sAdd: jest.fn().mockResolvedValue(1),
    sRem: jest.fn().mockResolvedValue(1),
    sMembers: jest.fn().mockResolvedValue([]),
    zAdd: jest.fn().mockResolvedValue(1)
};

const mockPubClient = {
    publish: jest.fn().mockResolvedValue(1),
    connect: jest.fn().mockResolvedValue(),
    subscribe: jest.fn().mockResolvedValue()
};

const mockSubClient = {
    subscribe: jest.fn().mockResolvedValue(),
    unsubscribe: jest.fn().mockResolvedValue(),
    connect: jest.fn().mockResolvedValue()
};

jest.mock('../config/redis', () => ({
    getRedis: () => mockRedis,
    getPubSubClients: () => ({ pubClient: mockPubClient, subClient: mockSubClient }),
    isUsingMemoryMode: jest.fn().mockReturnValue(false),
    isRedisHealthy: jest.fn().mockResolvedValue(true)
}));

jest.mock('../utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));

jest.mock('../middleware/socketAuth', () => ({
    authenticateSocket: jest.fn((socket, next) => {
        socket.sessionId = socket.handshake?.auth?.sessionId || 'test-session-id';
        next();
    })
}));

// Mock services
jest.mock('../services/gameService', () => ({
    getGame: jest.fn().mockResolvedValue(null),
    endTurn: jest.fn().mockResolvedValue({ currentTurn: 'blue', previousTurn: 'red' }),
    getGameStateForPlayer: jest.fn()
}));

jest.mock('../services/roomService', () => ({
    getRoom: jest.fn().mockResolvedValue({ code: 'TEST12', settings: { turnTimer: 60 } })
}));

jest.mock('../services/playerService', () => ({
    getPlayer: jest.fn().mockResolvedValue(null),
    getPlayersInRoom: jest.fn().mockResolvedValue([]),
    handleDisconnect: jest.fn().mockResolvedValue(),
    updatePlayer: jest.fn().mockResolvedValue(),
    generateReconnectionToken: jest.fn().mockResolvedValue('test-token-123'),
    // Added for atomic host transfer
    atomicHostTransfer: jest.fn().mockResolvedValue({ success: true, oldHost: {}, newHost: {} })
}));

jest.mock('../services/eventLogService', () => ({
    logEvent: jest.fn().mockResolvedValue(),
    EVENT_TYPES: {
        TIMER_EXPIRED: 'TIMER_EXPIRED',
        PLAYER_DISCONNECTED: 'PLAYER_DISCONNECTED',
        HOST_CHANGED: 'HOST_CHANGED'
    }
}));

// Mock timer service
jest.mock('../services/timerService', () => ({
    initializeTimerService: jest.fn().mockResolvedValue(true),
    startTimer: jest.fn().mockResolvedValue({
        startTime: Date.now(),
        endTime: Date.now() + 60000,
        duration: 60,
        remainingSeconds: 60
    }),
    stopTimer: jest.fn().mockResolvedValue(),
    getTimerStatus: jest.fn().mockResolvedValue(null)
}));

// Mock handlers
jest.mock('../socket/handlers/roomHandlers', () => jest.fn());
jest.mock('../socket/handlers/gameHandlers', () => jest.fn());
jest.mock('../socket/handlers/playerHandlers', () => jest.fn());
jest.mock('../socket/handlers/chatHandlers', () => jest.fn());

// Mock rate limiter
jest.mock('../socket/rateLimitHandler', () => ({
    socketRateLimiter: {
        cleanupSocket: jest.fn()
    },
    createRateLimitedHandler: jest.fn((socket, eventName, handler) => handler),
    getSocketRateLimiter: jest.fn(),
    startRateLimitCleanup: jest.fn(),
    stopRateLimitCleanup: jest.fn()
}));

// Mock socket function provider
jest.mock('../socket/socketFunctionProvider', () => ({
    registerSocketFunctions: jest.fn()
}));

const logger = require('../utils/logger');

describe('handleDisconnect Function Coverage (Lines 291-424)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockRedisStorage = {};
        mockRedis.set.mockImplementation(async (key, value, _options) => {
            mockRedisStorage[key] = typeof value === 'string' ? value : JSON.stringify(value);
            return 'OK';
        });
        mockRedis.del.mockResolvedValue(1);
    });

    describe('Player Not Found Path (Lines 300-301)', () => {
        test('returns early when player is not found', async () => {
            const playerService = require('../services/playerService');
            playerService.getPlayer.mockResolvedValue(null);

            const socketMod = require('../socket/index');
            const mockIo = {
                to: jest.fn().mockReturnThis(),
                emit: jest.fn()
            };
            const mockSocket = {
                id: 'socket-123',
                sessionId: 'session-not-found'
            };

            await socketMod._handleDisconnect(mockIo, mockSocket, 'client disconnect');

            expect(playerService.handleDisconnect).not.toHaveBeenCalled();
            expect(mockIo.to).not.toHaveBeenCalled();
        });
    });

    describe('Reconnection Token Generation (Lines 307-312)', () => {
        test('generates reconnection token and includes in notification', async () => {
            const playerService = require('../services/playerService');
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-123',
                nickname: 'TestPlayer',
                roomCode: 'ROOM01',
                team: 'red',
                isHost: false,
                connected: true
            });
            playerService.getPlayersInRoom.mockResolvedValue([
                { sessionId: 'session-456', nickname: 'OtherPlayer', connected: true }
            ]);
            playerService.generateReconnectionToken.mockResolvedValue('reconnect-token-xyz');

            const socketMod = require('../socket/index');
            const mockEmit = jest.fn();
            const mockIo = {
                to: jest.fn().mockReturnValue({ emit: mockEmit })
            };
            const mockSocket = {
                id: 'socket-123',
                sessionId: 'session-123'
            };

            await socketMod._handleDisconnect(mockIo, mockSocket, 'transport close');

            expect(playerService.generateReconnectionToken).toHaveBeenCalledWith('session-123');
            expect(playerService.handleDisconnect).toHaveBeenCalledWith('session-123');
            expect(mockIo.to).toHaveBeenCalledWith('room:ROOM01');
            // SECURITY FIX: reconnectionToken is no longer broadcast to prevent session hijacking
            expect(mockEmit).toHaveBeenCalledWith('player:disconnected', expect.objectContaining({
                sessionId: 'session-123',
                nickname: 'TestPlayer',
                team: 'red',
                reason: 'transport close',
                // Token is NOT included in broadcast for security
                reconnecting: true,
                reconnectionDeadline: expect.any(Number)
            }));
            // Verify token is NOT in the broadcast
            const disconnectCall = mockEmit.mock.calls.find(c => c[0] === 'player:disconnected');
            expect(disconnectCall[1].reconnectionToken).toBeUndefined();
        });

        test('handles token generation failure gracefully', async () => {
            const playerService = require('../services/playerService');
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-123',
                nickname: 'TestPlayer',
                roomCode: 'ROOM01',
                team: 'blue',
                isHost: false,
                connected: true
            });
            playerService.getPlayersInRoom.mockResolvedValue([]);
            playerService.generateReconnectionToken.mockRejectedValue(new Error('Token generation failed'));

            const socketMod = require('../socket/index');
            const mockEmit = jest.fn();
            const mockIo = {
                to: jest.fn().mockReturnValue({ emit: mockEmit })
            };
            const mockSocket = {
                id: 'socket-123',
                sessionId: 'session-123'
            };

            await socketMod._handleDisconnect(mockIo, mockSocket, 'ping timeout');

            expect(logger.warn).toHaveBeenCalledWith(
                expect.stringContaining('Failed to generate reconnection token'),
                'Token generation failed'
            );
            // SECURITY FIX: reconnectionToken is no longer broadcast
            expect(mockEmit).toHaveBeenCalledWith('player:disconnected', expect.objectContaining({
                reconnecting: false,
                reconnectionDeadline: null
            }));
            // Verify token is NOT in broadcast
            const disconnectCall = mockEmit.mock.calls.find(c => c[0] === 'player:disconnected');
            expect(disconnectCall[1].reconnectionToken).toBeUndefined();
        });

        test('sets null reconnection values when token generation fails', async () => {
            const playerService = require('../services/playerService');
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-123',
                nickname: 'TestPlayer',
                roomCode: 'ROOM01',
                team: 'red',
                isHost: false,
                connected: true
            });
            playerService.getPlayersInRoom.mockResolvedValue([]);
            playerService.generateReconnectionToken.mockRejectedValue(new Error('Redis unavailable'));

            const socketMod = require('../socket/index');
            const mockEmit = jest.fn();
            const mockIo = {
                to: jest.fn().mockReturnValue({ emit: mockEmit })
            };
            const mockSocket = {
                id: 'socket-123',
                sessionId: 'session-123'
            };

            await socketMod._handleDisconnect(mockIo, mockSocket, 'transport error');

            const call = mockEmit.mock.calls.find(c => c[0] === 'player:disconnected');
            expect(call).toBeDefined();
            const data = call[1];
            // SECURITY FIX: reconnectionToken is no longer broadcast
            expect(data.reconnectionToken).toBeUndefined();
            expect(data.reconnecting).toBe(false);
            expect(data.reconnectionDeadline).toBeNull();
        });
    });

    describe('Room Notification (Lines 318-340)', () => {
        test('skips room notification when player has no roomCode', async () => {
            const playerService = require('../services/playerService');
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-123',
                nickname: 'TestPlayer',
                roomCode: null,
                team: null,
                isHost: false,
                connected: true
            });

            const socketMod = require('../socket/index');
            const mockIo = {
                to: jest.fn().mockReturnThis(),
                emit: jest.fn()
            };
            const mockSocket = {
                id: 'socket-123',
                sessionId: 'session-123'
            };

            await socketMod._handleDisconnect(mockIo, mockSocket, 'client disconnect');

            expect(playerService.handleDisconnect).toHaveBeenCalledWith('session-123');
            expect(mockIo.to).not.toHaveBeenCalled();
        });

        test('notifies room with updated player list', async () => {
            const playerService = require('../services/playerService');
            const updatedPlayers = [
                { sessionId: 'session-456', nickname: 'Player2', connected: true },
                { sessionId: 'session-789', nickname: 'Player3', connected: true }
            ];
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-123',
                nickname: 'TestPlayer',
                roomCode: 'ROOM01',
                team: 'blue',
                isHost: false,
                connected: true
            });
            playerService.getPlayersInRoom.mockResolvedValue(updatedPlayers);
            playerService.generateReconnectionToken.mockResolvedValue('token-abc');

            const socketMod = require('../socket/index');
            const mockEmit = jest.fn();
            const mockIo = {
                to: jest.fn().mockReturnValue({ emit: mockEmit })
            };
            const mockSocket = {
                id: 'socket-123',
                sessionId: 'session-123'
            };

            await socketMod._handleDisconnect(mockIo, mockSocket, 'transport close');

            expect(mockEmit).toHaveBeenCalledWith('player:disconnected', expect.objectContaining({
                players: updatedPlayers
            }));
        });
    });

    describe('Event Logging (Lines 343-352)', () => {
        test('logs player disconnection event', async () => {
            const playerService = require('../services/playerService');
            const eventLogService = require('../services/eventLogService');

            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-123',
                nickname: 'TestPlayer',
                roomCode: 'ROOM01',
                team: 'blue',
                isHost: false,
                connected: true
            });
            playerService.getPlayersInRoom.mockResolvedValue([]);

            const socketMod = require('../socket/index');
            const mockEmit = jest.fn();
            const mockIo = {
                to: jest.fn().mockReturnValue({ emit: mockEmit })
            };
            const mockSocket = {
                id: 'socket-123',
                sessionId: 'session-123'
            };

            await socketMod._handleDisconnect(mockIo, mockSocket, 'client disconnect');

            expect(eventLogService.logEvent).toHaveBeenCalledWith(
                'ROOM01',
                'PLAYER_DISCONNECTED',
                expect.objectContaining({
                    sessionId: 'session-123',
                    nickname: 'TestPlayer',
                    team: 'blue',
                    reason: 'client disconnect'
                })
            );
        });
    });

    describe('Host Transfer Logic (Lines 355-418)', () => {
        test('transfers host to first connected player when host disconnects', async () => {
            const playerService = require('../services/playerService');
            const roomService = require('../services/roomService');
            const eventLogService = require('../services/eventLogService');

            playerService.getPlayer.mockResolvedValue({
                sessionId: 'host-session',
                nickname: 'HostPlayer',
                roomCode: 'ROOM01',
                team: 'red',
                isHost: true,
                connected: true
            });

            playerService.getPlayersInRoom.mockResolvedValue([
                { sessionId: 'host-session', nickname: 'HostPlayer', connected: false, isHost: true },
                { sessionId: 'player-2', nickname: 'Player2', connected: true, isHost: false },
                { sessionId: 'player-3', nickname: 'Player3', connected: true, isHost: false }
            ]);

            roomService.getRoom.mockResolvedValue({
                code: 'ROOM01',
                hostSessionId: 'host-session',
                settings: { turnTimer: 60 }
            });

            const socketMod = require('../socket/index');
            const mockEmit = jest.fn();
            const mockIo = {
                to: jest.fn().mockReturnValue({ emit: mockEmit })
            };
            const mockSocket = {
                id: 'socket-host',
                sessionId: 'host-session'
            };

            await socketMod._handleDisconnect(mockIo, mockSocket, 'transport close');

            // SECURITY FIX: Now uses atomic host transfer instead of separate updatePlayer calls
            expect(playerService.atomicHostTransfer).toHaveBeenCalledWith(
                'host-session',
                'player-2',
                'ROOM01'
            );

            expect(mockEmit).toHaveBeenCalledWith('room:hostChanged', expect.objectContaining({
                newHostSessionId: 'player-2',
                newHostNickname: 'Player2',
                reason: 'previousHostDisconnected'
            }));

            expect(eventLogService.logEvent).toHaveBeenCalledWith(
                'ROOM01',
                'HOST_CHANGED',
                expect.objectContaining({
                    previousHostSessionId: 'host-session',
                    newHostSessionId: 'player-2'
                })
            );
        });

        test('skips host transfer when lock is not acquired', async () => {
            const playerService = require('../services/playerService');

            playerService.getPlayer.mockResolvedValue({
                sessionId: 'host-session',
                nickname: 'HostPlayer',
                roomCode: 'ROOM01',
                team: 'red',
                isHost: true,
                connected: true
            });

            playerService.getPlayersInRoom.mockResolvedValue([
                { sessionId: 'host-session', nickname: 'HostPlayer', connected: false },
                { sessionId: 'player-2', nickname: 'Player2', connected: true }
            ]);

            // Mock Redis set to return null (lock not acquired)
            mockRedis.set.mockImplementation(async (key, value, _options) => {
                if (key.includes('lock:host-transfer')) {
                    return null;
                }
                mockRedisStorage[key] = typeof value === 'string' ? value : JSON.stringify(value);
                return 'OK';
            });

            const socketMod = require('../socket/index');
            const mockEmit = jest.fn();
            const mockIo = {
                to: jest.fn().mockReturnValue({ emit: mockEmit })
            };
            const mockSocket = {
                id: 'socket-host',
                sessionId: 'host-session'
            };

            await socketMod._handleDisconnect(mockIo, mockSocket, 'transport close');

            expect(logger.debug).toHaveBeenCalledWith(
                expect.stringContaining('Host transfer lock not acquired')
            );
            // Should NOT emit hostChanged
            expect(mockEmit).not.toHaveBeenCalledWith('room:hostChanged', expect.anything());
        });

        test('does not transfer host when no connected players remain', async () => {
            const playerService = require('../services/playerService');
            const roomService = require('../services/roomService');

            playerService.getPlayer.mockResolvedValue({
                sessionId: 'host-session',
                nickname: 'HostPlayer',
                roomCode: 'ROOM01',
                team: 'red',
                isHost: true,
                connected: true
            });

            playerService.getPlayersInRoom.mockResolvedValue([
                { sessionId: 'host-session', nickname: 'HostPlayer', connected: false }
            ]);

            roomService.getRoom.mockResolvedValue({
                code: 'ROOM01',
                hostSessionId: 'host-session'
            });

            const socketMod = require('../socket/index');
            const mockEmit = jest.fn();
            const mockIo = {
                to: jest.fn().mockReturnValue({ emit: mockEmit })
            };
            const mockSocket = {
                id: 'socket-host',
                sessionId: 'host-session'
            };

            await socketMod._handleDisconnect(mockIo, mockSocket, 'transport close');

            // Should NOT emit hostChanged when no connected players remain
            expect(mockEmit).not.toHaveBeenCalledWith('room:hostChanged', expect.anything());
        });

        test('updates room hostSessionId when room exists', async () => {
            const playerService = require('../services/playerService');
            const roomService = require('../services/roomService');

            playerService.getPlayer.mockResolvedValue({
                sessionId: 'host-session',
                nickname: 'HostPlayer',
                roomCode: 'ROOM01',
                team: 'red',
                isHost: true,
                connected: true
            });

            playerService.getPlayersInRoom.mockResolvedValue([
                { sessionId: 'player-2', nickname: 'NewHost', connected: true }
            ]);

            const mockRoom = {
                code: 'ROOM01',
                hostSessionId: 'host-session'
            };
            roomService.getRoom.mockResolvedValue(mockRoom);

            const socketMod = require('../socket/index');
            const mockEmit = jest.fn();
            const mockIo = {
                to: jest.fn().mockReturnValue({ emit: mockEmit })
            };
            const mockSocket = {
                id: 'socket-host',
                sessionId: 'host-session'
            };

            await socketMod._handleDisconnect(mockIo, mockSocket, 'transport close');

            // Verify atomic host transfer was called (room update happens inside the Lua script)
            expect(playerService.atomicHostTransfer).toHaveBeenCalledWith(
                'host-session',
                'player-2',
                'ROOM01'
            );
        });

        test('handles host transfer error gracefully', async () => {
            const playerService = require('../services/playerService');
            const roomService = require('../services/roomService');

            playerService.getPlayer.mockResolvedValue({
                sessionId: 'host-session',
                nickname: 'HostPlayer',
                roomCode: 'ROOM01',
                team: 'red',
                isHost: true,
                connected: true
            });

            playerService.getPlayersInRoom.mockResolvedValue([
                { sessionId: 'host-session', nickname: 'HostPlayer', connected: false },
                { sessionId: 'player-2', nickname: 'Player2', connected: true }
            ]);

            roomService.getRoom.mockResolvedValue({
                code: 'ROOM01',
                hostSessionId: 'host-session'
            });

            // SECURITY FIX: Now tests atomicHostTransfer failure
            playerService.atomicHostTransfer.mockResolvedValue({
                success: false,
                reason: 'SCRIPT_ERROR'
            });

            const socketMod = require('../socket/index');
            const mockEmit = jest.fn();
            const mockIo = {
                to: jest.fn().mockReturnValue({ emit: mockEmit })
            };
            const mockSocket = {
                id: 'socket-host',
                sessionId: 'host-session'
            };

            await socketMod._handleDisconnect(mockIo, mockSocket, 'transport close');

            // atomicHostTransfer returns failure, which is logged as error
            expect(logger.error).toHaveBeenCalledWith(
                expect.stringContaining('Atomic host transfer failed: SCRIPT_ERROR'),
                expect.any(Object)
            );
        });

        test('releases host transfer lock even on error', async () => {
            const playerService = require('../services/playerService');
            const roomService = require('../services/roomService');

            playerService.getPlayer.mockResolvedValue({
                sessionId: 'host-session',
                nickname: 'HostPlayer',
                roomCode: 'ROOM01',
                team: 'red',
                isHost: true,
                connected: true
            });

            playerService.getPlayersInRoom.mockResolvedValue([
                { sessionId: 'player-2', nickname: 'Player2', connected: true }
            ]);

            roomService.getRoom.mockRejectedValue(new Error('Room lookup failed'));

            const socketMod = require('../socket/index');
            const mockEmit = jest.fn();
            const mockIo = {
                to: jest.fn().mockReturnValue({ emit: mockEmit })
            };
            const mockSocket = {
                id: 'socket-host',
                sessionId: 'host-session'
            };

            await socketMod._handleDisconnect(mockIo, mockSocket, 'transport close');

            // Lock should be released (del called)
            expect(mockRedis.del).toHaveBeenCalled();
        });

        test('handles lock release error gracefully', async () => {
            const playerService = require('../services/playerService');
            const roomService = require('../services/roomService');

            playerService.getPlayer.mockResolvedValue({
                sessionId: 'host-session',
                nickname: 'HostPlayer',
                roomCode: 'ROOM01',
                team: 'red',
                isHost: true,
                connected: true
            });

            playerService.getPlayersInRoom.mockResolvedValue([
                { sessionId: 'player-2', nickname: 'Player2', connected: true }
            ]);

            roomService.getRoom.mockResolvedValue({
                code: 'ROOM01',
                hostSessionId: 'host-session'
            });

            mockRedis.del.mockRejectedValue(new Error('Failed to delete lock'));

            const socketMod = require('../socket/index');
            const mockEmit = jest.fn();
            const mockIo = {
                to: jest.fn().mockReturnValue({ emit: mockEmit })
            };
            const mockSocket = {
                id: 'socket-host',
                sessionId: 'host-session'
            };

            await socketMod._handleDisconnect(mockIo, mockSocket, 'transport close');

            // Logger receives a single formatted string
            expect(logger.error).toHaveBeenCalledWith(
                expect.stringContaining('Failed to release host transfer lock')
            );
        });

        test('non-host disconnect does not trigger host transfer', async () => {
            const playerService = require('../services/playerService');

            playerService.getPlayer.mockResolvedValue({
                sessionId: 'regular-session',
                nickname: 'RegularPlayer',
                roomCode: 'ROOM01',
                team: 'blue',
                isHost: false,
                connected: true
            });

            playerService.getPlayersInRoom.mockResolvedValue([
                { sessionId: 'host-session', nickname: 'HostPlayer', connected: true, isHost: true },
                { sessionId: 'regular-session', nickname: 'RegularPlayer', connected: false, isHost: false }
            ]);

            const socketMod = require('../socket/index');
            const mockEmit = jest.fn();
            const mockIo = {
                to: jest.fn().mockReturnValue({ emit: mockEmit })
            };
            const mockSocket = {
                id: 'socket-regular',
                sessionId: 'regular-session'
            };

            await socketMod._handleDisconnect(mockIo, mockSocket, 'client disconnect');

            // Should NOT emit hostChanged for non-host disconnect
            expect(mockEmit).not.toHaveBeenCalledWith('room:hostChanged', expect.anything());
        });
    });

    describe('General Error Handling (Lines 421-423)', () => {
        test('catches and logs top-level errors in handleDisconnect', async () => {
            const playerService = require('../services/playerService');
            playerService.getPlayer.mockRejectedValue(new Error('Unexpected database error'));

            const socketMod = require('../socket/index');
            const mockIo = {
                to: jest.fn().mockReturnThis(),
                emit: jest.fn()
            };
            const mockSocket = {
                id: 'socket-123',
                sessionId: 'session-123'
            };

            await socketMod._handleDisconnect(mockIo, mockSocket, 'client disconnect');

            expect(logger.error).toHaveBeenCalledWith(
                'Error handling disconnect:',
                expect.any(Error)
            );
        });

        test('catches handleDisconnect error after player found', async () => {
            const playerService = require('../services/playerService');
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-123',
                nickname: 'TestPlayer',
                roomCode: 'ROOM01',
                team: 'red',
                isHost: false,
                connected: true
            });
            playerService.handleDisconnect.mockRejectedValue(new Error('handleDisconnect failed'));

            const socketMod = require('../socket/index');
            const mockIo = {
                to: jest.fn().mockReturnThis(),
                emit: jest.fn()
            };
            const mockSocket = {
                id: 'socket-123',
                sessionId: 'session-123'
            };

            await socketMod._handleDisconnect(mockIo, mockSocket, 'client disconnect');

            expect(logger.error).toHaveBeenCalledWith(
                'Error handling disconnect:',
                expect.any(Error)
            );
        });
    });
});

describe('SESSION_SECURITY Import (Line 323)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockRedisStorage = {};
        mockRedis.set.mockImplementation(async (key, value, _options) => {
            mockRedisStorage[key] = typeof value === 'string' ? value : JSON.stringify(value);
            return 'OK';
        });
        mockRedis.del.mockResolvedValue(1);

        // Reset playerService mocks
        const playerService = require('../services/playerService');
        playerService.handleDisconnect.mockResolvedValue();
        playerService.updatePlayer.mockResolvedValue();
    });

    test('correctly uses SESSION_SECURITY.RECONNECTION_TOKEN_TTL_SECONDS', async () => {
        const playerService = require('../services/playerService');
        playerService.getPlayer.mockResolvedValue({
            sessionId: 'session-123',
            nickname: 'TestPlayer',
            roomCode: 'ROOM01',
            team: 'red',
            isHost: false,
            connected: true
        });
        playerService.getPlayersInRoom.mockResolvedValue([]);
        playerService.generateReconnectionToken.mockResolvedValue('token-123');

        const socketMod = require('../socket/index');
        const mockEmit = jest.fn();
        const mockIo = {
            to: jest.fn().mockReturnValue({ emit: mockEmit })
        };
        const mockSocket = {
            id: 'socket-123',
            sessionId: 'session-123'
        };

        const beforeCall = Date.now();
        await socketMod._handleDisconnect(mockIo, mockSocket, 'transport close');
        const afterCall = Date.now();

        const call = mockEmit.mock.calls.find(c => c[0] === 'player:disconnected');
        expect(call).toBeDefined();

        const data = call[1];
        expect(data.reconnectionDeadline).toBeGreaterThan(beforeCall);
        // Default TTL is 900 seconds (15 minutes)
        // Deadline should be approximately now + 900000ms
        const expectedMin = beforeCall + (900 * 1000) - 1000;
        const expectedMax = afterCall + (900 * 1000) + 1000;
        expect(data.reconnectionDeadline).toBeGreaterThanOrEqual(expectedMin);
        expect(data.reconnectionDeadline).toBeLessThanOrEqual(expectedMax);
    });
});

describe('Host Change Event Logging (Lines 389-399)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockRedisStorage = {};
        mockRedis.set.mockImplementation(async (key, value, _options) => {
            mockRedisStorage[key] = typeof value === 'string' ? value : JSON.stringify(value);
            return 'OK';
        });
        mockRedis.del.mockResolvedValue(1);

        // Reset playerService mocks
        const playerService = require('../services/playerService');
        playerService.handleDisconnect.mockResolvedValue();
        playerService.updatePlayer.mockResolvedValue();
    });

    test('logs complete host change event with all details', async () => {
        const playerService = require('../services/playerService');
        const roomService = require('../services/roomService');
        const eventLogService = require('../services/eventLogService');

        playerService.getPlayer.mockResolvedValue({
            sessionId: 'host-session',
            nickname: 'HostPlayer',
            roomCode: 'ROOM01',
            team: 'red',
            isHost: true,
            connected: true
        });

        playerService.getPlayersInRoom.mockResolvedValue([
            { sessionId: 'player-2', nickname: 'NewHostName', connected: true }
        ]);

        // SECURITY FIX: Need to mock atomicHostTransfer to return success
        playerService.atomicHostTransfer.mockResolvedValue({
            success: true,
            oldHost: { sessionId: 'host-session', isHost: false },
            newHost: { sessionId: 'player-2', isHost: true }
        });

        roomService.getRoom.mockResolvedValue({
            code: 'ROOM01',
            hostSessionId: 'host-session'
        });

        const socketMod = require('../socket/index');
        const mockEmit = jest.fn();
        const mockIo = {
            to: jest.fn().mockReturnValue({ emit: mockEmit })
        };
        const mockSocket = {
            id: 'socket-host',
            sessionId: 'host-session'
        };

        await socketMod._handleDisconnect(mockIo, mockSocket, 'ping timeout');

        expect(eventLogService.logEvent).toHaveBeenCalledWith(
            'ROOM01',
            'HOST_CHANGED',
            expect.objectContaining({
                previousHostSessionId: 'host-session',
                newHostSessionId: 'player-2',
                newHostNickname: 'NewHostName',
                reason: 'previousHostDisconnected'
            })
        );
    });
});

describe('Player Disconnected Notification Details (Lines 326-340)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockRedisStorage = {};
        mockRedis.set.mockImplementation(async (key, value, _options) => {
            mockRedisStorage[key] = typeof value === 'string' ? value : JSON.stringify(value);
            return 'OK';
        });
        mockRedis.del.mockResolvedValue(1);

        // Reset playerService mocks to default implementations
        const playerService = require('../services/playerService');
        playerService.handleDisconnect.mockResolvedValue();
        playerService.updatePlayer.mockResolvedValue();
    });

    test('includes all required fields in player:disconnected event', async () => {
        const playerService = require('../services/playerService');
        playerService.getPlayer.mockResolvedValue({
            sessionId: 'session-test',
            nickname: 'TestNick',
            roomCode: 'TESTROOM',
            team: 'blue',
            isHost: false,
            connected: true
        });
        const mockPlayers = [{ sessionId: 'other', nickname: 'Other', connected: true }];
        playerService.getPlayersInRoom.mockResolvedValue(mockPlayers);
        playerService.generateReconnectionToken.mockResolvedValue('token-abc-123');

        const socketMod = require('../socket/index');
        const mockEmit = jest.fn();
        const mockIo = {
            to: jest.fn().mockReturnValue({ emit: mockEmit })
        };
        const mockSocket = {
            id: 'socket-test',
            sessionId: 'session-test'
        };

        await socketMod._handleDisconnect(mockIo, mockSocket, 'server shutdown');

        const disconnectCall = mockEmit.mock.calls.find(c => c[0] === 'player:disconnected');
        expect(disconnectCall).toBeDefined();

        const eventData = disconnectCall[1];
        // SECURITY FIX: reconnectionToken is no longer broadcast to prevent session hijacking
        expect(eventData).toMatchObject({
            sessionId: 'session-test',
            nickname: 'TestNick',
            team: 'blue',
            reason: 'server shutdown',
            timestamp: expect.any(Number),
            players: mockPlayers,
            // Token is NOT included in broadcast for security reasons
            reconnecting: true,
            reconnectionDeadline: expect.any(Number)
        });
        // Verify token is NOT in the broadcast
        expect(eventData.reconnectionToken).toBeUndefined();
    });
});
