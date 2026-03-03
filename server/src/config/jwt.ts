import jwt from 'jsonwebtoken';
import logger from '../utils/logger';

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
    issuer: 'eigennamen',
    audience: 'game-client',
} as const;

// Minimum secret length for production
export const MIN_SECRET_LENGTH = 32;

// Maximum allowed token lifetime
const MAX_TOKEN_LIFETIME = '7d';
const ALLOWED_EXPIRY_PATTERN = /^(\d+)(s|m|h|d)$/;

/**
 * Get JWT secret with validation.
 *
 * SECURITY: Never returns a hardcoded fallback secret. If JWT_SECRET is not
 * explicitly configured, JWT authentication is disabled (returns null).
 *
 * @returns JWT secret or null if not configured
 * @throws In production if secret is configured but too short
 */
function getJwtSecret(): string | null {
    const secret = process.env.JWT_SECRET;
    const isProduction = process.env.NODE_ENV === 'production';

    if (!secret) {
        if (isProduction) {
            throw new Error('JWT_SECRET must be configured in production. Set the JWT_SECRET environment variable.');
        } else {
            logger.debug('JWT_SECRET not set - JWT authentication disabled in development');
        }
        return null;
    }

    // Reject .env.example placeholder values
    if (secret.startsWith('CHANGE-ME') || secret === 'your-secret-key-change-in-production') {
        if (isProduction) {
            throw new Error('JWT_SECRET contains a placeholder value. Set a real secret for production.');
        } else {
            logger.warn('JWT_SECRET contains a placeholder value — change it before deploying');
        }
    }

    if (isProduction && secret.length < MIN_SECRET_LENGTH) {
        throw new Error(`JWT_SECRET must be at least ${MIN_SECRET_LENGTH} characters in production`);
    }

    if (!isProduction && secret.length < MIN_SECRET_LENGTH) {
        logger.warn(`JWT_SECRET is shorter than ${MIN_SECRET_LENGTH} characters - this is insecure`);
    }

    return secret;
}

/**
 * Check if JWT authentication is available
 * @returns True if JWT is configured and usable
 */
function isJwtEnabled(): boolean {
    try {
        return getJwtSecret() !== null;
    } catch (e) {
        logger.debug('JWT not enabled:', e instanceof Error ? e.message : String(e));
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
 * Convert an expiry string to seconds
 */
function expiryToSeconds(value: string): number {
    const match = ALLOWED_EXPIRY_PATTERN.exec(value);
    if (!match) return 0;
    const num = parseInt(match[1]!, 10);
    const unit = match[2]!;
    switch (unit) {
        case 's':
            return num;
        case 'm':
            return num * 60;
        case 'h':
            return num * 3600;
        case 'd':
            return num * 86400;
        default:
            return 0;
    }
}

/**
 * Cap expiresIn to MAX_TOKEN_LIFETIME to prevent unbounded token lifetimes
 */
function capExpiresIn(value: string): string {
    const maxSeconds = expiryToSeconds(MAX_TOKEN_LIFETIME);
    const requestedSeconds = expiryToSeconds(value);
    if (requestedSeconds <= 0 || requestedSeconds > maxSeconds) {
        logger.warn(`JWT expiresIn '${value}' exceeds maximum, capping to '${MAX_TOKEN_LIFETIME}'`);
        return MAX_TOKEN_LIFETIME;
    }
    return value;
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

    const expiresIn = capExpiresIn(options.expiresIn || JWT_CONFIG.expiresIn);

    const signOptions = {
        ...options,
        // Security-critical fields placed AFTER spread to prevent caller override
        algorithm: JWT_CONFIG.algorithm,
        issuer: JWT_CONFIG.issuer,
        audience: JWT_CONFIG.audience,
        expiresIn,
    };

    return jwt.sign(payload, secret, signOptions as jwt.SignOptions);
}

// JWT error codes for structured error handling
export const JWT_ERROR_CODES = {
    TOKEN_EXPIRED: 'TOKEN_EXPIRED',
    TOKEN_INVALID: 'TOKEN_INVALID',
    TOKEN_MALFORMED: 'TOKEN_MALFORMED',
    TOKEN_NOT_ACTIVE: 'TOKEN_NOT_ACTIVE',
    CLAIMS_MISMATCH: 'CLAIMS_MISMATCH',
    JWT_NOT_CONFIGURED: 'JWT_NOT_CONFIGURED',
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
            audience: JWT_CONFIG.audience,
        }) as JwtPayload;
    } catch (error) {
        let errorCode: string;
        let errorMessage: string;
        // jwt library throws typed errors with name, expiredAt, date properties
        const err: Error & { expiredAt?: Date; date?: Date } =
            error instanceof Error ? error : new Error(String(error));

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
                actual: decoded[key],
            });
            return {
                valid: false,
                error: JWT_ERROR_CODES.CLAIMS_MISMATCH,
                message: `Claim '${key}' does not match expected value`,
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
function generateSessionToken(
    userId: string,
    sessionId: string,
    additionalClaims: Record<string, unknown> = {}
): string | null {
    return signToken({
        ...additionalClaims,
        // Security-critical fields AFTER spread to prevent caller override
        userId,
        sessionId,
        type: 'session',
    });
}

export { getJwtSecret, isJwtEnabled, signToken, verifyToken, verifyTokenWithClaims, decodeToken, generateSessionToken };
