/**
 * Performance Timing Middleware
 * Sprint 19: Adds request timing and logging for monitoring
 */

const logger = require('../utils/logger');

/**
 * HTTP request timing middleware
 * Logs request duration for all HTTP requests
 */
function requestTiming(req, res, next) {
    const start = process.hrtime.bigint();
    const requestId = req.headers['x-request-id'] || generateRequestId();

    // Attach request ID for correlation
    req.requestId = requestId;
    res.setHeader('X-Request-ID', requestId);

    // Log request completion
    res.on('finish', () => {
        const duration = Number(process.hrtime.bigint() - start) / 1e6; // Convert to ms
        const logData = {
            requestId,
            method: req.method,
            path: req.path,
            statusCode: res.statusCode,
            durationMs: Math.round(duration * 100) / 100, // 2 decimal places
            contentLength: res.get('Content-Length') || 0,
            userAgent: req.get('User-Agent')?.substring(0, 100) // Truncate
        };

        // Log level based on duration and status
        if (res.statusCode >= 500) {
            logger.error('HTTP request completed with error', logData);
        } else if (duration > 1000) {
            logger.warn('HTTP request slow', logData);
        } else if (req.path !== '/health' && req.path !== '/health/live') {
            // Don't spam logs with health checks
            logger.debug('HTTP request completed', logData);
        }
    });

    next();
}

/**
 * Socket event timing wrapper
 * Wraps socket handlers to measure execution time
 * @param {string} eventName - Name of the socket event
 * @param {Function} handler - The event handler function
 * @returns {Function} Wrapped handler with timing
 */
function socketEventTiming(eventName, handler) {
    return async function timedHandler(...args) {
        const start = process.hrtime.bigint();
        const socket = this;

        try {
            const result = await handler.apply(this, args);
            const duration = Number(process.hrtime.bigint() - start) / 1e6;

            const logData = {
                event: eventName,
                socketId: socket.id,
                sessionId: socket.sessionId,
                durationMs: Math.round(duration * 100) / 100
            };

            if (duration > 500) {
                logger.warn('Socket event slow', logData);
            } else if (duration > 100) {
                logger.debug('Socket event timing', logData);
            }

            return result;
        } catch (error) {
            const duration = Number(process.hrtime.bigint() - start) / 1e6;
            logger.error('Socket event error', {
                event: eventName,
                socketId: socket.id,
                sessionId: socket.sessionId,
                durationMs: Math.round(duration * 100) / 100,
                error: error.message
            });
            throw error;
        }
    };
}

/**
 * Memory usage monitoring
 * Logs memory stats periodically
 */
let memoryCheckInterval = null;
const MEMORY_CHECK_INTERVAL_MS = 60000; // 1 minute
const MEMORY_WARNING_THRESHOLD_MB = 400; // Warn at 400MB

function startMemoryMonitoring() {
    if (memoryCheckInterval) return;

    memoryCheckInterval = setInterval(() => {
        const usage = process.memoryUsage();
        const heapUsedMB = Math.round(usage.heapUsed / 1024 / 1024);
        const heapTotalMB = Math.round(usage.heapTotal / 1024 / 1024);
        const rssMB = Math.round(usage.rss / 1024 / 1024);

        const logData = {
            heapUsedMB,
            heapTotalMB,
            rssMB,
            externalMB: Math.round(usage.external / 1024 / 1024),
            heapUsagePercent: Math.round((heapUsedMB / heapTotalMB) * 100)
        };

        if (heapUsedMB > MEMORY_WARNING_THRESHOLD_MB) {
            logger.warn('High memory usage detected', logData);
        } else {
            logger.debug('Memory usage', logData);
        }
    }, MEMORY_CHECK_INTERVAL_MS);

    logger.info('Memory monitoring started');
}

function stopMemoryMonitoring() {
    if (memoryCheckInterval) {
        clearInterval(memoryCheckInterval);
        memoryCheckInterval = null;
        logger.info('Memory monitoring stopped');
    }
}

/**
 * Generate a simple request ID
 */
function generateRequestId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`;
}

module.exports = {
    requestTiming,
    socketEventTiming,
    startMemoryMonitoring,
    stopMemoryMonitoring
};
