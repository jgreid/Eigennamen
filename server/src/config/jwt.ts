/**
 * JWT Security Configuration
 *
 * Provides secure JWT configuration with production requirements.
 */

/* eslint-disable @typescript-eslint/no-var-requires */
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');
/* eslint-enable @typescript-eslint/no-var-requires */

/**
 * JWT payload structure
 */
export interface JwtPayload {
    userId?: string;
    sessionId?: string;
    type?: string;
    iat?: number;
    exp?: number;
    iss?: string;
    aud?: string;
    [key: string]: unknown;
}

/**
 * Token verification result with error
 */
export interface TokenVerificationError {
    error: string;
    message: string;
}

/**
 * Token verification result with claims
 */
export interface TokenVerificationResult {
    valid: boolean;
    decoded?: JwtPayload;
    error?: string;
    message?: string;
}

// JWT configuration constants
export const JWT_CONFIG = {
    algorithm: 'HS256',
    expiresIn: '24h',
    issuer: 'die-eigennamen',
    audience: 'game-client'
} as const;

// Minimum secret length for production
export const MIN_SECRET_LENGTH = 32;

// Development-only fallback secret (never use in production)
const DEV_SECRET = 'development-secret-do-not-use-in-production';

/**
 * Get JWT secret with validation
 * @returns JWT secret or null if not configured
 * @throws In production if secret is missing or too short
 */
function getJwtSecret(): string | null {
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
        if (secret === DEV_SECRET) {
            throw new Error('JWT_SECRET must not be the development fallback secret in production');
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
 * @returns True if JWT is configured and usable
 */
function isJwtEnabled(): boolean {
    try {
        return getJwtSecret() !== null;
    } catch (e) {
        // FIX M14: Log error instead of silently returning false
        logger.debug('JWT not enabled:', (e as Error).message);
        return false;
    }
}

/**
 * Sign options for JWT
 */
interface SignOptions {
    expiresIn?: string;
    algorithm?: string;
    issuer?: string;
    audience?: string;
}

/**
 * Sign a JWT token with proper configuration
 * @param payload - Token payload
 * @param options - Additional options to merge with defaults
 * @returns Signed token or null if JWT not configured
 */
function signToken(payload: JwtPayload, options: SignOptions = {}): string | null {
    const secret = getJwtSecret();
    if (!secret) {
        return null;
    }

    const expiresIn = options.expiresIn || JWT_CONFIG.expiresIn;

    const signOptions = {
        algorithm: JWT_CONFIG.algorithm,
        issuer: JWT_CONFIG.issuer,
        audience: JWT_CONFIG.audience,
        ...options,
        expiresIn
    };

    return jwt.sign(payload, secret, signOptions);
}

// JWT error codes for structured error handling
export const JWT_ERROR_CODES = {
    TOKEN_EXPIRED: 'TOKEN_EXPIRED',
    TOKEN_INVALID: 'TOKEN_INVALID',
    TOKEN_MALFORMED: 'TOKEN_MALFORMED',
    TOKEN_NOT_ACTIVE: 'TOKEN_NOT_ACTIVE',
    CLAIMS_MISMATCH: 'CLAIMS_MISMATCH',
    JWT_NOT_CONFIGURED: 'JWT_NOT_CONFIGURED'
} as const;

/**
 * Verify options for JWT
 */
interface VerifyOptions {
    returnError?: boolean;
}

/**
 * Verify and decode a JWT token with detailed error information
 * @param token - Token to verify
 * @param options - Optional verification options
 * @returns Decoded payload, or error object if returnError is true, or null if invalid
 */
function verifyToken(token: string, options: VerifyOptions = {}): JwtPayload | TokenVerificationError | null {
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
        }) as JwtPayload;
    } catch (error) {
        let errorCode: string;
        let errorMessage: string;
        const err = error as Error & { name: string; expiredAt?: Date; date?: Date };

        if (err.name === 'TokenExpiredError') {
            errorCode = JWT_ERROR_CODES.TOKEN_EXPIRED;
            errorMessage = `Token expired at ${err.expiredAt}`;
            logger.debug('JWT token expired', { expiredAt: err.expiredAt });
        } else if (err.name === 'NotBeforeError') {
            errorCode = JWT_ERROR_CODES.TOKEN_NOT_ACTIVE;
            errorMessage = `Token not active until ${err.date}`;
            logger.debug('JWT token not yet active', { notBefore: err.date });
        } else if (err.name === 'JsonWebTokenError') {
            // Distinguish between malformed and other JWT errors
            if (err.message.includes('malformed') || err.message.includes('invalid')) {
                errorCode = JWT_ERROR_CODES.TOKEN_MALFORMED;
            } else {
                errorCode = JWT_ERROR_CODES.TOKEN_INVALID;
            }
            errorMessage = err.message;
            logger.debug('Invalid JWT token:', err.message);
        } else {
            errorCode = JWT_ERROR_CODES.TOKEN_INVALID;
            errorMessage = err.message;
            logger.warn('JWT verification error:', err.message);
        }

        if (options.returnError) {
            return { error: errorCode, message: errorMessage };
        }
        return null;
    }
}

/**
 * Verify token and validate that claims match expected values
 * @param token - Token to verify
 * @param expectedClaims - Claims to validate (e.g., { userId, sessionId })
 */
function verifyTokenWithClaims(token: string, expectedClaims: Record<string, unknown> = {}): TokenVerificationResult {
    const result = verifyToken(token, { returnError: true });

    // Check if verification failed
    if (result && 'error' in result) {
        return { valid: false, error: result.error as string, message: result.message as string };
    }

    // Check if token decoded successfully
    if (!result) {
        return { valid: false, error: JWT_ERROR_CODES.TOKEN_INVALID, message: 'Token verification failed' };
    }

    const decoded = result as JwtPayload;

    // Validate expected claims
    for (const [key, expectedValue] of Object.entries(expectedClaims)) {
        if (expectedValue !== undefined && decoded[key] !== expectedValue) {
            logger.debug('JWT claims mismatch', {
                claim: key,
                expected: expectedValue,
                actual: decoded[key]
            });
            return {
                valid: false,
                error: JWT_ERROR_CODES.CLAIMS_MISMATCH,
                message: `Claim '${key}' does not match expected value`
            };
        }
    }

    return { valid: true, decoded };
}

/**
 * Decode a token without verification (for debugging/logging)
 * @param token - Token to decode
 * @returns Decoded payload or null if malformed
 */
function decodeToken(token: string): JwtPayload | null {
    try {
        return jwt.decode(token) as JwtPayload | null;
    } catch (e) {
        // FIX M14: Log error instead of silently returning null
        logger.debug('Failed to decode token:', (e as Error).message);
        return null;
    }
}

/**
 * Generate a new session token for a user
 * @param userId - User ID
 * @param sessionId - Session ID
 * @param additionalClaims - Additional claims to include
 * @returns Signed token or null if JWT not configured
 */
function generateSessionToken(userId: string, sessionId: string, additionalClaims: Record<string, unknown> = {}): string | null {
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

export {
    getJwtSecret,
    isJwtEnabled,
    signToken,
    verifyToken,
    verifyTokenWithClaims,
    decodeToken,
    generateSessionToken
};
