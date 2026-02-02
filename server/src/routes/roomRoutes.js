/**
 * Room API Routes
 */

const express = require('express');
const roomService = require('../services/roomService');
const playerService = require('../services/playerService');
const { validateParams } = require('../middleware/validation');
const { toEnglishLowerCase } = require('../utils/sanitize');
const { z } = require('zod');

const router = express.Router();

// Schema for room code param - aligned with socket schema (3-20 chars, Unicode)
const roomCodeSchema = z.object({
    code: z.string().min(3).max(20).transform(s => toEnglishLowerCase(s)).refine(s => /^[\p{L}\p{N}\-_]+$/u.test(s), 'Invalid room code format')
});

/**
 * Check if room exists
 * GET /api/rooms/:code/exists
 */
router.get('/:code/exists', validateParams(roomCodeSchema), async (req, res, next) => {
    try {
        const exists = await roomService.roomExists(req.params.code);
        res.json({ exists });
    } catch (error) {
        next(error);
    }
});

/**
 * Get room info (public info only)
 * GET /api/rooms/:code
 */
router.get('/:code', validateParams(roomCodeSchema), async (req, res, next) => {
    try {
        const room = await roomService.getRoom(req.params.code);

        if (!room) {
            return res.status(404).json({
                error: {
                    code: 'ROOM_NOT_FOUND',
                    message: 'Room not found'
                }
            });
        }

        // Return public room info
        res.json({
            room: {
                code: room.code,
                status: room.status,
                settings: {
                    teamNames: room.settings.teamNames,
                    allowSpectators: room.settings.allowSpectators
                }
            },
            playerCount: (await playerService.getPlayersInRoom(req.params.code)).length
        });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
