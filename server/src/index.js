/**
 * Codenames Online - Server Entry Point
 */

require('dotenv').config();

const http = require('http');
const app = require('./app');
const { initializeSocket } = require('./socket');
const { connectRedis } = require('./config/redis');
const { connectDatabase } = require('./config/database');
const logger = require('./utils/logger');

const PORT = process.env.PORT || 3000;

async function startServer() {
    try {
        // Connect to databases
        await connectDatabase();
        logger.info('Database connected');

        await connectRedis();
        logger.info('Redis connected');

        // Create HTTP server
        const server = http.createServer(app);

        // Initialize Socket.io
        initializeSocket(server);
        logger.info('Socket.io initialized');

        // Start listening
        server.listen(PORT, () => {
            logger.info(`Server running on port ${PORT}`);
            logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
        });

        // Graceful shutdown
        const shutdown = async (signal) => {
            logger.info(`${signal} received, shutting down gracefully`);
            server.close(() => {
                logger.info('HTTP server closed');
                process.exit(0);
            });
        };

        process.on('SIGTERM', () => shutdown('SIGTERM'));
        process.on('SIGINT', () => shutdown('SIGINT'));

    } catch (error) {
        logger.error('Failed to start server:', error);
        process.exit(1);
    }
}

startServer();
