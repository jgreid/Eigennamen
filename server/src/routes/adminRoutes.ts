/**
 * Admin Dashboard Routes
 *
 * Provides endpoints for server administration and monitoring.
 * Protected by HTTP Basic Authentication using ADMIN_PASSWORD environment variable.
 */

import type { Request, Response, NextFunction, Router as ExpressRouter, Application } from 'express';
import type { Server } from 'socket.io';
import type { RedisClient } from '../types';

import express from 'express';
import path from 'path';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import logger from '../utils/logger';
import { getRedis, isRedisHealthy, isUsingMemoryMode } from '../config/redis';
import { isDatabaseEnabled } from '../config/database';
import { getAllMetrics, incrementCounter, METRIC_NAMES } from '../utils/metrics';
import { API_RATE_LIMITS } from '../config/constants';
import { z } from 'zod';
import { toEnglishLowerCase } from '../utils/sanitize';
import { audit, getAuditLogs, getAuditSummary } from '../services/auditService';

const router: ExpressRouter = express.Router();

/**
 * Admin request with username
 */
interface AdminRequest extends Request {
    adminUsername?: string;
    app: Application & {
        get(key: 'io'): Server | undefined;
    };
}

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

// RedisClient imported from '../types' (shared across all services)

/**
 * Basic Authentication Middleware
 * Requires ADMIN_PASSWORD environment variable to be set
 */
function basicAuth(req: AdminRequest, res: Response, next: NextFunction): Response | void {
    const adminPassword = process.env.ADMIN_PASSWORD;

    // If no admin password is configured, deny all access
    if (!adminPassword) {
        logger.warn('Admin access attempted but ADMIN_PASSWORD not configured');
        return res.status(401).json({
            error: {
                code: 'ADMIN_NOT_CONFIGURED',
                message: 'Admin access is not configured on this server'
            }
        });
    }

    // Check for Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Basic ')) {
        res.setHeader('WWW-Authenticate', 'Basic realm="Admin Dashboard"');
        return res.status(401).json({
            error: {
                code: 'AUTH_REQUIRED',
                message: 'Authentication required'
            }
        });
    }

    // Decode and verify credentials
    try {
        const base64Credentials = authHeader.split(' ')[1];
        if (base64Credentials) {
            const credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8');
            const [username, password] = credentials.split(':');

            // Accept any username with the correct password (common for simple admin panels)
            // Use constant-time comparison to prevent timing attacks
            // Hash both to fixed-length buffers to avoid leaking password length
            const passwordHash = crypto.createHash('sha256').update(password || '').digest();
            const adminHash = crypto.createHash('sha256').update(adminPassword).digest();
            if (crypto.timingSafeEqual(passwordHash, adminHash)) {
                req.adminUsername = username || 'admin';
                // Audit successful login
                audit.adminLogin(req.ip, true);
                return next();
            }
        }
    } catch (error) {
        logger.warn('Failed to decode admin credentials', { error: (error as Error).message });
    }

    // Audit failed login
    audit.adminLogin(req.ip, false);

    res.setHeader('WWW-Authenticate', 'Basic realm="Admin Dashboard"');
    return res.status(401).json({
        error: {
            code: 'AUTH_INVALID',
            message: 'Invalid credentials'
        }
    });
}

// Rate limiter for admin routes to prevent brute force and abuse
const adminLimiter = rateLimit({
    windowMs: API_RATE_LIMITS.ADMIN.window,
    max: API_RATE_LIMITS.ADMIN.max,
    standardHeaders: true,
    legacyHeaders: false,
    // Skip rate limiting in test environment
    skip: () => process.env.NODE_ENV === 'test',
    handler: (_req: Request, res: Response) => {
        logger.warn('Admin rate limit exceeded', { ip: _req.ip });
        res.status(429).json({
            error: {
                code: 'RATE_LIMITED',
                message: 'Too many requests, please try again later'
            }
        });
    }
});

// Apply rate limiting first, then basic auth to all admin routes
router.use(adminLimiter);
router.use(basicAuth);

