/**
 * Correlation ID Utility
 *
 * Provides request/operation tracing across distributed operations.
 * Uses AsyncLocalStorage for automatic context propagation.
 */

import type { Request, Response, NextFunction } from 'express';
import type { AsyncLocalStorage as AsyncLocalStorageType } from 'async_hooks';

const { AsyncLocalStorage } = require('async_hooks') as { AsyncLocalStorage: new <T>() => AsyncLocalStorageType<T> };
const { v4: uuidv4 } = require('uuid');

/**
 * Correlation context interface
 */
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

/**
 * Context fields for logging
 */
interface ContextFields {
    correlationId?: string;
    sessionId?: string;
    roomCode?: string;
    instanceId?: string;
}

/**
 * Socket interface (simplified for correlation)
 */
interface CorrelationSocket {
    id: string;
    sessionId?: string;
    roomCode?: string;
    handshake?: {
        headers?: Record<string, string>;
    };
    correlationContext?: CorrelationContext;
    correlationId?: string;
}

/**
 * Extended Express request with correlation context
 */
interface CorrelationRequest extends Request {
    sessionId?: string;
    correlationContext?: CorrelationContext;
}

// Async local storage for correlation context
const asyncLocalStorage = new AsyncLocalStorage<CorrelationContext>();

// Header name for correlation ID propagation
const CORRELATION_HEADER = 'x-correlation-id';

/**
 * Get current correlation context
 * @returns Current context or undefined
 */
function getContext(): CorrelationContext | undefined {
    return asyncLocalStorage.getStore();
}

/**
 * Get current correlation ID
 * @returns Current correlation ID or null
 */
function getCorrelationId(): string | null {
    const context = getContext();
    return context?.correlationId || null;
}

/**
 * Get current session ID from context
 * @returns Current session ID or null
 */
function getSessionId(): string | null {
    const context = getContext();
    return context?.sessionId || null;
}

/**
 * Get current room code from context
 * @returns Current room code or null
 */
function getRoomCode(): string | null {
    const context = getContext();
    return context?.roomCode || null;
}

/**
 * Get all context fields for logging
 * @returns Context fields
 */
function getContextFields(): ContextFields {
    const context = getContext();
    if (!context) return {};

    return {
        correlationId: context.correlationId,
        sessionId: context.sessionId,
        roomCode: context.roomCode,
        instanceId: context.instanceId
    };
}

/**
 * Run a function within a correlation context
 * @param context - Context object with correlationId, sessionId, etc.
 * @param fn - Function to run
 * @returns Result of the function
 */
function withContext<T>(context: CorrelationContext, fn: () => T): T {
    return asyncLocalStorage.run(context, fn);
}

/**
 * Run a function with a new correlation ID
 * @param fn - Function to run
 * @param additionalContext - Additional context fields
 * @returns Result of the function
 */
function withNewCorrelation<T>(fn: () => T, additionalContext: Partial<CorrelationContext> = {}): T {
    const context: CorrelationContext = {
        correlationId: uuidv4(),
        ...additionalContext
    };
    return withContext(context, fn);
}

/**
 * Create correlation context from socket
 * @param socket - Socket.io socket
 * @returns Correlation context
 */
function createContextFromSocket(socket: CorrelationSocket): CorrelationContext {
    return {
        correlationId: socket.handshake?.headers?.[CORRELATION_HEADER] || uuidv4(),
        sessionId: socket.sessionId,
        roomCode: socket.roomCode,
        socketId: socket.id,
        instanceId: process.env.FLY_ALLOC_ID || process.env.INSTANCE_ID || 'local'
    };
}

/**
 * Create correlation context from HTTP request
 * @param req - Express request
 * @returns Correlation context
 */
function createContextFromRequest(req: CorrelationRequest): CorrelationContext {
    return {
        correlationId: (req.headers[CORRELATION_HEADER] as string) || uuidv4(),
        sessionId: req.sessionId,
        instanceId: process.env.FLY_ALLOC_ID || process.env.INSTANCE_ID || 'local',
        method: req.method,
        path: req.path
    };
}

/**
 * Express middleware for correlation ID
 * Automatically sets up correlation context for HTTP requests
 */
function correlationMiddleware(req: CorrelationRequest, res: Response, next: NextFunction): void {
    const context = createContextFromRequest(req);

    // Add correlation ID to response header
    res.setHeader(CORRELATION_HEADER, context.correlationId);

    // Run rest of request in correlation context
    withContext(context, () => {
        // Attach context to request for later use
        req.correlationContext = context;
        next();
    });
}

/**
 * Socket.io middleware for correlation ID
 * Sets up correlation context for socket connections
 * @param socket - Socket.io socket
 * @param next - Next middleware
 */
function socketCorrelationMiddleware(socket: CorrelationSocket, next: (err?: Error) => void): void {
    const context = createContextFromSocket(socket);

    // Attach context to socket for later use
    socket.correlationContext = context;
    socket.correlationId = context.correlationId;

    next();
}

/**
 * Handler function type
 */
type HandlerFunction<T extends unknown[], R> = (...args: T) => R;

/**
 * Object with correlation context
 */
interface WithCorrelationContext {
    correlationContext?: CorrelationContext;
}

/**
 * Wrap an async handler to run within correlation context
 * @param handler - Async handler function
 * @returns Wrapped handler
 */
function wrapHandler<T extends unknown[], R>(handler: HandlerFunction<T, R>): HandlerFunction<T, R> {
    return function(...args: T): R {
        // Get socket from first argument if it has correlation context
        const socketOrReq = args[0] as WithCorrelationContext | undefined;
        const context: CorrelationContext = socketOrReq?.correlationContext || getContext() || {
            correlationId: uuidv4()
        };

        return withContext(context, () => handler(...args));
    };
}

/**
 * Create a child context with additional fields
 * Useful for sub-operations within a request
 * @param additionalFields - Additional context fields
 * @returns New context with merged fields
 */
function createChildContext(additionalFields: Partial<CorrelationContext> = {}): CorrelationContext {
    const parentContext = getContext();
    return {
        ...(parentContext || {}),
        ...additionalFields,
        parentCorrelationId: parentContext?.correlationId,
        correlationId: additionalFields.correlationId || uuidv4()
    };
}

module.exports = {
    // Core functions
    getContext,
    getCorrelationId,
    getSessionId,
    getRoomCode,
    getContextFields,

    // Context management
    withContext,
    withNewCorrelation,
    createChildContext,

    // Context creation
    createContextFromSocket,
    createContextFromRequest,

    // Middleware
    correlationMiddleware,
    socketCorrelationMiddleware,

    // Handler wrapper
    wrapHandler,

    // Constants
    CORRELATION_HEADER
};

// ES6 exports for TypeScript imports
export {
    getContext,
    getCorrelationId,
    getSessionId,
    getRoomCode,
    getContextFields,
    withContext,
    withNewCorrelation,
    createChildContext,
    createContextFromSocket,
    createContextFromRequest,
    correlationMiddleware,
    socketCorrelationMiddleware,
    wrapHandler,
    CORRELATION_HEADER
};

export type {
    CorrelationContext,
    ContextFields,
    CorrelationSocket,
    CorrelationRequest,
    HandlerFunction,
    WithCorrelationContext
};
