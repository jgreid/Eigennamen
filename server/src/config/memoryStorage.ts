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

// ============================================================================
// Types
// ============================================================================

/**
 * Callback type for pub/sub
 */
type PubSubCallback = (message: string, channel: string) => void;

/**
 * Event handler callback
 */
type EventCallback = (...args: unknown[]) => void;

/**
 * Set options for the set command
 */
export interface SetOptions {
    EX?: number;      // Expiry in seconds
    PX?: number;      // Expiry in milliseconds
    NX?: boolean;     // Only set if key does not exist
    KEEPTTL?: boolean; // Keep existing TTL
}

/**
 * Sorted set item
 */
export interface ZAddItem {
    score: number;
    value: string;
}

/**
 * Sorted set range options
 */
export interface ZRangeOptions {
    REV?: boolean;
    WITHSCORES?: boolean;
}

/**
 * Sorted set range by score options
 */
export interface ZRangeByScoreOptions {
    LIMIT?: {
        offset: number;
        count: number;
    };
}

/**
 * Scan options
 */
export interface ScanOptions {
    MATCH?: string;
    COUNT?: number;
}

/**
 * Scan result
 */
export interface ScanResult {
    cursor: string;
    keys: string[];
}

/**
 * Eval options for Lua script simulation
 */
export interface EvalOptions {
    keys?: string[];
    arguments?: string[];
}

/**
 * Transaction builder interface
 */
export interface TransactionBuilder {
    set(key: string, value: string, options?: SetOptions): TransactionBuilder;
    del(key: string): TransactionBuilder;
    sAdd(key: string, ...members: string[]): TransactionBuilder;
    sRem(key: string, ...members: string[]): TransactionBuilder;
    expire(key: string, seconds: number): TransactionBuilder;
    lPush(key: string, ...values: string[]): TransactionBuilder;
    lTrim(key: string, start: number, stop: number): TransactionBuilder;
    zAdd(key: string, ...items: ZAddItem[]): TransactionBuilder;
    zRemRangeByRank(key: string, start: number, stop: number): TransactionBuilder;
    exec(): Promise<(string | number | null)[] | null>;
}

/**
 * Scan iterator options
 */
export interface ScanIteratorOptions {
    MATCH?: string;
}

// ============================================================================
// Constants
// ============================================================================

// Maximum total keys across all data structures before eviction kicks in.
// This prevents unbounded memory growth in long-running single-instance deployments.
// Default 10,000 is sized for 512MB VMs (~1,100 rooms at ~9 keys each, ~8KB per room).
// Override via MEMORY_STORAGE_MAX_KEYS env var if running on larger instances.
export const MAX_TOTAL_KEYS = parseInt(process.env['MEMORY_STORAGE_MAX_KEYS'] || '', 10) || 10000;

// ============================================================================
// Shared Storage
// ============================================================================

// Shared storage across all MemoryStorage instances (for duplicate() support)
let sharedData: Map<string, string> | null = null;
let sharedExpiries: Map<string, number> | null = null;
let sharedSets: Map<string, Set<string>> | null = null;
let sharedLists: Map<string, string[]> | null = null;
let sharedSortedSets: Map<string, Map<string, number>> | null = null;
let sharedPubsubChannels: Map<string, Set<PubSubCallback>> | null = null;

function initializeSharedStorage(): void {
    if (!sharedData) {
        sharedData = new Map();
        sharedExpiries = new Map();
        sharedSets = new Map();
        sharedLists = new Map();
        sharedSortedSets = new Map();
        sharedPubsubChannels = new Map();
    }
}

// ============================================================================
// MemoryStorage Class
// ============================================================================

/**
 * In-memory storage that provides a Redis-compatible API
 */
export class MemoryStorage {
    private data: Map<string, string>;
    private expiries: Map<string, number>;
    private sets: Map<string, Set<string>>;
    private lists: Map<string, string[]>;
    private sortedSets: Map<string, Map<string, number>>;
    private pubsubChannels: Map<string, Set<PubSubCallback>>;
    public isOpen: boolean;
    /** Whether this instance is a clone (for duplicate() support). Accessed by tests. */
    public readonly _isClone: boolean;
    private _watchedKeys: Map<string, string | null>;
    private _eventHandlers: Map<string, EventCallback[]>;
    public cleanupInterval?: ReturnType<typeof setInterval> | null;

    constructor(isClone = false) {
        initializeSharedStorage();

        // All instances share the same data (simulates Redis behavior)
        this.data = sharedData!;
        this.expiries = sharedExpiries!;
        this.sets = sharedSets!;
        this.lists = sharedLists!;
        this.sortedSets = sharedSortedSets!;
        this.pubsubChannels = sharedPubsubChannels!;
        this.isOpen = true;
        this._isClone = isClone;
        this._watchedKeys = new Map();
        this._eventHandlers = new Map();

        // Periodic cleanup of expired keys (only for primary instance)
        if (!isClone) {
            this.cleanupInterval = setInterval(() => this._cleanupExpired(), 60000);
        }
    }

    /**
     * Clean up expired keys with performance monitoring
     */
    private _cleanupExpired(): void {
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

        // After expiry cleanup, check if we still exceed the key limit
        this._evictIfNeeded();
    }

    /**
     * Count total keys across all data structures
     */
    private _totalKeyCount(): number {
        // Use a Set for accurate deduplication across structures
        const allKeys = new Set<string>();
        for (const key of this.data.keys()) allKeys.add(key);
        for (const key of this.sets.keys()) allKeys.add(key);
        for (const key of this.lists.keys()) allKeys.add(key);
        for (const key of this.sortedSets.keys()) allKeys.add(key);
        return allKeys.size;
    }

