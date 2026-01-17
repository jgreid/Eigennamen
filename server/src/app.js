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

// Security middleware
app.use(helmet());
app.use(cors({
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true
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
app.use(express.static(path.join(__dirname, '../../public')));

// Basic health check
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// Detailed health check with dependencies
app.get('/health/ready', async (req, res) => {
    const checks = {
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        checks: {}
    };

    // Check Redis
    try {
        const getRedis = app.get('redis');
        if (getRedis) {
            const redis = getRedis();
            await redis.ping();
            checks.checks.redis = { status: 'ok' };
        } else {
            checks.checks.redis = { status: 'not_configured' };
        }
    } catch (error) {
        checks.checks.redis = { status: 'error', message: error.message };
        checks.status = 'degraded';
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

// Liveness probe (Kubernetes)
app.get('/health/live', (req, res) => {
    res.status(200).json({ status: 'alive' });
});

// Metrics endpoint (basic)
app.get('/metrics', (req, res) => {
    const metrics = {
        timestamp: new Date().toISOString(),
        process: {
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            cpu: process.cpuUsage()
        }
    };

    // Add socket.io stats if available
    const io = app.get('io');
    if (io) {
        io.fetchSockets().then(sockets => {
            metrics.socketio = {
                connections: sockets.length
            };
            res.json(metrics);
        }).catch(() => {
            res.json(metrics);
        });
    } else {
        res.json(metrics);
    }
});

// Serve the game for any non-API route (SPA support)
app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/socket.io') || req.path.startsWith('/health') || req.path.startsWith('/metrics')) {
        return next();
    }
    res.sendFile(path.join(__dirname, '../../public/index.html'));
});

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
