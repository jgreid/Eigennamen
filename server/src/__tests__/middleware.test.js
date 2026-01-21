/**
 * Middleware Tests
 *
 * Tests for errorHandler, csrf, validation, and socketAuth middleware.
 */

const express = require('express');
const request = require('supertest');
const { ZodError } = require('zod');

// Mock Redis
let mockRedisStorage = new Map();
jest.mock('../config/redis', () => {
    const mockRedis = {
        get: jest.fn(async (key) => mockRedisStorage.get(key) || null),
        set: jest.fn(async (key, value) => {
            mockRedisStorage.set(key, value);
            return 'OK';
        }),
        del: jest.fn(async (key) => mockRedisStorage.delete(key) ? 1 : 0),
        incr: jest.fn(async (key) => {
            const current = parseInt(mockRedisStorage.get(key) || '0');
            mockRedisStorage.set(key, (current + 1).toString());
            return current + 1;
        }),
        expire: jest.fn(async () => 1),
        exists: jest.fn(async (key) => mockRedisStorage.has(key) ? 1 : 0)
    };
    return {
        getRedis: jest.fn(() => mockRedis),
        isUsingMemoryMode: jest.fn(() => true)
    };
});

// Import after mocks
const { notFoundHandler, errorHandler } = require('../middleware/errorHandler');
const { csrfProtection } = require('../middleware/csrf');
const { validateInput, validateBody, validateParams } = require('../middleware/validation');
const { ERROR_CODES } = require('../config/constants');

describe('Error Handler Middleware', () => {
    let app;

    beforeEach(() => {
        app = express();
        app.use(express.json());
    });

    describe('notFoundHandler', () => {
        it('should return 404 with proper error format', async () => {
            app.use(notFoundHandler);

            const response = await request(app)
                .get('/nonexistent/route')
                .expect(404);

            expect(response.body.error).toBeDefined();
            expect(response.body.error.code).toBe('NOT_FOUND');
            expect(response.body.error.message).toContain('/nonexistent/route');
        });

        it('should include HTTP method in error message', async () => {
            app.use(notFoundHandler);

            const response = await request(app)
                .post('/nonexistent')
                .expect(404);

            expect(response.body.error.message).toContain('POST');
        });
    });

    describe('errorHandler', () => {
        it('should handle known error codes with proper status', async () => {
            app.get('/test', (req, res, next) => {
                next({ code: ERROR_CODES.ROOM_NOT_FOUND, message: 'Room not found' });
            });
            app.use(errorHandler);

            const response = await request(app)
                .get('/test')
                .expect(404);

            expect(response.body.error.code).toBe('ROOM_NOT_FOUND');
        });

        it('should handle ROOM_FULL with 403', async () => {
            app.get('/test', (req, res, next) => {
                next({ code: ERROR_CODES.ROOM_FULL, message: 'Room is full' });
            });
            app.use(errorHandler);

            const response = await request(app)
                .get('/test')
                .expect(403);

            expect(response.body.error.code).toBe('ROOM_FULL');
        });

        it('should handle RATE_LIMITED with 429', async () => {
            app.get('/test', (req, res, next) => {
                next({ code: ERROR_CODES.RATE_LIMITED, message: 'Too many requests' });
            });
            app.use(errorHandler);

            const response = await request(app)
                .get('/test')
                .expect(429);

            expect(response.body.error.code).toBe('RATE_LIMITED');
        });

        it('should handle NOT_AUTHORIZED with 403', async () => {
            app.get('/test', (req, res, next) => {
                next({ code: ERROR_CODES.NOT_AUTHORIZED, message: 'Not authorized' });
            });
            app.use(errorHandler);

            const response = await request(app)
                .get('/test')
                .expect(403);

            expect(response.body.error.code).toBe('NOT_AUTHORIZED');
        });

        it('should handle INVALID_INPUT with 400', async () => {
            app.get('/test', (req, res, next) => {
                next({ code: ERROR_CODES.INVALID_INPUT, message: 'Invalid input' });
            });
            app.use(errorHandler);

            const response = await request(app)
                .get('/test')
                .expect(400);

            expect(response.body.error.code).toBe('INVALID_INPUT');
        });

        it('should handle ZodError with 400', async () => {
            app.get('/test', (req, res, next) => {
                const zodError = new ZodError([
                    { code: 'invalid_type', expected: 'string', received: 'number', path: ['name'], message: 'Expected string' }
                ]);
                next(zodError);
            });
            app.use(errorHandler);

            const response = await request(app)
                .get('/test')
                .expect(400);

            expect(response.body.error.code).toBe('INVALID_INPUT');
            expect(response.body.error.message).toBe('Validation error');
        });

        it('should include error details when present', async () => {
            app.get('/test', (req, res, next) => {
                next({
                    code: ERROR_CODES.INVALID_INPUT,
                    message: 'Validation failed',
                    details: [{ field: 'name', issue: 'required' }]
                });
            });
            app.use(errorHandler);

            const response = await request(app)
                .get('/test')
                .expect(400);

            expect(response.body.error.details).toEqual([{ field: 'name', issue: 'required' }]);
        });

        it('should handle unknown errors with 500', async () => {
            app.get('/test', (req, res, next) => {
                next(new Error('Something went wrong'));
            });
            app.use(errorHandler);

            const response = await request(app)
                .get('/test')
                .expect(500);

            expect(response.body.error.code).toBe('SERVER_ERROR');
        });
    });
});

