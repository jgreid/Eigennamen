import winston from 'winston';
import fs from 'fs';
import path from 'path';

import type { Logger as WinstonLogger } from 'winston';
import { getContextFields } from './correlationId';

interface ContextFields {
    correlationId?: string;
    sessionId?: string;
    roomCode?: string;
    instanceId?: string;
}

interface LogMeta extends ContextFields {
    [key: string]: unknown;
}

interface ErrorMeta {
    message: string;
    code?: string;
    stack?: string;
}

interface ChildLogger {
    error(msg: string, meta?: LogMeta | Error | unknown): void;
    warn(msg: string, meta?: LogMeta | Error | unknown): void;
    info(msg: string, meta?: LogMeta | Error | unknown): void;
    http(msg: string, meta?: LogMeta | Error | unknown): void;
    debug(msg: string, meta?: LogMeta | Error | unknown): void;
}

interface Logger extends ChildLogger {
    _buildMeta(metaOrError: LogMeta | Error | unknown): LogMeta;
    child(defaultMeta: LogMeta): ChildLogger;
}

const levels: Record<string, number> = {
    error: 0,
    warn: 1,
    info: 2,
    http: 3,
    debug: 4,
};

const level = (): string => {
    const explicitLevel = process.env.LOG_LEVEL;
    if (explicitLevel && levels[explicitLevel] !== undefined) {
        return explicitLevel;
    }
    const env = process.env.NODE_ENV || 'development';
    switch (env) {
        case 'production':
            return 'warn';
        case 'test':
            return 'error';
        default:
            return 'debug';
    }
};

const colors: Record<string, string> = {
    error: 'red',
    warn: 'yellow',
    info: 'green',
    http: 'magenta',
    debug: 'cyan',
};

winston.addColors(colors);

// Instance ID for multi-instance logging
const instanceId: string = process.env.FLY_ALLOC_ID || process.env.INSTANCE_ID || 'local';

const consoleFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
    winston.format.colorize({ all: true }),
    winston.format.printf((info) => {
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

        const extraStr = Object.keys(extraFields).length > 0 ? ` ${JSON.stringify(extraFields)}` : '';

        return `${timestamp} ${level}:${contextStr} ${message}${extraStr}`;
    })
);

const jsonFormat = winston.format.combine(winston.format.timestamp(), winston.format.json());

const getFormat = (): ReturnType<typeof winston.format.combine> => {
    if (process.env.LOG_FORMAT === 'json' || process.env.NODE_ENV === 'production') {
        return jsonFormat;
    }
    return consoleFormat;
};

const transports: InstanceType<typeof winston.transports.Console | typeof winston.transports.File>[] = [
    new winston.transports.Console({
        format: getFormat(),
    }),
];

// Add file transports in production (if possible)
if (process.env.NODE_ENV === 'production') {
    try {
        // Ensure logs directory exists
        const logsDir = path.join(process.cwd(), 'logs');
        if (!fs.existsSync(logsDir)) {
            fs.mkdirSync(logsDir, { recursive: true });
        }

        const LOG_ROTATION_CONFIG = {
            maxsize: 10 * 1024 * 1024, // 10MB per file
            maxFiles: 5,
            tailable: true,
            zippedArchive: false,
        };

        transports.push(
            new winston.transports.File({
                filename: 'logs/error.log',
                level: 'error',
                format: jsonFormat,
                ...LOG_ROTATION_CONFIG,
            }),
            new winston.transports.File({
                filename: 'logs/combined.log',
                format: jsonFormat,
                ...LOG_ROTATION_CONFIG,
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
    transports,
});

const logger: Logger = {
    error(message: string, metaOrError: LogMeta | Error | unknown = {}): void {
        winstonLogger.error(message, this._buildMeta(metaOrError));
    },
    warn(message: string, meta: LogMeta | Error | unknown = {}): void {
        winstonLogger.warn(message, this._buildMeta(meta));
    },
    info(message: string, meta: LogMeta | Error | unknown = {}): void {
        winstonLogger.info(message, this._buildMeta(meta));
    },
    http(message: string, meta: LogMeta | Error | unknown = {}): void {
        winstonLogger.http(message, this._buildMeta(meta));
    },
    debug(message: string, meta: LogMeta | Error | unknown = {}): void {
        winstonLogger.debug(message, this._buildMeta(meta));
    },

    _buildMeta(metaOrError: LogMeta | Error | unknown): LogMeta {
        // Get correlation context
        const contextFields = getContextFields();

        // Handle Error objects
        if (metaOrError instanceof Error) {
            const errorMeta: ErrorMeta = {
                message: metaOrError.message,
                code: (metaOrError as Error & { code?: string }).code,
                stack: metaOrError.stack,
            };
            return {
                ...contextFields,
                error: errorMeta,
            };
        }

        // Handle plain objects as metadata
        if (metaOrError && typeof metaOrError === 'object') {
            return {
                ...contextFields,
                ...(metaOrError as LogMeta),
            };
        }

        // Handle primitives (strings, numbers, etc.) — wrap as detail
        if (metaOrError !== undefined && metaOrError !== null) {
            return {
                ...contextFields,
                detail: metaOrError,
            };
        }

        return { ...contextFields };
    },

    child(defaultMeta: LogMeta): ChildLogger {
        const parent = this;
        return {
            error(msg: string, meta: LogMeta | Error | unknown = {}): void {
                parent.error(msg, {
                    ...defaultMeta,
                    ...(typeof meta === 'object' && meta !== null ? (meta as LogMeta) : { detail: meta }),
                });
            },
            warn(msg: string, meta: LogMeta | Error | unknown = {}): void {
                parent.warn(msg, {
                    ...defaultMeta,
                    ...(typeof meta === 'object' && meta !== null ? (meta as LogMeta) : { detail: meta }),
                });
            },
            info(msg: string, meta: LogMeta | Error | unknown = {}): void {
                parent.info(msg, {
                    ...defaultMeta,
                    ...(typeof meta === 'object' && meta !== null ? (meta as LogMeta) : { detail: meta }),
                });
            },
            http(msg: string, meta: LogMeta | Error | unknown = {}): void {
                parent.http(msg, {
                    ...defaultMeta,
                    ...(typeof meta === 'object' && meta !== null ? (meta as LogMeta) : { detail: meta }),
                });
            },
            debug(msg: string, meta: LogMeta | Error | unknown = {}): void {
                parent.debug(msg, {
                    ...defaultMeta,
                    ...(typeof meta === 'object' && meta !== null ? (meta as LogMeta) : { detail: meta }),
                });
            },
        };
    },
};

export default logger;

export type { ContextFields, LogMeta, ErrorMeta, ChildLogger, Logger };

// CommonJS compat — lets `const logger = require('./logger')` work in tests
module.exports = logger;
module.exports.default = logger;