    /**
     * Evict keys when storage exceeds MAX_TOTAL_KEYS.
     * Strategy: evict expired keys first, then keys with nearest TTL (volatile-ttl).
     * Keys without TTL are evicted last.
     */
    private _evictIfNeeded(): number {
        const total = this._totalKeyCount();
        if (total <= MAX_TOTAL_KEYS) return 0;

        const toEvict = Math.max(Math.floor(total * 0.1), total - MAX_TOTAL_KEYS);
        let evicted = 0;

        // Phase 1: evict expired keys (should already be cleaned but check anyway)
        const now = Date.now();
        for (const [key, expiry] of this.expiries.entries()) {
            if (evicted >= toEvict) break;
            if (expiry <= now) {
                this._deleteKey(key);
                evicted++;
            }
        }
        if (evicted >= toEvict) return evicted;

        // Phase 2: evict keys with soonest TTL (volatile-ttl strategy)
        const ttlEntries: Array<{ key: string; expiry: number }> = [];
        for (const [key, expiry] of this.expiries.entries()) {
            ttlEntries.push({ key, expiry });
        }
        ttlEntries.sort((a, b) => a.expiry - b.expiry);

        for (const { key } of ttlEntries) {
            if (evicted >= toEvict) break;
            this._deleteKey(key);
            evicted++;
        }

        if (evicted > 0) {
            logger.warn(`Memory storage eviction: removed ${evicted} keys (was ${total}, max ${MAX_TOTAL_KEYS})`);
        }

        return evicted;
    }

    /**
     * Delete a key from all data structures
     */
    private _deleteKey(key: string): void {
        this.data.delete(key);
        this.sets.delete(key);
        this.lists.delete(key);
        this.sortedSets.delete(key);
        this.expiries.delete(key);
    }