describe('CSRF Protection Middleware', () => {
    let app;

    beforeEach(() => {
        app = express();
        app.use(express.json());
        app.use(csrfProtection);
    });

    describe('Safe methods', () => {
        it('should allow GET requests without headers', async () => {
            app.get('/test', (req, res) => res.json({ success: true }));

            const response = await request(app)
                .get('/test')
                .expect(200);

            expect(response.body.success).toBe(true);
        });

        it('should allow HEAD requests without headers', async () => {
            app.head('/test', (req, res) => res.status(200).end());

            await request(app)
                .head('/test')
                .expect(200);
        });

        it('should allow OPTIONS requests without headers', async () => {
            app.options('/test', (req, res) => res.status(200).end());

            await request(app)
                .options('/test')
                .expect(200);
        });
    });

    describe('State-changing methods', () => {
        beforeEach(() => {
            app.post('/test', (req, res) => res.json({ success: true }));
            app.put('/test', (req, res) => res.json({ success: true }));
            app.delete('/test', (req, res) => res.json({ success: true }));
        });

        it('should block POST without X-Requested-With header', async () => {
            const response = await request(app)
                .post('/test')
                .send({ data: 'test' })
                .expect(403);

            expect(response.body.error.code).toBe('CSRF_VALIDATION_FAILED');
        });

        it('should block PUT without X-Requested-With header', async () => {
            const response = await request(app)
                .put('/test')
                .send({ data: 'test' })
                .expect(403);

            expect(response.body.error.code).toBe('CSRF_VALIDATION_FAILED');
        });

        it('should block DELETE without X-Requested-With header', async () => {
            const response = await request(app)
                .delete('/test')
                .expect(403);

            expect(response.body.error.code).toBe('CSRF_VALIDATION_FAILED');
        });

        it('should allow POST with X-Requested-With: XMLHttpRequest', async () => {
            const response = await request(app)
                .post('/test')
                .set('X-Requested-With', 'XMLHttpRequest')
                .send({ data: 'test' })
                .expect(200);

            expect(response.body.success).toBe(true);
        });

        it('should allow POST with X-Requested-With: fetch', async () => {
            const response = await request(app)
                .post('/test')
                .set('X-Requested-With', 'fetch')
                .send({ data: 'test' })
                .expect(200);

            expect(response.body.success).toBe(true);
        });

        it('should reject invalid X-Requested-With value', async () => {
            const response = await request(app)
                .post('/test')
                .set('X-Requested-With', 'invalid')
                .send({ data: 'test' })
                .expect(403);

            expect(response.body.error.code).toBe('CSRF_VALIDATION_FAILED');
        });
    });
});

