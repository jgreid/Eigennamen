/**
 * WebSocket Origin Validation
 *
 * CSRF protection for WebSocket connections by validating
 * the Origin header against allowed origins (CORS_ORIGIN).
 */

import type { Socket } from 'socket.io';

const logger = require('../../utils/logger');
const { audit } = require('../../services/auditService');
const { getClientIP } = require('./clientIP');

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

    // If no origin header (e.g., same-origin or non-browser client), allow in dev
    if (!origin) {
        if (isProduction) {
            // In production, missing origin is suspicious - log but allow for backwards compat
            logger.warn('WebSocket connection without origin header', {
                socketId: socket.id,
                clientIP: getClientIP(socket)
            });
        }
        return { valid: true };
    }

    // Parse allowed origins from CORS_ORIGIN
    const allowedOrigins = (corsOrigin || '').split(',').map((o: string) => o.trim().toLowerCase());

    // Check if origin is allowed
    const originLower = origin.toLowerCase();
    const isAllowed = allowedOrigins.some((allowed: string) => {
        if (allowed === '*') return true;
        // Exact match
        if (allowed === originLower) return true;
        // Support wildcard subdomains (e.g., *.example.com)
        if (allowed.startsWith('*.')) {
            const domain = allowed.slice(2);
            return originLower.endsWith(domain) &&
                   (originLower.length === domain.length ||
                    originLower[originLower.length - domain.length - 1] === '.');
        }
        return false;
    });

    if (!isAllowed) {
        logger.warn('WebSocket CSRF protection: origin not allowed', {
            origin,
            allowedOrigins,
            socketId: socket.id,
            clientIP: getClientIP(socket)
        });

        // Audit suspicious activity
        audit.suspicious(
            'WebSocket connection from unauthorized origin',
            (socket.handshake.auth as { sessionId?: string })?.sessionId || 'unknown',
            getClientIP(socket),
            { origin, allowedOrigins }
        );

        return {
            valid: false,
            reason: 'Origin not allowed'
        };
    }

    return { valid: true };
}

module.exports = { validateOrigin };

export { validateOrigin };
export type { OriginValidationResult };
