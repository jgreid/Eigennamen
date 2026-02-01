/**
 * Correlation ID Utility
 *
 * Provides request/operation tracing across distributed operations.
 * Uses AsyncLocalStorage for automatic context propagation.
 */

const { AsyncLocalStorage } = require('async_hooks');
const { v4: uuidv4 } = require('uuid');

// Async local storage for correlation context
const asyncLocalStorage = new AsyncLocalStorage();

// Header name for correlation ID propagation
const CORRELATION_HEADER = 'x-correlation-id';

/**
 * Get current correlation context
 * @returns {Object|undefined} Current context or undefined
 */
function getContext() {
    return asyncLocalStorage.getStore();
}

/**
 * Get current correlation ID
 * @returns {string|null} Current correlation ID or null
 */
function getCorrelationId() {
    const context = getContext();
    return context?.correlationId || null;
}

/**
 * Get current session ID from context
 * @returns {string|null} Current session ID or null
 */
function getSessionId() {
    const context = getContext();
    return context?.sessionId || null;
}

/**
 * Get current room code from context
 * @returns {string|null} Current room code or null
 */
function getRoomCode() {
    const context = getContext();
    return context?.roomCode || null;
}

/**
 * Get all context fields for logging
 * @returns {Object} Context fields
 */
function getContextFields() {
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
 * @param {Object} context - Context object with correlationId, sessionId, etc.
 * @param {Function} fn - Function to run
 * @returns {*} Result of the function
 */
function withContext(context, fn) {
    return asyncLocalStorage.run(context, fn);
}

/**
 * Run a function with a new correlation ID
 * @param {Function} fn - Function to run
 * @param {Object} additionalContext - Additional context fields
 * @returns {*} Result of the function
 */
function withNewCorrelation(fn, additionalContext = {}) {
    const context = {
        correlationId: uuidv4(),
        ...additionalContext
    };
    return withContext(context, fn);
}

/**
 * Create correlation context from socket
 * @param {Object} socket - Socket.io socket
 * @returns {Object} Correlation context
 */
function createContextFromSocket(socket) {
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
 * @param {Object} req - Express request
 * @returns {Object} Correlation context
 */
function createContextFromRequest(req) {
    return {
        correlationId: req.headers[CORRELATION_HEADER] || uuidv4(),
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
function correlationMiddleware(req, res, next) {
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
 * @param {Object} socket - Socket.io socket
 * @param {Function} next - Next middleware
 */
function socketCorrelationMiddleware(socket, next) {
    const context = createContextFromSocket(socket);

    // Attach context to socket for later use
    socket.correlationContext = context;
    socket.correlationId = context.correlationId;

    next();
}

/**
 * Wrap an async handler to run within correlation context
 * @param {Function} handler - Async handler function
 * @returns {Function} Wrapped handler
 */
function wrapHandler(handler) {
    return function(...args) {
        // Get socket from first argument if it has correlation context
        const socketOrReq = args[0];
        const context = socketOrReq?.correlationContext || getContext() || {
            correlationId: uuidv4()
        };

        return withContext(context, () => handler(...args));
    };
}

/**
 * Create a child context with additional fields
 * Useful for sub-operations within a request
 * @param {Object} additionalFields - Additional context fields
 * @returns {Object} New context with merged fields
 */
function createChildContext(additionalFields = {}) {
    const parentContext = getContext() || {};
    return {
        ...parentContext,
        ...additionalFields,
        parentCorrelationId: parentContext.correlationId,
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
