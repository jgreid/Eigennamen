/**
 * Simple LRU Cache for frequently accessed data (US-16.4)
 *
 * Provides a lightweight in-memory cache with:
 * - LRU eviction when capacity is reached
 * - TTL-based expiration
 * - Optional stale-while-revalidate pattern
 */

const logger = require('./logger');

class LRUCache {
    constructor(options = {}) {
        this.maxSize = options.maxSize || 1000;
        this.defaultTTL = options.defaultTTL || 5000; // 5 seconds default
        this.cache = new Map();
        this.hits = 0;
        this.misses = 0;
    }

    /**
     * Get a value from the cache
     * @param {string} key - Cache key
     * @returns {*} Cached value or undefined
     */
    get(key) {
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
     * @param {string} key - Cache key
     * @param {*} value - Value to cache
     * @param {number} ttl - Time-to-live in milliseconds (optional)
     */
    set(key, value, ttl = this.defaultTTL) {
        // Evict oldest entries if at capacity
        while (this.cache.size >= this.maxSize) {
            const oldestKey = this.cache.keys().next().value;
            this.cache.delete(oldestKey);
        }

        this.cache.set(key, {
            value,
            expiresAt: Date.now() + ttl,
            createdAt: Date.now()
        });
    }

    /**
     * Delete a value from the cache
     * @param {string} key - Cache key
     */
    delete(key) {
        this.cache.delete(key);
    }

    /**
     * Clear all entries from the cache
     */
    clear() {
        this.cache.clear();
    }

    /**
     * Invalidate all entries matching a pattern
     * @param {string} pattern - Pattern to match (simple startsWith)
     */
    invalidatePattern(pattern) {
        for (const key of this.cache.keys()) {
            if (key.startsWith(pattern)) {
                this.cache.delete(key);
            }
        }
    }

    /**
     * Get or set a value with a factory function
     * @param {string} key - Cache key
     * @param {Function} factory - Function to generate value if not cached
     * @param {number} ttl - TTL in milliseconds
     * @returns {Promise<*>} Cached or newly generated value
     */
    async getOrSet(key, factory, ttl = this.defaultTTL) {
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
     * @returns {Object} Cache stats
     */
    getStats() {
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
    resetStats() {
        this.hits = 0;
        this.misses = 0;
    }
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
function getAllCacheStats() {
    return {
        room: roomCache.getStats(),
        player: playerCache.getStats(),
        game: gameCache.getStats()
    };
}

/**
 * Clear all caches
 */
function clearAllCaches() {
    roomCache.clear();
    playerCache.clear();
    gameCache.clear();
    logger.debug('All caches cleared');
}

/**
 * Invalidate caches for a specific room
 */
function invalidateRoomCaches(roomCode) {
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
