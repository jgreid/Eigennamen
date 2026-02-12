/**
 * Input Validation Middleware
 */

import type { Request, Response, NextFunction } from 'express';
import type { ZodSchema, ZodError as ZodErrorType, ZodIssue } from 'zod';

const { ZodError } = require('zod');
const { ERROR_CODES } = require('../config/constants');

/**
 * Validation error structure
 */
interface ValidationError {
    code: string;
    message: string;
    details: ZodIssue[];
    statusCode?: number;
}

/**
 * Validate input against a Zod schema
 */
function validateInput<T>(schema: ZodSchema<T>, data: unknown): T {
    try {
        return schema.parse(data || {});
    } catch (error) {
        if (error instanceof ZodError) {
            const zodError = error as ZodErrorType;
            const message = zodError.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
            const validationError: ValidationError = {
                code: ERROR_CODES.INVALID_INPUT,
                message: `Validation error: ${message}`,
                details: zodError.errors
            };
            throw validationError;
        }
        throw error;
    }
}

/**
 * Create Express validation middleware for a given request source
 */
function validateSource<T>(source: 'body' | 'query' | 'params', schema: ZodSchema<T>): (req: Request, res: Response, next: NextFunction) => void {
    return (req: Request, _res: Response, next: NextFunction): void => {
        try {
            (req as unknown as Record<string, unknown>)[source] = validateInput(schema, req[source]);
            next();
        } catch (error) {
            (error as ValidationError).statusCode = 400;
            next(error);
        }
    };
}

const validateBody = <T>(schema: ZodSchema<T>) => validateSource('body', schema);
const validateQuery = <T>(schema: ZodSchema<T>) => validateSource('query', schema);
const validateParams = <T>(schema: ZodSchema<T>) => validateSource('params', schema);

module.exports = {
    validateInput,
    validateBody,
    validateQuery,
    validateParams
};

export {
    validateInput,
    validateBody,
    validateQuery,
    validateParams
};
