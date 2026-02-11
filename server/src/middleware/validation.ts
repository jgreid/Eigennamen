/**
 * Input Validation Middleware
 */

import type { Request, Response, NextFunction } from 'express';
import type { ZodSchema, ZodError as ZodErrorType, ZodIssue } from 'zod';

import { ZodError } from 'zod';
import { ERROR_CODES } from '../config/constants';
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
 * Express middleware for validating request body
 * ISSUE #40 FIX: Use next(error) to pass to centralized error handler
 */
function validateBody<T>(schema: ZodSchema<T>): (req: Request, res: Response, next: NextFunction) => void {
    return (req: Request, _res: Response, next: NextFunction): void => {
        try {
            req.body = validateInput(schema, req.body);
            next();
        } catch (error) {
            // Ensure error has proper structure for error handler
            (error as ValidationError).statusCode = 400;
            next(error);
        }
    };
}

/**
 * Express middleware for validating query params
 * ISSUE #40 FIX: Use next(error) to pass to centralized error handler
 */
function validateQuery<T>(schema: ZodSchema<T>): (req: Request, res: Response, next: NextFunction) => void {
    return (req: Request, _res: Response, next: NextFunction): void => {
        try {
            req.query = validateInput(schema, req.query) as typeof req.query;
            next();
        } catch (error) {
            (error as ValidationError).statusCode = 400;
            next(error);
        }
    };
}

/**
 * Express middleware for validating URL params
 * ISSUE #40 FIX: Use next(error) to pass to centralized error handler
 */
function validateParams<T>(schema: ZodSchema<T>): (req: Request, res: Response, next: NextFunction) => void {
    return (req: Request, _res: Response, next: NextFunction): void => {
        try {
            req.params = validateInput(schema, req.params) as typeof req.params;
            next();
        } catch (error) {
            (error as ValidationError).statusCode = 400;
            next(error);
        }
    };
}
export {
    validateInput,
    validateBody,
    validateQuery,
    validateParams
};
