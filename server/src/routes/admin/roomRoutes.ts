import type { Request, Response, Router as ExpressRouter } from 'express';
import type { RedisClient } from '../../types';
import type { AdminRequest } from '../../types/admin';

import express from 'express';
import logger from '../../utils/logger';
import { getRedis } from '../../config/redis';
import { z } from 'zod';
import { normalizeRoomCode } from '../../utils/sanitize';
import { tryParseJSON } from '../../utils/parseJSON';
import { audit } from '../../services/auditService';
import { removePlayer } from '../../services/playerService';
import * as roomService from '../../services/roomService';
import { incrementCounter, METRIC_NAMES } from '../../utils/metrics';

/**
 * Room data from Redis — aligned with the canonical Room type in types/room.ts.
 * Uses the actual field names stored in Redis (hostSessionId, not hostId).
 */
interface RoomData {
    id: string;
    code: string;
    roomId: string;
    hostSessionId: string;
    status: 'waiting' | 'playing' | 'finished';
    createdAt: number;
    expiresAt: number;
    settings: {
        teamNames: { red: string; blue: string };
        turnTimer: number | null;
        allowSpectators: boolean;
        wordListId?: string | null;
        gameMode?: string;
    };
}

/**
 * Player data from Redis — aligned with the canonical Player type in types/player.ts.
 */
interface PlayerData {
    sessionId: string;
    nickname: string;
    team: 'red' | 'blue' | null;
    role: 'spymaster' | 'clicker' | 'spectator';
    joinedAt: number;
    isHost?: boolean;
    connected?: boolean;
}

/**
 * Room summary for list view
 */
interface RoomSummary {
    code: string;
    status: 'waiting' | 'playing' | 'finished';
    playerCount: number;
    createdAt: number;
    settings: {
        teamNames: { red: string; blue: string };
        turnTimer: number | null;
        allowSpectators: boolean;
    };
}

// Zod schemas for safe Redis data deserialization
const roomDataSchema = z
    .object({
        id: z.string().optional(),
        code: z.string(),
        roomId: z.string().optional(),
        hostSessionId: z.string(),
        status: z.string(),
        createdAt: z.number().optional(),
        expiresAt: z.number().optional(),
        settings: z.record(z.string(), z.unknown()).optional(),
    })
    .passthrough();

const playerDataSchema = z
    .object({
        sessionId: z.string().optional(),
        nickname: z.string().optional(),
        team: z.string().nullable().optional(),
        role: z.string().optional(),
        joinedAt: z.number().optional(),
        isHost: z.boolean().optional(),
        connected: z.boolean().optional(),
    })
    .passthrough();

const router: ExpressRouter = express.Router();

/**
 * Zod schema for broadcast validation
 * Replaces manual type assertion with proper schema validation
 */
// Shared room code validation regex (matches the Zod roomCodeSchema in validators/)
const ROOM_CODE_REGEX = /^[\p{L}\p{N}\-_]{3,20}$/u;

const broadcastSchema = z.object({
    message: z
        .string()
        .min(1, 'Broadcast message is required')
        .max(500, 'Broadcast message must be 500 characters or less'),
    type: z.enum(['info', 'warning', 'error']).default('info'),
});

/**
 * GET /admin/api/rooms - List active rooms
 */