    /**
     * Check if a key is expired
     */
    private _isExpired(key: string): boolean {
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
    private _globToRegex(pattern: string): RegExp {
        // First escape all regex metacharacters except * and ?
        const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
        // Then convert glob wildcards to regex
        const regexPattern = escaped.replace(/\*/g, '.*').replace(/\?/g, '.');
        return new RegExp('^' + regexPattern + '$');
    }

    // ========================================================================
    // Basic string operations
    // ========================================================================

    async get(key: string): Promise<string | null> {
        if (this._isExpired(key)) return null;
        const value = this.data.get(key);
        return value !== undefined ? value : null;
    }

    async set(key: string, value: string, options: SetOptions = {}): Promise<string | null> {
        // NX: only set if key does not already exist (used by distributed locks)
        if (options.NX) {
            if (this.data.has(key) && !this._isExpired(key)) {
                return null; // Key exists, NX fails
            }
        }
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

    async del(key: string | string[]): Promise<number> {
        // Redis DEL accepts multiple keys; handle array argument
        if (Array.isArray(key)) {
            let count = 0;
            for (const k of key) {
                count += await this.del(k);
            }
            return count;
        }
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

    async exists(key: string): Promise<number> {
        if (this._isExpired(key)) return 0;
        return (this.data.has(key) || this.sets.has(key) ||
            this.lists.has(key) || this.sortedSets.has(key)) ? 1 : 0;
    }

    async expire(key: string, seconds: number): Promise<number> {
        // Check expiry first - can't set expiry on non-existent/expired key
        if (this._isExpired(key)) return 0;
        if (!this.data.has(key) && !this.sets.has(key) &&
            !this.lists.has(key) && !this.sortedSets.has(key)) return 0;
        this.expiries.set(key, Date.now() + (seconds * 1000));
        return 1;
    }

    async ttl(key: string): Promise<number> {
        if (this._isExpired(key)) return -2;
        // Check if key exists - return -2 for non-existent keys
        if (!this.data.has(key) && !this.sets.has(key) &&
            !this.lists.has(key) && !this.sortedSets.has(key)) return -2;
        const expiry = this.expiries.get(key);
        if (!expiry) return -1;  // Key exists but no expiry
        return Math.ceil((expiry - Date.now()) / 1000);
    }

    async incr(key: string): Promise<number> {
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

    async decr(key: string): Promise<number> {
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

    // ========================================================================
    // Set operations
    // ========================================================================

    async sAdd(key: string, ...members: string[]): Promise<number> {
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
        const set = this.sets.get(key)!;
        let added = 0;
        for (const member of members) {
            if (!set.has(member)) {
                set.add(member);
                added++;
            }
        }
        return added;
    }

    async sRem(key: string, ...members: string[]): Promise<number> {
        if (this._isExpired(key)) return 0;
        const set = this.sets.get(key);
        if (!set) return 0;
        let removed = 0;
        for (const member of members) {
            if (set.delete(member)) removed++;
        }
        return removed;
    }

    async sMembers(key: string): Promise<string[]> {
        if (this._isExpired(key)) return [];
        const set = this.sets.get(key);
        return set ? Array.from(set) : [];
    }

    async sIsMember(key: string, member: string): Promise<number> {
        if (this._isExpired(key)) return 0;
        const set = this.sets.get(key);
        return (set && set.has(member)) ? 1 : 0;
    }

    async sCard(key: string): Promise<number> {
        if (this._isExpired(key)) return 0;
        const set = this.sets.get(key);
        return set ? set.size : 0;
    }

    // ========================================================================
    // Batch operations
    // ========================================================================

    async mGet(keys: string[]): Promise<(string | null)[]> {
        const results: (string | null)[] = [];
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

    // ========================================================================
    // List operations
    // ========================================================================

    async lPush(key: string, ...values: string[]): Promise<number> {
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
        const list = this.lists.get(key)!;
        // lPush adds to the head (beginning) of the list
        // Redis LPUSH pushes elements one by one in order given,
        // so 'LPUSH key a b c' results in [c, b, a] (c at head)
        // Use a single unshift with reversed values for O(n) instead of O(n*k) per-element unshift
        const reversed = [...values].reverse();
        list.unshift(...reversed);
        return list.length;
    }

    async lRange(key: string, start: number, stop: number): Promise<string[]> {
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

    async lIndex(key: string, index: number): Promise<string | null> {
        if (this._isExpired(key)) return null;
        const list = this.lists.get(key);
        if (!list) return null;

        const len = list.length;
        // Handle negative index
        const idx = index < 0 ? len + index : index;
        if (idx < 0 || idx >= len) return null;
        return list[idx] ?? null;
    }

    async lLen(key: string): Promise<number> {
        if (this._isExpired(key)) return 0;
        const list = this.lists.get(key);
        return list ? list.length : 0;
    }

    async lTrim(key: string, start: number, stop: number): Promise<string> {
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

    // ========================================================================
    // Sorted set operations
    // ========================================================================

    async zAdd(key: string, ...items: ZAddItem[]): Promise<number> {
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
        const zset = this.sortedSets.get(key)!;
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

    async zRange(key: string, start: number, stop: number, options: ZRangeOptions = {}): Promise<string[] | Array<{ value: string; score: number }>> {
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
            return slice.map(entry => ({ value: entry.value, score: entry.score }));
        }

        return slice.map(e => e.value);
    }

    async zRangeByScore(key: string, min: number, max: number, options: ZRangeByScoreOptions = {}): Promise<string[]> {
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

    async zRem(key: string, ...members: string[]): Promise<number> {
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

    async zCard(key: string): Promise<number> {
        if (this._isExpired(key)) return 0;
        const zset = this.sortedSets.get(key);
        return zset ? zset.size : 0;
    }

    async zRemRangeByRank(key: string, start: number, stop: number): Promise<number> {
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

    // ========================================================================
    // Key pattern operations
    // ========================================================================

    async keys(pattern: string): Promise<string[]> {
        // Convert glob pattern to regex with proper escaping
        const regex = this._globToRegex(pattern);
        // Use Set for O(1) deduplication instead of O(n) includes() check
        const resultSet = new Set<string>();

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
    async scan(cursor: string, options: ScanOptions = {}): Promise<ScanResult> {
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

    // ========================================================================
    // Pub/Sub (in-memory, single instance only)
    // ========================================================================

    async subscribe(channel: string, callback: PubSubCallback): Promise<void> {
        if (!this.pubsubChannels.has(channel)) {
            this.pubsubChannels.set(channel, new Set());
        }
        this.pubsubChannels.get(channel)!.add(callback);
    }

    async unsubscribe(channel: string): Promise<void> {
        this.pubsubChannels.delete(channel);
    }

    async publish(channel: string, message: string): Promise<number> {
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

    // ========================================================================
    // Lua Script Simulation
    // ========================================================================

    /**
     * Handle lock: prefixed Lua scripts (release, extend).
     * RELEASE: 1 arg (ownerId) - delete key only if value matches ownerId
     * EXTEND:  2 args (ownerId, additionalMs) - pexpire only if value matches
     */
    private _evalLockScript(lockKey: string, numArgs: number, args: string[]): number | null {
        const ownerId = args[0] as string | undefined;
        const currentValue = this.data.get(lockKey);

        // Key doesn't exist or is expired
        if (this._isExpired(lockKey) || currentValue === undefined) {
            return 0;
        }

        if (numArgs === 1 && ownerId !== undefined) {
            // RELEASE_LOCK_SCRIPT: if GET == ownerId then DEL
            if (currentValue === ownerId) {
                this._deleteKey(lockKey);
                return 1;
            }
            return 0;
        }

        if (numArgs === 2 && ownerId !== undefined) {
            // EXTEND_LOCK_SCRIPT: if GET == ownerId then PEXPIRE
            const additionalMs = parseInt(args[1] as string, 10);
            if (currentValue === ownerId) {
                this.expiries.set(lockKey, Date.now() + additionalMs);
                return 1;
            }
            return 0;
        }

        logger.debug('Memory storage: unsupported lock eval pattern', { lockKey, numArgs });
        return null;
    }

    /**
     * Handle timer: prefixed Lua scripts (claim, addTime, get).
     * CLAIM:    1 key, 2 args (instanceId, ownerTTL)
     * ADD_TIME: 1 key, 4 args (secondsToAdd, instanceId, now, ttlBuffer)
     * GET:      1 key, 0 args
     */
    private _evalTimerScript(timerKey: string, numKeys: number, numArgs: number, args: string[]): string | null {
        if (numKeys !== 1) {
            logger.debug('Memory storage: unsupported timer eval pattern', { timerKey, numKeys, numArgs });
            return null;
        }

        // Check timer exists
        if (this._isExpired(timerKey) || !this.data.has(timerKey)) {
            return null;
        }

        // GET: 0 args - return raw timer data
        if (numArgs === 0) {
            return this.data.get(timerKey) ?? null;
        }

        // CLAIM: 2 args (instanceId, ownerTTL)
        if (numArgs === 2) {
            const instanceId = args[0] as string;
            const ownerTTL = parseInt(args[1] as string, 10);

            try {
                const timerData = JSON.parse(this.data.get(timerKey)!) as { ownerId?: string };

                if (!timerData.ownerId || timerData.ownerId !== instanceId) {
                    timerData.ownerId = instanceId;
                    this.data.set(timerKey, JSON.stringify(timerData));
                    if (ownerTTL > 0) {
                        this.expiries.set(timerKey, Date.now() + (ownerTTL * 1000));
                    }
                    return JSON.stringify(timerData);
                }
                return null; // Already owned by this instance
            } catch (e) {
                logger.error('Timer claim script parse error:', (e as Error).message);
                return null;
            }
        }

        // ADD_TIME: 4 args (secondsToAdd, instanceId, now, ttlBuffer)
        if (numArgs === 4) {
            const secondsToAdd = parseInt(args[0] as string, 10);
            const ttlBuffer = parseInt(args[3] as string, 10);

            try {
                const timerData = JSON.parse(this.data.get(timerKey)!) as {
                    paused?: boolean;
                    endTime: number;
                    duration: number;
                    remainingSeconds?: number;
                };

                if (timerData.paused) {
                    return null;
                }

                const now = Date.now();
                const currentRemaining = Math.max(0, timerData.endTime - now);
                const newEndTime = now + currentRemaining + (secondsToAdd * 1000);

                timerData.endTime = newEndTime;
                timerData.duration = timerData.duration + secondsToAdd;
                timerData.remainingSeconds = Math.ceil((newEndTime - now) / 1000);

                this.data.set(timerKey, JSON.stringify(timerData));

                // Refresh TTL like the real Lua script does
                if (ttlBuffer > 0) {
                    const newTTL = Math.ceil((newEndTime - now) / 1000) + ttlBuffer;
                    this.expiries.set(timerKey, Date.now() + (newTTL * 1000));
                }

                return JSON.stringify(timerData);
            } catch (e) {
                logger.error('Timer add time script parse error:', (e as Error).message);
                return null;
            }
        }

        // Legacy: 1 arg (secondsToAdd) - kept for backward compatibility
        if (numArgs === 1) {
            const secondsToAdd = parseInt(args[0] as string, 10);

            try {
                const timerData = JSON.parse(this.data.get(timerKey)!) as {
                    endTime: number;
                    duration: number;
                    remainingSeconds?: number;
                };
                const now = Date.now();
                const currentRemaining = Math.max(0, timerData.endTime - now);
                const newEndTime = now + currentRemaining + (secondsToAdd * 1000);

                timerData.endTime = newEndTime;
                timerData.duration = timerData.duration + secondsToAdd;
                timerData.remainingSeconds = Math.ceil((newEndTime - now) / 1000);

                this.data.set(timerKey, JSON.stringify(timerData));
                return JSON.stringify(timerData);
            } catch (e) {
                logger.error('Timer add time script parse error:', (e as Error).message);
                return null;
            }
        }

        logger.debug('Memory storage: unsupported timer eval pattern', { timerKey, numArgs });
        return null;
    }

    /**
     * Lua script support - implement atomic operations for memory mode.
     * Dispatch is keyed on the first key's prefix, then by argument count,
     * which avoids ambiguity between scripts with the same arity but
     * different key namespaces (e.g., lock: vs room: vs timer:).
     */
    async eval(_script: string | null, options: EvalOptions): Promise<string | number | null> {
        if (!options || !options.keys || options.keys.length === 0) {
            logger.debug('Memory storage eval called with no keys');
            return null;
        }

        // Extract keys and args with type safety
        const keys = options.keys;
        const args = options.arguments || [];
        const numKeys = keys.length;
        const numArgs = args.length;
        const firstKey = keys[0] as string;

        // Lock scripts (key prefix: lock:)
        if (firstKey.startsWith('lock:')) {
            return this._evalLockScript(firstKey, numArgs, args);
        }

        // Timer scripts (key prefix: timer:)
        if (firstKey.startsWith('timer:')) {
            return this._evalTimerScript(firstKey, numKeys, numArgs, args);
        }

        // Room CREATE script: 2 keys (roomKey, playersKey), 2 args (roomData, ttl)
        // Guard: firstKey must NOT contain ':players' to distinguish from JOIN script
        if (numKeys === 2 && numArgs === 2 && firstKey.startsWith('room:') && !firstKey.includes(':players')) {
            const roomKey = firstKey;
            const playersKey = keys[1] as string;
            const roomData = args[0] as string;
            const ttl = parseInt(args[1] as string, 10);

            if (this.data.has(roomKey) && !this._isExpired(roomKey)) {
                return 0; // Room already exists
            }

            this.data.set(roomKey, roomData);
            this.expiries.set(roomKey, Date.now() + (ttl * 1000));
            this.sets.delete(playersKey);
            this.sets.set(playersKey, new Set());
            this.expiries.set(playersKey, Date.now() + (ttl * 1000));
            return 1;
        }

        // Room JOIN script: 2 keys (playersKey, roomKey), 2 args (maxPlayers, sessionId)
        // The script atomically verifies room existence, checks capacity, and adds the player
        if (numKeys === 2 && numArgs === 2 && firstKey.includes(':players')) {
            const playersKey = firstKey;
            const roomKey = keys[1] as string;
            const maxPlayers = parseInt(args[0] as string, 10);
            const sessionId = args[1] as string;

            // Verify room still exists (mirrors Lua script room existence check)
            if (!this.data.has(roomKey) || this._isExpired(roomKey)) {
                return -2; // Room doesn't exist
            }

            if (this._isExpired(playersKey)) {
                this.sets.set(playersKey, new Set());
            }

            const existingSet = this.sets.get(playersKey);
            if (existingSet && existingSet.has(sessionId)) {
                return -1; // Already a member
            }

            const currentCount = existingSet ? existingSet.size : 0;
            if (currentCount >= maxPlayers) {
                return 0; // Room is full
            }

            this.data.delete(playersKey);
            if (!this.sets.has(playersKey)) {
                this.sets.set(playersKey, new Set());
            }
            this.sets.get(playersKey)!.add(sessionId);
            return 1;
        }

        // ATOMIC_SET_TEAM_SCRIPT: 2 keys (playerKey, roomCode), 4 args (team, ttl, now, sessionId)
        // Used by playerService.setTeam()
        // Guard: keys[1] is a bare roomCode (e.g. "ABCDEF"), NOT "room:X:players"
        if (numKeys === 2 && numArgs === 4 && (keys[0] as string).startsWith('player:') && !(keys[1] as string).includes(':players')) {
            const playerKey = keys[0] as string;
            const roomCode = keys[1] as string;
            const newTeam = args[0] as string;
            const ttl = parseInt(args[1] as string, 10);
            const now = parseInt(args[2] as string, 10);
            const sessionId = args[3] as string;

            if (this._isExpired(playerKey) || !this.data.has(playerKey)) {
                return null;
            }

            try {
                const player = JSON.parse(this.data.get(playerKey)!) as {
                    team: string | null;
                    role: string;
                    lastSeen: number;
                };
                const oldTeam = player.team;
                const oldRole = player.role;

                const actualNewTeam: string | null = newTeam !== '__NULL__' ? newTeam : null;
                player.team = actualNewTeam;
                player.lastSeen = now;

                // Clear team-specific roles when switching teams
                if (oldTeam !== actualNewTeam && (oldRole === 'spymaster' || oldRole === 'clicker')) {
                    player.role = 'spectator';
                }

                this.data.set(playerKey, JSON.stringify(player));
                this.expiries.set(playerKey, Date.now() + (ttl * 1000));

                // Remove from old team set
                if (oldTeam) {
                    const oldTeamKey = `room:${roomCode}:team:${oldTeam}`;
                    const oldSet = this.sets.get(oldTeamKey);
                    if (oldSet) {
                        oldSet.delete(sessionId);
                        if (oldSet.size === 0) {
                            this.sets.delete(oldTeamKey);
                            this.expiries.delete(oldTeamKey);
                        }
                    }
                }

                // Add to new team set
                if (actualNewTeam) {
                    const newTeamKey = `room:${roomCode}:team:${actualNewTeam}`;
                    if (!this.sets.has(newTeamKey)) {
                        this.sets.set(newTeamKey, new Set());
                    }
                    this.sets.get(newTeamKey)!.add(sessionId);
                    this.expiries.set(newTeamKey, Date.now() + (ttl * 1000));
                }

                return JSON.stringify({ player, oldTeam });
            } catch (e) {
                logger.error('Set team script error:', (e as Error).message);
                return null;
            }
        }

        // ATOMIC_SAFE_TEAM_SWITCH_SCRIPT: 3 keys (playerKey, teamSetKey, roomCode), 5 args
        // Used by playerService.setTeam()
        if (numKeys === 3 && numArgs === 5 && (keys[0] as string).startsWith('player:')) {
            const playerKey = keys[0] as string;
            const teamSetKey = keys[1] as string;
            const roomCode = keys[2] as string;
            const newTeam = args[0] as string;
            const sessionId = args[1] as string;
            const ttl = parseInt(args[2] as string, 10);
            const now = parseInt(args[3] as string, 10);
            const checkEmpty = (args[4] as string) === 'true';

            if (this._isExpired(playerKey) || !this.data.has(playerKey)) {
                return null;
            }

            try {
                const player = JSON.parse(this.data.get(playerKey)!) as {
                    team: string | null;
                    role: string;
                    lastSeen: number;
                    connected?: boolean;
                };
                const oldTeam = player.team;
                const oldRole = player.role;
                const actualNewTeam: string | null = newTeam !== '__NULL__' ? newTeam : null;

                // Check if team would become empty
                if (checkEmpty && oldTeam && oldTeam !== actualNewTeam) {
                    const oldSet = this.sets.get(teamSetKey);
                    let otherConnected = 0;
                    if (oldSet) {
                        for (const memberId of oldSet) {
                            if (memberId !== sessionId) {
                                const mKey = `player:${memberId}`;
                                if (!this._isExpired(mKey) && this.data.has(mKey)) {
                                    const member = JSON.parse(this.data.get(mKey)!) as { connected?: boolean };
                                    if (member.connected) {
                                        otherConnected++;
                                    }
                                }
                            }
                        }
                    }
                    // No other connected members (or set doesn't exist) - reject
                    if (otherConnected === 0) {
                        return JSON.stringify({ success: false, reason: 'TEAM_WOULD_BE_EMPTY' });
                    }
                }

                // Proceed with team change
                player.team = actualNewTeam;
                player.lastSeen = now;

                if (oldTeam !== actualNewTeam && (oldRole === 'spymaster' || oldRole === 'clicker')) {
                    player.role = 'spectator';
                }

                this.data.set(playerKey, JSON.stringify(player));
                this.expiries.set(playerKey, Date.now() + (ttl * 1000));

                // Remove from old team set
                if (oldTeam) {
                    const oldTeamKey = `room:${roomCode}:team:${oldTeam}`;
                    const oldSet = this.sets.get(oldTeamKey);
                    if (oldSet) {
                        oldSet.delete(sessionId);
                        if (oldSet.size === 0) {
                            this.sets.delete(oldTeamKey);
                            this.expiries.delete(oldTeamKey);
                        }
                    }
                }

                // Add to new team set
                if (actualNewTeam) {
                    const newTeamKey = `room:${roomCode}:team:${actualNewTeam}`;
                    if (!this.sets.has(newTeamKey)) {
                        this.sets.set(newTeamKey, new Set());
                    }
                    this.sets.get(newTeamKey)!.add(sessionId);
                    this.expiries.set(newTeamKey, Date.now() + (ttl * 1000));
                }

                return JSON.stringify({ success: true, player });
            } catch (e) {
                logger.error('Safe team switch script error:', (e as Error).message);
                return null;
            }
        }

        // ATOMIC_SET_ROLE_SCRIPT: 2 keys (playerKey, roomPlayersKey), 4 args (role, sessionId, ttl, now)
        // Used by playerService.setRole()
        if (numKeys === 2 && numArgs === 4 && (keys[0] as string).startsWith('player:') && (keys[1] as string).includes(':players')) {
            const playerKey = keys[0] as string;
            const roomPlayersKey = keys[1] as string;
            const newRole = args[0] as string;
            const sessionId = args[1] as string;
            const ttl = parseInt(args[2] as string, 10);
            const now = parseInt(args[3] as string, 10);

            if (this._isExpired(playerKey) || !this.data.has(playerKey)) {
                return null;
            }

            try {
                const player = JSON.parse(this.data.get(playerKey)!) as {
                    team: string | null;
                    role: string;
                    lastSeen: number;
                    nickname?: string;
                };

                // For spymaster/clicker, require team and check uniqueness
                if (newRole === 'spymaster' || newRole === 'clicker') {
                    if (!player.team) {
                        return JSON.stringify({ success: false, reason: 'NO_TEAM' });
                    }

                    const memberIds = this.sets.get(roomPlayersKey);
                    if (memberIds) {
                        for (const memberId of memberIds) {
                            if (memberId !== sessionId) {
                                const mKey = `player:${memberId}`;
                                if (!this._isExpired(mKey) && this.data.has(mKey)) {
                                    const member = JSON.parse(this.data.get(mKey)!) as {
                                        team: string | null;
                                        role: string;
                                        nickname?: string;
                                    };
                                    if (member.team === player.team && member.role === newRole) {
                                        return JSON.stringify({
                                            success: false,
                                            reason: 'ROLE_TAKEN',
                                            existingNickname: member.nickname
                                        });
                                    }
                                }
                            }
                        }
                    }
                }

                const oldRole = player.role;
                player.role = newRole;
                player.lastSeen = now;

                this.data.set(playerKey, JSON.stringify(player));
                this.expiries.set(playerKey, Date.now() + (ttl * 1000));

                return JSON.stringify({ success: true, player, oldRole });
            } catch (e) {
                logger.error('Set role script error:', (e as Error).message);
                return null;
            }
        }

        // ATOMIC_HOST_TRANSFER_SCRIPT: 3 keys (oldHostKey, newHostKey, roomKey), 3 args
        // Used by playerService.atomicHostTransfer()
        if (numKeys === 3 && numArgs === 3 && (keys[0] as string).startsWith('player:') && (keys[2] as string).startsWith('room:')) {
            const oldHostKey = keys[0] as string;
            const newHostKey = keys[1] as string;
            const roomKey = keys[2] as string;
            const newHostSessionId = args[0] as string;
            const ttl = parseInt(args[1] as string, 10);
            const now = parseInt(args[2] as string, 10);

            try {
                if (this._isExpired(oldHostKey) || !this.data.has(oldHostKey)) {
                    return JSON.stringify({ success: false, reason: 'OLD_HOST_NOT_FOUND' });
                }
                if (this._isExpired(newHostKey) || !this.data.has(newHostKey)) {
                    return JSON.stringify({ success: false, reason: 'NEW_HOST_NOT_FOUND' });
                }
                if (this._isExpired(roomKey) || !this.data.has(roomKey)) {
                    return JSON.stringify({ success: false, reason: 'ROOM_NOT_FOUND' });
                }

                const oldHost = JSON.parse(this.data.get(oldHostKey)!) as {
                    isHost: boolean;
                    lastSeen: number;
                };
                const newHost = JSON.parse(this.data.get(newHostKey)!) as {
                    isHost: boolean;
                    lastSeen: number;
                };
                const room = JSON.parse(this.data.get(roomKey)!) as {
                    hostSessionId: string;
                };

                oldHost.isHost = false;
                oldHost.lastSeen = now;
                newHost.isHost = true;
                newHost.lastSeen = now;
                room.hostSessionId = newHostSessionId;

                this.data.set(oldHostKey, JSON.stringify(oldHost));
                this.expiries.set(oldHostKey, Date.now() + (ttl * 1000));
                this.data.set(newHostKey, JSON.stringify(newHost));
                this.expiries.set(newHostKey, Date.now() + (ttl * 1000));
                this.data.set(roomKey, JSON.stringify(room));
                this.expiries.set(roomKey, Date.now() + (ttl * 1000));

                return JSON.stringify({ success: true, oldHost, newHost });
            } catch (e) {
                logger.error('Host transfer script error:', (e as Error).message);
                return JSON.stringify({ success: false, reason: 'SCRIPT_ERROR' });
            }
        }

        // Reconnection token script: 2 keys (sessionKey, tokenKey), 3 args (newToken, tokenData, ttl)
        // Used by playerService.generateReconnectionToken()
        if (numKeys === 2 && numArgs === 3 && firstKey.startsWith('reconnect:session:')) {
            const sessionKey = firstKey;
            const tokenKey = keys[1] as string;
            const newToken = args[0] as string;
            const tokenData = args[1] as string;
            const ttl = parseInt(args[2] as string, 10);

            // Check for existing token
            const existing = this.data.get(sessionKey);
            if (existing && !this._isExpired(sessionKey)) {
                return existing;
            }

            // Set both mappings atomically
            this.data.set(sessionKey, newToken);
            this.expiries.set(sessionKey, Date.now() + (ttl * 1000));
            this.data.set(tokenKey, tokenData);
            this.expiries.set(tokenKey, Date.now() + (ttl * 1000));
            return newToken;
        }

        // Fail loudly for unrecognized Lua script patterns to prevent silent data loss.
        // If a new Lua script is added to production code but not mirrored here,
        // the operation must fail visibly rather than returning null and proceeding
        // as if the operation succeeded.
        const errorMsg = `MemoryStorage: unrecognized Lua script pattern (numKeys=${numKeys}, numArgs=${numArgs}, firstKey=${firstKey})`;
        logger.error(errorMsg);
        throw new Error(errorMsg);
    }

    async evalSha(_sha: string, options: EvalOptions): Promise<string | number | null> {
        return this.eval(null, options);
    }

    async scriptLoad(_script: string): Promise<string> {
        // Return a fake SHA - we don't actually use it in memory mode
        return 'memory_mode_sha';
    }

    // ========================================================================
    // Transaction support (optimistic locking)
    // ========================================================================

    async watch(key: string): Promise<string> {
        // Store the current value hash for comparison during exec
        // Check expiry first - expired keys should be treated as non-existent
        if (this._isExpired(key)) {
            this._watchedKeys.set(key, null);
            return 'OK';
        }
        // FIX: Check all data structures, not just data map
        // This allows watching Sets, Lists, and Sorted Sets correctly
        let watchValue: string | null = null;
        if (this.data.has(key)) {
            watchValue = JSON.stringify(this.data.get(key));
        } else if (this.sets.has(key)) {
            watchValue = JSON.stringify([...this.sets.get(key)!].sort());
        } else if (this.lists.has(key)) {
            watchValue = JSON.stringify(this.lists.get(key));
        } else if (this.sortedSets.has(key)) {
            const zset = this.sortedSets.get(key)!;
            watchValue = JSON.stringify([...zset.entries()].sort());
        }
        this._watchedKeys.set(key, watchValue);
        return 'OK';
    }

    async unwatch(): Promise<string> {
        this._watchedKeys.clear();
        return 'OK';
    }

    multi(): TransactionBuilder {
        // Return a transaction builder
        interface Command {
            cmd: string;
            key: string;
            value?: string;
            options?: SetOptions;
            members?: string[];
            seconds?: number;
            values?: string[];
            start?: number;
            stop?: number;
            items?: ZAddItem[];
        }
        const commands: Command[] = [];
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const storage = this;

        const txn: TransactionBuilder = {
            set: function(key: string, value: string, options: SetOptions = {}): TransactionBuilder {
                commands.push({ cmd: 'set', key, value, options });
                return txn;
            },
            del: function(key: string): TransactionBuilder {
                commands.push({ cmd: 'del', key });
                return txn;
            },
            sAdd: function(key: string, ...members: string[]): TransactionBuilder {
                commands.push({ cmd: 'sAdd', key, members });
                return txn;
            },
            sRem: function(key: string, ...members: string[]): TransactionBuilder {
                commands.push({ cmd: 'sRem', key, members });
                return txn;
            },
            expire: function(key: string, seconds: number): TransactionBuilder {
                commands.push({ cmd: 'expire', key, seconds });
                return txn;
            },
            lPush: function(key: string, ...values: string[]): TransactionBuilder {
                commands.push({ cmd: 'lPush', key, values });
                return txn;
            },
            lTrim: function(key: string, start: number, stop: number): TransactionBuilder {
                commands.push({ cmd: 'lTrim', key, start, stop });
                return txn;
            },
            zAdd: function(key: string, ...items: ZAddItem[]): TransactionBuilder {
                commands.push({ cmd: 'zAdd', key, items });
                return txn;
            },
            zRemRangeByRank: function(key: string, start: number, stop: number): TransactionBuilder {
                commands.push({ cmd: 'zRemRangeByRank', key, start, stop });
                return txn;
            },
            exec: async function(): Promise<(string | number | null)[] | null> {
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
                    let currentJson: string | null = null;
                    if (storage.data.has(key)) {
                        currentJson = JSON.stringify(storage.data.get(key));
                    } else if (storage.sets.has(key)) {
                        currentJson = JSON.stringify([...storage.sets.get(key)!].sort());
                    } else if (storage.lists.has(key)) {
                        currentJson = JSON.stringify(storage.lists.get(key));
                    } else if (storage.sortedSets.has(key)) {
                        const zset = storage.sortedSets.get(key)!;
                        currentJson = JSON.stringify([...zset.entries()].sort());
                    }
                    if (currentJson !== originalValue) {
                        // Key was modified - transaction failed
                        storage._watchedKeys.clear();
                        return null;
                    }
                }

                // Execute all commands
                const results: (string | number | null)[] = [];
                for (const cmd of commands) {
                    try {
                        switch (cmd.cmd) {
                            case 'set':
                                // FIX: Remove from all type-specific maps (type change)
                                storage.sets.delete(cmd.key);
                                storage.lists.delete(cmd.key);
                                storage.sortedSets.delete(cmd.key);
                                storage.data.set(cmd.key, cmd.value!);
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
                                for (const m of cmd.members!) {
                                    if (!storage.sets.get(cmd.key)!.has(m)) {
                                        storage.sets.get(cmd.key)!.add(m);
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
                                    for (const m of cmd.members!) {
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
                                    storage.expiries.set(cmd.key, Date.now() + (cmd.seconds! * 1000));
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
                                const list = storage.lists.get(cmd.key)!;
                                // lPush adds to the head (beginning) of the list
                                // Redis LPUSH pushes elements one by one in order given
                                // Use a single unshift with reversed values for O(n) instead of O(n*k)
                                const txReversed = [...cmd.values!].reverse();
                                list.unshift(...txReversed);
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
                                const trimStart = cmd.start! < 0 ? Math.max(trimLen + cmd.start!, 0) : Math.min(cmd.start!, trimLen);
                                const trimStop = cmd.stop! < 0 ? trimLen + cmd.stop! : Math.min(cmd.stop!, trimLen - 1);
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
                                const zset = storage.sortedSets.get(cmd.key)!;
                                let zAdded = 0;
                                for (const item of cmd.items!) {
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
                                const zStart = cmd.start! < 0 ? Math.max(zLen + cmd.start!, 0) : Math.min(cmd.start!, zLen);
                                const zStop = cmd.stop! < 0 ? zLen + cmd.stop! : Math.min(cmd.stop!, zLen - 1);
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
                        logger.error(`Transaction command failed: ${cmd.cmd}`, { error: (e as Error).message, key: cmd.key });
                        results.push(null);
                    }
                }

                storage._watchedKeys.clear();
                return results;
            }
        };

        return txn;
    }

    // ========================================================================
    // Async iterator for SCAN (used by timerService)
    // ========================================================================

    async *scanIterator(options: ScanIteratorOptions = {}): AsyncGenerator<string> {
        const pattern = options.MATCH || '*';
        const regex = this._globToRegex(pattern);
        const yielded = new Set<string>();

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

    // ========================================================================
    // Memory management
    // ========================================================================

    /**
     * Force cleanup of expired keys and run eviction if needed.
     * Called by memory monitoring when heap usage exceeds critical threshold.
     * Returns the number of keys cleaned/evicted.
     */
    forceCleanup(): number {
        const before = this._totalKeyCount();
        this._cleanupExpired();
        const after = this._totalKeyCount();
        return before - after;
    }

    /**
     * Get the current total key count across all data structures.
     */
    getKeyCount(): number {
        return this._totalKeyCount();
    }

    // ========================================================================
    // Health check
    // ========================================================================

    async ping(): Promise<string> {
        return 'PONG';
    }

    // ========================================================================
    // Connection management
    // ========================================================================

    /**
     * Duplicate for pub/sub clients
     * Returns a new instance that shares data but has independent state
     */
    duplicate(): MemoryStorage {
        const clone = new MemoryStorage(true);
        return clone;
    }

    async connect(): Promise<MemoryStorage> {
        this.isOpen = true;
        logger.info('Memory storage initialized (single-instance mode)');
        return this;
    }

    async quit(): Promise<string> {
        this.isOpen = false;
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }
        this.cleanupInterval = null;
        // SPRINT-15 FIX: Clean up event handlers to prevent memory leaks
        this._eventHandlers.clear();
        // FIX: Do NOT clear shared pubsubChannels here - it would break pub/sub
        // for other instances (e.g., main client when pubClient calls quit())
        // pubsubChannels is intentionally shared across all MemoryStorage instances
        return 'OK';
    }

    async disconnect(): Promise<string> {
        return this.quit();
    }

    // ========================================================================
    // Event handlers for compatibility with node-redis client
    // ========================================================================

    on(event: string, callback: EventCallback): MemoryStorage {
        if (!this._eventHandlers.has(event)) {
            this._eventHandlers.set(event, []);
        }
        this._eventHandlers.get(event)!.push(callback);

        // Immediately call 'ready' callback
        if (event === 'ready') {
            setImmediate(callback);
        }
        return this;
    }

    emit(event: string, ...args: unknown[]): void {
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

    removeListener(event: string, callback: EventCallback): MemoryStorage {
        const handlers = this._eventHandlers.get(event);
        if (handlers) {
            const index = handlers.indexOf(callback);
            if (index !== -1) {
                handlers.splice(index, 1);
            }
        }
        return this;
    }

    removeAllListeners(event?: string): MemoryStorage {
        if (event) {
            this._eventHandlers.delete(event);
        } else {
            this._eventHandlers.clear();
        }
        return this;
    }
}

// ============================================================================
// Singleton and Helper Functions
// ============================================================================

// Singleton instance
let memoryStorage: MemoryStorage | null = null;

/**
 * Get the singleton MemoryStorage instance
 */
export function getMemoryStorage(): MemoryStorage {
    if (!memoryStorage) {
        memoryStorage = new MemoryStorage();
    }
    return memoryStorage;
}

/**
 * Check if running in memory mode
 */
export function isMemoryMode(): boolean {
    const redisUrl = process.env['REDIS_URL'] || '';
    return redisUrl === 'memory' || redisUrl === 'memory://';
}

// CommonJS export for backward compatibility
module.exports = {
    MemoryStorage,
    getMemoryStorage,
    isMemoryMode,
    MAX_TOTAL_KEYS,
};
