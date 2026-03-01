import { AsyncLocalStorage } from 'async_hooks';

interface CorrelationContext {
    correlationId: string;
    sessionId?: string;
    roomCode?: string;
    socketId?: string;
    instanceId?: string;
    method?: string;
    path?: string;
    parentCorrelationId?: string;
}

interface ContextFields {
    correlationId?: string;
    sessionId?: string;
    roomCode?: string;
    instanceId?: string;
}

const asyncLocalStorage = new AsyncLocalStorage<CorrelationContext>();

function getContext(): CorrelationContext | undefined {
    return asyncLocalStorage.getStore();
}

function getCorrelationId(): string | null {
    const context = getContext();
    return context?.correlationId || null;
}

function getContextFields(): ContextFields {
    const context = getContext();
    if (!context) return {};

    return {
        correlationId: context.correlationId,
        sessionId: context.sessionId,
        roomCode: context.roomCode,
        instanceId: context.instanceId,
    };
}

function withContext<T>(context: CorrelationContext, fn: () => T): T {
    return asyncLocalStorage.run(context, fn);
}

export { getContext, getCorrelationId, getContextFields, withContext };

export type { CorrelationContext, ContextFields };
