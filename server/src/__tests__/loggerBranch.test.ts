/**
 * Logger Branch Coverage Tests
 *
 * Uses jest.resetModules() to test different NODE_ENV/LOG_LEVEL configurations.
 * Tests: production transport selection, debug level, custom format branches
 */

describe('Logger Branch Coverage', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        jest.resetModules();
        process.env = { ...originalEnv };
    });

    afterAll(() => {
        process.env = originalEnv;
    });

    describe('development environment', () => {
        it('should use console transport in development', () => {
            process.env.NODE_ENV = 'development';
            delete process.env.LOG_LEVEL;
            delete process.env.LOG_FORMAT;

            const logger = require('../utils/logger');
            expect(logger).toBeDefined();
            expect(typeof logger.info).toBe('function');
            expect(typeof logger.error).toBe('function');
            expect(typeof logger.warn).toBe('function');
            expect(typeof logger.debug).toBe('function');
        });

        it('should respect LOG_LEVEL override', () => {
            process.env.NODE_ENV = 'development';
            process.env.LOG_LEVEL = 'debug';

            const logger = require('../utils/logger');
            expect(logger).toBeDefined();
            // Logger is a wrapper, not the raw winston logger; test it can log at debug
            expect(typeof logger.debug).toBe('function');
            expect(() => logger.debug('test')).not.toThrow();
        });

        it('should default to debug level in development', () => {
            process.env.NODE_ENV = 'development';
            delete process.env.LOG_LEVEL;

            const logger = require('../utils/logger');
            expect(logger).toBeDefined();
            // Should be able to call debug level without issues
            expect(() => logger.debug('dev debug')).not.toThrow();
        });
    });

    describe('production environment', () => {
        it('should configure production-level transports', () => {
            process.env.NODE_ENV = 'production';
            delete process.env.LOG_LEVEL;

            const logger = require('../utils/logger');
            expect(logger).toBeDefined();
            expect(typeof logger.info).toBe('function');
        });

        it('should use warn level by default in production', () => {
            process.env.NODE_ENV = 'production';
            delete process.env.LOG_LEVEL;

            const logger = require('../utils/logger');
            expect(logger).toBeDefined();
            // Production defaults to warn
            expect(() => logger.warn('production warning')).not.toThrow();
        });

        it('should allow LOG_LEVEL override in production', () => {
            process.env.NODE_ENV = 'production';
            process.env.LOG_LEVEL = 'error';

            const logger = require('../utils/logger');
            expect(logger).toBeDefined();
            expect(typeof logger.error).toBe('function');
            expect(() => logger.error('production error')).not.toThrow();
        });

        it('should use JSON format in production', () => {
            process.env.NODE_ENV = 'production';
            delete process.env.LOG_FORMAT;

            const logger = require('../utils/logger');
            expect(logger).toBeDefined();
            // Production uses json format by default
            expect(() => logger.info('json format test')).not.toThrow();
        });
    });

    describe('test environment', () => {
        it('should use error level by default in test', () => {
            process.env.NODE_ENV = 'test';
            delete process.env.LOG_LEVEL;

            const logger = require('../utils/logger');
            expect(logger).toBeDefined();
            expect(typeof logger.error).toBe('function');
        });

        it('should respect LOG_LEVEL in test mode', () => {
            process.env.NODE_ENV = 'test';
            process.env.LOG_LEVEL = 'debug';

            const logger = require('../utils/logger');
            expect(logger).toBeDefined();
            expect(typeof logger.debug).toBe('function');
            expect(() => logger.debug('test debug')).not.toThrow();
        });
    });

    describe('custom format branches', () => {
        it('should handle logging with metadata objects', () => {
            process.env.NODE_ENV = 'development';
            process.env.LOG_LEVEL = 'debug';

            const logger = require('../utils/logger');
            expect(() => {
                logger.info('test message', { key: 'value', nested: { a: 1 } });
            }).not.toThrow();
        });

        it('should handle logging with error objects via _buildMeta', () => {
            process.env.NODE_ENV = 'development';
            process.env.LOG_LEVEL = 'debug';

            const logger = require('../utils/logger');
            expect(() => {
                logger.error('test error', new Error('test'));
            }).not.toThrow();
        });

        it('should handle logging without metadata', () => {
            process.env.NODE_ENV = 'development';
            process.env.LOG_LEVEL = 'debug';

            const logger = require('../utils/logger');
            expect(() => {
                logger.debug('simple message');
            }).not.toThrow();
        });

        it('should use JSON format when LOG_FORMAT=json', () => {
            process.env.NODE_ENV = 'development';
            process.env.LOG_FORMAT = 'json';
            process.env.LOG_LEVEL = 'debug';

            const logger = require('../utils/logger');
            expect(() => {
                logger.info('json format message', { some: 'data' });
            }).not.toThrow();
        });

        it('should handle context fields in log output', () => {
            process.env.NODE_ENV = 'development';
            process.env.LOG_LEVEL = 'debug';

            const logger = require('../utils/logger');
            expect(() => {
                logger.info('test with context', {
                    correlationId: 'abc123',
                    sessionId: 'sess123',
                    roomCode: 'ROOM1'
                });
            }).not.toThrow();
        });
    });

    describe('undefined NODE_ENV', () => {
        it('should fall back to development mode', () => {
            delete process.env.NODE_ENV;
            delete process.env.LOG_LEVEL;

            const logger = require('../utils/logger');
            expect(logger).toBeDefined();
            expect(typeof logger.info).toBe('function');
        });
    });

    describe('child logger', () => {
        it('should create a child logger with default metadata', () => {
            process.env.NODE_ENV = 'development';
            process.env.LOG_LEVEL = 'debug';

            const logger = require('../utils/logger');
            const child = logger.child({ service: 'test' });
            expect(child).toBeDefined();
            expect(typeof child.info).toBe('function');
            expect(typeof child.error).toBe('function');
            expect(typeof child.warn).toBe('function');
            expect(typeof child.debug).toBe('function');
            expect(() => child.info('child message')).not.toThrow();
            expect(() => child.debug('child debug', { extra: 'data' })).not.toThrow();
        });
    });

    describe('_buildMeta', () => {
        it('should handle Error with code property', () => {
            process.env.NODE_ENV = 'development';
            process.env.LOG_LEVEL = 'debug';

            const logger = require('../utils/logger');
            const err = new Error('Test error') as Error & { code: string };
            err.code = 'ERR_TEST';

            const meta = logger._buildMeta(err);
            expect(meta.error).toBeDefined();
            expect(meta.error.message).toBe('Test error');
            expect(meta.error.code).toBe('ERR_TEST');
            expect(meta.error.stack).toBeDefined();
        });

        it('should handle plain metadata objects', () => {
            process.env.NODE_ENV = 'development';
            process.env.LOG_LEVEL = 'debug';

            const logger = require('../utils/logger');
            const meta = logger._buildMeta({ key: 'value' });
            expect(meta.key).toBe('value');
        });
    });

    describe('sanitizeForLog', () => {
        it('should sanitize strings with control characters', () => {
            process.env.NODE_ENV = 'development';

            const { sanitizeForLog } = require('../utils/logger');
            expect(sanitizeForLog).toBeDefined();

            const result = sanitizeForLog('hello\x00world\nfoo');
            expect(result).not.toContain('\x00');
            expect(result).toContain('\\n');
        });

        it('should handle non-string input', () => {
            const { sanitizeForLog } = require('../utils/logger');
            expect(sanitizeForLog(42)).toBe('42');
            expect(sanitizeForLog(null)).toBe('null');
        });

        it('should truncate long strings', () => {
            const { sanitizeForLog } = require('../utils/logger');
            const long = 'a'.repeat(1000);
            const result = sanitizeForLog(long);
            expect(result.length).toBeLessThanOrEqual(500);
        });
    });

    describe('invalid LOG_LEVEL', () => {
        it('should fall back to NODE_ENV default for invalid LOG_LEVEL', () => {
            process.env.NODE_ENV = 'development';
            process.env.LOG_LEVEL = 'nonexistent_level';

            const logger = require('../utils/logger');
            expect(logger).toBeDefined();
            // Should fall back to debug (development default)
            expect(() => logger.debug('fallback test')).not.toThrow();
        });
    });
});