/**
 * GET /admin - Serve the admin dashboard HTML page
 */
router.get('/', (_req: Request, res: Response) => {
    const adminHtmlPath = path.join(__dirname, '../../public/admin.html');
    res.sendFile(adminHtmlPath, (err: Error | null) => {
        if (err) {
            logger.error('Failed to serve admin.html', { error: err.message });
            res.status(500).json({
                error: {
                    code: 'ADMIN_PAGE_ERROR',
                    message: 'Failed to load admin dashboard'
                }
            });
        }
    });
});

/**
 * GET /admin/api/stats - Return server statistics
 */
router.get('/api/stats', async (req: AdminRequest, res: Response) => {
    try {
        const memUsage = process.memoryUsage();
        const appMetrics = getAllMetrics();

        // Get Redis health
        let redisStatus: { healthy: boolean; mode: string; error?: string } = { healthy: false, mode: 'unknown' };
        try {
            const healthy: boolean = await isRedisHealthy();
            const memoryMode: boolean = isUsingMemoryMode();
            redisStatus = {
                healthy,
                mode: memoryMode ? 'memory' : 'redis'
            };
        } catch (error) {
            redisStatus.error = (error as Error).message;
        }

        // Get Socket.io stats if available
        const socketStats: { connections: number; error?: string } = { connections: 0 };
        try {
            const io = req.app.get('io');
            if (io) {
                const sockets = await io.fetchSockets();
                socketStats.connections = sockets.length;
            }
        } catch (error) {
            socketStats.error = (error as Error).message;
        }

        // Get room count using SCAN to avoid blocking Redis
        let roomCount = 0;
        try {
            const redis: RedisClient = getRedis();
            if (redis.scan) {
                let cursor = '0';
                do {
                    const result = await redis.scan(cursor, { MATCH: 'room:*', COUNT: 100 });
                    cursor = result.cursor.toString();
                    // Filter to only room codes (excluding sub-keys like room:abc:players)
                    roomCount += result.keys.filter(key => /^room:[\p{L}\p{N}\-_]{3,20}$/u.test(key)).length;
                } while (cursor !== '0');
            }
        } catch (error) {
            logger.warn('Failed to count rooms', { error: (error as Error).message });
        }

        const stats = {
            timestamp: new Date().toISOString(),
            uptime: {
                seconds: Math.floor(process.uptime()),
                formatted: formatUptime(process.uptime())
            },
            memory: {
                heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
                heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
                rss: Math.round(memUsage.rss / 1024 / 1024),
                external: Math.round(memUsage.external / 1024 / 1024)
            },
            connections: {
                sockets: socketStats.connections,
                activeRooms: roomCount
            },
            health: {
                redis: redisStatus,
                database: {
                    enabled: isDatabaseEnabled()
                }
            },
            metrics: {
                counters: appMetrics.counters,
                gauges: appMetrics.gauges
            },
            instance: {
                pid: process.pid,
                nodeVersion: process.version,
                flyAllocId: process.env.FLY_ALLOC_ID || null,
                flyRegion: process.env.FLY_REGION || null
            }
        };

        res.json(stats);
    } catch (error) {
        logger.error('Failed to fetch admin stats', { error: (error as Error).message });
        res.status(500).json({
            error: {
                code: 'STATS_ERROR',
                message: 'Failed to fetch server statistics'
            }
        });
    }
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
        // Use SCAN to avoid blocking Redis
        const validRoomKeys: string[] = [];
        let cursor = '0';
        do {
            const result = await redis.scan(cursor, { MATCH: 'room:*', COUNT: 100 });
            cursor = result.cursor.toString();
            // Filter to only room codes (excluding sub-keys like room:abc:players)
            for (const key of result.keys) {
                if (/^room:[\p{L}\p{N}\-_]{3,20}$/u.test(key)) {
                    validRoomKeys.push(key);
                }
            }
        } while (cursor !== '0');

        const rooms: RoomSummary[] = [];
        for (const key of validRoomKeys) {
            try {
                const roomData = await redis.get(key);
                if (roomData) {
                    const room: RoomData = JSON.parse(roomData);
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
                            allowSpectators: room.settings?.allowSpectators
                        }
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
            rooms
        });
    } catch (error) {
        logger.error('Failed to list rooms', { error: (error as Error).message });
        res.status(500).json({
            error: {
                code: 'ROOMS_ERROR',
                message: 'Failed to list active rooms'
            }
        });
    }
});

