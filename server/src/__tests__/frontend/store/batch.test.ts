/**
 * Batch unit tests
 */

import { subscribe, clearAllListeners } from '../../../frontend/store/eventBus';
import { batch, isBatching } from '../../../frontend/store/batch';
import { createReactiveProxy } from '../../../frontend/store/reactiveProxy';

beforeEach(() => {
    clearAllListeners();
});

describe('batch', () => {
    test('queues events during batch and flushes after', () => {
        const obj = createReactiveProxy({ a: 1, b: 2 }, 'test');
        const events: string[] = [];

        subscribe('test.a', () => events.push('a'));
        subscribe('test.b', () => events.push('b'));

        // During batch, no events should fire
        batch(() => {
            obj.a = 10;
            expect(events).toEqual([]);
            obj.b = 20;
            expect(events).toEqual([]);
        });

        // After batch, all events should have fired
        expect(events).toContain('a');
        expect(events).toContain('b');
    });

    test('emits batch:complete with changed paths', () => {
        const obj = createReactiveProxy({ x: 1, y: 2 }, 'test');
        const batchEvent = jest.fn();

        subscribe('batch:complete', batchEvent);

        batch(() => {
            obj.x = 10;
            obj.y = 20;
        });

        expect(batchEvent).toHaveBeenCalledTimes(1);
        const changedPaths = batchEvent.mock.calls[0][0].newValue;
        expect(changedPaths).toContain('test.x');
        expect(changedPaths).toContain('test.y');
    });

    test('does not emit batch:complete if no changes occurred', () => {
        const batchEvent = jest.fn();
        subscribe('batch:complete', batchEvent);

        batch(() => {
            // No state changes
        });

        expect(batchEvent).not.toHaveBeenCalled();
    });

    test('nested batches only flush at outermost level', () => {
        const obj = createReactiveProxy({ a: 1, b: 2 }, 'test');
        const events: string[] = [];

        subscribe('test.a', () => events.push('a'));
        subscribe('test.b', () => events.push('b'));

        batch(() => {
            obj.a = 10;
            batch(() => {
                obj.b = 20;
                expect(events).toEqual([]); // Still no events
            });
            expect(events).toEqual([]); // Still no events — inner batch didn't flush
        });

        // Now both events should have fired
        expect(events).toContain('a');
        expect(events).toContain('b');
    });

    test('flushes even if fn throws', () => {
        const obj = createReactiveProxy({ a: 1 }, 'test');
        const cb = jest.fn();
        subscribe('test.a', cb);

        expect(() => {
            batch(() => {
                obj.a = 10;
                throw new Error('oops');
            });
        }).toThrow('oops');

        expect(cb).toHaveBeenCalledTimes(1);
    });

    test('isBatching returns true during batch', () => {
        expect(isBatching()).toBe(false);

        batch(() => {
            expect(isBatching()).toBe(true);
        });

        expect(isBatching()).toBe(false);
    });
});
