/**
 * Codenames Online - Server Entry Point
 */

require('dotenv').config();

const http = require('http');
const app = require('./app');
const { initializeSocket } = require('./socket');
const { connectRedis, disconnectRedis, getRedis } = require('./config/redis');
const { connectDatabase, disconnectDatabase } = require('./config/database');
const { validateEnv, getEnvInt } = require('./config/env');
const timerService = require('./services/timerService');
const logger = require('./utils/logger');

const PORT = getEnvInt('PORT', 3001);

async function startServer() {
    try {
        // Validate environment variables first
        validateEnv();

        // Connect to databases
        await connectDatabase();
        logger.info('Database connected');

        await connectRedis();
        logger.info('Redis connected');

        // Create HTTP server
        const server = http.createServer(app);

        // Initialize Socket.io
        const io = initializeSocket(server);
        logger.info('Socket.io initialized');

        // Attach io to app for health checks
        app.set('io', io);
        app.set('redis', getRedis);

        // Start listening
        server.listen(PORT, () => {
            logger.info(`Server running on port ${PORT}`);
            logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
        });

        // Graceful shutdown
        const shutdown = async (signal) => {
            logger.info(`${signal} received, shutting down gracefully`);

            // Clean up all active timers first (prevents pending callbacks)
            timerService.cleanupAllTimers();
            logger.info('All timers cleaned up');

            // Stop accepting new connections
            server.close(async () => {
                logger.info('HTTP server closed');

                try {
                    // Close database connections
                    await disconnectRedis();
                    logger.info('Redis disconnected');

                    await disconnectDatabase();
                    logger.info('Database disconnected');
                } catch (error) {
                    logger.error('Error during cleanup:', error);
                }

                process.exit(0);
            });

            // Force exit after timeout
            setTimeout(() => {
                logger.error('Forced shutdown after timeout');
                process.exit(1);
            }, 10000);
        };

        process.on('SIGTERM', () => shutdown('SIGTERM'));
        process.on('SIGINT', () => shutdown('SIGINT'));

        // Handle uncaught errors
        process.on('uncaughtException', (error) => {
            logger.error('Uncaught exception:', error);
            shutdown('UNCAUGHT_EXCEPTION');
        });

        process.on('unhandledRejection', (reason, promise) => {
            logger.error('Unhandled rejection at:', promise, 'reason:', reason);
        });

    } catch (error) {
        logger.error('Failed to start server:', error);
        process.exit(1);
    }
}

startServer();
