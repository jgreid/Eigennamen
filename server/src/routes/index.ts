/**
 * API Routes
 */

import type { Router as ExpressRouter } from 'express';

import express from 'express';
import roomRoutes from './roomRoutes';
import wordListRoutes from './wordListRoutes';
import replayRoutes from './replayRoutes';
const router: ExpressRouter = express.Router();

// API version prefix
router.use('/rooms', roomRoutes);
router.use('/wordlists', wordListRoutes);
router.use('/replays', replayRoutes);

export default router;
