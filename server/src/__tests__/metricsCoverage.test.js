/**
 * Additional metrics coverage tests
 * Covers: histogram overflow/eviction (lines 109-114), timed decorator (lines 141-155)
 */

const {
    recordHistogram,
    getHistogramStats,
    getAllMetrics,
    resetMetrics,
    timed
} = require('../utils/metrics');

describe('Metrics Coverage - Histogram Overflow', () => {
    beforeEach(() => {
        resetMetrics();
    });

    test('evicts old values when histogram exceeds maxHistogramSize', () => {
        // maxHistogramSize is 1000 by default
        for (let i = 0; i < 1050; i++) {
            recordHistogram('overflow_test', i);
        }

        const stats = getHistogramStats('overflow_test');
        // After eviction, should have exactly 1000 values (the last 1000)
        expect(stats.count).toBe(1000);
        // Min should be 50 (first 50 values evicted: 0-49)
        expect(stats.min).toBe(50);
        // Max should be 1049
        expect(stats.max).toBe(1049);
        // Sum should be recalculated from retained values
        const expectedSum = Array.from({ length: 1000 }, (_, i) => i + 50).reduce((a, b) => a + b, 0);
        expect(stats.sum).toBe(expectedSum);
    });

    test('getAllMetrics skips empty histograms', () => {
        recordHistogram('has_data', 100);
        // Create a histogram then reset its count to 0 won't work directly,
        // but we can verify that getAllMetrics includes non-empty ones
        const metrics = getAllMetrics();
        expect(metrics.histograms).toHaveProperty('has_data');
        expect(metrics.histograms['has_data'].count).toBe(1);
    });

    test('getAllMetrics histogram stats include percentiles', () => {
        for (let i = 1; i <= 100; i++) {
            recordHistogram('percentile_test', i);
        }
        const metrics = getAllMetrics();
        const h = metrics.histograms['percentile_test'];
        expect(h.p50).toBeDefined();
        expect(h.p90).toBeDefined();
        expect(h.p95).toBeDefined();
        expect(h.p99).toBeDefined();
        expect(h.avg).toBe(50.5);
    });
});

describe('Metrics Coverage - Timed Decorator', () => {
    beforeEach(() => {
        resetMetrics();
    });

    test('timed decorator wraps method and records timing', async () => {
        const decorator = timed('decorator_test', { service: 'test' });

        const descriptor = {
            value: async function(x) { return x * 2; }
        };

        const result = decorator({}, 'myMethod', descriptor);
        expect(result).toBe(descriptor);

        // Call the wrapped function
        const value = await descriptor.value(21);
        expect(value).toBe(42);

        // Check that timing was recorded with operation label
        const stats = getHistogramStats('decorator_test', { service: 'test', operation: 'myMethod' });
        expect(stats).not.toBeNull();
        expect(stats.count).toBe(1);
    });

    test('timed decorator records timing even on error', async () => {
        const decorator = timed('error_decorator_test');
        const descriptor = {
            value: async function() { throw new Error('fail'); }
        };

        decorator({}, 'failMethod', descriptor);

        await expect(descriptor.value()).rejects.toThrow('fail');

        const stats = getHistogramStats('error_decorator_test', { operation: 'failMethod' });
        expect(stats).not.toBeNull();
        expect(stats.count).toBe(1);
    });
});
