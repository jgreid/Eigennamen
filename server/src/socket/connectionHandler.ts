/**
 * Socket Connection Handler
 *
 * Handles individual socket connections:
 *   - Handler registration (room, game, player, chat, timer)
 *   - Socket function provider initialization
 *   - Disconnect handling with timeout protection
 *   - Error handling
 */

import type { Server as SocketIOServer, Socket } from 'socket.io';
import type { GameSocket, SocketRateLimiter } from './rateLimitHandler';

import logger from '../utils/logger';
import { SOCKET, ERROR_CODES } from '../config/constants';
import {
    socketRateLimiter,
} from './rateLimitHandler';
import { registerSocketFunctions, isRegistered } from './socketFunctionProvider';
import type { SocketFunctions } from './socketFunctionProvider';
import {
    handleDisconnect,
    createTimerExpireCallback as createTimerExpireCallbackImpl
} from './disconnectHandler';
import { decrementConnectionCount } from './connectionTracker';

// Import handlers
import roomHandlers from './handlers/roomHandlers';
import gameHandlers from './handlers/gameHandlers';
import playerHandlers from './handlers/playerHandlers';
import chatHandlers from './handlers/chatHandlers';
import timerHandlers from './handlers/timerHandlers';

/**
 * Express app with socket count update function
 */
interface ExpressAppWithSockets {
    updateSocketCount?: (delta: number) => void;
}

/**
 * Create a timer expire callback bound to the given socket functions.
 */
function createTimerExpireCallback(socketFns: SocketFunctions): SocketFunctions['createTimerExpireCallback'] {
    return () => createTimerExpireCallbackImpl(socketFns.emitToRoom, socketFns.startTurnTimer);
}

/**
 * Ensure socket functions are registered (idempotent).
 * Must be called before handlers can use getSocketFunctions().
 */
function ensureSocketFunctionsRegistered(socketFns: SocketFunctions): void {
    if (!isRegistered()) {
        registerSocketFunctions({
            ...socketFns,
            createTimerExpireCallback: createTimerExpireCallback(socketFns)
        });
    }
}

/**
 * Register all event handlers on a connected socket and set up
 * disconnect/error handling.
 */
function handleConnection(
    socketServer: SocketIOServer,
    socket: Socket,
    app: ExpressAppWithSockets | null,
    socketFns: SocketFunctions
): void {
    const gameSocket = socket as GameSocket;

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

    // Ensure socket functions are registered before handlers run.
    // If registration fails, disconnect the socket to prevent handlers
    // from running without the required function dependencies.
    try {
        ensureSocketFunctionsRegistered(socketFns);
    } catch (regError) {
        logger.error('Failed to register socket functions, disconnecting:', regError);
        socket.disconnect(true);
        return;
    }

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
            code: ERROR_CODES.SERVER_ERROR,
            message: 'An unexpected error occurred. Please try again.'
        });
    });
}

export { handleConnection, ensureSocketFunctionsRegistered, createTimerExpireCallback };
export type { ExpressAppWithSockets };
