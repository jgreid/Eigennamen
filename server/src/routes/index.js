/**
 * API Routes
 */

const express = require('express');
const roomRoutes = require('./roomRoutes');
const wordListRoutes = require('./wordListRoutes');
const healthRoutes = require('./healthRoutes');

const router = express.Router();

// API version prefix
router.use('/rooms', roomRoutes);
router.use('/wordlists', wordListRoutes);

// Health routes (also mounted at root level in app.js for /health access)
router.use('/health', healthRoutes);

module.exports = router;
