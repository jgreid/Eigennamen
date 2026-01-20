/**
 * Express Application Configuration
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const path = require('path');

const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const { apiLimiter } = require('./middleware/rateLimit');
const { csrfProtection } = require('./middleware/csrf');
const routes = require('./routes');
const logger = require('./utils/logger');

const app = express();

// CORS configuration
const corsOrigin = process.env.CORS_ORIGIN || '*';
const isProduction = process.env.NODE_ENV === 'production';

// Block wildcard CORS in production - this is a security risk
if (isProduction && corsOrigin === '*') {
    logger.error('FATAL: CORS_ORIGIN cannot be wildcard (*) in production.');
    logger.error('Set CORS_ORIGIN to your domain(s), e.g., CORS_ORIGIN=https://yourdomain.com');
    process.exit(1);
}

// Security middleware with CSP enabled
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'"], // Game uses inline scripts
            styleSrc: ["'self'", "'unsafe-inline'"],  // Game uses inline styles
            imgSrc: ["'self'", "data:", "blob:"],
            connectSrc: ["'self'", "wss:", "ws:"],    // WebSocket connections
            fontSrc: ["'self'"],
            objectSrc: ["'none'"],
            mediaSrc: ["'self'"],
            frameSrc: ["'none'"],
            upgradeInsecureRequests: isProduction ? [] : null
        }
    },
    crossOriginEmbedderPolicy: false, // Required for some game assets
    crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" }
}));

app.use(cors({
    origin: corsOrigin === '*' ? true : corsOrigin.split(',').map(s => s.trim()),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-Requested-With']
}));

// Compression
app.use(compression());

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiting for API routes
app.use('/api', apiLimiter);

// CSRF protection for state-changing API routes
app.use('/api', csrfProtection);

// API routes
app.use('/api', routes);

// Serve static files (the game client)
app.use(express.static(path.join(__dirname, '../public')));

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

    // Check Socket.io
    try {
        const io = app.get('io');
        if (io) {
            const sockets = await io.fetchSockets();
            checks.checks.socketio = {
                status: 'ok',
                connections: sockets.length
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

// Metrics endpoint (basic)
app.get('/metrics', async (req, res) => {
    const metrics = {
        timestamp: new Date().toISOString(),
        process: {
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            cpu: process.cpuUsage()
        }
    };

    // Add Fly.io instance info if available
    if (process.env.FLY_ALLOC_ID) {
        metrics.instance = {
            flyAllocId: process.env.FLY_ALLOC_ID,
            flyRegion: process.env.FLY_REGION
        };
    }

    // Add socket.io stats if available
    try {
        const io = app.get('io');
        if (io) {
            const sockets = await io.fetchSockets();
            metrics.socketio = {
                status: 'ok',
                connections: sockets.length
            };
        }
    } catch (error) {
        logger.warn('Failed to fetch socket stats for metrics:', error.message);
        metrics.socketio = {
            status: 'error',
            error: error.message
        };
    }

    res.json(metrics);
});

// Serve the game for any non-API route (SPA support)
app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/socket.io') || req.path.startsWith('/health') || req.path.startsWith('/metrics')) {
        return next();
    }
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
