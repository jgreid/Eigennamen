/**
 * Socket.io Authentication Middleware - Orchestrator
 *
 * Thin coordination layer that delegates to focused sub-modules:
 *   - auth/clientIP: IP extraction with proxy handling
 *   - auth/originValidator: CSRF origin validation
 *   - auth/sessionValidator: Session validation, rate limiting, reconnection
 *   - auth/jwtHandler: JWT token verification
 */

import type { Socket } from 'socket.io';

import { v4 as uuidv4 } from 'uuid';
import logger from '../utils/logger';
import * as playerService from '../services/playerService';
import { getClientIP } from './auth/clientIP';
import { validateOrigin } from './auth/originValidator';
import { resolveSessionId, validateSession } from './auth/sessionValidator';
import { handleJwtVerification } from './auth/jwtHandler';

import type { AuthSocket } from './auth/jwtHandler';

/**
 * Authenticate socket connection
 * Includes comprehensive session validation with security checks
 */
async function authenticateSocket(socket: Socket, next: (err?: Error) => void): Promise<void> {
    try {
        const authSocket = socket as AuthSocket;

        // Step 1: CSRF Protection - Validate origin header
        const originValidation = validateOrigin(socket);
        if (!originValidation.valid) {
            return next(new Error(originValidation.reason || 'Origin not allowed'));
        }

        // Step 2: Get client IP (handles proxies)
        const currentIP = getClientIP(socket);

        // Step 3: Resolve session ID from auth params
        const auth = socket.handshake.auth as { sessionId?: string; token?: string; reconnectToken?: string };
        const resolution = await resolveSessionId(auth, currentIP);

        // Use validated session ID or generate new one
        authSocket.sessionId = resolution.validatedSessionId || uuidv4();
        authSocket.clientIP = currentIP;

        // Flag IP mismatch on socket for monitoring
        if (resolution.ipMismatch) {
            authSocket.ipMismatch = true;
        }

        // Step 4: Handle JWT token verification with claims validation
        handleJwtVerification(authSocket, auth.token, resolution.validatedSessionId, resolution.sessionValidation, currentIP);

        // Step 5: Map socket ID to session ID for this connection (with IP tracking for security)
        await playerService.setSocketMapping(authSocket.sessionId, socket.id, currentIP);

        logger.debug('Socket authenticated', {
            socketId: socket.id,
            sessionId: authSocket.sessionId,
            hasUserId: !!authSocket.userId,
            clientIP: currentIP
        });
        next();

    } catch (error) {
        logger.error('Socket authentication error:', error);
        next(new Error('Authentication failed'));
    }
}

/**
 * Middleware to require authenticated user (JWT)
 */
function requireAuth(socket: Socket, next: (err?: Error) => void): void {
    const authSocket = socket as AuthSocket;
    if (!authSocket.userId) {
        return next(new Error('Authentication required'));
    }
    next();
}

export {
    authenticateSocket,
    requireAuth,
    getClientIP,
    validateSession,
    validateOrigin
};
