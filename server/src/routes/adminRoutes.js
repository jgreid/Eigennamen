/**
 * Admin Dashboard Routes
 *
 * Provides endpoints for server administration and monitoring.
 * Protected by HTTP Basic Authentication using ADMIN_PASSWORD environment variable.
 */

const express = require('express');
const path = require('path');
const logger = require('../utils/logger');
const { getRedis, isRedisHealthy, isUsingMemoryMode } = require('../config/redis');
const { isDatabaseEnabled } = require('../config/database');
const { getAllMetrics } = require('../utils/metrics');
const { getHttpRateLimitMetrics } = require('../middleware/rateLimit');

const router = express.Router();

/**
 * Basic Authentication Middleware
 * Requires ADMIN_PASSWORD environment variable to be set
 */
function basicAuth(req, res, next) {
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
        const credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8');
        const [username, password] = credentials.split(':');

        // Accept any username with the correct password (common for simple admin panels)
        if (password === adminPassword) {
            req.adminUsername = username || 'admin';
            return next();
        }
    } catch (error) {
        logger.warn('Failed to decode admin credentials', { error: error.message });
    }

    res.setHeader('WWW-Authenticate', 'Basic realm="Admin Dashboard"');
    return res.status(401).json({
        error: {
            code: 'AUTH_INVALID',
            message: 'Invalid credentials'
        }
    });
}

// Apply basic auth to all admin routes
router.use(basicAuth);

/**
 * GET /admin - Serve the admin dashboard HTML page
 */
router.get('/', (req, res) => {
    const adminHtmlPath = path.join(__dirname, '../../public/admin.html');
    res.sendFile(adminHtmlPath, (err) => {
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
router.get('/api/stats', async (req, res) => {
    try {
        const memUsage = process.memoryUsage();
        const appMetrics = getAllMetrics();
        const httpRateLimitStats = getHttpRateLimitMetrics();

        // Get Redis health
        let redisStatus = { healthy: false, mode: 'unknown' };
        try {
            const healthy = await isRedisHealthy();
            const memoryMode = isUsingMemoryMode();
            redisStatus = {
                healthy,
                mode: memoryMode ? 'memory' : 'redis'
            };
        } catch (error) {
            redisStatus.error = error.message;
        }

        // Get Socket.io stats if available
        let socketStats = { connections: 0 };
        try {
            const app = req.app;
            const io = app.get('io');
            if (io) {
                const sockets = await io.fetchSockets();
                socketStats.connections = sockets.length;
            }
        } catch (error) {
            socketStats.error = error.message;
        }

        // Get room count
        let roomCount = 0;
        try {
            const redis = getRedis();
            // Count keys matching room:* pattern (excluding sub-keys like room:ABC:players)
            const roomKeys = await redis.keys('room:*');
            // Filter to only room codes (6 char alphanumeric after room:)
            roomCount = roomKeys.filter(key => /^room:[A-Z0-9]{4,8}$/.test(key)).length;
        } catch (error) {
            logger.warn('Failed to count rooms', { error: error.message });
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
            rateLimits: {
                http: httpRateLimitStats
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
        logger.error('Failed to fetch admin stats', { error: error.message });
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
router.get('/api/rooms', async (req, res) => {
    try {
        const redis = getRedis();
        const roomKeys = await redis.keys('room:*');

        // Filter to only room codes
        const validRoomKeys = roomKeys.filter(key => /^room:[A-Z0-9]{4,8}$/.test(key));

        const rooms = [];
        for (const key of validRoomKeys) {
            try {
                const roomData = await redis.get(key);
                if (roomData) {
                    const room = JSON.parse(roomData);
                    const code = key.replace('room:', '');

                    // Get player count
                    const playerKeys = await redis.sMembers(`room:${code}:players`);

                    rooms.push({
                        code: room.code,
                        status: room.status,
                        hasPassword: room.hasPassword || false,
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
                logger.warn(`Failed to parse room data for ${key}`, { error: parseError.message });
            }
        }

        // Sort by creation time (newest first)
        rooms.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

        res.json({
            count: rooms.length,
            rooms
        });
    } catch (error) {
        logger.error('Failed to list rooms', { error: error.message });
        res.status(500).json({
            error: {
                code: 'ROOMS_ERROR',
                message: 'Failed to list active rooms'
            }
        });
    }
});

/**
 * POST /admin/api/broadcast - Send broadcast message to all rooms
 */
router.post('/api/broadcast', async (req, res) => {
    try {
        const { message, type = 'info' } = req.body;

        if (!message || typeof message !== 'string' || message.trim().length === 0) {
            return res.status(400).json({
                error: {
                    code: 'INVALID_MESSAGE',
                    message: 'Broadcast message is required'
                }
            });
        }

        if (message.length > 500) {
            return res.status(400).json({
                error: {
                    code: 'MESSAGE_TOO_LONG',
                    message: 'Broadcast message must be 500 characters or less'
                }
            });
        }

        const validTypes = ['info', 'warning', 'error'];
        if (!validTypes.includes(type)) {
            return res.status(400).json({
                error: {
                    code: 'INVALID_TYPE',
                    message: `Type must be one of: ${validTypes.join(', ')}`
                }
            });
        }

        const app = req.app;
        const io = app.get('io');

        if (!io) {
            return res.status(503).json({
                error: {
                    code: 'SOCKET_UNAVAILABLE',
                    message: 'Socket.io is not available'
                }
            });
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

        res.json({
            success: true,
            message: 'Broadcast sent successfully'
        });
    } catch (error) {
        logger.error('Failed to send broadcast', { error: error.message });
        res.status(500).json({
            error: {
                code: 'BROADCAST_ERROR',
                message: 'Failed to send broadcast message'
            }
        });
    }
});

/**
 * DELETE /admin/api/rooms/:code - Force close a room
 */
router.delete('/api/rooms/:code', async (req, res) => {
    try {
        const { code } = req.params;

        // Validate room code format
        if (!/^[A-Z0-9]{4,8}$/i.test(code)) {
            return res.status(400).json({
                error: {
                    code: 'INVALID_ROOM_CODE',
                    message: 'Invalid room code format'
                }
            });
        }

        const normalizedCode = code.toUpperCase();
        const redis = getRedis();

        // Check if room exists
        const roomData = await redis.get(`room:${normalizedCode}`);
        if (!roomData) {
            return res.status(404).json({
                error: {
                    code: 'ROOM_NOT_FOUND',
                    message: 'Room not found'
                }
            });
        }

        // Notify all players in the room before closing
        const app = req.app;
        const io = app.get('io');
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

        res.json({
            success: true,
            message: `Room ${normalizedCode} has been closed`
        });
    } catch (error) {
        logger.error('Failed to close room', { error: error.message, code: req.params.code });
        res.status(500).json({
            error: {
                code: 'ROOM_CLOSE_ERROR',
                message: 'Failed to close room'
            }
        });
    }
});

/**
 * Format uptime seconds into human-readable string
 */
function formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);

    return parts.join(' ');
}

module.exports = router;
