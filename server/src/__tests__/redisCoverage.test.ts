/**
 * Redis Configuration Coverage Tests
 *
 * Tests for redis.ts to cover uncovered lines:
 * - createClientOptions TLS handling
 * - connectRedis with memory mode and real Redis
 * - getRedisMemoryInfo branches
 * - disconnectRedis error paths
 * - isRedisHealthy branches
 * - reconnect strategy
 */

const originalEnv = { ...process.env };

jest.mock('../utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));

// Track created clients
let mockClientEvents: Record<string, Function[]> = {};

jest.mock('redis', () => ({
    createClient: jest.fn((options: any) => {
        mockClientEvents = {};
        const client = {
            _options: options,
            isOpen: true,
            connect: jest.fn().mockResolvedValue(undefined),
            quit: jest.fn().mockResolvedValue('OK'),
            disconnect: jest.fn(),
            duplicate: jest.fn(function(this: any) {
                const dup = {
                    isOpen: true,
                    connect: jest.fn().mockResolvedValue(undefined),
                    quit: jest.fn().mockResolvedValue('OK'),
                    disconnect: jest.fn(),
                    on: jest.fn(),
                    ping: jest.fn().mockResolvedValue('PONG'),
                    info: jest.fn().mockResolvedValue('')
                };
                return dup;
            }),
            on: jest.fn((event: string, handler: Function) => {
                if (!mockClientEvents[event]) mockClientEvents[event] = [];
                mockClientEvents[event].push(handler);
            }),
            ping: jest.fn().mockResolvedValue('PONG'),
            info: jest.fn().mockResolvedValue('')
        };
        return client;
    })
}));

describe('Redis Configuration - Extended Coverage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.resetModules();
        process.env = { ...originalEnv };
        process.env.REDIS_URL = 'redis://localhost:6379';
        mockClientEvents = {};
    });

    afterAll(() => {
        process.env = originalEnv;
    });

    describe('connectRedis - memory mode', () => {
        it('should use memory storage when isMemoryMode returns true', async () => {
            process.env.REDIS_URL = 'memory';

            const redis = require('../config/redis');
            const result = await redis.connectRedis();

            expect(result.redisClient).toBeDefined();
            expect(result.pubClient).toBeDefined();
            expect(result.subClient).toBeDefined();
            expect(redis.isUsingMemoryMode()).toBe(true);
        });
    });

    describe('connectRedis - Redis mode', () => {
        it('should connect to Redis and create pub/sub clients', async () => {
            const redis = require('../config/redis');
            const result = await redis.connectRedis();

            expect(result.redisClient).toBeDefined();
            expect(result.pubClient).toBeDefined();
            expect(result.subClient).toBeDefined();
        });

        it('should handle TLS URLs (rediss://)', async () => {
            process.env.REDIS_URL = 'rediss://my-redis:6380';

            const { createClient } = require('redis');
            const redis = require('../config/redis');
            await redis.connectRedis();

            const callArgs = (createClient as jest.Mock).mock.calls[0][0];
            expect(callArgs.socket.tls).toBe(true);
        });

        it('should enforce TLS validation in production', async () => {
            process.env.REDIS_URL = 'rediss://my-redis:6380';
            process.env.NODE_ENV = 'production';
            process.env.REDIS_TLS_REJECT_UNAUTHORIZED = 'false';

            const { createClient } = require('redis');
            const redis = require('../config/redis');
            await redis.connectRedis();

            const callArgs = (createClient as jest.Mock).mock.calls[0][0];
            expect(callArgs.socket.rejectUnauthorized).toBe(true);
        });

        it('should allow disabling TLS validation in development', async () => {
            process.env.REDIS_URL = 'rediss://my-redis:6380';
            process.env.NODE_ENV = 'development';
            process.env.REDIS_TLS_REJECT_UNAUTHORIZED = 'false';

            const { createClient } = require('redis');
            const redis = require('../config/redis');
            await redis.connectRedis();

            const callArgs = (createClient as jest.Mock).mock.calls[0][0];
            expect(callArgs.socket.rejectUnauthorized).toBe(false);
        });

        it('should register error, reconnecting, and ready event handlers', async () => {
            const { createClient } = require('redis');
            const redis = require('../config/redis');
            await redis.connectRedis();

            const client = (createClient as jest.Mock).mock.results[0].value;
            expect(client.on).toHaveBeenCalledWith('error', expect.any(Function));
            expect(client.on).toHaveBeenCalledWith('reconnecting', expect.any(Function));
            expect(client.on).toHaveBeenCalledWith('ready', expect.any(Function));
        });

        // Note: Retry/failure tests for connectRedis are tested in redisConfig.test.ts
        // with proper timeout handling. We skip here to avoid flaky timeouts.
    });

    describe('getRedis', () => {
        it('should throw when Redis is not initialized', () => {
            const redis = require('../config/redis');
            expect(() => redis.getRedis()).toThrow('Redis not initialized');
        });

        it('should return client after connection', async () => {
            process.env.REDIS_URL = 'memory';
            const redis = require('../config/redis');
            await redis.connectRedis();
            expect(() => redis.getRedis()).not.toThrow();
        });
    });

    describe('getPubSubClients', () => {
        it('should throw when not initialized', () => {
            const redis = require('../config/redis');
            expect(() => redis.getPubSubClients()).toThrow('Redis Pub/Sub not initialized');
        });

        it('should return clients after connection', async () => {
            process.env.REDIS_URL = 'memory';
            const redis = require('../config/redis');
            await redis.connectRedis();
            const clients = redis.getPubSubClients();
            expect(clients.pubClient).toBeDefined();
            expect(clients.subClient).toBeDefined();
        });
    });

    describe('isRedisHealthy', () => {
        it('should return false when client is null', async () => {
            const redis = require('../config/redis');
            const healthy = await redis.isRedisHealthy();
            expect(healthy).toBe(false);
        });

        it('should return true when ping succeeds', async () => {
            process.env.REDIS_URL = 'memory';
            const redis = require('../config/redis');
            await redis.connectRedis();
            const healthy = await redis.isRedisHealthy();
            expect(healthy).toBe(true);
        });
    });

    describe('getRedisMemoryInfo', () => {
        it('should return memory mode placeholder when using memory', async () => {
            process.env.REDIS_URL = 'memory';
            const redis = require('../config/redis');
            await redis.connectRedis();
            const info = await redis.getRedisMemoryInfo();
            expect(info.mode).toBe('memory');
            expect(info.alert).toBeNull();
        });

        it('should return error info when client is not connected', async () => {
            const redis = require('../config/redis');
            const info = await redis.getRedisMemoryInfo();
            expect(info.mode).toBe('redis');
            expect(info.error).toBe('Redis not connected');
            expect(info.alert).toBe('critical');
        });

        it('should parse Redis info and return memory stats', async () => {
            // Use Redis mode, then manipulate the mock client to return actual info
            const { createClient } = require('redis');
            (createClient as jest.Mock).mockImplementation(() => {
                const client = {
                    isOpen: true,
                    connect: jest.fn().mockResolvedValue(undefined),
                    quit: jest.fn().mockResolvedValue('OK'),
                    disconnect: jest.fn(),
                    duplicate: jest.fn(function() {
                        return {
                            isOpen: true,
                            connect: jest.fn().mockResolvedValue(undefined),
                            quit: jest.fn().mockResolvedValue('OK'),
                            disconnect: jest.fn(),
                            on: jest.fn(),
                            ping: jest.fn().mockResolvedValue('PONG'),
                            info: jest.fn().mockResolvedValue('')
                        };
                    }),
                    on: jest.fn(),
                    ping: jest.fn().mockResolvedValue('PONG'),
                    info: jest.fn().mockResolvedValue(
                        'used_memory:1048576\r\n' +
                        'used_memory_human:1.00M\r\n' +
                        'used_memory_peak:2097152\r\n' +
                        'used_memory_peak_human:2.00M\r\n' +
                        'maxmemory:10485760\r\n' +
                        'maxmemory_human:10.00M\r\n' +
                        'maxmemory_policy:allkeys-lru\r\n' +
                        'mem_fragmentation_ratio:1.5\r\n'
                    )
                };
                return client;
            });

            const redis = require('../config/redis');
            await redis.connectRedis();
            const info = await redis.getRedisMemoryInfo();

            expect(info.mode).toBe('redis');
            expect(info.used_memory).toBe(1048576);
            expect(info.used_memory_human).toBe('1.00M');
            expect(info.used_memory_peak).toBe(2097152);
            expect(info.maxmemory).toBe(10485760);
            expect(info.memory_usage_percent).toBe(10);
            expect(info.alert).toBeNull();
        });

        it('should return warning alert when memory usage is >= 75%', async () => {
            const { createClient } = require('redis');
            (createClient as jest.Mock).mockImplementation(() => {
                const client = {
                    isOpen: true,
                    connect: jest.fn().mockResolvedValue(undefined),
                    quit: jest.fn().mockResolvedValue('OK'),
                    disconnect: jest.fn(),
                    duplicate: jest.fn(function() {
                        return {
                            isOpen: true,
                            connect: jest.fn().mockResolvedValue(undefined),
                            quit: jest.fn().mockResolvedValue('OK'),
                            disconnect: jest.fn(),
                            on: jest.fn()
                        };
                    }),
                    on: jest.fn(),
                    ping: jest.fn().mockResolvedValue('PONG'),
                    info: jest.fn().mockResolvedValue(
                        'used_memory:7864320\r\n' + // ~7.5MB
                        'used_memory_human:7.50M\r\n' +
                        'maxmemory:10485760\r\n' + // 10MB
                        'maxmemory_human:10.00M\r\n'
                    )
                };
                return client;
            });

            const redis = require('../config/redis');
            await redis.connectRedis();
            const info = await redis.getRedisMemoryInfo();

            expect(info.alert).toBe('warning');
            expect(info.memory_usage_percent).toBe(75);
        });

        it('should return critical alert when memory usage is >= 90%', async () => {
            const { createClient } = require('redis');
            (createClient as jest.Mock).mockImplementation(() => {
                const client = {
                    isOpen: true,
                    connect: jest.fn().mockResolvedValue(undefined),
                    quit: jest.fn().mockResolvedValue('OK'),
                    disconnect: jest.fn(),
                    duplicate: jest.fn(function() {
                        return {
                            isOpen: true,
                            connect: jest.fn().mockResolvedValue(undefined),
                            quit: jest.fn().mockResolvedValue('OK'),
                            disconnect: jest.fn(),
                            on: jest.fn()
                        };
                    }),
                    on: jest.fn(),
                    ping: jest.fn().mockResolvedValue('PONG'),
                    info: jest.fn().mockResolvedValue(
                        'used_memory:9437184\r\n' + // ~9MB (90% of 10MB)
                        'used_memory_human:9.00M\r\n' +
                        'maxmemory:10485760\r\n' +
                        'maxmemory_human:10.00M\r\n'
                    )
                };
                return client;
            });

            const redis = require('../config/redis');
            await redis.connectRedis();
            const info = await redis.getRedisMemoryInfo();

            expect(info.alert).toBe('critical');
            expect(info.memory_usage_percent).toBe(90);
        });

        it('should handle error in getRedisMemoryInfo gracefully', async () => {
            const { createClient } = require('redis');
            (createClient as jest.Mock).mockImplementation(() => {
                const client = {
                    isOpen: true,
                    connect: jest.fn().mockResolvedValue(undefined),
                    quit: jest.fn().mockResolvedValue('OK'),
                    disconnect: jest.fn(),
                    duplicate: jest.fn(function() {
                        return {
                            isOpen: true,
                            connect: jest.fn().mockResolvedValue(undefined),
                            quit: jest.fn().mockResolvedValue('OK'),
                            disconnect: jest.fn(),
                            on: jest.fn()
                        };
                    }),
                    on: jest.fn(),
                    ping: jest.fn().mockResolvedValue('PONG'),
                    info: jest.fn().mockRejectedValue(new Error('INFO command failed'))
                };
                return client;
            });

            const redis = require('../config/redis');
            await redis.connectRedis();
            const info = await redis.getRedisMemoryInfo();

            expect(info.error).toBeDefined();
            // When info() throws, the error path returns the error as string
            // and alert is determined by the catch block
            expect(info.alert).toBeDefined();
        });
    });

    describe('disconnectRedis', () => {
        it('should disconnect all clients', async () => {
            process.env.REDIS_URL = 'memory';
            const redis = require('../config/redis');
            await redis.connectRedis();
            await redis.disconnectRedis();
            // Should not throw
        });
    });

    describe('reconnectStrategy', () => {
        it('should return delay for retries within limit', async () => {
            const { createClient } = require('redis');
            const redis = require('../config/redis');
            await redis.connectRedis();

            const callArgs = (createClient as jest.Mock).mock.calls[0][0];
            const strategy = callArgs.socket.reconnectStrategy;

            expect(strategy(1)).toBe(100);
            expect(strategy(5)).toBe(500);
            expect(strategy(10)).toBe(1000);
        });

        it('should return error after max retries', async () => {
            const { createClient } = require('redis');
            const redis = require('../config/redis');
            await redis.connectRedis();

            const callArgs = (createClient as jest.Mock).mock.calls[0][0];
            const strategy = callArgs.socket.reconnectStrategy;

            const result = strategy(11);
            expect(result).toBeInstanceOf(Error);
        });
    });
});
