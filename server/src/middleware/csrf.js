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

const logger = require('../utils/logger');

/**
 * Validate that the request appears to come from a same-origin source
 * Uses multiple signals: Origin header, Referer header, and custom header
 */
function csrfProtection(req, res, next) {
    // Skip for safe methods (GET, HEAD, OPTIONS)
    const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
    if (safeMethods.includes(req.method)) {
        return next();
    }

    // Check for custom header - requires JavaScript to set
    // Browsers won't send this header in cross-origin requests without CORS preflight
    const customHeader = req.headers['x-requested-with'];
    if (customHeader === 'XMLHttpRequest' || customHeader === 'fetch') {
        return next();
    }

    // Check Origin header
    const origin = req.headers['origin'];
    if (origin) {
        const allowedOrigins = getAllowedOrigins();
        if (isOriginAllowed(origin, allowedOrigins)) {
            return next();
        }
        logger.warn(`CSRF protection: blocked request from origin ${origin}`);
        return res.status(403).json({
            error: {
                code: 'CSRF_VALIDATION_FAILED',
                message: 'Cross-origin request blocked'
            }
        });
    }

    // Check Referer header as fallback
    const referer = req.headers['referer'];
    if (referer) {
        try {
            const refererUrl = new URL(referer);
            const allowedOrigins = getAllowedOrigins();
            if (isOriginAllowed(refererUrl.origin, allowedOrigins)) {
                return next();
            }
        } catch (e) {
            // Invalid referer URL
        }
        logger.warn(`CSRF protection: blocked request with referer ${referer}`);
        return res.status(403).json({
            error: {
                code: 'CSRF_VALIDATION_FAILED',
                message: 'Cross-origin request blocked'
            }
        });
    }

    // No Origin or Referer header - might be a direct API call
    // Allow if Content-Type is application/json (browsers don't send this cross-origin without CORS)
    const contentType = req.headers['content-type'];
    if (contentType && contentType.includes('application/json')) {
        return next();
    }

    // Block the request
    logger.warn(`CSRF protection: blocked request without origin/referer/json content-type`);
    return res.status(403).json({
        error: {
            code: 'CSRF_VALIDATION_FAILED',
            message: 'Request validation failed'
        }
    });
}

/**
 * Get list of allowed origins from configuration
 */
function getAllowedOrigins() {
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
function isOriginAllowed(origin, allowedOrigins) {
    // If no restrictions (CORS_ORIGIN=*), allow all
    if (allowedOrigins === null) {
        return true;
    }

    return allowedOrigins.some(allowed => {
        if (allowed === origin) {
            return true;
        }
        // Support wildcard subdomains like *.example.com
        if (allowed.startsWith('*.')) {
            const domain = allowed.slice(2);
            try {
                const originUrl = new URL(origin);
                return originUrl.hostname.endsWith(domain);
            } catch (e) {
                return false;
            }
        }
        return false;
    });
}

module.exports = {
    csrfProtection
};
