/**
 * Logging Utility (Winston)
 *
 * Provides structured logging with automatic correlation ID injection.
 * Supports both legacy string logging and structured field logging.
 */

const winston = require('winston');
const fs = require('fs');
const path = require('path');

// Lazy load correlation ID to avoid circular dependencies
let getContextFields = null;

function loadCorrelationId() {
    if (getContextFields === null) {
        try {
            const correlationModule = require('./correlationId');
            getContextFields = correlationModule.getContextFields;
        } catch (e) {
            // Module not available yet, return empty function
            getContextFields = () => ({});
        }
    }
    return getContextFields;
}

const levels = {
    error: 0,
    warn: 1,
    info: 2,
    http: 3,
    debug: 4
};

/**
 * Determine log level from environment
 * Priority: LOG_LEVEL env var > NODE_ENV-based default
 * Production defaults to 'warn' for reduced noise, development to 'debug'
 */
const level = () => {
    // Explicit LOG_LEVEL takes priority
    const explicitLevel = process.env.LOG_LEVEL;
    if (explicitLevel && levels[explicitLevel] !== undefined) {
        return explicitLevel;
    }

    // Default based on NODE_ENV
    const env = process.env.NODE_ENV || 'development';
    switch (env) {
        case 'production':
            return 'warn';  // Only warnings and errors in production
        case 'test':
            return 'error'; // Minimal logging during tests
        default:
            return 'debug'; // Full logging in development
    }
};

const colors = {
    error: 'red',
    warn: 'yellow',
    info: 'green',
    http: 'magenta',
    debug: 'cyan'
};

winston.addColors(colors);

// Instance ID for multi-instance logging
const instanceId = process.env.FLY_ALLOC_ID || process.env.INSTANCE_ID || 'local';

/**
 * Format for console output (human-readable)
 */
const consoleFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
    winston.format.colorize({ all: true }),
    winston.format.printf((info) => {
        const { timestamp, level, message, ...meta } = info;

        // Build context string from metadata
        let contextStr = '';
        if (meta.correlationId) {
            contextStr += ` [${meta.correlationId.slice(0, 8)}]`;
        }
        if (meta.sessionId) {
            contextStr += ` [session:${meta.sessionId.slice(0, 8)}]`;
        }
        if (meta.roomCode) {
            contextStr += ` [room:${meta.roomCode}]`;
        }

        // Format additional fields
        const extraFields = { ...meta };
        delete extraFields.correlationId;
        delete extraFields.sessionId;
        delete extraFields.roomCode;
        delete extraFields.instanceId;

        const extraStr = Object.keys(extraFields).length > 0
            ? ` ${JSON.stringify(extraFields)}`
            : '';

        return `${timestamp} ${level}:${contextStr} ${message}${extraStr}`;
    })
);

/**
 * Format for JSON output (structured, machine-readable)
 */
const jsonFormat = winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
);

/**
 * Choose format based on environment
 */
const getFormat = () => {
    if (process.env.LOG_FORMAT === 'json' || process.env.NODE_ENV === 'production') {
        return jsonFormat;
    }
    return consoleFormat;
};

const transports = [
    new winston.transports.Console({
        format: getFormat()
    })
];

// Add file transports in production (if possible)
if (process.env.NODE_ENV === 'production') {
    try {
        // Ensure logs directory exists
        const logsDir = path.join(process.cwd(), 'logs');
        if (!fs.existsSync(logsDir)) {
            fs.mkdirSync(logsDir, { recursive: true });
        }

        transports.push(
            new winston.transports.File({
                filename: 'logs/error.log',
                level: 'error',
                format: jsonFormat
            }),
            new winston.transports.File({
                filename: 'logs/combined.log',
                format: jsonFormat
            })
        );
    } catch (err) {
        // If we can't create log files, just use console logging
        // This can happen in containerized environments with read-only filesystems
        console.warn('Could not create log directory, using console logging only:', err.message);
    }
}

const winstonLogger = winston.createLogger({
    level: level(),
    levels,
    defaultMeta: { instanceId },
    transports
});

/**
 * ISSUE #22 FIX: Sanitize user input for safe logging
 * Removes/escapes control characters that could be used for log injection
 * @param {string} input - User input to sanitize
 * @returns {string} Sanitized string safe for logging
 */
function sanitizeForLog(input) {
    if (typeof input !== 'string') {
        return String(input);
    }
    // Remove control characters and escape newlines/carriage returns
    return input
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Remove control chars except \t, \n, \r
        .replace(/\r?\n/g, '\\n') // Escape newlines
        .replace(/\r/g, '\\r')    // Escape carriage returns
        .substring(0, 500);       // Limit length to prevent log flooding
}

/**
 * Enhanced logger wrapper with structured logging support
 */
const logger = {
    /**
     * Log error message
     * @param {string} message - Log message
     * @param {Object|Error} metaOrError - Additional metadata or Error object
     */
    error(message, metaOrError = {}) {
        const meta = this._buildMeta(metaOrError);
        winstonLogger.error(message, meta);
    },

    /**
     * Log warning message
     * @param {string} message - Log message
     * @param {Object} meta - Additional metadata
     */
    warn(message, meta = {}) {
        winstonLogger.warn(message, this._buildMeta(meta));
    },

    /**
     * Log info message
     * @param {string} message - Log message
     * @param {Object} meta - Additional metadata
     */
    info(message, meta = {}) {
        winstonLogger.info(message, this._buildMeta(meta));
    },

    /**
     * Log http message
     * @param {string} message - Log message
     * @param {Object} meta - Additional metadata
     */
    http(message, meta = {}) {
        winstonLogger.http(message, this._buildMeta(meta));
    },

    /**
     * Log debug message
     * @param {string} message - Log message
     * @param {Object} meta - Additional metadata
     */
    debug(message, meta = {}) {
        winstonLogger.debug(message, this._buildMeta(meta));
    },

    /**
     * Build metadata object with correlation context
     * @private
     */
    _buildMeta(metaOrError) {
        // Get correlation context
        const contextFields = loadCorrelationId()();

        // Handle Error objects
        if (metaOrError instanceof Error) {
            return {
                ...contextFields,
                error: {
                    message: metaOrError.message,
                    code: metaOrError.code,
                    stack: metaOrError.stack
                }
            };
        }

        // Handle metadata objects
        return {
            ...contextFields,
            ...metaOrError
        };
    },

    /**
     * Create a child logger with additional default metadata
     * @param {Object} defaultMeta - Default metadata for all log calls
     * @returns {Object} Child logger
     */
    child(defaultMeta) {
        const parent = this;
        return {
            error(msg, meta = {}) { parent.error(msg, { ...defaultMeta, ...meta }); },
            warn(msg, meta = {}) { parent.warn(msg, { ...defaultMeta, ...meta }); },
            info(msg, meta = {}) { parent.info(msg, { ...defaultMeta, ...meta }); },
            http(msg, meta = {}) { parent.http(msg, { ...defaultMeta, ...meta }); },
            debug(msg, meta = {}) { parent.debug(msg, { ...defaultMeta, ...meta }); }
        };
    }
};

// Export both the logger and the sanitize function
module.exports = logger;
module.exports.sanitizeForLog = sanitizeForLog;