router.get('/api/rooms', async (_req: Request, res: Response) => {
    try {
        const redis: RedisClient = getRedis();
        if (!redis.scan) {
            res.json({ count: 0, rooms: [] });
            return;
        }
        // Use SCAN to avoid blocking Redis.
        // Cap iterations to prevent unbounded looping on very large keyspaces.
        const MAX_SCAN_ITERATIONS = 1000;
        const validRoomKeys: string[] = [];
        let cursor = 0;
        let iterations = 0;
        do {
            const result = await redis.scan(cursor, { MATCH: 'room:*', COUNT: 100 });
            cursor = result.cursor;
            iterations++;
            // Filter to only room codes (excluding sub-keys like room:abc:players)
            for (const key of result.keys) {
                if (/^room:[\p{L}\p{N}\-_]{3,20}$/u.test(key)) {
                    validRoomKeys.push(key);
                }
            }
        } while (cursor !== 0 && iterations < MAX_SCAN_ITERATIONS);
        if (iterations >= MAX_SCAN_ITERATIONS) {
            logger.warn(`Room listing SCAN hit iteration cap (${MAX_SCAN_ITERATIONS}), results may be incomplete`);
        }

        const rooms: RoomSummary[] = [];
        for (const key of validRoomKeys) {
            try {
                const roomData = await redis.get(key);
                if (roomData) {
                    const room = tryParseJSON(roomData, roomDataSchema, `admin room list: ${key}`) as RoomData | null;
                    if (!room) continue;
                    const code = key.replace('room:', '');

                    // Get player count
                    const playerKeys = await redis.sMembers(`room:${code}:players`);

                    rooms.push({
                        code: room.code,
                        status: room.status,
                        playerCount: playerKeys.length,
                        createdAt: room.createdAt,
                        settings: {
                            teamNames: room.settings?.teamNames,
                            turnTimer: room.settings?.turnTimer,
                            allowSpectators: room.settings?.allowSpectators,
                        },
                    });
                }
            } catch (parseError) {
                logger.warn(`Failed to parse room data for ${key}`, { error: (parseError as Error).message });
            }
        }

        // Sort by creation time (newest first)
        rooms.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

        res.json({
            count: rooms.length,
            rooms,
        });
    } catch (error) {
        logger.error('Failed to list rooms', { error: (error as Error).message });
        res.status(500).json({
            error: {
                code: 'ROOMS_ERROR',
                message: 'Failed to list active rooms',
            },
        });
    }
});

/**
 * POST /admin/api/broadcast - Send broadcast message to all rooms
 */
router.post('/api/broadcast', (req: AdminRequest, res: Response): void => {
    try {
        const parsed = broadcastSchema.safeParse(req.body);
        if (!parsed.success) {
            const firstError = parsed.error.issues[0];
            res.status(400).json({
                error: {
                    code: 'INVALID_INPUT',
                    message: firstError?.message || 'Invalid broadcast input',
                },
            });
            return;
        }

        const { message, type } = parsed.data;

        const io = req.app.get('io');

        if (!io) {
            res.status(503).json({
                error: {
                    code: 'SOCKET_UNAVAILABLE',
                    message: 'Socket.io is not available',
                },
            });
            return;
        }

        // Broadcast to all connected clients
        io.emit('admin:broadcast', {
            message: message.trim(),
            type,
            timestamp: new Date().toISOString(),
            from: req.adminUsername,
        });

        logger.info('Admin broadcast sent', {
            message: message.substring(0, 50),
            type,
            from: req.adminUsername,
        });

        incrementCounter(METRIC_NAMES.BROADCASTS_SENT, 1, { type });

        res.json({
            success: true,
            message: 'Broadcast sent successfully',
        });
    } catch (error) {
        logger.error('Failed to send broadcast', { error: (error as Error).message });
        res.status(500).json({
            error: {
                code: 'BROADCAST_ERROR',
                message: 'Failed to send broadcast message',
            },
        });
    }
});

/**
 * GET /admin/api/rooms/:code/details - Get detailed room info with players
 */
