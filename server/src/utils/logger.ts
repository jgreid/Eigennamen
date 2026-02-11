/**
 * Logging Utility (Winston)
 *
 * Provides structured logging with automatic correlation ID injection.
 * Supports both legacy string logging and structured field logging.
 */

import winston from 'winston';
import fs from 'fs';
import path from 'path';
import type { Logger as WinstonLogger } from 'winston';

/**
 * Context fields interface
 */
interface ContextFields {
    correlationId?: string;
    sessionId?: string;
    roomCode?: string;
    instanceId?: string;
}

/**
 * Log metadata interface
 */
interface LogMeta extends ContextFields {
    [key: string]: unknown;
}

/**
 * Error metadata interface
 */
interface ErrorMeta {
    message: string;
    code?: string;
    stack?: string;
}

/**
 * Child logger interface
 */
type LogArg = LogMeta | Error | string | unknown;

interface ChildLogger {
    error(msg: string, meta?: LogArg): void;
    warn(msg: string, meta?: LogArg): void;
    info(msg: string, meta?: LogArg): void;
    http(msg: string, meta?: LogArg): void;
    debug(msg: string, meta?: LogArg): void;
}

/**
 * Logger interface
 */
interface Logger extends ChildLogger {
    _buildMeta(metaOrError: LogArg): LogMeta;
    child(defaultMeta: LogMeta): ChildLogger;
}

// Lazy load correlation ID to avoid circular dependencies
let getContextFields: (() => ContextFields) | null = null;

function loadCorrelationId(): () => ContextFields {
    if (getContextFields === null) {
        try {
            const correlationModule = require('./correlationId');
            getContextFields = correlationModule.getContextFields;
        } catch {
            // Module not available yet, return empty function
            getContextFields = () => ({});
        }
    }
    return getContextFields as () => ContextFields;
}

/**
 * Log levels
 */
