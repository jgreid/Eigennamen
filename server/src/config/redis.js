/**
 * Redis Configuration
 */

const { createClient } = require('redis');
const logger = require('../utils/logger');

let redisClient = null;
let pubClient = null;
let subClient = null;

async function connectRedis() {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

    try {
        // Main client for general operations
        redisClient = createClient({ url: redisUrl });
        redisClient.on('error', (err) => logger.error('Redis Client Error:', err));
        await redisClient.connect();

        // Pub/Sub clients for Socket.io adapter
        pubClient = redisClient.duplicate();
        subClient = redisClient.duplicate();
        await Promise.all([pubClient.connect(), subClient.connect()]);

        logger.info('Redis connected');
        return { redisClient, pubClient, subClient };
    } catch (error) {
        logger.error('Failed to connect to Redis:', error);
        throw error;
    }
}

function getRedis() {
    if (!redisClient) {
        throw new Error('Redis not initialized. Call connectRedis() first.');
    }
    return redisClient;
}

function getPubSubClients() {
    if (!pubClient || !subClient) {
        throw new Error('Redis Pub/Sub not initialized.');
    }
    return { pubClient, subClient };
}

async function disconnectRedis() {
    const clients = [redisClient, pubClient, subClient].filter(Boolean);
    await Promise.all(clients.map(client => client.quit()));
    redisClient = pubClient = subClient = null;
    logger.info('Redis disconnected');
}

module.exports = {
    connectRedis,
    getRedis,
    getPubSubClients,
    disconnectRedis
};
