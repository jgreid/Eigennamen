/**
 * Redis Configuration
 *
 * Supports TLS connections (rediss://) for Fly.io Upstash Redis
 * Also supports in-memory mode for single-instance deployments
 */

import { createClient } from 'redis';
import logger from '../utils/logger';
import type { RedisClientType } from 'redis';

// Import memory storage functions
import { getMemoryStorage, isMemoryMode } from './memoryStorage';
// ============================================================================
// Types
// ============================================================================

/**
 * Redis client options for connection configuration
 */
interface RedisSocketOptions {
    reconnectStrategy?: (retries: number) => number | Error;
    keepAlive?: number;
    connectTimeout?: number;
    noDelay?: boolean;
    tls?: boolean;
    rejectUnauthorized?: boolean;
}

/**
 * Redis client configuration options
 */
interface RedisClientOptions {
    url: string;
    socket: RedisSocketOptions;
    lazyConnect: boolean;
    enableOfflineQueue: boolean;
    commandsQueueMaxLength: number;
}

/**
 * Redis memory information from INFO command
 */
export interface RedisMemoryInfo {
    mode: 'redis' | 'memory';
    used_memory: number;
    used_memory_human: string;
    used_memory_peak: number;
    used_memory_peak_human: string;
    maxmemory: number;
    maxmemory_human: string;
    maxmemory_policy?: string;
    memory_usage_percent: number;
    fragmentation_ratio?: number;
    alert: 'critical' | 'warning' | 'error' | null;
    error?: string;
}

/**
 * Pub/Sub clients return type
 */
export interface PubSubClients {
    pubClient: RedisClientType | MemoryStorageClient;
    subClient: RedisClientType | MemoryStorageClient;
}

/**
 * Connect Redis return type
 */
export interface RedisClients {
    redisClient: RedisClientType | MemoryStorageClient;
    pubClient: RedisClientType | MemoryStorageClient;
    subClient: RedisClientType | MemoryStorageClient;
}

/**
 * Memory storage client interface (subset of Redis client)
 */
interface MemoryStorageClient {
    isOpen: boolean;
    connect(): Promise<MemoryStorageClient>;
    quit(): Promise<string>;
    disconnect(): Promise<string>;
    duplicate(): MemoryStorageClient;
    ping(): Promise<string>;
    get(key: string): Promise<string | null>;
    set(key: string, value: string, options?: Record<string, unknown>): Promise<string | null>;
    del(key: string | string[]): Promise<number>;
    // Additional methods as needed
}

// ============================================================================
// Module State
// ============================================================================

/** Union type for Redis or memory storage client, used throughout services */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyRedisClient = any;

let redisClient: RedisClientType | MemoryStorageClient | null = null;
let pubClient: RedisClientType | MemoryStorageClient | null = null;
let subClient: RedisClientType | MemoryStorageClient | null = null;
let usingMemoryMode = false;

const MAX_RETRIES = 5;
const INITIAL_RETRY_DELAY = 1000; // 1 second

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Create Redis client options with TLS support and performance tuning
 * Handles both redis:// and rediss:// (TLS) URLs
 */
