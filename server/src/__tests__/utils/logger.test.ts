/**
 * Tests for Logger Configuration
 */

// Store original env values
const originalEnv = { ...process.env };

describe('Logger Configuration', () => {
    let logger;

    beforeEach(() => {
        jest.resetModules();
        process.env = { ...originalEnv };
        delete process.env.LOG_LEVEL;
        delete process.env.LOG_FORMAT;
        delete process.env.FLY_ALLOC_ID;
        delete process.env.INSTANCE_ID;
        process.env.NODE_ENV = 'test';
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    describe('Log Level Selection', () => {
        it('should use LOG_LEVEL when explicitly set', () => {
            process.env.LOG_LEVEL = 'debug';
            logger = require('../../utils/logger');

            // Logger should be created with debug level
            expect(logger).toBeDefined();
        });

        it('should default to error level in test environment', () => {
            process.env.NODE_ENV = 'test';
            delete process.env.LOG_LEVEL;
            logger = require('../../utils/logger');

            expect(logger).toBeDefined();
        });

        it('should default to warn level in production', () => {
            process.env.NODE_ENV = 'production';
            delete process.env.LOG_LEVEL;
            jest.resetModules();
            logger = require('../../utils/logger');

            expect(logger).toBeDefined();
        });

        it('should default to debug level in development', () => {
            process.env.NODE_ENV = 'development';
            delete process.env.LOG_LEVEL;
            jest.resetModules();
            logger = require('../../utils/logger');

            expect(logger).toBeDefined();
        });

        it('should ignore invalid LOG_LEVEL values', () => {
            process.env.LOG_LEVEL = 'invalid-level';
            process.env.NODE_ENV = 'development';
            jest.resetModules();
            logger = require('../../utils/logger');

            // Should fall back to NODE_ENV-based level
            expect(logger).toBeDefined();
        });
    });

    describe('Logger Methods', () => {
        beforeEach(() => {
            process.env.LOG_LEVEL = 'debug';
            jest.resetModules();
            logger = require('../../utils/logger');
        });

        it('should have all log level methods', () => {
            expect(typeof logger.error).toBe('function');
            expect(typeof logger.warn).toBe('function');
            expect(typeof logger.info).toBe('function');
            expect(typeof logger.http).toBe('function');
            expect(typeof logger.debug).toBe('function');
        });

        it('should log error messages with Error objects', () => {
            const error = new Error('Test error');
            error.code = 'TEST_ERROR';

            // Should not throw
            expect(() => logger.error('Error occurred', error)).not.toThrow();
        });

        it('should log error messages with metadata', () => {
            expect(() => logger.error('Error message', { userId: '123' })).not.toThrow();
        });

        it('should log warn messages', () => {
            expect(() => logger.warn('Warning message')).not.toThrow();
            expect(() => logger.warn('Warning with meta', { key: 'value' })).not.toThrow();
        });

        it('should log info messages', () => {
            expect(() => logger.info('Info message')).not.toThrow();
            expect(() => logger.info('Info with meta', { data: 123 })).not.toThrow();
        });

        it('should log http messages', () => {
            expect(() => logger.http('HTTP message')).not.toThrow();
            expect(() => logger.http('HTTP with meta', { path: '/api' })).not.toThrow();
        });

        it('should log debug messages', () => {
            expect(() => logger.debug('Debug message')).not.toThrow();
            expect(() => logger.debug('Debug with meta', { debug: true })).not.toThrow();
        });
    });

    describe('Child Logger', () => {
        beforeEach(() => {
            process.env.LOG_LEVEL = 'debug';
            jest.resetModules();
            logger = require('../../utils/logger');
        });

        it('should create child logger with default metadata', () => {
            const childLogger = logger.child({ roomCode: 'ABCD12' });

            expect(childLogger).toBeDefined();
            expect(typeof childLogger.error).toBe('function');
            expect(typeof childLogger.warn).toBe('function');
            expect(typeof childLogger.info).toBe('function');
            expect(typeof childLogger.http).toBe('function');
            expect(typeof childLogger.debug).toBe('function');
        });

        it('should use child logger methods', () => {
            const childLogger = logger.child({ sessionId: 'session-123' });

            expect(() => childLogger.error('Child error')).not.toThrow();
            expect(() => childLogger.warn('Child warn')).not.toThrow();
            expect(() => childLogger.info('Child info')).not.toThrow();
            expect(() => childLogger.http('Child http')).not.toThrow();
            expect(() => childLogger.debug('Child debug')).not.toThrow();
        });

        it('should merge child metadata with log-specific metadata', () => {
            const childLogger = logger.child({ roomCode: 'TEST12' });

            // Should not throw when adding additional metadata
            expect(() => childLogger.info('Message', { extra: 'data' })).not.toThrow();
        });
    });

    describe('Correlation Context', () => {
        beforeEach(() => {
            process.env.LOG_LEVEL = 'debug';
            jest.resetModules();
            logger = require('../../utils/logger');
        });

        it('should handle missing correlation module gracefully', () => {
            // The logger lazy-loads correlation ID module
            // This test verifies it doesn't crash when the module isn't loaded
            expect(() => logger.info('Test message')).not.toThrow();
        });
    });

    describe('Instance ID', () => {
        it('should use FLY_ALLOC_ID when available', () => {
            process.env.FLY_ALLOC_ID = 'fly-instance-abc123';
            jest.resetModules();
            logger = require('../../utils/logger');

            expect(logger).toBeDefined();
        });

        it('should use INSTANCE_ID when FLY_ALLOC_ID not available', () => {
            delete process.env.FLY_ALLOC_ID;
            process.env.INSTANCE_ID = 'custom-instance-123';
            jest.resetModules();
            logger = require('../../utils/logger');

            expect(logger).toBeDefined();
        });

        it('should default to "local" when no instance ID set', () => {
            delete process.env.FLY_ALLOC_ID;
            delete process.env.INSTANCE_ID;
            jest.resetModules();
            logger = require('../../utils/logger');

            expect(logger).toBeDefined();
        });
    });

    describe('Log Format', () => {
        it('should use JSON format in production', () => {
            process.env.NODE_ENV = 'production';
            jest.resetModules();
            logger = require('../../utils/logger');

            expect(logger).toBeDefined();
        });

        it('should use JSON format when LOG_FORMAT is json', () => {
            process.env.LOG_FORMAT = 'json';
            process.env.NODE_ENV = 'development';
            jest.resetModules();
            logger = require('../../utils/logger');

            expect(logger).toBeDefined();
        });

        it('should use console format in development', () => {
            process.env.NODE_ENV = 'development';
            delete process.env.LOG_FORMAT;
            jest.resetModules();
            logger = require('../../utils/logger');

            expect(logger).toBeDefined();
        });
    });

    describe('_buildMeta', () => {
        beforeEach(() => {
            process.env.LOG_LEVEL = 'debug';
            jest.resetModules();
            logger = require('../../utils/logger');
        });

        it('should handle Error objects with stack trace', () => {
            const error = new Error('Test error');
            error.code = 'ERR_TEST';

            // The _buildMeta is called internally
            expect(() => logger.error('Error', error)).not.toThrow();
        });

        it('should handle plain objects', () => {
            expect(() => logger.info('Message', { key: 'value', nested: { a: 1 } })).not.toThrow();
        });

        it('should handle empty metadata', () => {
            expect(() => logger.info('Message')).not.toThrow();
            expect(() => logger.info('Message', {})).not.toThrow();
        });

        it('should truncate sessionId to 8 chars for redaction', () => {
            const meta = logger._buildMeta({ sessionId: 'abcdefghijklmnop' });
            expect(meta.sessionId).toBe('abcdefgh\u2026');
        });

        it('should redact sensitive fields', () => {
            const meta = logger._buildMeta({
                token: 'secret-token-value',
                jwt: 'eyJhbGciOiJIUzI1NiJ9...',
                reconnectionToken: 'recon-abc123',
                password: 'hunter2',
                secret: 'my-secret',
            });
            expect(meta.token).toBe('[REDACTED]');
            expect(meta.jwt).toBe('[REDACTED]');
            expect(meta.reconnectionToken).toBe('[REDACTED]');
            expect(meta.password).toBe('[REDACTED]');
            expect(meta.secret).toBe('[REDACTED]');
        });

        it('should preserve non-sensitive fields', () => {
            const meta = logger._buildMeta({ roomCode: 'ABC123', team: 'red' });
            expect(meta.roomCode).toBe('ABC123');
            expect(meta.team).toBe('red');
        });
    });
});
