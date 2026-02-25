import type { Request, Response, NextFunction } from 'express';

import logger from '../utils/logger';
import { audit } from '../services/auditService';

/**
 * Log a CSRF violation to the audit service (fire-and-forget)
 */
function auditCsrfViolation(req: Request, reason: string): void {
    const clientIP = req.ip || req.socket?.remoteAddress || 'unknown';
    audit.suspicious(
        `CSRF violation: ${reason}`,
        'anonymous',
        clientIP,
        {
            method: req.method,
            path: req.path,
            origin: req.headers['origin'] || null,
            referer: req.headers['referer'] || null
        }
    ).catch((err: Error) => {
        logger.debug('Failed to audit CSRF violation:', err.message);
    });
}

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
        auditCsrfViolation(req, 'missing X-Requested-With header');
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
                auditCsrfViolation(req, `disallowed origin: ${origin}`);
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
                    auditCsrfViolation(req, `disallowed referer origin: ${refererUrl.origin}`);
                    return res.status(403).json({
                        error: {
                            code: 'CSRF_VALIDATION_FAILED',
                            message: 'Cross-origin request blocked'
                        }
                    });
                }
            } catch {
                logger.warn(`CSRF protection: blocked request with invalid referer ${referer}`);
                auditCsrfViolation(req, 'invalid referer header');
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
        auditCsrfViolation(req, 'missing Origin and Referer headers');
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
    const corsOrigin = process.env.CORS_ORIGIN;

    if (!corsOrigin || corsOrigin === '*') {
        // CORS not configured or wildcard — rely on X-Requested-With header only.
        if (process.env.NODE_ENV === 'production' && (!corsOrigin || corsOrigin === '*')) {
            logger.warn('CSRF: CORS_ORIGIN not configured or set to wildcard — origin validation disabled. Set CORS_ORIGIN to your domain.');
        }
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

export { csrfProtection };
