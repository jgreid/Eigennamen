/**
 * Batch/transaction support for multi-property state updates.
 *
 * Queues all state change events during the callback, then emits
 * them together after the callback completes. Subscribers see
 * individual change events plus a 'batch:complete' summary event.
 *
 * Batches can be nested — only the outermost batch flushes.
 */
import { emit } from './eventBus.js';
let batchDepth = 0;
let pendingEvents = [];
/**
 * Whether we're currently inside a batch() call.
 */
export function isBatching() {
    return batchDepth > 0;
}
/**
 * Queue an event during a batch, or emit immediately if not batching.
 */
export function enqueueOrEmit(event) {
    if (batchDepth > 0) {
        pendingEvents.push(event);
    }
    else {
        emit(event);
    }
}
/**
 * Execute `fn` with all state change events batched.
 * Events are flushed after `fn` completes (even if it throws).
 * Nested batches are supported — only the outermost flushes.
 */
export function batch(fn) {
    batchDepth++;
    try {
        fn();
    }
    finally {
        batchDepth--;
        if (batchDepth === 0) {
            flush();
        }
    }
}
function flush() {
    const events = pendingEvents;
    pendingEvents = [];
    if (events.length === 0)
        return;
    // Emit individual events
    for (const event of events) {
        emit(event);
    }
    // Emit batch summary
    const changedPaths = [...new Set(events.map(e => e.path))];
    emit({
        path: 'batch:complete',
        oldValue: null,
        newValue: changedPaths,
    });
}
//# sourceMappingURL=batch.js.map