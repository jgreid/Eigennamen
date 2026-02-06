/**
 * Room API Routes
 */

import type { Request, Response, NextFunction, Router as ExpressRouter } from 'express';
import type { Room, Player } from '../types';

/* eslint-disable @typescript-eslint/no-var-requires */
const express = require('express');
const roomService = require('../services/roomService');
const playerService = require('../services/playerService');
const { validateParams } = require('../middleware/validation');
const { toEnglishLowerCase } = require('../utils/sanitize');
const { z } = require('zod');
/* eslint-enable @typescript-eslint/no-var-requires */

const router: ExpressRouter = express.Router();

// Schema for room code param - aligned with socket schema (3-20 chars, Unicode)
const roomCodeSchema = z.object({
    code: z.string().min(3).max(20).transform((s: string) => toEnglishLowerCase(s)).refine((s: string) => /^[\p{L}\p{N}\-_]+$/u.test(s), 'Invalid room code format')
});

/**
 * Request with validated params
 */
interface RoomRequest extends Request {
    params: {
        code: string;
    };
}

/**
 * Check if room exists
 * GET /api/rooms/:code/exists
 */
router.get('/:code/exists', validateParams(roomCodeSchema), async (req: RoomRequest, res: Response, next: NextFunction) => {
    try {
        const exists: boolean = await roomService.roomExists(req.params.code);
        res.json({ exists });
    } catch (error) {
        next(error);
    }
});

/**
 * Get room info (public info only)
 * GET /api/rooms/:code
 */
router.get('/:code', validateParams(roomCodeSchema), async (req: RoomRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
        const room: Room | null = await roomService.getRoom(req.params.code);

        if (!room) {
            res.status(404).json({
                error: {
                    code: 'ROOM_NOT_FOUND',
                    message: 'Room not found'
                }
            });
            return;
        }

        // Return public room info
        const players: Player[] = await playerService.getPlayersInRoom(req.params.code);
        res.json({
            room: {
                code: room.code,
                status: room.status,
                settings: {
                    teamNames: room.settings.teamNames,
                    allowSpectators: room.settings.allowSpectators
                }
            },
            playerCount: players.length
        });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
export default router;
