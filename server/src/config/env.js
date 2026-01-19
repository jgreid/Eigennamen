/**
 * Environment Configuration and Validation
 */

const logger = require('../utils/logger');

const requiredVars = [];

const optionalVars = {
    NODE_ENV: 'development',
    PORT: '3000',
    REDIS_URL: 'redis://localhost:6379',
    DATABASE_URL: 'postgresql://localhost:5432/codenames',
    JWT_SECRET: null,  // Optional for anonymous play
    CORS_ORIGIN: '*',
    LOG_LEVEL: 'info'
};

/**
 * Validate environment variables at startup
 */
function validateEnv() {
    const errors = [];
    const warnings = [];

    // Check required variables
    for (const varName of requiredVars) {
        if (!process.env[varName]) {
            errors.push(`Missing required environment variable: ${varName}`);
        }
    }

    // Set defaults for optional variables
    for (const [varName, defaultValue] of Object.entries(optionalVars)) {
        if (!process.env[varName] && defaultValue !== null) {
            process.env[varName] = defaultValue;
        }
    }

    // Specific validations
    if (process.env.PORT && isNaN(parseInt(process.env.PORT))) {
        errors.push('PORT must be a number');
    }

    // Production-specific validations
    if (process.env.NODE_ENV === 'production') {
        // Require real database/redis URLs in production (not localhost defaults)
        if (!process.env.DATABASE_URL || process.env.DATABASE_URL.includes('localhost')) {
            errors.push('DATABASE_URL must be set to a real database URL in production');
        }
        // Allow REDIS_URL=memory for single-instance deployments without Redis
        const redisUrl = process.env.REDIS_URL || '';
        const isMemoryMode = redisUrl === 'memory' || redisUrl === 'memory://';
        if (!isMemoryMode && (!redisUrl || redisUrl.includes('localhost'))) {
            errors.push('REDIS_URL must be set to a real Redis URL in production (or use "memory" for single-instance mode)');
        }
        if (isMemoryMode) {
            warnings.push('PRODUCTION WARNING: Running in memory storage mode');
            warnings.push('  - Data will NOT persist across restarts');
            warnings.push('  - Multi-instance scaling is DISABLED');
            warnings.push('  - Set REDIS_URL to a real Redis URL for production: fly secrets set REDIS_URL=rediss://...');
        }

        // Security warnings
        if (!process.env.JWT_SECRET) {
            warnings.push('JWT_SECRET not set - JWT authentication disabled');
        }
        if (process.env.CORS_ORIGIN === '*') {
            warnings.push('CORS_ORIGIN is set to "*" in production - consider restricting');
        }
    }

    // Log warnings
    for (const warning of warnings) {
        logger.warn(`Environment warning: ${warning}`);
    }

    // Throw if there are errors
    if (errors.length > 0) {
        const errorMessage = 'Environment validation failed:\n' + errors.map(e => `  - ${e}`).join('\n');
        logger.error(errorMessage);
        throw new Error(errorMessage);
    }

    logger.info('Environment validation passed');
    return true;
}

/**
 * Get typed environment variable
 */
function getEnv(name, defaultValue = undefined) {
    return process.env[name] || defaultValue;
}

/**
 * Get integer environment variable
 */
function getEnvInt(name, defaultValue = undefined) {
    const value = process.env[name];
    if (value === undefined) return defaultValue;
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Get boolean environment variable
 */
function getEnvBool(name, defaultValue = false) {
    const value = process.env[name];
    if (value === undefined) return defaultValue;
    return value.toLowerCase() === 'true' || value === '1';
}

/**
 * Check if running in production
 */
function isProduction() {
    return process.env.NODE_ENV === 'production';
}

/**
 * Check if running in development
 */
function isDevelopment() {
    return process.env.NODE_ENV === 'development' || !process.env.NODE_ENV;
}

module.exports = {
    validateEnv,
    getEnv,
    getEnvInt,
    getEnvBool,
    isProduction,
    isDevelopment
};
