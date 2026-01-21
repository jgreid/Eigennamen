/**
 * Tests for In-Memory Storage Adapter
 */

// Reset modules to get fresh MemoryStorage instances
beforeEach(() => {
    jest.resetModules();
});

// Mock logger
jest.mock('../utils/logger', () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
}));

describe('MemoryStorage', () => {
    let MemoryStorage;

    beforeEach(() => {
        // Get fresh module
        jest.isolateModules(() => {
            MemoryStorage = require('../config/memoryStorage').MemoryStorage;
        });
    });

    describe('Basic String Operations', () => {
        let storage;

        beforeEach(() => {
            storage = new MemoryStorage();
        });

        afterEach(() => {
            if (storage.cleanupInterval) {
                clearInterval(storage.cleanupInterval);
            }
        });

        describe('get/set', () => {
            it('should set and get string value', async () => {
                await storage.set('key1', 'value1');
                const result = await storage.get('key1');
                expect(result).toBe('value1');
            });

            it('should return null for non-existent key', async () => {
                const result = await storage.get('nonexistent');
                expect(result).toBeNull();
            });

            it('should overwrite existing value', async () => {
                await storage.set('key1', 'value1');
                await storage.set('key1', 'value2');
                const result = await storage.get('key1');
                expect(result).toBe('value2');
            });

            it('should return OK on set', async () => {
                const result = await storage.set('key1', 'value1');
                expect(result).toBe('OK');
            });
        });

        describe('Expiry (EX/PX options)', () => {
            it('should set expiry with EX option (seconds)', async () => {
                await storage.set('key1', 'value1', { EX: 10 });
                const result = await storage.get('key1');
                expect(result).toBe('value1');
            });

            it('should set expiry with PX option (milliseconds)', async () => {
                await storage.set('key1', 'value1', { PX: 10000 });
                const result = await storage.get('key1');
                expect(result).toBe('value1');
            });

            it('should return null for expired key', async () => {
                await storage.set('key1', 'value1', { PX: 1 });
                await new Promise(resolve => setTimeout(resolve, 10));
                const result = await storage.get('key1');
                expect(result).toBeNull();
            });

            it('should remove TTL when KEEPTTL is not set', async () => {
                await storage.set('key1', 'value1', { EX: 100 });
                await storage.set('key1', 'value2');  // No TTL options
                const ttl = await storage.ttl('key1');
                expect(ttl).toBe(-1);  // -1 means no expiry
            });
        });

        describe('del', () => {
            it('should delete existing key', async () => {
                await storage.set('key1', 'value1');
                const result = await storage.del('key1');
                expect(result).toBe(1);
                expect(await storage.get('key1')).toBeNull();
            });

            it('should return 0 for non-existent key', async () => {
                const result = await storage.del('nonexistent');
                expect(result).toBe(0);
            });
        });

        describe('exists', () => {
            it('should return 1 for existing key', async () => {
                await storage.set('key1', 'value1');
                const result = await storage.exists('key1');
                expect(result).toBe(1);
            });

            it('should return 0 for non-existent key', async () => {
                const result = await storage.exists('nonexistent');
                expect(result).toBe(0);
            });

            it('should return 0 for expired key', async () => {
                await storage.set('key1', 'value1', { PX: 1 });
                await new Promise(resolve => setTimeout(resolve, 10));
                const result = await storage.exists('key1');
                expect(result).toBe(0);
            });
        });

        describe('expire', () => {
            it('should set expiry on existing key', async () => {
                await storage.set('key1', 'value1');
                const result = await storage.expire('key1', 100);
                expect(result).toBe(1);
            });

            it('should return 0 for non-existent key', async () => {
                const result = await storage.expire('nonexistent', 100);
                expect(result).toBe(0);
            });
        });

        describe('ttl', () => {
            it('should return remaining TTL', async () => {
                await storage.set('key1', 'value1', { EX: 100 });
                const ttl = await storage.ttl('key1');
                expect(ttl).toBeGreaterThan(0);
                expect(ttl).toBeLessThanOrEqual(100);
            });

            it('should return -1 for key without expiry', async () => {
                await storage.set('key1', 'value1');
                const ttl = await storage.ttl('key1');
                expect(ttl).toBe(-1);
            });

            it('should return -2 for non-existent key', async () => {
                const ttl = await storage.ttl('nonexistent');
                expect(ttl).toBe(-2);
            });
        });

        describe('incr/decr', () => {
            it('should increment non-existent key to 1', async () => {
                const result = await storage.incr('counter');
                expect(result).toBe(1);
            });

            it('should increment existing value', async () => {
                await storage.set('counter', '5');
                const result = await storage.incr('counter');
                expect(result).toBe(6);
            });

            it('should decrement non-existent key to -1', async () => {
                const result = await storage.decr('counter');
                expect(result).toBe(-1);
            });

            it('should decrement existing value', async () => {
                await storage.set('counter', '5');
                const result = await storage.decr('counter');
                expect(result).toBe(4);
            });
        });
    });

    describe('Set Operations', () => {
        let storage;

        beforeEach(() => {
            storage = new MemoryStorage();
        });

        afterEach(() => {
            if (storage.cleanupInterval) {
                clearInterval(storage.cleanupInterval);
            }
        });

        describe('sAdd', () => {
            it('should add members to set', async () => {
                const result = await storage.sAdd('myset', 'a', 'b', 'c');
                expect(result).toBe(3);
            });

            it('should not add duplicate members', async () => {
                await storage.sAdd('myset', 'a', 'b');
                const result = await storage.sAdd('myset', 'b', 'c');
                expect(result).toBe(1);  // Only 'c' is new
            });
        });

        describe('sRem', () => {
            it('should remove members from set', async () => {
                await storage.sAdd('myset', 'a', 'b', 'c');
                const result = await storage.sRem('myset', 'a', 'c');
                expect(result).toBe(2);
            });

            it('should return 0 for non-existent members', async () => {
                await storage.sAdd('myset', 'a');
                const result = await storage.sRem('myset', 'b');
                expect(result).toBe(0);
            });
        });

        describe('sMembers', () => {
            it('should return all members', async () => {
                await storage.sAdd('myset', 'a', 'b', 'c');
                const members = await storage.sMembers('myset');
                expect(members.sort()).toEqual(['a', 'b', 'c']);
            });

            it('should return empty array for non-existent set', async () => {
                const members = await storage.sMembers('nonexistent');
                expect(members).toEqual([]);
            });
        });

        describe('sIsMember', () => {
            it('should return 1 for member', async () => {
                await storage.sAdd('myset', 'a');
                const result = await storage.sIsMember('myset', 'a');
                expect(result).toBe(1);
            });

            it('should return 0 for non-member', async () => {
                await storage.sAdd('myset', 'a');
                const result = await storage.sIsMember('myset', 'b');
                expect(result).toBe(0);
            });
        });

        describe('sCard', () => {
            it('should return set size', async () => {
                await storage.sAdd('myset', 'a', 'b', 'c');
                const result = await storage.sCard('myset');
                expect(result).toBe(3);
            });

            it('should return 0 for non-existent set', async () => {
                const result = await storage.sCard('nonexistent');
                expect(result).toBe(0);
            });
        });
    });

    // Note: Hash operations (hSet, hGet, hGetAll, hDel, hExists, hIncrBy) are not implemented
    // in memoryStorage.js - Redis handles these for services that need them

    // Note: List operations (lPush, rPush, lLen, lIndex, lTrim, lRange) are not implemented
    // in memoryStorage.js - Redis handles these for services that need them

    describe('Transaction Support', () => {
        let storage;

        beforeEach(() => {
            storage = new MemoryStorage();
        });

        afterEach(() => {
            if (storage.cleanupInterval) {
                clearInterval(storage.cleanupInterval);
            }
        });

        describe('multi/exec', () => {
            it('should execute set commands in pipeline', async () => {
                const pipeline = storage.multi();
                pipeline.set('key1', 'value1');
                pipeline.set('key2', 'value2');

                const results = await pipeline.exec();

                expect(results).toHaveLength(2);
                expect(await storage.get('key1')).toBe('value1');
                expect(await storage.get('key2')).toBe('value2');
            });

            it('should execute del commands in pipeline', async () => {
                await storage.set('key1', 'value1');
                const pipeline = storage.multi();
                pipeline.del('key1');

                const results = await pipeline.exec();

                expect(results).toHaveLength(1);
                expect(results[0]).toBe(1);
                expect(await storage.get('key1')).toBeNull();
            });

            it('should execute sAdd commands in pipeline', async () => {
                const pipeline = storage.multi();
                pipeline.sAdd('myset', 'a', 'b');

                const results = await pipeline.exec();

                expect(results).toHaveLength(1);
                expect(results[0]).toBe(2);
            });

            it('should execute expire commands in pipeline', async () => {
                await storage.set('key1', 'value1');
                const pipeline = storage.multi();
                pipeline.expire('key1', 100);

                const results = await pipeline.exec();

                expect(results).toHaveLength(1);
                expect(results[0]).toBe(1);
            });
        });
    });

    describe('Pub/Sub Simulation', () => {
        let storage;

        beforeEach(() => {
            storage = new MemoryStorage();
        });

        afterEach(() => {
            if (storage.cleanupInterval) {
                clearInterval(storage.cleanupInterval);
            }
        });

        it('should handle subscribe/publish', async () => {
            const messages = [];
            const handler = (message) => messages.push(message);

            await storage.subscribe('channel1', handler);
            await storage.publish('channel1', 'hello');

            expect(messages).toEqual(['hello']);
        });

        it('should handle unsubscribe', async () => {
            const messages = [];
            const handler = (message) => messages.push(message);

            await storage.subscribe('channel1', handler);
            await storage.unsubscribe('channel1');
            await storage.publish('channel1', 'hello');

            expect(messages).toEqual([]);
        });
    });

    describe('Utility Methods', () => {
        let storage;

        beforeEach(() => {
            storage = new MemoryStorage();
        });

        afterEach(() => {
            if (storage.cleanupInterval) {
                clearInterval(storage.cleanupInterval);
            }
        });

        describe('ping', () => {
            it('should return PONG', async () => {
                const result = await storage.ping();
                expect(result).toBe('PONG');
            });
        });

        describe('duplicate', () => {
            it('should create clone with shared data', async () => {
                await storage.set('key1', 'value1');
                const clone = storage.duplicate();
                const result = await clone.get('key1');
                expect(result).toBe('value1');
            });
        });

        describe('quit', () => {
            it('should clean up resources', async () => {
                await storage.quit();
                expect(storage.isOpen).toBe(false);
            });
        });

        describe('eval', () => {
            it('should handle atomic room join script', async () => {
                // Simulate room join script
                const result = await storage.eval('script', {
                    keys: ['room:players:TEST'],
                    arguments: ['10', 'session-123']
                });
                expect(result).toBe(1); // Successfully added
            });

            it('should return -1 if already a member', async () => {
                await storage.sAdd('room:players:TEST', 'session-123');
                const result = await storage.eval('script', {
                    keys: ['room:players:TEST'],
                    arguments: ['10', 'session-123']
                });
                expect(result).toBe(-1); // Already a member
            });

            it('should return 0 if room is full', async () => {
                await storage.sAdd('room:players:TEST', 'session-1', 'session-2');
                const result = await storage.eval('script', {
                    keys: ['room:players:TEST'],
                    arguments: ['2', 'session-123'] // Max 2 players
                });
                expect(result).toBe(0); // Room is full
            });
        });
    });

    describe('Scan Iterator', () => {
        let storage;

        beforeEach(() => {
            storage = new MemoryStorage();
        });

        afterEach(() => {
            if (storage.cleanupInterval) {
                clearInterval(storage.cleanupInterval);
            }
        });

        it('should iterate over matching keys', async () => {
            await storage.set('user:1', 'a');
            await storage.set('user:2', 'b');
            await storage.set('post:1', 'c');

            const keys = [];
            for await (const key of storage.scanIterator({ MATCH: 'user:*' })) {
                keys.push(key);
            }

            expect(keys.sort()).toEqual(['user:1', 'user:2']);
        });

        it('should return all keys with wildcard', async () => {
            await storage.set('a', '1');
            await storage.set('b', '2');

            const keys = [];
            for await (const key of storage.scanIterator({ MATCH: '*' })) {
                keys.push(key);
            }

            expect(keys.sort()).toEqual(['a', 'b']);
        });
    });

    describe('Glob to Regex', () => {
        let storage;

        beforeEach(() => {
            storage = new MemoryStorage();
        });

        afterEach(() => {
            if (storage.cleanupInterval) {
                clearInterval(storage.cleanupInterval);
            }
        });

        it('should match simple patterns', async () => {
            await storage.set('timer:room1', '1');
            await storage.set('timer:room2', '2');
            await storage.set('other', '3');

            const keys = [];
            for await (const key of storage.scanIterator({ MATCH: 'timer:*' })) {
                keys.push(key);
            }

            expect(keys.sort()).toEqual(['timer:room1', 'timer:room2']);
        });

        it('should escape regex metacharacters', async () => {
            await storage.set('key.with.dots', '1');
            await storage.set('keyadots', '2');

            const keys = [];
            for await (const key of storage.scanIterator({ MATCH: 'key.with.dots' })) {
                keys.push(key);
            }

            expect(keys).toEqual(['key.with.dots']);
        });
    });
});
