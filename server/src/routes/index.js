/**
 * API Routes
 */

const express = require('express');
const roomRoutes = require('./roomRoutes');
const wordListRoutes = require('./wordListRoutes');

const router = express.Router();

// API version prefix
router.use('/rooms', roomRoutes);
router.use('/wordlists', wordListRoutes);

// Health check endpoint
router.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString()
    });
});

module.exports = router;
