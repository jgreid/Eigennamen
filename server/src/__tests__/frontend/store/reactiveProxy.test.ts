/**
 * ReactiveProxy unit tests
 */

import { subscribe, clearAllListeners } from '../../../frontend/store/eventBus';
import { createReactiveProxy } from '../../../frontend/store/reactiveProxy';

beforeEach(() => {
    clearAllListeners();
});

describe('createReactiveProxy', () => {
    test('emits change event on property set', () => {
        const obj = createReactiveProxy({ x: 1 }, 'test');
        const cb = jest.fn();
        subscribe('test.x', cb);

        obj.x = 42;

        expect(cb).toHaveBeenCalledTimes(1);
        expect(cb).toHaveBeenCalledWith({
            path: 'test.x',
            oldValue: 1,
            newValue: 42,
        });
    });

    test('does not emit when value is unchanged (reference equality)', () => {
        const obj = createReactiveProxy({ x: 1 }, 'test');
        const cb = jest.fn();
        subscribe('test.x', cb);

        obj.x = 1; // same value

        expect(cb).not.toHaveBeenCalled();
    });

    test('emits for nested property changes', () => {
        const obj = createReactiveProxy({ nested: { a: 'hello' } }, 'test');
        const cb = jest.fn();
        subscribe('test.nested.a', cb);

        obj.nested.a = 'world';

        expect(cb).toHaveBeenCalledTimes(1);
        expect(cb).toHaveBeenCalledWith({
            path: 'test.nested.a',
            oldValue: 'hello',
            newValue: 'world',
        });
    });

    test('emits for deeply nested property changes', () => {
        const obj = createReactiveProxy({ a: { b: { c: 0 } } }, 'root');
        const cb = jest.fn();
        subscribe('root.a.b.c', cb);

        obj.a.b.c = 99;

        expect(cb).toHaveBeenCalledTimes(1);
    });

    test('reading properties returns correct values', () => {
        const obj = createReactiveProxy({ x: 1, y: 'hello' }, 'test');

        expect(obj.x).toBe(1);
        expect(obj.y).toBe('hello');
    });

    test('reading nested properties returns correct values', () => {
        const obj = createReactiveProxy({ nested: { val: 42 } }, 'test');

        expect(obj.nested.val).toBe(42);
    });

    test('does not proxy Set objects', () => {
        const mySet = new Set([1, 2, 3]);
        const obj = createReactiveProxy({ s: mySet }, 'test');

        // Should return the raw Set, not a Proxy
        expect(obj.s).toBe(mySet);
        expect(obj.s.size).toBe(3);
        obj.s.add(4);
        expect(obj.s.size).toBe(4);
    });

    test('does not proxy Map objects', () => {
        const myMap = new Map([['a', 1]]);
        const obj = createReactiveProxy({ m: myMap }, 'test');

        expect(obj.m).toBe(myMap);
        expect(obj.m.get('a')).toBe(1);
    });

    test('emits when replacing a sub-object reference', () => {
        const obj = createReactiveProxy({ nested: { val: 1 } }, 'test');
        const cb = jest.fn();
        subscribe('test.nested', cb);

        const newNested = { val: 2 };
        obj.nested = newNested;

        expect(cb).toHaveBeenCalledTimes(1);
    });

    test('invalidates sub-proxy cache on object replacement', () => {
        const obj = createReactiveProxy({ nested: { val: 1 } }, 'test');
        const cb = jest.fn();
        subscribe('test.nested.val', cb);

        // Replace the nested object
        obj.nested = { val: 2 };

        // Access the new nested.val — should work with new object
        expect(obj.nested.val).toBe(2);

        // Now mutate it — should emit
        obj.nested.val = 3;
        expect(cb).toHaveBeenCalledWith({
            path: 'test.nested.val',
            oldValue: 2,
            newValue: 3,
        });
    });

    test('handles null values', () => {
        const obj = createReactiveProxy({ x: 'hello' as string | null }, 'test');
        const cb = jest.fn();
        subscribe('test.x', cb);

        obj.x = null;

        expect(cb).toHaveBeenCalledWith({
            path: 'test.x',
            oldValue: 'hello',
            newValue: null,
        });
    });

    test('handles setting from null to object', () => {
        const obj = createReactiveProxy({ x: null as { val: number } | null }, 'test');
        const cb = jest.fn();
        subscribe('test.x', cb);

        obj.x = { val: 42 };

        expect(cb).toHaveBeenCalledTimes(1);
    });

    test('array mutations via index emit events', () => {
        const obj = createReactiveProxy({ arr: [false, false, false] }, 'test');
        const cb = jest.fn();
        subscribe('test.arr.1', cb);

        obj.arr[1] = true;

        expect(cb).toHaveBeenCalledWith({
            path: 'test.arr.1',
            oldValue: false,
            newValue: true,
        });
    });
});
