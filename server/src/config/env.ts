/**
 * Environment Configuration and Validation
 *
 * Provides typed environment variable access and validation at startup.
 */

// Import logger - using require for CommonJS compatibility during migration
// eslint-disable-next-line @typescript-eslint/no-var-requires
const logger = require('../utils/logger');

/**
 * Required environment variables (currently none - game works anonymously)
 */
const requiredVars: readonly string[] = [];

/**
 * Optional environment variables with defaults
 */
const optionalVars: Record<string, string | null> = {
    NODE_ENV: 'development',
    PORT: '3000',
    REDIS_URL: 'redis://localhost:6379',
    DATABASE_URL: null,  // Optional - game works without database
    JWT_SECRET: null,    // Optional for anonymous play
    CORS_ORIGIN: '*',
    LOG_LEVEL: 'info'
};

/**
 * Validate environment variables at startup
 * @returns true if validation passes
 * @throws Error if required variables are missing or validation fails
 */
export function validateEnv(): boolean {
    const errors: string[] = [];
    const warnings: string[] = [];

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
    if (process.env['PORT'] && isNaN(parseInt(process.env['PORT'], 10))) {
        errors.push('PORT must be a number');
    }

    // Production-specific validations
    if (process.env['NODE_ENV'] === 'production') {
        // DATABASE_URL is optional - game works fully without it
        // Only warn if it looks like a localhost URL (likely misconfiguration)
        const dbUrl = process.env['DATABASE_URL'] || '';
        if (dbUrl && dbUrl.includes('localhost')) {
            warnings.push('DATABASE_URL points to localhost - this will not work in production');
        }
        if (!dbUrl) {
            // Informational only - not an error
            logger.info('DATABASE_URL not configured - running without database (user accounts and game history disabled)');
        }

        // Allow REDIS_URL=memory for single-instance deployments without Redis
        const redisUrl = process.env['REDIS_URL'] || '';
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

        // ISSUE #55 FIX: Make JWT_SECRET warning more prominent in production
        // While anonymous play is supported, operators should understand the security implications
        if (!process.env['JWT_SECRET']) {
            warnings.push('SECURITY WARNING: JWT_SECRET not set - user authentication is disabled');
            warnings.push('  - Set JWT_SECRET to enable authenticated sessions: fly secrets set JWT_SECRET=$(openssl rand -hex 32)');
        } else if (process.env['JWT_SECRET'].length < 32) {
            warnings.push('SECURITY WARNING: JWT_SECRET is too short (should be at least 32 characters)');
        }
        if (process.env['CORS_ORIGIN'] === '*') {
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
 * @param name - Environment variable name
 * @param defaultValue - Default value if not set
 * @returns The environment variable value or default
 */
export function getEnv(name: string, defaultValue?: string): string | undefined {
    return process.env[name] || defaultValue;
}

/**
 * Get integer environment variable
 * @param name - Environment variable name
 * @param defaultValue - Default value if not set or not a valid integer
 * @returns The parsed integer value or default
 */
export function getEnvInt(name: string, defaultValue?: number): number | undefined {
    const value = process.env[name];
    if (value === undefined) return defaultValue;
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Get boolean environment variable
 * @param name - Environment variable name
 * @param defaultValue - Default value if not set (defaults to false)
 * @returns The boolean value
 */
export function getEnvBool(name: string, defaultValue: boolean = false): boolean {
    const value = process.env[name];
    if (value === undefined) return defaultValue;
    return value.toLowerCase() === 'true' || value === '1';
}

/**
 * Check if running in production
 * @returns true if NODE_ENV is 'production'
 */
export function isProduction(): boolean {
    return process.env['NODE_ENV'] === 'production';
}

/**
 * Check if running in development
 * @returns true if NODE_ENV is 'development' or not set
 */
export function isDevelopment(): boolean {
    return process.env['NODE_ENV'] === 'development' || !process.env['NODE_ENV'];
}

// Default export for CommonJS compatibility
module.exports = {
    validateEnv,
    getEnv,
    getEnvInt,
    getEnvBool,
    isProduction,
    isDevelopment
};