const levels: Record<string, number> = {
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
const level = (): string => {
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

const colors: Record<string, string> = {
    error: 'red',
    warn: 'yellow',
    info: 'green',
    http: 'magenta',
    debug: 'cyan'
};

winston.addColors(colors);

// Instance ID for multi-instance logging
const instanceId: string = process.env.FLY_ALLOC_ID || process.env.INSTANCE_ID || 'local';

/**
 * Format for console output (human-readable)
 */
const consoleFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
    winston.format.colorize({ all: true }),
    winston.format.printf(((info: { timestamp: string; level: string; message: string; [key: string]: unknown }): string => {
        const { timestamp, level, message, ...meta } = info;

        // Build context string from metadata
        let contextStr = '';
        if (meta.correlationId) {
            contextStr += ` [${(meta.correlationId as string).slice(0, 8)}]`;
        }
        if (meta.sessionId) {
            contextStr += ` [session:${(meta.sessionId as string).slice(0, 8)}]`;
        }
        if (meta.roomCode) {
            contextStr += ` [room:${meta.roomCode}]`;
        }

        // Format additional fields
        const extraFields: Record<string, unknown> = { ...meta };
        delete extraFields.correlationId;
        delete extraFields.sessionId;
        delete extraFields.roomCode;
        delete extraFields.instanceId;

        const extraStr = Object.keys(extraFields).length > 0
            ? ` ${JSON.stringify(extraFields)}`
            : '';

        return `${timestamp} ${level}:${contextStr} ${message}${extraStr}`;
    }) as any)
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
const getFormat = (): ReturnType<typeof winston.format.combine> => {
    if (process.env.LOG_FORMAT === 'json' || process.env.NODE_ENV === 'production') {
        return jsonFormat;
    }
    return consoleFormat;
};

const transports: InstanceType<typeof winston.transports.Console | typeof winston.transports.File>[] = [
    new winston.transports.Console({
        format: getFormat()
    })
];

/**
 * Log rotation configuration
 */
interface LogRotationConfig {
    maxsize: number;
    maxFiles: number;
    tailable: boolean;
    zippedArchive: boolean;
}

// Add file transports in production (if possible)
if (process.env.NODE_ENV === 'production') {
    try {
        // Ensure logs directory exists
        const logsDir = path.join(process.cwd(), 'logs');
        if (!fs.existsSync(logsDir)) {
            fs.mkdirSync(logsDir, { recursive: true });
        }

        // Log rotation configuration to prevent disk fill
        // maxsize: 10MB per file, maxFiles: 5 files kept (50MB total max)
        const LOG_ROTATION_CONFIG: LogRotationConfig = {
            maxsize: 10 * 1024 * 1024,  // 10MB per file
            maxFiles: 5,                  // Keep 5 rotated files
            tailable: true,               // Most recent logs always in main file
            zippedArchive: false          // Don't compress (faster writes)
        };

        transports.push(
            new winston.transports.File({
                filename: 'logs/error.log',
                level: 'error',
                format: jsonFormat,
                ...LOG_ROTATION_CONFIG
            }),
            new winston.transports.File({
                filename: 'logs/combined.log',
                format: jsonFormat,
                ...LOG_ROTATION_CONFIG
            })
        );
    } catch (err) {
        // If we can't create log files, just use console logging
        // This can happen in containerized environments with read-only filesystems
        // eslint-disable-next-line no-console -- logger not yet initialized
        console.warn('Could not create log directory, using console logging only:', (err as Error).message);
    }
}

const winstonLogger: WinstonLogger = winston.createLogger({
    level: level(),
    levels,
    defaultMeta: { instanceId },
    transports
});

/**
 * Enhanced logger wrapper with structured logging support
 */
const logger: Logger = {
    /**
     * Log error message
     * @param message - Log message
     * @param metaOrError - Additional metadata or Error object
     */
    error(message: string, metaOrError: LogMeta | Error = {}): void {
        const meta = this._buildMeta(metaOrError);
        winstonLogger.error(message, meta);
    },

    /**
     * Log warning message
     * @param message - Log message
     * @param meta - Additional metadata
     */
    warn(message: string, meta: LogMeta = {}): void {
        winstonLogger.warn(message, this._buildMeta(meta));
    },

    /**
     * Log info message
     * @param message - Log message
     * @param meta - Additional metadata
     */
    info(message: string, meta: LogMeta = {}): void {
        winstonLogger.info(message, this._buildMeta(meta));
    },

    /**
     * Log http message
     * @param message - Log message
     * @param meta - Additional metadata
     */
    http(message: string, meta: LogMeta = {}): void {
        winstonLogger.http(message, this._buildMeta(meta));
    },

    /**
     * Log debug message
     * @param message - Log message
     * @param meta - Additional metadata
     */
    debug(message: string, meta: LogMeta = {}): void {
        winstonLogger.debug(message, this._buildMeta(meta));
    },

    /**
     * Build metadata object with correlation context
     * @private
     */
    _buildMeta(metaOrError: LogMeta | Error): LogMeta {
        // Get correlation context
        const contextFields = loadCorrelationId()();

        // Handle Error objects
        if (metaOrError instanceof Error) {
            const errorMeta: ErrorMeta = {
                message: metaOrError.message,
                code: (metaOrError as Error & { code?: string }).code,
                stack: metaOrError.stack
            };
            return {
                ...contextFields,
                error: errorMeta
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
     * @param defaultMeta - Default metadata for all log calls
     * @returns Child logger
     */
    child(defaultMeta: LogMeta): ChildLogger {
        const parent = this;
        return {
            error(msg: string, meta: LogMeta = {}): void { parent.error(msg, { ...defaultMeta, ...meta }); },
            warn(msg: string, meta: LogMeta = {}): void { parent.warn(msg, { ...defaultMeta, ...meta }); },
            info(msg: string, meta: LogMeta = {}): void { parent.info(msg, { ...defaultMeta, ...meta }); },
            http(msg: string, meta: LogMeta = {}): void { parent.http(msg, { ...defaultMeta, ...meta }); },
            debug(msg: string, meta: LogMeta = {}): void { parent.debug(msg, { ...defaultMeta, ...meta }); }
        };
    }
};

export default logger;

export type { ContextFields, LogMeta, ErrorMeta, ChildLogger, Logger, LogRotationConfig };