router.get('/api/rooms/:code/details', async (req: Request, res: Response): Promise<void> => {
    try {
        const code = String(req.params.code);
        if (!code) {
            res.status(400).json({
                error: {
                    code: 'INVALID_ROOM_CODE',
                    message: 'Room code is required',
                },
            });
            return;
        }

        // Validate room code format
        if (!ROOM_CODE_REGEX.test(code)) {
            res.status(400).json({
                error: {
                    code: 'INVALID_ROOM_CODE',
                    message: 'Invalid room code format',
                },
            });
            return;
        }

        const normalizedCode = normalizeRoomCode(code);
        const redis: RedisClient = getRedis();

        // Get room data
        const roomData = await redis.get(`room:${normalizedCode}`);
        if (!roomData) {
            res.status(404).json({
                error: {
                    code: 'ROOM_NOT_FOUND',
                    message: 'Room not found',
                },
            });
            return;
        }

        const room = tryParseJSON(roomData, roomDataSchema, `admin room details: ${normalizedCode}`) as RoomData | null;
        if (!room) {
            res.status(500).json({
                error: {
                    code: 'ROOM_DATA_CORRUPT',
                    message: 'Room data could not be parsed',
                },
            });
            return;
        }

        // Get all player IDs
        const playerIds = await redis.sMembers(`room:${normalizedCode}:players`);

        // Fetch player data
        const players: Array<{
            id: string;
            nickname: string;
            team: string | null;
            role: string;
            isHost: boolean;
            joinedAt?: number;
        }> = [];
        for (const playerId of playerIds) {
            try {
                const playerData = await redis.get(`player:${playerId}`);
                if (playerData) {
                    const player = tryParseJSON(
                        playerData,
                        playerDataSchema,
                        `admin player: ${playerId}`
                    ) as PlayerData | null;
                    if (!player) continue;
                    players.push({
                        id: playerId,
                        nickname: player.nickname || 'Unknown',
                        team: player.team || null,
                        role: player.role || 'operative',
                        isHost: room.hostSessionId === playerId,
                        joinedAt: player.joinedAt,
                    });
                }
            } catch (parseError) {
                logger.warn(`Failed to parse player data for ${playerId}`, { error: (parseError as Error).message });
            }
        }

        // Sort: host first, then by join time
        players.sort((a, b) => {
            if (a.isHost) return -1;
            if (b.isHost) return 1;
            return (a.joinedAt || 0) - (b.joinedAt || 0);
        });

        res.json({
            code: room.code,
            status: room.status,
            hostId: room.hostSessionId,
            players,
            settings: room.settings,
            createdAt: room.createdAt,
        });
    } catch (error) {
        logger.error('Failed to fetch room details', {
            error: (error as Error).message,
            code: String(req.params.code),
        });
        res.status(500).json({
            error: {
                code: 'ROOM_DETAILS_ERROR',
                message: 'Failed to fetch room details',
            },
        });
    }
});

/**
 * DELETE /admin/api/rooms/:code/players/:playerId - Kick a player from room
 */
