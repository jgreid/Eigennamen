/**
 * JWT Security Configuration
 *
 * Provides secure JWT configuration with production requirements.
 */

const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

// JWT configuration constants
const JWT_CONFIG = {
    algorithm: 'HS256',
    expiresIn: '24h',
    issuer: 'die-eigennamen',
    audience: 'game-client'
};

// Minimum secret length for production
const MIN_SECRET_LENGTH = 32;

// Development-only fallback secret (never use in production)
const DEV_SECRET = 'development-secret-do-not-use-in-production';

/**
 * Get JWT secret with validation
 * @returns {string|null} - JWT secret or null if not configured
 * @throws {Error} - In production if secret is missing or too short
 */
function getJwtSecret() {
    const secret = process.env.JWT_SECRET;
    const isProduction = process.env.NODE_ENV === 'production';

    if (isProduction) {
        if (!secret) {
            logger.warn('JWT_SECRET not configured in production - JWT authentication disabled');
            return null;
        }
        if (secret.length < MIN_SECRET_LENGTH) {
            throw new Error(`JWT_SECRET must be at least ${MIN_SECRET_LENGTH} characters in production`);
        }
        return secret;
    }

    // In development, use provided secret or fallback
    if (secret) {
        if (secret.length < MIN_SECRET_LENGTH) {
            logger.warn(`JWT_SECRET is shorter than ${MIN_SECRET_LENGTH} characters - this is insecure`);
        }
        return secret;
    }

    // Development fallback
    logger.debug('Using development JWT secret - do not use in production');
    return DEV_SECRET;
}

/**
 * Check if JWT authentication is available
 * @returns {boolean} - True if JWT is configured and usable
 */
function isJwtEnabled() {
    try {
        return getJwtSecret() !== null;
    } catch (e) {
        // FIX M14: Log error instead of silently returning false
        logger.debug('JWT not enabled:', e.message);
        return false;
    }
}

/**
 * Sign a JWT token with proper configuration
 * @param {object} payload - Token payload
 * @param {object} options - Additional options to merge with defaults
 * @returns {string|null} - Signed token or null if JWT not configured
 */
function signToken(payload, options = {}) {
    const secret = getJwtSecret();
    if (!secret) {
        return null;
    }

    const signOptions = {
        algorithm: JWT_CONFIG.algorithm,
        expiresIn: options.expiresIn || JWT_CONFIG.expiresIn,
        issuer: JWT_CONFIG.issuer,
        audience: JWT_CONFIG.audience,
        ...options
    };

    // Remove non-jwt.sign options
    delete signOptions.expiresIn;

    return jwt.sign(payload, secret, {
        ...signOptions,
        expiresIn: options.expiresIn || JWT_CONFIG.expiresIn
    });
}

// JWT error codes for structured error handling
const JWT_ERROR_CODES = {
    TOKEN_EXPIRED: 'TOKEN_EXPIRED',
    TOKEN_INVALID: 'TOKEN_INVALID',
    TOKEN_MALFORMED: 'TOKEN_MALFORMED',
    TOKEN_NOT_ACTIVE: 'TOKEN_NOT_ACTIVE',
    CLAIMS_MISMATCH: 'CLAIMS_MISMATCH',
    JWT_NOT_CONFIGURED: 'JWT_NOT_CONFIGURED'
};

/**
 * Verify and decode a JWT token with detailed error information
 * @param {string} token - Token to verify
 * @param {object} options - Optional verification options
 * @param {boolean} options.returnError - If true, returns error object instead of null on failure
 * @returns {object|null} - Decoded payload, or error object if returnError is true, or null if invalid
 */
