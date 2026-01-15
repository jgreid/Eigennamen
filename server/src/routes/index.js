/**
 * API Routes
 */

const express = require('express');
const roomRoutes = require('./roomRoutes');

const router = express.Router();

// API version prefix
router.use('/rooms', roomRoutes);

// Health check endpoint
router.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString()
    });
});

module.exports = router;
