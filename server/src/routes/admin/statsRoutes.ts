/**
 * Admin Stats Routes - Server statistics and SSE metrics stream
 */

import type { Request, Response, Router as ExpressRouter, Application } from 'express';
import type { Server } from 'socket.io';
import type { RedisClient } from '../../types';

import express from 'express';
import logger from '../../utils/logger';
import { getRedis, isRedisHealthy, isUsingMemoryMode } from '../../config/redis';
import { isDatabaseEnabled } from '../../config/database';
import { getAllMetrics } from '../../utils/metrics';

interface AdminRequest extends Request {
    adminUsername?: string;
    app: Application & {
        get(key: 'io'): Server | undefined;
    };
}

const router: ExpressRouter = express.Router();

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
export function formatUptime(seconds: number): string {
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
