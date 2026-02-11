/**
 * Socket.io Configuration and Event Handling
 * Optimized for Fly.io deployment with WebSocket transport
 */

import type { Server as HttpServer } from 'http';
import type { Server as SocketIOServer, Socket } from 'socket.io';
import type { Express } from 'express';
import type { TimerCallback } from '../types';
import type { GameSocket, SocketRateLimiter } from './rateLimitHandler';
import type { TimerInfo } from './socketFunctionProvider';

import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { getPubSubClients, isUsingMemoryMode } from '../infrastructure/redis';
import logger from '../utils/logger';
import { authenticateSocket, getClientIP } from '../middleware/socketAuth';
import * as timerService from '../services/timerService';
import { SOCKET, SOCKET_EVENTS } from '../config/constants';
import { socketRateLimiter, createRateLimitedHandler, getSocketRateLimiter, startRateLimitCleanup, stopRateLimitCleanup } from './rateLimitHandler';
import { registerSocketFunctions } from './socketFunctionProvider';
import { safeEmitToRoom } from './safeEmit';
import { incrementConnectionCount, decrementConnectionCount, isConnectionLimitReached, getConnectionCount, startConnectionsCleanup, stopConnectionsCleanup } from './connectionTracker';
import { handleDisconnect, createTimerExpireCallback as _createTimerExpireCallback } from './disconnectHandler';
// Import handlers AFTER rate limiter is set up to avoid circular dependency issues
import roomHandlers from './handlers/roomHandlers';
import gameHandlers from './handlers/gameHandlers';
import playerHandlers from './handlers/playerHandlers';
import chatHandlers from './handlers/chatHandlers';
import timerHandlers from './handlers/timerHandlers';
/**
 * Express app with socket count update function
 */
interface ExpressAppWithSockets extends Express {
    updateSocketCount?: (delta: number) => void;
}

let io: SocketIOServer | null = null;
let app: ExpressAppWithSockets | null = null; // Reference to Express app for socket count updates
let shuttingDown = false;

/**
 * Wrapper around the extracted createTimerExpireCallback that binds
 * the module-level emitToRoom and startTurnTimer functions.
 * Preserves the original zero-argument signature expected by
 * socketFunctionProvider and callers.
 */
function createTimerExpireCallback(): TimerCallback {
    return _createTimerExpireCallback(emitToRoom, startTurnTimer);
}

/**
 * Initialize Socket.io with the HTTP server
 * @param server - HTTP server instance
 * @param expressApp - Optional Express app for socket count updates
 * @returns Socket.io server instance
 */
