/**
 * LRU Cache Tests
 * Tests for the cache utility module
 */

const {
    LRUCache,
    roomCache,
    playerCache,
    gameCache,
    getAllCacheStats,
    clearAllCaches,
    invalidateRoomCaches
} = require('../utils/cache');

describe('LRUCache', () => {
    let cache;

    beforeEach(() => {
        cache = new LRUCache({ maxSize: 3, defaultTTL: 1000 });
    });

    describe('basic operations', () => {
        it('should set and get a value', () => {
            cache.set('key1', 'value1');
            expect(cache.get('key1')).toBe('value1');
        });

        it('should return undefined for missing keys', () => {
            expect(cache.get('nonexistent')).toBeUndefined();
        });

        it('should delete a value', () => {
            cache.set('key1', 'value1');
            cache.delete('key1');
            expect(cache.get('key1')).toBeUndefined();
        });

        it('should clear all values', () => {
            cache.set('key1', 'value1');
            cache.set('key2', 'value2');
            cache.clear();
            expect(cache.get('key1')).toBeUndefined();
            expect(cache.get('key2')).toBeUndefined();
        });

        it('should handle various value types', () => {
            // Use a larger cache for this test
            const largeCache = new LRUCache({ maxSize: 10, defaultTTL: 1000 });
            largeCache.set('string', 'hello');
            largeCache.set('number', 42);
            largeCache.set('object', { foo: 'bar' });
            largeCache.set('array', [1, 2, 3]);
            largeCache.set('null', null);

            expect(largeCache.get('string')).toBe('hello');
            expect(largeCache.get('number')).toBe(42);
            expect(largeCache.get('object')).toEqual({ foo: 'bar' });
            expect(largeCache.get('array')).toEqual([1, 2, 3]);
            expect(largeCache.get('null')).toBeNull();
        });
    });

    describe('LRU eviction', () => {
        it('should evict oldest entry when at capacity', () => {
            cache.set('key1', 'value1');
            cache.set('key2', 'value2');
            cache.set('key3', 'value3');
            // Cache is now full (maxSize: 3)

            cache.set('key4', 'value4'); // This should evict key1

            expect(cache.get('key1')).toBeUndefined();
            expect(cache.get('key2')).toBe('value2');
            expect(cache.get('key3')).toBe('value3');
            expect(cache.get('key4')).toBe('value4');
        });

        it('should update access order on get', () => {
            cache.set('key1', 'value1');
            cache.set('key2', 'value2');
            cache.set('key3', 'value3');

            // Access key1, making key2 the oldest
            cache.get('key1');

            cache.set('key4', 'value4'); // Should evict key2

            expect(cache.get('key1')).toBe('value1');
            expect(cache.get('key2')).toBeUndefined();
            expect(cache.get('key3')).toBe('value3');
            expect(cache.get('key4')).toBe('value4');
        });

        it('should evict multiple entries if needed', () => {
            const smallCache = new LRUCache({ maxSize: 2, defaultTTL: 1000 });
            smallCache.set('key1', 'value1');
            smallCache.set('key2', 'value2');
            smallCache.set('key3', 'value3');

            expect(smallCache.get('key1')).toBeUndefined();
            expect(smallCache.get('key2')).toBe('value2');
            expect(smallCache.get('key3')).toBe('value3');
        });
    });

    describe('TTL expiration', () => {
        beforeEach(() => {
            jest.useFakeTimers();
        });

        afterEach(() => {
            jest.useRealTimers();
        });

        it('should return value before TTL expires', () => {
            cache.set('key1', 'value1', 5000);
            jest.advanceTimersByTime(4000);
            expect(cache.get('key1')).toBe('value1');
        });

        it('should return undefined after TTL expires', () => {
            cache.set('key1', 'value1', 1000);
            jest.advanceTimersByTime(1001);
            expect(cache.get('key1')).toBeUndefined();
        });

        it('should use default TTL when not specified', () => {
            cache.set('key1', 'value1');
            jest.advanceTimersByTime(999);
            expect(cache.get('key1')).toBe('value1');
            jest.advanceTimersByTime(2);
            expect(cache.get('key1')).toBeUndefined();
        });

        it('should delete expired entries from cache', () => {
            cache.set('key1', 'value1', 1000);
            jest.advanceTimersByTime(1001);
            cache.get('key1'); // This should delete the entry
            expect(cache.cache.has('key1')).toBe(false);
        });
    });

    describe('invalidatePattern', () => {
        it('should invalidate keys matching pattern', () => {
            cache.set('room:123:data', 'data1');
            cache.set('room:123:players', 'players1');
            cache.set('room:456:data', 'data2');
            cache.set('other:key', 'other');

            cache.invalidatePattern('room:123');

            expect(cache.get('room:123:data')).toBeUndefined();
            expect(cache.get('room:123:players')).toBeUndefined();
            expect(cache.get('room:456:data')).toBe('data2');
            expect(cache.get('other:key')).toBe('other');
        });

        it('should handle empty pattern', () => {
            cache.set('key1', 'value1');
            cache.invalidatePattern('');
            expect(cache.get('key1')).toBeUndefined(); // Empty string matches all
        });

        it('should handle no matches', () => {
            cache.set('key1', 'value1');
            cache.invalidatePattern('nonexistent');
            expect(cache.get('key1')).toBe('value1');
        });
    });

    describe('getOrSet', () => {
        it('should return cached value if present', async () => {
            cache.set('key1', 'cached-value');
            const factory = jest.fn().mockResolvedValue('new-value');

            const result = await cache.getOrSet('key1', factory);

            expect(result).toBe('cached-value');
            expect(factory).not.toHaveBeenCalled();
        });

        it('should call factory and cache result if not present', async () => {
            const factory = jest.fn().mockResolvedValue('new-value');

            const result = await cache.getOrSet('key1', factory);

            expect(result).toBe('new-value');
            expect(factory).toHaveBeenCalled();
            expect(cache.get('key1')).toBe('new-value');
        });

        it('should use custom TTL', async () => {
            jest.useFakeTimers();
            const factory = jest.fn().mockResolvedValue('new-value');

            await cache.getOrSet('key1', factory, 500);

            jest.advanceTimersByTime(400);
            expect(cache.get('key1')).toBe('new-value');

            jest.advanceTimersByTime(200);
            expect(cache.get('key1')).toBeUndefined();

            jest.useRealTimers();
        });

        it('should handle async factory errors', async () => {
            const factory = jest.fn().mockRejectedValue(new Error('Factory error'));

            await expect(cache.getOrSet('key1', factory)).rejects.toThrow('Factory error');
        });
    });

    describe('statistics', () => {
        it('should track hits and misses', () => {
            cache.set('key1', 'value1');

            cache.get('key1'); // hit
            cache.get('key1'); // hit
            cache.get('nonexistent'); // miss
            cache.get('nonexistent'); // miss
            cache.get('nonexistent'); // miss

            const stats = cache.getStats();
            expect(stats.hits).toBe(2);
            expect(stats.misses).toBe(3);
            expect(stats.hitRate).toBe('40.00%');
        });

        it('should track cache size', () => {
            cache.set('key1', 'value1');
            cache.set('key2', 'value2');

            const stats = cache.getStats();
            expect(stats.size).toBe(2);
            expect(stats.maxSize).toBe(3);
        });

        it('should reset statistics', () => {
            cache.set('key1', 'value1');
            cache.get('key1');
            cache.get('nonexistent');

            cache.resetStats();

            const stats = cache.getStats();
            expect(stats.hits).toBe(0);
            expect(stats.misses).toBe(0);
            expect(stats.hitRate).toBe('0%');
        });

        it('should handle zero total accesses', () => {
            const stats = cache.getStats();
            expect(stats.hitRate).toBe('0%');
        });

        it('should count expired entry access as miss', () => {
            jest.useFakeTimers();
            cache.set('key1', 'value1', 100);
            jest.advanceTimersByTime(200);
            cache.get('key1'); // Should be a miss

            const stats = cache.getStats();
            expect(stats.misses).toBe(1);
            expect(stats.hits).toBe(0);
            jest.useRealTimers();
        });
    });

    describe('default options', () => {
        it('should use default maxSize', () => {
            const defaultCache = new LRUCache();
            expect(defaultCache.maxSize).toBe(1000);
        });

        it('should use default TTL', () => {
            const defaultCache = new LRUCache();
            expect(defaultCache.defaultTTL).toBe(5000);
        });
    });
});

