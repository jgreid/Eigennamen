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
            MemoryStorage = require('../infrastructure/memoryStorage').MemoryStorage;
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
                // Room must exist for join to succeed
                await storage.set('room:TEST', '{"code":"TEST"}', { EX: 3600 });
                const result = await storage.eval('script', {
                    keys: ['room:TEST:players', 'room:TEST'],
                    arguments: ['10', 'session-123']
                });
                expect(result).toBe(1); // Successfully added
            });

            it('should return -1 if already a member', async () => {
                await storage.set('room:TEST', '{"code":"TEST"}', { EX: 3600 });
                await storage.sAdd('room:TEST:players', 'session-123');
                const result = await storage.eval('script', {
                    keys: ['room:TEST:players', 'room:TEST'],
                    arguments: ['10', 'session-123']
                });
                expect(result).toBe(-1); // Already a member
            });

            it('should return 0 if room is full', async () => {
                await storage.set('room:TEST', '{"code":"TEST"}', { EX: 3600 });
                await storage.sAdd('room:TEST:players', 'session-1', 'session-2');
                const result = await storage.eval('script', {
                    keys: ['room:TEST:players', 'room:TEST'],
                    arguments: ['2', 'session-123'] // Max 2 players
                });
                expect(result).toBe(0); // Room is full
            });

            it('should return -2 if room does not exist', async () => {
                const result = await storage.eval('script', {
                    keys: ['room:TEST:players', 'room:TEST'],
                    arguments: ['10', 'session-123']
                });
                expect(result).toBe(-2); // Room doesn't exist
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

    describe('Watch and Transaction Edge Cases', () => {
        let storage;

        beforeEach(() => {
            storage = new MemoryStorage();
        });

        afterEach(() => {
            if (storage.cleanupInterval) {
                clearInterval(storage.cleanupInterval);
            }
        });

        it('should handle watch on expired key', async () => {
            await storage.set('key1', 'value1', { PX: 1 });
            await new Promise(resolve => setTimeout(resolve, 10));
            const result = await storage.watch('key1');
            expect(result).toBe('OK');
        });

        it('should fail transaction when watched key changes', async () => {
            await storage.set('key1', 'value1');
            await storage.watch('key1');

            // Modify the key outside the transaction
            await storage.set('key1', 'modified');

            const pipeline = storage.multi();
            pipeline.set('key2', 'value2');
            const results = await pipeline.exec();

            // Transaction should fail (return null) because watched key changed
            expect(results).toBeNull();
        });

        it('should fail transaction when watched key expires', async () => {
            await storage.set('key1', 'value1', { PX: 10 });
            await storage.watch('key1');

            // Wait for key to expire
            await new Promise(resolve => setTimeout(resolve, 20));

            const pipeline = storage.multi();
            pipeline.set('key2', 'value2');
            const results = await pipeline.exec();

            // Transaction should fail because watched key expired
            expect(results).toBeNull();
        });

        it('should handle unwatch', async () => {
            await storage.set('key1', 'value1');
            await storage.watch('key1');
            const result = await storage.unwatch();
            expect(result).toBe('OK');
        });

        it('should handle transaction sRem on expired key', async () => {
            await storage.sAdd('myset', 'a', 'b');
            storage.expiries.set('myset', Date.now() - 1000); // Set expired

            const pipeline = storage.multi();
            pipeline.sRem('myset', 'a');
            const results = await pipeline.exec();

            expect(results[0]).toBe(0);
        });

        it('should handle transaction sAdd on expired key', async () => {
            await storage.sAdd('myset', 'a');
            storage.expiries.set('myset', Date.now() - 1000); // Set expired

            const pipeline = storage.multi();
            pipeline.sAdd('myset', 'b');
            const results = await pipeline.exec();

            expect(results[0]).toBe(1);
        });

        it('should handle transaction del on expired key', async () => {
            await storage.set('key1', 'value1');
            storage.expiries.set('key1', Date.now() - 1000); // Set expired

            const pipeline = storage.multi();
            pipeline.del('key1');
            const results = await pipeline.exec();

            expect(results[0]).toBe(0);
        });

        it('should handle transaction expire on expired key', async () => {
            await storage.set('key1', 'value1');
            storage.expiries.set('key1', Date.now() - 1000); // Set expired

            const pipeline = storage.multi();
            pipeline.expire('key1', 100);
            const results = await pipeline.exec();

            expect(results[0]).toBe(0);
        });

        it('should handle transaction set with PX option', async () => {
            const pipeline = storage.multi();
            pipeline.set('key1', 'value1', { PX: 10000 });
            const results = await pipeline.exec();

            expect(results[0]).toBe('OK');
            const ttl = await storage.ttl('key1');
            expect(ttl).toBeGreaterThan(0);
        });

        it('should handle transaction set with KEEPTTL option', async () => {
            await storage.set('key1', 'value1', { EX: 100 });
            const pipeline = storage.multi();
            pipeline.set('key1', 'value2', { KEEPTTL: true });
            await pipeline.exec();

            const ttl = await storage.ttl('key1');
            expect(ttl).toBeGreaterThan(0);
        });
    });

    describe('Event Emitter Methods', () => {
        let storage;

        beforeEach(() => {
            storage = new MemoryStorage();
        });

        afterEach(() => {
            if (storage.cleanupInterval) {
                clearInterval(storage.cleanupInterval);
            }
        });

        it('should emit events to multiple handlers', () => {
            const messages = [];
            storage.on('custom', (msg) => messages.push(msg));
            storage.on('custom', (msg) => messages.push(msg + '-2'));

            storage.emit('custom', 'test');
            expect(messages).toEqual(['test', 'test-2']);
        });

        it('should handle emit errors gracefully', () => {
            storage.on('custom', () => { throw new Error('Handler error'); });
            storage.on('custom', (msg) => msg); // This should still be called

            // Should not throw - the error is caught internally
            expect(() => storage.emit('custom', 'test')).not.toThrow();
        });

        it('should handle emit on non-existent event', () => {
            expect(() => storage.emit('nonexistent', 'test')).not.toThrow();
        });

        it('should remove specific listener', () => {
            const messages = [];
            const handler = (msg) => messages.push(msg);
            storage.on('custom', handler);
            storage.removeListener('custom', handler);

            storage.emit('custom', 'test');
            expect(messages).toEqual([]);
        });

        it('should handle removeListener for non-existent handler', () => {
            const handler = () => {};
            expect(() => storage.removeListener('custom', handler)).not.toThrow();
        });

        it('should remove all listeners for specific event', () => {
            const messages = [];
            storage.on('custom', (msg) => messages.push(msg));
            storage.on('custom', (msg) => messages.push(msg + '-2'));
            storage.removeAllListeners('custom');

            storage.emit('custom', 'test');
            expect(messages).toEqual([]);
        });

        it('should remove all listeners for all events', () => {
            const messages = [];
            storage.on('custom1', (msg) => messages.push(msg));
            storage.on('custom2', (msg) => messages.push(msg));
            storage.removeAllListeners();

            storage.emit('custom1', 'test1');
            storage.emit('custom2', 'test2');
            expect(messages).toEqual([]);
        });

        it('should handle on with non-ready event', () => {
            const callback = jest.fn();
            storage.on('error', callback);

            // error event callback should not be called immediately
            expect(callback).not.toHaveBeenCalled();
        });
    });

    describe('Additional Methods', () => {
        let storage;

        beforeEach(() => {
            storage = new MemoryStorage();
        });

        afterEach(() => {
            if (storage.cleanupInterval) {
                clearInterval(storage.cleanupInterval);
            }
        });

        it('should handle evalSha', async () => {
            // Room must exist for join eval to succeed
            await storage.set('room:TEST', '{"code":"TEST"}', { EX: 3600 });
            const result = await storage.evalSha('fakeSha', {
                keys: ['room:TEST:players', 'room:TEST'],
                arguments: ['10', 'session-123']
            });
            expect(result).toBe(1);
        });

        it('should handle scriptLoad', async () => {
            const result = await storage.scriptLoad('fake script');
            expect(result).toBe('memory_mode_sha');
        });

        it('should handle connect', async () => {
            const result = await storage.connect();
            expect(result).toBe(storage);
            expect(storage.isOpen).toBe(true);
        });

        it('should handle disconnect', async () => {
            const result = await storage.disconnect();
            expect(result).toBe('OK');
            expect(storage.isOpen).toBe(false);
        });

        it('should handle scan', async () => {
            await storage.set('user:1', 'a');
            await storage.set('user:2', 'b');
            await storage.set('post:1', 'c');

            const result = await storage.scan('0', { MATCH: 'user:*', COUNT: 10 });
            expect(result.keys.sort()).toEqual(['user:1', 'user:2']);
        });

        it('should handle scan pagination', async () => {
            // Add more keys than COUNT
            for (let i = 0; i < 15; i++) {
                await storage.set(`key:${i}`, `value${i}`);
            }

            const result1 = await storage.scan('0', { MATCH: 'key:*', COUNT: 5 });
            expect(result1.keys.length).toBeLessThanOrEqual(5);

            const result2 = await storage.scan(result1.cursor, { MATCH: 'key:*', COUNT: 5 });
            expect(result2.keys.length).toBeGreaterThan(0);
        });

        it('should handle keys pattern', async () => {
            await storage.set('user:1', 'a');
            await storage.sAdd('user:2', 'b'); // Set type
            await storage.set('post:1', 'c');

            const keys = await storage.keys('user:*');
            expect(keys.sort()).toEqual(['user:1', 'user:2']);
        });

        it('should handle eval with unsupported script', async () => {
            const result = await storage.eval('unsupported script', { keys: [], arguments: [] });
            expect(result).toBeNull();
        });

        it('should handle publish with no subscribers', async () => {
            const result = await storage.publish('channel', 'message');
            expect(result).toBe(0);
        });

        it('should handle publish error in callback', async () => {
            await storage.subscribe('channel', () => { throw new Error('Callback error'); });
            const result = await storage.publish('channel', 'message');

            // Should return 1 indicating message was delivered (error is caught internally)
            expect(result).toBe(1);
        });
    });

    describe('Incr/Decr with Expired Keys', () => {
        let storage;

        beforeEach(() => {
            storage = new MemoryStorage();
        });

        afterEach(() => {
            if (storage.cleanupInterval) {
                clearInterval(storage.cleanupInterval);
            }
        });

        it('should handle incr on expired key', async () => {
            await storage.set('counter', '5', { PX: 1 });
            await new Promise(resolve => setTimeout(resolve, 10));

            const result = await storage.incr('counter');
            expect(result).toBe(1); // Starts fresh from 0
        });

        it('should handle decr on expired key', async () => {
            await storage.set('counter', '5', { PX: 1 });
            await new Promise(resolve => setTimeout(resolve, 10));

            const result = await storage.decr('counter');
            expect(result).toBe(-1); // Starts fresh from 0
        });
    });

    describe('Set Operations with Expired Keys', () => {
        let storage;

        beforeEach(() => {
            storage = new MemoryStorage();
        });

        afterEach(() => {
            if (storage.cleanupInterval) {
                clearInterval(storage.cleanupInterval);
            }
        });

        it('should handle sAdd on expired set', async () => {
            await storage.sAdd('myset', 'a');
            storage.expiries.set('myset', Date.now() - 1000);

            const result = await storage.sAdd('myset', 'b');
            expect(result).toBe(1);
        });

        it('should handle sRem on expired set', async () => {
            await storage.sAdd('myset', 'a');
            storage.expiries.set('myset', Date.now() - 1000);

            const result = await storage.sRem('myset', 'a');
            expect(result).toBe(0);
        });

        it('should handle sMembers on expired set', async () => {
            await storage.sAdd('myset', 'a');
            storage.expiries.set('myset', Date.now() - 1000);

            const result = await storage.sMembers('myset');
            expect(result).toEqual([]);
        });

        it('should handle sIsMember on expired set', async () => {
            await storage.sAdd('myset', 'a');
            storage.expiries.set('myset', Date.now() - 1000);

            const result = await storage.sIsMember('myset', 'a');
            expect(result).toBe(0);
        });

        it('should handle sCard on expired set', async () => {
            await storage.sAdd('myset', 'a', 'b');
            storage.expiries.set('myset', Date.now() - 1000);

            const result = await storage.sCard('myset');
            expect(result).toBe(0);
        });
    });

    describe('Del on expired key', () => {
        let storage;

        beforeEach(() => {
            storage = new MemoryStorage();
        });

        afterEach(() => {
            if (storage.cleanupInterval) {
                clearInterval(storage.cleanupInterval);
            }
        });

        it('should return 0 for del on expired key', async () => {
            await storage.set('key1', 'value1');
            storage.expiries.set('key1', Date.now() - 1000);

            const result = await storage.del('key1');
            expect(result).toBe(0);
        });
    });

    describe('Expire on expired key', () => {
        let storage;

        beforeEach(() => {
            storage = new MemoryStorage();
        });

        afterEach(() => {
            if (storage.cleanupInterval) {
                clearInterval(storage.cleanupInterval);
            }
        });

        it('should return 0 for expire on expired key', async () => {
            await storage.set('key1', 'value1');
            storage.expiries.set('key1', Date.now() - 1000);

            const result = await storage.expire('key1', 100);
            expect(result).toBe(0);
        });
    });

    describe('Eval with Expired Key', () => {
        let storage;

        beforeEach(() => {
            storage = new MemoryStorage();
        });

        afterEach(() => {
            if (storage.cleanupInterval) {
                clearInterval(storage.cleanupInterval);
            }
        });

        it('should handle eval join script on expired players set', async () => {
            // Room must exist for join to succeed
            await storage.set('room:TEST', '{"code":"TEST"}', { EX: 3600 });
            await storage.sAdd('room:TEST:players', 'existing');
            storage.expiries.set('room:TEST:players', Date.now() - 1000);

            const result = await storage.eval('script', {
                keys: ['room:TEST:players', 'room:TEST'],
                arguments: ['10', 'new-session']
            });
            expect(result).toBe(1); // Successfully added to fresh set
        });
    });

    describe('ScanIterator with Sets', () => {
        let storage;

        beforeEach(() => {
            storage = new MemoryStorage();
        });

        afterEach(() => {
            if (storage.cleanupInterval) {
                clearInterval(storage.cleanupInterval);
            }
        });

        it('should iterate over set keys', async () => {
            await storage.sAdd('users:active', 'a');
            await storage.sAdd('users:inactive', 'b');

            const keys = [];
            for await (const key of storage.scanIterator({ MATCH: 'users:*' })) {
                keys.push(key);
            }

            expect(keys.sort()).toEqual(['users:active', 'users:inactive']);
        });

        it('should not duplicate keys that exist in both maps', async () => {
            // This shouldn't happen in practice, but test the deduplication logic
            await storage.set('key1', 'value1');

            const keys = [];
            for await (const key of storage.scanIterator({ MATCH: 'key*' })) {
                keys.push(key);
            }

            expect(keys).toEqual(['key1']);
        });
    });

    describe('TTL edge cases', () => {
        let storage;

        beforeEach(() => {
            storage = new MemoryStorage();
        });

        afterEach(() => {
            if (storage.cleanupInterval) {
                clearInterval(storage.cleanupInterval);
            }
        });

        it('should return -2 for ttl on expired key', async () => {
            await storage.set('key1', 'value1');
            storage.expiries.set('key1', Date.now() - 1000);

            const ttl = await storage.ttl('key1');
            expect(ttl).toBe(-2);
        });
    });

    describe('Clone behavior', () => {
        let storage;

        beforeEach(() => {
            storage = new MemoryStorage();
        });

        afterEach(() => {
            if (storage.cleanupInterval) {
                clearInterval(storage.cleanupInterval);
            }
        });

        it('clone should not have cleanup interval', async () => {
            const clone = storage.duplicate();
            expect(clone._isClone).toBe(true);
            expect(clone.cleanupInterval).toBeUndefined();
        });

        it('clone should share data with original', async () => {
            await storage.set('key1', 'value1');
            const clone = storage.duplicate();

            // Modify via original
            await storage.set('key2', 'value2');

            // Should be visible in clone
            const val = await clone.get('key2');
            expect(val).toBe('value2');
        });
    });
});
