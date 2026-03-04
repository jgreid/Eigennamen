/**
 * JWT Token Handler
 *
 * Handles JWT verification for WebSocket connections,
 * including claims validation and error classification
 * (expired, claims mismatch, etc.).
 */

import type { Socket } from 'socket.io';

import logger from '../../utils/logger';
import { verifyTokenWithClaims, isJwtEnabled, JWT_ERROR_CODES } from '../../config/jwt';
import type { TokenVerificationResult, JwtPayload } from '../../config/jwt';

import type { SessionValidationResult } from './sessionValidator';

/**
 * Extended socket with custom properties
 */
interface AuthSocket extends Socket {
    sessionId: string;
    clientIP: string;
    userId?: string;
    user?: JwtPayload;
    jwtVerified?: boolean;
    jwtExpired?: boolean;
    ipMismatch?: boolean;
}

/**
 * Handle JWT token verification with claims validation.
 * Sets userId, user, jwtVerified, and jwtExpired on the auth socket as appropriate.
 */
function handleJwtVerification(
    authSocket: AuthSocket,
    token: string | undefined,
    validatedSessionId: string | null,
    sessionValidation: SessionValidationResult | null,
    currentIP: string
): void {
    if (!token || !isJwtEnabled()) {
        return;
    }

    // Build expected claims for validation
    const expectedClaims: Record<string, unknown> = {
        // Validate token type to prevent token confusion attacks
        type: 'session',
    };
    // Validate the JWT's sessionId matches the socket's session.
    // This prevents a stolen token from one session being used with another.
    if (validatedSessionId) {
        expectedClaims.sessionId = validatedSessionId;
    } else if (authSocket.sessionId) {
        expectedClaims.sessionId = authSocket.sessionId;
    }
    if (sessionValidation?.player?.userId) {
        expectedClaims.userId = sessionValidation.player.userId;
    }

    const tokenResult: TokenVerificationResult = verifyTokenWithClaims(token, expectedClaims);

    if (tokenResult.valid && tokenResult.decoded) {
        authSocket.userId = tokenResult.decoded.userId;
        authSocket.user = tokenResult.decoded;
        authSocket.jwtVerified = true;
        logger.debug('JWT token verified for socket', {
            socketId: authSocket.id,
            userId: tokenResult.decoded.userId,
            sessionId: tokenResult.decoded.sessionId,
        });
        return;
    }

    // Log detailed error information for debugging
    logger.debug('JWT token validation failed for socket', {
        socketId: authSocket.id,
        errorCode: tokenResult.error,
        errorMessage: tokenResult.message,
    });

    // Handle specific error cases
    if (tokenResult.error === JWT_ERROR_CODES.TOKEN_EXPIRED) {
        authSocket.jwtExpired = true;
    } else if (tokenResult.error === JWT_ERROR_CODES.CLAIMS_MISMATCH) {
        // Potential session/token mismatch - log for security monitoring
        logger.warn('JWT claims mismatch detected', {
            socketId: authSocket.id,
            clientIP: currentIP,
            sessionId: authSocket.sessionId,
        });
    }
}

export { handleJwtVerification };
export type { AuthSocket, JwtPayload };
