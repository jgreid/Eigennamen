/**
 * Always-on reactive Proxy for the AppState object.
 *
 * Intercepts property sets, performs reference-equality checks,
 * and emits change events via the event bus. Sub-objects are
 * wrapped lazily on access (same pattern as the previous debug proxy).
 *
 * Debug logging remains gated behind localStorage.debug === 'eigennamen'.
 */

import { enqueueOrEmit } from './batch.js';
import type { StateChangeEvent } from './eventBus.js';

/**
 * Create a recursive Proxy that emits state change events on mutation.
 * Sub-objects are wrapped lazily on access so the overhead is minimal.
 *
 * **Array mutation convention**: Array methods like `push()`, `splice()`,
 * and `pop()` work through the proxy and emit per-index change events.
 * However, subscribers listening on the array path itself (e.g. `state.items`)
 * won't fire because the array reference doesn't change. For bulk array
 * updates, always assign a new array: `state.items = [...newItems]`.
 */
export function createReactiveProxy<T extends object>(target: T, path: string = 'state'): T {
    const subProxies = new WeakMap<object, object>();

    return new Proxy(target, {
        get(obj: T, prop: string | symbol): unknown {
            const value = Reflect.get(obj, prop);
            // Wrap sub-objects lazily (skip symbols, null, non-objects)
            if (value !== null && typeof value === 'object' && typeof prop === 'string') {
                // Don't proxy opaque host objects — they use internal slots
                // that break under Proxy or need reference identity (DOM nodes).
                if (
                    value instanceof Set ||
                    value instanceof Map ||
                    (typeof Node !== 'undefined' && value instanceof Node) ||
                    (typeof AudioContext !== 'undefined' && value instanceof AudioContext)
                ) {
                    return value;
                }
                if (!subProxies.has(value as object)) {
                    subProxies.set(value as object, createReactiveProxy(value as object, `${path}.${prop}`));
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

                // Invalidate sub-proxy cache if old value was an object
                if (oldValue !== null && typeof oldValue === 'object') {
                    subProxies.delete(oldValue as object);
                }

                // Emit change event via the event bus (respects batching)
                const event: StateChangeEvent = {
                    path: fullPath,
                    oldValue,
                    newValue: value,
                };
                enqueueOrEmit(event);
            }
            return result;
        },

        deleteProperty(obj: T, prop: string | symbol): boolean {
            const hadProp = Reflect.has(obj, prop);
            const oldValue = hadProp ? Reflect.get(obj, prop) : undefined;
            const result = Reflect.deleteProperty(obj, prop);

            if (result && hadProp && typeof prop === 'string') {
                const fullPath = `${path}.${prop}`;

                // Invalidate sub-proxy cache if old value was an object
                if (oldValue !== null && typeof oldValue === 'object') {
                    subProxies.delete(oldValue as object);
                }

                enqueueOrEmit({
                    path: fullPath,
                    oldValue,
                    newValue: undefined,
                });
            }
            return result;
        },
    });
}