function verifyToken(token, options = {}) {
    const secret = getJwtSecret();
    if (!secret) {
        if (options.returnError) {
            return { error: JWT_ERROR_CODES.JWT_NOT_CONFIGURED, message: 'JWT authentication not configured' };
        }
        return null;
    }

    try {
        return jwt.verify(token, secret, {
            algorithms: [JWT_CONFIG.algorithm],
            issuer: JWT_CONFIG.issuer,
            audience: JWT_CONFIG.audience
        });
    } catch (error) {
        let errorCode;
        let errorMessage;

        if (error.name === 'TokenExpiredError') {
            errorCode = JWT_ERROR_CODES.TOKEN_EXPIRED;
            errorMessage = `Token expired at ${error.expiredAt}`;
            logger.debug('JWT token expired', { expiredAt: error.expiredAt });
        } else if (error.name === 'NotBeforeError') {
            errorCode = JWT_ERROR_CODES.TOKEN_NOT_ACTIVE;
            errorMessage = `Token not active until ${error.date}`;
            logger.debug('JWT token not yet active', { notBefore: error.date });
        } else if (error.name === 'JsonWebTokenError') {
            // Distinguish between malformed and other JWT errors
            if (error.message.includes('malformed') || error.message.includes('invalid')) {
                errorCode = JWT_ERROR_CODES.TOKEN_MALFORMED;
            } else {
                errorCode = JWT_ERROR_CODES.TOKEN_INVALID;
            }
            errorMessage = error.message;
            logger.debug('Invalid JWT token:', error.message);
        } else {
            errorCode = JWT_ERROR_CODES.TOKEN_INVALID;
            errorMessage = error.message;
            logger.warn('JWT verification error:', error.message);
        }

        if (options.returnError) {
            return { error: errorCode, message: errorMessage };
        }
        return null;
    }
}

/**
 * Verify token and validate that claims match expected values
 * @param {string} token - Token to verify
 * @param {object} expectedClaims - Claims to validate (e.g., { userId, sessionId })
 * @returns {{valid: boolean, decoded?: object, error?: string, message?: string}}
 */
function verifyTokenWithClaims(token, expectedClaims = {}) {
    const result = verifyToken(token, { returnError: true });

    // Check if verification failed
    if (result && result.error) {
        return { valid: false, error: result.error, message: result.message };
    }

    // Check if token decoded successfully
    if (!result) {
        return { valid: false, error: JWT_ERROR_CODES.TOKEN_INVALID, message: 'Token verification failed' };
    }

    // Validate expected claims
    for (const [key, expectedValue] of Object.entries(expectedClaims)) {
        if (expectedValue !== undefined && result[key] !== expectedValue) {
            logger.debug('JWT claims mismatch', {
                claim: key,
                expected: expectedValue,
                actual: result[key]
            });
            return {
                valid: false,
                error: JWT_ERROR_CODES.CLAIMS_MISMATCH,
                message: `Claim '${key}' does not match expected value`
            };
        }
    }

    return { valid: true, decoded: result };
}

/**
 * Decode a token without verification (for debugging/logging)
 * @param {string} token - Token to decode
 * @returns {object|null} - Decoded payload or null if malformed
 */
function decodeToken(token) {
    try {
        return jwt.decode(token);
    } catch (e) {
        // FIX M14: Log error instead of silently returning null
        logger.debug('Failed to decode token:', e.message);
        return null;
    }
}

/**
 * Generate a new session token for a user
 * @param {string} userId - User ID
 * @param {string} sessionId - Session ID
 * @param {object} additionalClaims - Additional claims to include
 * @returns {string|null} - Signed token or null if JWT not configured
 */
function generateSessionToken(userId, sessionId, additionalClaims = {}) {
    return signToken({
        userId,
        sessionId,
        type: 'session',
        ...additionalClaims
    });
}

module.exports = {
    JWT_CONFIG,
    JWT_ERROR_CODES,
    MIN_SECRET_LENGTH,
    getJwtSecret,
    isJwtEnabled,
    signToken,
    verifyToken,
    verifyTokenWithClaims,
    decodeToken,
    generateSessionToken
};
