/**
 * API Routes
 */

import type { Router as ExpressRouter } from 'express';

const express = require('express');
const roomRoutes = require('./roomRoutes');
const wordListRoutes = require('./wordListRoutes');
const healthRoutes = require('./healthRoutes');

const router: ExpressRouter = express.Router();

// API version prefix
router.use('/rooms', roomRoutes);
router.use('/wordlists', wordListRoutes);

// Health routes (also mounted at root level in app.ts for /health access)
router.use('/health', healthRoutes);

module.exports = router;
export default router;
