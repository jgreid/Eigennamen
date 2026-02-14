/**
 * Redis Configuration
 *
 * Supports three modes:
 *   1. External Redis via REDIS_URL (redis:// or rediss://)
 *   2. Local Redis on default port (when REDIS_URL is not set)
 *   3. Embedded Redis (REDIS_URL=memory) — spawns a local redis-server
 *      process on a random port, giving real Redis behavior (including
 *      Lua scripting) without an external dependency.
 */

import { createClient } from 'redis';
import { spawn } from 'child_process';
import { createServer } from 'net';
import logger from '../utils/logger';
import type { RedisClientType } from 'redis';
import type { RedisClient } from '../types/redis';
import type { ChildProcess } from 'child_process';

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
    pubClient: RedisClientType;
    subClient: RedisClientType;
}

/**
 * Connect Redis return type
 */
export interface RedisClients {
    redisClient: RedisClientType;
    pubClient: RedisClientType;
    subClient: RedisClientType;
}

// ============================================================================
// Module State
// ============================================================================

let redisClient: RedisClientType | null = null;
let pubClient: RedisClientType | null = null;
let subClient: RedisClientType | null = null;
let usingMemoryMode = false;
let embeddedRedisProcess: ChildProcess | null = null;

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
 * Check if REDIS_URL indicates memory mode
 */
export function isMemoryMode(): boolean {
    const redisUrl = process.env['REDIS_URL'] || '';
    return redisUrl === 'memory' || redisUrl === 'memory://';
}

/**
 * Find a free TCP port by briefly binding to port 0
 */
async function findFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const server = createServer();
        server.unref();
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const addr = server.address();
            if (addr && typeof addr === 'object') {
                const port = addr.port;
                server.close(() => resolve(port));
            } else {
                server.close(() => reject(new Error('Could not determine port')));
            }
        });
    });
}

/**
 * Start an embedded redis-server process on a random port.
 * Uses --save "" --appendonly no for pure in-memory operation.
 * Returns the URL to connect to.
 */
async function startEmbeddedRedis(): Promise<string> {
    const port = await findFreePort();
    const args = [
        '--port', port.toString(),
        '--bind', '127.0.0.1',
        '--save', '',           // Disable RDB snapshots
        '--appendonly', 'no',   // Disable AOF persistence
        '--daemonize', 'no',
        '--loglevel', 'notice'
    ];

    return new Promise<string>((resolve, reject) => {
        const proc = spawn('redis-server', args, {
            stdio: ['ignore', 'pipe', 'pipe']
        });

        embeddedRedisProcess = proc;

        let started = false;
        const timeout = setTimeout(() => {
            if (!started) {
                proc.kill();
                reject(new Error('Embedded redis-server failed to start within 5s'));
            }
        }, 5000);

        proc.stdout?.on('data', (data: Buffer) => {
            const output = data.toString();
            if (output.includes('Ready to accept connections') || output.includes('ready to accept connections')) {
                started = true;
                clearTimeout(timeout);
                resolve(`redis://127.0.0.1:${port}`);
            }
        });

        proc.stderr?.on('data', (data: Buffer) => {
            const msg = data.toString().trim();
            if (msg) logger.warn(`Embedded Redis stderr: ${msg}`);
        });

        proc.on('error', (err) => {
            clearTimeout(timeout);
            embeddedRedisProcess = null;
            reject(new Error(`Failed to start redis-server: ${err.message}. Is redis-server installed?`));
        });

        proc.on('exit', (code) => {
            if (!started) {
                clearTimeout(timeout);
                embeddedRedisProcess = null;
                reject(new Error(`redis-server exited with code ${code} before becoming ready`));
            }
        });
    });
}

/**
 * Stop the embedded redis-server process
 */
async function stopEmbeddedRedis(): Promise<void> {
    if (!embeddedRedisProcess) return;

    return new Promise<void>((resolve) => {
        const proc = embeddedRedisProcess;
        if (!proc) { resolve(); return; }

        const timeout = setTimeout(() => {
            proc.kill('SIGKILL');
            resolve();
        }, 3000);

        proc.on('exit', () => {
            clearTimeout(timeout);
            embeddedRedisProcess = null;
            resolve();
        });

        proc.kill('SIGTERM');
    });
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
 * Connect to Redis.
 * In memory mode, spawns an embedded redis-server on a random port.
 * @returns Promise resolving to Redis clients
 */
export async function connectRedis(): Promise<RedisClients> {
    let redisUrl = process.env['REDIS_URL'] || 'redis://localhost:6379';

    // Memory mode: start an embedded redis-server process
    if (isMemoryMode()) {
        logger.info('Starting embedded Redis server (single-instance, no persistence)');
        usingMemoryMode = true;
        redisUrl = await startEmbeddedRedis();
        logger.info(`Embedded Redis started at ${redisUrl}`);
    }

    let lastError: Error | undefined;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const clientOptions = createClientOptions(redisUrl);

            // Main client for general operations
            redisClient = createClient(clientOptions) as RedisClientType;

            redisClient.on('error', (err: Error & { code?: string }) => {
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
            pubClient = redisClient.duplicate() as RedisClientType;
            subClient = redisClient.duplicate() as RedisClientType;

            pubClient.on('error', (err: Error) => logger.error('Redis Pub Client Error:', err.message));
            subClient.on('error', (err: Error) => logger.error('Redis Sub Client Error:', err.message));

            await Promise.all([
                pubClient.connect(),
                subClient.connect()
            ]);

            if (usingMemoryMode) {
                logger.info('Connected to embedded Redis (memory mode)');
            } else {
                logger.info(`Redis connected (TLS: ${redisUrl.startsWith('rediss://')})`);
            }
            return { redisClient, pubClient, subClient };

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
    const clients = [redisClient, pubClient, subClient].filter(Boolean) as RedisClientType[];
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
export function getRedis(): RedisClient {
    if (!redisClient) {
        throw new Error('Redis not initialized. Call connectRedis() first.');
    }
    return redisClient as unknown as RedisClient;
}

/**
 * Get Pub/Sub clients for Socket.io adapter
 * @throws Error if Pub/Sub not initialized
 */
export function getPubSubClients(): PubSubClients {
    if (!pubClient || !subClient) {
        throw new Error('Redis Pub/Sub not initialized.');
    }
    return { pubClient, subClient };
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
export async function getRedisMemoryInfo(): Promise<RedisMemoryInfo> {
    try {
        if (!redisClient || !redisClient.isOpen) {
            return {
                mode: usingMemoryMode ? 'memory' : 'redis',
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

        // Get memory info from Redis INFO command (works for both modes)
        const info = await redisClient.info('memory');
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
            mode: usingMemoryMode ? 'memory' : 'redis',
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
            mode: usingMemoryMode ? 'memory' : 'redis',
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
 * Disconnect from Redis and stop embedded server if running
 */
export async function disconnectRedis(): Promise<void> {
    const clients = [redisClient, pubClient, subClient].filter(Boolean) as RedisClientType[];
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

    // Stop embedded Redis process if we started one
    if (embeddedRedisProcess) {
        await stopEmbeddedRedis();
        logger.info('Embedded Redis server stopped');
    }

    logger.info('Redis disconnected');
}

/**
 * Check if currently using memory storage mode
 */
export function isUsingMemoryMode(): boolean {
    return usingMemoryMode;
}
