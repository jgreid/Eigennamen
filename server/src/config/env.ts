/**
 * Environment Configuration and Validation
 *
 * Provides typed environment variable access and validation at startup.
 */

import logger from '../utils/logger';

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
    CORS_ORIGIN: null,  // Must be explicitly configured; defaults to self-origin in CSRF middleware
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
    if (process.env['PORT']) {
        const port = parseInt(process.env['PORT'], 10);
        if (isNaN(port)) {
            errors.push('PORT must be a number');
        } else if (port < 1 || port > 65535) {
            errors.push('PORT must be between 1 and 65535');
        }
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

            // Detect multi-instance Fly.io deployment with memory mode
            // FLY_ALLOC_ID is set by Fly.io on every machine. If present,
            // we're on Fly.io and memory mode is dangerous with >1 machine
            // because each machine has its own isolated in-memory state.
            // Players joining a room may be routed to a different machine
            // that has no knowledge of the room, causing ROOM_NOT_FOUND errors.
            if (process.env['FLY_ALLOC_ID']) {
                const allowFly = process.env['MEMORY_MODE_ALLOW_FLY'] === 'true';
                if (allowFly) {
                    // Operator explicitly opted in to memory mode on Fly.io
                    warnings.push('DANGER: Memory mode forced on Fly.io via MEMORY_MODE_ALLOW_FLY=true');
                    warnings.push('  - Ensure EXACTLY 1 machine is running: fly scale count 1');
                    warnings.push('  - Room join failures WILL occur if Fly.io starts a second machine');
                } else {
                    errors.push(
                        'FATAL: In-memory storage mode (REDIS_URL=memory) is not supported on Fly.io. ' +
                        'Fly.io can route requests to different machines, each with separate in-memory state, ' +
                        'causing ROOM_NOT_FOUND errors when players try to join rooms. ' +
                        'Fix: provision Redis with `fly redis create` and set REDIS_URL to the Redis connection string. ' +
                        'To force single-machine memory mode anyway, set MEMORY_MODE_ALLOW_FLY=true'
                    );
                }
            }
        }

        // Validate ADMIN_PASSWORD strength if provided
        const adminPassword = process.env['ADMIN_PASSWORD'];
        if (adminPassword !== undefined) {
            if (!adminPassword.trim()) {
                errors.push('ADMIN_PASSWORD is set but empty or whitespace-only');
            } else {
                if (adminPassword.length < 12) {
                    warnings.push('SECURITY WARNING: ADMIN_PASSWORD is too short (should be at least 12 characters)');
                }
                const hasLower = /[a-z]/.test(adminPassword);
                const hasUpper = /[A-Z]/.test(adminPassword);
                const hasDigit = /\d/.test(adminPassword);
                if (!(hasLower && hasUpper && hasDigit)) {
                    warnings.push('SECURITY WARNING: ADMIN_PASSWORD should contain lowercase, uppercase, and numeric characters');
                }
            }
        }

        // Make JWT_SECRET warning more prominent in production
        // While anonymous play is supported, operators should understand the security implications
        if (!process.env['JWT_SECRET']) {
            warnings.push('SECURITY WARNING: JWT_SECRET not set - user authentication is disabled');
            warnings.push('  - Set JWT_SECRET to enable authenticated sessions: fly secrets set JWT_SECRET=$(openssl rand -hex 32)');
        } else if (process.env['JWT_SECRET'].length < 32) {
            errors.push('JWT_SECRET must be at least 32 characters in production. Generate one with: openssl rand -hex 32');
        }
        if (process.env['CORS_ORIGIN'] === '*') {
            warnings.push('CORS_ORIGIN is set to "*" in production - consider restricting');
        }
    }

    // Validate LOG_LEVEL if provided (applies to all environments)
    const logLevel = process.env['LOG_LEVEL'];
    if (logLevel) {
        const validLevels = ['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'];
        if (!validLevels.includes(logLevel)) {
            warnings.push(`LOG_LEVEL "${logLevel}" is not a standard Winston level (${validLevels.join(', ')})`);
        }
    }

    // Validate CORS_ORIGIN format if provided (applies to all environments)
    const corsOrigin = process.env['CORS_ORIGIN'];
    if (corsOrigin && corsOrigin !== '*') {
        const origins = corsOrigin.split(',').map(s => s.trim());
        for (const origin of origins) {
            if (origin && !origin.startsWith('http://') && !origin.startsWith('https://')) {
                warnings.push(`CORS_ORIGIN value "${origin}" does not start with http:// or https://`);
            }
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
    return process.env[name] ?? defaultValue;
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

