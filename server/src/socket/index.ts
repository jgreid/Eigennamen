/**
 * Socket.io Module - Entry Point
 *
 * Thin wiring layer that delegates to focused sub-modules:
 *   - serverConfig: Socket.io server creation and configuration
 *   - connectionHandler: Per-connection handler registration and lifecycle
 *   - connectionTracker: IP-based connection counting
 *   - rateLimitHandler: Per-socket event rate limiting
 *   - disconnectHandler: Disconnect cleanup logic
 *   - socketFunctionProvider: Shared function registry for handlers
 */

import type { Server as HttpServer } from 'http';
import type { Server as SocketIOServer, Socket } from 'socket.io';
import type { TimerCallback } from '../types';
import type { GameSocket } from './rateLimitHandler';
import type { TimerInfo } from './socketFunctionProvider';

import logger from '../utils/logger';
import { authenticateSocket, getClientIP } from '../middleware/socketAuth';
import * as timerService from '../services/timerService';
import { SOCKET_EVENTS } from '../config/constants';
import {
    getSocketRateLimiter,
    createRateLimitedHandler,
    startRateLimitCleanup,
    stopRateLimitCleanup
} from './rateLimitHandler';
import { safeEmitToRoom } from './safeEmit';
import {
    incrementConnectionCount,
    decrementConnectionCount,
    isConnectionLimitReached,
    getConnectionCount,
    startConnectionsCleanup,
    stopConnectionsCleanup
} from './connectionTracker';
import {
    handleDisconnect,
    createTimerExpireCallback as createTimerExpireCallbackImpl
} from './disconnectHandler';
import { createSocketServer } from './serverConfig';
import { handleConnection, ensureSocketFunctionsRegistered } from './connectionHandler';

import type { ExpressAppWithSockets } from './connectionHandler';

let io: SocketIOServer | null = null;
let app: ExpressAppWithSockets | null = null;
let shuttingDown = false;

// ─── Socket Helper Functions ────────────────────────────────────────

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
 */
function emitToRoom(roomCode: string, event: string, data: unknown): void {
    safeEmitToRoom(io, roomCode, event, data);
}

/**
 * Helper to emit to a specific player
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
    emitToRoom(roomCode, SOCKET_EVENTS.TIMER_STARTED, { ...timerInfo, roomCode });
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
function getTimerStatus(roomCode: string): Promise<unknown> {
    return timerService.getTimerStatus(roomCode);
}

/**
 * Wrapper around the extracted createTimerExpireCallback that binds
 * the module-level emitToRoom and startTurnTimer functions.
 */
function createTimerExpireCallback(): TimerCallback {
    return createTimerExpireCallbackImpl(emitToRoom, startTurnTimer);
}

// ─── Socket Functions Bundle ────────────────────────────────────────

/** Bundle of socket functions passed to connectionHandler */
const socketFns = {
    emitToRoom,
    emitToPlayer,
    startTurnTimer,
    stopTurnTimer,
    getTimerStatus,
    getIO,
    createTimerExpireCallback
};

// ─── Initialization ─────────────────────────────────────────────────

/**
 * Initialize Socket.io with the HTTP server
 */
function initializeSocket(server: HttpServer, expressApp?: ExpressAppWithSockets): SocketIOServer {
    app = expressApp || null;

    // Create and configure the Socket.io server
    const socketServer = createSocketServer(server);
    io = socketServer;

    // Connection limits middleware - check before authentication
    socketServer.use((socket: Socket, next: (err?: Error) => void) => {
        const clientIP = getClientIP(socket) || 'unknown';

        if (isConnectionLimitReached(clientIP)) {
            logger.warn('Connection limit exceeded', { ip: clientIP, count: getConnectionCount(clientIP) });
            return next(new Error('Too many connections from this IP'));
        }

        (socket as GameSocket).clientIP = clientIP;
        incrementConnectionCount(clientIP);
        next();
    });

    // Authentication middleware - decrement IP counter on auth failure
    socketServer.use((socket: Socket, next: (err?: Error) => void) => {
        authenticateSocket(socket, (err?: Error) => {
            if (err) {
                const gameSocket = socket as GameSocket;
                if (gameSocket.clientIP) {
                    decrementConnectionCount(gameSocket.clientIP);
                }
                return next(err);
            }
            next();
        });
    });

    // Connection handling - delegate to connectionHandler
    socketServer.on('connection', (socket: Socket) => {
        if (shuttingDown) {
            socket.disconnect(true);
            return;
        }
        handleConnection(socketServer, socket, app, socketFns);
    });

    // Start periodic cleanups
    startRateLimitCleanup();
    startConnectionsCleanup(socketServer);

    // Register socket functions for edge case of no connections yet
    ensureSocketFunctionsRegistered(socketFns);

    return socketServer;
}

// ─── Cleanup ────────────────────────────────────────────────────────

/**
 * Cleanup socket module resources on shutdown
 */
function cleanupSocketModule(): void {
    shuttingDown = true;
    stopRateLimitCleanup();
    stopConnectionsCleanup();

    if (io) {
        io.disconnectSockets(true);
        io.close();
        io = null;
    }

    logger.info('Socket module cleaned up');
}

// ─── Exports ────────────────────────────────────────────────────────

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
