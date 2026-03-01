import type { Request, Response, NextFunction, Router as ExpressRouter } from 'express';

import express from 'express';
import rateLimit from 'express-rate-limit';
import * as gameHistoryService from '../services/gameHistoryService';
import * as playerService from '../services/playerService';
import { API_RATE_LIMITS, ERROR_CODES } from '../config/constants';
import { z } from 'zod';
import { createRoomIdSchema } from '../validators/schemaHelpers';
import { normalizeRoomCode } from '../utils/sanitize';
import logger from '../utils/logger';

const router: ExpressRouter = express.Router();

// Tighter rate limiter for replay requests to prevent enumeration
const replayLimiter = rateLimit({
    windowMs: API_RATE_LIMITS.GENERAL.window,
    max: Math.min(API_RATE_LIMITS.GENERAL.max, 30), // Tighter than general API limit
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => process.env.NODE_ENV === 'test',
    handler: (_req: Request, res: Response) => {
        res.status(429).json({
            error: {
                code: ERROR_CODES.RATE_LIMITED,
                message: 'Too many requests. Please try again later.',
            },
        });
    },
});

// Schema for replay params — uses shared room ID schema for consistent validation
const replayParamsSchema = z.object({
    roomCode: createRoomIdSchema(),
    gameId: z.string().uuid('Invalid game ID format'),
});

/**
 * Get replay data for a specific game
 * GET /api/replays/:roomCode/:gameId
 *
 * Requires X-Session-Id header — verifies the requester is (or was) a member
 * of the room. This prevents unauthenticated users from enumerating replays.
 */
router.get(
    '/:roomCode/:gameId',
    replayLimiter,
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const parsed = replayParamsSchema.safeParse(req.params);
            if (!parsed.success) {
                res.status(400).json({
                    error: {
                        code: ERROR_CODES.INVALID_INPUT,
                        message: 'Invalid room code or game ID format',
                    },
                });
                return;
            }

            // Require session ID to verify room membership
            const sessionId = req.headers['x-session-id'];
            if (!sessionId || typeof sessionId !== 'string') {
                res.status(401).json({
                    error: {
                        code: ERROR_CODES.NOT_AUTHORIZED,
                        message: 'Session ID required',
                    },
                });
                return;
            }

            const { roomCode, gameId } = parsed.data;
            const normalizedCode = normalizeRoomCode(roomCode);

            // Verify the session belongs to a player in this room
            try {
                const player = await playerService.getPlayer(sessionId);
                if (!player || normalizeRoomCode(player.roomCode) !== normalizedCode) {
                    res.status(403).json({
                        error: {
                            code: ERROR_CODES.NOT_AUTHORIZED,
                            message: 'Not a member of this room',
                        },
                    });
                    return;
                }
            } catch {
                res.status(403).json({
                    error: {
                        code: ERROR_CODES.NOT_AUTHORIZED,
                        message: 'Not a member of this room',
                    },
                });
                return;
            }

            const replayData = await gameHistoryService.getReplayEvents(roomCode, gameId);

            if (!replayData) {
                res.status(404).json({
                    error: {
                        code: 'REPLAY_NOT_FOUND',
                        message: 'Replay not found or expired',
                    },
                });
                return;
            }

            res.json({ replay: replayData });
        } catch (error) {
            logger.error('Error fetching replay', {
                roomCode: String(req.params.roomCode),
                error: error instanceof Error ? error.message : String(error),
            });
            next(error);
        }
    }
);

export default router;

// CommonJS compat
module.exports = router;
module.exports.default = router;