describe('Validation Middleware', () => {
    const { z } = require('zod');

    describe('validateInput', () => {
        it('should return parsed data for valid input', () => {
            const schema = z.object({
                name: z.string(),
                age: z.number()
            });

            const result = validateInput(schema, { name: 'Test', age: 25 });

            expect(result).toEqual({ name: 'Test', age: 25 });
        });

        it('should throw error for invalid input', () => {
            const schema = z.object({
                name: z.string()
            });

            expect(() => {
                validateInput(schema, { name: 123 });
            }).toThrow();
        });

        it('should throw error with INVALID_INPUT code', () => {
            const schema = z.object({
                name: z.string()
            });

            try {
                validateInput(schema, { name: 123 });
                fail('Should have thrown');
            } catch (error) {
                expect(error.code).toBe(ERROR_CODES.INVALID_INPUT);
            }
        });

        it('should include validation details in error', () => {
            const schema = z.object({
                name: z.string(),
                email: z.string().email()
            });

            try {
                validateInput(schema, { name: 123, email: 'invalid' });
                fail('Should have thrown');
            } catch (error) {
                expect(error.details).toBeDefined();
                expect(Array.isArray(error.details)).toBe(true);
            }
        });

        it('should handle empty input gracefully', () => {
            const schema = z.object({
                name: z.string().optional()
            });

            const result = validateInput(schema, {});
            expect(result).toEqual({});
        });

        it('should handle null input', () => {
            const schema = z.object({
                name: z.string().optional()
            });

            const result = validateInput(schema, null);
            expect(result).toEqual({});
        });
    });

    describe('validateBody', () => {
        let app;
        const schema = z.object({
            name: z.string().min(1)
        });

        beforeEach(() => {
            app = express();
            app.use(express.json());
        });

        it('should pass valid body to next middleware', async () => {
            app.post('/test', validateBody(schema), (req, res) => {
                res.json({ received: req.body.name });
            });
            app.use(errorHandler);

            const response = await request(app)
                .post('/test')
                .send({ name: 'Test' })
                .expect(200);

            expect(response.body.received).toBe('Test');
        });

        it('should pass error to error handler for invalid body', async () => {
            app.post('/test', validateBody(schema), (req, res) => {
                res.json({ success: true });
            });
            app.use(errorHandler);

            const response = await request(app)
                .post('/test')
                .send({ name: '' })
                .expect(400);

            expect(response.body.error.code).toBe('INVALID_INPUT');
        });
    });

    describe('validateParams', () => {
        let app;
        const schema = z.object({
            id: z.string().uuid()
        });

        beforeEach(() => {
            app = express();
        });

        it('should pass valid params to next middleware', async () => {
            app.get('/test/:id', validateParams(schema), (req, res) => {
                res.json({ id: req.params.id });
            });
            app.use(errorHandler);

            const validUuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
            const response = await request(app)
                .get(`/test/${validUuid}`)
                .expect(200);

            expect(response.body.id).toBe(validUuid);
        });

        it('should pass error to error handler for invalid params', async () => {
            app.get('/test/:id', validateParams(schema), (req, res) => {
                res.json({ success: true });
            });
            app.use(errorHandler);

            const response = await request(app)
                .get('/test/not-a-uuid')
                .expect(400);

            expect(response.body.error.code).toBe('INVALID_INPUT');
        });
    });
});

describe('Socket Auth Middleware', () => {
    // Mock playerService
    jest.mock('../services/playerService', () => ({
        getPlayer: jest.fn(),
        setSocketMapping: jest.fn(async () => 'OK')
    }));

    const { getClientIP, checkValidationRateLimit } = require('../middleware/socketAuth');

    beforeEach(() => {
        mockRedisStorage.clear();
    });

    describe('getClientIP', () => {
        it('should return direct address when no proxy', () => {
            const socket = {
                handshake: {
                    address: '192.168.1.1',
                    headers: {}
                }
            };

            const ip = getClientIP(socket);
            expect(ip).toBe('192.168.1.1');
        });

        it('should return X-Forwarded-For when TRUST_PROXY is set', () => {
            const originalEnv = process.env.TRUST_PROXY;
            process.env.TRUST_PROXY = 'true';

            const socket = {
                handshake: {
                    address: '127.0.0.1',
                    headers: {
                        'x-forwarded-for': '203.0.113.50, 70.41.3.18'
                    }
                }
            };

            const ip = getClientIP(socket);
            expect(ip).toBe('203.0.113.50');

            process.env.TRUST_PROXY = originalEnv;
        });

        it('should not trust X-Forwarded-For without TRUST_PROXY', () => {
            const originalEnv = process.env.TRUST_PROXY;
            delete process.env.TRUST_PROXY;
            delete process.env.FLY_APP_NAME;
            delete process.env.DYNO;

            const socket = {
                handshake: {
                    address: '127.0.0.1',
                    headers: {
                        'x-forwarded-for': '203.0.113.50'
                    }
                }
            };

            const ip = getClientIP(socket);
            expect(ip).toBe('127.0.0.1');

            process.env.TRUST_PROXY = originalEnv;
        });
    });

    describe('checkValidationRateLimit', () => {
        it('should allow first request', async () => {
            const result = await checkValidationRateLimit('192.168.1.1');
            expect(result.allowed).toBe(true);
            expect(result.attempts).toBe(1);
        });

        it('should track multiple attempts from same IP', async () => {
            await checkValidationRateLimit('192.168.1.2');
            await checkValidationRateLimit('192.168.1.2');
            const result = await checkValidationRateLimit('192.168.1.2');

            expect(result.allowed).toBe(true);
            expect(result.attempts).toBe(3);
        });

        it('should allow requests from different IPs independently', async () => {
            await checkValidationRateLimit('192.168.1.3');
            await checkValidationRateLimit('192.168.1.4');

            const result1 = await checkValidationRateLimit('192.168.1.3');
            const result2 = await checkValidationRateLimit('192.168.1.4');

            expect(result1.attempts).toBe(2);
            expect(result2.attempts).toBe(2);
        });
    });
});
