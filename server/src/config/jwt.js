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
    } catch {
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

/**
 * Verify and decode a JWT token
 * @param {string} token - Token to verify
 * @returns {object|null} - Decoded payload or null if invalid
 */
function verifyToken(token) {
    const secret = getJwtSecret();
    if (!secret) {
        return null;
    }

    try {
        return jwt.verify(token, secret, {
            algorithms: [JWT_CONFIG.algorithm],
            issuer: JWT_CONFIG.issuer,
            audience: JWT_CONFIG.audience
        });
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            logger.debug('JWT token expired');
        } else if (error.name === 'JsonWebTokenError') {
            logger.debug('Invalid JWT token:', error.message);
        } else {
            logger.warn('JWT verification error:', error.message);
        }
        return null;
    }
}

/**
 * Decode a token without verification (for debugging/logging)
 * @param {string} token - Token to decode
 * @returns {object|null} - Decoded payload or null if malformed
 */
function decodeToken(token) {
    try {
        return jwt.decode(token);
    } catch {
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
    MIN_SECRET_LENGTH,
    getJwtSecret,
    isJwtEnabled,
    signToken,
    verifyToken,
    decodeToken,
    generateSessionToken
};
