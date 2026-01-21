/**
 * Input Validation Middleware
 */

const { ZodError } = require('zod');
const { ERROR_CODES } = require('../config/constants');

/**
 * Validate input against a Zod schema
 */
function validateInput(schema, data) {
    try {
        return schema.parse(data || {});
    } catch (error) {
        if (error instanceof ZodError) {
            const message = error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
            throw {
                code: ERROR_CODES.INVALID_INPUT,
                message: `Validation error: ${message}`,
                details: error.errors
            };
        }
        throw error;
    }
}

/**
 * Express middleware for validating request body
 * ISSUE #40 FIX: Use next(error) to pass to centralized error handler
 */
function validateBody(schema) {
    return (req, res, next) => {
        try {
            req.body = validateInput(schema, req.body);
            next();
        } catch (error) {
            // Ensure error has proper structure for error handler
            error.statusCode = 400;
            next(error);
        }
    };
}

/**
 * Express middleware for validating query params
 * ISSUE #40 FIX: Use next(error) to pass to centralized error handler
 */
function validateQuery(schema) {
    return (req, res, next) => {
        try {
            req.query = validateInput(schema, req.query);
            next();
        } catch (error) {
            error.statusCode = 400;
            next(error);
        }
    };
}

/**
 * Express middleware for validating URL params
 * ISSUE #40 FIX: Use next(error) to pass to centralized error handler
 */
function validateParams(schema) {
    return (req, res, next) => {
        try {
            req.params = validateInput(schema, req.params);
            next();
        } catch (error) {
            error.statusCode = 400;
            next(error);
        }
    };
}

module.exports = {
    validateInput,
    validateBody,
    validateQuery,
    validateParams
};
