import { createClient } from 'redis';
import { spawn } from 'child_process';
import { createServer } from 'net';
import logger from '../utils/logger';
import * as pubSubHealth from '../utils/pubSubHealth';
import type { RedisClientType } from 'redis';
import type { RedisClient } from '../types/redis';
import type { ChildProcess } from 'child_process';

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

let redisClient: RedisClientType | null = null;
let pubClient: RedisClientType | null = null;
let subClient: RedisClientType | null = null;
let usingMemoryMode = false;
let embeddedRedisProcess: ChildProcess | null = null;

const MAX_RETRIES = 5;
const INITIAL_RETRY_DELAY = 1000; // 1 second

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Re-export from centralized module (single source of truth for memory mode detection)
export { isMemoryMode } from './memoryMode';

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

    // Configurable timeout for slow hardware or high-load environments
    const timeoutMs = Math.min(
        Math.max(parseInt(process.env['EMBEDDED_REDIS_TIMEOUT_MS'] || '5000', 10) || 5000, 1000),
        15000
    );

    return new Promise<string>((resolve, reject) => {
        const proc = spawn('redis-server', args, {
            stdio: ['ignore', 'pipe', 'pipe']
        });

        embeddedRedisProcess = proc;

        let started = false;
        const startedAt = Date.now();
        const timeout = setTimeout(() => {
            if (!started) {
                proc.kill();
                reject(new Error(`Embedded redis-server failed to start within ${timeoutMs}ms`));
            }
        }, timeoutMs);

        proc.stdout?.on('data', (data: Buffer) => {
            const output = data.toString();
            if (output.includes('Ready to accept connections') || output.includes('ready to accept connections')) {
                started = true;
                clearTimeout(timeout);
                const startupTime = Date.now() - startedAt;
                logger.info(`Embedded redis-server started in ${startupTime}ms`);
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

function reconnectStrategy(retries: number): number | Error {
    if (retries > 10) {
        logger.error('Redis max reconnection attempts reached');
        return new Error('Max reconnection attempts reached');
    }
    const delay = Math.min(retries * 100, 3000);
    logger.warn(`Redis reconnecting in ${delay}ms (attempt ${retries})`);
    return delay;
}

/**
 * Create Redis client options with TLS support and performance tuning
 * Handles both redis:// and rediss:// (TLS) URLs
 */
function createClientOptions(redisUrl: string) {
    const sharedSocket = {
        reconnectStrategy,
        keepAlive: true,
        keepAliveInitialDelay: 10000,
        connectTimeout: 10000,
        noDelay: true,
    };

    const sharedOptions = {
        url: redisUrl,
        disableOfflineQueue: false,
        commandsQueueMaxLength: 1000,
    };

    // Handle TLS for rediss:// URLs (Fly.io Upstash Redis)
    if (redisUrl.startsWith('rediss://')) {
        const isProduction = process.env['NODE_ENV'] === 'production';
        const wantToDisable = process.env['REDIS_TLS_REJECT_UNAUTHORIZED'] === 'false';
        const rejectUnauthorized = isProduction ? true : !wantToDisable;

        if (!rejectUnauthorized) {
            logger.warn('Redis TLS certificate validation is disabled (development mode only)');
        }
        if (isProduction && wantToDisable) {
            logger.warn('REDIS_TLS_REJECT_UNAUTHORIZED=false is ignored in production for security');
        }

        return {
            ...sharedOptions,
            socket: { ...sharedSocket, tls: true as const, rejectUnauthorized },
        };
    }

    return {
        ...sharedOptions,
        socket: sharedSocket,
    };
}

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

            // Attach pub/sub health monitoring (PING probes + error tracking)
            pubSubHealth.attachToClients(pubClient, subClient);

            // Verify Redis client has all required methods (catches API drift early)
            assertRedisClientShape(redisClient);

            // Verify Lua scripting is available (required for atomic game operations)
            try {
                const luaResult = await redisClient.eval('return 1', { keys: [], arguments: [] });
                if (luaResult !== 1) {
                    throw new Error(`Unexpected Lua result: ${luaResult}`);
                }
            } catch (luaErr) {
                const msg = `Redis Lua scripting unavailable: ${(luaErr as Error).message}. ` +
                    'Game operations require EVAL. Check redis.conf for "rename-command EVAL".';
                logger.error(msg);
                throw new Error(msg);
            }

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

async function cleanupPartialConnections(): Promise<void> {
    const clients = [redisClient, pubClient, subClient].filter(Boolean) as RedisClientType[];
    for (const client of clients) {
        try {
            if (client.isOpen) {
                await Promise.race([
                    client.quit(),
                    new Promise<void>((_, reject) => setTimeout(() => reject(new Error('quit timeout')), 3000))
                ]);
            }
        } catch (err) {
            logger.warn('Error during partial connection cleanup', { error: (err as Error).message });
        }
    }
    redisClient = pubClient = subClient = null;
}

const REQUIRED_REDIS_METHODS = [
    'get', 'set', 'del', 'exists', 'expire', 'ttl', 'mGet',
    'sAdd', 'sRem', 'sMembers', 'sCard', 'sIsMember',
    'zAdd', 'zRem', 'zRange', 'zRangeByScore', 'zRemRangeByRank', 'zCard',
    'lPush', 'lTrim', 'lRange', 'lLen',
    'watch', 'unwatch', 'multi', 'eval'
] as const;

/**
 * Verify that the Redis client exposes all methods defined in the RedisClient interface.
 * Runs once at connect time. Throws on mismatch so API drift is caught immediately
 * rather than surfacing as cryptic runtime errors during game operations.
 */
function assertRedisClientShape(client: RedisClientType): void {
    const missing: string[] = [];
    for (const method of REQUIRED_REDIS_METHODS) {
        if (typeof (client as unknown as Record<string, unknown>)[method] !== 'function') {
            missing.push(method);
        }
    }
    if (missing.length > 0) {
        throw new Error(
            `Redis client is missing required methods: ${missing.join(', ')}. ` +
            'The redis package API may have changed — update types/redis.ts to match.'
        );
    }
}

export function getRedis(): RedisClient {
    if (!redisClient) {
        throw new Error('Redis not initialized. Call connectRedis() first.');
    }
    return redisClient as unknown as RedisClient;
}

export function getPubSubClients(): PubSubClients {
    if (!pubClient || !subClient) {
        throw new Error('Redis Pub/Sub not initialized.');
    }
    return { pubClient, subClient };
}

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

export async function disconnectRedis(): Promise<void> {
    // Stop pub/sub health monitoring before disconnecting
    pubSubHealth.stopPingInterval();

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

export function isUsingMemoryMode(): boolean {
    return usingMemoryMode;
}
