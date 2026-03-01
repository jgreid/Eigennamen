import { subscribe as busSubscribe } from './store/eventBus.js';
const DEBUG_KEY = 'eigennamen';
export const debugEnabled = () => {
    try {
        return localStorage.getItem('debug') === DEBUG_KEY;
    }
    catch {
        return false;
    }
};
const stateHistory = [];
const MAX_HISTORY = 100;
function safeClone(obj) {
    if (obj === null || typeof obj !== 'object')
        return obj;
    try {
        return JSON.parse(JSON.stringify(obj));
    }
    catch {
        return '[Circular or non-serializable]';
    }
}
export function logStateChange(property, oldValue, newValue, source = 'unknown') {
    if (!debugEnabled())
        return;
    const entry = {
        timestamp: new Date().toISOString(),
        property,
        oldValue: safeClone(oldValue),
        newValue: safeClone(newValue),
        source,
        stack: new Error().stack?.split('\n').slice(2, 5).join('\n'),
    };
    stateHistory.push(entry);
    if (stateHistory.length > MAX_HISTORY) {
        stateHistory.shift();
    }
    console.log(`%c[State] ${property}`, 'color: #4a9eff; font-weight: bold', '\nFrom:', oldValue, '\nTo:', newValue, '\nSource:', source);
}
const watchers = new Map();
export function watchState(property, callback) {
    if (!watchers.has(property)) {
        watchers.set(property, []);
    }
    watchers.get(property).push(callback);
    return () => {
        const list = watchers.get(property);
        const idx = list.indexOf(callback);
        if (idx >= 0)
            list.splice(idx, 1);
    };
}
/**
 * Create a recursive Proxy that logs property mutations.
 * Sub-objects are wrapped lazily on access so the overhead is minimal.
 */
export function createStateProxy(target, path = 'state') {
    const subProxies = new WeakMap();
    return new Proxy(target, {
        get(obj, prop) {
            const value = Reflect.get(obj, prop);
            if (value !== null && typeof value === 'object' && typeof prop === 'string') {
                if (!subProxies.has(value)) {
                    subProxies.set(value, createStateProxy(value, `${path}.${prop}`));
                }
                return subProxies.get(value);
            }
            return value;
        },
        set(obj, prop, value) {
            const oldValue = Reflect.get(obj, prop);
            const result = Reflect.set(obj, prop, value);
            if (typeof prop === 'string' && oldValue !== value) {
                const fullPath = `${path}.${prop}`;
                if (oldValue !== null && typeof oldValue === 'object') {
                    subProxies.delete(oldValue);
                }
                logStateChange(fullPath, oldValue, value, 'proxy');
                const watcherList = watchers.get(fullPath);
                if (watcherList) {
                    for (const cb of watcherList) {
                        try {
                            cb(oldValue, value);
                        }
                        catch {
                            /* watcher errors are non-fatal */
                        }
                    }
                }
            }
            return result;
        },
    });
}
export function setState(state, property, value, source = 'unknown') {
    const parts = property.split('.');
    let target = state;
    for (let i = 0; i < parts.length - 1; i++) {
        target = target[parts[i]];
        if (target === undefined) {
            console.error(`[State] Invalid property path: ${property}`);
            return;
        }
    }
    const lastPart = parts[parts.length - 1];
    const oldValue = target[lastPart];
    target[lastPart] = value;
    logStateChange(property, oldValue, value, source);
}
export function getStateHistory(property = null) {
    if (property) {
        return stateHistory.filter((entry) => entry.property === property);
    }
    return [...stateHistory];
}
export function clearStateHistory() {
    stateHistory.length = 0;
}
export function getStateSnapshot(rawState) {
    return safeClone(rawState);
}
export function dumpState(state) {
    console.group('%c[State Dump]', 'color: #4a9eff; font-weight: bold');
    console.log('isMultiplayerMode:', state.isMultiplayerMode);
    console.log('currentRoomId:', state.currentRoomId);
    console.log('isHost:', state.isHost);
    console.log('playerTeam:', state.playerTeam);
    console.log('spymasterTeam:', state.spymasterTeam);
    console.log('clickerTeam:', state.clickerTeam);
    console.log('gameState:', safeClone(state.gameState));
    console.log('timerState:', safeClone(state.timerState));
    console.log('multiplayerPlayers:', state.multiplayerPlayers.length, 'players');
    console.groupEnd();
}
/**
 * Subscribe to the store event bus for debug logging and watcher dispatch.
 * Called once from state.ts initialization. This bridges the new reactive
 * proxy (which emits via the event bus) with the existing debug/watcher system.
 */
let debugSubscriptionsInitialized = false;
export function initDebugSubscriptions() {
    if (debugSubscriptionsInitialized)
        return;
    debugSubscriptionsInitialized = true;
    // Subscribe to all state changes via the event bus.
    // Use a catch-all by subscribing to 'state.*' — the reactive proxy
    // emits paths like 'state.gameState.currentTurn'.
    busSubscribe('state.*', (event) => {
        // Debug logging (gated)
        logStateChange(event.path, event.oldValue, event.newValue, 'proxy');
        // Dispatch to legacy watchers
        const watcherList = watchers.get(event.path);
        if (watcherList) {
            for (const cb of watcherList) {
                try {
                    cb(event.oldValue, event.newValue);
                }
                catch {
                    /* non-fatal */
                }
            }
        }
    });
}
export function attachDebugToWindow(rawState) {
    if (typeof window !== 'undefined' && debugEnabled()) {
        window.__eigennamenDebug = {
            getState: () => getStateSnapshot(rawState),
            getHistory: getStateHistory,
            clearHistory: clearStateHistory,
            dumpState: () => dumpState(rawState),
            watchState,
            disableDebug: () => {
                localStorage.removeItem('debug');
                delete window.__eigennamenDebug;
                console.log('%c[Debug] Disabled — reload to take full effect', 'color: #ff0000');
            },
        };
        console.log('%c[Eigennamen Debug Mode Active]', 'color: #4a9eff; font-weight: bold', '\nUse window.__eigennamenDebug for debugging utilities');
    }
}
//# sourceMappingURL=debug.js.map