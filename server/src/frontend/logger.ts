// ========== FRONTEND LOGGER ==========
// Structured logging for frontend modules (replaces scattered console.* calls)

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;
type LogLevel = keyof typeof LOG_LEVELS;

let currentLevel: LogLevel = 'warn';

// Enable debug logging via localStorage.debug = 'codenames'
try {
    if (localStorage.getItem('debug') === 'codenames') {
        currentLevel = 'debug';
    }
} catch {
    // Restricted context (SSR, privacy mode)
}

function shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

export const logger = {
    debug(...args: unknown[]): void {
        if (shouldLog('debug')) console.log('[Codenames]', ...args);
    },
    info(...args: unknown[]): void {
        if (shouldLog('info')) console.info('[Codenames]', ...args);
    },
    warn(...args: unknown[]): void {
        if (shouldLog('warn')) console.warn('[Codenames]', ...args);
    },
    error(...args: unknown[]): void {
        if (shouldLog('error')) console.error('[Codenames]', ...args);
    },
    setLevel(level: LogLevel): void {
        currentLevel = level;
    }
};
