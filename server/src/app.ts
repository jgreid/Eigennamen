import type { Request, Response, NextFunction, Application, Express } from 'express';
import type { Server as SocketServer } from 'socket.io';

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import path from 'path';

import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { apiLimiter, strictLimiter } from './middleware/rateLimit';
import { csrfProtection } from './middleware/csrf';
import { requestTiming } from './middleware/timing';
import routes from './routes';
import adminRoutes from './routes/adminRoutes';
import healthRoutes from './routes/healthRoutes';
import logger from './utils/logger';
import { setupSwagger } from './config/swagger';
import { getAllMetrics, setGauge, METRIC_NAMES } from './utils/metrics';
import { SOCKET } from './config/constants';

/**
 * Extended Express Application with custom properties
 */
interface ExtendedApp extends Application {
    updateSocketCount: (delta: number) => void;
}

/**
 * Socket count result
 */
interface SocketCountResult {
    count: number;
    cached: boolean;
    stale?: boolean;
}

/**
 * Rate limiter with metrics
 */
interface RateLimiterWithMetrics {
    getMetrics: () => Record<string, unknown>;
}

const app: ExtendedApp = express() as unknown as ExtendedApp;

// Trust proxy when behind reverse proxy (Fly.io, nginx, etc.)
// Required for accurate IP detection in rate limiting and logging
if (process.env.NODE_ENV === 'production' || process.env.TRUST_PROXY === 'true') {
    app.set('trust proxy', 1);
    logger.info('Trust proxy enabled for production deployment');
}

// Cached socket count for fast health checks
let cachedSocketCount = 0;
let lastSocketCountUpdate = 0;

/**
 * Get cached socket count (updated on connect/disconnect)
 * Falls back to io.fetchSockets() if cache is stale
 */
async function getCachedSocketCount(io: SocketServer, forceRefresh = false): Promise<SocketCountResult> {
    const now = Date.now();

    // Return cached value if fresh
    if (!forceRefresh && now - lastSocketCountUpdate < SOCKET.SOCKET_COUNT_CACHE_MS) {
        return { count: cachedSocketCount, cached: true };
    }

    // Refresh cache with timeout protection
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
        const socketCountPromise = io.fetchSockets().then((s: unknown[]) => s.length);
        const timeoutPromise = new Promise<never>((_, reject) => {
            timeoutId = setTimeout(() => reject(new Error('Socket count timeout')), SOCKET.SOCKET_COUNT_TIMEOUT_MS);
        });

        cachedSocketCount = await Promise.race([socketCountPromise, timeoutPromise]);
        lastSocketCountUpdate = now;
        setGauge(METRIC_NAMES.SOCKET_CONNECTIONS, cachedSocketCount);
        return { count: cachedSocketCount, cached: false };
    } catch {
        // Return stale cache on error
        return { count: cachedSocketCount, cached: true, stale: true };
    } finally {
        // Clear the timeout to prevent timer leak when socketCountPromise wins the race
        if (timeoutId !== undefined) {
            clearTimeout(timeoutId);
        }
    }
}

/**
 * Update socket count on connection change (called from socket/index.ts)
 */
function updateSocketCount(delta: number): void {
    cachedSocketCount = Math.max(0, cachedSocketCount + delta);
    lastSocketCountUpdate = Date.now();
    setGauge(METRIC_NAMES.SOCKET_CONNECTIONS, cachedSocketCount);
}

// Export for socket module to use
app.updateSocketCount = updateSocketCount;

// CORS configuration
const corsOrigin = process.env.CORS_ORIGIN || '*';
const isProduction = process.env.NODE_ENV === 'production';

// Block wildcard CORS in production - this is a security risk
if (isProduction && corsOrigin === '*') {
    logger.error('FATAL: CORS_ORIGIN cannot be wildcard (*) in production.');
    logger.error('Set CORS_ORIGIN to your domain(s), e.g., CORS_ORIGIN=https://yourdomain.com');
    process.exit(1);
}

// Security middleware with enhanced CSP
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],                    // All scripts loaded from external files
            styleSrc: ["'self'", "'unsafe-inline'"],  // Game uses inline styles
            imgSrc: ["'self'", 'data:', 'blob:'],
            connectSrc: ["'self'", 'wss:', 'ws:'],    // WebSocket connections
            fontSrc: ["'self'"],
            objectSrc: ["'none'"],
            mediaSrc: ["'self'"],
            frameSrc: ["'none'"],
            // Additional security directives
            baseUri: ["'self'"],                      // Prevent base tag hijacking
            formAction: ["'self'"],                   // Control form submissions
            frameAncestors: ["'none'"],               // Prevent clickjacking (defense in depth)
            workerSrc: ["'self'", 'blob:'],           // Service worker support
            manifestSrc: ["'self'"],                  // PWA manifest
            upgradeInsecureRequests: isProduction ? [] : null
        }
    },
    crossOriginEmbedderPolicy: false, // Required for some game assets
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
    // Additional security headers
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    dnsPrefetchControl: { allow: false },
    permittedCrossDomainPolicies: { permittedPolicies: 'none' },
    // HSTS: Enforce HTTPS in production (1 year, include subdomains)
    strictTransportSecurity: isProduction ? {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true
    } : false
}));

app.use(cors({
    origin: corsOrigin === '*' ? true : corsOrigin.split(',').map((s: string) => s.trim()),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-Requested-With']
}));

