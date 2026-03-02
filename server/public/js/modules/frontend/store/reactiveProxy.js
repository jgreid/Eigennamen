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
    });
}
//# sourceMappingURL=reactiveProxy.js.map