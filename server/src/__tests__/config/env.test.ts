/**
 * Tests for Environment Configuration and Validation
 */

const {
    validateEnv,
    getEnv,
    getEnvInt,
    getEnvBool,
    isProduction,
    isDevelopment
} = require('../../config/env');

// Mock logger
jest.mock('../../utils/logger', () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
}));

const logger = require('../../utils/logger');

describe('Environment Configuration', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
        jest.clearAllMocks();
        // Reset environment
        process.env = { ...originalEnv };
        // Clear specific test vars
        delete process.env.NODE_ENV;
        delete process.env.PORT;
        delete process.env.REDIS_URL;
        delete process.env.DATABASE_URL;
        delete process.env.JWT_SECRET;
        delete process.env.CORS_ORIGIN;
        delete process.env.LOG_LEVEL;
        delete process.env.FLY_ALLOC_ID;
        delete process.env.MEMORY_MODE_ALLOW_FLY;
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    describe('validateEnv', () => {
        it('should pass validation with defaults in development', () => {
            process.env.NODE_ENV = 'development';

            expect(() => validateEnv()).not.toThrow();
            expect(logger.info).toHaveBeenCalledWith('Environment validation passed');
        });

        it('should set default values for optional variables', () => {
            delete process.env.NODE_ENV;
            delete process.env.PORT;

            validateEnv();

            expect(process.env.NODE_ENV).toBe('development');
            expect(process.env.PORT).toBe('3000');
            // CORS_ORIGIN defaults to null (must be explicitly configured)
            expect(process.env.CORS_ORIGIN).toBeUndefined();
            expect(process.env.LOG_LEVEL).toBe('info');
        });

        it('should throw on invalid PORT', () => {
            process.env.PORT = 'not-a-number';

            expect(() => validateEnv()).toThrow('PORT must be a number');
        });

        it('should warn about production without DATABASE_URL', () => {
            process.env.NODE_ENV = 'production';
            process.env.REDIS_URL = 'redis://production-redis:6379';

            validateEnv();

            expect(logger.info).toHaveBeenCalledWith(
                expect.stringContaining('DATABASE_URL not configured')
            );
        });

        it('should warn about localhost DATABASE_URL in production', () => {
            process.env.NODE_ENV = 'production';
            process.env.REDIS_URL = 'redis://production-redis:6379';
            process.env.DATABASE_URL = 'postgresql://localhost:5432/db';

            validateEnv();

            expect(logger.warn).toHaveBeenCalledWith(
                expect.stringContaining('DATABASE_URL points to localhost')
            );
        });

        it('should throw on localhost REDIS_URL in production', () => {
            process.env.NODE_ENV = 'production';
            process.env.REDIS_URL = 'redis://localhost:6379';

            expect(() => validateEnv()).toThrow('REDIS_URL must be set to a real Redis URL');
        });

        it('should allow memory mode for REDIS_URL in production with warnings', () => {
            process.env.NODE_ENV = 'production';
            process.env.REDIS_URL = 'memory';

            validateEnv();

            expect(logger.warn).toHaveBeenCalledWith(
                expect.stringContaining('PRODUCTION WARNING: Running in memory storage mode')
            );
        });

        it('should block memory mode on Fly.io (FLY_ALLOC_ID present)', () => {
            process.env.NODE_ENV = 'production';
            process.env.REDIS_URL = 'memory';
            process.env.FLY_ALLOC_ID = 'abc123def456';

            expect(() => validateEnv()).toThrow(
                'FATAL: In-memory storage mode (REDIS_URL=memory) is not supported on Fly.io'
            );
        });

        it('should allow memory mode on Fly.io when MEMORY_MODE_ALLOW_FLY=true', () => {
            process.env.NODE_ENV = 'production';
            process.env.REDIS_URL = 'memory';
            process.env.FLY_ALLOC_ID = 'abc123def456';
            process.env.MEMORY_MODE_ALLOW_FLY = 'true';

            expect(() => validateEnv()).not.toThrow();

            expect(logger.warn).toHaveBeenCalledWith(
                expect.stringContaining('DANGER: Memory mode forced on Fly.io')
            );
            expect(logger.warn).toHaveBeenCalledWith(
                expect.stringContaining('Ensure EXACTLY 1 machine is running')
            );
        });

        it('should not block memory mode when FLY_ALLOC_ID is absent (non-Fly deployment)', () => {
            process.env.NODE_ENV = 'production';
            process.env.REDIS_URL = 'memory';
            delete process.env.FLY_ALLOC_ID;

            expect(() => validateEnv()).not.toThrow();

            // Should still get the general memory mode warning
            expect(logger.warn).toHaveBeenCalledWith(
                expect.stringContaining('PRODUCTION WARNING: Running in memory storage mode')
            );
        });

        it('should not trigger Fly.io guard when using real Redis URL', () => {
            process.env.NODE_ENV = 'production';
            process.env.REDIS_URL = 'rediss://production-redis:6379';
            process.env.FLY_ALLOC_ID = 'abc123def456';

            expect(() => validateEnv()).not.toThrow();

            // Should NOT have the memory mode warning
            const memoryWarnings = (logger.warn as jest.Mock).mock.calls.filter(
                (call: string[]) => call[0].includes('memory storage mode')
            );
            expect(memoryWarnings).toHaveLength(0);
        });

        it('should warn about missing JWT_SECRET in production', () => {
            process.env.NODE_ENV = 'production';
            process.env.REDIS_URL = 'redis://production-redis:6379';
            delete process.env.JWT_SECRET;

            validateEnv();

            expect(logger.warn).toHaveBeenCalledWith(
                expect.stringContaining('SECURITY WARNING: JWT_SECRET not set')
            );
        });

        it('should throw for short JWT_SECRET in production', () => {
            process.env.NODE_ENV = 'production';
            process.env.REDIS_URL = 'redis://production-redis:6379';
            process.env.JWT_SECRET = 'short'; // Less than 32 chars

            expect(() => validateEnv()).toThrow('JWT_SECRET must be at least 32 characters');
        });

        it('should warn about wildcard CORS in production', () => {
            process.env.NODE_ENV = 'production';
            process.env.REDIS_URL = 'redis://production-redis:6379';
            process.env.CORS_ORIGIN = '*';

            validateEnv();

            expect(logger.warn).toHaveBeenCalledWith(
                expect.stringContaining('CORS_ORIGIN is set to "*" in production')
            );
        });

        it('should not warn about CORS when restricted', () => {
            process.env.NODE_ENV = 'production';
            process.env.REDIS_URL = 'redis://production-redis:6379';
            process.env.CORS_ORIGIN = 'https://example.com';

            validateEnv();

            const corsWarnings = logger.warn.mock.calls.filter(
                call => call[0].includes('CORS_ORIGIN')
            );
            expect(corsWarnings).toHaveLength(0);
        });

        it('should error when ADMIN_PASSWORD is empty string in production', () => {
            process.env.NODE_ENV = 'production';
            process.env.REDIS_URL = 'redis://production-redis:6379';
            process.env.ADMIN_PASSWORD = '';

            expect(() => validateEnv()).toThrow('ADMIN_PASSWORD is set but empty or whitespace-only');
        });

        it('should error when ADMIN_PASSWORD is whitespace-only in production', () => {
            process.env.NODE_ENV = 'production';
            process.env.REDIS_URL = 'redis://production-redis:6379';
            process.env.ADMIN_PASSWORD = '   ';

            expect(() => validateEnv()).toThrow('ADMIN_PASSWORD is set but empty or whitespace-only');
        });

        it('should warn about invalid LOG_LEVEL', () => {
            process.env.LOG_LEVEL = 'trace';

            validateEnv();

            expect(logger.warn).toHaveBeenCalledWith(
                expect.stringContaining('LOG_LEVEL "trace" is not a standard Winston level')
            );
        });

        it('should accept valid LOG_LEVEL values', () => {
            const validLevels = ['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'];
            for (const level of validLevels) {
                jest.clearAllMocks();
                process.env.LOG_LEVEL = level;

                validateEnv();

                const levelWarnings = (logger.warn as jest.Mock).mock.calls.filter(
                    (call: string[]) => call[0].includes('LOG_LEVEL')
                );
                expect(levelWarnings).toHaveLength(0);
            }
        });

        it('should warn about CORS_ORIGIN without protocol', () => {
            process.env.CORS_ORIGIN = 'example.com';

            validateEnv();

            expect(logger.warn).toHaveBeenCalledWith(
                expect.stringContaining('does not start with http:// or https://')
            );
        });

        it('should not warn about CORS_ORIGIN with valid URLs', () => {
            process.env.CORS_ORIGIN = 'https://example.com,http://localhost:3000';

            validateEnv();

            const corsFormatWarnings = (logger.warn as jest.Mock).mock.calls.filter(
                (call: string[]) => call[0].includes('does not start with http')
            );
            expect(corsFormatWarnings).toHaveLength(0);
        });
    });

    describe('getEnv', () => {
        it('should return environment variable value', () => {
            process.env.TEST_VAR = 'test-value';

            expect(getEnv('TEST_VAR')).toBe('test-value');
        });

        it('should return default value when variable not set', () => {
            expect(getEnv('NONEXISTENT_VAR', 'default')).toBe('default');
        });

        it('should return undefined when no default provided', () => {
            expect(getEnv('NONEXISTENT_VAR')).toBeUndefined();
        });
    });

    describe('getEnvInt', () => {
        it('should parse integer environment variable', () => {
            process.env.INT_VAR = '42';

            expect(getEnvInt('INT_VAR')).toBe(42);
        });

        it('should return default for non-integer value', () => {
            process.env.INT_VAR = 'not-a-number';

            expect(getEnvInt('INT_VAR', 10)).toBe(10);
        });

        it('should return default when variable not set', () => {
            expect(getEnvInt('NONEXISTENT_VAR', 100)).toBe(100);
        });

        it('should handle negative integers', () => {
            process.env.INT_VAR = '-5';

            expect(getEnvInt('INT_VAR')).toBe(-5);
        });

        it('should handle zero', () => {
            process.env.INT_VAR = '0';

            expect(getEnvInt('INT_VAR', 10)).toBe(0);
        });
    });

    describe('getEnvBool', () => {
        it('should return true for "true"', () => {
            process.env.BOOL_VAR = 'true';

            expect(getEnvBool('BOOL_VAR')).toBe(true);
        });

        it('should return true for "1"', () => {
            process.env.BOOL_VAR = '1';

            expect(getEnvBool('BOOL_VAR')).toBe(true);
        });

        it('should return false for other values', () => {
            process.env.BOOL_VAR = 'false';
            expect(getEnvBool('BOOL_VAR')).toBe(false);

            process.env.BOOL_VAR = '0';
            expect(getEnvBool('BOOL_VAR')).toBe(false);

            process.env.BOOL_VAR = 'anything';
            expect(getEnvBool('BOOL_VAR')).toBe(false);
        });

        it('should return default when variable not set', () => {
            expect(getEnvBool('NONEXISTENT_VAR', true)).toBe(true);
            expect(getEnvBool('NONEXISTENT_VAR', false)).toBe(false);
            expect(getEnvBool('NONEXISTENT_VAR')).toBe(false);
        });

        it('should be case-insensitive', () => {
            process.env.BOOL_VAR = 'TRUE';
            expect(getEnvBool('BOOL_VAR')).toBe(true);

            process.env.BOOL_VAR = 'True';
            expect(getEnvBool('BOOL_VAR')).toBe(true);
        });
    });

    describe('isProduction', () => {
        it('should return true when NODE_ENV is production', () => {
            process.env.NODE_ENV = 'production';

            expect(isProduction()).toBe(true);
        });

        it('should return false when NODE_ENV is not production', () => {
            process.env.NODE_ENV = 'development';
            expect(isProduction()).toBe(false);

            process.env.NODE_ENV = 'test';
            expect(isProduction()).toBe(false);
        });

        it('should return false when NODE_ENV is not set', () => {
            delete process.env.NODE_ENV;

            expect(isProduction()).toBe(false);
        });
    });

    describe('isDevelopment', () => {
        it('should return true when NODE_ENV is development', () => {
            process.env.NODE_ENV = 'development';

            expect(isDevelopment()).toBe(true);
        });

        it('should return true when NODE_ENV is not set', () => {
            delete process.env.NODE_ENV;

            expect(isDevelopment()).toBe(true);
        });

        it('should return false when NODE_ENV is production', () => {
            process.env.NODE_ENV = 'production';

            expect(isDevelopment()).toBe(false);
        });

        it('should return false when NODE_ENV is test', () => {
            process.env.NODE_ENV = 'test';

            expect(isDevelopment()).toBe(false);
        });
    });
});
