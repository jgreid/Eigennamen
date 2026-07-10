import type { Server as HttpServer } from 'http';
import type { Server as SocketServer } from 'socket.io';

import dotenv from 'dotenv';
dotenv.config({ quiet: true });

import http from 'http';
import app from './app';
import { initializeSocket, cleanupSocketModule } from './socket';
import { connectRedis, disconnectRedis, getRedis, isUsingMemoryMode } from './config/redis';
import { isProduction } from './config/env';
import { validateEnv, getEnvInt } from './config/env';
import * as timerService from './services/timerService';
import { startMemoryMonitoring, stopMemoryMonitoring } from './middleware/timing';
import { pruneStaleMetrics } from './utils/metrics';
import { warmSemanticBackend } from './bots/semantics/selectBackend';
import logger from './utils/logger';

const PORT: number = getEnvInt('PORT', 3000) ?? 3000;

async function startServer(): Promise<void> {
    try {
        // Validate environment variables first
        validateEnv();

        await connectRedis();
        logger.info('Redis connected');

        // Create HTTP server
        const server: HttpServer = http.createServer(app);

        // Initialize Socket.io with app reference for socket count caching
        const io: SocketServer = initializeSocket(server, app);
        logger.info('Socket.io initialized');

        // Attach dependencies to app for health checks
        app.set('io', io);
        app.set('redis', getRedis);

        // Warm the bot semantic backend off the event loop (N20). When
        // BOT_EMBEDDINGS_PATH is set this parses a large vectors file; doing it
        // now — chunked and yielding — means the first bot to act after a restart
        // uses the ready vectors instead of triggering a multi-hundred-ms
        // synchronous parse that would stall every room, socket, and health probe.
        // Fire-and-forget: until it resolves, bots transparently use the table
        // fallback, so startup is never delayed by it.
        void warmSemanticBackend().catch((err: unknown) => {
            logger.warn('Bot semantic backend warm failed (bots will use the fallback backend)', {
                error: err instanceof Error ? err.message : String(err),
            });
        });

        // Log Fly.io instance info if available
        if (process.env.FLY_ALLOC_ID) {
            logger.info(`Fly.io instance: ${process.env.FLY_ALLOC_ID} in region ${process.env.FLY_REGION}`);

            // Warn at runtime if memory mode is being used on Fly.io
            // (validateEnv blocks this by default, but the escape hatch
            // MEMORY_MODE_ALLOW_FLY=true can bypass it)
            if (isUsingMemoryMode()) {
                logger.warn('=== SPLIT-BRAIN RISK: Running in-memory storage on Fly.io ===');
                logger.warn('Rooms created on this instance are invisible to other instances.');
                logger.warn('Ensure only 1 machine is active: fly scale count 1');
            }
        }

        // Start listening - bind to 0.0.0.0 to accept connections from outside container
        server.listen(PORT, '0.0.0.0', () => {
            logger.info(`Server running on http://0.0.0.0:${PORT}`);
            logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);

            // Log feature availability so operators know what's active
            const features = {
                redis: isUsingMemoryMode() ? 'in-memory (embedded)' : 'external',
            };
            logger.info('Feature status:', features);

            // Start memory monitoring
            startMemoryMonitoring();

            // Periodically prune stale metrics to prevent unbounded memory growth
            const metricsPruneTimer = setInterval(() => pruneStaleMetrics(), 3600000);
            metricsPruneTimer.unref();
        });

        // Graceful shutdown (guarded against duplicate signals)
        let isShuttingDown = false;
        const shutdown = async (signal: string): Promise<void> => {
            if (isShuttingDown) {
                logger.info(`${signal} received, shutdown already in progress`);
                return;
            }
            isShuttingDown = true;
            logger.info(`${signal} received, shutting down gracefully`);

            // Stop memory monitoring
            stopMemoryMonitoring();

            // Clean up all active timers first (prevents pending callbacks)
            timerService.cleanupAllTimers();
            logger.info('All timers cleaned up');

            // Clean up socket module (notify clients, drain, disconnect)
            await cleanupSocketModule();

            // Stop accepting new connections
            server.close(async () => {
                logger.info('HTTP server closed');

                try {
                    // Close connections with individual timeouts to prevent hanging
                    const disconnectWithTimeout = (fn: () => Promise<unknown>, name: string, ms: number) =>
                        Promise.race([
                            fn().then(() => logger.info(`${name} disconnected`)),
                            new Promise<void>((resolve) =>
                                setTimeout(() => {
                                    logger.warn(`${name} disconnect timed out after ${ms}ms`);
                                    resolve();
                                }, ms)
                            ),
                        ]);

                    await disconnectWithTimeout(disconnectRedis, 'Redis', 3000);
                } catch (error) {
                    logger.error('Error during cleanup:', error);
                }

                process.exit(0);
            });

            // Destroy any still-open connections so server.close()'s callback
            // actually fires. cleanupSocketModule() above has already gracefully
            // drained the Socket.io clients, but a long-lived HTTP response — most
            // notably the admin SSE stats stream (`/health` / admin stream) — keeps
            // its socket open indefinitely and would otherwise block close() until
            // Fly's SIGKILL, skipping the clean Redis disconnect. (B14)
            server.closeAllConnections();

            // Force exit after timeout (kept below fly.toml's kill_timeout=15s so
            // this fires before Fly SIGKILLs the machine).
            setTimeout(() => {
                logger.error('Forced shutdown after timeout');
                process.exit(1);
            }, 10000);
        };

        process.on('SIGTERM', () => shutdown('SIGTERM'));
        process.on('SIGINT', () => shutdown('SIGINT'));

        // Handle uncaught errors
        process.on('uncaughtException', (error: Error) => {
            logger.error('Uncaught exception:', error);
            shutdown('UNCAUGHT_EXCEPTION');
        });

        process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
            logger.error('Unhandled rejection', { promise, reason });
            // In production, terminate on unhandled rejections to avoid corrupted state
            if (isProduction()) {
                shutdown('UNHANDLED_REJECTION');
            }
        });
    } catch (error) {
        logger.error('Failed to start server:', error);
        process.exit(1);
    }
}

startServer();
