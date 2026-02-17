/**
 * Frontend Debug Module Tests
 *
 * Tests debug utilities: state proxy, mutation logging, history, watchers, and window attachment.
 * Test environment: jsdom
 */

import {
    debugEnabled,
    logStateChange,
    watchState,
    createStateProxy,
    setState,
    getStateHistory,
    clearStateHistory,
    getStateSnapshot,
    dumpState,
    attachDebugToWindow,
} from '../../frontend/debug';
import type { AppState } from '../../frontend/stateTypes';

// Minimal AppState stub for testing (only fields used by debug.ts)
function createMockState(): AppState {
    return {
        isMultiplayerMode: false,
        currentRoomId: null,
        isHost: false,
        playerTeam: null,
        spymasterTeam: null,
        clickerTeam: null,
        gameState: { currentTurn: 'red', gameOver: false } as AppState['gameState'],
        timerState: { active: false } as AppState['timerState'],
        multiplayerPlayers: [],
    } as AppState;
}

beforeEach(() => {
    localStorage.clear();
    clearStateHistory();
});

// ========== DEBUG ENABLED ==========

describe('debugEnabled', () => {
    test('returns false when localStorage has no debug key', () => {
        expect(debugEnabled()).toBe(false);
    });

    test('returns true when debug is set to eigennamen', () => {
        localStorage.setItem('debug', 'eigennamen');
        expect(debugEnabled()).toBe(true);
    });

    test('returns false when debug key has wrong value', () => {
        localStorage.setItem('debug', 'other');
        expect(debugEnabled()).toBe(false);
    });
});

// ========== LOG STATE CHANGE ==========

describe('logStateChange', () => {
    test('does nothing when debug disabled', () => {
        const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
        logStateChange('foo', 1, 2, 'test');
        expect(consoleSpy).not.toHaveBeenCalled();
        consoleSpy.mockRestore();
    });

    test('logs change and records history when debug enabled', () => {
        localStorage.setItem('debug', 'eigennamen');
        const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
        logStateChange('state.playerTeam', null, 'red', 'test');

        expect(consoleSpy).toHaveBeenCalled();
        const history = getStateHistory();
        expect(history.length).toBe(1);
        expect(history[0].property).toBe('state.playerTeam');
        expect(history[0].oldValue).toBeNull();
        expect(history[0].newValue).toBe('red');
        consoleSpy.mockRestore();
    });

    test('limits history to MAX_HISTORY entries', () => {
        localStorage.setItem('debug', 'eigennamen');
        jest.spyOn(console, 'log').mockImplementation();
        for (let i = 0; i < 110; i++) {
            logStateChange(`prop${i}`, i, i + 1, 'test');
        }
        expect(getStateHistory().length).toBe(100);
        jest.restoreAllMocks();
    });
});

// ========== WATCH STATE ==========

describe('watchState', () => {
    test('returns unsubscribe function', () => {
        const cb = jest.fn();
        const unsub = watchState('state.playerTeam', cb);
        expect(typeof unsub).toBe('function');
    });

    test('unsubscribe removes the callback', () => {
        const cb = jest.fn();
        const unsub = watchState('state.playerTeam', cb);
        unsub();
        // No error after unsubscribing
    });
});

// ========== STATE PROXY ==========

describe('createStateProxy', () => {
    test('tracks property mutations', () => {
        localStorage.setItem('debug', 'eigennamen');
        jest.spyOn(console, 'log').mockImplementation();

        const obj = { name: 'test', count: 0 };
        const proxy = createStateProxy(obj, 'state');

        proxy.count = 5;
        expect(obj.count).toBe(5);

        const history = getStateHistory('state.count');
        expect(history.length).toBe(1);
        expect(history[0].oldValue).toBe(0);
        expect(history[0].newValue).toBe(5);
        jest.restoreAllMocks();
    });

    test('triggers watcher callbacks on change', () => {
        localStorage.setItem('debug', 'eigennamen');
        jest.spyOn(console, 'log').mockImplementation();

        const obj = { value: 'a' };
        const proxy = createStateProxy(obj, 'state');
        const cb = jest.fn();
        watchState('state.value', cb);

        proxy.value = 'b';
        expect(cb).toHaveBeenCalledWith('a', 'b');
        jest.restoreAllMocks();
    });

    test('wraps nested objects in sub-proxies', () => {
        localStorage.setItem('debug', 'eigennamen');
        jest.spyOn(console, 'log').mockImplementation();

        const obj = { nested: { x: 1 } };
        const proxy = createStateProxy(obj, 'state');

        proxy.nested.x = 2;
        expect(obj.nested.x).toBe(2);
        const history = getStateHistory('state.nested.x');
        expect(history.length).toBe(1);
        jest.restoreAllMocks();
    });

    test('returns primitive values directly', () => {
        const obj = { name: 'test', count: 42, flag: true };
        const proxy = createStateProxy(obj);
        expect(proxy.name).toBe('test');
        expect(proxy.count).toBe(42);
        expect(proxy.flag).toBe(true);
    });
});

