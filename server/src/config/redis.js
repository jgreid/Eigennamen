/**
 * Redis Configuration
 * Supports TLS connections (rediss://) for Fly.io Upstash Redis
 */

const { createClient } = require('redis');
const logger = require('../utils/logger');

let redisClient = null;
let pubClient = null;
let subClient = null;

const MAX_RETRIES = 5;
const INITIAL_RETRY_DELAY = 1000; // 1 second

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Create Redis client options with TLS support
 * Handles both redis:// and rediss:// (TLS) URLs
 */
function createClientOptions(redisUrl) {
    const options = {
        url: redisUrl,
        socket: {
            // Reconnect strategy with exponential backoff
            reconnectStrategy: (retries) => {
                if (retries > 10) {
                    logger.error('Redis max reconnection attempts reached');
                    return new Error('Max reconnection attempts reached');
                }
                const delay = Math.min(retries * 100, 3000);
                logger.warn(`Redis reconnecting in ${delay}ms (attempt ${retries})`);
                return delay;
            },
            // Keep connection alive (important for Fly.io internal networking)
            keepAlive: 30000, // 30 seconds
            connectTimeout: 10000 // 10 seconds
        }
    };

    // Handle TLS for rediss:// URLs (Fly.io Upstash Redis)
    if (redisUrl.startsWith('rediss://')) {
        options.socket.tls = true;
        // For Upstash and similar services, we need to accept their certificates
        options.socket.rejectUnauthorized = false;
    }

    return options;
}

async function connectRedis() {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

    let lastError;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const clientOptions = createClientOptions(redisUrl);

            // Main client for general operations
            redisClient = createClient(clientOptions);

            redisClient.on('error', (err) => {
                // Only log if it's not a connection reset during reconnection
                if (err.code !== 'ECONNRESET') {
                    logger.error('Redis Client Error:', err.message);
                }
            });

            redisClient.on('reconnecting', () => {
                logger.info('Redis client reconnecting...');
            });

            redisClient.on('ready', () => {
                logger.info('Redis client ready');
            });

            await redisClient.connect();

            // Pub/Sub clients for Socket.io adapter
            pubClient = redisClient.duplicate();
            subClient = redisClient.duplicate();

            pubClient.on('error', (err) => logger.error('Redis Pub Client Error:', err.message));
            subClient.on('error', (err) => logger.error('Redis Sub Client Error:', err.message));

            await Promise.all([pubClient.connect(), subClient.connect()]);

            logger.info(`Redis connected (TLS: ${redisUrl.startsWith('rediss://')})`);
            return { redisClient, pubClient, subClient };

        } catch (error) {
            lastError = error;
            const delay = INITIAL_RETRY_DELAY * Math.pow(2, attempt - 1);

            // Clean up partial connections
            await cleanupPartialConnections();

            if (attempt < MAX_RETRIES) {
                logger.warn(`Redis connection attempt ${attempt}/${MAX_RETRIES} failed, retrying in ${delay}ms...`);
                await sleep(delay);
            }
        }
    }

    logger.error(`Failed to connect to Redis after ${MAX_RETRIES} attempts:`, lastError);
    throw lastError;
}

/**
 * Clean up partially connected clients
 */
async function cleanupPartialConnections() {
    const clients = [redisClient, pubClient, subClient].filter(Boolean);
    for (const client of clients) {
        try {
            if (client.isOpen) {
                await client.quit();
            }
        } catch (e) {
            // Ignore cleanup errors
        }
    }
    redisClient = pubClient = subClient = null;
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

/**
 * Check if Redis is connected and healthy
 */
async function isRedisHealthy() {
    try {
        if (!redisClient || !redisClient.isOpen) {
            return false;
        }
        await redisClient.ping();
        return true;
    } catch (error) {
        return false;
    }
}

async function disconnectRedis() {
    const clients = [redisClient, pubClient, subClient].filter(Boolean);
    await Promise.all(clients.map(async (client) => {
        try {
            if (client.isOpen) {
                await client.quit();
            }
        } catch (e) {
            // Force disconnect if quit fails
            try {
                client.disconnect();
            } catch (e2) {
                // Ignore
            }
        }
    }));
    redisClient = pubClient = subClient = null;
    logger.info('Redis disconnected');
}

module.exports = {
    connectRedis,
    getRedis,
    getPubSubClients,
    isRedisHealthy,
    disconnectRedis
};