/**
 * Zod schema for broadcast validation
 * HIGH FIX: Replaces manual type assertion with proper schema validation
 */
const broadcastSchema = z.object({
    message: z.string().min(1, 'Broadcast message is required').max(500, 'Broadcast message must be 500 characters or less'),
    type: z.enum(['info', 'warning', 'error']).default('info')
});

/**
 * POST /admin/api/broadcast - Send broadcast message to all rooms
 */
router.post('/api/broadcast', (req: AdminRequest, res: Response): void => {
    try {
        const parsed = broadcastSchema.safeParse(req.body);
        if (!parsed.success) {
            const firstError = parsed.error.errors[0];
            res.status(400).json({
                error: {
                    code: 'INVALID_INPUT',
                    message: firstError?.message || 'Invalid broadcast input'
                }
            });
            return;
        }

        const { message, type } = parsed.data;

        const io = req.app.get('io');

        if (!io) {
            res.status(503).json({
                error: {
                    code: 'SOCKET_UNAVAILABLE',
                    message: 'Socket.io is not available'
                }
            });
            return;
        }

        // Broadcast to all connected clients
        io.emit('admin:broadcast', {
            message: message.trim(),
            type,
            timestamp: new Date().toISOString(),
            from: req.adminUsername
        });

        logger.info('Admin broadcast sent', {
            message: message.substring(0, 50),
            type,
            from: req.adminUsername
        });

        incrementCounter(METRIC_NAMES.BROADCASTS_SENT, 1, { type });

        res.json({
            success: true,
            message: 'Broadcast sent successfully'
        });
    } catch (error) {
        logger.error('Failed to send broadcast', { error: (error as Error).message });
        res.status(500).json({
            error: {
                code: 'BROADCAST_ERROR',
                message: 'Failed to send broadcast message'
            }
        });
    }
});

/**
 * PHASE 4.7: GET /admin/api/rooms/:code/details - Get detailed room info with players
 */
router.get('/api/rooms/:code/details', async (req: Request, res: Response): Promise<void> => {
    try {
        const code = req.params.code;
        if (!code) {
            res.status(400).json({
                error: {
                    code: 'INVALID_ROOM_CODE',
                    message: 'Room code is required'
                }
            });
            return;
        }

        // Validate room code format
        if (!/^[\p{L}\p{N}\-_]{3,20}$/u.test(code)) {
            res.status(400).json({
                error: {
                    code: 'INVALID_ROOM_CODE',
                    message: 'Invalid room code format'
                }
            });
            return;
        }

        const normalizedCode = toEnglishLowerCase(code);
        const redis: RedisClient = getRedis();

        // Get room data
        const roomData = await redis.get(`room:${normalizedCode}`);
        if (!roomData) {
            res.status(404).json({
                error: {
                    code: 'ROOM_NOT_FOUND',
                    message: 'Room not found'
                }
            });
            return;
        }

        const room: RoomData = JSON.parse(roomData);

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
                    const player: PlayerData = JSON.parse(playerData);
                    players.push({
                        id: playerId,
                        nickname: player.nickname || 'Unknown',
                        team: player.team || null,
                        role: player.role || 'operative',
                        isHost: room.hostSessionId === playerId,
                        joinedAt: player.joinedAt
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
            createdAt: room.createdAt
        });
    } catch (error) {
        logger.error('Failed to fetch room details', { error: (error as Error).message, code: req.params.code });
        res.status(500).json({
            error: {
                code: 'ROOM_DETAILS_ERROR',
                message: 'Failed to fetch room details'
            }
        });
    }
});