function createClientOptions(redisUrl: string): RedisClientOptions {
    const options: RedisClientOptions = {
        url: redisUrl,
        socket: {
            // Reconnect strategy with exponential backoff
            reconnectStrategy: (retries: number): number | Error => {
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
        // Only allow disabling TLS validation in development mode
        // In production, TLS certificate validation is always enabled for security
        const isProduction = process.env['NODE_ENV'] === 'production';
        const wantToDisable = process.env['REDIS_TLS_REJECT_UNAUTHORIZED'] === 'false';
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

// ============================================================================
// Public Functions
// ============================================================================

/**
 * Connect to Redis or initialize memory storage
 * @returns Promise resolving to Redis clients
 */
export async function connectRedis(): Promise<RedisClients> {
    const redisUrl = process.env['REDIS_URL'] || 'redis://localhost:6379';

    // Check for memory mode (single-instance deployment without Redis)
    if (isMemoryMode()) {
        logger.info('Using in-memory storage mode (single-instance only, data will not persist)');
        usingMemoryMode = true;
        const memoryStorage = getMemoryStorage();
        await memoryStorage.connect();
        redisClient = memoryStorage;
        pubClient = memoryStorage.duplicate();
        subClient = memoryStorage.duplicate();
        return {
            redisClient: redisClient as RedisClientType | MemoryStorageClient,
            pubClient: pubClient as RedisClientType | MemoryStorageClient,
            subClient: subClient as RedisClientType | MemoryStorageClient
        };
    }

    let lastError: Error | undefined;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const clientOptions = createClientOptions(redisUrl);

            // Main client for general operations
            redisClient = createClient(clientOptions);

            (redisClient as RedisClientType).on('error', (err: Error & { code?: string }) => {
                // Only log if it's not a connection reset during reconnection
                if (err.code !== 'ECONNRESET') {
                    logger.error('Redis Client Error:', err.message);
                }
            });

            (redisClient as RedisClientType).on('reconnecting', () => {
                logger.info('Redis client reconnecting...');
            });

            (redisClient as RedisClientType).on('ready', () => {
                logger.info('Redis client ready');
            });

            await (redisClient as RedisClientType).connect();

            // Pub/Sub clients for Socket.io adapter
            pubClient = (redisClient as RedisClientType).duplicate();
            subClient = (redisClient as RedisClientType).duplicate();

            (pubClient as RedisClientType).on('error', (err: Error) => logger.error('Redis Pub Client Error:', err.message));
            (subClient as RedisClientType).on('error', (err: Error) => logger.error('Redis Sub Client Error:', err.message));

            await Promise.all([
                (pubClient as RedisClientType).connect(),
                (subClient as RedisClientType).connect()
            ]);

            logger.info(`Redis connected (TLS: ${redisUrl.startsWith('rediss://')})`);
            return {
                redisClient: redisClient as RedisClientType,
                pubClient: pubClient as RedisClientType,
                subClient: subClient as RedisClientType
            };

        } catch (error) {
            lastError = error as Error;
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
async function cleanupPartialConnections(): Promise<void> {
    const clients = [redisClient, pubClient, subClient].filter(Boolean) as (RedisClientType | MemoryStorageClient)[];
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

/**
 * Get the main Redis client
 * @throws Error if Redis not initialized
 */
export function getRedis(): AnyRedisClient {
    if (!redisClient) {
        throw new Error('Redis not initialized. Call connectRedis() first.');
    }
    return redisClient;
}

/**
 * Get Pub/Sub clients for Socket.io adapter
 * @throws Error if Pub/Sub not initialized
 */
export function getPubSubClients(): PubSubClients {
    if (!pubClient || !subClient) {
        throw new Error('Redis Pub/Sub not initialized.');
    }
    return {
        pubClient: pubClient as RedisClientType | MemoryStorageClient,
        subClient: subClient as RedisClientType | MemoryStorageClient
    };
}

/**
 * Check if Redis is connected and healthy
 * @returns true if Redis is healthy
 */
export async function isRedisHealthy(): Promise<boolean> {
    try {
        if (!redisClient || !redisClient.isOpen) {
            return false;
        }
        await (redisClient as RedisClientType).ping();
        return true;
    } catch {
        return false;
    }
}

/**
 * Get Redis memory information for monitoring
 * Returns memory usage stats and alerts if memory is high
 */
export async function getRedisMemoryInfo(): Promise<RedisMemoryInfo> {
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
            return {
                mode: 'redis',
                used_memory: 0,
                used_memory_human: 'unknown',
                used_memory_peak: 0,
                used_memory_peak_human: 'unknown',
                maxmemory: 0,
                maxmemory_human: 'unknown',
                memory_usage_percent: 0,
                error: 'Redis not connected',
                alert: 'critical'
            };
        }

        // Get memory info from Redis INFO command
        const info = await (redisClient as RedisClientType).info('memory');
        const lines = info.split('\r\n');
        const memoryInfo: Record<string, string> = {};

        for (const line of lines) {
            const [key, value] = line.split(':');
            if (key && value) {
                memoryInfo[key] = value;
            }
        }

        const used = parseInt(memoryInfo['used_memory'] || '0', 10);
        const peak = parseInt(memoryInfo['used_memory_peak'] || '0', 10);
        const max = parseInt(memoryInfo['maxmemory'] || '0', 10);

        // Calculate usage percentage if maxmemory is set
        const usagePercent = max > 0 ? Math.round((used / max) * 100) : 0;

        // Determine alert level
        let alert: 'critical' | 'warning' | null = null;
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
            used_memory_human: memoryInfo['used_memory_human'] || 'unknown',
            used_memory_peak: peak,
            used_memory_peak_human: memoryInfo['used_memory_peak_human'] || 'unknown',
            maxmemory: max,
            maxmemory_human: memoryInfo['maxmemory_human'] || 'unlimited',
            maxmemory_policy: memoryInfo['maxmemory_policy'] || 'noeviction',
            memory_usage_percent: usagePercent,
            fragmentation_ratio: parseFloat(memoryInfo['mem_fragmentation_ratio'] || '0'),
            alert
        };
    } catch (error) {
        logger.error('Failed to get Redis memory info', { error: (error as Error).message });
        return {
            mode: 'redis',
            used_memory: 0,
            used_memory_human: 'unknown',
            used_memory_peak: 0,
            used_memory_peak_human: 'unknown',
            maxmemory: 0,
            maxmemory_human: 'unknown',
            memory_usage_percent: 0,
            error: (error as Error).message,
            alert: 'error'
        };
    }
}

/**
 * Disconnect from Redis
 */
export async function disconnectRedis(): Promise<void> {
    const clients = [redisClient, pubClient, subClient].filter(Boolean) as (RedisClientType | MemoryStorageClient)[];
    await Promise.all(clients.map(async (client) => {
        try {
            if (client.isOpen) {
                await client.quit();
            }
        } catch {
            // Force disconnect if quit fails
            try {
                (client as RedisClientType).disconnect();
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
export function isUsingMemoryMode(): boolean {
    return usingMemoryMode;
}
