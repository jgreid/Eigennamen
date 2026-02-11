// ========== FRONTEND LOGGER ==========
// Structured logging for frontend modules (replaces scattered console.* calls)
const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
let currentLevel = 'warn';
// Enable debug logging via localStorage.debug = 'codenames'
try {
    if (localStorage.getItem('debug') === 'codenames') {
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
            console.log('[Codenames]', ...args);
    },
    info(...args) {
        if (shouldLog('info'))
            console.info('[Codenames]', ...args);
    },
    warn(...args) {
        if (shouldLog('warn'))
            console.warn('[Codenames]', ...args);
    },
    error(...args) {
        if (shouldLog('error'))
            console.error('[Codenames]', ...args);
    },
    setLevel(level) {
        currentLevel = level;
    }
};
//# sourceMappingURL=logger.js.map