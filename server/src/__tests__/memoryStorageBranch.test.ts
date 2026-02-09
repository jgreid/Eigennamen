/**
 * Memory Storage Branch Coverage Tests
 *
 * Tests edge cases in Redis command emulation: expired key handling,
 * pattern matching, eval dispatch, list operations, sorted set operations,
 * watch/multi transaction, event handlers, pub/sub, eviction
 */

jest.mock('../utils/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
}));

const { MemoryStorage } = require('../config/memoryStorage');

describe('Memory Storage Branch Coverage', () => {
    let storage: InstanceType<typeof MemoryStorage>;

    beforeEach(() => {
        storage = new MemoryStorage();
    });

    afterEach(async () => {
        if (storage && typeof storage.disconnect === 'function') {
            await storage.disconnect();
        }
    });

    describe('set / get / del basics', () => {
        it('should set and get a value', async () => {
            await storage.set('key1', 'value1');
            const result = await storage.get('key1');
            expect(result).toBe('value1');
        });

        it('should return null for missing key', async () => {
            const result = await storage.get('nonexistent');
            expect(result).toBeNull();
        });

        it('should delete a key', async () => {
            await storage.set('del-key', 'value');
            const deleted = await storage.del('del-key');
            expect(deleted).toBe(1);
            const result = await storage.get('del-key');
            expect(result).toBeNull();
        });

        it('should delete multiple keys', async () => {
            await storage.set('k1', 'v1');
            await storage.set('k2', 'v2');
            const deleted = await storage.del(['k1', 'k2']);
            expect(deleted).toBe(2);
        });

        it('should return 0 for non-existing keys', async () => {
            const deleted = await storage.del(['nonexistent']);
            expect(deleted).toBe(0);
        });
    });

    describe('expired key handling', () => {
        it('should return null for expired key', async () => {
            await storage.set('expkey', 'value', { PX: 1 });
            await new Promise(resolve => setTimeout(resolve, 50));
            const result = await storage.get('expkey');
            expect(result).toBeNull();
        });

        it('should return -2 TTL for expired/non-existent key', async () => {
            const ttl = await storage.ttl('nonexistent');
            expect(ttl).toBe(-2);
        });

        it('should return -1 TTL for key without expiry', async () => {
            await storage.set('persistent', 'value');
            const ttl = await storage.ttl('persistent');
            expect(ttl).toBe(-1);
        });

        it('should return positive TTL for key with expiry', async () => {
            await storage.set('ttlkey', 'value', { EX: 3600 });
            const ttl = await storage.ttl('ttlkey');
            expect(ttl).toBeGreaterThan(0);
            expect(ttl).toBeLessThanOrEqual(3600);
        });
    });

    describe('set with options', () => {
        it('should handle NX option (set if not exists)', async () => {
            const r1 = await storage.set('nx-key', 'v1', { NX: true });
            expect(r1).toBe('OK');
            const r2 = await storage.set('nx-key', 'v2', { NX: true });
            expect(r2).toBeNull();
            const val = await storage.get('nx-key');
            expect(val).toBe('v1');
        });

        it('should handle EX option', async () => {
            await storage.set('ex-key', 'value', { EX: 3600 });
            const val = await storage.get('ex-key');
            expect(val).toBe('value');
        });

        it('should handle PX option (milliseconds)', async () => {
            await storage.set('px-key', 'value', { PX: 5000 });
            const val = await storage.get('px-key');
            expect(val).toBe('value');
        });
    });

    describe('expire', () => {
        it('should set expiry on existing key', async () => {
            await storage.set('expkey2', 'val');
            const r = await storage.expire('expkey2', 100);
            expect(r).toBe(1);
            const ttl = await storage.ttl('expkey2');
            expect(ttl).toBeGreaterThan(0);
        });

        it('should return 0 for non-existing key', async () => {
            const r = await storage.expire('nokey', 100);
            expect(r).toBe(0);
        });
    });

    describe('incr / decr', () => {
        it('should increment a key', async () => {
            const r1 = await storage.incr('counter');
            expect(r1).toBe(1);
            const r2 = await storage.incr('counter');
            expect(r2).toBe(2);
        });

        it('should decrement a key', async () => {
            await storage.set('dcounter', '5');
            const r = await storage.decr('dcounter');
            expect(r).toBe(4);
        });

        it('should handle expired key in incr', async () => {
            await storage.set('exp-counter', '10', { PX: 1 });
            await new Promise(resolve => setTimeout(resolve, 50));
            const r = await storage.incr('exp-counter');
            expect(r).toBe(1);
        });

        it('should handle expired key in decr', async () => {
            await storage.set('exp-dcounter', '10', { PX: 1 });
            await new Promise(resolve => setTimeout(resolve, 50));
            const r = await storage.decr('exp-dcounter');
            expect(r).toBe(-1);
        });

        it('should throw on WRONGTYPE for incr on set', async () => {
            await storage.sAdd('wrongtype', 'member');
            await expect(storage.incr('wrongtype')).rejects.toThrow('WRONGTYPE');
        });

        it('should throw on non-numeric value in incr', async () => {
            await storage.set('notnum', 'abc');
            await expect(storage.incr('notnum')).rejects.toThrow('not an integer');
        });
    });

    describe('set operations', () => {
        it('should add and get members', async () => {
            await storage.sAdd('myset', 'a', 'b', 'c');
            const members = await storage.sMembers('myset');
            expect(members).toContain('a');
            expect(members).toContain('b');
            expect(members).toContain('c');
        });

        it('should return empty array for non-existent set', async () => {
            const members = await storage.sMembers('nope');
            expect(members).toEqual([]);
        });

        it('should return set size with sCard', async () => {
            await storage.sAdd('sizeset', 'a', 'b');
            expect(await storage.sCard('sizeset')).toBe(2);
        });

        it('should return 0 for non-existent set in sCard', async () => {
            expect(await storage.sCard('nope')).toBe(0);
        });

        it('should check membership with sIsMember', async () => {
            await storage.sAdd('checkset', 'member1');
            expect(await storage.sIsMember('checkset', 'member1')).toBe(1);
            expect(await storage.sIsMember('checkset', 'nonexistent')).toBe(0);
            expect(await storage.sIsMember('nope', 'member')).toBe(0);
        });

        it('should remove members with sRem', async () => {
            await storage.sAdd('remset', 'a', 'b');
            const removed = await storage.sRem('remset', 'a');
            expect(removed).toBe(1);
            const members = await storage.sMembers('remset');
            expect(members).not.toContain('a');
        });

        it('should return 0 for sRem on nonexistent set', async () => {
            expect(await storage.sRem('nope', 'a')).toBe(0);
        });

        it('should handle expired set in sAdd', async () => {
            await storage.sAdd('expset', 'old');
            await storage.expire('expset', 0);
            await new Promise(resolve => setTimeout(resolve, 50));
            await storage.sAdd('expset', 'new');
            const members = await storage.sMembers('expset');
            expect(members).toContain('new');
        });
    });

    describe('mGet', () => {
        it('should get multiple keys at once', async () => {
            await storage.set('m1', 'v1');
            await storage.set('m2', 'v2');
            const result = await storage.mGet(['m1', 'm2', 'm3']);
            expect(result).toEqual(['v1', 'v2', null]);
        });

        it('should return null for expired keys in mGet', async () => {
            await storage.set('mexp', 'val', { PX: 1 });
            await new Promise(resolve => setTimeout(resolve, 50));
            const result = await storage.mGet(['mexp']);
            expect(result).toEqual([null]);
        });
    });

    describe('exists', () => {
        it('should return 1 for existing key', async () => {
            await storage.set('existing', 'value');
            expect(await storage.exists('existing')).toBe(1);
        });

        it('should return 0 for non-existing key', async () => {
            expect(await storage.exists('nonexistent')).toBe(0);
        });
    });

    describe('pattern matching in keys', () => {
        it('should match keys with wildcard pattern', async () => {
            await storage.set('room:abc:data', 'v1');
            await storage.set('room:def:data', 'v2');
            await storage.set('player:abc', 'v3');

            const keys = await storage.keys('room:*');
            expect(keys).toContain('room:abc:data');
            expect(keys).toContain('room:def:data');
            expect(keys).not.toContain('player:abc');
        });

        it('should return empty array when no keys match', async () => {
            const keys = await storage.keys('nonexistent:*');
            expect(keys).toEqual([]);
        });

        it('should match keys across set data structures', async () => {
            await storage.sAdd('room:abc:players', 'p1');
            const keys = await storage.keys('room:*:players');
            expect(keys).toContain('room:abc:players');
        });
    });

    describe('scan', () => {
        it('should scan keys with pattern', async () => {
            await storage.set('scan:1', 'v1');
            await storage.set('scan:2', 'v2');
            await storage.set('other:1', 'v3');

            const result = await storage.scan('0', { MATCH: 'scan:*', COUNT: 10 });
            expect(result.keys).toContain('scan:1');
            expect(result.keys).toContain('scan:2');
            expect(result.keys).not.toContain('other:1');
        });

        it('should paginate results', async () => {
            for (let i = 0; i < 5; i++) {
                await storage.set(`page:${i}`, `v${i}`);
            }

            const result = await storage.scan('0', { MATCH: 'page:*', COUNT: 2 });
            expect(result.keys.length).toBeLessThanOrEqual(2);
        });
    });

    describe('list operations', () => {
        it('should push and range from list', async () => {
            await storage.lPush('mylist', 'a', 'b', 'c');
            const range = await storage.lRange('mylist', 0, -1);
            expect(range).toHaveLength(3);
        });

        it('should get list length', async () => {
            await storage.lPush('lenlist', 'x', 'y');
            expect(await storage.lLen('lenlist')).toBe(2);
        });

        it('should get element by index', async () => {
            await storage.lPush('idxlist', 'first');
            const el = await storage.lIndex('idxlist', 0);
            expect(el).toBe('first');
        });

        it('should trim list', async () => {
            await storage.lPush('trimlist', 'a', 'b', 'c', 'd');
            await storage.lTrim('trimlist', 0, 1);
            const range = await storage.lRange('trimlist', 0, -1);
            expect(range).toHaveLength(2);
        });

        it('should return empty for non-existent list', async () => {
            expect(await storage.lRange('nope', 0, -1)).toEqual([]);
            expect(await storage.lLen('nope')).toBe(0);
            expect(await storage.lIndex('nope', 0)).toBeNull();
        });
    });

    describe('sorted set operations', () => {
        it('should add and range sorted set items', async () => {
            await storage.zAdd('myzset', { score: 1, value: 'a' }, { score: 2, value: 'b' });
            const range = await storage.zRange('myzset', 0, -1);
            expect(range).toContain('a');
            expect(range).toContain('b');
        });

        it('should get zCard', async () => {
            await storage.zAdd('zcard', { score: 1, value: 'a' });
            expect(await storage.zCard('zcard')).toBe(1);
        });

        it('should remove from sorted set', async () => {
            await storage.zAdd('zrem', { score: 1, value: 'a' }, { score: 2, value: 'b' });
            const removed = await storage.zRem('zrem', 'a');
            expect(removed).toBe(1);
        });

        it('should return empty for non-existent sorted set', async () => {
            expect(await storage.zRange('nope', 0, -1)).toEqual([]);
            expect(await storage.zCard('nope')).toBe(0);
        });
    });

    describe('eval - Lua script dispatch', () => {
        it('should return null for eval with no keys', async () => {
            const result = await storage.eval('return 1', {});
            expect(result).toBeNull();
        });

        it('should handle lock:release script (value matches)', async () => {
            await storage.set('lock:test', 'owner1');
            const result = await storage.eval('script', {
                keys: ['lock:test'],
                arguments: ['owner1']
            });
            expect(result).toBe(1);
            expect(await storage.get('lock:test')).toBeNull();
        });

        it('should handle lock:release script (value does not match)', async () => {
            await storage.set('lock:test2', 'owner1');
            const result = await storage.eval('script', {
                keys: ['lock:test2'],
                arguments: ['wrong_owner']
            });
            expect(result).toBe(0);
        });

        it('should handle lock:extend script', async () => {
            await storage.set('lock:ext', 'owner1');
            const result = await storage.eval('script', {
                keys: ['lock:ext'],
                arguments: ['owner1', '5000']
            });
            expect(result).toBe(1);
        });

        it('should return 0 for lock script on non-existent key', async () => {
            const result = await storage.eval('script', {
                keys: ['lock:missing'],
                arguments: ['owner1']
            });
            expect(result).toBe(0);
        });

        it('should handle room create script', async () => {
            const result = await storage.eval('script', {
                keys: ['room:newroom', 'room:newroom:players'],
                arguments: [JSON.stringify({ code: 'newroom' }), '3600']
            });
            expect(result).toBe(1);
        });

        it('should return 0 for existing room create', async () => {
            await storage.set('room:existroom', 'data');
            const result = await storage.eval('script', {
                keys: ['room:existroom', 'room:existroom:players'],
                arguments: [JSON.stringify({ code: 'existroom' }), '3600']
            });
            expect(result).toBe(0);
        });

        it('should handle room join script - success', async () => {
            await storage.set('room:joinroom', 'data');
            await storage.sAdd('room:joinroom:players', 'existing');

            const result = await storage.eval('script', {
                keys: ['room:joinroom:players', 'room:joinroom'],
                arguments: ['10', 'newplayer']
            });
            expect(result).toBe(1);
        });

        it('should handle room join script - room not found', async () => {
            const result = await storage.eval('script', {
                keys: ['room:ghost:players', 'room:ghost'],
                arguments: ['10', 'player1']
            });
            expect(result).toBe(-2);
        });

        it('should handle room join script - already a member', async () => {
            await storage.set('room:joinroom2', 'data');
            await storage.sAdd('room:joinroom2:players', 'existing');

            const result = await storage.eval('script', {
                keys: ['room:joinroom2:players', 'room:joinroom2'],
                arguments: ['10', 'existing']
            });
            expect(result).toBe(-1);
        });

        it('should handle room join script - room full', async () => {
            await storage.set('room:fullroom', 'data');
            await storage.sAdd('room:fullroom:players', 'p1');

            const result = await storage.eval('script', {
                keys: ['room:fullroom:players', 'room:fullroom'],
                arguments: ['1', 'newplayer']  // max 1 player
            });
            expect(result).toBe(0);
        });

        it('should handle timer get script', async () => {
            const timerData = JSON.stringify({ endTime: Date.now() + 30000, duration: 30 });
            await storage.set('timer:test', timerData);

            const result = await storage.eval('script', {
                keys: ['timer:test'],
                arguments: []
            });
            expect(result).toBe(timerData);
        });

        it('should return null for non-existent timer', async () => {
            const result = await storage.eval('script', {
                keys: ['timer:nonexistent'],
                arguments: []
            });
            expect(result).toBeNull();
        });
    });

    describe('watch / unwatch / multi chain', () => {
        it('should execute transaction successfully', async () => {
            await storage.set('wkey', 'value');
            await storage.watch('wkey');
            const multi = storage.multi();
            multi.set('wkey', 'new');
            const result = await multi.exec();
            expect(result).toBeTruthy();
            expect(await storage.get('wkey')).toBe('new');
            await storage.unwatch();
        });

        it('should fail transaction when watched key changes', async () => {
            await storage.set('wkey2', 'original');
            await storage.watch('wkey2');

            // Modify the key outside the transaction
            await storage.set('wkey2', 'changed');

            const multi = storage.multi();
            multi.set('wkey2', 'should_not_be_this');
            const result = await multi.exec();
            expect(result).toBeNull();
        });

        it('should watch a set key', async () => {
            await storage.sAdd('wset', 'a');
            await storage.watch('wset');
            const multi = storage.multi();
            multi.sAdd('wset', 'b');
            const result = await multi.exec();
            expect(result).toBeTruthy();
        });

        it('should watch a list key', async () => {
            await storage.lPush('wlist', 'a');
            await storage.watch('wlist');
            const multi = storage.multi();
            multi.lPush('wlist', 'b');
            const result = await multi.exec();
            expect(result).toBeTruthy();
        });

        it('should watch a sorted set key', async () => {
            await storage.zAdd('wzset', { score: 1, value: 'a' });
            await storage.watch('wzset');
            const multi = storage.multi();
            multi.zAdd('wzset', { score: 2, value: 'b' });
            const result = await multi.exec();
            expect(result).toBeTruthy();
        });

        it('should watch expired key as null', async () => {
            await storage.set('wexp', 'val', { PX: 1 });
            await new Promise(resolve => setTimeout(resolve, 50));
            await storage.watch('wexp');
            const multi = storage.multi();
            multi.set('wexp', 'new');
            const result = await multi.exec();
            expect(result).toBeTruthy();
        });
    });

    describe('multi transaction commands', () => {
        it('should support del in transaction', async () => {
            await storage.set('tdel', 'val');
            const multi = storage.multi();
            multi.del('tdel');
            await multi.exec();
            expect(await storage.get('tdel')).toBeNull();
        });

        it('should support sRem in transaction', async () => {
            await storage.sAdd('tsrem', 'a', 'b');
            const multi = storage.multi();
            multi.sRem('tsrem', 'a');
            await multi.exec();
            const members = await storage.sMembers('tsrem');
            expect(members).not.toContain('a');
        });

        it('should support expire in transaction', async () => {
            await storage.set('texp', 'val');
            const multi = storage.multi();
            multi.expire('texp', 100);
            await multi.exec();
            const ttl = await storage.ttl('texp');
            expect(ttl).toBeGreaterThan(0);
        });

        it('should support lTrim in transaction', async () => {
            await storage.lPush('tltrim', 'a', 'b', 'c');
            const multi = storage.multi();
            multi.lTrim('tltrim', 0, 0);
            await multi.exec();
            expect(await storage.lLen('tltrim')).toBe(1);
        });
    });

    describe('pub/sub', () => {
        it('should subscribe and publish', async () => {
            const received: string[] = [];
            await storage.subscribe('test-channel', (message: string) => {
                received.push(message);
            });
            const count = await storage.publish('test-channel', 'hello');
            expect(count).toBe(1);
            expect(received).toContain('hello');
        });

        it('should unsubscribe', async () => {
            await storage.subscribe('unsub-channel', () => {});
            await storage.unsubscribe('unsub-channel');
            const count = await storage.publish('unsub-channel', 'msg');
            expect(count).toBe(0);
        });
    });

    describe('event handlers', () => {
        it('should register and emit events', () => {
            const received: unknown[] = [];
            storage.on('test-event', (...args: unknown[]) => {
                received.push(args);
            });
            storage.emit('test-event', 'data');
            expect(received).toHaveLength(1);
        });

        it('should trigger ready callback immediately', (done) => {
            storage.on('ready', () => {
                done();
            });
        });
    });

    describe('connect / disconnect / quit', () => {
        it('should connect', async () => {
            const s = new MemoryStorage();
            const result = await s.connect();
            expect(result.isOpen).toBe(true);
            await s.disconnect();
        });

        it('should disconnect and clean up interval', async () => {
            const s = new MemoryStorage();
            await s.disconnect();
            expect(s.isOpen).toBe(false);
            expect(s.cleanupInterval).toBeNull();
        });

        it('should quit and clear event handlers', async () => {
            const s = new MemoryStorage();
            s.on('test', () => {});
            const result = await s.quit();
            expect(result).toBe('OK');
            expect(s.isOpen).toBe(false);
        });
    });

    describe('duplicate', () => {
        it('should create a clone that shares data', async () => {
            const dup = storage.duplicate();
            expect(dup._isClone).toBe(true);
            await storage.set('shared-key', 'shared-val');
            const result = await dup.get('shared-key');
            expect(result).toBe('shared-val');
            await dup.disconnect();
        });
    });
});
