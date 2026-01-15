/**
 * Error Handling Middleware
 */

const logger = require('../utils/logger');
const { ERROR_CODES } = require('../config/constants');

/**
 * Handle 404 Not Found
 */
function notFoundHandler(req, res, next) {
    res.status(404).json({
        error: {
            code: 'NOT_FOUND',
            message: `Route ${req.method} ${req.path} not found`
        }
    });
}

/**
 * Global error handler
 */
function errorHandler(err, req, res, next) {
    logger.error('Unhandled error:', err);

    // Handle known error types
    if (err.code && Object.values(ERROR_CODES).includes(err.code)) {
        const statusMap = {
            [ERROR_CODES.ROOM_NOT_FOUND]: 404,
            [ERROR_CODES.ROOM_FULL]: 403,
            [ERROR_CODES.ROOM_EXPIRED]: 410,
            [ERROR_CODES.GAME_IN_PROGRESS]: 409,
            [ERROR_CODES.NOT_HOST]: 403,
            [ERROR_CODES.NOT_SPYMASTER]: 403,
            [ERROR_CODES.NOT_YOUR_TURN]: 400,
            [ERROR_CODES.CARD_ALREADY_REVEALED]: 400,
            [ERROR_CODES.GAME_OVER]: 400,
            [ERROR_CODES.INVALID_INPUT]: 400,
            [ERROR_CODES.RATE_LIMITED]: 429,
            [ERROR_CODES.SERVER_ERROR]: 500
        };

        return res.status(statusMap[err.code] || 500).json({
            error: {
                code: err.code,
                message: err.message,
                details: err.details
            }
        });
    }

    // Handle validation errors (Zod)
    if (err.name === 'ZodError') {
        return res.status(400).json({
            error: {
                code: ERROR_CODES.INVALID_INPUT,
                message: 'Validation error',
                details: err.errors
            }
        });
    }

    // Default error response
    res.status(500).json({
        error: {
            code: ERROR_CODES.SERVER_ERROR,
            message: process.env.NODE_ENV === 'production'
                ? 'Internal server error'
                : err.message
        }
    });
}

module.exports = {
    notFoundHandler,
    errorHandler
};
