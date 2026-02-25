/**
 * Check if running in memory mode (embedded Redis).
 * Single source of truth for memory mode detection.
 *
 * Kept in a separate zero-dependency module so that:
 * 1. All three previous copies (redis.ts, roomConfig.ts, env.ts) converge here
 * 2. Test mocks of redis.ts don't break roomConfig.ts at import time
 */
export function isMemoryMode(): boolean {
    const redisUrl = process.env['REDIS_URL'] || '';
    return redisUrl === 'memory' || redisUrl === 'memory://';
}
