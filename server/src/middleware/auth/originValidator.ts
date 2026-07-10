/**
 * WebSocket Origin Validation
 *
 * CSRF protection for WebSocket connections by validating
 * the Origin header against allowed origins (CORS_ORIGIN).
 */

import type { Socket } from 'socket.io';

import logger from '../../utils/logger';
import { audit } from '../../services/auditService';
import { getClientIP } from './clientIP';
import { isProduction, parseCorsOrigins } from '../../config/env';
import { isOriginAllowed } from '../csrf';

/**
 * Origin validation result
 */
interface OriginValidationResult {
    valid: boolean;
    reason?: string;
}

/**
 * Validate WebSocket connection origin for CSRF protection
 */
function validateOrigin(socket: Socket): OriginValidationResult {
    const origin = socket.handshake.headers.origin;
    const corsOrigins = parseCorsOrigins();

    // In development with wildcard CORS, allow all origins
    if (!isProduction() && corsOrigins === true) {
        return { valid: true };
    }

    // If no origin header (e.g., same-origin or non-browser client)
    if (!origin) {
        if (isProduction() && corsOrigins !== true) {
            // In production with explicit CORS origins, reject connections without Origin header.
            // Missing Origin is the primary WebSocket CSRF vector.
            logger.warn('WebSocket connection rejected: missing origin header in production', {
                socketId: socket.id,
                clientIP: getClientIP(socket),
            });

            audit
                .suspicious(
                    'WebSocket connection without origin header in production',
                    (socket.handshake.auth as { sessionId?: string })?.sessionId || 'unknown',
                    getClientIP(socket),
                    { corsOrigins }
                )
                .catch((err: Error) => {
                    logger.debug('Failed to audit origin violation:', err.message);
                });

            return {
                valid: false,
                reason: 'Origin header required in production',
            };
        }
        return { valid: true };
    }

    // Reject a malformed origin outright — it can't be matched safely.
    try {
        new URL(origin);
    } catch {
        return { valid: false, reason: 'Malformed origin URL' };
    }

    // Reuse the HTTP CSRF layer's exact-origin predicate (`isOriginAllowed`) so
    // the two CSRF surfaces share ONE matcher: it compares the FULL origin
    // (scheme + host + port), not just the hostname the old WS check used. A
    // handshake whose Origin is http://app.example.com or https://app.example.com:8443
    // no longer passes when only https://app.example.com is allowed — matching
    // what the HTTP path already enforces. `true` (wildcard CORS) maps to the
    // predicate's null = allow-all. (N34)
    const allowed = corsOrigins === true ? null : corsOrigins;
    const allowedOrigins = corsOrigins === true ? ['*'] : corsOrigins; // for logs/audit only
    if (!isOriginAllowed(origin, allowed)) {
        logger.warn('WebSocket CSRF protection: origin not allowed', {
            origin,
            allowedOrigins,
            socketId: socket.id,
            clientIP: getClientIP(socket),
        });

        // Audit suspicious activity
        audit
            .suspicious(
                'WebSocket connection from unauthorized origin',
                (socket.handshake.auth as { sessionId?: string })?.sessionId || 'unknown',
                getClientIP(socket),
                { origin, allowedOrigins }
            )
            .catch((err: Error) => {
                logger.debug('Failed to audit origin violation:', err.message);
            });

        return {
            valid: false,
            reason: 'Origin not allowed',
        };
    }

    return { valid: true };
}

export { validateOrigin };
export type { OriginValidationResult };
