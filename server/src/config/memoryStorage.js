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

// Shared storage across all MemoryStorage instances (for duplicate() support)
let sharedData = null;
let sharedExpiries = null;
let sharedSets = null;
let sharedPubsubChannels = null;

function initializeSharedStorage() {
    if (!sharedData) {
        sharedData = new Map();
        sharedExpiries = new Map();
        sharedSets = new Map();
        sharedPubsubChannels = new Map();
    }
}

class MemoryStorage {
    constructor(isClone = false) {
        initializeSharedStorage();

        // All instances share the same data (simulates Redis behavior)
        this.data = sharedData;
        this.expiries = sharedExpiries;
        this.sets = sharedSets;
        this.pubsubChannels = sharedPubsubChannels;
        this.isOpen = true;
        this._isClone = isClone;
        this._watchedKeys = new Map(); // For transaction support
        this._eventHandlers = new Map(); // For event emitter pattern

        // Periodic cleanup of expired keys (only for primary instance)
        if (!isClone) {
            this.cleanupInterval = setInterval(() => this._cleanupExpired(), 60000);
        }
    }

    /**
     * Clean up expired keys with performance monitoring
     */
    _cleanupExpired() {
        const startTime = Date.now();
        const initialCount = this.expiries.size;
        const now = startTime;
        let cleanedCount = 0;

        for (const [key, expiry] of this.expiries.entries()) {
            if (expiry <= now) {
                this.data.delete(key);
                this.sets.delete(key);
                this.expiries.delete(key);
                cleanedCount++;
            }
        }

        const elapsed = Date.now() - startTime;
        // Log if cleanup took too long or cleaned many keys
        if (elapsed > 50 || cleanedCount > 100) {
            logger.warn(`Memory storage cleanup: ${cleanedCount}/${initialCount} keys in ${elapsed}ms`);
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

    /**
     * Convert glob pattern to regex with proper escaping
     * Escapes regex metacharacters before converting * and ? to regex equivalents
     */
    _globToRegex(pattern) {
        // First escape all regex metacharacters except * and ?
        const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
        // Then convert glob wildcards to regex
        const regexPattern = escaped.replace(/\*/g, '.*').replace(/\?/g, '.');
        return new RegExp('^' + regexPattern + '$');
    }

    // Basic string operations
    async get(key) {
        if (this._isExpired(key)) return null;
        const value = this.data.get(key);
        return value !== undefined ? value : null;
    }

    async set(key, value, options = {}) {
        // Remove from sets map if exists (type change: set -> string)
        this.sets.delete(key);
        this.data.set(key, value);
        if (options.EX) {
            this.expiries.set(key, Date.now() + (options.EX * 1000));
        } else if (options.PX) {
            this.expiries.set(key, Date.now() + options.PX);
        } else if (!options.KEEPTTL) {
            // Redis SET without TTL options removes existing TTL (unless KEEPTTL)
            this.expiries.delete(key);
        }
        return 'OK';
    }

    async del(key) {
        // Check expiry first - expired keys are treated as non-existent
        if (this._isExpired(key)) return 0;
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
        // Check expiry first - can't set expiry on non-existent/expired key
        if (this._isExpired(key)) return 0;
        if (!this.data.has(key) && !this.sets.has(key)) return 0;
        this.expiries.set(key, Date.now() + (seconds * 1000));
        return 1;
    }

    async ttl(key) {
        if (this._isExpired(key)) return -2;
        // Check if key exists - return -2 for non-existent keys
        if (!this.data.has(key) && !this.sets.has(key)) return -2;
        const expiry = this.expiries.get(key);
        if (!expiry) return -1;  // Key exists but no expiry
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
        // Remove from data map if exists (type change: string -> set)
        this.data.delete(key);
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
        // Convert glob pattern to regex with proper escaping
        const regex = this._globToRegex(pattern);
        // Use Set for O(1) deduplication instead of O(n) includes() check
        const resultSet = new Set();

        for (const key of this.data.keys()) {
            if (!this._isExpired(key) && regex.test(key)) {
                resultSet.add(key);
            }
        }
        for (const key of this.sets.keys()) {
            if (!this._isExpired(key) && regex.test(key)) {
                resultSet.add(key);
            }
        }

        return [...resultSet];
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

    // Lua script support - implement the atomic join script logic
    async eval(script, options) {
        // Handle the atomic room join script from roomService.js
        // Script expects: KEYS[1] = playersKey, ARGV[1] = maxPlayers, ARGV[2] = sessionId
        if (options && options.keys && options.keys.length > 0 && options.arguments && options.arguments.length >= 2) {
            const playersKey = options.keys[0];
            const maxPlayers = parseInt(options.arguments[0], 10);
            const sessionId = options.arguments[1];

            // Check for expired key first - treat as empty set
            if (this._isExpired(playersKey)) {
                this.sets.set(playersKey, new Set());
            }

            // Check if already a member
            const existingSet = this.sets.get(playersKey);
            if (existingSet && existingSet.has(sessionId)) {
                return -1; // Already a member
            }

            // Check capacity
            const currentCount = existingSet ? existingSet.size : 0;
            if (currentCount >= maxPlayers) {
                return 0; // Room is full
            }

            // Add to set (remove from data map for type consistency)
            this.data.delete(playersKey);
            if (!this.sets.has(playersKey)) {
                this.sets.set(playersKey, new Set());
            }
            this.sets.get(playersKey).add(sessionId);
            return 1; // Successfully added
        }

        logger.debug('Memory storage eval called with unsupported script');
        return null;
    }

    async evalSha(sha, options) {
        return this.eval(null, options);
    }

    async scriptLoad(_script) {
        // Return a fake SHA - we don't actually use it in memory mode
        return 'memory_mode_sha';
    }

    // Transaction support (optimistic locking)
    async watch(key) {
        // Store the current value hash for comparison during exec
        // Check expiry first - expired keys should be treated as non-existent
        if (this._isExpired(key)) {
            this._watchedKeys.set(key, null);
            return 'OK';
        }
        const value = this.data.get(key);
        // Use explicit undefined check to handle empty string values correctly
        this._watchedKeys.set(key, value !== undefined ? JSON.stringify(value) : null);
        return 'OK';
    }

    async unwatch() {
        this._watchedKeys.clear();
        return 'OK';
    }

    multi() {
        // Return a transaction builder
        const commands = [];
        const storage = this;

        const txn = {
            set: function(key, value, options = {}) {
                commands.push({ cmd: 'set', key, value, options });
                return txn;
            },
            del: function(key) {
                commands.push({ cmd: 'del', key });
                return txn;
            },
            sAdd: function(key, ...members) {
                commands.push({ cmd: 'sAdd', key, members });
                return txn;
            },
            sRem: function(key, ...members) {
                commands.push({ cmd: 'sRem', key, members });
                return txn;
            },
            expire: function(key, seconds) {
                commands.push({ cmd: 'expire', key, seconds });
                return txn;
            },
            exec: async function() {
                // Check if watched keys changed (optimistic locking)
                for (const [key, originalValue] of storage._watchedKeys.entries()) {
                    // Check expiry - expired keys should be treated as non-existent
                    if (storage._isExpired(key)) {
                        if (originalValue !== null) {
                            // Key expired since watch - transaction failed
                            storage._watchedKeys.clear();
                            return null;
                        }
                        continue; // Both null, key still non-existent
                    }
                    const currentValue = storage.data.get(key);
                    // Use explicit undefined check to handle empty string values correctly
                    const currentJson = currentValue !== undefined ? JSON.stringify(currentValue) : null;
                    if (currentJson !== originalValue) {
                        // Key was modified - transaction failed
                        storage._watchedKeys.clear();
                        return null;
                    }
                }

                // Execute all commands
                const results = [];
                for (const cmd of commands) {
                    try {
                        switch (cmd.cmd) {
                            case 'set':
                                // Remove from sets map if exists (type change)
                                storage.sets.delete(cmd.key);
                                storage.data.set(cmd.key, cmd.value);
                                // Handle TTL options (EX = seconds, PX = milliseconds)
                                if (cmd.options && cmd.options.EX) {
                                    storage.expiries.set(cmd.key, Date.now() + (cmd.options.EX * 1000));
                                } else if (cmd.options && cmd.options.PX) {
                                    storage.expiries.set(cmd.key, Date.now() + cmd.options.PX);
                                } else if (!cmd.options || !cmd.options.KEEPTTL) {
                                    // Redis SET without TTL options removes existing TTL
                                    storage.expiries.delete(cmd.key);
                                }
                                results.push('OK');
                                break;
                            case 'del':
                                // Check expiry first (matches regular del behavior)
                                if (storage._isExpired(cmd.key)) {
                                    results.push(0);
                                    break;
                                }
                                const existedData = storage.data.has(cmd.key);
                                const existedSet = storage.sets.has(cmd.key);
                                storage.data.delete(cmd.key);
                                storage.sets.delete(cmd.key);
                                storage.expiries.delete(cmd.key);
                                results.push((existedData || existedSet) ? 1 : 0);
                                break;
                            case 'sAdd':
                                // Check for expired key and clear it (matches regular sAdd behavior)
                                if (storage._isExpired(cmd.key)) {
                                    storage.sets.set(cmd.key, new Set());
                                }
                                // Remove from data map if exists (type change)
                                storage.data.delete(cmd.key);
                                if (!storage.sets.has(cmd.key)) {
                                    storage.sets.set(cmd.key, new Set());
                                }
                                let added = 0;
                                for (const m of cmd.members) {
                                    if (!storage.sets.get(cmd.key).has(m)) {
                                        storage.sets.get(cmd.key).add(m);
                                        added++;
                                    }
                                }
                                results.push(added);
                                break;
                            case 'sRem':
                                // Check for expired key (matches regular sRem behavior)
                                if (storage._isExpired(cmd.key)) {
                                    results.push(0);
                                    break;
                                }
                                const set = storage.sets.get(cmd.key);
                                let removed = 0;
                                if (set) {
                                    for (const m of cmd.members) {
                                        if (set.delete(m)) removed++;
                                    }
                                }
                                results.push(removed);
                                break;
                            case 'expire':
                                // Check expiry first (matches regular expire behavior)
                                if (storage._isExpired(cmd.key)) {
                                    results.push(0);
                                    break;
                                }
                                if (storage.data.has(cmd.key) || storage.sets.has(cmd.key)) {
                                    storage.expiries.set(cmd.key, Date.now() + (cmd.seconds * 1000));
                                    results.push(1);
                                } else {
                                    results.push(0);
                                }
                                break;
                            default:
                                // Unknown command - log and push null for Redis compatibility
                                logger.warn(`Unknown transaction command: ${cmd.cmd}`);
                                results.push(null);
                        }
                    } catch (e) {
                        // Log error for debugging but continue (Redis returns null for failed commands)
                        logger.error(`Transaction command failed: ${cmd.cmd}`, { error: e.message, key: cmd.key });
                        results.push(null);
                    }
                }

                storage._watchedKeys.clear();
                return results;
            }
        };

        return txn;
    }

    // Async iterator for SCAN (used by timerService)
    async *scanIterator(options = {}) {
        const pattern = options.MATCH || '*';
        const regex = this._globToRegex(pattern);

        // Yield keys from data map
        for (const key of this.data.keys()) {
            if (!this._isExpired(key) && regex.test(key)) {
                yield key;
            }
        }

        // Yield keys from sets map
        for (const key of this.sets.keys()) {
            if (!this._isExpired(key) && regex.test(key) && !this.data.has(key)) {
                yield key;
            }
        }
    }

    // Health check
    async ping() {
        return 'PONG';
    }

    // Duplicate for pub/sub clients
    // Returns a new instance that shares data but has independent state
    duplicate() {
        const clone = new MemoryStorage(true);
        return clone;
    }

    // Connection management
    async connect() {
        this.isOpen = true;
        logger.info('Memory storage initialized (single-instance mode)');
        return this;
    }

    async quit() {
        this.isOpen = false;
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
        // SPRINT-15 FIX: Clean up event handlers and pub/sub channels to prevent memory leaks
        // in long-running single-instance deployments
        this._eventHandlers.clear();
        this.pubsubChannels.clear();
        return 'OK';
    }

    async disconnect() {
        return this.quit();
    }

    // Event handlers for compatibility with node-redis client
    on(event, callback) {
        if (!this._eventHandlers.has(event)) {
            this._eventHandlers.set(event, []);
        }
        this._eventHandlers.get(event).push(callback);

        // Immediately call 'ready' callback
        if (event === 'ready') {
            setImmediate(callback);
        }
        return this;
    }

    emit(event, ...args) {
        const handlers = this._eventHandlers.get(event);
        if (handlers) {
            for (const handler of handlers) {
                try {
                    handler(...args);
                } catch (e) {
                    logger.error(`Event handler error for ${event}:`, e);
                }
            }
        }
    }

    removeListener(event, callback) {
        const handlers = this._eventHandlers.get(event);
        if (handlers) {
            const index = handlers.indexOf(callback);
            if (index !== -1) {
                handlers.splice(index, 1);
            }
        }
        return this;
    }

    removeAllListeners(event) {
        if (event) {
            this._eventHandlers.delete(event);
        } else {
            this._eventHandlers.clear();
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