describe('Singleton caches', () => {
    beforeEach(() => {
        clearAllCaches();
    });

    it('should have separate caches for different data types', () => {
        roomCache.set('test', 'room-data');
        playerCache.set('test', 'player-data');
        gameCache.set('test', 'game-data');

        expect(roomCache.get('test')).toBe('room-data');
        expect(playerCache.get('test')).toBe('player-data');
        expect(gameCache.get('test')).toBe('game-data');
    });

    it('should get all cache stats', () => {
        roomCache.set('room1', 'data');
        playerCache.set('player1', 'data');
        gameCache.set('game1', 'data');

        const stats = getAllCacheStats();

        expect(stats.room.size).toBe(1);
        expect(stats.player.size).toBe(1);
        expect(stats.game.size).toBe(1);
    });

    it('should clear all caches', () => {
        roomCache.set('room1', 'data');
        playerCache.set('player1', 'data');
        gameCache.set('game1', 'data');

        clearAllCaches();

        expect(roomCache.get('room1')).toBeUndefined();
        expect(playerCache.get('player1')).toBeUndefined();
        expect(gameCache.get('game1')).toBeUndefined();
    });

    it('should invalidate room-related caches', () => {
        roomCache.set('room:TEST01', 'room-data');
        playerCache.set('players:TEST01:list', 'player-list');
        playerCache.set('players:TEST01:count', 5);
        playerCache.set('players:OTHER:list', 'other-list');
        gameCache.set('game:TEST01', 'game-data');
        gameCache.set('game:OTHER', 'other-game');

        invalidateRoomCaches('TEST01');

        expect(roomCache.get('room:TEST01')).toBeUndefined();
        expect(playerCache.get('players:TEST01:list')).toBeUndefined();
        expect(playerCache.get('players:TEST01:count')).toBeUndefined();
        expect(playerCache.get('players:OTHER:list')).toBe('other-list');
        expect(gameCache.get('game:TEST01')).toBeUndefined();
        expect(gameCache.get('game:OTHER')).toBe('other-game');
    });
});