function initializeSocket(server: HttpServer, expressApp?: ExpressAppWithSockets): SocketIOServer {
    app = expressApp || null;
    const isProduction = process.env.NODE_ENV === 'production';
    const corsOrigin = process.env.CORS_ORIGIN || '*';

    // SECURITY FIX: Block wildcard CORS in production for Socket.io
    // This matches the validation in app.ts for Express CORS
    if (isProduction && corsOrigin === '*') {
        logger.error('FATAL: CORS_ORIGIN cannot be wildcard (*) in production for Socket.io');
        logger.error('Set CORS_ORIGIN to your domain(s), e.g., CORS_ORIGIN=https://yourdomain.com');
        process.exit(1);
    }

    const socketServer: SocketIOServer = new Server(server, {
        cors: {
            origin: corsOrigin === '*' ? true : corsOrigin.split(',').map((s: string) => s.trim()),
            methods: ['GET', 'POST'],
            credentials: true
        },
        // Use WebSocket only in production for better Fly.io compatibility
        // Polling can have issues with Fly.io's proxy and load balancing
        transports: isProduction ? ['websocket'] : ['polling', 'websocket'],
        // Allow upgrades in development
        allowUpgrades: !isProduction,
        // Increase timeouts for better stability on Fly.io (from centralized constants)
        pingTimeout: SOCKET.PING_TIMEOUT_MS,
        pingInterval: SOCKET.PING_INTERVAL_MS,
        // SECURITY FIX: Limit max message size to prevent memory exhaustion
        maxHttpBufferSize: SOCKET.MAX_HTTP_BUFFER_SIZE,
        // Connection state recovery for reconnections
        connectionStateRecovery: {
            // Maximum duration a connection can be offline
            maxDisconnectionDuration: SOCKET.MAX_DISCONNECTION_DURATION_MS,
            // Skip middlewares on reconnection
            skipMiddlewares: false
        },
        // Allow EIO4 for older clients
        allowEIO3: true,
        // US-16.4: Enable per-message deflate compression for reduced bandwidth
        perMessageDeflate: {
            threshold: 1024, // Only compress messages larger than 1KB
            zlibDeflateOptions: {
                chunkSize: 16 * 1024 // 16KB chunks
            },
            zlibInflateOptions: {
                chunkSize: 16 * 1024
            },
            clientNoContextTakeover: true, // Don't keep compression context between messages
            serverNoContextTakeover: true
        }
    });

    // Assign to module-level variable
    io = socketServer;

    // Use Redis adapter for horizontal scaling (skip in memory mode)
    if (isUsingMemoryMode()) {
        logger.info('Using Socket.io in-memory adapter (single-instance mode)');
    } else {
        try {
            const { pubClient, subClient } = getPubSubClients();
            socketServer.adapter(createAdapter(pubClient, subClient));
            logger.info('Socket.io Redis adapter configured for horizontal scaling');
        } catch (error) {
            logger.warn('Redis adapter not available, using in-memory adapter (single instance only):', (error as Error).message);
        }
    }

    // Connection limits middleware - check before authentication
    socketServer.use((socket: Socket, next: (err?: Error) => void) => {
        // SECURITY FIX: Use getClientIP which only trusts X-Forwarded-For behind configured proxies
        const clientIP = getClientIP(socket) || 'unknown';

        if (isConnectionLimitReached(clientIP)) {
            logger.warn('Connection limit exceeded', { ip: clientIP, count: getConnectionCount(clientIP) });
            return next(new Error('Too many connections from this IP'));
        }

        // Store IP on socket for tracking
        (socket as GameSocket).clientIP = clientIP;
        incrementConnectionCount(clientIP);
        next();
    });

    // Authentication middleware - decrement IP counter on auth failure
    socketServer.use((socket: Socket, next: (err?: Error) => void) => {
        authenticateSocket(socket, (err?: Error) => {
            if (err) {
                // Auth failed: decrement connectionsPerIP to prevent permanent IP blocking
                const gameSocket = socket as GameSocket;
                if (gameSocket.clientIP) {
                    decrementConnectionCount(gameSocket.clientIP);
                }
                return next(err);
            }
            next();
        });
    });

    // Connection handling
    socketServer.on('connection', (socket: Socket) => {
        const gameSocket = socket as GameSocket;

        // Reject connections during shutdown to prevent handlers referencing a null io
        if (shuttingDown) {
            socket.disconnect(true);
            return;
        }

        logger.info(`Client connected: ${socket.id} (session: ${gameSocket.sessionId})`);

        // Update cached socket count for fast health checks
        if (app && typeof app.updateSocketCount === 'function') {
            app.updateSocketCount(1);
        }

        // Store the Fly.io instance ID for debugging multi-instance issues
        if (process.env.FLY_ALLOC_ID) {
            gameSocket.flyInstanceId = process.env.FLY_ALLOC_ID;
        }

        // Attach rate limiter to socket for use in handlers
        gameSocket.rateLimiter = socketRateLimiter;

        // Register all event handlers
        roomHandlers(socketServer, gameSocket);
        gameHandlers(socketServer, gameSocket);
        playerHandlers(socketServer, gameSocket);
        chatHandlers(socketServer, gameSocket);
        timerHandlers(socketServer, gameSocket);

        // Handle disconnection
        // Wrap disconnect handler in timeout to prevent hangs
        socket.on('disconnect', async (reason: string) => {
            logger.info(`Client disconnected: ${socket.id} (reason: ${reason})`);

            // Decrement connection count for this IP
            if (gameSocket.clientIP) {
                decrementConnectionCount(gameSocket.clientIP);
            }

            // Update cached socket count for fast health checks
            try {
                if (app && typeof app.updateSocketCount === 'function') {
                    app.updateSocketCount(-1);
                }
            } catch (error) {
                logger.error('Error updating socket count:', error);
            }

            // Clean up rate limiter entries for this socket to prevent memory leaks
            try {
                (socketRateLimiter as SocketRateLimiter).cleanupSocket(socket.id);
            } catch (error) {
                logger.error('Error cleaning up rate limiter:', error);
            }

            // Timeout wrapper for disconnect handler - prevents indefinite hangs.
            // Uses AbortController so the handler can check signal.aborted between
            // async steps and stop doing unnecessary work after timeout.
            const abortController = new AbortController();
            let disconnectTimeoutId: ReturnType<typeof setTimeout> | undefined;

            try {
                await Promise.race([
                    handleDisconnect(socketServer, gameSocket, reason, abortController.signal),
                    new Promise((_, reject) => {
                        disconnectTimeoutId = setTimeout(() => {
                            abortController.abort();
                            reject(new Error('Disconnect handler timeout'));
                        }, SOCKET.DISCONNECT_TIMEOUT_MS);
                    })
                ]);
            } catch (error) {
                if ((error as Error).message === 'Disconnect handler timeout') {
                    logger.error(`Disconnect handler timed out after ${SOCKET.DISCONNECT_TIMEOUT_MS}ms for socket ${socket.id}`);
                } else {
                    logger.error('Error in disconnect handler:', error);
                }
            } finally {
                // Clear the timeout to prevent timer leak when handleDisconnect resolves first
                if (disconnectTimeoutId !== undefined) {
                    clearTimeout(disconnectTimeoutId);
                }
            }
        });

        // Handle socket errors
        socket.on('error', (error: Error) => {
            logger.error(`Socket error for ${socket.id}:`, {
                message: error.message,
                sessionId: gameSocket.sessionId
            });

            socket.emit('socket:error', {
                code: 'INTERNAL_ERROR',
                message: 'An unexpected error occurred. Please try again.'
            });
        });
    });

    // Start periodic cleanup of stale rate limit entries
    startRateLimitCleanup();

    // Periodic cleanup of connectionsPerIP to prevent stale entries
    // Recounts actual connected sockets per IP every 5 minutes
    startConnectionsCleanup(socketServer);

    // Register socket functions for handlers (breaks circular dependency)
    registerSocketFunctions({
        emitToRoom,
        emitToPlayer,
        startTurnTimer,
        stopTurnTimer,
        getTimerStatus: getTimerStatus as any,
        getIO,
        createTimerExpireCallback
    });

    return socketServer;
}