// ========== SET STATE ==========

describe('setState', () => {
    test('sets a top-level property', () => {
        const mockState = createMockState();
        setState(mockState, 'isHost', true, 'test');
        expect(mockState.isHost).toBe(true);
    });

    test('sets a nested property', () => {
        const mockState = createMockState();
        setState(mockState, 'gameState.currentTurn', 'blue', 'test');
        expect(mockState.gameState.currentTurn).toBe('blue');
    });

    test('handles invalid property path gracefully', () => {
        const mockState = createMockState();
        const errorSpy = jest.spyOn(console, 'error').mockImplementation();
        setState(mockState, 'nonexistent.deep.path', 'value', 'test');
        expect(errorSpy).toHaveBeenCalled();
        errorSpy.mockRestore();
    });
});

// ========== HISTORY & SNAPSHOT ==========

describe('getStateHistory', () => {
    test('returns empty array when no history', () => {
        expect(getStateHistory()).toEqual([]);
    });

    test('filters by property when specified', () => {
        localStorage.setItem('debug', 'eigennamen');
        jest.spyOn(console, 'log').mockImplementation();
        logStateChange('a', 1, 2);
        logStateChange('b', 3, 4);

        expect(getStateHistory('a').length).toBe(1);
        expect(getStateHistory('b').length).toBe(1);
        expect(getStateHistory('c').length).toBe(0);
        jest.restoreAllMocks();
    });
});

describe('clearStateHistory', () => {
    test('empties the history', () => {
        localStorage.setItem('debug', 'eigennamen');
        jest.spyOn(console, 'log').mockImplementation();
        logStateChange('x', 1, 2);
        expect(getStateHistory().length).toBe(1);

        clearStateHistory();
        expect(getStateHistory().length).toBe(0);
        jest.restoreAllMocks();
    });
});

describe('getStateSnapshot', () => {
    test('returns a deep clone of state', () => {
        const mockState = createMockState();
        const snapshot = getStateSnapshot(mockState) as Record<string, unknown>;
        expect(snapshot).not.toBe(mockState);
        expect((snapshot as any).isHost).toBe(false);
    });
});

// ========== DUMP STATE ==========

describe('dumpState', () => {
    test('logs state to console', () => {
        const mockState = createMockState();
        const groupSpy = jest.spyOn(console, 'group').mockImplementation();
        const logSpy = jest.spyOn(console, 'log').mockImplementation();
        const groupEndSpy = jest.spyOn(console, 'groupEnd').mockImplementation();

        dumpState(mockState);

        expect(groupSpy).toHaveBeenCalled();
        expect(logSpy).toHaveBeenCalled();
        expect(groupEndSpy).toHaveBeenCalled();

        groupSpy.mockRestore();
        logSpy.mockRestore();
        groupEndSpy.mockRestore();
    });
});

// ========== ATTACH DEBUG TO WINDOW ==========

describe('attachDebugToWindow', () => {
    test('does nothing when debug is disabled', () => {
        const mockState = createMockState();
        attachDebugToWindow(mockState);
        expect((window as any).__eigennamenDebug).toBeUndefined();
    });

    test('attaches debug utilities when debug is enabled', () => {
        localStorage.setItem('debug', 'eigennamen');
        jest.spyOn(console, 'log').mockImplementation();
        const mockState = createMockState();
        attachDebugToWindow(mockState);

        const dbg = (window as any).__eigennamenDebug;
        expect(dbg).toBeDefined();
        expect(typeof dbg.getState).toBe('function');
        expect(typeof dbg.getHistory).toBe('function');
        expect(typeof dbg.clearHistory).toBe('function');
        expect(typeof dbg.dumpState).toBe('function');
        expect(typeof dbg.watchState).toBe('function');
        expect(typeof dbg.disableDebug).toBe('function');
        jest.restoreAllMocks();
    });

    test('disableDebug removes debug from window', () => {
        localStorage.setItem('debug', 'eigennamen');
        jest.spyOn(console, 'log').mockImplementation();
        const mockState = createMockState();
        attachDebugToWindow(mockState);

        (window as any).__eigennamenDebug.disableDebug();
        expect((window as any).__eigennamenDebug).toBeUndefined();
        expect(localStorage.getItem('debug')).toBeNull();
        jest.restoreAllMocks();
    });
});
