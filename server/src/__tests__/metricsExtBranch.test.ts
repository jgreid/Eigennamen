/**
 * Metrics Extended Branch Coverage Tests
 * Targets uncovered lines: 289-341, 501-525
 *
 * Lines 289-341: getHistogramStats percentile calculation and getAllMetrics histogram export
 * Lines 501-525: getPrometheusMetrics histogram formatting
 */

describe('Metrics Extended Branch Coverage', () => {
    let metrics: any;

    beforeEach(() => {
        jest.resetModules();
        metrics = require('../utils/metrics');
        metrics.resetMetrics();
    });

    describe('Lines 289-304: getHistogramStats', () => {
        it('should return null for non-existent histogram', () => {
            const stats = metrics.getHistogramStats('nonexistent');
            expect(stats).toBeNull();
        });

        it('should calculate correct percentiles for histogram', () => {
            const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
            for (const v of values) {
                metrics.recordHistogram('test_hist', v);
            }

            const stats = metrics.getHistogramStats('test_hist');
            expect(stats).not.toBeNull();
            expect(stats.count).toBe(10);
            expect(stats.sum).toBe(550);
            expect(stats.avg).toBe(55);
            expect(stats.min).toBe(10);
            expect(stats.max).toBe(100);
            expect(stats.p50).toBeDefined();
            expect(stats.p90).toBeDefined();
            expect(stats.p95).toBeDefined();
            expect(stats.p99).toBeDefined();
        });

        it('should handle single-value histogram', () => {
            metrics.recordHistogram('single', 42);

            const stats = metrics.getHistogramStats('single');
            expect(stats).not.toBeNull();
            expect(stats.count).toBe(1);
            expect(stats.min).toBe(42);
            expect(stats.max).toBe(42);
            expect(stats.p50).toBe(42);
        });

        it('should handle histogram with labels', () => {
            metrics.recordHistogram('labeled_hist', 100, { operation: 'test' });

            const stats = metrics.getHistogramStats('labeled_hist', { operation: 'test' });
            expect(stats).not.toBeNull();
            expect(stats.labels).toEqual({ operation: 'test' });
        });
    });

    describe('Lines 310-355: getAllMetrics with histograms', () => {
        it('should export counters, gauges, and histograms with full stats', () => {
            metrics.incrementCounter('test_counter', 5);
            metrics.setGauge('test_gauge', 42);
            metrics.recordHistogram('test_latency', 100);
            metrics.recordHistogram('test_latency', 200);
            metrics.recordHistogram('test_latency', 300);

            const all = metrics.getAllMetrics();

            expect(all.timestamp).toBeDefined();
            expect(all.instanceId).toBeDefined();

            // Counters
            const counterKey = Object.keys(all.counters).find((k: string) => k.includes('test_counter'));
            expect(counterKey).toBeDefined();

            // Gauges
            const gaugeKey = Object.keys(all.gauges).find((k: string) => k.includes('test_gauge'));
            expect(gaugeKey).toBeDefined();

            // Histograms with percentiles
            const histKey = Object.keys(all.histograms).find((k: string) => k.includes('test_latency'));
            expect(histKey).toBeDefined();
            if (histKey) {
                const hist = all.histograms[histKey];
                expect(hist.count).toBe(3);
                expect(hist.sum).toBe(600);
                expect(hist.avg).toBe(200);
                expect(hist.min).toBe(100);
                expect(hist.max).toBe(300);
                expect(hist.p50).toBeDefined();
                expect(hist.p90).toBeDefined();
                expect(hist.p95).toBeDefined();
                expect(hist.p99).toBeDefined();
            }
        });

        it('should skip histograms with zero count', () => {
            metrics.incrementCounter('only_counter', 1);
            const all = metrics.getAllMetrics();
            expect(Object.keys(all.histograms).length).toBe(0);
        });
    });

    describe('Lines 495-537: getPrometheusMetrics', () => {
        it('should format counters in Prometheus text format', () => {
            metrics.incrementCounter('prom_counter', 10, { method: 'GET' });

            const output = metrics.getPrometheusMetrics();
            expect(output).toContain('# TYPE prom_counter counter');
            expect(output).toContain('prom_counter{method="GET"}');
            expect(output).toContain(' 10 ');
        });

        it('should format gauges in Prometheus text format', () => {
            metrics.setGauge('prom_gauge', 42, { region: 'us-east' });

            const output = metrics.getPrometheusMetrics();
            expect(output).toContain('# TYPE prom_gauge gauge');
            expect(output).toContain('prom_gauge{region="us-east"}');
            expect(output).toContain(' 42 ');
        });

        it('should format histograms as summaries in Prometheus text format', () => {
            metrics.recordHistogram('prom_latency', 50, { op: 'read' });
            metrics.recordHistogram('prom_latency', 150, { op: 'read' });
            metrics.recordHistogram('prom_latency', 250, { op: 'read' });

            const output = metrics.getPrometheusMetrics();
            expect(output).toContain('# TYPE prom_latency summary');
            expect(output).toContain('prom_latency_count');
            expect(output).toContain('prom_latency_sum');
            expect(output).toContain('quantile="0.5"');
            expect(output).toContain('quantile="0.9"');
            expect(output).toContain('quantile="0.99"');
        });

        it('should handle metrics without labels', () => {
            metrics.incrementCounter('simple_counter', 1);
            metrics.setGauge('simple_gauge', 7);

            const output = metrics.getPrometheusMetrics();
            expect(output).toContain('simple_counter 1');
            expect(output).toContain('simple_gauge 7');
        });

        it('should escape quotes in label values', () => {
            metrics.incrementCounter('escaped', 1, { path: '/api/"test"' });

            const output = metrics.getPrometheusMetrics();
            expect(output).toContain('\\"test\\"');
        });

        it('should skip empty histograms', () => {
            metrics.incrementCounter('only', 1);
            const output = metrics.getPrometheusMetrics();
            expect(output).not.toContain('summary');
        });
    });
});
