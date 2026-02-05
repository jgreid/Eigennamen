/**
 * Health Check Routes
 *
 * Provides endpoints for health monitoring, readiness checks, and metrics.
 * Designed for Kubernetes liveness/readiness probes and monitoring systems.
 */

const express = require('express');
const { isRedisHealthy, isUsingMemoryMode } = require('../config/redis');
const pubSubHealth = require('../utils/pubSubHealth');
const logger = require('../utils/logger');
// PHASE 5.1: Import Prometheus metrics export
const { getPrometheusMetrics, updateSystemMetrics } = require('../utils/metrics');

const router = express.Router();

// Track server start time for uptime calculation
const serverStartTime = Date.now();

// Health check timeout (prevents hanging if Redis is slow)
const HEALTH_CHECK_TIMEOUT_MS = 3000;

/**
 * Wrap a promise with a timeout
 * @param {Promise} promise - The promise to wrap
 * @param {number} timeoutMs - Timeout in milliseconds
 * @param {string} operation - Operation name for error message
 * @returns {Promise} - Resolves with result or rejects on timeout
 */
async function withTimeout(promise, timeoutMs, operation) {
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
            reject(new Error(`${operation} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
    });

    try {
        const result = await Promise.race([promise, timeoutPromise]);
        clearTimeout(timeoutId);
        return result;
    } catch (error) {
        clearTimeout(timeoutId);
        throw error;
    }
}

/**
 * Basic health check - always returns 200 if server is running
 * Used for basic availability monitoring
 */
router.get('/', (req, res) => {
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
router.get('/ready', async (req, res) => {
    const checks = {
        redis: { healthy: false, mode: 'unknown' },
        pubsub: { healthy: true, status: 'not_applicable' }
    };

    try {
        // Check Redis connection with timeout protection
        if (isUsingMemoryMode()) {
            checks.redis = { healthy: true, mode: 'memory' };
            checks.pubsub = { healthy: true, status: 'memory_mode' };
        } else {
            const redisHealthy = await withTimeout(
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
            error: error.message,
            checks
        });
    }
});

/**
 * Liveness check - returns 200 if the process is running
 * Used by Kubernetes to determine if the container should be restarted
 * Minimal check - just confirms the event loop is responding
 */
router.get('/live', (req, res) => {
    res.json({
        status: 'live',
        timestamp: new Date().toISOString()
    });
});

/**
 * Detailed health metrics - for monitoring dashboards
 * Returns comprehensive system information
 */
router.get('/metrics', async (req, res) => {
    try {
        const memUsage = process.memoryUsage();
        const pubSubStatus = pubSubHealth.getHealth();

        const metrics = {
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
                healthy: await withTimeout(isRedisHealthy(), HEALTH_CHECK_TIMEOUT_MS, 'Redis health check')
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

        res.json(metrics);
    } catch (error) {
        logger.error('Metrics collection failed:', error);
        res.status(500).json({
            error: 'Failed to collect metrics',
            message: error.message
        });
    }
});

/**
 * PHASE 5.1: Prometheus-compatible metrics endpoint
 * Returns metrics in Prometheus text exposition format
 */
router.get('/metrics/prometheus', (req, res) => {
    try {
        // Update system metrics before export
        updateSystemMetrics();

        const prometheusText = getPrometheusMetrics();
        res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
        res.send(prometheusText);
    } catch (error) {
        logger.error('Prometheus metrics export failed:', error);
        res.status(500).send('# Error exporting metrics\n');
    }
});

module.exports = router;