// Compression
app.use(compression());

// Request timing middleware
app.use(requestTiming);

// Body parsing with size limits to prevent memory exhaustion attacks
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Rate limiting for API routes
app.use('/api', apiLimiter);

// CSRF protection for state-changing API routes
app.use('/api', csrfProtection);

// API routes
app.use('/api', routes);

// CSRF protection for admin API routes (state-changing operations)
app.use('/admin/api', csrfProtection);

// Admin dashboard routes (protected by basic auth)
app.use('/admin', adminRoutes);

// Service workers must never be HTTP-cached so browser always checks for updates
app.get(['/sw.js', '/service-worker.js'], (_req: Request, res: Response, next: NextFunction) => {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    next();
});

// HTML files must not be long-cached so that cache-busted asset references
// (e.g. socket-client.js?v=6) take effect immediately after deploys.
// Without this, browsers serve stale HTML for up to 1 day, loading old JS
// versions that may have known bugs (like the io.protocol check in ?v=5).
app.get('{/*path}.html', (_req: Request, res: Response, next: NextFunction) => {
    res.set('Cache-Control', 'no-cache');
    next();
});
app.get('/', (_req: Request, res: Response, next: NextFunction) => {
    res.set('Cache-Control', 'no-cache');
    next();
});

// Serve static files (the game client) with caching headers
app.use(express.static(path.join(__dirname, '../public'), {
    maxAge: process.env.NODE_ENV === 'production' ? '1d' : 0,
    etag: true,
    lastModified: true
}));

// Health check routes (readiness, liveness, metrics)
// Mounted before static files so /health/* is handled by the router
app.use('/health', healthRoutes);

// OpenAPI/Swagger documentation (accessible at /api-docs)
setupSwagger(app as unknown as Express);

// Metrics response interface
interface MetricsResponse {
    timestamp: string;
    process: {
        uptime: number;
        memory?: NodeJS.MemoryUsage;
        cpu?: NodeJS.CpuUsage;
    };
    instance?: {
        flyAllocId?: string;
        flyRegion?: string;
    };
    socketio?: {
        status: string;
        connections?: number;
        cached?: boolean;
        note?: string;
        error?: string;
    };
    application?: Record<string, unknown> | { status: string; error: string };
    rateLimits?: {
        http?: Record<string, unknown>;
        socket: Record<string, unknown> | { status: string };
    };
}

// Metrics endpoint with rate limit visibility and application metrics
// Rate limited to prevent abuse (metrics can be expensive to compute)
app.get('/metrics', strictLimiter, async (_req: Request, res: Response) => {
    const metricsData: MetricsResponse = {
        timestamp: new Date().toISOString(),
        process: isProduction
            ? { uptime: process.uptime() }
            : { uptime: process.uptime(), memory: process.memoryUsage(), cpu: process.cpuUsage() }
    };

    // Add Fly.io instance info if available (region only in production; full details in dev)
    if (process.env.FLY_ALLOC_ID) {
        metricsData.instance = isProduction
            ? { flyRegion: process.env.FLY_REGION }
            : { flyAllocId: process.env.FLY_ALLOC_ID, flyRegion: process.env.FLY_REGION };
    }

    // Add socket.io stats with cached count
    try {
        const io = app.get('io') as SocketServer | undefined;
        if (io) {
            const { count, cached, stale } = await getCachedSocketCount(io);
            metricsData.socketio = {
                status: 'ok',
                connections: count,
                cached,
                ...(stale && { note: 'Count may be stale' })
            };
        }
    } catch (error) {
        logger.warn('Failed to fetch socket stats for metrics:', (error as Error).message);
        metricsData.socketio = {
            status: 'error',
            error: 'Failed to fetch socket stats'
        };
    }

    // Add application metrics (counters, gauges, histograms)
    try {
        const appMetrics = getAllMetrics();
        metricsData.application = appMetrics as unknown as Record<string, unknown>;
    } catch (error) {
        logger.warn('Failed to fetch application metrics:', (error as Error).message);
        metricsData.application = {
            status: 'error',
            error: 'Failed to fetch application metrics'
        };
    }

    // Add rate limit metrics
    try {
        const socketRateLimiter = app.get('socketRateLimiter') as RateLimiterWithMetrics | undefined;
        metricsData.rateLimits = {
            socket: socketRateLimiter ? socketRateLimiter.getMetrics() : { status: 'not initialized' }
        };
    } catch (error) {
        logger.warn('Failed to fetch rate limit metrics:', (error as Error).message);
        metricsData.rateLimits = { socket: {} };
    }

    res.json(metricsData);
});

// Serve the game for any non-API route (SPA support)
// no-cache ensures browsers always revalidate after deploys so cache-busted
// asset references (e.g. socket-client.js?v=7) take effect immediately.
const RESERVED_PATH_PREFIXES = ['/api', '/socket.io', '/health', '/metrics', '/api-docs', '/admin'];
app.get('/{*splat}', (req: Request, res: Response, next: NextFunction) => {
    if (RESERVED_PATH_PREFIXES.some(prefix => req.path.startsWith(prefix))) {
        return next();
    }
    res.set('Cache-Control', 'no-cache');
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

export default app;

// CommonJS compat
module.exports = app;
module.exports.default = app;
