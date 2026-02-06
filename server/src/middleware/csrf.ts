/**
 * CSRF Protection Middleware
 *
 * Provides lightweight CSRF protection for state-changing REST endpoints
 * using same-origin validation and custom header requirements.
 *
 * Since the app primarily uses WebSocket for real-time operations and
 * doesn't have session-based auth yet, this provides a reasonable
 * level of protection without requiring full CSRF token management.
 */

import type { Request, Response, NextFunction } from 'express';

/* eslint-disable @typescript-eslint/no-var-requires */
const logger = require('../utils/logger');
/* eslint-enable @typescript-eslint/no-var-requires */

/**
 * Validate that the request appears to come from a same-origin source
 * Uses multiple signals: Origin header, Referer header, and custom header
 *
 * SECURITY: Always requires X-Requested-With header for state-changing requests
 * This prevents CSRF because browsers won't send custom headers cross-origin
 * without a preflight that our CORS policy would block.
 */
function csrfProtection(req: Request, res: Response, next: NextFunction): Response | void {
    // Skip for safe methods (GET, HEAD, OPTIONS)
    const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
    if (safeMethods.includes(req.method)) {
        return next();
    }

    // ALWAYS require custom header for state-changing requests
    // This is the primary CSRF defense - browsers cannot send custom headers
    // cross-origin without a CORS preflight, which would be blocked
    const customHeader = req.headers['x-requested-with'];
    if (customHeader !== 'XMLHttpRequest' && customHeader !== 'fetch') {
        logger.warn(`CSRF protection: blocked request without X-Requested-With header`);
        return res.status(403).json({
            error: {
                code: 'CSRF_VALIDATION_FAILED',
                message: 'Missing required X-Requested-With header'
            }
        });
    }

    // Additionally validate Origin/Referer when CORS is restricted
    const allowedOrigins = getAllowedOrigins();
    if (allowedOrigins !== null) {
        const origin = req.headers['origin'];
        const referer = req.headers['referer'];

        // Check Origin header
        if (origin) {
            if (!isOriginAllowed(origin, allowedOrigins)) {
                logger.warn(`CSRF protection: blocked request from origin ${origin}`);
                return res.status(403).json({
                    error: {
                        code: 'CSRF_VALIDATION_FAILED',
                        message: 'Cross-origin request blocked'
                    }
                });
            }
            return next();
        }

        // Check Referer header as fallback
        if (referer) {
            try {
                const refererUrl = new URL(referer);
                if (!isOriginAllowed(refererUrl.origin, allowedOrigins)) {
                    logger.warn(`CSRF protection: blocked request with referer ${referer}`);
                    return res.status(403).json({
                        error: {
                            code: 'CSRF_VALIDATION_FAILED',
                            message: 'Cross-origin request blocked'
                        }
                    });
                }
            } catch {
                logger.warn(`CSRF protection: blocked request with invalid referer ${referer}`);
                return res.status(403).json({
                    error: {
                        code: 'CSRF_VALIDATION_FAILED',
                        message: 'Invalid referer header'
                    }
                });
            }
            return next();
        }

        // Neither Origin nor Referer present with restricted CORS — reject
        logger.warn('CSRF protection: blocked request without Origin or Referer header');
        return res.status(403).json({
            error: {
                code: 'CSRF_VALIDATION_FAILED',
                message: 'Origin or Referer header required'
            }
        });
    }

    // Custom header present (and origin validated if CORS restricted) - allow
    return next();
}

/**
 * Get list of allowed origins from configuration
 */
function getAllowedOrigins(): string[] | null {
    const corsOrigin = process.env.CORS_ORIGIN || '*';

    if (corsOrigin === '*') {
        // If CORS allows all origins, we can't enforce origin checking
        // Return null to indicate "allow all"
        return null;
    }

    // Parse comma-separated origins
    return corsOrigin.split(',').map(o => o.trim());
}

/**
 * Check if an origin is in the allowed list
 */
function isOriginAllowed(origin: string, allowedOrigins: string[] | null): boolean {
    // If no restrictions (CORS_ORIGIN=*), allow all
    if (allowedOrigins === null) {
        return true;
    }

    return allowedOrigins.some(allowed => {
        if (allowed === origin) {
            return true;
        }
        // Support wildcard subdomains like *.example.com
        // Security fix: Ensure we match actual subdomains, not domains ending with the pattern
        // e.g., *.example.com should match sub.example.com but NOT attacker-example.com
        if (allowed.startsWith('*.')) {
            const domain = allowed.slice(2);
            try {
                const originUrl = new URL(origin);
                const hostname = originUrl.hostname;
                // Match either exact domain or proper subdomain (with dot prefix)
                return hostname === domain || hostname.endsWith('.' + domain);
            } catch {
                return false;
            }
        }
        return false;
    });
}

module.exports = {
    csrfProtection
};

export { csrfProtection };
