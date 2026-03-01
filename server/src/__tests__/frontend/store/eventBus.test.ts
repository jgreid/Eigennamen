/**
 * EventBus unit tests
 */

import { subscribe, emit, clearAllListeners, getListenerCount } from '../../../frontend/store/eventBus';
import type { StateChangeEvent } from '../../../frontend/store/eventBus';

beforeEach(() => {
    clearAllListeners();
});

describe('subscribe / emit', () => {
    test('exact subscriber receives matching events', () => {
        const cb = jest.fn();
        subscribe('gameState.currentTurn', cb);

        const event: StateChangeEvent = { path: 'gameState.currentTurn', oldValue: 'red', newValue: 'blue' };
        emit(event);

        expect(cb).toHaveBeenCalledTimes(1);
        expect(cb).toHaveBeenCalledWith(event);
    });

    test('exact subscriber does not receive non-matching events', () => {
        const cb = jest.fn();
        subscribe('gameState.currentTurn', cb);

        emit({ path: 'gameState.redScore', oldValue: 0, newValue: 1 });

        expect(cb).not.toHaveBeenCalled();
    });

    test('wildcard subscriber receives child events', () => {
        const cb = jest.fn();
        subscribe('gameState.*', cb);

        const event: StateChangeEvent = { path: 'gameState.currentTurn', oldValue: 'red', newValue: 'blue' };
        emit(event);

        expect(cb).toHaveBeenCalledTimes(1);
        expect(cb).toHaveBeenCalledWith(event);
    });

    test('wildcard subscriber receives deeply nested events', () => {
        const cb = jest.fn();
        subscribe('state.*', cb);

        emit({ path: 'state.gameState.currentTurn', oldValue: 'red', newValue: 'blue' });

        expect(cb).toHaveBeenCalledTimes(1);
    });

    test('wildcard subscriber does not receive non-matching events', () => {
        const cb = jest.fn();
        subscribe('timerState.*', cb);

        emit({ path: 'gameState.currentTurn', oldValue: 'red', newValue: 'blue' });

        expect(cb).not.toHaveBeenCalled();
    });

    test('multiple subscribers on same topic all fire', () => {
        const cb1 = jest.fn();
        const cb2 = jest.fn();
        subscribe('playerTeam', cb1);
        subscribe('playerTeam', cb2);

        emit({ path: 'playerTeam', oldValue: null, newValue: 'red' });

        expect(cb1).toHaveBeenCalledTimes(1);
        expect(cb2).toHaveBeenCalledTimes(1);
    });

    test('subscriber errors do not propagate', () => {
        const thrower = jest.fn(() => {
            throw new Error('boom');
        });
        const cb = jest.fn();
        subscribe('playerTeam', thrower);
        subscribe('playerTeam', cb);

        emit({ path: 'playerTeam', oldValue: null, newValue: 'red' });

        expect(thrower).toHaveBeenCalledTimes(1);
        expect(cb).toHaveBeenCalledTimes(1);
    });
});

describe('unsubscribe', () => {
    test('returned function removes the subscriber', () => {
        const cb = jest.fn();
        const unsub = subscribe('playerTeam', cb);

        unsub();
        emit({ path: 'playerTeam', oldValue: null, newValue: 'red' });

        expect(cb).not.toHaveBeenCalled();
    });

    test('unsubscribing one does not affect others', () => {
        const cb1 = jest.fn();
        const cb2 = jest.fn();
        const unsub1 = subscribe('playerTeam', cb1);
        subscribe('playerTeam', cb2);

        unsub1();
        emit({ path: 'playerTeam', oldValue: null, newValue: 'red' });

        expect(cb1).not.toHaveBeenCalled();
        expect(cb2).toHaveBeenCalledTimes(1);
    });

    test('double unsubscribe is safe', () => {
        const cb = jest.fn();
        const unsub = subscribe('playerTeam', cb);
        unsub();
        expect(() => unsub()).not.toThrow();
    });
});

describe('clearAllListeners', () => {
    test('removes all listeners', () => {
        const cb = jest.fn();
        subscribe('playerTeam', cb);
        subscribe('gameState.*', cb);

        clearAllListeners();
        emit({ path: 'playerTeam', oldValue: null, newValue: 'red' });
        emit({ path: 'gameState.currentTurn', oldValue: 'red', newValue: 'blue' });

        expect(cb).not.toHaveBeenCalled();
    });
});

describe('getListenerCount', () => {
    test('returns 0 initially', () => {
        expect(getListenerCount()).toBe(0);
    });

    test('counts exact and wildcard listeners', () => {
        subscribe('playerTeam', jest.fn());
        subscribe('gameState.*', jest.fn());
        subscribe('gameState.*', jest.fn());

        expect(getListenerCount()).toBe(3);
    });

    test('decrements on unsubscribe', () => {
        const unsub = subscribe('playerTeam', jest.fn());
        expect(getListenerCount()).toBe(1);
        unsub();
        expect(getListenerCount()).toBe(0);
    });
});
