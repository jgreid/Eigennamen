/**
 * Health Check Routes
 *
 * Provides endpoints for health monitoring, readiness checks, and metrics.
 * Designed for Kubernetes liveness/readiness probes and monitoring systems.
 */

import type { Request, Response, Router as ExpressRouter } from 'express';

const express = require('express');
const { isRedisHealthy, isUsingMemoryMode, getRedisMemoryInfo } = require('../config/redis');
const pubSubHealth = require('../utils/pubSubHealth');
const logger = require('../utils/logger');
// PHASE 5.1: Import Prometheus metrics export
const { getPrometheusMetrics, updateSystemMetrics } = require('../utils/metrics');

const router: ExpressRouter = express.Router();

// Track server start time for uptime calculation
const serverStartTime: number = Date.now();

// Health check timeout (prevents hanging if Redis is slow)
const HEALTH_CHECK_TIMEOUT_MS = 3000;

/**
 * Redis memory info
 */
interface RedisMemoryInfo {
    used_memory_human?: string;
    maxmemory_human?: string;
    memory_usage_percent?: number;
    alert?: string;
}

/**
 * Health check result
 */
interface HealthCheck {
    healthy: boolean;
    mode?: string;
    status?: string;
    consecutiveFailures?: number;
    lastError?: string | null;
    error?: string;
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
        memory: RedisMemoryInfo;
    };
    pubsub: {
        healthy: boolean;
        totalPublishes: number;
        totalFailures: number;
        failureRate: number;
        consecutiveFailures: number;
    };
    process: {
        pid: number;
        nodeVersion: string;
        platform: string;
    };
    alerts?: Array<{
        type: string;
        level: string;
        message: string;
        details: Record<string, unknown>;
    }>;
}

/**
 * Wrap a promise with a timeout
 */
async function withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    operation: string
): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
            reject(new Error(`${operation} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
    });

    try {
        const result = await Promise.race([promise, timeoutPromise]);
        if (timeoutId !== undefined) clearTimeout(timeoutId);
        return result;
    } catch (error) {
        if (timeoutId !== undefined) clearTimeout(timeoutId);
        throw error;
    }
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
                consecutiveFailures: pubSubStatus.consecutiveFailures,
                lastError: pubSubStatus.lastError
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
            error: (error as Error).message,
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
                memory: redisMemory
            },
            pubsub: {
                healthy: pubSubStatus.isHealthy,
                totalPublishes: pubSubStatus.totalPublishes,
                totalFailures: pubSubStatus.totalFailures,
                failureRate: pubSubStatus.failureRate,
                consecutiveFailures: pubSubStatus.consecutiveFailures
            },
            process: {
                pid: process.pid,
                nodeVersion: process.version,
                platform: process.platform
            }
        };

        // Add alert status at top level if Redis memory is concerning
        if (redisMemory.alert) {
            metrics.alerts = metrics.alerts || [];
            metrics.alerts.push({
                type: 'redis_memory',
                level: redisMemory.alert,
                message: `Redis memory usage at ${redisMemory.memory_usage_percent}%`,
                details: {
                    used: redisMemory.used_memory_human,
                    max: redisMemory.maxmemory_human
                }
            });
        }

        res.json(metrics);
    } catch (error) {
        logger.error('Metrics collection failed:', error);
        res.status(500).json({
            error: 'Failed to collect metrics',
            message: (error as Error).message
        });
    }
});

/**
 * PHASE 5.1: Prometheus-compatible metrics endpoint
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

module.exports = router;
export default router;
