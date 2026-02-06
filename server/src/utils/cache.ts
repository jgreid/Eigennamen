/**
 * Simple LRU Cache for frequently accessed data (US-16.4)
 *
 * Provides a lightweight in-memory cache with:
 * - LRU eviction when capacity is reached
 * - TTL-based expiration
 * - Optional stale-while-revalidate pattern
 */

const logger = require('./logger');

/**
 * Cache entry interface
 */
interface CacheEntry<T> {
    value: T;
    expiresAt: number;
    createdAt: number;
}

/**
 * Cache statistics interface
 */
interface CacheStats {
    size: number;
    maxSize: number;
    hits: number;
    misses: number;
    hitRate: string;
}

/**
 * LRU Cache options
 */
interface LRUCacheOptions {
    maxSize?: number;
    defaultTTL?: number;
}

/**
 * Factory function type for getOrSet
 */
type CacheFactory<T> = () => Promise<T>;

class LRUCache<T = unknown> {
    private maxSize: number;
    private defaultTTL: number;
    private cache: Map<string, CacheEntry<T>>;
    private hits: number;
    private misses: number;

    constructor(options: LRUCacheOptions = {}) {
        this.maxSize = options.maxSize || 1000;
        this.defaultTTL = options.defaultTTL || 5000; // 5 seconds default
        this.cache = new Map();
        this.hits = 0;
        this.misses = 0;
    }

    /**
     * Get a value from the cache
     * @param key - Cache key
     * @returns Cached value or undefined
     */
    get(key: string): T | undefined {
        const entry = this.cache.get(key);

        if (!entry) {
            this.misses++;
            return undefined;
        }

        // Check if expired
        if (Date.now() > entry.expiresAt) {
            this.cache.delete(key);
            this.misses++;
            return undefined;
        }

        // Move to end for LRU (delete and re-add)
        this.cache.delete(key);
        this.cache.set(key, entry);

        this.hits++;
        return entry.value;
    }

    /**
     * Set a value in the cache
     * @param key - Cache key
     * @param value - Value to cache
     * @param ttl - Time-to-live in milliseconds (optional)
     */
    set(key: string, value: T, ttl: number = this.defaultTTL): void {
        // Evict oldest entries if at capacity
        while (this.cache.size >= this.maxSize) {
            const oldestKey = this.cache.keys().next().value;
            if (oldestKey !== undefined) {
                this.cache.delete(oldestKey);
            }
        }

        this.cache.set(key, {
            value,
            expiresAt: Date.now() + ttl,
            createdAt: Date.now()
        });
    }

    /**
     * Delete a value from the cache
     * @param key - Cache key
     */
    delete(key: string): void {
        this.cache.delete(key);
    }

    /**
     * Clear all entries from the cache
     */
    clear(): void {
        this.cache.clear();
    }

    /**
     * Invalidate all entries matching a pattern
     * @param pattern - Pattern to match (simple startsWith)
     */
    invalidatePattern(pattern: string): void {
        for (const key of this.cache.keys()) {
            if (key.startsWith(pattern)) {
                this.cache.delete(key);
            }
        }
    }

    /**
     * Get or set a value with a factory function
     * @param key - Cache key
     * @param factory - Function to generate value if not cached
     * @param ttl - TTL in milliseconds
     * @returns Cached or newly generated value
     */
    async getOrSet(key: string, factory: CacheFactory<T>, ttl: number = this.defaultTTL): Promise<T> {
        const cached = this.get(key);
        if (cached !== undefined) {
            return cached;
        }

        const value = await factory();
        this.set(key, value, ttl);
        return value;
    }

    /**
     * Get cache statistics
     * @returns Cache stats
     */
    getStats(): CacheStats {
        const total = this.hits + this.misses;
        return {
            size: this.cache.size,
            maxSize: this.maxSize,
            hits: this.hits,
            misses: this.misses,
            hitRate: total > 0 ? ((this.hits / total) * 100).toFixed(2) + '%' : '0%'
        };
    }

    /**
     * Reset statistics
     */
    resetStats(): void {
        this.hits = 0;
        this.misses = 0;
    }
}

/**
 * All cache stats interface
 */
interface AllCacheStats {
    room: CacheStats;
    player: CacheStats;
    game: CacheStats;
}

// Singleton caches for different data types
const roomCache = new LRUCache({
    maxSize: 500,
    defaultTTL: 2000 // 2 seconds for room data
});

const playerCache = new LRUCache({
    maxSize: 2000,
    defaultTTL: 1000 // 1 second for player data
});

const gameCache = new LRUCache({
    maxSize: 500,
    defaultTTL: 500 // 500ms for game data (frequently changing)
});

/**
 * Get all cache stats
 */
function getAllCacheStats(): AllCacheStats {
    return {
        room: roomCache.getStats(),
        player: playerCache.getStats(),
        game: gameCache.getStats()
    };
}

/**
 * Clear all caches
 */
function clearAllCaches(): void {
    roomCache.clear();
    playerCache.clear();
    gameCache.clear();
    logger.debug('All caches cleared');
}

/**
 * Invalidate caches for a specific room
 */
function invalidateRoomCaches(roomCode: string): void {
    roomCache.delete(`room:${roomCode}`);
    playerCache.invalidatePattern(`players:${roomCode}`);
    gameCache.delete(`game:${roomCode}`);
}

module.exports = {
    LRUCache,
    roomCache,
    playerCache,
    gameCache,
    getAllCacheStats,
    clearAllCaches,
    invalidateRoomCaches
};

// ES6 exports for TypeScript imports
export {
    LRUCache,
    roomCache,
    playerCache,
    gameCache,
    getAllCacheStats,
    clearAllCaches,
    invalidateRoomCaches
};

export type { CacheEntry, CacheStats, LRUCacheOptions, CacheFactory, AllCacheStats };
