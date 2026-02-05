/**
 * Redis Configuration
 * Supports TLS connections (rediss://) for Fly.io Upstash Redis
 * Also supports in-memory mode for single-instance deployments
 */

const { createClient } = require('redis');
const logger = require('../utils/logger');
const { getMemoryStorage, isMemoryMode } = require('./memoryStorage');

let redisClient = null;
let pubClient = null;
let subClient = null;
let usingMemoryMode = false;

const MAX_RETRIES = 5;
const INITIAL_RETRY_DELAY = 1000; // 1 second

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Create Redis client options with TLS support and performance tuning
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
            // Keep connection alive - more aggressive for better latency
            keepAlive: 10000, // 10 seconds
            connectTimeout: 10000, // 10 seconds
            // Disable Nagle's algorithm for lower latency
            noDelay: true
        },
        // Performance tuning options
        // Don't lazily connect - establish connection immediately
        lazyConnect: false,
        // Queue commands when disconnected (fail-open for better UX)
        enableOfflineQueue: true,
        // Limit command queue to prevent memory issues during extended outages
        commandsQueueMaxLength: 1000
    };

    // Handle TLS for rediss:// URLs (Fly.io Upstash Redis)
    if (redisUrl.startsWith('rediss://')) {
        options.socket.tls = true;
        // ISSUE #54 FIX: Only allow disabling TLS validation in development mode
        // In production, TLS certificate validation is always enabled for security
        const isProduction = process.env.NODE_ENV === 'production';
        const wantToDisable = process.env.REDIS_TLS_REJECT_UNAUTHORIZED === 'false';
        const rejectUnauthorized = isProduction ? true : !wantToDisable;
        options.socket.rejectUnauthorized = rejectUnauthorized;

        if (!rejectUnauthorized) {
            logger.warn('Redis TLS certificate validation is disabled (development mode only)');
        }
        if (isProduction && wantToDisable) {
            logger.warn('REDIS_TLS_REJECT_UNAUTHORIZED=false is ignored in production for security');
        }
    }

    return options;
}

async function connectRedis() {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

    // Check for memory mode (single-instance deployment without Redis)
    if (isMemoryMode()) {
        logger.info('Using in-memory storage mode (single-instance only, data will not persist)');
        usingMemoryMode = true;
        const memoryStorage = getMemoryStorage();
        await memoryStorage.connect();
        redisClient = memoryStorage;
        pubClient = memoryStorage.duplicate();
        subClient = memoryStorage.duplicate();
        return { redisClient, pubClient, subClient };
    }

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
        } catch {
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
    } catch {
        return false;
    }
}

/**
 * Get Redis memory information for monitoring
 * Returns memory usage stats and alerts if memory is high
 */
async function getRedisMemoryInfo() {
    try {
        if (usingMemoryMode) {
            // Return placeholder for memory mode
            return {
                mode: 'memory',
                used_memory: 0,
                used_memory_human: 'N/A',
                used_memory_peak: 0,
                used_memory_peak_human: 'N/A',
                maxmemory: 0,
                maxmemory_human: 'N/A',
                memory_usage_percent: 0,
                alert: null
            };
        }

        if (!redisClient || !redisClient.isOpen) {
            return { error: 'Redis not connected', alert: 'critical' };
        }

        // Get memory info from Redis INFO command
        const info = await redisClient.info('memory');
        const lines = info.split('\r\n');
        const memoryInfo = {};

        for (const line of lines) {
            const [key, value] = line.split(':');
            if (key && value) {
                memoryInfo[key] = value;
            }
        }

        const used = parseInt(memoryInfo.used_memory || 0, 10);
        const peak = parseInt(memoryInfo.used_memory_peak || 0, 10);
        const max = parseInt(memoryInfo.maxmemory || 0, 10);

        // Calculate usage percentage if maxmemory is set
        const usagePercent = max > 0 ? Math.round((used / max) * 100) : 0;

        // Determine alert level
        let alert = null;
        if (max > 0) {
            if (usagePercent >= 90) {
                alert = 'critical';
                logger.error('Redis memory critical', { usagePercent, used, max });
            } else if (usagePercent >= 75) {
                alert = 'warning';
                logger.warn('Redis memory high', { usagePercent, used, max });
            }
        }

        return {
            mode: 'redis',
            used_memory: used,
            used_memory_human: memoryInfo.used_memory_human || 'unknown',
            used_memory_peak: peak,
            used_memory_peak_human: memoryInfo.used_memory_peak_human || 'unknown',
            maxmemory: max,
            maxmemory_human: memoryInfo.maxmemory_human || 'unlimited',
            maxmemory_policy: memoryInfo.maxmemory_policy || 'noeviction',
            memory_usage_percent: usagePercent,
            fragmentation_ratio: parseFloat(memoryInfo.mem_fragmentation_ratio || 0),
            alert
        };
    } catch (error) {
        logger.error('Failed to get Redis memory info', { error: error.message });
        return {
            error: error.message,
            alert: 'error'
        };
    }
}

async function disconnectRedis() {
    const clients = [redisClient, pubClient, subClient].filter(Boolean);
    await Promise.all(clients.map(async (client) => {
        try {
            if (client.isOpen) {
                await client.quit();
            }
        } catch {
            // Force disconnect if quit fails
            try {
                client.disconnect();
            } catch {
                // Ignore
            }
        }
    }));
    redisClient = pubClient = subClient = null;
    logger.info('Redis disconnected');
}

/**
 * Check if currently using memory storage mode
 */
function isUsingMemoryMode() {
    return usingMemoryMode;
}

module.exports = {
    connectRedis,
    getRedis,
    getPubSubClients,
    isRedisHealthy,
    getRedisMemoryInfo,
    disconnectRedis,
    isUsingMemoryMode
};
