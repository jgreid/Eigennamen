/**
 * Lightweight notification channel for game state mutations.
 *
 * The game service calls `notifyGameMutation(roomCode)` after any
 * write to Redis. The player-context cache subscribes via
 * `onGameMutation()` and invalidates its entry, so handlers don't
 * need to manually call `invalidateGameStateCache()`.
 *
 * This module exists solely to break the circular dependency between
 * `gameService` (which writes) and `playerContext` (which caches reads).
 */

type MutationListener = (roomCode: string) => void;

const listeners: MutationListener[] = [];

/** Register a callback to be invoked whenever a game is mutated.
 *  @returns Unsubscribe function that removes the listener.
 */
export function onGameMutation(listener: MutationListener): () => void {
    listeners.push(listener);
    return () => {
        const idx = listeners.indexOf(listener);
        if (idx >= 0) listeners.splice(idx, 1);
    };
}

/** Notify all listeners that game state for `roomCode` has changed. */
export function notifyGameMutation(roomCode: string): void {
    // Snapshot the array so removals during iteration don't skip callbacks.
    const snapshot = [...listeners];
    for (const listener of snapshot) {
        listener(roomCode);
    }
}
