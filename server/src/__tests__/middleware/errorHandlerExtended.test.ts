/**
 * Extended Error Handler and Validation Middleware Tests
 *
 * Additional coverage for edge cases and comprehensive error scenarios.
 */

const express = require('express');
const request = require('supertest');
const { ZodError } = require('zod');

// Mock logger
jest.mock('../../utils/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
}));

const { errorHandler } = require('../../middleware/errorHandler');
const { ERROR_CODES } = require('../../config/constants');
const logger = require('../../utils/logger');

describe('Error Handler Extended Tests', () => {
    let app;

    beforeEach(() => {
        jest.clearAllMocks();
        app = express();
        app.use(express.json());
    });

    describe('errorHandler - extended edge cases', () => {
        it('should mask error details in production', async () => {
            const originalEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'production';

            app.get('/test', (req, res, next) => {
                next(new Error('Sensitive database connection string revealed'));
            });
            app.use(errorHandler);

            const response = await request(app).get('/test').expect(500);

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

            const response = await request(app).get('/test').expect(500);

            expect(response.body.error.message).toBe('Detailed error message');

            process.env.NODE_ENV = originalEnv;
        });

        it('should handle ZodError with multiple validation errors', async () => {
            app.get('/test', (req, res, next) => {
                const zodError = new ZodError([
                    {
                        code: 'invalid_type',
                        expected: 'string',
                        received: 'number',
                        path: ['name'],
                        message: 'Expected string',
                    },
                    {
                        code: 'too_small',
                        minimum: 1,
                        type: 'string',
                        inclusive: true,
                        path: ['email'],
                        message: 'Too short',
                    },
                    { code: 'invalid_string', validation: 'email', path: ['email'], message: 'Invalid email' },
                ]);
                next(zodError);
            });
            app.use(errorHandler);

            const response = await request(app).get('/test').expect(400);

            expect(response.body.error.code).toBe('INVALID_INPUT');
            expect(response.body.error.details).toHaveLength(3);
        });

        it('should strip field paths from ZodError in production', async () => {
            const originalEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'production';

            app.get('/test', (req, res, next) => {
                const zodError = new ZodError([
                    {
                        code: 'invalid_type',
                        expected: 'string',
                        received: 'number',
                        path: ['nickname'],
                        message: 'Expected string',
                    },
                    {
                        code: 'too_small',
                        minimum: 3,
                        type: 'string',
                        inclusive: true,
                        path: ['roomCode'],
                        message: 'Too short',
                    },
                ]);
                next(zodError);
            });
            app.use(errorHandler);

            const response = await request(app).get('/test').expect(400);

            expect(response.body.error.details).toHaveLength(2);
            // Only message should be present — no path, code, or other Zod metadata
            expect(response.body.error.details[0]).toEqual({ message: 'Expected string' });
            expect(response.body.error.details[1]).toEqual({ message: 'Too short' });
            // Verify field names are NOT exposed
            expect(JSON.stringify(response.body.error.details)).not.toContain('nickname');
            expect(JSON.stringify(response.body.error.details)).not.toContain('roomCode');

            process.env.NODE_ENV = originalEnv;
        });

        it('should include full ZodError details in development', async () => {
            const originalEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'development';

            app.get('/test', (req, res, next) => {
                const zodError = new ZodError([
                    {
                        code: 'invalid_type',
                        expected: 'string',
                        received: 'number',
                        path: ['nickname'],
                        message: 'Expected string',
                    },
                ]);
                next(zodError);
            });
            app.use(errorHandler);

            const response = await request(app).get('/test').expect(400);

            // In development, full details including path should be present
            expect(response.body.error.details[0].path).toEqual(['nickname']);
            expect(response.body.error.details[0].message).toBe('Expected string');

            process.env.NODE_ENV = originalEnv;
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

            const response = await request(app).get('/test').expect(400);

            expect(response.body.error.code).toBe('INVALID_INPUT');
            expect(response.body.error.message).toBeUndefined();
        });

        it('should only expose allowlisted detail fields to client', async () => {
            app.get('/test', (req, res, next) => {
                next({
                    code: ERROR_CODES.ROOM_NOT_FOUND,
                    message: 'Room not found',
                    details: {
                        roomCode: 'ABC123',
                        team: 'red',
                        index: 5,
                        max: 25,
                        recoverable: true,
                        suggestion: 'Create a new room',
                        retryable: false,
                        // These internal fields must NOT appear in the response
                        sessionId: 'secret-session-id',
                        roomId: 'internal-room-id',
                        operation: 'internalOp',
                    },
                });
            });
            app.use(errorHandler);

            const response = await request(app).get('/test').expect(404);

            // Allowed fields should be present
            expect(response.body.error.details.roomCode).toBe('ABC123');
            expect(response.body.error.details.team).toBe('red');
            expect(response.body.error.details.index).toBe(5);
            expect(response.body.error.details.max).toBe(25);
            expect(response.body.error.details.recoverable).toBe(true);
            expect(response.body.error.details.suggestion).toBe('Create a new room');
            expect(response.body.error.details.retryable).toBe(false);

            // Internal fields must NOT leak
            expect(response.body.error.details.sessionId).toBeUndefined();
            expect(response.body.error.details.roomId).toBeUndefined();
            expect(response.body.error.details.operation).toBeUndefined();
        });

        it('should omit details entirely when no allowed fields are present', async () => {
            app.get('/test', (req, res, next) => {
                next({
                    code: ERROR_CODES.NOT_AUTHORIZED,
                    message: 'Not authorized',
                    details: {
                        sessionId: 'secret-session-id',
                        operation: 'kick',
                    },
                });
            });
            app.use(errorHandler);

            const response = await request(app).get('/test').expect(403);

            expect(response.body.error.details).toBeUndefined();
        });
    });
});
