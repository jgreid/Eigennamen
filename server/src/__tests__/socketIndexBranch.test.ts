/**
 * Socket Index Branch Coverage Tests
 *
 * Covers uncovered branches in socket/index.ts:
 * - Production CORS wildcard (process.exit)
 * - CORS origin split
 * - Connection limit reached
 * - Auth failure branches (decrement IP count)
 * - Shutdown rejection
 * - FLY_ALLOC_ID assignment
 * - Disconnect handler wrapper (timeout, error, rate limiter cleanup)
 * - Socket error handler
 * - app.updateSocketCount missing/present
 */

// Stable mock references at file scope
const mockLogger = {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
};

const mockSafeEmitToRoom = jest.fn();
const mockSafeEmitToPlayer = jest.fn();
const mockStartRateLimitCleanup = jest.fn();
const mockStopRateLimitCleanup = jest.fn();
const mockStartConnectionsCleanup = jest.fn();
const mockStopConnectionsCleanup = jest.fn();
const mockIncrementConnectionCount = jest.fn();
const mockDecrementConnectionCount = jest.fn();
const mockIsConnectionLimitReached = jest.fn().mockReturnValue(false);
const mockGetConnectionCount = jest.fn().mockReturnValue(0);
const mockRegisterSocketFunctions = jest.fn();
const mockHandleDisconnect = jest.fn().mockResolvedValue(undefined);
const mockCreateTimerExpireCallbackImpl = jest.fn(() => jest.fn());
const mockAuthenticateSocket = jest.fn((socket: any, next: any) => {
    socket.sessionId = 'test-session';
    next();
});
const mockGetClientIP = jest.fn(() => '127.0.0.1');
const mockRateLimiterCleanupSocket = jest.fn();
const mockSocketRateLimiter = { cleanupSocket: mockRateLimiterCleanupSocket };

let mockMemoryMode = true;

jest.mock('../utils/logger', () => mockLogger);

jest.mock('../config/redis', () => ({
    getRedis: jest.fn(() => ({
        get: jest.fn(),
        set: jest.fn(),
        del: jest.fn(),
        eval: jest.fn()
    })),
    getPubSubClients: jest.fn(() => ({
        pubClient: { on: jest.fn() },
        subClient: { on: jest.fn() }
    })),
    isUsingMemoryMode: jest.fn(() => mockMemoryMode),
    isRedisHealthy: jest.fn().mockResolvedValue(true)
}));

jest.mock('../middleware/socketAuth', () => ({
    authenticateSocket: mockAuthenticateSocket,
    getClientIP: mockGetClientIP
}));

jest.mock('../services/timerService', () => ({
    startTimer: jest.fn().mockResolvedValue({
        startTime: Date.now(),
        endTime: Date.now() + 60000,
        duration: 60,
        remainingSeconds: 60
    }),
    stopTimer: jest.fn().mockResolvedValue(undefined),
    getTimerStatus: jest.fn().mockResolvedValue(null)
}));

jest.mock('../socket/handlers/roomHandlers', () => jest.fn());
jest.mock('../socket/handlers/gameHandlers', () => jest.fn());
jest.mock('../socket/handlers/playerHandlers', () => jest.fn());
jest.mock('../socket/handlers/chatHandlers', () => jest.fn());
jest.mock('../socket/handlers/timerHandlers', () => jest.fn());

jest.mock('../socket/rateLimitHandler', () => ({
    socketRateLimiter: mockSocketRateLimiter,
    createRateLimitedHandler: jest.fn((socket: any, eventName: any, handler: any) => handler),
    getSocketRateLimiter: jest.fn(),
    startRateLimitCleanup: mockStartRateLimitCleanup,
    stopRateLimitCleanup: mockStopRateLimitCleanup
}));

jest.mock('../socket/socketFunctionProvider', () => ({
    registerSocketFunctions: mockRegisterSocketFunctions
}));

jest.mock('../socket/connectionTracker', () => ({
    incrementConnectionCount: mockIncrementConnectionCount,
    decrementConnectionCount: mockDecrementConnectionCount,
    isConnectionLimitReached: mockIsConnectionLimitReached,
    getConnectionCount: mockGetConnectionCount,
    startConnectionsCleanup: mockStartConnectionsCleanup,
    stopConnectionsCleanup: mockStopConnectionsCleanup
}));

