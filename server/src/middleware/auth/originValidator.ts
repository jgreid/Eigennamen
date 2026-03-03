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
    const corsOrigin = process.env.CORS_ORIGIN;
    const isProduction = process.env.NODE_ENV === 'production';

    // In development with wildcard CORS, allow all origins
    if (!isProduction && (!corsOrigin || corsOrigin === '*')) {
        return { valid: true };
    }

    // If no origin header (e.g., same-origin or non-browser client)
    if (!origin) {
        if (isProduction && corsOrigin && corsOrigin !== '*') {
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
                    { corsOrigin }
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

    // Parse allowed origins from CORS_ORIGIN
    const allowedOrigins = (corsOrigin || '').split(',').map((o: string) => o.trim().toLowerCase());

    // Parse origin hostname for robust comparison (handles ports, protocols)
    let originHostname: string;
    try {
        originHostname = new URL(origin).hostname.toLowerCase();
    } catch {
        return { valid: false, reason: 'Malformed origin URL' };
    }

    const isAllowed = allowedOrigins.some((allowed: string) => {
        if (allowed === '*') return true;
        // Parse allowed origin to extract hostname
        let allowedHostname: string;
        try {
            // Handle wildcard subdomains (e.g., *.example.com)
            if (allowed.startsWith('*.')) {
                const domain = allowed.slice(2);
                return originHostname === domain || originHostname.endsWith('.' + domain);
            }
            // Parse as URL if it contains ://, otherwise treat as hostname
            allowedHostname = allowed.includes('://') ? new URL(allowed).hostname.toLowerCase() : allowed;
        } catch {
            allowedHostname = allowed;
        }
        return allowedHostname === originHostname;
    });

    if (!isAllowed) {
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
