/**
 * Express Application Configuration
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const path = require('path');

const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const { apiLimiter, strictLimiter, getHttpRateLimitMetrics } = require('./middleware/rateLimit');
const { csrfProtection } = require('./middleware/csrf');
const { requestTiming, startMemoryMonitoring } = require('./middleware/timing');
const routes = require('./routes');
const adminRoutes = require('./routes/adminRoutes');
const logger = require('./utils/logger');
const { setupSwagger } = require('./config/swagger');
const { getSocketRateLimitMetrics } = require('./socket/rateLimitHandler');
const { getAllMetrics, setSocketConnections } = require('./utils/metrics');
const { SOCKET } = require('./config/constants');

const app = express();

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
async function getCachedSocketCount(io, forceRefresh = false) {
    const now = Date.now();

    // Return cached value if fresh
    if (!forceRefresh && now - lastSocketCountUpdate < SOCKET.SOCKET_COUNT_CACHE_MS) {
        return { count: cachedSocketCount, cached: true };
    }

    // Refresh cache with timeout protection
    try {
        const socketCountPromise = io.fetchSockets().then(s => s.length);
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Socket count timeout')), SOCKET.SOCKET_COUNT_TIMEOUT_MS)
        );

        cachedSocketCount = await Promise.race([socketCountPromise, timeoutPromise]);
        lastSocketCountUpdate = now;
        setSocketConnections(cachedSocketCount);
        return { count: cachedSocketCount, cached: false };
    } catch (error) {
        // Return stale cache on error
        return { count: cachedSocketCount, cached: true, stale: true };
    }
}

/**
 * Update socket count on connection change (called from socket/index.js)
 */
function updateSocketCount(delta) {
    cachedSocketCount = Math.max(0, cachedSocketCount + delta);
    lastSocketCountUpdate = Date.now();
    setSocketConnections(cachedSocketCount);
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

// Security middleware with CSP enabled (Sprint 19: Enhanced CSP)
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'"], // Game uses inline scripts, all libs bundled locally
            scriptSrcAttr: ["'unsafe-inline'"],       // Game uses onclick handlers
            styleSrc: ["'self'", "'unsafe-inline'"],  // Game uses inline styles
            imgSrc: ["'self'", 'data:', 'blob:'],
            connectSrc: ["'self'", 'wss:', 'ws:'],    // WebSocket connections
            fontSrc: ["'self'"],
            objectSrc: ["'none'"],
            mediaSrc: ["'self'"],
            frameSrc: ["'none'"],
            // Sprint 19: Additional security directives
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
    // Sprint 19: Additional security headers
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
    origin: corsOrigin === '*' ? true : corsOrigin.split(',').map(s => s.trim()),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-Requested-With']
}));

// Compression
app.use(compression());

// Sprint 19: Request timing middleware
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

// Admin dashboard routes (protected by basic auth)
app.use('/admin', adminRoutes);

// Serve static files (the game client) with caching headers
app.use(express.static(path.join(__dirname, '../public'), {
    maxAge: process.env.NODE_ENV === 'production' ? '1d' : 0,
    etag: true,
    lastModified: true
}));

