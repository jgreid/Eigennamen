import type { Server as HttpServer } from 'http';
import type { Server as SocketIOServer, Socket } from 'socket.io';
import type { TimerCallback } from '../types';
import type { TimerStatus } from '../services/timerService';
import type { GameSocket } from './rateLimitHandler';
import type { TimerInfo } from './socketFunctionProvider';

import logger from '../utils/logger';
import { authenticateSocket, getClientIP } from '../middleware/socketAuth';
import * as timerService from '../services/timerService';
import { registerRoomCleanup } from '../services/playerService';
import { cleanupRoom } from '../services/roomService';
import { SOCKET_EVENTS, SOCKET } from '../config/constants';
import {
    getSocketRateLimiter,
    createRateLimitedHandler,
    startRateLimitCleanup,
    stopRateLimitCleanup
} from './rateLimitHandler';
import { safeEmitToRoom, safeEmitToPlayer } from './safeEmit';
import {
    incrementConnectionCount,
    decrementConnectionCount,
    isConnectionLimitReached,
    getConnectionCount,
    startConnectionsCleanup,
    stopConnectionsCleanup,
    recordAuthFailure,
    isAuthBlocked,
    clearAuthFailures
} from './connectionTracker';
import {
    createTimerExpireCallback as createTimerExpireCallbackImpl
} from './disconnectHandler';
import { createSocketServer } from './serverConfig';
import { handleConnection, ensureSocketFunctionsRegistered } from './connectionHandler';

import type { ExpressAppWithSockets } from './connectionHandler';

let io: SocketIOServer | null = null;
let app: ExpressAppWithSockets | null = null;
let shuttingDown = false;


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
function getTimerStatus(roomCode: string): Promise<TimerStatus | null> {
    return timerService.getTimerStatus(roomCode);
}

/**
 * Wrapper around the extracted createTimerExpireCallback that binds
 * the module-level emitToRoom and startTurnTimer functions.
 */
function createTimerExpireCallback(): TimerCallback {
    return createTimerExpireCallbackImpl(emitToRoom, startTurnTimer);
}


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

        // Check auth failure block before allowing connection
        if (isAuthBlocked(clientIP)) {
            logger.warn('Connection rejected: IP blocked due to auth failures', { ip: clientIP });
            return next(new Error('Too many failed authentication attempts. Try again later.'));
        }

        if (isConnectionLimitReached(clientIP)) {
            logger.warn('Connection limit exceeded', { ip: clientIP, count: getConnectionCount(clientIP) });
            return next(new Error('Too many connections from this IP'));
        }

        (socket as GameSocket).clientIP = clientIP;
        incrementConnectionCount(clientIP);
        next();
    });

    // Authentication middleware - decrement IP counter on auth failure, track failures
    socketServer.use((socket: Socket, next: (err?: Error) => void) => {
        authenticateSocket(socket, (err?: Error) => {
            if (err) {
                const gameSocket = socket as GameSocket;
                if (gameSocket.clientIP) {
                    decrementConnectionCount(gameSocket.clientIP);
                    recordAuthFailure(gameSocket.clientIP);
                }
                return next(err);
            }
            // Clear failure record on successful auth
            const gameSocket = socket as GameSocket;
            if (gameSocket.clientIP) {
                clearAuthFailures(gameSocket.clientIP);
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

    // Periodic sweep of stale local timer entries (piggybacks on the same cadence)
    const timerSweepInterval = setInterval(() => {
        timerService.sweepStaleTimers();
    }, SOCKET.CONNECTIONS_CLEANUP_INTERVAL_MS);
    timerSweepInterval.unref();

    // Register socket functions for edge case of no connections yet
    ensureSocketFunctionsRegistered(socketFns);

    // Wire up room cleanup callback to break playerService ↔ roomService circular dependency
    registerRoomCleanup(cleanupRoom);

    return socketServer;
}


/**
 * Cleanup socket module resources on shutdown.
 *
 * 1. Stop accepting new connections (shuttingDown flag)
 * 2. Notify all connected clients of the impending shutdown
 * 3. Wait a brief drain period so clients can save state
 * 4. Force-disconnect remaining sockets and close the server
 */
async function cleanupSocketModule(): Promise<void> {
    shuttingDown = true;
    stopRateLimitCleanup();
    stopConnectionsCleanup();

    if (io) {
        const connectedCount = io.sockets.sockets.size;

        if (connectedCount > 0) {
            // Notify all connected sockets before disconnecting
            try {
                io.emit(SOCKET_EVENTS.ROOM_WARNING, {
                    type: 'server_shutdown',
                    message: 'Server is restarting. You will be reconnected automatically.',
                    timestamp: Date.now()
                });
            } catch (emitErr) {
                logger.warn('Failed to emit shutdown warning:', (emitErr as Error).message);
            }

            // Brief drain period so clients can process the warning
            // (capped by the force-exit timeout in index.ts)
            const drainMs = SOCKET.SHUTDOWN_DRAIN_MS;
            await new Promise<void>(resolve => setTimeout(resolve, drainMs));
        }

        io.disconnectSockets(true);
        io.close();
        io = null;
    }

    logger.info('Socket module cleaned up');
}


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
    cleanupSocketModule
};
