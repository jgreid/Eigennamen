import type { Request, Response, Router as ExpressRouter } from 'express';

import express from 'express';
import { isRedisHealthy, isUsingMemoryMode, getRedisMemoryInfo } from '../config/redis';
import type { RedisMemoryInfo } from '../config/redis';
import * as pubSubHealth from '../utils/pubSubHealth';
import logger from '../utils/logger';
// Import Prometheus metrics export
import { getPrometheusMetrics, updateSystemMetrics } from '../utils/metrics';
import { withTimeout } from '../utils/timeout';

const router: ExpressRouter = express.Router();

// Track server start time for uptime calculation
const serverStartTime: number = Date.now();

// Health check timeout (prevents hanging if Redis is slow)
const HEALTH_CHECK_TIMEOUT_MS = 3000;

/**
 * Health check result
 */
interface HealthCheck {
    healthy: boolean;
    mode?: string;
    status?: string;
    consecutiveFailures?: number;
}

/**
 * Metrics response
 */
interface MetricsResponse {
    timestamp: string;
    uptime: {
        seconds: number;
        startTime: string;
    };
    memory: {
        heapUsed: string;
        heapTotal: string;
        rss: string;
        external: string;
    };
    redis: {
        mode: string;
        healthy: boolean;
        memory?: RedisMemoryInfo;
    };
    pubsub: {
        healthy: boolean;
        totalPublishes?: number;
        totalFailures?: number;
        failureRate?: string;
        consecutiveFailures?: number;
    };
    process?: {
        pid: number;
        nodeVersion: string;
        platform: string;
    };
    alerts?: Array<{
        type: string;
        level: string;
        message: string;
        details?: Record<string, unknown>;
    }>;
}

/**
 * Basic health check - always returns 200 if server is running
 * Used for basic availability monitoring
 */
router.get('/', (_req: Request, res: Response) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: Math.floor((Date.now() - serverStartTime) / 1000)
    });
});

/**
 * Readiness check - checks all dependencies
 * Returns 503 if any critical dependency is unhealthy
 * Used by load balancers to determine if instance should receive traffic
 */
router.get('/ready', async (_req: Request, res: Response) => {
    const checks: { redis: HealthCheck; pubsub: HealthCheck } = {
        redis: { healthy: false, mode: 'unknown' },
        pubsub: { healthy: true, status: 'not_applicable' }
    };

    try {
        // Check Redis connection with timeout protection
        if (isUsingMemoryMode()) {
            checks.redis = { healthy: true, mode: 'memory' };
            checks.pubsub = { healthy: true, status: 'memory_mode' };
        } else {
            const redisHealthy: boolean = await withTimeout(
                isRedisHealthy(),
                HEALTH_CHECK_TIMEOUT_MS,
                'Redis health check'
            );
            checks.redis = { healthy: redisHealthy, mode: 'redis' };

            // Check pub/sub health
            const pubSubStatus = pubSubHealth.getHealth();
            checks.pubsub = {
                healthy: pubSubStatus.isHealthy,
                status: pubSubStatus.isHealthy ? 'connected' : 'degraded',
                consecutiveFailures: pubSubStatus.consecutiveFailures
            };
        }

        // Determine overall health
        const allHealthy = checks.redis.healthy && checks.pubsub.healthy;
        const status = allHealthy ? 'ready' : 'degraded';
        const statusCode = allHealthy ? 200 : 503;

        res.status(statusCode).json({
            status,
            timestamp: new Date().toISOString(),
            checks
        });
    } catch (error) {
        logger.error('Health check failed:', error);
        res.status(503).json({
            status: 'error',
            timestamp: new Date().toISOString(),
            error: 'Health check failed',
            checks
        });
    }
});

/**
 * Liveness check - returns 200 if the process is running
 * Used by Kubernetes to determine if the container should be restarted
 * Minimal check - just confirms the event loop is responding
 */
router.get('/live', (_req: Request, res: Response) => {
    res.json({
        status: 'live',
        timestamp: new Date().toISOString()
    });
});

/**
 * Detailed health metrics - for monitoring dashboards
 * Returns comprehensive system information
 */
router.get('/metrics', async (_req: Request, res: Response) => {
    try {
        const memUsage = process.memoryUsage();
        const pubSubStatus = pubSubHealth.getHealth();

        // Get Redis memory info for monitoring
        const redisMemory: RedisMemoryInfo = await withTimeout(
            getRedisMemoryInfo(),
            HEALTH_CHECK_TIMEOUT_MS,
            'Redis memory check'
        );

        const isProduction = process.env.NODE_ENV === 'production';

        const metrics: MetricsResponse = {
            timestamp: new Date().toISOString(),
            uptime: {
                seconds: Math.floor((Date.now() - serverStartTime) / 1000),
                startTime: new Date(serverStartTime).toISOString()
            },
            memory: {
                heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + 'MB',
                heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024) + 'MB',
                rss: Math.round(memUsage.rss / 1024 / 1024) + 'MB',
                external: Math.round(memUsage.external / 1024 / 1024) + 'MB'
            },
            redis: {
                mode: isUsingMemoryMode() ? 'memory' : 'redis',
                healthy: await withTimeout(isRedisHealthy(), HEALTH_CHECK_TIMEOUT_MS, 'Redis health check'),
                // Only expose Redis memory details outside production
                ...(isProduction ? {} : { memory: redisMemory })
            },
            pubsub: {
                healthy: pubSubStatus.isHealthy,
                // Only expose pubsub counters outside production
                ...(isProduction ? {} : {
                    totalPublishes: pubSubStatus.totalPublishes,
                    totalFailures: pubSubStatus.totalFailures,
                    failureRate: pubSubStatus.failureRate,
                    consecutiveFailures: pubSubStatus.consecutiveFailures
                })
            }
        };

        // Only expose process details (PID, Node version, platform) outside production
        // to prevent fingerprinting attacks
        if (!isProduction) {
            metrics.process = {
                pid: process.pid,
                nodeVersion: process.version,
                platform: process.platform
            };
        }

        // Add alert status at top level if Redis memory is concerning
        // Only expose details outside production
        if (redisMemory.alert) {
            metrics.alerts = metrics.alerts || [];
            metrics.alerts.push({
                type: 'redis_memory',
                level: redisMemory.alert,
                message: `Redis memory usage at ${redisMemory.memory_usage_percent}%`,
                ...(isProduction ? {} : {
                    details: {
                        used: redisMemory.used_memory_human,
                        max: redisMemory.maxmemory_human
                    }
                })
            });
        }

        res.json(metrics);
    } catch (error) {
        logger.error('Metrics collection failed:', error);
        res.status(500).json({
            error: 'Failed to collect metrics'
        });
    }
});

/**
 * Prometheus-compatible metrics endpoint
 * Returns metrics in Prometheus text exposition format
 */
router.get('/metrics/prometheus', (_req: Request, res: Response) => {
    try {
        // Update system metrics before export
        updateSystemMetrics();

        const prometheusText: string = getPrometheusMetrics();
        res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
        res.send(prometheusText);
    } catch (error) {
        logger.error('Prometheus metrics export failed:', error);
        res.status(500).send('# Error exporting metrics\n');
    }
});

export default router;

// CommonJS compat
module.exports = router;
module.exports.default = router;