/**
 * Get the Socket.io server instance
 * @throws Error if not initialized
 */
function getIO(): SocketIOServer {
    if (!io) {
        throw new Error('Socket.io not initialized');
    }
    return io;
}

/**
 * Helper to emit to a specific room
 * HARDENING: Delegates to safeEmitToRoom for consistent error handling
 */
function emitToRoom(roomCode: string, event: string, data: unknown): void {
    safeEmitToRoom(io, roomCode, event, data);
}

/**
 * Helper to emit to a specific player
 * HARDENING: Delegates to safeEmitToPlayer for consistent error handling
 */
function emitToPlayer(sessionId: string, event: string, data: unknown): void {
    const { safeEmitToPlayer } = require('./safeEmit');
    safeEmitToPlayer(io, sessionId, event, data);
}

/**
 * Start a turn timer for a room (async)
 */
async function startTurnTimer(roomCode: string, durationSeconds: number): Promise<TimerInfo> {
    const timerInfo: TimerInfo = await timerService.startTimer(roomCode, durationSeconds, createTimerExpireCallback());

    // Broadcast timer start
    emitToRoom(roomCode, SOCKET_EVENTS.TIMER_STARTED, {
        ...timerInfo,
        roomCode
    });

    return timerInfo;
}

/**
 * Stop the turn timer for a room (async)
 */
async function stopTurnTimer(roomCode: string): Promise<void> {
    await timerService.stopTimer(roomCode);
    emitToRoom(roomCode, SOCKET_EVENTS.TIMER_STOPPED, { roomCode });
}

/**
 * Get timer status for a room (async)
 */
function getTimerStatus(roomCode: string) {
    return timerService.getTimerStatus(roomCode);
}

/**
 * Cleanup socket module resources on shutdown
 * Call this before process exit to prevent memory leaks
 */
function cleanupSocketModule(): void {
    // Set shutdown flag to reject new connections immediately
    shuttingDown = true;

    // Stop rate limiter cleanup interval
    stopRateLimitCleanup();

    // Stop connectionsPerIP cleanup interval
    stopConnectionsCleanup();

    // Close socket.io server if initialized
    if (io) {
        io.disconnectSockets(true); // Force-disconnect so disconnect handlers run while io is valid
        io.close();
        io = null;
    }

    logger.info('Socket module cleaned up');
}

// Export internal functions for testing (prefixed with _ to indicate internal use)
export {
    initializeSocket,
    getIO,
    emitToRoom,
    emitToPlayer,
    startTurnTimer,
    stopTurnTimer,
    getTimerStatus,
    getSocketRateLimiter,
    createRateLimitedHandler,
    cleanupSocketModule,
    handleDisconnect as _handleDisconnect,
    createTimerExpireCallback as _createTimerExpireCallback
};
