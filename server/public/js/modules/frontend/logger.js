// ========== FRONTEND LOGGER ==========
// Structured logging for frontend modules (replaces scattered console.* calls)
const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
let currentLevel = 'warn';
// Enable debug logging via localStorage.debug = 'eigennamen'
try {
    if (localStorage.getItem('debug') === 'eigennamen') {
        currentLevel = 'debug';
    }
}
catch {
    // Restricted context (SSR, privacy mode)
}
function shouldLog(level) {
    return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}
export const logger = {
    debug(...args) {
        if (shouldLog('debug'))
            console.log('[Eigennamen]', ...args);
    },
    info(...args) {
        if (shouldLog('info'))
            console.info('[Eigennamen]', ...args);
    },
    warn(...args) {
        if (shouldLog('warn'))
            console.warn('[Eigennamen]', ...args);
    },
    error(...args) {
        if (shouldLog('error'))
            console.error('[Eigennamen]', ...args);
    },
    setLevel(level) {
        currentLevel = level;
    }
};
//# sourceMappingURL=logger.js.map