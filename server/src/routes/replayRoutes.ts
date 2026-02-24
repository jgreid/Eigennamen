/**
 * Replay API Routes
 *
 * Provides public REST endpoint for fetching replay data,
 * enabling shareable replay links without requiring room membership.
 */

import type { Request, Response, NextFunction, Router as ExpressRouter } from 'express';

import express from 'express';
import rateLimit from 'express-rate-limit';
import * as gameHistoryService from '../services/gameHistoryService';
import { API_RATE_LIMITS, ERROR_CODES } from '../config/constants';
import { z } from 'zod';
import { createRoomIdSchema } from '../validators/schemaHelpers';
import logger from '../utils/logger';

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
                code: ERROR_CODES.RATE_LIMITED,
                message: 'Too many requests. Please try again later.'
            }
        });
    }
});

// Schema for replay params — uses shared room ID schema for consistent validation
const replayParamsSchema = z.object({
    roomCode: createRoomIdSchema(),
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
                    code: ERROR_CODES.INVALID_INPUT,
                    message: 'Invalid room code or game ID format'
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
        logger.error('Error fetching replay', { roomCode: String(req.params.roomCode), error: error instanceof Error ? error.message : String(error) });
        next(error);
    }
});

export default router;

// CommonJS compat
module.exports = router;
module.exports.default = router;
