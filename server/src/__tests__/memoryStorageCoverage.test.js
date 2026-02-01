/**
 * Comprehensive tests for MemoryStorage class
 * Target: >80% branch coverage
 */

jest.mock('../utils/logger', () => ({
    info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn()
}));

const { MemoryStorage, getMemoryStorage, isMemoryMode } = require('../config/memoryStorage');

// Helper to reset shared state between tests
function clearSharedState(storage) {
    storage.data.clear();
    storage.expiries.clear();
    storage.sets.clear();
    storage.lists.clear();
    storage.sortedSets.clear();
    storage.pubsubChannels.clear();
}

describe('MemoryStorage', () => {
    let storage;

    beforeEach(() => {
        storage = new MemoryStorage();
        clearSharedState(storage);
    });

    afterEach(async () => {
        await storage.quit();
    });

    // 1. Constructor & cleanup
    describe('constructor & cleanup', () => {
        test('isClone=true does not set cleanup interval', () => {
            const clone = new MemoryStorage(true);
            expect(clone.cleanupInterval).toBeUndefined();
            expect(clone._isClone).toBe(true);
        });

        test('isClone=false sets cleanup interval', () => {
            expect(storage.cleanupInterval).toBeDefined();
        });

        test('_cleanupExpired removes expired keys from all maps', () => {
            storage.data.set('k1', 'v1');
            storage.sets.set('k2', new Set(['a']));
            storage.lists.set('k3', ['a']);
            storage.sortedSets.set('k4', new Map([['a', 1]]));
            // Set all as expired
            const past = Date.now() - 1000;
            storage.expiries.set('k1', past);
            storage.expiries.set('k2', past);
            storage.expiries.set('k3', past);
            storage.expiries.set('k4', past);

            storage._cleanupExpired();

            expect(storage.data.has('k1')).toBe(false);
            expect(storage.sets.has('k2')).toBe(false);
            expect(storage.lists.has('k3')).toBe(false);
            expect(storage.sortedSets.has('k4')).toBe(false);
            expect(storage.expiries.size).toBe(0);
        });

        test('_cleanupExpired logs warning for slow cleanup', () => {
            const logger = require('../utils/logger');
            // Add many expired keys to potentially trigger slow path
            const past = Date.now() - 1000;
            for (let i = 0; i < 150; i++) {
                storage.data.set(`key${i}`, 'val');
                storage.expiries.set(`key${i}`, past);
            }
            storage._cleanupExpired();
            // With 150 keys cleaned, it should log a warning
            expect(logger.warn).toHaveBeenCalled();
        });

        test('cleanup interval fires periodically', () => {
            jest.useFakeTimers();
            const s = new MemoryStorage();
            clearSharedState(s);
            const spy = jest.spyOn(s, '_cleanupExpired');
            jest.advanceTimersByTime(60000);
            expect(spy).toHaveBeenCalled();
            s.quit();
            jest.useRealTimers();
        });
    });

    // 2. String ops
    describe('string operations', () => {
        test('get returns null for non-existent key', async () => {
            expect(await storage.get('nope')).toBeNull();
        });

        test('get returns null for expired key', async () => {
            storage.data.set('k', 'v');
            storage.expiries.set('k', Date.now() - 1000);
            expect(await storage.get('k')).toBeNull();
        });

        test('set with EX option', async () => {
            await storage.set('k', 'v', { EX: 10 });
            expect(await storage.get('k')).toBe('v');
            expect(storage.expiries.has('k')).toBe(true);
        });

        test('set with PX option', async () => {
            await storage.set('k', 'v', { PX: 5000 });
            expect(await storage.get('k')).toBe('v');
        });

        test('set with KEEPTTL preserves existing TTL', async () => {
            await storage.set('k', 'v', { EX: 100 });
            const ttlBefore = storage.expiries.get('k');
            await storage.set('k', 'v2', { KEEPTTL: true });
            expect(storage.expiries.get('k')).toBe(ttlBefore);
        });

        test('set without TTL removes existing TTL', async () => {
            await storage.set('k', 'v', { EX: 100 });
            await storage.set('k', 'v2');
            expect(storage.expiries.has('k')).toBe(false);
        });

        test('del returns 0 for expired key', async () => {
            storage.data.set('k', 'v');
            storage.expiries.set('k', Date.now() - 1000);
            expect(await storage.del('k')).toBe(0);
        });

        test('del returns 1 for existing key', async () => {
            await storage.set('k', 'v');
            expect(await storage.del('k')).toBe(1);
        });

        test('del returns 0 for non-existent key', async () => {
            expect(await storage.del('nope')).toBe(0);
        });

        test('exists returns 0 for expired key', async () => {
            storage.data.set('k', 'v');
            storage.expiries.set('k', Date.now() - 1000);
            expect(await storage.exists('k')).toBe(0);
        });

        test('exists returns 1 for set/list/sortedSet keys', async () => {
            await storage.sAdd('s', 'a');
            expect(await storage.exists('s')).toBe(1);
            await storage.lPush('l', 'a');
            expect(await storage.exists('l')).toBe(1);
            await storage.zAdd('z', { score: 1, value: 'a' });
            expect(await storage.exists('z')).toBe(1);
        });

        test('expire on non-existent key returns 0', async () => {
            expect(await storage.expire('nope', 10)).toBe(0);
        });

        test('ttl returns -2 for expired/non-existent keys', async () => {
            expect(await storage.ttl('nope')).toBe(-2);
            storage.data.set('k', 'v');
            storage.expiries.set('k', Date.now() - 1000);
            expect(await storage.ttl('k')).toBe(-2);
        });

        test('ttl returns -1 for key without expiry', async () => {
            await storage.set('k', 'v');
            expect(await storage.ttl('k')).toBe(-1);
        });

        test('incr on expired key starts from 0', async () => {
            storage.data.set('k', '5');
            storage.expiries.set('k', Date.now() - 1000);
            expect(await storage.incr('k')).toBe(1);
        });

        test('incr throws on wrong type', async () => {
            await storage.sAdd('k', 'a');
            await expect(storage.incr('k')).rejects.toThrow('WRONGTYPE');
        });

        test('incr throws on non-integer value', async () => {
            await storage.set('k', 'notanumber');
            await expect(storage.incr('k')).rejects.toThrow('not an integer');
        });

        test('decr on expired key starts from 0', async () => {
            storage.data.set('k', '5');
            storage.expiries.set('k', Date.now() - 1000);
            expect(await storage.decr('k')).toBe(-1);
        });

        test('decr throws on wrong type', async () => {
            await storage.lPush('k', 'a');
            await expect(storage.decr('k')).rejects.toThrow('WRONGTYPE');
        });

        test('decr throws on non-integer value', async () => {
            await storage.set('k', 'abc');
            await expect(storage.decr('k')).rejects.toThrow('not an integer');
        });
    });

    // 3. Set ops
    describe('set operations', () => {
        test('sAdd creates set and counts new members', async () => {
            expect(await storage.sAdd('s', 'a', 'b', 'a')).toBe(2);
            expect(await storage.sMembers('s')).toEqual(expect.arrayContaining(['a', 'b']));
        });

        test('sRem removes members', async () => {
            await storage.sAdd('s', 'a', 'b', 'c');
            expect(await storage.sRem('s', 'a', 'z')).toBe(1);
        });

        test('sRem on expired key returns 0', async () => {
            await storage.sAdd('s', 'a');
            storage.expiries.set('s', Date.now() - 1000);
            expect(await storage.sRem('s', 'a')).toBe(0);
        });

        test('sIsMember checks membership', async () => {
            await storage.sAdd('s', 'a');
            expect(await storage.sIsMember('s', 'a')).toBe(1);
            expect(await storage.sIsMember('s', 'b')).toBe(0);
        });

        test('sIsMember on expired key returns 0', async () => {
            await storage.sAdd('s', 'a');
            storage.expiries.set('s', Date.now() - 1000);
            expect(await storage.sIsMember('s', 'a')).toBe(0);
        });

        test('sCard returns size', async () => {
            expect(await storage.sCard('s')).toBe(0);
            await storage.sAdd('s', 'a', 'b');
            expect(await storage.sCard('s')).toBe(2);
        });

        test('sCard on expired key returns 0', async () => {
            await storage.sAdd('s', 'a');
            storage.expiries.set('s', Date.now() - 1000);
            expect(await storage.sCard('s')).toBe(0);
        });

        test('sMembers on expired key returns empty', async () => {
            await storage.sAdd('s', 'a');
            storage.expiries.set('s', Date.now() - 1000);
            expect(await storage.sMembers('s')).toEqual([]);
        });
    });

    // 4. Batch ops
    describe('mGet', () => {
        test('returns values and nulls for missing/expired', async () => {
            await storage.set('a', '1');
            await storage.set('b', '2');
            storage.data.set('c', '3');
            storage.expiries.set('c', Date.now() - 1000);
            const result = await storage.mGet(['a', 'b', 'c', 'd']);
            expect(result).toEqual(['1', '2', null, null]);
        });
    });

    // 5. List ops
    describe('list operations', () => {
        test('lPush adds to head', async () => {
            expect(await storage.lPush('l', 'a', 'b')).toBe(2);
            expect(await storage.lRange('l', 0, -1)).toEqual(['b', 'a']);
        });

        test('lPush on expired key creates new list', async () => {
            await storage.lPush('l', 'old');
            storage.expiries.set('l', Date.now() - 1000);
            expect(await storage.lPush('l', 'new')).toBe(1);
        });

        test('lRange with negative indices', async () => {
            await storage.lPush('l', 'a', 'b', 'c');
            expect(await storage.lRange('l', -2, -1)).toEqual(['b', 'a']);
        });

        test('lRange on empty/expired returns []', async () => {
            expect(await storage.lRange('l', 0, -1)).toEqual([]);
            await storage.lPush('l', 'a');
            storage.expiries.set('l', Date.now() - 1000);
            expect(await storage.lRange('l', 0, -1)).toEqual([]);
        });

        test('lRange returns [] when start > stop', async () => {
            await storage.lPush('l', 'a');
            expect(await storage.lRange('l', 5, 2)).toEqual([]);
        });

        test('lIndex with positive and negative index', async () => {
            await storage.lPush('l', 'a', 'b', 'c');
            expect(await storage.lIndex('l', 0)).toBe('c');
            expect(await storage.lIndex('l', -1)).toBe('a');
            expect(await storage.lIndex('l', 10)).toBeNull();
            expect(await storage.lIndex('l', -10)).toBeNull();
        });

        test('lIndex on non-existent/expired returns null', async () => {
            expect(await storage.lIndex('nope', 0)).toBeNull();
            await storage.lPush('l', 'a');
            storage.expiries.set('l', Date.now() - 1000);
            expect(await storage.lIndex('l', 0)).toBeNull();
        });

        test('lLen returns length', async () => {
            expect(await storage.lLen('l')).toBe(0);
            await storage.lPush('l', 'a', 'b');
            expect(await storage.lLen('l')).toBe(2);
        });

        test('lLen on expired returns 0', async () => {
            await storage.lPush('l', 'a');
            storage.expiries.set('l', Date.now() - 1000);
            expect(await storage.lLen('l')).toBe(0);
        });

        test('lTrim trims list', async () => {
            await storage.lPush('l', 'a', 'b', 'c', 'd');
            await storage.lTrim('l', 0, 1);
            expect(await storage.lRange('l', 0, -1)).toEqual(['d', 'c']);
        });

        test('lTrim with negative indices', async () => {
            await storage.lPush('l', 'a', 'b', 'c');
            await storage.lTrim('l', -2, -1);
            expect(await storage.lRange('l', 0, -1)).toEqual(['b', 'a']);
        });

        test('lTrim empty result when start > stop', async () => {
            await storage.lPush('l', 'a');
            await storage.lTrim('l', 5, 2);
            expect(await storage.lRange('l', 0, -1)).toEqual([]);
        });

        test('lTrim on expired/non-existent returns OK', async () => {
            expect(await storage.lTrim('nope', 0, 1)).toBe('OK');
            await storage.lPush('l', 'a');
            storage.expiries.set('l', Date.now() - 1000);
            expect(await storage.lTrim('l', 0, 1)).toBe('OK');
        });
    });

    // 6. Sorted set ops
    describe('sorted set operations', () => {
        test('zAdd adds and updates members', async () => {
            expect(await storage.zAdd('z', { score: 1, value: 'a' }, { score: 2, value: 'b' })).toBe(2);
            // Update existing - should return 0 new
            expect(await storage.zAdd('z', { score: 3, value: 'a' })).toBe(0);
        });

        test('zAdd on expired key creates new', async () => {
            await storage.zAdd('z', { score: 1, value: 'a' });
            storage.expiries.set('z', Date.now() - 1000);
            expect(await storage.zAdd('z', { score: 2, value: 'b' })).toBe(1);
        });

        test('zRange with REV and WITHSCORES', async () => {
            await storage.zAdd('z', { score: 1, value: 'a' }, { score: 2, value: 'b' }, { score: 3, value: 'c' });
            expect(await storage.zRange('z', 0, -1)).toEqual(['a', 'b', 'c']);
            expect(await storage.zRange('z', 0, -1, { REV: true })).toEqual(['c', 'b', 'a']);
            const withScores = await storage.zRange('z', 0, 0, { WITHSCORES: true });
            expect(withScores).toEqual([{ value: 'a', score: 1 }]);
        });

        test('zRange on expired/empty returns []', async () => {
            expect(await storage.zRange('z', 0, -1)).toEqual([]);
            await storage.zAdd('z', { score: 1, value: 'a' });
            storage.expiries.set('z', Date.now() - 1000);
            expect(await storage.zRange('z', 0, -1)).toEqual([]);
        });

        test('zRange returns [] when start > stop', async () => {
            await storage.zAdd('z', { score: 1, value: 'a' });
            expect(await storage.zRange('z', 5, 2)).toEqual([]);
        });

        test('zRangeByScore with LIMIT', async () => {
            await storage.zAdd('z', { score: 1, value: 'a' }, { score: 2, value: 'b' }, { score: 3, value: 'c' });
            expect(await storage.zRangeByScore('z', 1, 3)).toEqual(['a', 'b', 'c']);
            expect(await storage.zRangeByScore('z', 1, 3, { LIMIT: { offset: 1, count: 1 } })).toEqual(['b']);
        });

        test('zRangeByScore on expired returns []', async () => {
            await storage.zAdd('z', { score: 1, value: 'a' });
            storage.expiries.set('z', Date.now() - 1000);
            expect(await storage.zRangeByScore('z', 0, 10)).toEqual([]);
        });

        test('zRem removes members', async () => {
            await storage.zAdd('z', { score: 1, value: 'a' }, { score: 2, value: 'b' });
            expect(await storage.zRem('z', 'a', 'nonexist')).toBe(1);
        });

        test('zRem on expired/non-existent returns 0', async () => {
            expect(await storage.zRem('z', 'a')).toBe(0);
            await storage.zAdd('z', { score: 1, value: 'a' });
            storage.expiries.set('z', Date.now() - 1000);
            expect(await storage.zRem('z', 'a')).toBe(0);
        });

        test('zCard returns size', async () => {
            expect(await storage.zCard('z')).toBe(0);
            await storage.zAdd('z', { score: 1, value: 'a' });
            expect(await storage.zCard('z')).toBe(1);
        });

        test('zCard on expired returns 0', async () => {
            await storage.zAdd('z', { score: 1, value: 'a' });
            storage.expiries.set('z', Date.now() - 1000);
            expect(await storage.zCard('z')).toBe(0);
        });

        test('zRemRangeByRank removes by rank', async () => {
            await storage.zAdd('z', { score: 1, value: 'a' }, { score: 2, value: 'b' }, { score: 3, value: 'c' });
            expect(await storage.zRemRangeByRank('z', 0, 1)).toBe(2);
            expect(await storage.zRange('z', 0, -1)).toEqual(['c']);
        });

        test('zRemRangeByRank with negative indices', async () => {
            await storage.zAdd('z', { score: 1, value: 'a' }, { score: 2, value: 'b' }, { score: 3, value: 'c' });
            expect(await storage.zRemRangeByRank('z', -2, -1)).toBe(2);
            expect(await storage.zRange('z', 0, -1)).toEqual(['a']);
        });

        test('zRemRangeByRank on expired/empty returns 0', async () => {
            expect(await storage.zRemRangeByRank('z', 0, -1)).toBe(0);
            await storage.zAdd('z', { score: 1, value: 'a' });
            storage.expiries.set('z', Date.now() - 1000);
            expect(await storage.zRemRangeByRank('z', 0, -1)).toBe(0);
        });

        test('zRemRangeByRank returns 0 when start > stop', async () => {
            await storage.zAdd('z', { score: 1, value: 'a' });
            expect(await storage.zRemRangeByRank('z', 5, 2)).toBe(0);
        });
    });

    // 7. Keys & scan
    describe('keys and scanIterator', () => {
        test('keys matches across all data structures', async () => {
            await storage.set('str:1', 'v');
            await storage.sAdd('set:1', 'a');
            await storage.lPush('list:1', 'a');
            await storage.zAdd('zset:1', { score: 1, value: 'a' });
            const all = await storage.keys('*');
            expect(all).toEqual(expect.arrayContaining(['str:1', 'set:1', 'list:1', 'zset:1']));
            expect(all).toHaveLength(4);
        });

        test('keys filters by pattern', async () => {
            await storage.set('room:ABC', 'v');
            await storage.set('player:123', 'v');
            const keys = await storage.keys('room:*');
            expect(keys).toEqual(['room:ABC']);
        });

        test('keys excludes expired', async () => {
            await storage.set('k', 'v');
            storage.expiries.set('k', Date.now() - 1000);
            expect(await storage.keys('*')).toEqual([]);
        });

        test('scanIterator yields from all types', async () => {
            await storage.set('d:1', 'v');
            await storage.sAdd('s:1', 'a');
            await storage.lPush('l:1', 'a');
            await storage.zAdd('z:1', { score: 1, value: 'a' });
            const keys = [];
            for await (const key of storage.scanIterator({ MATCH: '*:1' })) {
                keys.push(key);
            }
            expect(keys).toEqual(expect.arrayContaining(['d:1', 's:1', 'l:1', 'z:1']));
            expect(keys).toHaveLength(4);
        });

        test('scanIterator deduplicates keys', async () => {
            // Key exists in both data and sets (shouldn't happen normally but test dedup)
            storage.data.set('dup', 'v');
            storage.sets.set('dup', new Set(['a']));
            const keys = [];
            for await (const key of storage.scanIterator({ MATCH: '*' })) {
                keys.push(key);
            }
            expect(keys.filter(k => k === 'dup')).toHaveLength(1);
        });

        test('scan with cursor pagination', async () => {
            await storage.set('a', '1');
            await storage.set('b', '2');
            const result = await storage.scan('0', { MATCH: '*', COUNT: 1 });
            expect(result).toHaveProperty('cursor');
            expect(result).toHaveProperty('keys');
        });
    });

    // 8. Pub/sub
    describe('pub/sub', () => {
        test('subscribe and publish', async () => {
            const cb = jest.fn();
            await storage.subscribe('ch1', cb);
            const count = await storage.publish('ch1', 'hello');
            expect(count).toBe(1);
            expect(cb).toHaveBeenCalledWith('hello', 'ch1');
        });

        test('publish to channel with no subscribers returns 0', async () => {
            expect(await storage.publish('nobody', 'msg')).toBe(0);
        });

        test('unsubscribe removes channel', async () => {
            const cb = jest.fn();
            await storage.subscribe('ch1', cb);
            await storage.unsubscribe('ch1');
            expect(await storage.publish('ch1', 'msg')).toBe(0);
        });

        test('publish handles callback error gracefully', async () => {
            const logger = require('../utils/logger');
            await storage.subscribe('ch1', () => { throw new Error('boom'); });
            await storage.publish('ch1', 'msg');
            expect(logger.error).toHaveBeenCalled();
        });
    });

    // 9. Eval scripts
    describe('eval scripts', () => {
        test('returns null with no keys', async () => {
            expect(await storage.eval('script', { keys: [], arguments: [] })).toBeNull();
            expect(await storage.eval('script', {})).toBeNull();
        });

        describe('Room CREATE (2 keys, 2 args)', () => {
            test('creates room successfully', async () => {
                const result = await storage.eval('', {
                    keys: ['room:ABC', 'room:ABC:players'],
                    arguments: ['{"code":"ABC"}', '3600']
                });
                expect(result).toBe(1);
                expect(storage.data.get('room:ABC')).toBe('{"code":"ABC"}');
                expect(storage.sets.has('room:ABC:players')).toBe(true);
            });

            test('returns 0 if room already exists', async () => {
                await storage.set('room:ABC', '{}');
                const result = await storage.eval('', {
                    keys: ['room:ABC', 'room:ABC:players'],
                    arguments: ['{}', '3600']
                });
                expect(result).toBe(0);
            });
        });

        describe('Room JOIN (1 key, 2 args)', () => {
            test('joins successfully', async () => {
                storage.sets.set('room:ABC:players', new Set());
                const result = await storage.eval('', {
                    keys: ['room:ABC:players'],
                    arguments: ['10', 'sess1']
                });
                expect(result).toBe(1);
            });

            test('returns 0 when full', async () => {
                storage.sets.set('room:ABC:players', new Set(['s1', 's2']));
                const result = await storage.eval('', {
                    keys: ['room:ABC:players'],
                    arguments: ['2', 'sess3']
                });
                expect(result).toBe(0);
            });

            test('returns -1 when already member', async () => {
                storage.sets.set('room:ABC:players', new Set(['sess1']));
                const result = await storage.eval('', {
                    keys: ['room:ABC:players'],
                    arguments: ['10', 'sess1']
                });
                expect(result).toBe(-1);
            });

            test('handles expired players key', async () => {
                storage.sets.set('room:ABC:players', new Set(['old']));
                storage.expiries.set('room:ABC:players', Date.now() - 1000);
                const result = await storage.eval('', {
                    keys: ['room:ABC:players'],
                    arguments: ['10', 'sess1']
                });
                expect(result).toBe(1);
            });
        });

        // Note: Timer CLAIM (1 key, 2 args, timer: prefix) is shadowed by Room JOIN
        // (same signature: 1 key, 2 args) which appears first in the dispatch chain.
        // This is a code issue - timer CLAIM with 1 key + 2 args is unreachable.

        describe('Timer ADD TIME (1 key starting with timer:, 1 arg)', () => {
            test('adds time to timer', async () => {
                const now = Date.now();
                const timerData = { endTime: now + 30000, duration: 60, remainingSeconds: 30 };
                storage.data.set('timer:room1', JSON.stringify(timerData));
                const result = await storage.eval('', {
                    keys: ['timer:room1'],
                    arguments: ['30']
                });
                const parsed = JSON.parse(result);
                expect(parsed.duration).toBe(90);
            });

            test('returns null if timer doesnt exist', async () => {
                const result = await storage.eval('', {
                    keys: ['timer:room1'],
                    arguments: ['30']
                });
                expect(result).toBeNull();
            });

            test('handles parse error', async () => {
                storage.data.set('timer:room1', 'bad');
                const result = await storage.eval('', {
                    keys: ['timer:room1'],
                    arguments: ['30']
                });
                expect(result).toBeNull();
            });
        });

        describe('Timer GET (1 key starting with timer:, 0 args)', () => {
            test('returns timer data', async () => {
                storage.data.set('timer:room1', '{"active":true}');
                const result = await storage.eval('', {
                    keys: ['timer:room1'],
                    arguments: []
                });
                expect(result).toBe('{"active":true}');
            });

            test('returns null for non-existent timer', async () => {
                const result = await storage.eval('', {
                    keys: ['timer:room1'],
                    arguments: []
                });
                expect(result).toBeNull();
            });
        });

        describe('Set Team (2 keys, 4 args, player: + bare roomCode)', () => {
            test('sets team successfully', async () => {
                const player = { team: 'red', role: 'operative', lastSeen: 0 };
                storage.data.set('player:sess1', JSON.stringify(player));
                const result = await storage.eval('', {
                    keys: ['player:sess1', 'ABCDEF'],
                    arguments: ['blue', '3600', String(Date.now()), 'sess1']
                });
                const parsed = JSON.parse(result);
                expect(parsed.player.team).toBe('blue');
                expect(parsed.oldTeam).toBe('red');
            });

            test('clears role when switching teams with spymaster role', async () => {
                const player = { team: 'red', role: 'spymaster', lastSeen: 0 };
                storage.data.set('player:sess1', JSON.stringify(player));
                storage.sets.set('room:ABCDEF:team:red', new Set(['sess1']));
                const result = await storage.eval('', {
                    keys: ['player:sess1', 'ABCDEF'],
                    arguments: ['blue', '3600', String(Date.now()), 'sess1']
                });
                const parsed = JSON.parse(result);
                expect(parsed.player.role).toBe('spectator');
            });

            test('sets team to null with __NULL__', async () => {
                const player = { team: 'red', role: 'operative', lastSeen: 0 };
                storage.data.set('player:sess1', JSON.stringify(player));
                storage.sets.set('room:ABCDEF:team:red', new Set(['sess1']));
                const result = await storage.eval('', {
                    keys: ['player:sess1', 'ABCDEF'],
                    arguments: ['__NULL__', '3600', String(Date.now()), 'sess1']
                });
                const parsed = JSON.parse(result);
                expect(parsed.player.team).toBeNull();
            });

            test('returns null for non-existent player', async () => {
                const result = await storage.eval('', {
                    keys: ['player:sess1', 'ABCDEF'],
                    arguments: ['blue', '3600', String(Date.now()), 'sess1']
                });
                expect(result).toBeNull();
            });

            test('removes empty old team set', async () => {
                const player = { team: 'red', role: 'operative', lastSeen: 0 };
                storage.data.set('player:sess1', JSON.stringify(player));
                storage.sets.set('room:ABCDEF:team:red', new Set(['sess1']));
                await storage.eval('', {
                    keys: ['player:sess1', 'ABCDEF'],
                    arguments: ['blue', '3600', String(Date.now()), 'sess1']
                });
                expect(storage.sets.has('room:ABCDEF:team:red')).toBe(false);
            });
        });

        describe('Safe Team Switch (3 keys, 5 args)', () => {
            test('switches team successfully', async () => {
                const player = { team: 'red', role: 'operative', connected: true, lastSeen: 0 };
                const other = { team: 'red', role: 'operative', connected: true, lastSeen: 0 };
                storage.data.set('player:sess1', JSON.stringify(player));
                storage.data.set('player:sess2', JSON.stringify(other));
                storage.sets.set('room:ABC:team:red', new Set(['sess1', 'sess2']));

                const result = await storage.eval('', {
                    keys: ['player:sess1', 'room:ABC:team:red', 'ABC'],
                    arguments: ['blue', 'sess1', '3600', String(Date.now()), 'true']
                });
                const parsed = JSON.parse(result);
                expect(parsed.success).toBe(true);
            });

            test('rejects when team would be empty', async () => {
                const player = { team: 'red', role: 'operative', connected: true, lastSeen: 0 };
                storage.data.set('player:sess1', JSON.stringify(player));
                storage.sets.set('room:ABC:team:red', new Set(['sess1']));

                const result = await storage.eval('', {
                    keys: ['player:sess1', 'room:ABC:team:red', 'ABC'],
                    arguments: ['blue', 'sess1', '3600', String(Date.now()), 'true']
                });
                const parsed = JSON.parse(result);
                expect(parsed.success).toBe(false);
                expect(parsed.reason).toBe('TEAM_WOULD_BE_EMPTY');
            });

            test('returns null for non-existent player', async () => {
                const result = await storage.eval('', {
                    keys: ['player:sess1', 'room:ABC:team:red', 'ABC'],
                    arguments: ['blue', 'sess1', '3600', String(Date.now()), 'false']
                });
                expect(result).toBeNull();
            });

            test('clears spymaster role on team switch', async () => {
                const player = { team: 'red', role: 'clicker', connected: true, lastSeen: 0 };
                storage.data.set('player:sess1', JSON.stringify(player));
                const result = await storage.eval('', {
                    keys: ['player:sess1', 'room:ABC:team:red', 'ABC'],
                    arguments: ['blue', 'sess1', '3600', String(Date.now()), 'false']
                });
                expect(JSON.parse(result).player.role).toBe('spectator');
            });

            test('handles checkEmpty=false', async () => {
                const player = { team: 'red', role: 'operative', connected: true, lastSeen: 0 };
                storage.data.set('player:sess1', JSON.stringify(player));
                storage.sets.set('room:ABC:team:red', new Set(['sess1']));
                const result = await storage.eval('', {
                    keys: ['player:sess1', 'room:ABC:team:red', 'ABC'],
                    arguments: ['blue', 'sess1', '3600', String(Date.now()), 'false']
                });
                expect(JSON.parse(result).success).toBe(true);
            });
        });

        describe('Set Role (2 keys, 4 args, player: + :players)', () => {
            test('sets role successfully', async () => {
                const player = { team: 'red', role: 'operative', lastSeen: 0 };
                storage.data.set('player:sess1', JSON.stringify(player));
                storage.sets.set('room:ABC:players', new Set(['sess1']));

                const result = await storage.eval('', {
                    keys: ['player:sess1', 'room:ABC:players'],
                    arguments: ['spymaster', 'sess1', '3600', String(Date.now())]
                });
                const parsed = JSON.parse(result);
                expect(parsed.success).toBe(true);
                expect(parsed.player.role).toBe('spymaster');
            });

            test('rejects spymaster if no team', async () => {
                const player = { team: null, role: 'operative', lastSeen: 0 };
                storage.data.set('player:sess1', JSON.stringify(player));

                const result = await storage.eval('', {
                    keys: ['player:sess1', 'room:ABC:players'],
                    arguments: ['spymaster', 'sess1', '3600', String(Date.now())]
                });
                expect(JSON.parse(result).reason).toBe('NO_TEAM');
            });

            test('rejects if role taken by another player', async () => {
                const player = { team: 'red', role: 'operative', lastSeen: 0 };
                const other = { team: 'red', role: 'spymaster', nickname: 'Bob', lastSeen: 0 };
                storage.data.set('player:sess1', JSON.stringify(player));
                storage.data.set('player:sess2', JSON.stringify(other));
                storage.sets.set('room:ABC:players', new Set(['sess1', 'sess2']));

                const result = await storage.eval('', {
                    keys: ['player:sess1', 'room:ABC:players'],
                    arguments: ['spymaster', 'sess1', '3600', String(Date.now())]
                });
                const parsed = JSON.parse(result);
                expect(parsed.reason).toBe('ROLE_TAKEN');
                expect(parsed.existingNickname).toBe('Bob');
            });

            test('returns null for non-existent player', async () => {
                const result = await storage.eval('', {
                    keys: ['player:sess1', 'room:ABC:players'],
                    arguments: ['spymaster', 'sess1', '3600', String(Date.now())]
                });
                expect(result).toBeNull();
            });

            test('allows non-unique roles like operative', async () => {
                const player = { team: 'red', role: 'spymaster', lastSeen: 0 };
                storage.data.set('player:sess1', JSON.stringify(player));
                storage.sets.set('room:ABC:players', new Set(['sess1']));

                const result = await storage.eval('', {
                    keys: ['player:sess1', 'room:ABC:players'],
                    arguments: ['operative', 'sess1', '3600', String(Date.now())]
                });
                expect(JSON.parse(result).success).toBe(true);
            });
        });

        describe('Host Transfer (3 keys, 3 args, player:+player:+room:)', () => {
            test('transfers host successfully', async () => {
                storage.data.set('player:old', JSON.stringify({ isHost: true, lastSeen: 0 }));
                storage.data.set('player:new', JSON.stringify({ isHost: false, lastSeen: 0 }));
                storage.data.set('room:ABC', JSON.stringify({ hostSessionId: 'old' }));

                const result = await storage.eval('', {
                    keys: ['player:old', 'player:new', 'room:ABC'],
                    arguments: ['new', '3600', String(Date.now())]
                });
                const parsed = JSON.parse(result);
                expect(parsed.success).toBe(true);
                expect(parsed.oldHost.isHost).toBe(false);
                expect(parsed.newHost.isHost).toBe(true);
            });

            test('fails when old host not found', async () => {
                storage.data.set('player:new', JSON.stringify({ isHost: false }));
                storage.data.set('room:ABC', JSON.stringify({}));

                const result = await storage.eval('', {
                    keys: ['player:old', 'player:new', 'room:ABC'],
                    arguments: ['new', '3600', String(Date.now())]
                });
                expect(JSON.parse(result).reason).toBe('OLD_HOST_NOT_FOUND');
            });

            test('fails when new host not found', async () => {
                storage.data.set('player:old', JSON.stringify({ isHost: true }));
                storage.data.set('room:ABC', JSON.stringify({}));

                const result = await storage.eval('', {
                    keys: ['player:old', 'player:new', 'room:ABC'],
                    arguments: ['new', '3600', String(Date.now())]
                });
                expect(JSON.parse(result).reason).toBe('NEW_HOST_NOT_FOUND');
            });

            test('fails when room not found', async () => {
                storage.data.set('player:old', JSON.stringify({ isHost: true }));
                storage.data.set('player:new', JSON.stringify({ isHost: false }));

                const result = await storage.eval('', {
                    keys: ['player:old', 'player:new', 'room:ABC'],
                    arguments: ['new', '3600', String(Date.now())]
                });
                expect(JSON.parse(result).reason).toBe('ROOM_NOT_FOUND');
            });
        });

        test('unsupported script pattern returns null', async () => {
            const result = await storage.eval('', {
                keys: ['k1', 'k2', 'k3', 'k4'],
                arguments: ['a']
            });
            expect(result).toBeNull();
        });

        test('evalSha delegates to eval', async () => {
            const result = await storage.evalSha('sha', { keys: [], arguments: [] });
            expect(result).toBeNull();
        });

        test('scriptLoad returns fake SHA', async () => {
            expect(await storage.scriptLoad('script')).toBe('memory_mode_sha');
        });
    });

    // 10. Transactions
    describe('transactions (multi/exec)', () => {
        test('multi().set().del().exec() works', async () => {
            await storage.set('existing', 'val');
            const results = await storage.multi()
                .set('k1', 'v1', { EX: 10 })
                .set('k2', 'v2', { PX: 5000 })
                .set('k3', 'v3')
                .del('existing')
                .exec();
            expect(results).toEqual(['OK', 'OK', 'OK', 1]);
            expect(await storage.get('k1')).toBe('v1');
        });

        test('multi().sAdd().sRem().exec()', async () => {
            await storage.sAdd('s', 'a', 'b');
            const results = await storage.multi()
                .sAdd('s', 'c')
                .sRem('s', 'a')
                .exec();
            expect(results).toEqual([1, 1]);
        });

        test('multi().expire().exec()', async () => {
            await storage.set('k', 'v');
            const results = await storage.multi()
                .expire('k', 100)
                .expire('nonexist', 100)
                .exec();
            expect(results).toEqual([1, 0]);
        });

        test('multi().lPush().lTrim().exec()', async () => {
            const results = await storage.multi()
                .lPush('l', 'a', 'b', 'c')
                .lTrim('l', 0, 1)
                .exec();
            expect(results).toEqual([3, 'OK']);
        });

        test('multi().zAdd().zRemRangeByRank().exec()', async () => {
            const results = await storage.multi()
                .zAdd('z', { score: 1, value: 'a' }, { score: 2, value: 'b' }, { score: 3, value: 'c' })
                .zRemRangeByRank('z', 0, 0)
                .exec();
            expect(results).toEqual([3, 1]);
        });

        test('watch detects data key modification', async () => {
            await storage.set('k', 'v1');
            await storage.watch('k');
            await storage.set('k', 'v2'); // modify after watch
            const result = await storage.multi().set('k', 'v3').exec();
            expect(result).toBeNull();
        });

        test('watch with set key', async () => {
            await storage.sAdd('s', 'a');
            await storage.watch('s');
            // No modification - should succeed
            const result = await storage.multi().set('x', '1').exec();
            expect(result).toEqual(['OK']);
        });

        test('watch with set key modified', async () => {
            await storage.sAdd('s', 'a');
            await storage.watch('s');
            await storage.sAdd('s', 'b'); // modify
            const result = await storage.multi().set('x', '1').exec();
            expect(result).toBeNull();
        });

        test('watch with list key', async () => {
            await storage.lPush('l', 'a');
            await storage.watch('l');
            const result = await storage.multi().set('x', '1').exec();
            expect(result).toEqual(['OK']);
        });

        test('watch with list key modified', async () => {
            await storage.lPush('l', 'a');
            await storage.watch('l');
            await storage.lPush('l', 'b');
            const result = await storage.multi().set('x', '1').exec();
            expect(result).toBeNull();
        });

        test('watch with sorted set key', async () => {
            await storage.zAdd('z', { score: 1, value: 'a' });
            await storage.watch('z');
            const result = await storage.multi().set('x', '1').exec();
            expect(result).toEqual(['OK']);
        });

        test('watch with sorted set key modified', async () => {
            await storage.zAdd('z', { score: 1, value: 'a' });
            await storage.watch('z');
            await storage.zAdd('z', { score: 2, value: 'b' });
            const result = await storage.multi().set('x', '1').exec();
            expect(result).toBeNull();
        });

        test('watch expired key then it appears -> fails', async () => {
            // Watch non-existent key
            await storage.watch('k');
            await storage.set('k', 'v'); // now it exists
            const result = await storage.multi().set('x', '1').exec();
            expect(result).toBeNull();
        });

        test('watch key that expires during transaction', async () => {
            await storage.set('k', 'v', { PX: 1 });
            await storage.watch('k');
            // Wait for expiry
            await new Promise(r => setTimeout(r, 10));
            const result = await storage.multi().set('x', '1').exec();
            // Original value was not null, but now expired -> null !== original -> fail
            expect(result).toBeNull();
        });

        test('unwatch clears watched keys', async () => {
            await storage.set('k', 'v');
            await storage.watch('k');
            await storage.unwatch();
            await storage.set('k', 'v2');
            const result = await storage.multi().set('x', '1').exec();
            expect(result).toEqual(['OK']);
        });

        test('exec with del on expired key', async () => {
            storage.data.set('k', 'v');
            storage.expiries.set('k', Date.now() - 1000);
            const results = await storage.multi().del('k').exec();
            expect(results).toEqual([0]);
        });

        test('exec with sRem', async () => {
            await storage.sAdd('s', 'a', 'b');
            const results = await storage.multi().sRem('s', 'a', 'c').exec();
            expect(results).toEqual([1]);
        });

        test('exec with sRem on expired key', async () => {
            await storage.sAdd('s', 'a');
            storage.expiries.set('s', Date.now() - 1000);
            const results = await storage.multi().sRem('s', 'a').exec();
            expect(results).toEqual([0]);
        });

        test('exec lPush on expired key creates new list', async () => {
            await storage.lPush('l', 'old');
            storage.expiries.set('l', Date.now() - 1000);
            const results = await storage.multi().lPush('l', 'new').exec();
            expect(results).toEqual([1]);
        });

        test('exec lTrim on expired key', async () => {
            await storage.lPush('l', 'a');
            storage.expiries.set('l', Date.now() - 1000);
            const results = await storage.multi().lTrim('l', 0, 0).exec();
            expect(results).toEqual(['OK']);
        });

        test('exec lTrim on non-existent list', async () => {
            const results = await storage.multi().lTrim('nope', 0, 0).exec();
            expect(results).toEqual(['OK']);
        });

        test('exec lTrim with start > stop empties list', async () => {
            await storage.lPush('l', 'a', 'b');
            const results = await storage.multi().lTrim('l', 5, 2).exec();
            expect(results).toEqual(['OK']);
            expect(storage.lists.get('l')).toEqual([]);
        });

        test('exec zAdd on expired key creates new', async () => {
            await storage.zAdd('z', { score: 1, value: 'a' });
            storage.expiries.set('z', Date.now() - 1000);
            const results = await storage.multi().zAdd('z', { score: 2, value: 'b' }).exec();
            expect(results).toEqual([1]);
        });

        test('exec zRemRangeByRank on expired/empty', async () => {
            const results = await storage.multi().zRemRangeByRank('z', 0, -1).exec();
            expect(results).toEqual([0]);

            await storage.zAdd('z', { score: 1, value: 'a' });
            storage.expiries.set('z', Date.now() - 1000);
            const results2 = await storage.multi().zRemRangeByRank('z', 0, -1).exec();
            expect(results2).toEqual([0]);
        });

        test('exec zRemRangeByRank with start > stop', async () => {
            await storage.zAdd('z', { score: 1, value: 'a' });
            const results = await storage.multi().zRemRangeByRank('z', 5, 2).exec();
            expect(results).toEqual([0]);
        });

        test('exec with expire on expired key', async () => {
            storage.data.set('k', 'v');
            storage.expiries.set('k', Date.now() - 1000);
            const results = await storage.multi().expire('k', 100).exec();
            expect(results).toEqual([0]);
        });

        test('exec with expire on non-existent key returns 0', async () => {
            const results = await storage.multi().expire('nope', 100).exec();
            expect(results).toEqual([0]);
        });

        test('exec set with KEEPTTL', async () => {
            await storage.set('k', 'v', { EX: 100 });
            const ttlBefore = storage.expiries.get('k');
            const results = await storage.multi().set('k', 'v2', { KEEPTTL: true }).exec();
            expect(results).toEqual(['OK']);
            expect(storage.expiries.get('k')).toBe(ttlBefore);
        });

        test('exec with sAdd on expired key', async () => {
            await storage.sAdd('s', 'old');
            storage.expiries.set('s', Date.now() - 1000);
            const results = await storage.multi().sAdd('s', 'new').exec();
            expect(results).toEqual([1]);
        });
    });

    // 11. Connection
    describe('connection', () => {
        test('connect sets isOpen and returns this', async () => {
            const s = new MemoryStorage(true);
            const result = await s.connect();
            expect(result).toBe(s);
            expect(s.isOpen).toBe(true);
        });

        test('quit clears interval and handlers', async () => {
            const s = new MemoryStorage();
            s.on('test', () => {});
            await s.quit();
            expect(s.isOpen).toBe(false);
            expect(s.cleanupInterval).toBeNull();
            expect(s._eventHandlers.size).toBe(0);
        });

        test('disconnect calls quit', async () => {
            const s = new MemoryStorage(true);
            const result = await s.disconnect();
            expect(result).toBe('OK');
            expect(s.isOpen).toBe(false);
        });

        test('duplicate returns clone', () => {
            const clone = storage.duplicate();
            expect(clone._isClone).toBe(true);
            expect(clone.data).toBe(storage.data); // shared
        });

        test('ping returns PONG', async () => {
            expect(await storage.ping()).toBe('PONG');
        });
    });

    // 12. Events
    describe('events', () => {
        test('on/emit pattern', () => {
            const cb = jest.fn();
            storage.on('test', cb);
            storage.emit('test', 'arg1', 'arg2');
            expect(cb).toHaveBeenCalledWith('arg1', 'arg2');
        });

        test('emit with no handlers does nothing', () => {
            expect(() => storage.emit('nohandler')).not.toThrow();
        });

        test('emit catches handler errors', () => {
            storage.on('err', () => { throw new Error('boom'); });
            expect(() => storage.emit('err')).not.toThrow();
        });

        test('on("ready") fires immediately via setImmediate', (done) => {
            storage.on('ready', () => {
                done();
            });
        });

        test('on returns this for chaining', () => {
            expect(storage.on('x', () => {})).toBe(storage);
        });

        test('removeListener removes specific callback', () => {
            const cb1 = jest.fn();
            const cb2 = jest.fn();
            storage.on('e', cb1);
            storage.on('e', cb2);
            storage.removeListener('e', cb1);
            storage.emit('e');
            expect(cb1).not.toHaveBeenCalled();
            expect(cb2).toHaveBeenCalled();
        });

        test('removeListener with non-existent handler is safe', () => {
            expect(() => storage.removeListener('nope', () => {})).not.toThrow();
        });

        test('removeAllListeners with event', () => {
            storage.on('e', () => {});
            storage.removeAllListeners('e');
            expect(storage._eventHandlers.has('e')).toBe(false);
        });

        test('removeAllListeners without event clears all', () => {
            storage.on('a', () => {});
            storage.on('b', () => {});
            storage.removeAllListeners();
            expect(storage._eventHandlers.size).toBe(0);
        });
    });

    // 13. Module exports
    describe('module exports', () => {
        test('getMemoryStorage returns singleton', () => {
            const a = getMemoryStorage();
            const b = getMemoryStorage();
            expect(a).toBe(b);
            a.quit();
        });

        test('isMemoryMode checks REDIS_URL', () => {
            const original = process.env.REDIS_URL;
            process.env.REDIS_URL = 'memory';
            expect(isMemoryMode()).toBe(true);
            process.env.REDIS_URL = 'memory://';
            expect(isMemoryMode()).toBe(true);
            process.env.REDIS_URL = 'redis://localhost';
            expect(isMemoryMode()).toBe(false);
            process.env.REDIS_URL = '';
            expect(isMemoryMode()).toBe(false);
            if (original !== undefined) {
                process.env.REDIS_URL = original;
            } else {
                delete process.env.REDIS_URL;
            }
        });
    });
});
