/**
 * Socket.io Server Configuration
 *
 * Creates and configures the Socket.io server instance with:
 *   - CORS settings (production safety)
 *   - Transport configuration (WebSocket-only in prod for Fly.io)
 *   - Ping/timeout tuning
 *   - Message size limits
 *   - Connection state recovery
 *   - Per-message deflate compression
 *   - Redis adapter for horizontal scaling
 */

import type { Server as HttpServer } from 'http';
import type { Server as SocketIOServer } from 'socket.io';

import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { getPubSubClients, isUsingMemoryMode } from '../config/redis';
import logger from '../utils/logger';
import { SOCKET } from '../config/constants';

/**
 * Create and configure the Socket.io server instance.
 * Includes CORS validation, transport settings, and Redis adapter setup.
 */
function createSocketServer(server: HttpServer): SocketIOServer {
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

    return socketServer;
}

export { createSocketServer };
