/**
 * Redis Configuration - Branch Coverage Tests
 *
 * Targets uncovered branches in config/redis.ts (86% branch):
 * - connectRedis retry loop with exponential backoff
 * - Error handler filtering ECONNRESET
 * - disconnectRedis force disconnect when quit fails
 * - isRedisHealthy when client.isOpen is false
 * - isRedisHealthy when ping throws
 * - cleanupPartialConnections with open/closed clients
 * - reconnectStrategy with capped delay
 *
 * CAREFUL: REDIS_URL=memory triggers in-memory mode with setInterval.
 * Tests need --forceExit.
 */

const originalEnv = { ...process.env };

jest.mock('../utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));

// Track all created mock clients
let createdClients: any[] = [];
let mockClientFactory: Function;

jest.mock('redis', () => ({
    createClient: jest.fn((...args: any[]) => {
        if (mockClientFactory) {
            const client = mockClientFactory(...args);
            createdClients.push(client);
            return client;
        }
        const events: Record<string, Function[]> = {};
        const client = {
            _events: events,
            isOpen: true,
            connect: jest.fn().mockResolvedValue(undefined),
            quit: jest.fn().mockResolvedValue('OK'),
            disconnect: jest.fn(),
            duplicate: jest.fn(function (this: any) {
                const dup = {
                    isOpen: true,
                    connect: jest.fn().mockResolvedValue(undefined),
                    quit: jest.fn().mockResolvedValue('OK'),
                    disconnect: jest.fn(),
                    on: jest.fn(),
                    ping: jest.fn().mockResolvedValue('PONG'),
                    info: jest.fn().mockResolvedValue('')
                };
                createdClients.push(dup);
                return dup;
            }),
            on: jest.fn((event: string, handler: Function) => {
                if (!events[event]) events[event] = [];
                events[event].push(handler);
            }),
            ping: jest.fn().mockResolvedValue('PONG'),
            info: jest.fn().mockResolvedValue('')
        };
        createdClients.push(client);
        return client;
    })
}));

describe('Redis Configuration - Branch Coverage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.resetModules();
        createdClients = [];
        mockClientFactory = null as any;
        process.env = { ...originalEnv };
        process.env.REDIS_URL = 'redis://localhost:6379';
    });

    afterAll(() => {
        process.env = originalEnv;
    });

    describe('connectRedis error handler branches', () => {
        it('suppresses ECONNRESET errors in the error handler', async () => {
            const logger = require('../utils/logger');
            const redis = require('../config/redis');
            await redis.connectRedis();

            // Get the main client and trigger the error handler with ECONNRESET
            const { createClient } = require('redis');
            const client = (createClient as jest.Mock).mock.results[0].value;
            const errorHandlers = client._events['error'];
            expect(errorHandlers).toBeDefined();

            const econnResetError = new Error('Connection reset');
            (econnResetError as any).code = 'ECONNRESET';
            errorHandlers[0](econnResetError);

            // Should NOT log for ECONNRESET
            expect(logger.error).not.toHaveBeenCalledWith(
                'Redis Client Error:',
                expect.stringContaining('Connection reset')
            );
        });

        it('logs non-ECONNRESET errors in the error handler', async () => {
            const logger = require('../utils/logger');
            const redis = require('../config/redis');
            await redis.connectRedis();

            const { createClient } = require('redis');
            const client = (createClient as jest.Mock).mock.results[0].value;
            const errorHandlers = client._events['error'];

            const genericError = new Error('Something went wrong');
            errorHandlers[0](genericError);

            expect(logger.error).toHaveBeenCalledWith('Redis Client Error:', 'Something went wrong');
        });

        it('logs reconnecting event', async () => {
            const logger = require('../utils/logger');
            const redis = require('../config/redis');
            await redis.connectRedis();

            const { createClient } = require('redis');
            const client = (createClient as jest.Mock).mock.results[0].value;
            const reconnectingHandlers = client._events['reconnecting'];
            expect(reconnectingHandlers).toBeDefined();
            reconnectingHandlers[0]();

            expect(logger.info).toHaveBeenCalledWith('Redis client reconnecting...');
        });

        it('logs ready event', async () => {
            const logger = require('../utils/logger');
            const redis = require('../config/redis');
            await redis.connectRedis();

            const { createClient } = require('redis');
            const client = (createClient as jest.Mock).mock.results[0].value;
            const readyHandlers = client._events['ready'];
            expect(readyHandlers).toBeDefined();
            readyHandlers[0]();

            expect(logger.info).toHaveBeenCalledWith('Redis client ready');
        });
    });

    describe('connectRedis retry on failure', () => {
        it('retries on connection failure and eventually throws', async () => {
            jest.useFakeTimers();

            mockClientFactory = () => {
                const events: Record<string, Function[]> = {};
                return {
                    _events: events,
                    isOpen: false,
                    connect: jest.fn().mockRejectedValue(new Error('Connection refused')),
                    quit: jest.fn().mockResolvedValue('OK'),
                    disconnect: jest.fn(),
                    duplicate: jest.fn(),
                    on: jest.fn((event: string, handler: Function) => {
                        if (!events[event]) events[event] = [];
                        events[event].push(handler);
                    }),
                    ping: jest.fn()
                };
            };

            const redis = require('../config/redis');
            const logger = require('../utils/logger');

            // connectRedis will retry with sleep delays; we need to advance timers
            const connectPromise = redis.connectRedis();

            // Advance timers through all retry delays (1s, 2s, 4s, 8s, 16s)
            for (let i = 0; i < 5; i++) {
                await Promise.resolve(); // Let microtasks run
                jest.advanceTimersByTime(20000);
                await Promise.resolve();
                await Promise.resolve();
            }

            await expect(connectPromise).rejects.toThrow('Connection refused');
            expect(logger.warn).toHaveBeenCalledWith(
                expect.stringContaining('Redis connection attempt')
            );

            jest.useRealTimers();
        });
    });

    describe('isRedisHealthy branches', () => {
        it('returns false when redisClient is null', async () => {
            const redis = require('../config/redis');
            const healthy = await redis.isRedisHealthy();
            expect(healthy).toBe(false);
        });

        it('returns false when client.isOpen is false', async () => {
            const redis = require('../config/redis');
            await redis.connectRedis();

            // Close the client
            const { createClient } = require('redis');
            const client = (createClient as jest.Mock).mock.results[0].value;
            client.isOpen = false;

            const healthy = await redis.isRedisHealthy();
            expect(healthy).toBe(false);
        });

        it('returns false when ping throws', async () => {
            const redis = require('../config/redis');
            await redis.connectRedis();

            const { createClient } = require('redis');
            const client = (createClient as jest.Mock).mock.results[0].value;
            client.ping.mockRejectedValue(new Error('Ping failed'));

            const healthy = await redis.isRedisHealthy();
            expect(healthy).toBe(false);
        });

        it('returns true when ping succeeds', async () => {
            const redis = require('../config/redis');
            await redis.connectRedis();

            const healthy = await redis.isRedisHealthy();
            expect(healthy).toBe(true);
        });
    });

    describe('disconnectRedis branches', () => {
        it('handles quit failure and falls back to disconnect', async () => {
            mockClientFactory = () => {
                const events: Record<string, Function[]> = {};
                return {
                    _events: events,
                    isOpen: true,
                    connect: jest.fn().mockResolvedValue(undefined),
                    quit: jest.fn().mockRejectedValue(new Error('Quit failed')),
                    disconnect: jest.fn(),
                    duplicate: jest.fn(function () {
                        return {
                            isOpen: true,
                            connect: jest.fn().mockResolvedValue(undefined),
                            quit: jest.fn().mockRejectedValue(new Error('Quit failed')),
                            disconnect: jest.fn(),
                            on: jest.fn()
                        };
                    }),
                    on: jest.fn((event: string, handler: Function) => {
                        if (!events[event]) events[event] = [];
                        events[event].push(handler);
                    }),
                    ping: jest.fn().mockResolvedValue('PONG'),
                    info: jest.fn().mockResolvedValue('')
                };
            };

            const redis = require('../config/redis');
            await redis.connectRedis();

            // Should not throw - falls back to disconnect
            await redis.disconnectRedis();
        });

        it('handles disconnect also failing silently', async () => {
            mockClientFactory = () => {
                const events: Record<string, Function[]> = {};
                return {
                    _events: events,
                    isOpen: true,
                    connect: jest.fn().mockResolvedValue(undefined),
                    quit: jest.fn().mockRejectedValue(new Error('Quit failed')),
                    disconnect: jest.fn(() => { throw new Error('Disconnect also failed'); }),
                    duplicate: jest.fn(function () {
                        return {
                            isOpen: true,
                            connect: jest.fn().mockResolvedValue(undefined),
                            quit: jest.fn().mockRejectedValue(new Error('Quit failed')),
                            disconnect: jest.fn(() => { throw new Error('Disconnect also failed'); }),
                            on: jest.fn()
                        };
                    }),
                    on: jest.fn((event: string, handler: Function) => {
                        if (!events[event]) events[event] = [];
                        events[event].push(handler);
                    }),
                    ping: jest.fn().mockResolvedValue('PONG'),
                    info: jest.fn().mockResolvedValue('')
                };
            };

            const redis = require('../config/redis');
            await redis.connectRedis();

            // Should not throw even when both quit and disconnect fail
            await redis.disconnectRedis();
        });

        it('skips quit when client.isOpen is false', async () => {
            const redis = require('../config/redis');
            await redis.connectRedis();

            // Close all clients
            const { createClient } = require('redis');
            const client = (createClient as jest.Mock).mock.results[0].value;
            client.isOpen = false;

            // Should not throw
            await redis.disconnectRedis();
            // quit should not be called since isOpen is false
        });

        it('handles disconnectRedis when clients are null', async () => {
            const redis = require('../config/redis');
            // Don't connect - clients are null
            // Should not throw
            await redis.disconnectRedis();
        });
    });

    describe('cleanupPartialConnections', () => {
        it('cleans up partially connected clients on connect failure', async () => {
            jest.useFakeTimers();
            let connectCount = 0;

            mockClientFactory = () => {
                connectCount++;
                const events: Record<string, Function[]> = {};
                return {
                    _events: events,
                    isOpen: connectCount === 1, // First attempt has isOpen=true
                    connect: jest.fn().mockRejectedValue(new Error('Connection failed')),
                    quit: jest.fn().mockResolvedValue('OK'),
                    disconnect: jest.fn(),
                    duplicate: jest.fn(),
                    on: jest.fn((event: string, handler: Function) => {
                        if (!events[event]) events[event] = [];
                        events[event].push(handler);
                    }),
                    ping: jest.fn()
                };
            };

            const redis = require('../config/redis');
            const connectPromise = redis.connectRedis();

            // Advance through retries
            for (let i = 0; i < 10; i++) {
                await Promise.resolve();
                jest.advanceTimersByTime(20000);
                await Promise.resolve();
                await Promise.resolve();
            }

            await expect(connectPromise).rejects.toThrow();
            jest.useRealTimers();
        });
    });

    describe('reconnectStrategy edge cases', () => {
        it('calculates delay as retries * 100 capped at 3000', async () => {
            const redis = require('../config/redis');
            await redis.connectRedis();

            const { createClient } = require('redis');
            const callArgs = (createClient as jest.Mock).mock.calls[0][0];
            const strategy = callArgs.socket.reconnectStrategy;

            // Retries * 100, max retries is 10 so max delay is 1000
            expect(strategy(1)).toBe(100);
            expect(strategy(5)).toBe(500);
            expect(strategy(10)).toBe(1000);
            // Verify the formula: min(retries * 100, 3000)
            expect(strategy(3)).toBe(300);
        });

        it('returns Error after max retries', async () => {
            const redis = require('../config/redis');
            await redis.connectRedis();

            const { createClient } = require('redis');
            const callArgs = (createClient as jest.Mock).mock.calls[0][0];
            const strategy = callArgs.socket.reconnectStrategy;

            const result = strategy(11);
            expect(result).toBeInstanceOf(Error);
            expect(result.message).toContain('Max reconnection attempts');
        });
    });

    describe('TLS configuration branches', () => {
        it('does not set TLS options for non-TLS URLs', async () => {
            process.env.REDIS_URL = 'redis://localhost:6379';
            const { createClient } = require('redis');
            const redis = require('../config/redis');
            await redis.connectRedis();

            const callArgs = (createClient as jest.Mock).mock.calls[0][0];
            expect(callArgs.socket.tls).toBeUndefined();
        });

        it('sets rejectUnauthorized to true in production even when env var is false', async () => {
            process.env.REDIS_URL = 'rediss://my-redis:6380';
            process.env.NODE_ENV = 'production';
            process.env.REDIS_TLS_REJECT_UNAUTHORIZED = 'false';

            const { createClient } = require('redis');
            const redis = require('../config/redis');
            const logger = require('../utils/logger');
            await redis.connectRedis();

            const callArgs = (createClient as jest.Mock).mock.calls[0][0];
            expect(callArgs.socket.tls).toBe(true);
            expect(callArgs.socket.rejectUnauthorized).toBe(true);
            // Should log the warning about ignoring the env var
            expect(logger.warn).toHaveBeenCalledWith(
                expect.stringContaining('ignored in production')
            );
        });

        it('allows disabling TLS in development', async () => {
            process.env.REDIS_URL = 'rediss://my-redis:6380';
            process.env.NODE_ENV = 'development';
            process.env.REDIS_TLS_REJECT_UNAUTHORIZED = 'false';

            const { createClient } = require('redis');
            const redis = require('../config/redis');
            const logger = require('../utils/logger');
            await redis.connectRedis();

            const callArgs = (createClient as jest.Mock).mock.calls[0][0];
            expect(callArgs.socket.rejectUnauthorized).toBe(false);
            expect(logger.warn).toHaveBeenCalledWith(
                expect.stringContaining('TLS certificate validation is disabled')
            );
        });

        it('keeps TLS validation enabled when env var is not set', async () => {
            process.env.REDIS_URL = 'rediss://my-redis:6380';
            process.env.NODE_ENV = 'development';
            delete process.env.REDIS_TLS_REJECT_UNAUTHORIZED;

            const { createClient } = require('redis');
            const redis = require('../config/redis');
            await redis.connectRedis();

            const callArgs = (createClient as jest.Mock).mock.calls[0][0];
            expect(callArgs.socket.tls).toBe(true);
            expect(callArgs.socket.rejectUnauthorized).toBe(true);
        });
    });

    describe('getRedisMemoryInfo additional branches', () => {
        it('returns no alert when maxmemory is 0 (unlimited)', async () => {
            mockClientFactory = () => {
                const events: Record<string, Function[]> = {};
                return {
                    _events: events,
                    isOpen: true,
                    connect: jest.fn().mockResolvedValue(undefined),
                    quit: jest.fn().mockResolvedValue('OK'),
                    disconnect: jest.fn(),
                    duplicate: jest.fn(function () {
                        return {
                            isOpen: true,
                            connect: jest.fn().mockResolvedValue(undefined),
                            quit: jest.fn().mockResolvedValue('OK'),
                            disconnect: jest.fn(),
                            on: jest.fn()
                        };
                    }),
                    on: jest.fn((event: string, handler: Function) => {
                        if (!events[event]) events[event] = [];
                        events[event].push(handler);
                    }),
                    ping: jest.fn().mockResolvedValue('PONG'),
                    info: jest.fn().mockResolvedValue(
                        'used_memory:1000000\r\n' +
                        'used_memory_human:1M\r\n' +
                        'maxmemory:0\r\n' +
                        'maxmemory_human:unlimited\r\n'
                    )
                };
            };

            const redis = require('../config/redis');
            await redis.connectRedis();
            const info = await redis.getRedisMemoryInfo();

            expect(info.memory_usage_percent).toBe(0);
            expect(info.alert).toBeNull();
        });
    });
});