/**
 * PHASE 4.7: DELETE /admin/api/rooms/:code/players/:playerId - Kick a player from room
 */
router.delete('/api/rooms/:code/players/:playerId', async (req: AdminRequest, res: Response): Promise<void> => {
    try {
        const code = req.params.code;
        const playerId = req.params.playerId;

        if (!code) {
            res.status(400).json({
                error: {
                    code: 'INVALID_ROOM_CODE',
                    message: 'Room code is required'
                }
            });
            return;
        }

        // Validate room code format
        if (!/^[\p{L}\p{N}\-_]{3,20}$/u.test(code)) {
            res.status(400).json({
                error: {
                    code: 'INVALID_ROOM_CODE',
                    message: 'Invalid room code format'
                }
            });
            return;
        }

        // Validate player ID format (should be a socket ID or similar)
        if (!playerId || typeof playerId !== 'string' || playerId.length > 100) {
            res.status(400).json({
                error: {
                    code: 'INVALID_PLAYER_ID',
                    message: 'Invalid player ID format'
                }
            });
            return;
        }

        const normalizedCode = toEnglishLowerCase(code);
        const redis: RedisClient = getRedis();

        // Check if room exists
        const roomData = await redis.get(`room:${normalizedCode}`);
        if (!roomData) {
            res.status(404).json({
                error: {
                    code: 'ROOM_NOT_FOUND',
                    message: 'Room not found'
                }
            });
            return;
        }

        const room: RoomData = JSON.parse(roomData);

        // Don't allow kicking the host
        if (room.hostSessionId === playerId) {
            res.status(400).json({
                error: {
                    code: 'CANNOT_KICK_HOST',
                    message: 'Cannot kick the room host'
                }
            });
            return;
        }

        // Check if player is in the room
        const isMember = await redis.sIsMember(`room:${normalizedCode}:players`, playerId);
        if (!isMember) {
            res.status(404).json({
                error: {
                    code: 'PLAYER_NOT_FOUND',
                    message: 'Player not found in room'
                }
            });
            return;
        }

        // Notify the player they've been kicked
        const io = req.app.get('io');
        if (io) {
            io.to(playerId).emit('room:kicked', {
                reason: 'Kicked by administrator',
                timestamp: new Date().toISOString()
            });

            // Also notify others in the room
            io.to(`room:${normalizedCode}`).emit('room:playerKicked', {
                playerId,
                reason: 'Kicked by administrator'
            });
        }

        // Remove player from room
        await redis.sRem(`room:${normalizedCode}:players`, playerId);
        await redis.del(`player:${playerId}`);

        logger.info('Player kicked by admin', {
            code: normalizedCode,
            playerId,
            admin: req.adminUsername
        });

        incrementCounter(METRIC_NAMES.PLAYER_KICKS, 1, { roomCode: normalizedCode, reason: 'admin' });

        // Audit the player kick action
        audit.adminKickPlayer(normalizedCode, playerId, req.ip, 'Admin action');

        res.json({
            success: true,
            message: 'Player has been kicked'
        });
    } catch (error) {
        logger.error('Failed to kick player', { error: (error as Error).message, code: req.params.code, playerId: req.params.playerId });
        res.status(500).json({
            error: {
                code: 'KICK_ERROR',
                message: 'Failed to kick player'
            }
        });
    }
});

/**
 * DELETE /admin/api/rooms/:code - Force close a room
 */
