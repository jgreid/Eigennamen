/**
 * Replay API Routes
 *
 * Provides public REST endpoint for fetching replay data,
 * enabling shareable replay links without requiring room membership.
 */

import type { Request, Response, NextFunction, Router as ExpressRouter } from 'express';

const express = require('express');
const rateLimit = require('express-rate-limit');
const gameHistoryService = require('../services/gameHistoryService');
const { toEnglishLowerCase } = require('../utils/sanitize');
const { API_RATE_LIMITS } = require('../config/constants');
const { z } = require('zod');
const logger = require('../utils/logger');

const router: ExpressRouter = express.Router();

// Rate limiter for replay requests to prevent enumeration
const replayLimiter = rateLimit({
    windowMs: API_RATE_LIMITS.GENERAL.window,
    max: API_RATE_LIMITS.GENERAL.max,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => process.env.NODE_ENV === 'test',
    handler: (_req: Request, res: Response) => {
        res.status(429).json({
            error: {
                code: 'RATE_LIMITED',
                message: 'Too many requests. Please try again later.'
            }
        });
    }
});

// Schema for replay params
const replayParamsSchema = z.object({
    roomCode: z.string().min(3).max(20).transform((s: string) => toEnglishLowerCase(s)),
    gameId: z.string().uuid('Invalid game ID format')
});

/**
 * Get replay data for a specific game
 * GET /api/replays/:roomCode/:gameId
 */
router.get('/:roomCode/:gameId', replayLimiter, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        const parsed = replayParamsSchema.safeParse(req.params);
        if (!parsed.success) {
            res.status(400).json({
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'Invalid parameters',
                    details: parsed.error.issues
                }
            });
            return;
        }

        const { roomCode, gameId } = parsed.data;
        const replayData = await gameHistoryService.getReplayEvents(roomCode, gameId);

        if (!replayData) {
            res.status(404).json({
                error: {
                    code: 'REPLAY_NOT_FOUND',
                    message: 'Replay not found or expired'
                }
            });
            return;
        }

        res.json({ replay: replayData });
    } catch (error) {
        logger.error('Error fetching replay:', error);
        next(error);
    }
});

module.exports = router;
export default router;
