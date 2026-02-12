// ========== DEBUG MODULE ==========
// State debugging utilities: proxy, mutation logging, history, watchers.
// Extracted from state.ts to keep the state module focused on data.
// Enable debug mode by setting localStorage.debug = 'codenames'
const DEBUG_KEY = 'codenames';
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
        stack: new Error().stack?.split('\n').slice(2, 5).join('\n')
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
// ========== STATE PROXY ==========
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
                        catch { /* watcher errors are non-fatal */ }
                    }
                }
            }
            return result;
        }
    });
}
// ========== STRING-PATH STATE SETTER ==========
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
// ========== INSPECTION UTILITIES ==========
export function getStateHistory(property = null) {
    if (property) {
        return stateHistory.filter(entry => entry.property === property);
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
// ========== WINDOW DEBUG ATTACHMENT ==========
export function attachDebugToWindow(rawState) {
    if (typeof window !== 'undefined' && debugEnabled()) {
        window.__codenamesDebug = {
            getState: () => getStateSnapshot(rawState),
            getHistory: getStateHistory,
            clearHistory: clearStateHistory,
            dumpState: () => dumpState(rawState),
            watchState,
            disableDebug: () => {
                localStorage.removeItem('debug');
                delete window.__codenamesDebug;
                console.log('%c[Debug] Disabled — reload to take full effect', 'color: #ff0000');
            }
        };
        console.log('%c[Codenames Debug Mode Active]', 'color: #4a9eff; font-weight: bold', '\nUse window.__codenamesDebug for debugging utilities');
    }
}
//# sourceMappingURL=debug.js.map