// Basic health check (fast, for load balancer keep-alive)
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// Detailed health check with all dependencies (Redis, Database, Socket.io)
// This is the endpoint Fly.io should use for readiness checks
app.get('/health/ready', async (req, res) => {
    const checks = {
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        checks: {}
    };

    // Add Fly.io instance info if available
    if (process.env.FLY_ALLOC_ID) {
        checks.instance = {
            flyAllocId: process.env.FLY_ALLOC_ID,
            flyRegion: process.env.FLY_REGION
        };
    }

    // Check Database (PostgreSQL via Prisma) - Optional
    try {
        const { isDatabaseEnabled } = require('./config/database');
        if (isDatabaseEnabled()) {
            const getDatabase = app.get('database');
            const prisma = getDatabase();
            // Simple query to verify database connectivity
            await prisma.$queryRaw`SELECT 1`;
            checks.checks.database = { status: 'ok' };
        } else {
            checks.checks.database = { status: 'disabled', note: 'Game works without database' };
        }
    } catch (error) {
        checks.checks.database = { status: 'error', message: error.message };
        // Database errors don't degrade overall status since it's optional
        logger.warn('Health check: Database error (non-critical)', error.message);
    }

    // Check Redis/Storage
    try {
        const { isRedisHealthy, isUsingMemoryMode } = require('./config/redis');
        const healthy = await isRedisHealthy();
        const memoryMode = isUsingMemoryMode();
        if (healthy) {
            checks.checks.storage = {
                status: 'ok',
                type: memoryMode ? 'memory' : 'redis',
                note: memoryMode ? 'Single-instance mode, data will not persist across restarts' : undefined
            };
        } else {
            checks.checks.storage = { status: 'error', message: 'Storage not connected' };
            checks.status = 'degraded';
        }
    } catch (error) {
        checks.checks.storage = { status: 'error', message: error.message };
        checks.status = 'degraded';
        logger.error('Health check: Storage error', error.message);
    }

    // Check Socket.io with cached count for fast response
    try {
        const io = app.get('io');
        if (io) {
            const { count, cached, stale } = await getCachedSocketCount(io);
            checks.checks.socketio = {
                status: 'ok',
                connections: count,
                cached,
                ...(stale && { note: 'Count may be stale' })
            };
        } else {
            checks.checks.socketio = { status: 'not_configured' };
        }
    } catch (error) {
        checks.checks.socketio = { status: 'error', message: error.message };
        checks.status = 'degraded';
    }

    const statusCode = checks.status === 'ok' ? 200 : 503;
    res.status(statusCode).json(checks);
});

// Liveness probe (Kubernetes/Fly.io) - just confirms process is running
app.get('/health/live', (req, res) => {
    res.status(200).json({ status: 'alive' });
});

// OpenAPI/Swagger documentation (accessible at /api-docs)
setupSwagger(app);

// Metrics endpoint with rate limit visibility and application metrics
// Rate limited to prevent abuse (metrics can be expensive to compute)
app.get('/metrics', strictLimiter, async (req, res) => {
    const metricsData = {
        timestamp: new Date().toISOString(),
        process: {
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            cpu: process.cpuUsage()
        }
    };

    // Add Fly.io instance info if available
    if (process.env.FLY_ALLOC_ID) {
        metricsData.instance = {
            flyAllocId: process.env.FLY_ALLOC_ID,
            flyRegion: process.env.FLY_REGION
        };
    }

    // Add socket.io stats with cached count
    try {
        const io = app.get('io');
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
        logger.warn('Failed to fetch socket stats for metrics:', error.message);
        metricsData.socketio = {
            status: 'error',
            error: error.message
        };
    }

    // Add rate limit metrics for production visibility
    try {
        metricsData.rateLimits = {
            http: getHttpRateLimitMetrics(),
            socket: getSocketRateLimitMetrics()
        };
    } catch (error) {
        logger.warn('Failed to fetch rate limit metrics:', error.message);
        metricsData.rateLimits = {
            status: 'error',
            error: error.message
        };
    }

    // Add application metrics (counters, gauges, histograms)
    try {
        const appMetrics = getAllMetrics();
        metricsData.application = appMetrics;
    } catch (error) {
        logger.warn('Failed to fetch application metrics:', error.message);
        metricsData.application = {
            status: 'error',
            error: error.message
        };
    }

    res.json(metricsData);
});

// Serve the game for any non-API route (SPA support)
const RESERVED_PATH_PREFIXES = ['/api', '/socket.io', '/health', '/metrics', '/api-docs', '/admin'];
app.get('*', (req, res, next) => {
    if (RESERVED_PATH_PREFIXES.some(prefix => req.path.startsWith(prefix))) {
        return next();
    }
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
