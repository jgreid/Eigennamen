/**
 * Extended Error Handler and Validation Middleware Tests
 *
 * Additional coverage for edge cases and comprehensive error scenarios.
 */

const express = require('express');
const request = require('supertest');
const { ZodError, z } = require('zod');

// Mock logger
jest.mock('../../utils/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
}));

const { notFoundHandler, errorHandler } = require('../../middleware/errorHandler');
const { validateInput, validateBody, validateQuery, validateParams } = require('../../middleware/validation');
const { ERROR_CODES } = require('../../config/constants');
const logger = require('../../utils/logger');

describe('Error Handler Extended Tests', () => {
    let app;

    beforeEach(() => {
        jest.clearAllMocks();
        app = express();
        app.use(express.json());
    });

    describe('errorHandler - complete error code coverage', () => {
        const errorCodeTests = [
            { code: ERROR_CODES.ROOM_NOT_FOUND, expectedStatus: 404 },
            { code: ERROR_CODES.ROOM_FULL, expectedStatus: 403 },
            { code: ERROR_CODES.ROOM_ALREADY_EXISTS, expectedStatus: 409 },
            { code: ERROR_CODES.GAME_IN_PROGRESS, expectedStatus: 409 },
            { code: ERROR_CODES.NOT_HOST, expectedStatus: 403 },
            { code: ERROR_CODES.NOT_SPYMASTER, expectedStatus: 403 },
            { code: ERROR_CODES.NOT_CLICKER, expectedStatus: 403 },
            { code: ERROR_CODES.NOT_YOUR_TURN, expectedStatus: 400 },
            { code: ERROR_CODES.CARD_ALREADY_REVEALED, expectedStatus: 400 },
            { code: ERROR_CODES.GAME_OVER, expectedStatus: 400 },
            { code: ERROR_CODES.GAME_NOT_STARTED, expectedStatus: 409 },
            { code: ERROR_CODES.INVALID_INPUT, expectedStatus: 400 },
            { code: ERROR_CODES.RATE_LIMITED, expectedStatus: 429 },
            { code: ERROR_CODES.WORD_LIST_NOT_FOUND, expectedStatus: 404 },
            { code: ERROR_CODES.NOT_AUTHORIZED, expectedStatus: 403 },
            { code: ERROR_CODES.SERVER_ERROR, expectedStatus: 500 },
            { code: ERROR_CODES.SESSION_EXPIRED, expectedStatus: 401 },
            { code: ERROR_CODES.SESSION_NOT_FOUND, expectedStatus: 401 },
            { code: ERROR_CODES.SESSION_VALIDATION_RATE_LIMITED, expectedStatus: 429 },
            { code: ERROR_CODES.RESERVED_NAME, expectedStatus: 400 },
            { code: ERROR_CODES.CANNOT_SWITCH_TEAM_DURING_TURN, expectedStatus: 400 },
            { code: ERROR_CODES.CANNOT_CHANGE_ROLE_DURING_TURN, expectedStatus: 400 },
            { code: ERROR_CODES.SPYMASTER_CANNOT_CHANGE_TEAM, expectedStatus: 400 },
            { code: ERROR_CODES.PLAYER_NOT_FOUND, expectedStatus: 404 }
        ];

        it.each(errorCodeTests)('should return $expectedStatus for $code', async ({ code, expectedStatus }) => {
            app.get('/test', (req: any, res: any, next: any) => {
                next({ code, message: `Test error: ${code}` });
            });
            app.use(errorHandler);

            const response = await request(app)
                .get('/test')
                .expect(expectedStatus);

            expect(response.body.error.code).toBe(code);
        });

        it('should return 500 for unknown error codes', async () => {
            app.get('/test', (req, res, next) => {
                next({ code: 'UNKNOWN_ERROR_CODE', message: 'Unknown error' });
            });
            app.use(errorHandler);

            const response = await request(app)
                .get('/test')
                .expect(500);

            expect(response.body.error.code).toBe('SERVER_ERROR');
        });

        it('should mask error details in production', async () => {
            const originalEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'production';

            app.get('/test', (req, res, next) => {
                next(new Error('Sensitive database connection string revealed'));
            });
            app.use(errorHandler);

            const response = await request(app)
                .get('/test')
                .expect(500);

            expect(response.body.error.message).toBe('Internal server error');
            expect(response.body.error.message).not.toContain('database');

            process.env.NODE_ENV = originalEnv;
        });

        it('should show error details in development', async () => {
            const originalEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'development';

            app.get('/test', (req, res, next) => {
                next(new Error('Detailed error message'));
            });
            app.use(errorHandler);

            const response = await request(app)
                .get('/test')
                .expect(500);

            expect(response.body.error.message).toBe('Detailed error message');

            process.env.NODE_ENV = originalEnv;
        });

        it('should handle ZodError with multiple validation errors', async () => {
            app.get('/test', (req, res, next) => {
                const zodError = new ZodError([
                    { code: 'invalid_type', expected: 'string', received: 'number', path: ['name'], message: 'Expected string' },
                    { code: 'too_small', minimum: 1, type: 'string', inclusive: true, path: ['email'], message: 'Too short' },
                    { code: 'invalid_string', validation: 'email', path: ['email'], message: 'Invalid email' }
                ]);
                next(zodError);
            });
            app.use(errorHandler);

            const response = await request(app)
                .get('/test')
                .expect(400);

            expect(response.body.error.code).toBe('INVALID_INPUT');
            expect(response.body.error.details).toHaveLength(3);
        });

        it('should log all errors', async () => {
            app.get('/test', (req, res, next) => {
                next(new Error('Test error for logging'));
            });
            app.use(errorHandler);

            await request(app).get('/test');

            expect(logger.error).toHaveBeenCalledWith('Unhandled error:', expect.any(Error));
        });

        it('should handle errors without message property', async () => {
            app.get('/test', (req, res, next) => {
                next({ code: ERROR_CODES.INVALID_INPUT });
            });
            app.use(errorHandler);

            const response = await request(app)
                .get('/test')
                .expect(400);

            expect(response.body.error.code).toBe('INVALID_INPUT');
            expect(response.body.error.message).toBeUndefined();
        });
    });

    describe('notFoundHandler - edge cases', () => {
        beforeEach(() => {
            app.use(notFoundHandler);
        });

        it('should handle DELETE requests', async () => {
            const response = await request(app)
                .delete('/unknown/resource')
                .expect(404);

            expect(response.body.error.message).toContain('DELETE');
            expect(response.body.error.message).toContain('/unknown/resource');
        });

        it('should handle PUT requests', async () => {
            const response = await request(app)
                .put('/api/nonexistent')
                .expect(404);

            expect(response.body.error.message).toContain('PUT');
        });

        it('should handle PATCH requests', async () => {
            const response = await request(app)
                .patch('/api/resource/123')
                .expect(404);

            expect(response.body.error.message).toContain('PATCH');
        });

        it('should handle paths with query parameters', async () => {
            const response = await request(app)
                .get('/search?q=test&page=1')
                .expect(404);

            expect(response.body.error.message).toContain('/search');
        });

        it('should handle paths with special characters', async () => {
            const response = await request(app)
                .get('/path/with%20spaces')
                .expect(404);

            expect(response.body.error.code).toBe('NOT_FOUND');
        });
    });
});

