// ========== DEBUG MODULE ==========
// State debugging utilities: proxy, mutation logging, history, watchers.
// Extracted from state.ts to keep the state module focused on data.
// Enable debug mode by setting localStorage.debug = 'codenames'

import type { AppState } from './stateTypes.js';

const DEBUG_KEY = 'codenames';

export const debugEnabled = (): boolean => {
    try {
        return localStorage.getItem('debug') === DEBUG_KEY;
    } catch {
        return false;
    }
};

// ========== STATE CHANGE HISTORY ==========

interface StateHistoryEntry {
    timestamp: string;
    property: string;
    oldValue: unknown;
    newValue: unknown;
    source: string;
    stack: string | undefined;
}

const stateHistory: StateHistoryEntry[] = [];
const MAX_HISTORY = 100;

function safeClone(obj: unknown): unknown {
    if (obj === null || typeof obj !== 'object') return obj;
    try {
        return JSON.parse(JSON.stringify(obj));
    } catch {
        return '[Circular or non-serializable]';
    }
}

export function logStateChange(property: string, oldValue: unknown, newValue: unknown, source: string = 'unknown'): void {
    if (!debugEnabled()) return;

    const entry: StateHistoryEntry = {
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

    console.log(`%c[State] ${property}`, 'color: #4a9eff; font-weight: bold',
        '\nFrom:', oldValue,
        '\nTo:', newValue,
        '\nSource:', source
    );
}

// ========== WATCHER SYSTEM ==========

type WatcherCallback = (oldValue: unknown, newValue: unknown) => void;
const watchers: Map<string, WatcherCallback[]> = new Map();

export function watchState(property: string, callback: WatcherCallback): () => void {
    if (!watchers.has(property)) {
        watchers.set(property, []);
    }
    watchers.get(property)!.push(callback);

    return () => {
        const list = watchers.get(property)!;
        const idx = list.indexOf(callback);
        if (idx >= 0) list.splice(idx, 1);
    };
}

// ========== STATE PROXY ==========

/**
 * Create a recursive Proxy that logs property mutations.
 * Sub-objects are wrapped lazily on access so the overhead is minimal.
 */
export function createStateProxy<T extends object>(target: T, path: string = 'state'): T {
    const subProxies = new WeakMap<object, object>();

    return new Proxy(target, {
        get(obj: T, prop: string | symbol): unknown {
            const value = Reflect.get(obj, prop);
            if (value !== null && typeof value === 'object' && typeof prop === 'string') {
                if (!subProxies.has(value as object)) {
                    subProxies.set(value as object, createStateProxy(value as object, `${path}.${prop}`));
                }
                return subProxies.get(value as object);
            }
            return value;
        },
        set(obj: T, prop: string | symbol, value: unknown): boolean {
            const oldValue = Reflect.get(obj, prop);
            const result = Reflect.set(obj, prop, value);
            if (typeof prop === 'string' && oldValue !== value) {
                const fullPath = `${path}.${prop}`;
                if (oldValue !== null && typeof oldValue === 'object') {
                    subProxies.delete(oldValue as object);
                }
                logStateChange(fullPath, oldValue, value, 'proxy');
                const watcherList = watchers.get(fullPath);
                if (watcherList) {
                    for (const cb of watcherList) {
                        try { cb(oldValue, value); } catch { /* watcher errors are non-fatal */ }
                    }
                }
            }
            return result;
        }
    });
}

// ========== STRING-PATH STATE SETTER ==========

export function setState(state: AppState, property: string, value: unknown, source: string = 'unknown'): void {
    const parts = property.split('.');
    let target: Record<string, unknown> = state as unknown as Record<string, unknown>;

    for (let i = 0; i < parts.length - 1; i++) {
        target = target[parts[i]] as Record<string, unknown>;
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

export function getStateHistory(property: string | null = null): StateHistoryEntry[] {
    if (property) {
        return stateHistory.filter(entry => entry.property === property);
    }
    return [...stateHistory];
}

export function clearStateHistory(): void {
    stateHistory.length = 0;
}

export function getStateSnapshot(rawState: AppState): unknown {
    return safeClone(rawState);
}

export function dumpState(state: AppState): void {
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

export function attachDebugToWindow(rawState: AppState): void {
    if (typeof window !== 'undefined' && debugEnabled()) {
        (window as Window).__codenamesDebug = {
            getState: () => getStateSnapshot(rawState),
            getHistory: getStateHistory,
            clearHistory: clearStateHistory,
            dumpState: () => dumpState(rawState),
            watchState,
            disableDebug: () => {
                localStorage.removeItem('debug');
                delete (window as Window).__codenamesDebug;
                console.log('%c[Debug] Disabled — reload to take full effect', 'color: #ff0000');
            }
        };

        console.log('%c[Codenames Debug Mode Active]', 'color: #4a9eff; font-weight: bold',
            '\nUse window.__codenamesDebug for debugging utilities');
    }
}
