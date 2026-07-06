import { WatchError } from 'redis';

/**
 * node-redis v5 THROWS a `WatchError` out of `multi().exec()` when a WATCHed key
 * was modified between `watch()` and `exec()` (a dirty optimistic-lock conflict).
 * ioredis returned `null` instead — so any retry loop that only checks
 * `exec() === null` never fires on v5, and a genuine conflict surfaces as a lost
 * write / generic SERVER_ERROR. Detecting the WatchError is how those loops know
 * to re-read and retry.
 *
 * Matches by constructor name in addition to `instanceof` so it still fires if
 * two copies of `@redis/client` are resolved in the dependency tree (the
 * instanceof-across-dual-package hazard).
 */
export function isWatchError(error: unknown): boolean {
    if (error instanceof WatchError) {
        return true;
    }
    return error instanceof Error && error.constructor?.name === 'WatchError';
}
