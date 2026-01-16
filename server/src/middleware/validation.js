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
 */
function validateBody(schema) {
    return (req, res, next) => {
        try {
            req.body = validateInput(schema, req.body);
            next();
        } catch (error) {
            res.status(400).json({ error });
        }
    };
}

/**
 * Express middleware for validating query params
 */
function validateQuery(schema) {
    return (req, res, next) => {
        try {
            req.query = validateInput(schema, req.query);
            next();
        } catch (error) {
            res.status(400).json({ error });
        }
    };
}

/**
 * Express middleware for validating URL params
 */
function validateParams(schema) {
    return (req, res, next) => {
        try {
            req.params = validateInput(schema, req.params);
            next();
        } catch (error) {
            res.status(400).json({ error });
        }
    };
}

module.exports = {
    validateInput,
    validateBody,
    validateQuery,
    validateParams
};
