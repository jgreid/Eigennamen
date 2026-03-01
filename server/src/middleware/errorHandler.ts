import type { Request, Response, NextFunction } from 'express';

import logger from '../utils/logger';
import { ERROR_CODES } from '../config/constants';

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

        // Strip internal identifiers from details before sending to client
        const rawDetails = (err as AppError).details;
        let safeDetails = rawDetails;
        if (rawDetails && typeof rawDetails === 'object' && !Array.isArray(rawDetails)) {
            const { sessionId: _s, roomId: _r, operation: _o, ...rest } = rawDetails as Record<string, unknown>;
            safeDetails = Object.keys(rest).length > 0 ? rest : undefined;
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
        return res.status(400).json({
            error: {
                code: ERROR_CODES.INVALID_INPUT,
                message: 'Validation error',
                details: zodErr.issues,
            },
        });
    }

    // Default error response
    return res.status(500).json({
        error: {
            code: ERROR_CODES.SERVER_ERROR,
            message: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
        },
    });
}

export { notFoundHandler, errorHandler };