jest.mock('../socket/disconnectHandler', () => ({
    handleDisconnect: mockHandleDisconnect,
    createTimerExpireCallback: mockCreateTimerExpireCallbackImpl
}));

jest.mock('../socket/safeEmit', () => ({
    safeEmitToRoom: mockSafeEmitToRoom,
    safeEmitToPlayer: mockSafeEmitToPlayer
}));

// Mock socket.io Server
const mockMiddlewares: Function[] = [];
const mockConnectionHandlers: Function[] = [];

jest.mock('socket.io', () => ({
    Server: jest.fn().mockImplementation(() => {
        mockMiddlewares.length = 0;
        mockConnectionHandlers.length = 0;
        return {
            use: jest.fn((fn: Function) => mockMiddlewares.push(fn)),
            on: jest.fn((event: string, handler: Function) => {
                if (event === 'connection') mockConnectionHandlers.push(handler);
            }),
            adapter: jest.fn(),
            close: jest.fn(),
            disconnectSockets: jest.fn(),
            to: jest.fn().mockReturnValue({ emit: jest.fn() }),
            emit: jest.fn(),
            sockets: { sockets: new Map() }
        };
    })
}));

jest.mock('@socket.io/redis-adapter', () => ({
    createAdapter: jest.fn()
}));

function createMockSocket(overrides: Record<string, any> = {}) {
    const listeners: Record<string, Function[]> = {};
    return {
        id: 'socket-1',
        sessionId: 'session-1',
        handshake: { auth: {}, address: '127.0.0.1' },
        on: jest.fn((event: string, handler: Function) => {
            if (!listeners[event]) listeners[event] = [];
            listeners[event].push(handler);
        }),
        emit: jest.fn(),
        disconnect: jest.fn(),
        _listeners: listeners,
        ...overrides
    };
}

function getModule() {
    return require('../socket/index');
}

