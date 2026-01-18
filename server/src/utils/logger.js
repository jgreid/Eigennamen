/**
 * Logging Utility (Winston)
 */

const winston = require('winston');
const fs = require('fs');
const path = require('path');

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

const format = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
    winston.format.colorize({ all: true }),
    winston.format.printf(
        (info) => `${info.timestamp} ${info.level}: ${info.message}`
    )
);

const transports = [
    new winston.transports.Console()
];

// Add file transports in production
if (process.env.NODE_ENV === 'production') {
    // Ensure logs directory exists
    const logsDir = path.join(process.cwd(), 'logs');
    if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
    }

    transports.push(
        new winston.transports.File({
            filename: 'logs/error.log',
            level: 'error'
        }),
        new winston.transports.File({
            filename: 'logs/combined.log'
        })
    );
}

const logger = winston.createLogger({
    level: level(),
    levels,
    format,
    transports
});

module.exports = logger;
