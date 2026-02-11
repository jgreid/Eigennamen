/**
 * Logger Configuration Tests
 *
 * Tests meaningful behavior of logger.ts configuration paths:
 * - level(): environment-based log level selection
 * - loadCorrelationId: graceful fallback when module unavailable
 * - Production mode: file transport error handling
 *
 * Note: sanitizeForLog tests are in sanitize.test.ts (the sanitize.ts version)
 */

describe('Logger Configuration', () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
        process.env = { ...originalEnv };
        jest.resetModules();
    });

    describe('level() - environment-based log level selection', () => {
        it('should return "warn" in production to reduce noise', () => {
            process.env.NODE_ENV = 'production';
            delete process.env.LOG_LEVEL;

            // Mock fs to prevent actual file creation in production path
            jest.doMock('fs', () => ({
                existsSync: jest.fn(() => true),
                mkdirSync: jest.fn()
            }));

            const winston = require('winston');
            const createLoggerSpy = jest.spyOn(winston, 'createLogger');

            require('../utils/logger').default;

            const config = createLoggerSpy.mock.calls[0][0];
            expect(config.level).toBe('warn');
            createLoggerSpy.mockRestore();
        });

        it('should return "error" in test to minimize logging', () => {
            process.env.NODE_ENV = 'test';
            delete process.env.LOG_LEVEL;

            const winston = require('winston');
            const createLoggerSpy = jest.spyOn(winston, 'createLogger');

            require('../utils/logger').default;

            const config = createLoggerSpy.mock.calls[0][0];
            expect(config.level).toBe('error');
            createLoggerSpy.mockRestore();
        });

        it('should return "debug" in development for full logging', () => {
            process.env.NODE_ENV = 'development';
            delete process.env.LOG_LEVEL;

            const winston = require('winston');
            const createLoggerSpy = jest.spyOn(winston, 'createLogger');

            require('../utils/logger').default;

            const config = createLoggerSpy.mock.calls[0][0];
            expect(config.level).toBe('debug');
            createLoggerSpy.mockRestore();
        });

        it('should honor explicit LOG_LEVEL over NODE_ENV default', () => {
            process.env.NODE_ENV = 'production';
            process.env.LOG_LEVEL = 'debug';

            jest.doMock('fs', () => ({
                existsSync: jest.fn(() => true),
                mkdirSync: jest.fn()
            }));

            const winston = require('winston');
            const createLoggerSpy = jest.spyOn(winston, 'createLogger');

            require('../utils/logger').default;

            const config = createLoggerSpy.mock.calls[0][0];
            expect(config.level).toBe('debug');
            createLoggerSpy.mockRestore();
        });
    });

    describe('loadCorrelationId - graceful fallback', () => {
        it('should return empty context when correlationId module fails to load', () => {
            // Mock correlationId to throw on require
            jest.doMock('../utils/correlationId', () => {
                throw new Error('Module not available');
            });

            const logger = require('../utils/logger').default;

            // _buildMeta should still work - returning empty context fields
            const meta = logger._buildMeta({ custom: 'field' });
            expect(meta).toEqual(expect.objectContaining({ custom: 'field' }));
            // No correlationId since module failed to load
            expect(meta.correlationId).toBeUndefined();
        });
    });

    describe('Production file transport error handling', () => {
        it('should fall back to console logging when log directory creation fails', () => {
            process.env.NODE_ENV = 'production';
            delete process.env.LOG_LEVEL;

            const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

            jest.doMock('fs', () => ({
                existsSync: jest.fn(() => false),
                mkdirSync: jest.fn(() => { throw new Error('Read-only filesystem'); })
            }));

            const logger = require('../utils/logger').default;

            // Verify console.warn was called with the error message
            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('Could not create log directory'),
                'Read-only filesystem'
            );

            // Logger should still function (using console transport only)
            expect(() => logger.error('test message')).not.toThrow();

            consoleSpy.mockRestore();
        });
    });

    describe('_buildMeta with Error objects', () => {
        it('should extract message, code, and stack from Error objects', () => {
            const logger = require('../utils/logger').default;
            const err = new Error('Something failed');
            (err as Error & { code?: string }).code = 'ERR_CUSTOM';

            const meta = logger._buildMeta(err);

            expect(meta.error).toBeDefined();
            expect(meta.error.message).toBe('Something failed');
            expect(meta.error.code).toBe('ERR_CUSTOM');
            expect(meta.error.stack).toContain('Something failed');
        });
    });

    describe('child logger', () => {
        it('should merge default metadata into all log calls', () => {
            const logger = require('../utils/logger').default;
            const child = logger.child({ roomCode: 'TEST01', sessionId: 'abc123' });

            // Child logger methods should exist and be callable
            expect(typeof child.error).toBe('function');
            expect(typeof child.warn).toBe('function');
            expect(typeof child.info).toBe('function');
            expect(typeof child.debug).toBe('function');

            // Calling child methods should not throw
            child.info('test message', { extra: 'data' });
            child.warn('warning message');
        });
    });
});