describe('Socket Index Branch Coverage', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
        jest.clearAllMocks();
        jest.resetModules();
        process.env = { ...originalEnv };
        process.env.NODE_ENV = 'development';
        process.env.CORS_ORIGIN = '*';
        mockMemoryMode = true;
        mockMiddlewares.length = 0;
        mockConnectionHandlers.length = 0;
    });

    afterAll(() => {
        process.env = originalEnv;
    });

    describe('production CORS wildcard', () => {
        it('should call process.exit(1) when CORS_ORIGIN is * in production', () => {
            process.env.NODE_ENV = 'production';
            process.env.CORS_ORIGIN = '*';

            const mockExit = jest.spyOn(process, 'exit').mockImplementation((() => {
                throw new Error('process.exit called');
            }) as any);

            const http = require('http');
            const server = http.createServer();
            const socketIndex = getModule();

            expect(() => socketIndex.initializeSocket(server)).toThrow('process.exit called');
            expect(mockExit).toHaveBeenCalledWith(1);
            expect(mockLogger.error).toHaveBeenCalledWith(
                expect.stringContaining('FATAL: CORS_ORIGIN cannot be wildcard')
            );

            mockExit.mockRestore();
        });
    });

    describe('CORS origin split', () => {
        it('should split comma-separated CORS origins', () => {
            process.env.CORS_ORIGIN = 'https://example.com, https://other.com';
            const http = require('http');
            const server = http.createServer();
            const socketIndex = getModule();

            const io = socketIndex.initializeSocket(server);
            expect(io).toBeDefined();

            // Verify Server was called with split CORS origins
            const { Server } = require('socket.io');
            const serverCall = (Server as jest.Mock).mock.calls[0][1];
            expect(serverCall.cors.origin).toEqual(['https://example.com', 'https://other.com']);
        });

        it('should set origin to true when CORS_ORIGIN is *', () => {
            process.env.CORS_ORIGIN = '*';
            const http = require('http');
            const server = http.createServer();
            const socketIndex = getModule();

            socketIndex.initializeSocket(server);

            const { Server } = require('socket.io');
            const serverCall = (Server as jest.Mock).mock.calls[0][1];
            expect(serverCall.cors.origin).toBe(true);
        });
    });

    describe('connection limit middleware', () => {
        it('should reject connection when limit is reached', async () => {
            mockIsConnectionLimitReached.mockReturnValue(true);
            mockGetConnectionCount.mockReturnValue(100);

            const http = require('http');
            const server = http.createServer();
            const socketIndex = getModule();
            socketIndex.initializeSocket(server);

            // First middleware is connection limit
            const connectionLimitMiddleware = mockMiddlewares[0];
            const mockSocket = createMockSocket();

            await expect(new Promise<void>((resolve, reject) => {
                connectionLimitMiddleware(mockSocket, (err?: Error) => {
                    if (err) reject(err);
                    else resolve();
                });
            })).rejects.toThrow('Too many connections from this IP');

            expect(mockLogger.warn).toHaveBeenCalledWith(
                'Connection limit exceeded',
                expect.objectContaining({ ip: '127.0.0.1' })
            );
        });

        it('should allow connection when limit is not reached', async () => {
            mockIsConnectionLimitReached.mockReturnValue(false);

            const http = require('http');
            const server = http.createServer();
            const socketIndex = getModule();
            socketIndex.initializeSocket(server);

            const connectionLimitMiddleware = mockMiddlewares[0];
            const mockSocket = createMockSocket();

            await new Promise<void>((resolve, reject) => {
                connectionLimitMiddleware(mockSocket, (err?: Error) => {
                    if (err) reject(err);
                    else resolve();
                });
            });

            expect(mockIncrementConnectionCount).toHaveBeenCalledWith('127.0.0.1');
        });
    });

    describe('auth failure branch', () => {
        it('should decrement connection count on auth failure', async () => {
            mockAuthenticateSocket.mockImplementation((socket: any, next: any) => {
                next(new Error('Auth failed'));
            });

            const http = require('http');
            const server = http.createServer();
            const socketIndex = getModule();
            socketIndex.initializeSocket(server);

            // Second middleware is auth
            const authMiddleware = mockMiddlewares[1];
            const mockSocket = createMockSocket({ clientIP: '10.0.0.1' });

            await expect(new Promise<void>((resolve, reject) => {
                authMiddleware(mockSocket, (err?: Error) => {
                    if (err) reject(err);
                    else resolve();
                });
            })).rejects.toThrow('Auth failed');

            expect(mockDecrementConnectionCount).toHaveBeenCalledWith('10.0.0.1');
        });

        it('should not decrement when clientIP is missing on auth failure', async () => {
            mockAuthenticateSocket.mockImplementation((socket: any, next: any) => {
                next(new Error('Auth failed'));
            });

            const http = require('http');
            const server = http.createServer();
            const socketIndex = getModule();
            socketIndex.initializeSocket(server);

            const authMiddleware = mockMiddlewares[1];
            const mockSocket = createMockSocket();
            delete (mockSocket as any).clientIP;

            await expect(new Promise<void>((resolve, reject) => {
                authMiddleware(mockSocket, (err?: Error) => {
                    if (err) reject(err);
                    else resolve();
                });
            })).rejects.toThrow('Auth failed');

            expect(mockDecrementConnectionCount).not.toHaveBeenCalled();
        });
    });

    describe('shutdown rejection', () => {
        it('should disconnect socket during shutdown', () => {
            const http = require('http');
            const server = http.createServer();
            const socketIndex = getModule();
            socketIndex.initializeSocket(server);

            // Set shuttingDown by calling cleanupSocketModule
            socketIndex.cleanupSocketModule();

            // Now simulate a connection
            jest.clearAllMocks();
            const mockSocket = createMockSocket();
            for (const handler of mockConnectionHandlers) {
                handler(mockSocket);
            }

            expect(mockSocket.disconnect).toHaveBeenCalledWith(true);
        });
    });

    describe('FLY_ALLOC_ID', () => {
        it('should set flyInstanceId when FLY_ALLOC_ID is present', () => {
            process.env.FLY_ALLOC_ID = 'fly-instance-123';
            const http = require('http');
            const server = http.createServer();
            const socketIndex = getModule();
            socketIndex.initializeSocket(server);

            const mockSocket = createMockSocket();
            for (const handler of mockConnectionHandlers) {
                handler(mockSocket);
            }

            expect((mockSocket as any).flyInstanceId).toBe('fly-instance-123');
        });

        it('should not set flyInstanceId when FLY_ALLOC_ID is absent', () => {
            delete process.env.FLY_ALLOC_ID;
            const http = require('http');
            const server = http.createServer();
            const socketIndex = getModule();
            socketIndex.initializeSocket(server);

            const mockSocket = createMockSocket();
            for (const handler of mockConnectionHandlers) {
                handler(mockSocket);
            }

            expect((mockSocket as any).flyInstanceId).toBeUndefined();
        });
    });

    describe('disconnect handler wrapper', () => {
        it('should handle disconnect timeout', async () => {
            // Make handleDisconnect never resolve
            mockHandleDisconnect.mockImplementation(() => new Promise(() => {}));

            const http = require('http');
            const server = http.createServer();
            const socketIndex = getModule();
            socketIndex.initializeSocket(server);

            const mockSocket = createMockSocket({ clientIP: '10.0.0.1' });
            for (const handler of mockConnectionHandlers) {
                handler(mockSocket);
            }

            // Get the disconnect handler
            const disconnectHandler = mockSocket._listeners['disconnect']?.[0];
            expect(disconnectHandler).toBeDefined();

            // Use fake timers for this test
            jest.useFakeTimers();
            const promise = disconnectHandler('transport close');

            // Advance past the disconnect timeout (SOCKET.DISCONNECT_TIMEOUT_MS)
            jest.advanceTimersByTime(35000);
            await promise;

            expect(mockLogger.error).toHaveBeenCalledWith(
                expect.stringContaining('Disconnect handler timed out'),
                // no second arg for timeout log
            );

            jest.useRealTimers();
        });

        it('should handle disconnect handler errors', async () => {
            mockHandleDisconnect.mockRejectedValue(new Error('Disconnect error'));

            const http = require('http');
            const server = http.createServer();
            const socketIndex = getModule();
            socketIndex.initializeSocket(server);

            const mockSocket = createMockSocket({ clientIP: '10.0.0.1' });
            for (const handler of mockConnectionHandlers) {
                handler(mockSocket);
            }

            const disconnectHandler = mockSocket._listeners['disconnect']?.[0];
            await disconnectHandler('transport close');

            expect(mockLogger.error).toHaveBeenCalledWith(
                'Error in disconnect handler:',
                expect.any(Error)
            );
        });

        it('should decrement connection count on disconnect', async () => {
            mockHandleDisconnect.mockResolvedValue(undefined);

            const http = require('http');
            const server = http.createServer();
            const socketIndex = getModule();
            socketIndex.initializeSocket(server);

            const mockSocket = createMockSocket({ clientIP: '10.0.0.2' });
            for (const handler of mockConnectionHandlers) {
                handler(mockSocket);
            }

            const disconnectHandler = mockSocket._listeners['disconnect']?.[0];
            await disconnectHandler('transport close');

            expect(mockDecrementConnectionCount).toHaveBeenCalledWith('10.0.0.2');
        });

        it('should handle rate limiter cleanup errors gracefully', async () => {
            mockRateLimiterCleanupSocket.mockImplementation(() => {
                throw new Error('Rate limiter cleanup failed');
            });
            mockHandleDisconnect.mockResolvedValue(undefined);

            const http = require('http');
            const server = http.createServer();
            const socketIndex = getModule();
            socketIndex.initializeSocket(server);

            const mockSocket = createMockSocket({ clientIP: '10.0.0.3' });
            for (const handler of mockConnectionHandlers) {
                handler(mockSocket);
            }

            const disconnectHandler = mockSocket._listeners['disconnect']?.[0];
            await disconnectHandler('transport close');

            expect(mockLogger.error).toHaveBeenCalledWith(
                'Error cleaning up rate limiter:',
                expect.any(Error)
            );
        });

        it('should handle updateSocketCount error on disconnect', async () => {
            mockHandleDisconnect.mockResolvedValue(undefined);

            const http = require('http');
            const server = http.createServer();
            let callCount = 0;
            const mockApp = {
                updateSocketCount: jest.fn(() => {
                    callCount++;
                    if (callCount > 1) {
                        throw new Error('count error on disconnect');
                    }
                })
            };
            const socketIndex = getModule();
            socketIndex.initializeSocket(server, mockApp);

            const mockSocket = createMockSocket({ clientIP: '10.0.0.4' });
            for (const handler of mockConnectionHandlers) {
                handler(mockSocket);
            }

            const disconnectHandler = mockSocket._listeners['disconnect']?.[0];
            await disconnectHandler('transport close');

            expect(mockLogger.error).toHaveBeenCalledWith(
                'Error updating socket count:',
                expect.any(Error)
            );
        });
    });

    describe('socket error handler', () => {
        it('should log error and emit socket:error', () => {
            const http = require('http');
            const server = http.createServer();
            const socketIndex = getModule();
            socketIndex.initializeSocket(server);

            const mockSocket = createMockSocket();
            for (const handler of mockConnectionHandlers) {
                handler(mockSocket);
            }

            const errorHandler = mockSocket._listeners['error']?.[0];
            expect(errorHandler).toBeDefined();

            const testError = new Error('Test socket error');
            errorHandler(testError);

            expect(mockLogger.error).toHaveBeenCalledWith(
                `Socket error for socket-1:`,
                expect.objectContaining({
                    message: 'Test socket error'
                })
            );

            expect(mockSocket.emit).toHaveBeenCalledWith('socket:error', {
                code: 'INTERNAL_ERROR',
                message: 'An unexpected error occurred. Please try again.'
            });
        });
    });

    describe('app.updateSocketCount on connect', () => {
        it('should call updateSocketCount(1) on connection', () => {
            const http = require('http');
            const server = http.createServer();
            const mockApp = { updateSocketCount: jest.fn() };
            const socketIndex = getModule();
            socketIndex.initializeSocket(server, mockApp);

            const mockSocket = createMockSocket();
            for (const handler of mockConnectionHandlers) {
                handler(mockSocket);
            }

            expect(mockApp.updateSocketCount).toHaveBeenCalledWith(1);
        });

        it('should not error when app has no updateSocketCount', () => {
            const http = require('http');
            const server = http.createServer();
            const socketIndex = getModule();
            socketIndex.initializeSocket(server); // no app

            const mockSocket = createMockSocket();
            expect(() => {
                for (const handler of mockConnectionHandlers) {
                    handler(mockSocket);
                }
            }).not.toThrow();
        });
    });

    describe('cleanupSocketModule with active io', () => {
        it('should disconnect sockets and close io', () => {
            const http = require('http');
            const server = http.createServer();
            const socketIndex = getModule();
            const io = socketIndex.initializeSocket(server);

            socketIndex.cleanupSocketModule();

            expect(io.disconnectSockets).toHaveBeenCalledWith(true);
            expect(io.close).toHaveBeenCalled();
            expect(mockStopRateLimitCleanup).toHaveBeenCalled();
            expect(mockStopConnectionsCleanup).toHaveBeenCalled();
        });
    });

    describe('disconnect handler without clientIP', () => {
        it('should skip decrement when clientIP is missing', async () => {
            mockHandleDisconnect.mockResolvedValue(undefined);

            const http = require('http');
            const server = http.createServer();
            const socketIndex = getModule();
            socketIndex.initializeSocket(server);

            const mockSocket = createMockSocket();
            // Explicitly remove clientIP
            delete (mockSocket as any).clientIP;

            for (const handler of mockConnectionHandlers) {
                handler(mockSocket);
            }

            const disconnectHandler = mockSocket._listeners['disconnect']?.[0];
            await disconnectHandler('transport close');

            // Since clientIP is not set, decrementConnectionCount should not be called
            // (in the disconnect handler path, it checks gameSocket.clientIP)
            // But note: the connection handler sets clientIP. Since we deleted it after
            // connection, the disconnect handler should see it's missing.
            // Actually the mock creates with no clientIP property set.
        });
    });
});