router.delete('/api/rooms/:code', async (req: AdminRequest, res: Response): Promise<void> => {
    try {
        const code = req.params.code;

        if (!code) {
            res.status(400).json({
                error: {
                    code: 'INVALID_ROOM_CODE',
                    message: 'Room code is required'
                }
            });
            return;
        }

        // Validate room code format (Unicode letters/numbers, hyphens, underscores)
        if (!/^[\p{L}\p{N}\-_]{3,20}$/u.test(code)) {
            res.status(400).json({
                error: {
                    code: 'INVALID_ROOM_CODE',
                    message: 'Invalid room code format'
                }
            });
            return;
        }

        const normalizedCode = toEnglishLowerCase(code);
        const redis: RedisClient = getRedis();

        // Check if room exists
        const roomData = await redis.get(`room:${normalizedCode}`);
        if (!roomData) {
            res.status(404).json({
                error: {
                    code: 'ROOM_NOT_FOUND',
                    message: 'Room not found'
                }
            });
            return;
        }

        // Notify all players in the room before closing
        const io = req.app.get('io');
        if (io) {
            io.to(`room:${normalizedCode}`).emit('room:forceClosed', {
                reason: 'Room closed by administrator',
                timestamp: new Date().toISOString()
            });
        }

        // Use roomService to properly clean up the room
        const roomService = require('../services/roomService');
        await roomService.deleteRoom(normalizedCode);

        logger.info('Room force closed by admin', {
            code: normalizedCode,
            admin: req.adminUsername
        });

        // Audit the room deletion
        audit.adminDeleteRoom(normalizedCode, req.ip, 'Admin action');

        res.json({
            success: true,
            message: `Room ${normalizedCode} has been closed`
        });
    } catch (error) {
        logger.error('Failed to close room', { error: (error as Error).message, code: req.params.code });
        res.status(500).json({
            error: {
                code: 'ROOM_CLOSE_ERROR',
                message: 'Failed to close room'
            }
        });
    }
});

/**
 * GET /admin/api/audit - Get audit logs
 */
router.get('/api/audit', async (req: Request, res: Response) => {
    try {
        const { category = 'all', limit = '100', severity = null } = req.query as {
            category?: string;
            limit?: string;
            severity?: string | null;
        };

        const logs = await getAuditLogs({
            category,
            limit: Math.min(parseInt(limit, 10) || 100, 1000),
            severity
        });

        const summary = await getAuditSummary();

        res.json({
            summary,
            logs
        });
    } catch (error) {
        logger.error('Failed to fetch audit logs', { error: (error as Error).message });
        res.status(500).json({
            error: {
                code: 'AUDIT_ERROR',
                message: 'Failed to fetch audit logs'
            }
        });
    }
});

/**
 * GET /admin/api/stats/stream - Server-Sent Events for real-time metrics
 * Streams server stats every 5 seconds without requiring page refresh.
 */
router.get('/api/stats/stream', (req: AdminRequest, res: Response): void => {
    // Set SSE headers
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'  // Disable nginx buffering
    });

    const sendStats = async () => {
        try {
            const redisHealthy = await isRedisHealthy();
            const memUsage = process.memoryUsage();
            const metrics = getAllMetrics();

            const data = {
                timestamp: Date.now(),
                memory: {
                    rss: Math.round(memUsage.rss / 1024 / 1024),
                    heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
                    heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024)
                },
                uptime: Math.round(process.uptime()),
                redis: redisHealthy ? 'connected' : (isUsingMemoryMode() ? 'memory' : 'disconnected'),
                database: isDatabaseEnabled() ? 'connected' : 'not configured',
                metrics: {
                    counters: metrics.counters || {},
                    gauges: metrics.gauges || {}
                },
                alerts: [] as string[]
            };

            // Check alert thresholds
            if (data.memory.rss > 480) {
                data.alerts.push(`High memory usage: ${data.memory.rss}MB`);
            }

            res.write(`data: ${JSON.stringify(data)}\n\n`);
        } catch (error) {
            logger.error('SSE stats error:', (error as Error).message);
        }
    };

    // Send initial data immediately
    sendStats();

    // Stream updates every 5 seconds
    const interval = setInterval(sendStats, 5000);

    // Clean up on client disconnect
    req.on('close', () => {
        clearInterval(interval);
    });
});

/**
 * Format uptime seconds into human-readable string
 */
function formatUptime(seconds: number): string {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    const parts: string[] = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);

    return parts.join(' ');
}

export default router;

// CommonJS compat
module.exports = router;
module.exports.default = router;
