import type { Request, Response, NextFunction, Router as ExpressRouter } from 'express';
import type { AdminRequest } from '../types/admin';

import express from 'express';
import path from 'path';
import crypto, { scrypt } from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(scrypt) as (
    password: crypto.BinaryLike,
    salt: crypto.BinaryLike,
    keylen: number
) => Promise<Buffer>;
import rateLimit from 'express-rate-limit';
import logger from '../utils/logger';
import { API_RATE_LIMITS } from '../config/constants';
import { audit } from '../services/auditService';

import statsRouter from './admin/statsRoutes';
import roomRouter from './admin/roomRoutes';
import auditRouter from './admin/auditRoutes';

const router: ExpressRouter = express.Router();

// Derive salt from JWT_SECRET if available, otherwise use a static fallback.
// This ensures identical passwords across deployments produce different hashes.
function getAdminScryptSalt(): string {
    return process.env.JWT_SECRET
        ? `eigennamen-admin-${crypto.createHash('sha256').update(process.env.JWT_SECRET).digest('hex').slice(0, 16)}`
        : 'eigennamen-admin-auth';
}

// Lazy-initialized admin hash — computed on first auth request instead of
// at module load time. This avoids blocking the event loop with synchronous
// scrypt during server startup and allows env vars set after import to take effect.
let cachedAdminHash: Buffer | null = null;
let cachedAdminHashComputed = false;

function getAdminHash(): Buffer | null {
    if (!cachedAdminHashComputed) {
        cachedAdminHashComputed = true;
        const adminPassword = process.env.ADMIN_PASSWORD;
        if (adminPassword) {
            cachedAdminHash = crypto.scryptSync(adminPassword, getAdminScryptSalt(), 32);
        }
    }
    return cachedAdminHash;
}

/**
 * Basic Authentication Middleware
 * Requires ADMIN_PASSWORD environment variable to be set
 * Uses async scrypt to avoid blocking the event loop during password hashing
 */
async function basicAuth(req: AdminRequest, res: Response, next: NextFunction): Promise<Response | void> {
    const adminPassword = process.env.ADMIN_PASSWORD;

    // If no admin password is configured, deny all access
    if (!adminPassword) {
        logger.warn('Admin access attempted but ADMIN_PASSWORD not configured');
        return res.status(401).json({
            error: {
                code: 'ADMIN_NOT_CONFIGURED',
                message: 'Admin access is not configured on this server',
            },
        });
    }

    // Check for Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Basic ')) {
        res.setHeader('WWW-Authenticate', 'Basic realm="Admin Dashboard"');
        return res.status(401).json({
            error: {
                code: 'AUTH_REQUIRED',
                message: 'Authentication required',
            },
        });
    }

    // Decode and verify credentials
    try {
        const base64Credentials = authHeader.split(' ')[1];
        if (base64Credentials) {
            const credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8');
            // Split on first colon only — RFC 7617 allows colons in passwords
            const colonIndex = credentials.indexOf(':');
            const username = colonIndex >= 0 ? credentials.substring(0, colonIndex) : credentials;
            const password = colonIndex >= 0 ? credentials.substring(colonIndex + 1) : '';

            // Use async scrypt KDF to avoid blocking the event loop
            const salt = getAdminScryptSalt();
            const passwordHash = await scryptAsync(password, salt, 32);
            const adminHash = getAdminHash() ?? (await scryptAsync(adminPassword, salt, 32));
            if (crypto.timingSafeEqual(passwordHash, adminHash)) {
                req.adminUsername = username || 'admin';
                // Audit successful login
                Promise.resolve(audit.adminLogin(req.ip ?? '', true)).catch((err: Error) =>
                    logger.warn('Audit log failed', { error: err.message })
                );
                return next();
            }
        }
    } catch (error) {
        logger.warn('Failed to decode admin credentials', {
            error: error instanceof Error ? error.message : String(error),
        });
    }

    // Audit failed login
    Promise.resolve(audit.adminLogin(req.ip ?? '', false)).catch((err: Error) =>
        logger.warn('Audit log failed', { error: err.message })
    );

    res.setHeader('WWW-Authenticate', 'Basic realm="Admin Dashboard"');
    return res.status(401).json({
        error: {
            code: 'AUTH_INVALID',
            message: 'Invalid credentials',
        },
    });
}

// Rate limiter for admin routes to prevent brute force and abuse
const adminLimiter = rateLimit({
    windowMs: API_RATE_LIMITS.ADMIN.window,
    max: API_RATE_LIMITS.ADMIN.max,
    standardHeaders: true,
    legacyHeaders: false,
    // Skip rate limiting in test environment
    skip: () => process.env.NODE_ENV === 'test',
    handler: (_req: Request, res: Response) => {
        logger.warn('Admin rate limit exceeded', { ip: _req.ip });
        res.status(429).json({
            error: {
                code: 'RATE_LIMITED',
                message: 'Too many requests, please try again later',
            },
        });
    },
});

// Apply rate limiting first, then basic auth to all admin routes
router.use(adminLimiter);
router.use(basicAuth);

/**
 * GET /admin - Serve the admin dashboard HTML page
 */
router.get('/', (_req: Request, res: Response) => {
    const adminHtmlPath = path.join(__dirname, '../../public/admin.html');
    res.sendFile(adminHtmlPath, (err: Error | null) => {
        if (err) {
            logger.error('Failed to serve admin.html', { error: err.message });
            res.status(500).json({
                error: {
                    code: 'ADMIN_PAGE_ERROR',
                    message: 'Failed to load admin dashboard',
                },
            });
        }
    });
});

// Mount sub-routers
router.use(statsRouter);
router.use(roomRouter);
router.use(auditRouter);

export { basicAuth };
export default router;

// CommonJS compat
module.exports = router;
module.exports.default = router;
module.exports.basicAuth = basicAuth;
