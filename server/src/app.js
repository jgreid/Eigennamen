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
const routes = require('./routes');

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

// API routes
app.use('/api', routes);

// Serve static files (the game client)
app.use(express.static(path.join(__dirname, '../../public')));

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// Serve the game for any non-API route (SPA support)
app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) {
        return next();
    }
    res.sendFile(path.join(__dirname, '../../public/index.html'));
});

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
