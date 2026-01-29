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
let sharedLists = null;
let sharedSortedSets = null;
let sharedPubsubChannels = null;

function initializeSharedStorage() {
    if (!sharedData) {
        sharedData = new Map();
        sharedExpiries = new Map();
        sharedSets = new Map();
        sharedLists = new Map();
        sharedSortedSets = new Map();
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
        this.lists = sharedLists;
        this.sortedSets = sharedSortedSets;
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
                this.lists.delete(key);
                this.sortedSets.delete(key);
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
            this.lists.delete(key);
            this.sortedSets.delete(key);
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
        // FIX: Remove from all type-specific maps on type change (set -> string)
        this.sets.delete(key);
        this.lists.delete(key);
        this.sortedSets.delete(key);
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
        const existed = this.data.has(key) || this.sets.has(key) ||
            this.lists.has(key) || this.sortedSets.has(key);
        this.data.delete(key);
        this.sets.delete(key);
        this.lists.delete(key);
        this.sortedSets.delete(key);
        this.expiries.delete(key);
        return existed ? 1 : 0;
    }

    async exists(key) {
        if (this._isExpired(key)) return 0;
        return (this.data.has(key) || this.sets.has(key) ||
            this.lists.has(key) || this.sortedSets.has(key)) ? 1 : 0;
    }

    async expire(key, seconds) {
        // Check expiry first - can't set expiry on non-existent/expired key
        if (this._isExpired(key)) return 0;
        if (!this.data.has(key) && !this.sets.has(key) &&
            !this.lists.has(key) && !this.sortedSets.has(key)) return 0;
        this.expiries.set(key, Date.now() + (seconds * 1000));
        return 1;
    }

    async ttl(key) {
        if (this._isExpired(key)) return -2;
        // Check if key exists - return -2 for non-existent keys
        if (!this.data.has(key) && !this.sets.has(key) &&
            !this.lists.has(key) && !this.sortedSets.has(key)) return -2;
        const expiry = this.expiries.get(key);
        if (!expiry) return -1;  // Key exists but no expiry
        return Math.ceil((expiry - Date.now()) / 1000);
    }

    async incr(key) {
        if (this._isExpired(key)) {
            this.data.set(key, '1');
            return 1;
        }
        // FIX: Check for type conflicts - Redis INCR fails on Sets/Lists/Sorted Sets
        if (this.sets.has(key) || this.lists.has(key) || this.sortedSets.has(key)) {
            throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
        }
        const current = parseInt(this.data.get(key) || '0', 10);
        // FIX: Validate parsed value is a number to prevent NaN corruption
        if (isNaN(current)) {
            throw new Error('ERR value is not an integer or out of range');
        }
        const newValue = current + 1;
        this.data.set(key, String(newValue));
        return newValue;
    }

    async decr(key) {
        if (this._isExpired(key)) {
            this.data.set(key, '-1');
            return -1;
        }
        // FIX: Check for type conflicts - Redis DECR fails on Sets/Lists/Sorted Sets
        if (this.sets.has(key) || this.lists.has(key) || this.sortedSets.has(key)) {
            throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
        }
        const current = parseInt(this.data.get(key) || '0', 10);
        // FIX: Validate parsed value is a number to prevent NaN corruption
        if (isNaN(current)) {
            throw new Error('ERR value is not an integer or out of range');
        }
        const newValue = current - 1;
        this.data.set(key, String(newValue));
        return newValue;
    }

    // Set operations
    async sAdd(key, ...members) {
        if (this._isExpired(key)) {
            this.sets.set(key, new Set());
        }
        // FIX: Remove from all incompatible data structures (type change: string/list/zset -> set)
        this.data.delete(key);
        this.lists.delete(key);
        this.sortedSets.delete(key);
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

    // Batch operations
    async mGet(keys) {
        const results = [];
        for (const key of keys) {
            if (this._isExpired(key)) {
                results.push(null);
            } else {
                const value = this.data.get(key);
                results.push(value !== undefined ? value : null);
            }
        }
        return results;
    }

    // List operations
    async lPush(key, ...values) {
        if (this._isExpired(key)) {
            this.lists.set(key, []);
        }
        // Remove from other data structures (type change)
        this.data.delete(key);
        this.sets.delete(key);
        this.sortedSets.delete(key);

        if (!this.lists.has(key)) {
            this.lists.set(key, []);
        }
        const list = this.lists.get(key);
        // lPush adds to the head (beginning) of the list
        // Redis LPUSH pushes elements one by one in order given,
        // so 'LPUSH key a b c' results in [c, b, a] (c at head)
        for (const value of values) {
            list.unshift(value);
        }
        return list.length;
    }

    async lRange(key, start, stop) {
        if (this._isExpired(key)) return [];
        const list = this.lists.get(key);
        if (!list || list.length === 0) return [];

        const len = list.length;
        // Handle negative indices
        const startIdx = start < 0 ? Math.max(len + start, 0) : Math.min(start, len);
        const stopIdx = stop < 0 ? len + stop : Math.min(stop, len - 1);

        if (startIdx > stopIdx) return [];
        return list.slice(startIdx, stopIdx + 1);
    }

    async lIndex(key, index) {
        if (this._isExpired(key)) return null;
        const list = this.lists.get(key);
        if (!list) return null;

        const len = list.length;
        // Handle negative index
        const idx = index < 0 ? len + index : index;
        if (idx < 0 || idx >= len) return null;
        return list[idx];
    }

    async lLen(key) {
        if (this._isExpired(key)) return 0;
        const list = this.lists.get(key);
        return list ? list.length : 0;
    }

    async lTrim(key, start, stop) {
        if (this._isExpired(key)) return 'OK';
        const list = this.lists.get(key);
        if (!list) return 'OK';

        const len = list.length;
        // Handle negative indices
        const startIdx = start < 0 ? Math.max(len + start, 0) : Math.min(start, len);
        const stopIdx = stop < 0 ? len + stop : Math.min(stop, len - 1);

        if (startIdx > stopIdx) {
            this.lists.set(key, []);
        } else {
            this.lists.set(key, list.slice(startIdx, stopIdx + 1));
        }
        return 'OK';
    }

    // Sorted set operations
    async zAdd(key, ...items) {
        if (this._isExpired(key)) {
            this.sortedSets.set(key, new Map());
        }
        // Remove from other data structures (type change)
        this.data.delete(key);
        this.sets.delete(key);
        this.lists.delete(key);

        if (!this.sortedSets.has(key)) {
            this.sortedSets.set(key, new Map());
        }
        const zset = this.sortedSets.get(key);
        let added = 0;

        for (const item of items) {
            const { score, value } = item;
            if (!zset.has(value)) {
                added++;
            }
            zset.set(value, score);
        }
        return added;
    }

    async zRange(key, start, stop, options = {}) {
        if (this._isExpired(key)) return [];
        const zset = this.sortedSets.get(key);
        if (!zset || zset.size === 0) return [];

        // Convert to array and sort by score
        const entries = Array.from(zset.entries()).map(([value, score]) => ({ value, score }));
        entries.sort((a, b) => a.score - b.score);

        // Handle REV option (reverse order)
        if (options.REV) {
            entries.reverse();
        }

        const len = entries.length;
        // Handle negative indices
        const startIdx = start < 0 ? Math.max(len + start, 0) : Math.min(start, len);
        const stopIdx = stop < 0 ? len + stop : Math.min(stop, len - 1);

        if (startIdx > stopIdx) return [];
        const slice = entries.slice(startIdx, stopIdx + 1);

        // Handle WITHSCORES option
        if (options.WITHSCORES) {
            const result = [];
            for (const entry of slice) {
                result.push({ value: entry.value, score: entry.score });
            }
            return result;
        }

        return slice.map(e => e.value);
    }

    async zRangeByScore(key, min, max, options = {}) {
        if (this._isExpired(key)) return [];
        const zset = this.sortedSets.get(key);
        if (!zset || zset.size === 0) return [];

        // Convert to array and sort by score
        let entries = Array.from(zset.entries())
            .map(([value, score]) => ({ value, score }))
            .filter(e => e.score >= min && e.score <= max)
            .sort((a, b) => a.score - b.score);

        // Handle LIMIT option
        if (options.LIMIT) {
            const { offset, count } = options.LIMIT;
            entries = entries.slice(offset, offset + count);
        }

        return entries.map(e => e.value);
    }

    async zRem(key, ...members) {
        if (this._isExpired(key)) return 0;
        const zset = this.sortedSets.get(key);
        if (!zset) return 0;

        let removed = 0;
        for (const member of members) {
            if (zset.delete(member)) {
                removed++;
            }
        }
        return removed;
    }

    async zCard(key) {
        if (this._isExpired(key)) return 0;
        const zset = this.sortedSets.get(key);
        return zset ? zset.size : 0;
    }

    async zRemRangeByRank(key, start, stop) {
        if (this._isExpired(key)) return 0;
        const zset = this.sortedSets.get(key);
        if (!zset || zset.size === 0) return 0;

        // Convert to array and sort by score
        const entries = Array.from(zset.entries())
            .map(([value, score]) => ({ value, score }))
            .sort((a, b) => a.score - b.score);

        const len = entries.length;
        // Handle negative indices
        const startIdx = start < 0 ? Math.max(len + start, 0) : Math.min(start, len);
        const stopIdx = stop < 0 ? len + stop : Math.min(stop, len - 1);

        if (startIdx > stopIdx) return 0;

        const toRemove = entries.slice(startIdx, stopIdx + 1);
        for (const entry of toRemove) {
            zset.delete(entry.value);
        }
        return toRemove.length;
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
        for (const key of this.lists.keys()) {
            if (!this._isExpired(key) && regex.test(key)) {
                resultSet.add(key);
            }
        }
        for (const key of this.sortedSets.keys()) {
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

    // Lua script support - implement atomic room operations
    async eval(script, options) {
        if (!options || !options.keys || options.keys.length === 0) {
            logger.debug('Memory storage eval called with no keys');
            return null;
        }

        // Detect script type based on keys and arguments pattern
        const numKeys = options.keys.length;
        const numArgs = options.arguments ? options.arguments.length : 0;

        // Room CREATE script: 2 keys (roomKey, playersKey), 2 args (roomData, ttl)
        if (numKeys === 2 && numArgs === 2) {
            const roomKey = options.keys[0];
            const playersKey = options.keys[1];
            const roomData = options.arguments[0];
            const ttl = parseInt(options.arguments[1], 10);

            // Check if room already exists (SETNX behavior)
            if (this.data.has(roomKey) && !this._isExpired(roomKey)) {
                return 0; // Room already exists
            }

            // Create the room
            this.data.set(roomKey, roomData);
            this.expiries.set(roomKey, Date.now() + (ttl * 1000));

            // Initialize empty players set
            this.sets.delete(playersKey);
            this.sets.set(playersKey, new Set());
            this.expiries.set(playersKey, Date.now() + (ttl * 1000));

            return 1; // Successfully created
        }

        // Room JOIN script: 1 key (playersKey), 2 args (maxPlayers, sessionId)
        if (numKeys === 1 && numArgs === 2) {
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

        // FIX C3: Timer CLAIM script: 1 key (timerKey), 2 args (instanceId, newOwnerTTL)
        // Detects pattern: KEYS[1]=timer:*, ARGV[1]=instanceId, ARGV[2]=TTL
        if (numKeys === 1 && numArgs === 2 && options.keys[0].startsWith('timer:')) {
            const timerKey = options.keys[0];
            const instanceId = options.arguments[0];
            const ownerTTL = parseInt(options.arguments[1], 10);

            // Check if timer exists
            if (this._isExpired(timerKey) || !this.data.has(timerKey)) {
                return null; // Timer doesn't exist
            }

            try {
                const timerData = JSON.parse(this.data.get(timerKey));

                // Check if timer is orphaned (no owner or different owner)
                if (!timerData.ownerId || timerData.ownerId !== instanceId) {
                    // Claim the timer
                    timerData.ownerId = instanceId;
                    this.data.set(timerKey, JSON.stringify(timerData));
                    // Refresh TTL
                    if (ownerTTL > 0) {
                        this.expiries.set(timerKey, Date.now() + (ownerTTL * 1000));
                    }
                    return JSON.stringify(timerData);
                }

                return null; // Already owned by this instance
            } catch (e) {
                logger.error('Timer claim script parse error:', e.message);
                return null;
            }
        }

        // FIX C3: Timer ADD TIME script: 1 key (timerKey), 1 arg (secondsToAdd)
        if (numKeys === 1 && numArgs === 1 && options.keys[0].startsWith('timer:')) {
            const timerKey = options.keys[0];
            const secondsToAdd = parseInt(options.arguments[0], 10);

            // Check if timer exists
            if (this._isExpired(timerKey) || !this.data.has(timerKey)) {
                return null; // Timer doesn't exist
            }

            try {
                const timerData = JSON.parse(this.data.get(timerKey));

                // Add time to the timer
                const now = Date.now();
                const currentRemaining = Math.max(0, timerData.endTime - now);
                const newEndTime = now + currentRemaining + (secondsToAdd * 1000);

                timerData.endTime = newEndTime;
                timerData.duration = timerData.duration + secondsToAdd;
                timerData.remainingSeconds = Math.ceil((newEndTime - now) / 1000);

                this.data.set(timerKey, JSON.stringify(timerData));

                return JSON.stringify(timerData);
            } catch (e) {
                logger.error('Timer add time script parse error:', e.message);
                return null;
            }
        }

        // FIX C3: Generic timer GET with update: 1 key (timerKey), 0 args
        // Used for timer status checks
        if (numKeys === 1 && numArgs === 0 && options.keys[0].startsWith('timer:')) {
            const timerKey = options.keys[0];

            if (this._isExpired(timerKey) || !this.data.has(timerKey)) {
                return null;
            }

            return this.data.get(timerKey);
        }

        logger.debug('Memory storage eval called with unsupported script pattern', {
            numKeys, numArgs, firstKey: options.keys[0]
        });
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
        // FIX: Check all data structures, not just data map
        // This allows watching Sets, Lists, and Sorted Sets correctly
        let watchValue = null;
        if (this.data.has(key)) {
            watchValue = JSON.stringify(this.data.get(key));
        } else if (this.sets.has(key)) {
            watchValue = JSON.stringify([...this.sets.get(key)].sort());
        } else if (this.lists.has(key)) {
            watchValue = JSON.stringify(this.lists.get(key));
        } else if (this.sortedSets.has(key)) {
            const zset = this.sortedSets.get(key);
            watchValue = JSON.stringify([...zset.entries()].sort());
        }
        this._watchedKeys.set(key, watchValue);
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
            lPush: function(key, ...values) {
                commands.push({ cmd: 'lPush', key, values });
                return txn;
            },
            lTrim: function(key, start, stop) {
                commands.push({ cmd: 'lTrim', key, start, stop });
                return txn;
            },
            zAdd: function(key, ...items) {
                commands.push({ cmd: 'zAdd', key, items });
                return txn;
            },
            zRemRangeByRank: function(key, start, stop) {
                commands.push({ cmd: 'zRemRangeByRank', key, start, stop });
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
                    // FIX: Check all data structures when validating watched keys
                    let currentJson = null;
                    if (storage.data.has(key)) {
                        currentJson = JSON.stringify(storage.data.get(key));
                    } else if (storage.sets.has(key)) {
                        currentJson = JSON.stringify([...storage.sets.get(key)].sort());
                    } else if (storage.lists.has(key)) {
                        currentJson = JSON.stringify(storage.lists.get(key));
                    } else if (storage.sortedSets.has(key)) {
                        const zset = storage.sortedSets.get(key);
                        currentJson = JSON.stringify([...zset.entries()].sort());
                    }
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
                                // FIX: Remove from all type-specific maps (type change)
                                storage.sets.delete(cmd.key);
                                storage.lists.delete(cmd.key);
                                storage.sortedSets.delete(cmd.key);
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
                                const existedList = storage.lists.has(cmd.key);
                                const existedZset = storage.sortedSets.has(cmd.key);
                                storage.data.delete(cmd.key);
                                storage.sets.delete(cmd.key);
                                storage.lists.delete(cmd.key);
                                storage.sortedSets.delete(cmd.key);
                                storage.expiries.delete(cmd.key);
                                results.push((existedData || existedSet || existedList || existedZset) ? 1 : 0);
                                break;
                            case 'sAdd':
                                // Check for expired key and clear it (matches regular sAdd behavior)
                                if (storage._isExpired(cmd.key)) {
                                    storage.sets.set(cmd.key, new Set());
                                }
                                // FIX: Remove from all incompatible data structures (type change)
                                storage.data.delete(cmd.key);
                                storage.lists.delete(cmd.key);
                                storage.sortedSets.delete(cmd.key);
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
                                if (storage.data.has(cmd.key) || storage.sets.has(cmd.key) ||
                                    storage.lists.has(cmd.key) || storage.sortedSets.has(cmd.key)) {
                                    storage.expiries.set(cmd.key, Date.now() + (cmd.seconds * 1000));
                                    results.push(1);
                                } else {
                                    results.push(0);
                                }
                                break;
                            case 'lPush':
                                // Check for expired key and clear it
                                if (storage._isExpired(cmd.key)) {
                                    storage.lists.set(cmd.key, []);
                                }
                                // Remove from other data structures (type change)
                                storage.data.delete(cmd.key);
                                storage.sets.delete(cmd.key);
                                storage.sortedSets.delete(cmd.key);
                                if (!storage.lists.has(cmd.key)) {
                                    storage.lists.set(cmd.key, []);
                                }
                                const list = storage.lists.get(cmd.key);
                                // lPush adds to the head (beginning) of the list
                                // Redis LPUSH pushes elements one by one in order given
                                for (const val of cmd.values) {
                                    list.unshift(val);
                                }
                                results.push(list.length);
                                break;
                            case 'lTrim':
                                if (storage._isExpired(cmd.key)) {
                                    results.push('OK');
                                    break;
                                }
                                const trimList = storage.lists.get(cmd.key);
                                if (!trimList) {
                                    results.push('OK');
                                    break;
                                }
                                const trimLen = trimList.length;
                                const trimStart = cmd.start < 0 ? Math.max(trimLen + cmd.start, 0) : Math.min(cmd.start, trimLen);
                                const trimStop = cmd.stop < 0 ? trimLen + cmd.stop : Math.min(cmd.stop, trimLen - 1);
                                if (trimStart > trimStop) {
                                    storage.lists.set(cmd.key, []);
                                } else {
                                    storage.lists.set(cmd.key, trimList.slice(trimStart, trimStop + 1));
                                }
                                results.push('OK');
                                break;
                            case 'zAdd':
                                // Check for expired key and clear it
                                if (storage._isExpired(cmd.key)) {
                                    storage.sortedSets.set(cmd.key, new Map());
                                }
                                // Remove from other data structures (type change)
                                storage.data.delete(cmd.key);
                                storage.sets.delete(cmd.key);
                                storage.lists.delete(cmd.key);
                                if (!storage.sortedSets.has(cmd.key)) {
                                    storage.sortedSets.set(cmd.key, new Map());
                                }
                                const zset = storage.sortedSets.get(cmd.key);
                                let zAdded = 0;
                                for (const item of cmd.items) {
                                    const { score, value } = item;
                                    if (!zset.has(value)) {
                                        zAdded++;
                                    }
                                    zset.set(value, score);
                                }
                                results.push(zAdded);
                                break;
                            case 'zRemRangeByRank':
                                if (storage._isExpired(cmd.key)) {
                                    results.push(0);
                                    break;
                                }
                                const zsetForRemove = storage.sortedSets.get(cmd.key);
                                if (!zsetForRemove || zsetForRemove.size === 0) {
                                    results.push(0);
                                    break;
                                }
                                // Convert to array and sort by score
                                const zEntries = Array.from(zsetForRemove.entries())
                                    .map(([value, score]) => ({ value, score }))
                                    .sort((a, b) => a.score - b.score);
                                const zLen = zEntries.length;
                                const zStart = cmd.start < 0 ? Math.max(zLen + cmd.start, 0) : Math.min(cmd.start, zLen);
                                const zStop = cmd.stop < 0 ? zLen + cmd.stop : Math.min(cmd.stop, zLen - 1);
                                if (zStart > zStop) {
                                    results.push(0);
                                    break;
                                }
                                const toRemove = zEntries.slice(zStart, zStop + 1);
                                for (const entry of toRemove) {
                                    zsetForRemove.delete(entry.value);
                                }
                                results.push(toRemove.length);
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
        const yielded = new Set();

        // Yield keys from data map
        for (const key of this.data.keys()) {
            if (!this._isExpired(key) && regex.test(key)) {
                yielded.add(key);
                yield key;
            }
        }

        // Yield keys from sets map
        for (const key of this.sets.keys()) {
            if (!this._isExpired(key) && regex.test(key) && !yielded.has(key)) {
                yielded.add(key);
                yield key;
            }
        }

        // Yield keys from lists map
        for (const key of this.lists.keys()) {
            if (!this._isExpired(key) && regex.test(key) && !yielded.has(key)) {
                yielded.add(key);
                yield key;
            }
        }

        // Yield keys from sorted sets map
        for (const key of this.sortedSets.keys()) {
            if (!this._isExpired(key) && regex.test(key) && !yielded.has(key)) {
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
        // SPRINT-15 FIX: Clean up event handlers to prevent memory leaks
        this._eventHandlers.clear();
        // FIX: Do NOT clear shared pubsubChannels here - it would break pub/sub
        // for other instances (e.g., main client when pubClient calls quit())
        // pubsubChannels is intentionally shared across all MemoryStorage instances
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
