/**
 * Shared Redis Client Type Definitions
 *
 * Unified interface for Redis client used across all services.
 * Eliminates the duplicated RedisClient interface that was
 * independently defined in 9 different files.
 */

// ============================================================================
// Redis Transaction / Pipeline
// ============================================================================

/**
 * Redis transaction (MULTI/EXEC) with chained commands.
 * Used with WATCH for optimistic locking.
 */
export interface RedisMulti {
    set(key: string, value: string, options?: { EX?: number }): RedisMulti;
    zAdd(key: string, member: { score: number; value: string }, options?: { NX?: boolean }): RedisMulti;
    zRemRangeByRank(key: string, start: number, stop: number): RedisMulti;
    expire(key: string, seconds: number): RedisMulti;
    exec(): Promise<unknown[] | null>;
}

// ============================================================================
// Redis Client
// ============================================================================

/**
 * Unified Redis client interface covering all methods used across the codebase.
 *
 * This is a structural subset of the real node-redis client — any method listed
 * here must exist on the actual client returned by `getRedis()`.
 */
export interface RedisClient {
    // ── String commands ──────────────────────────────────────────────
    get(key: string): Promise<string | null>;
    set(key: string, value: string, options?: { EX?: number; NX?: boolean }): Promise<string | null>;

    // ── Key commands ─────────────────────────────────────────────────
    del(key: string | string[]): Promise<number>;
    exists(key: string): Promise<number>;
    expire(key: string, seconds: number): Promise<number>;
    ttl(key: string): Promise<number>;

    // ── Batch commands ───────────────────────────────────────────────
    mGet(keys: string[]): Promise<(string | null)[]>;

    // ── Set commands ─────────────────────────────────────────────────
    // CRITICAL FIX: Accept variadic members to match actual usage across services
    sAdd(key: string, ...members: string[]): Promise<number>;
    sRem(key: string, ...members: string[]): Promise<number>;
    sMembers(key: string): Promise<string[]>;
    sCard(key: string): Promise<number>;
    sIsMember(key: string, value: string): Promise<boolean>;

    // ── Sorted set commands ──────────────────────────────────────────
    zAdd(key: string, member: { score: number; value: string }, options?: { NX?: boolean }): Promise<number>;
    zRem(key: string, member: string | string[]): Promise<number>;
    zRange(key: string, start: number, stop: number, options?: { REV?: boolean; WITHSCORES?: boolean }): Promise<string[] | Array<{ value: string; score: number }>>;
    zRangeByScore(key: string, min: number, max: number, options?: { LIMIT?: { offset: number; count: number } }): Promise<string[]>;
    zRemRangeByRank(key: string, start: number, stop: number): Promise<number>;
    zCard(key: string): Promise<number>;

    // ── List commands ────────────────────────────────────────────────
    lPush(key: string, value: string): Promise<number>;
    lTrim(key: string, start: number, stop: number): Promise<string>;
    lRange(key: string, start: number, stop: number): Promise<string[]>;
    lLen(key: string): Promise<number>;

    // ── Transaction commands ─────────────────────────────────────────
    watch(key: string): Promise<string>;
    unwatch(): Promise<string>;
    multi(): RedisMulti;

    // ── Scripting ────────────────────────────────────────────────────
    eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;

    // ── Scan ─────────────────────────────────────────────────────────
    // cursor return type is string (matching Redis protocol)
    scan?(cursor: string, options: { MATCH: string; COUNT: number }): Promise<{ cursor: string; keys: string[] }>;
    scanIterator?(options: { MATCH: string; COUNT?: number }): AsyncIterable<string>;
}
