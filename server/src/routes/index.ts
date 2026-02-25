import type { Router as ExpressRouter } from 'express';

import express from 'express';
import roomRoutes from './roomRoutes';
import healthRoutes from './healthRoutes';
import replayRoutes from './replayRoutes';

const router: ExpressRouter = express.Router();

// API version prefix
router.use('/rooms', roomRoutes);
router.use('/replays', replayRoutes);

// Health routes (also mounted at root level in app.ts for /health access)
router.use('/health', healthRoutes);

export default router;

// CommonJS compat
module.exports = router;
module.exports.default = router;
