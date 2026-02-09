/**
 * Health Routes Coverage Tests
 *
 * Tests for healthRoutes.ts to cover uncovered lines:
 * - GET /health/metrics - full path including Redis memory alerts
 * - GET /health/metrics/prometheus - error handling
 * - GET /health/ready - Redis not healthy, timeout, error paths
 * - withTimeout function - timeout triggering
 */

import request from 'supertest';
import express from 'express';

jest.mock('../utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));

const mockIsRedisHealthy = jest.fn().mockResolvedValue(true);
const mockIsUsingMemoryMode = jest.fn().mockReturnValue(true);
const mockGetRedisMemoryInfo = jest.fn().mockResolvedValue({
    mode: 'memory',
    used_memory: 0,
    used_memory_human: 'N/A',
    used_memory_peak: 0,
    used_memory_peak_human: 'N/A',
    maxmemory: 0,
    maxmemory_human: 'N/A',
    memory_usage_percent: 0,
    alert: null
});

jest.mock('../config/redis', () => ({
    isRedisHealthy: (...args: any[]) => mockIsRedisHealthy(...args),
    isUsingMemoryMode: (...args: any[]) => mockIsUsingMemoryMode(...args),
    getRedisMemoryInfo: (...args: any[]) => mockGetRedisMemoryInfo(...args)
}));

jest.mock('../utils/pubSubHealth', () => ({
    getHealth: jest.fn().mockReturnValue({
        isHealthy: true,
        totalPublishes: 100,
        totalFailures: 2,
        failureRate: 0.02,
        consecutiveFailures: 0,
        lastError: null
    })
}));

const mockGetPrometheusMetrics = jest.fn().mockReturnValue('# TYPE test_metric counter\ntest_metric 42\n');
const mockUpdateSystemMetrics = jest.fn();

jest.mock('../utils/metrics', () => ({
    getPrometheusMetrics: (...args: any[]) => mockGetPrometheusMetrics(...args),
    updateSystemMetrics: (...args: any[]) => mockUpdateSystemMetrics(...args)
}));

const logger = require('../utils/logger');

describe('Health Routes - Extended Coverage', () => {
    let app: express.Express;

    beforeEach(() => {
        jest.clearAllMocks();
        // Reset all mock implementations
        mockIsRedisHealthy.mockResolvedValue(true);
        mockIsUsingMemoryMode.mockReturnValue(true);
        mockGetRedisMemoryInfo.mockResolvedValue({
            mode: 'memory',
            used_memory: 0,
            used_memory_human: 'N/A',
            used_memory_peak: 0,
            used_memory_peak_human: 'N/A',
            maxmemory: 0,
            maxmemory_human: 'N/A',
            memory_usage_percent: 0,
            alert: null
        });
        mockGetPrometheusMetrics.mockReturnValue('# TYPE test_metric counter\ntest_metric 42\n');
        mockUpdateSystemMetrics.mockReturnValue(undefined);

        app = express();
        const healthRoutes = require('../routes/healthRoutes');
        app.use('/health', healthRoutes);
    });

    describe('GET /health', () => {
        it('should return 200 with status ok', async () => {
            const response = await request(app).get('/health');
            expect(response.status).toBe(200);
            expect(response.body.status).toBe('ok');
            expect(response.body.uptime).toBeDefined();
        });
    });

    describe('GET /health/live', () => {
        it('should return 200 with status live', async () => {
            const response = await request(app).get('/health/live');
            expect(response.status).toBe(200);
            expect(response.body.status).toBe('live');
        });
    });

    describe('GET /health/ready', () => {
        it('should return 200 when in memory mode', async () => {
            mockIsUsingMemoryMode.mockReturnValue(true);
            const response = await request(app).get('/health/ready');
            expect(response.status).toBe(200);
            expect(response.body.status).toBe('ready');
        });

        it('should return 200 when Redis is healthy', async () => {
            mockIsUsingMemoryMode.mockReturnValue(false);
            mockIsRedisHealthy.mockResolvedValue(true);

            const response = await request(app).get('/health/ready');
            expect(response.status).toBe(200);
        });

        it('should return 503 when Redis is not healthy', async () => {
            mockIsUsingMemoryMode.mockReturnValue(false);
            mockIsRedisHealthy.mockResolvedValue(false);

            const response = await request(app).get('/health/ready');
            expect(response.status).toBe(503);
            expect(response.body.status).toBe('degraded');
        });

        it('should return 503 when health check throws', async () => {
            mockIsUsingMemoryMode.mockReturnValue(false);
            mockIsRedisHealthy.mockRejectedValue(new Error('Redis check failed'));

            const response = await request(app).get('/health/ready');
            expect(response.status).toBe(503);
            expect(response.body.status).toBe('error');
        });

        it('should handle Redis health check timeout', async () => {
            mockIsUsingMemoryMode.mockReturnValue(false);
            mockIsRedisHealthy.mockImplementation(() =>
                new Promise((resolve) => setTimeout(() => resolve(true), 5000))
            );

            const response = await request(app).get('/health/ready');
            expect(response.status).toBe(503);
        });
    });

    describe('GET /health/metrics', () => {
        it('should return detailed metrics', async () => {
            const response = await request(app).get('/health/metrics');
            expect(response.status).toBe(200);
            expect(response.body.timestamp).toBeDefined();
            expect(response.body.memory).toBeDefined();
            expect(response.body.redis).toBeDefined();
            expect(response.body.process).toBeDefined();
        });

        it('should include alerts when Redis memory has warnings', async () => {
            mockGetRedisMemoryInfo.mockResolvedValue({
                mode: 'redis',
                used_memory: 500000000,
                used_memory_human: '500MB',
                used_memory_peak: 550000000,
                used_memory_peak_human: '550MB',
                maxmemory: 600000000,
                maxmemory_human: '600MB',
                memory_usage_percent: 83,
                alert: 'warning'
            });

            const response = await request(app).get('/health/metrics');
            expect(response.status).toBe(200);
            expect(response.body.alerts).toBeDefined();
            expect(response.body.alerts).toHaveLength(1);
            expect(response.body.alerts[0].type).toBe('redis_memory');
            expect(response.body.alerts[0].level).toBe('warning');
        });

        it('should handle metrics collection failure', async () => {
            mockGetRedisMemoryInfo.mockRejectedValue(new Error('Metrics failed'));

            const response = await request(app).get('/health/metrics');
            expect(response.status).toBe(500);
            expect(response.body.error).toBe('Failed to collect metrics');
        });
    });

    describe('GET /health/metrics/prometheus', () => {
        it('should return Prometheus-format metrics', async () => {
            const response = await request(app).get('/health/metrics/prometheus');
            expect(response.status).toBe(200);
            expect(response.headers['content-type']).toContain('text/plain');
            expect(response.text).toContain('test_metric');
        });

        it('should handle Prometheus export failure', async () => {
            mockGetPrometheusMetrics.mockImplementation(() => {
                throw new Error('Export failed');
            });

            const response = await request(app).get('/health/metrics/prometheus');
            expect(response.status).toBe(500);
            expect(response.text).toContain('Error exporting metrics');
        });
    });
});
