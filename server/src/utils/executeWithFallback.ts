/**
 * Generic Lua-first / WATCH-MULTI fallback execution pattern.
 *
 * Several services (updatePlayer, removePlayer, setSocketMapping) implement
 * the same pattern: try a Lua script for atomicity, fall back to sequential
 * Redis operations if the script fails. This utility extracts that pattern.
 *
 * Does NOT retry on application-level errors (player not found, corrupted
 * data) — only on transient infrastructure failures (Redis unavailable,
 * script loading errors, timeouts).
 */

import logger from './logger';

export interface LuaWithFallbackOptions<T> {
    /** Try the Lua script first */
    lua: () => Promise<T>;
    /** Fall back to sequential operations if Lua fails */
    fallback: () => Promise<T>;
    /** Operation name for logging */
    operationName: string;
    /** Error classes that should NOT trigger fallback (re-thrown immediately) */
    applicationErrors?: Array<new (...args: unknown[]) => Error>;
}

/**
 * Execute a Lua script with automatic fallback to sequential operations.
 *
 * Application errors (e.g., player not found, validation failures) are
 * re-thrown immediately. Only infrastructure errors trigger the fallback.
 */
export async function executeWithFallback<T>(options: LuaWithFallbackOptions<T>): Promise<T> {
    const { lua, fallback, operationName, applicationErrors = [] } = options;

    try {
        return await lua();
    } catch (luaError) {
        // Propagate application errors without fallback
        for (const ErrorClass of applicationErrors) {
            if (luaError instanceof ErrorClass) {
                throw luaError;
            }
        }

        logger.warn(`Lua ${operationName} failed, falling back to sequential: ${(luaError as Error).message}`);

        return await fallback();
    }
}
