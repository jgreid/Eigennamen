/**
 * Room API Routes
 */

const express = require('express');
const roomService = require('../services/roomService');
const playerService = require('../services/playerService');
const { validateParams } = require('../middleware/validation');
const { z } = require('zod');

const router = express.Router();

// Schema for room code param
const roomCodeSchema = z.object({
    code: z.string().length(6).transform(s => s.toUpperCase()).refine(s => /^[A-Z0-9]+$/.test(s), 'Invalid room code format')
});

/**
 * Find room by password
 * GET /api/rooms/by-password/:password
 * NOTE: This route MUST be defined before /:code to avoid route conflicts
 */
router.get('/by-password/:password', async (req, res, next) => {
    try {
        const password = decodeURIComponent(req.params.password);

        if (!password || password.length > 50) {
            return res.status(400).json({
                error: {
                    code: 'INVALID_PASSWORD',
                    message: 'Invalid password format'
                }
            });
        }

        const result = await roomService.findRoomByPassword(password);

        if (!result) {
            return res.status(404).json({
                error: {
                    code: 'ROOM_NOT_FOUND',
                    message: 'No room found with that password'
                }
            });
        }

        res.json(result);
    } catch (error) {
        next(error);
    }
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
