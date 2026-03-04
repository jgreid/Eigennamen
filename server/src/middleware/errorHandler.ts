import type { Request, Response, NextFunction } from 'express';

import logger from '../utils/logger';
import { ERROR_CODES } from '../config/constants';
import { isProduction } from '../config/env';

/**
 * Custom error type with code and details
 */
interface AppError extends Error {
    code?: string;
    details?: unknown;
    statusCode?: number;
}

/**
 * Zod error structure
 */
interface ZodError extends Error {
    name: 'ZodError';
    issues: Array<{
        path: (string | number)[];
        message: string;
    }>;
}

/**
 * Status code mapping for error codes
 */
type ErrorStatusMap = Record<string, number>;

/**
 * Handle 404 Not Found
 */
function notFoundHandler(_req: Request, res: Response, _next: NextFunction): void {
    res.status(404).json({
        error: {
            code: 'NOT_FOUND',
            message: 'The requested resource was not found',
        },
    });
}

/**
 * Global error handler
 */
function errorHandler(err: AppError | ZodError, _req: Request, res: Response, _next: NextFunction): Response {
    logger.error('Unhandled error:', err);

    // Handle known error types
    if ('code' in err && err.code && (Object.values(ERROR_CODES) as string[]).includes(err.code)) {
        const statusMap: ErrorStatusMap = {
            [ERROR_CODES.ROOM_NOT_FOUND]: 404,
            [ERROR_CODES.ROOM_FULL]: 403,
            [ERROR_CODES.ROOM_ALREADY_EXISTS]: 409,
            [ERROR_CODES.GAME_IN_PROGRESS]: 409,
            [ERROR_CODES.NOT_HOST]: 403,
            [ERROR_CODES.NOT_SPYMASTER]: 403,
            [ERROR_CODES.NOT_CLICKER]: 403,
            [ERROR_CODES.NOT_YOUR_TURN]: 400,
            [ERROR_CODES.CARD_ALREADY_REVEALED]: 400,
            [ERROR_CODES.GAME_OVER]: 400,
            [ERROR_CODES.GAME_NOT_STARTED]: 409,
            [ERROR_CODES.INVALID_INPUT]: 400,
            [ERROR_CODES.RATE_LIMITED]: 429,
            [ERROR_CODES.NOT_AUTHORIZED]: 403,
            [ERROR_CODES.SERVER_ERROR]: 500,
            [ERROR_CODES.SESSION_EXPIRED]: 401,
            [ERROR_CODES.SESSION_NOT_FOUND]: 401,
            [ERROR_CODES.SESSION_VALIDATION_RATE_LIMITED]: 429,
            [ERROR_CODES.RESERVED_NAME]: 400,
            [ERROR_CODES.CANNOT_SWITCH_TEAM_DURING_TURN]: 400,
            [ERROR_CODES.CANNOT_CHANGE_ROLE_DURING_TURN]: 400,
            [ERROR_CODES.SPYMASTER_CANNOT_CHANGE_TEAM]: 400,
            [ERROR_CODES.PLAYER_NOT_FOUND]: 404,
        };

        // Allowlist of detail fields that are safe to expose to clients.
        // Any field NOT in this list is stripped, preventing accidental
        // disclosure when new internal fields are added to GameErrorDetails.
        const ALLOWED_DETAIL_FIELDS = ['roomCode', 'team', 'index', 'max', 'recoverable', 'suggestion', 'retryable'];

        const rawDetails = (err as AppError).details;
        let safeDetails: Record<string, unknown> | undefined;
        if (rawDetails && typeof rawDetails === 'object' && !Array.isArray(rawDetails)) {
            const filtered: Record<string, unknown> = {};
            for (const key of ALLOWED_DETAIL_FIELDS) {
                if (key in (rawDetails as Record<string, unknown>)) {
                    filtered[key] = (rawDetails as Record<string, unknown>)[key];
                }
            }
            safeDetails = Object.keys(filtered).length > 0 ? filtered : undefined;
        }

        return res.status(statusMap[err.code] || 500).json({
            error: {
                code: err.code,
                message: err.message,
                ...(safeDetails !== undefined && { details: safeDetails }),
            },
        });
    }

    // Handle validation errors (Zod)
    if (err.name === 'ZodError') {
        const zodErr = err as ZodError;
        // In production, strip field paths to avoid exposing schema structure.
        // In development, keep full issue details for debugging convenience.
        const issues = isProduction() ? zodErr.issues.map((issue) => ({ message: issue.message })) : zodErr.issues;
        return res.status(400).json({
            error: {
                code: ERROR_CODES.INVALID_INPUT,
                message: 'Validation error',
                details: issues,
            },
        });
    }

    // Default error response
    return res.status(500).json({
        error: {
            code: ERROR_CODES.SERVER_ERROR,
            message: isProduction() ? 'Internal server error' : err.message,
        },
    });
}

export { notFoundHandler, errorHandler };
