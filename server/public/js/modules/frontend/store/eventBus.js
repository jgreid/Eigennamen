/**
 * Lightweight typed pub/sub event bus for state change notifications.
 *
 * Topics are dot-path state paths ('gameState.currentTurn', 'playerTeam')
 * plus domain events ('batch:complete').
 * Supports wildcard subscribers ('gameState.*') for slice-level listening.
 */
const MAX_LISTENERS_PER_TOPIC = 50;
const exactListeners = new Map();
const wildcardListeners = new Map();
/**
 * Subscribe to state changes on a specific path or wildcard pattern.
 * - Exact: `subscribe('gameState.currentTurn', cb)`
 * - Wildcard: `subscribe('gameState.*', cb)` — matches any child of gameState
 * @returns Unsubscribe function
 */
export function subscribe(topic, callback) {
    const isWildcard = topic.endsWith('.*');
    const map = isWildcard ? wildcardListeners : exactListeners;
    const key = isWildcard ? topic.slice(0, -2) : topic;
    if (!map.has(key)) {
        map.set(key, []);
    }
    const list = map.get(key);
    if (list.length >= MAX_LISTENERS_PER_TOPIC) {
        console.warn(`[EventBus] Topic "${topic}" has ${list.length} listeners — possible leak`);
    }
    list.push(callback);
    return () => {
        const idx = list.indexOf(callback);
        if (idx >= 0)
            list.splice(idx, 1);
        if (list.length === 0)
            map.delete(key);
    };
}
/**
 * Emit a state change event.
 * Notifies exact subscribers for the path, then wildcard subscribers
 * for any parent prefix.
 */
export function emit(event) {
    // Exact listeners
    const exact = exactListeners.get(event.path);
    if (exact) {
        for (const cb of exact) {
            try {
                cb(event);
            }
            catch { /* subscriber errors are non-fatal */ }
        }
    }
    // Wildcard listeners: check each parent prefix
    // e.g. path 'gameState.currentTurn' matches wildcard 'gameState.*'
    const parts = event.path.split('.');
    for (let i = parts.length - 1; i >= 1; i--) {
        const prefix = parts.slice(0, i).join('.');
        const wildcards = wildcardListeners.get(prefix);
        if (wildcards) {
            for (const cb of wildcards) {
                try {
                    cb(event);
                }
                catch { /* subscriber errors are non-fatal */ }
            }
        }
    }
}
/**
 * Remove all listeners. Used in tests.
 */
export function clearAllListeners() {
    exactListeners.clear();
    wildcardListeners.clear();
}
/**
 * Get total listener count (for debugging/leak detection).
 */
export function getListenerCount() {
    let count = 0;
    for (const list of exactListeners.values())
        count += list.length;
    for (const list of wildcardListeners.values())
        count += list.length;
    return count;
}
//# sourceMappingURL=eventBus.js.map