router.delete('/api/rooms/:code/players/:playerId', async (req: AdminRequest, res: Response): Promise<void> => {
    try {
        const code = String(req.params.code);
        const playerId = String(req.params.playerId);

        if (!code) {
            res.status(400).json({
                error: {
                    code: 'INVALID_ROOM_CODE',
                    message: 'Room code is required',
                },
            });
            return;
        }

        // Validate room code format
        if (!ROOM_CODE_REGEX.test(code)) {
            res.status(400).json({
                error: {
                    code: 'INVALID_ROOM_CODE',
                    message: 'Invalid room code format',
                },
            });
            return;
        }

        // Validate player ID format (should be a socket ID or similar)
        if (!playerId || typeof playerId !== 'string' || playerId.length > 100) {
            res.status(400).json({
                error: {
                    code: 'INVALID_PLAYER_ID',
                    message: 'Invalid player ID format',
                },
            });
            return;
        }

        const normalizedCode = normalizeRoomCode(code);
        const redis: RedisClient = getRedis();

        // Check if room exists
        const roomData = await redis.get(`room:${normalizedCode}`);
        if (!roomData) {
            res.status(404).json({
                error: {
                    code: 'ROOM_NOT_FOUND',
                    message: 'Room not found',
                },
            });
            return;
        }

        const room = tryParseJSON(roomData, roomDataSchema, `admin kick: ${normalizedCode}`) as RoomData | null;
        if (!room) {
            res.status(500).json({
                error: {
                    code: 'ROOM_DATA_CORRUPT',
                    message: 'Room data could not be parsed',
                },
            });
            return;
        }

        // Don't allow kicking the host
        if (room.hostSessionId === playerId) {
            res.status(400).json({
                error: {
                    code: 'CANNOT_KICK_HOST',
                    message: 'Cannot kick the room host',
                },
            });
            return;
        }

        // Check if player is in the room
        const isMember = await redis.sIsMember(`room:${normalizedCode}:players`, playerId);
        if (!isMember) {
            res.status(404).json({
                error: {
                    code: 'PLAYER_NOT_FOUND',
                    message: 'Player not found in room',
                },
            });
            return;
        }

        // Notify the player they've been kicked
        const io = req.app.get('io');
        if (io) {
            io.to(`player:${playerId}`).emit('room:kicked', {
                reason: 'Kicked by administrator',
                timestamp: new Date().toISOString(),
            });

            // Also notify others in the room
            io.to(`room:${normalizedCode}`).emit('room:playerKicked', {
                playerId,
                reason: 'Kicked by administrator',
            });

            // Force the player's socket to leave the room
            io.in(`player:${playerId}`).socketsLeave(`room:${normalizedCode}`);
        }

        // Remove player from room (handles player set, team sets, reconnection tokens, and player data)
        await removePlayer(playerId);

        logger.info('Player kicked by admin', {
            code: normalizedCode,
            playerId,
            admin: req.adminUsername,
        });

        incrementCounter(METRIC_NAMES.PLAYER_KICKS, 1, { roomCode: normalizedCode, reason: 'admin' });

        // Audit the player kick action
        Promise.resolve(audit.adminKickPlayer(normalizedCode, playerId, req.ip ?? '', 'Admin action')).catch(
            (err: Error) => logger.warn('Audit log failed', { error: err.message })
        );

        res.json({
            success: true,
            message: 'Player has been kicked',
        });
    } catch (error) {
        logger.error('Failed to kick player', {
            error: (error as Error).message,
            code: String(req.params.code),
            playerId: String(req.params.playerId),
        });
        res.status(500).json({
            error: {
                code: 'KICK_ERROR',
                message: 'Failed to kick player',
            },
        });
    }
});

/**
 * DELETE /admin/api/rooms/:code - Force close a room
 */
router.delete('/api/rooms/:code', async (req: AdminRequest, res: Response): Promise<void> => {
    try {
        const code = String(req.params.code);

        if (!code) {
            res.status(400).json({
                error: {
                    code: 'INVALID_ROOM_CODE',
                    message: 'Room code is required',
                },
            });
            return;
        }

        // Validate room code format (Unicode letters/numbers, hyphens, underscores)
        if (!ROOM_CODE_REGEX.test(code)) {
            res.status(400).json({
                error: {
                    code: 'INVALID_ROOM_CODE',
                    message: 'Invalid room code format',
                },
            });
            return;
        }

        const normalizedCode = normalizeRoomCode(code);
        const redis: RedisClient = getRedis();

        // Check if room exists
        const roomData = await redis.get(`room:${normalizedCode}`);
        if (!roomData) {
            res.status(404).json({
                error: {
                    code: 'ROOM_NOT_FOUND',
                    message: 'Room not found',
                },
            });
            return;
        }

        // Notify all players in the room before closing
        const io = req.app.get('io');
        if (io) {
            io.to(`room:${normalizedCode}`).emit('room:forceClosed', {
                reason: 'Room closed by administrator',
                timestamp: new Date().toISOString(),
            });
        }

        // Use roomService to properly clean up the room
        await roomService.deleteRoom(normalizedCode);

        logger.info('Room force closed by admin', {
            code: normalizedCode,
            admin: req.adminUsername,
        });

        // Audit the room deletion
        Promise.resolve(audit.adminDeleteRoom(normalizedCode, req.ip ?? '', 'Admin action')).catch((err: Error) =>
            logger.warn('Audit log failed', { error: err.message })
        );

        res.json({
            success: true,
            message: `Room ${normalizedCode} has been closed`,
        });
    } catch (error) {
        logger.error('Failed to close room', { error: (error as Error).message, code: String(req.params.code) });
        res.status(500).json({
            error: {
                code: 'ROOM_CLOSE_ERROR',
                message: 'Failed to close room',
            },
        });
    }
});

export default router;