describe('Validation Middleware Extended Tests', () => {
    let app;

    beforeEach(() => {
        app = express();
        app.use(express.json());
    });

    describe('validateInput - comprehensive edge cases', () => {
        it('should handle deeply nested object validation', () => {
            const schema = z.object({
                user: z.object({
                    profile: z.object({
                        name: z.string(),
                        settings: z.object({
                            notifications: z.boolean()
                        })
                    })
                })
            });

            const validData = {
                user: {
                    profile: {
                        name: 'Test',
                        settings: {
                            notifications: true
                        }
                    }
                }
            };

            const result = validateInput(schema, validData);
            expect(result).toEqual(validData);
        });

        it('should throw error with path for nested validation failure', () => {
            const schema = z.object({
                user: z.object({
                    name: z.string()
                })
            });

            try {
                validateInput(schema, { user: { name: 123 } });
                fail('Should have thrown');
            } catch (error) {
                expect(error.code).toBe(ERROR_CODES.INVALID_INPUT);
                expect(error.message).toContain('user.name');
            }
        });

        it('should handle array validation', () => {
            const schema = z.object({
                items: z.array(z.string()).min(1).max(5)
            });

            const result = validateInput(schema, { items: ['a', 'b', 'c'] });
            expect(result.items).toHaveLength(3);
        });

        it('should throw error for empty required array', () => {
            const schema = z.object({
                items: z.array(z.string()).min(1)
            });

            try {
                validateInput(schema, { items: [] });
                fail('Should have thrown');
            } catch (error) {
                expect(error.code).toBe(ERROR_CODES.INVALID_INPUT);
            }
        });

        it('should handle enum validation', () => {
            const schema = z.object({
                status: z.enum(['active', 'inactive', 'pending'])
            });

            const result = validateInput(schema, { status: 'active' });
            expect(result.status).toBe('active');
        });

        it('should throw error for invalid enum value', () => {
            const schema = z.object({
                status: z.enum(['active', 'inactive'])
            });

            try {
                validateInput(schema, { status: 'unknown' });
                fail('Should have thrown');
            } catch (error) {
                expect(error.code).toBe(ERROR_CODES.INVALID_INPUT);
                expect(error.message).toContain('status');
            }
        });

        it('should handle union types', () => {
            const schema = z.object({
                value: z.union([z.string(), z.number()])
            });

            expect(validateInput(schema, { value: 'string' }).value).toBe('string');
            expect(validateInput(schema, { value: 42 }).value).toBe(42);
        });

        it('should handle optional fields with defaults', () => {
            const schema = z.object({
                name: z.string(),
                count: z.number().default(0)
            });

            const result = validateInput(schema, { name: 'Test' });
            expect(result.count).toBe(0);
        });

        it('should handle string transformations', () => {
            const schema = z.object({
                email: z.string().toLowerCase().trim()
            });

            const result = validateInput(schema, { email: '  TEST@EXAMPLE.COM  ' });
            expect(result.email).toBe('test@example.com');
        });

        it('should re-throw non-ZodError errors', () => {
            // Create a schema that throws a different error
            const schema = {
                parse: () => {
                    throw new TypeError('Custom type error');
                }
            };

            expect(() => validateInput(schema, {})).toThrow(TypeError);
        });
    });

    describe('validateBody - HTTP integration', () => {
        const schema = z.object({
            name: z.string().min(1).max(50),
            age: z.number().int().positive().optional()
        });

        beforeEach(() => {
            app.post('/test', validateBody(schema), (req, res) => {
                res.json({ success: true, data: req.body });
            });
            app.use(errorHandler);
        });

        it('should transform and pass valid body', async () => {
            const response = await request(app)
                .post('/test')
                .send({ name: 'John', age: 25 })
                .expect(200);

            expect(response.body.data).toEqual({ name: 'John', age: 25 });
        });

        it('should handle missing optional fields', async () => {
            const response = await request(app)
                .post('/test')
                .send({ name: 'John' })
                .expect(200);

            expect(response.body.data.name).toBe('John');
            expect(response.body.data.age).toBeUndefined();
        });

        it('should reject too long name', async () => {
            const response = await request(app)
                .post('/test')
                .send({ name: 'a'.repeat(51) })
                .expect(400);

            expect(response.body.error.code).toBe('INVALID_INPUT');
        });

        it('should reject negative age', async () => {
            const response = await request(app)
                .post('/test')
                .send({ name: 'John', age: -5 })
                .expect(400);

            expect(response.body.error.code).toBe('INVALID_INPUT');
        });

        it('should reject non-integer age', async () => {
            const response = await request(app)
                .post('/test')
                .send({ name: 'John', age: 25.5 })
                .expect(400);

            expect(response.body.error.code).toBe('INVALID_INPUT');
        });

        it('should handle empty JSON body', async () => {
            const response = await request(app)
                .post('/test')
                .send({})
                .expect(400);

            expect(response.body.error.code).toBe('INVALID_INPUT');
        });

        it('should handle malformed JSON', async () => {
            // Note: Express returns 500 for JSON parse errors by default
            // unless a custom error handler converts it to 400
            const response = await request(app)
                .post('/test')
                .set('Content-Type', 'application/json')
                .send('{ invalid json }');

            // Either 400 (if custom handler) or 500 (default) is acceptable
            expect([400, 500]).toContain(response.status);
        });
    });

    describe('validateQuery - HTTP integration', () => {
        const schema = z.object({
            page: z.string().regex(/^\d+$/).optional(),
            limit: z.string().regex(/^\d+$/).optional(),
            sort: z.enum(['asc', 'desc']).optional()
        });

        beforeEach(() => {
            app.get('/search', validateQuery(schema), (req, res) => {
                res.json({ query: req.query });
            });
            app.use(errorHandler);
        });

        it('should pass valid query parameters', async () => {
            const response = await request(app)
                .get('/search?page=1&limit=10&sort=asc')
                .expect(200);

            expect(response.body.query).toEqual({
                page: '1',
                limit: '10',
                sort: 'asc'
            });
        });

        it('should handle missing optional parameters', async () => {
            const response = await request(app)
                .get('/search')
                .expect(200);

            expect(response.body.query).toEqual({});
        });

        it('should reject invalid sort value', async () => {
            const response = await request(app)
                .get('/search?sort=invalid')
                .expect(400);

            expect(response.body.error.code).toBe('INVALID_INPUT');
        });

        it('should reject non-numeric page', async () => {
            const response = await request(app)
                .get('/search?page=abc')
                .expect(400);

            expect(response.body.error.code).toBe('INVALID_INPUT');
        });
    });

    describe('validateParams - HTTP integration', () => {
        const schema = z.object({
            roomCode: z.string().length(6).regex(/^[A-Z]+$/)
        });

        beforeEach(() => {
            app.get('/rooms/:roomCode', validateParams(schema), (req, res) => {
                res.json({ roomCode: req.params.roomCode });
            });
            app.use(errorHandler);
        });

        it('should pass valid room code', async () => {
            const response = await request(app)
                .get('/rooms/ABCDEF')
                .expect(200);

            expect(response.body.roomCode).toBe('ABCDEF');
        });

        it('should reject room code with wrong length', async () => {
            const response = await request(app)
                .get('/rooms/ABC')
                .expect(400);

            expect(response.body.error.code).toBe('INVALID_INPUT');
        });

        it('should reject room code with lowercase letters', async () => {
            const response = await request(app)
                .get('/rooms/abcdef')
                .expect(400);

            expect(response.body.error.code).toBe('INVALID_INPUT');
        });

        it('should reject room code with numbers', async () => {
            const response = await request(app)
                .get('/rooms/ABC123')
                .expect(400);

            expect(response.body.error.code).toBe('INVALID_INPUT');
        });
    });

    describe('Combined validation scenarios', () => {
        it('should validate body, query, and params together', async () => {
            const bodySchema = z.object({ data: z.string() });
            const querySchema = z.object({ format: z.enum(['json', 'xml']).optional() });
            const paramsSchema = z.object({ id: z.string().uuid() });

            app.put(
                '/resources/:id',
                validateParams(paramsSchema),
                validateQuery(querySchema),
                validateBody(bodySchema),
                (req, res) => {
                    res.json({
                        id: req.params.id,
                        format: req.query.format,
                        data: req.body.data
                    });
                }
            );
            app.use(errorHandler);

            const validUuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
            const response = await request(app)
                .put(`/resources/${validUuid}?format=json`)
                .send({ data: 'test content' })
                .expect(200);

            expect(response.body.id).toBe(validUuid);
            expect(response.body.format).toBe('json');
            expect(response.body.data).toBe('test content');
        });
    });
});
