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
            const message = zodError.issues.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
            const validationError: ValidationError = {
                code: ERROR_CODES.INVALID_INPUT,
                message: `Validation error: ${message}`,
                details: zodError.issues
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
            const validated = validateInput(schema, req[source]);
            // In Express 5, req.query is a getter and cannot be assigned directly.
            // For body and params, we replace the value on the request object.
            if (source !== 'query') {
                (req as unknown as Record<string, unknown>)[source] = validated;
            }
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

export {
    validateInput,
    validateBody,
    validateQuery,
    validateParams
};
