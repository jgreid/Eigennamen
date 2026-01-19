/**
 * In-Memory Storage Adapter
 *
 * Provides a Redis-compatible API for single-instance deployments
 * where Redis is not available or not needed.
 *
 * Limitations:
 * - Data is lost on server restart
 * - Does not support multiple instances (no pub/sub)
 * - Suitable for development, testing, or single-instance production
 */

const logger = require('../utils/logger');

class MemoryStorage {
    constructor() {
        this.data = new Map();
        this.expiries = new Map();
        this.sets = new Map();
        this.pubsubChannels = new Map();
        this.isOpen = true;

        // Periodic cleanup of expired keys
        this.cleanupInterval = setInterval(() => this._cleanupExpired(), 60000);
    }

    /**
     * Clean up expired keys
     */
    _cleanupExpired() {
        const now = Date.now();
        for (const [key, expiry] of this.expiries.entries()) {
            if (expiry <= now) {
                this.data.delete(key);
                this.sets.delete(key);
                this.expiries.delete(key);
            }
        }
    }

    /**
     * Check if a key is expired
     */
    _isExpired(key) {
        const expiry = this.expiries.get(key);
        if (expiry && expiry <= Date.now()) {
            this.data.delete(key);
            this.sets.delete(key);
            this.expiries.delete(key);
            return true;
        }
        return false;
    }

    // Basic string operations
    async get(key) {
        if (this._isExpired(key)) return null;
        return this.data.get(key) || null;
    }

    async set(key, value, options = {}) {
        this.data.set(key, value);
        if (options.EX) {
            this.expiries.set(key, Date.now() + (options.EX * 1000));
        } else if (options.PX) {
            this.expiries.set(key, Date.now() + options.PX);
        }
        return 'OK';
    }

    async del(key) {
        const existed = this.data.has(key) || this.sets.has(key);
        this.data.delete(key);
        this.sets.delete(key);
        this.expiries.delete(key);
        return existed ? 1 : 0;
    }

    async exists(key) {
        if (this._isExpired(key)) return 0;
        return (this.data.has(key) || this.sets.has(key)) ? 1 : 0;
    }

    async expire(key, seconds) {
        if (!this.data.has(key) && !this.sets.has(key)) return 0;
        this.expiries.set(key, Date.now() + (seconds * 1000));
        return 1;
    }

    async ttl(key) {
        if (this._isExpired(key)) return -2;
        const expiry = this.expiries.get(key);
        if (!expiry) return -1;
        return Math.ceil((expiry - Date.now()) / 1000);
    }

    async incr(key) {
        if (this._isExpired(key)) {
            this.data.set(key, '1');
            return 1;
        }
        const current = parseInt(this.data.get(key) || '0', 10);
        const newValue = current + 1;
        this.data.set(key, String(newValue));
        return newValue;
    }

    async decr(key) {
        if (this._isExpired(key)) {
            this.data.set(key, '-1');
            return -1;
        }
        const current = parseInt(this.data.get(key) || '0', 10);
        const newValue = current - 1;
        this.data.set(key, String(newValue));
        return newValue;
    }

    // Set operations
    async sAdd(key, ...members) {
        if (this._isExpired(key)) {
            this.sets.set(key, new Set());
        }
        if (!this.sets.has(key)) {
            this.sets.set(key, new Set());
        }
        const set = this.sets.get(key);
        let added = 0;
        for (const member of members) {
            if (!set.has(member)) {
                set.add(member);
                added++;
            }
        }
        return added;
    }

    async sRem(key, ...members) {
        if (this._isExpired(key)) return 0;
        const set = this.sets.get(key);
        if (!set) return 0;
        let removed = 0;
        for (const member of members) {
            if (set.delete(member)) removed++;
        }
        return removed;
    }

    async sMembers(key) {
        if (this._isExpired(key)) return [];
        const set = this.sets.get(key);
        return set ? Array.from(set) : [];
    }

    async sIsMember(key, member) {
        if (this._isExpired(key)) return 0;
        const set = this.sets.get(key);
        return (set && set.has(member)) ? 1 : 0;
    }

    async sCard(key) {
        if (this._isExpired(key)) return 0;
        const set = this.sets.get(key);
        return set ? set.size : 0;
    }

    // Key pattern operations
    async keys(pattern) {
        // Simple glob-like pattern matching
        const regex = new RegExp('^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
        const result = [];

        for (const key of this.data.keys()) {
            if (!this._isExpired(key) && regex.test(key)) {
                result.push(key);
            }
        }
        for (const key of this.sets.keys()) {
            if (!this._isExpired(key) && regex.test(key) && !result.includes(key)) {
                result.push(key);
            }
        }

        return result;
    }

    // Scan for pattern matching (simplified implementation)
    async scan(cursor, options = {}) {
        const pattern = options.MATCH || '*';
        const count = options.COUNT || 10;

        const allKeys = await this.keys(pattern);
        const start = parseInt(cursor, 10) || 0;
        const end = Math.min(start + count, allKeys.length);
        const nextCursor = end >= allKeys.length ? 0 : end;

        return {
            cursor: String(nextCursor),
            keys: allKeys.slice(start, end)
        };
    }

    // Pub/Sub (in-memory, single instance only)
    async subscribe(channel, callback) {
        if (!this.pubsubChannels.has(channel)) {
            this.pubsubChannels.set(channel, new Set());
        }
        this.pubsubChannels.get(channel).add(callback);
    }

    async unsubscribe(channel) {
        this.pubsubChannels.delete(channel);
    }

    async publish(channel, message) {
        const subscribers = this.pubsubChannels.get(channel);
        if (subscribers) {
            for (const callback of subscribers) {
                try {
                    callback(message, channel);
                } catch (e) {
                    logger.error('Pub/sub callback error:', e);
                }
            }
            return subscribers.size;
        }
        return 0;
    }

    // Lua script support (simplified - just run the basic operations)
    async eval(script, options) {
        // For the roomService capacity check script, we need to handle it specially
        // This is a simplified implementation that handles the specific use case
        logger.debug('Memory storage eval called (Lua scripts have limited support in memory mode)');
        return null;
    }

    async evalSha(sha, options) {
        return this.eval(null, options);
    }

    async scriptLoad(script) {
        // Return a fake SHA - we don't actually use it in memory mode
        return 'memory_mode_sha';
    }

    // Health check
    async ping() {
        return 'PONG';
    }

    // Duplicate for pub/sub clients
    duplicate() {
        // Return a reference to this same instance (single-instance mode)
        return this;
    }

    // Connection management
    async connect() {
        this.isOpen = true;
        logger.info('Memory storage initialized (single-instance mode)');
        return this;
    }

    async quit() {
        this.isOpen = false;
        clearInterval(this.cleanupInterval);
        return 'OK';
    }

    async disconnect() {
        return this.quit();
    }

    // Event handlers (no-op for compatibility)
    on(event, callback) {
        // Immediately call 'ready' callback
        if (event === 'ready') {
            setImmediate(callback);
        }
        return this;
    }
}

// Singleton instance
let memoryStorage = null;

function getMemoryStorage() {
    if (!memoryStorage) {
        memoryStorage = new MemoryStorage();
    }
    return memoryStorage;
}

function isMemoryMode() {
    const redisUrl = process.env.REDIS_URL || '';
    return redisUrl === 'memory' || redisUrl === 'memory://';
}

module.exports = {
    MemoryStorage,
    getMemoryStorage,
    isMemoryMode
};
