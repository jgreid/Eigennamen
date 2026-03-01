/**
 * Lightweight notification channel for game state mutations.
 *
 * The game service calls `notifyGameMutation(roomCode)` after any
 * write to Redis. The player-context cache subscribes via
 * `onGameMutation()` and invalidates its entry, eliminating the
 * manual `invalidateGameStateCache()` calls that handlers previously
 * had to remember.
 *
 * This module exists solely to break the circular dependency between
 * `gameService` (which writes) and `playerContext` (which caches reads).
 */

type MutationListener = (roomCode: string) => void;

const listeners: MutationListener[] = [];

/** Register a callback to be invoked whenever a game is mutated. */
export function onGameMutation(listener: MutationListener): void {
    listeners.push(listener);
}

/** Notify all listeners that game state for `roomCode` has changed. */
export function notifyGameMutation(roomCode: string): void {
    for (const listener of listeners) {
        listener(roomCode);
    }
}
