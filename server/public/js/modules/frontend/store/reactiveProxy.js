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
export function createReactiveProxy(target, path = 'state') {
    const subProxies = new WeakMap();
    return new Proxy(target, {
        get(obj, prop) {
            const value = Reflect.get(obj, prop);
            // Wrap sub-objects lazily (skip symbols, null, non-objects)
            if (value !== null && typeof value === 'object' && typeof prop === 'string') {
                // Don't proxy opaque host objects — they use internal slots
                // that break under Proxy or need reference identity (DOM nodes).
                if (value instanceof Set ||
                    value instanceof Map ||
                    (typeof Node !== 'undefined' && value instanceof Node) ||
                    (typeof AudioContext !== 'undefined' && value instanceof AudioContext)) {
                    return value;
                }
                if (!subProxies.has(value)) {
                    subProxies.set(value, createReactiveProxy(value, `${path}.${prop}`));
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
                // Invalidate sub-proxy cache if old value was an object
                if (oldValue !== null && typeof oldValue === 'object') {
                    subProxies.delete(oldValue);
                }
                // Emit change event via the event bus (respects batching)
                const event = {
                    path: fullPath,
                    oldValue,
                    newValue: value,
                };
                enqueueOrEmit(event);
            }
            return result;
        },
        deleteProperty(obj, prop) {
            const hadProp = Reflect.has(obj, prop);
            const oldValue = hadProp ? Reflect.get(obj, prop) : undefined;
            const result = Reflect.deleteProperty(obj, prop);
            if (result && hadProp && typeof prop === 'string') {
                const fullPath = `${path}.${prop}`;
                // Invalidate sub-proxy cache if old value was an object
                if (oldValue !== null && typeof oldValue === 'object') {
                    subProxies.delete(oldValue);
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
//# sourceMappingURL=reactiveProxy.js.map