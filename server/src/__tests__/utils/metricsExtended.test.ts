/**
 * Extended Metrics Tests
 *
 * Tests for utils/metrics.js - covers system monitoring
 * and Prometheus export functionality.
 */

const {
    incrementCounter,
    setGauge,
    _incrementGauge,
    recordHistogram,
    getHistogramStats,
    getAllMetrics,
    resetMetrics,
    getPrometheusMetrics,
    updateSystemMetrics,
    METRIC_NAMES,
} = require('../../utils/metrics');

describe('Metrics Extended Tests', () => {
    beforeEach(() => {
        resetMetrics();
    });

    describe('Core counter operations', () => {
        it('should track different labels separately', () => {
            incrementCounter('requests', 1, { method: 'GET' });
            incrementCounter('requests', 1, { method: 'POST' });
            incrementCounter('requests', 1, { method: 'GET' });

            const metrics = getAllMetrics();
            expect(metrics.counters['requests:method=GET'].value).toBe(2);
            expect(metrics.counters['requests:method=POST'].value).toBe(1);
        });
    });

    describe('Histogram operations', () => {
        it('should limit histogram size to maxHistogramSize', () => {
            // Record more than maxHistogramSize (1000) values
            for (let i = 0; i < 1100; i++) {
                recordHistogram('large_histogram', i);
            }

            const stats = getHistogramStats('large_histogram');
            expect(stats.count).toBe(1000); // Limited to max size
        });
    });

    describe('updateSystemMetrics()', () => {
        it('should record memory metrics', () => {
            updateSystemMetrics();

            const metrics = getAllMetrics();
            expect(metrics.gauges[METRIC_NAMES.MEMORY_HEAP_USED]).toBeDefined();
            expect(metrics.gauges[METRIC_NAMES.MEMORY_HEAP_TOTAL]).toBeDefined();
            expect(metrics.gauges[METRIC_NAMES.MEMORY_RSS]).toBeDefined();
            expect(metrics.gauges[METRIC_NAMES.MEMORY_HEAP_USED].value).toBeGreaterThan(0);
        });
    });

    describe('getPrometheusMetrics()', () => {
        it('should export counters in Prometheus format', () => {
            incrementCounter('http_requests', 100, { method: 'GET', status: '200' });

            const output = getPrometheusMetrics();

            expect(output).toContain('# TYPE http_requests counter');
            expect(output).toContain('http_requests{method="GET",status="200"}');
            expect(output).toContain('100');
        });

        it('should export gauges in Prometheus format', () => {
            setGauge('active_connections', 42);

            const output = getPrometheusMetrics();

            expect(output).toContain('# TYPE active_connections gauge');
            expect(output).toContain('active_connections 42');
        });

        it('should export histograms as summaries in Prometheus format', () => {
            for (let i = 1; i <= 10; i++) {
                recordHistogram('request_duration', i * 10);
            }

            const output = getPrometheusMetrics();

            expect(output).toContain('# TYPE request_duration summary');
            expect(output).toContain('request_duration_count');
            expect(output).toContain('request_duration_sum');
            expect(output).toContain('quantile="0.5"');
            expect(output).toContain('quantile="0.9"');
            expect(output).toContain('quantile="0.99"');
        });

        it('should handle empty metrics', () => {
            const output = getPrometheusMetrics();
            expect(output).toBe('');
        });

        it('should escape special characters in labels', () => {
            incrementCounter('test', 1, { path: '/api/rooms/:code' });

            const output = getPrometheusMetrics();
            expect(output).toContain('path="/api/rooms/:code"');
        });

        it('should replace invalid characters in metric names', () => {
            incrementCounter('my.metric-name', 1);

            const output = getPrometheusMetrics();
            expect(output).toContain('my_metric_name');
        });

        it('should skip empty histograms', () => {
            // Record then reset
            recordHistogram('temp', 100);
            resetMetrics();

            const output = getPrometheusMetrics();
            expect(output).not.toContain('temp');
        });
    });

    describe('Phase 5.1 tracking functions', () => {
        it('should track HTTP requests', () => {
            incrementCounter(METRIC_NAMES.HTTP_REQUESTS, 1, { method: 'GET', path: '/api/rooms', statusCode: '200' });
            incrementCounter(METRIC_NAMES.HTTP_REQUESTS, 1, { method: 'POST', path: '/api/rooms', statusCode: '201' });

            const metrics = getAllMetrics();
            expect(metrics.counters['http_requests_total:method=GET,path=/api/rooms,statusCode=200'].value).toBe(1);
            expect(metrics.counters['http_requests_total:method=POST,path=/api/rooms,statusCode=201'].value).toBe(1);
        });

        it('should track websocket events', () => {
            incrementCounter(METRIC_NAMES.WEBSOCKET_EVENTS, 1, { event: 'room:join', direction: 'in' });
            incrementCounter(METRIC_NAMES.WEBSOCKET_EVENTS, 1, { event: 'room:joined', direction: 'out' });

            const metrics = getAllMetrics();
            expect(metrics.counters['websocket_events_total:direction=in,event=room:join'].value).toBe(1);
            expect(metrics.counters['websocket_events_total:direction=out,event=room:joined'].value).toBe(1);
        });

        it('should track reconnections', () => {
            incrementCounter(METRIC_NAMES.RECONNECTIONS, 1, { roomCode: 'ROOM06', success: 'true' });
            incrementCounter(METRIC_NAMES.RECONNECTIONS, 1, { roomCode: 'ROOM06', success: 'false' });

            const metrics = getAllMetrics();
            expect(metrics.counters['reconnections_total:roomCode=ROOM06,success=true'].value).toBe(1);
            expect(metrics.counters['reconnections_total:roomCode=ROOM06,success=false'].value).toBe(1);
        });

        it('should track player kicks', () => {
            incrementCounter(METRIC_NAMES.PLAYER_KICKS, 1, { roomCode: 'ROOM07', reason: 'admin' });

            const metrics = getAllMetrics();
            expect(metrics.counters['player_kicks_total:reason=admin,roomCode=ROOM07'].value).toBe(1);
        });

        it('should track broadcasts', () => {
            incrementCounter(METRIC_NAMES.BROADCASTS_SENT, 1, { type: 'announcement' });

            const metrics = getAllMetrics();
            expect(metrics.counters['broadcasts_sent_total:type=announcement'].value).toBe(1);
        });

        it('should track HTTP request duration', () => {
            recordHistogram(METRIC_NAMES.HTTP_REQUEST_DURATION, 5, { method: 'GET', path: '/health' });

            const stats = getHistogramStats('http_request_duration_ms', { method: 'GET', path: '/health' });
            expect(stats.count).toBe(1);
        });

        it('should track websocket message size', () => {
            recordHistogram(METRIC_NAMES.WEBSOCKET_MESSAGE_SIZE, 1024, { event: 'game:state' });

            const stats = getHistogramStats('websocket_message_size_bytes', { event: 'game:state' });
            expect(stats.count).toBe(1);
            expect(stats.avg).toBe(1024);
        });

        it('should set spectator count', () => {
            setGauge(METRIC_NAMES.SPECTATORS, 10);

            const metrics = getAllMetrics();
            expect(metrics.gauges['spectators_total'].value).toBe(10);
        });
    });

    describe('getAllMetrics()', () => {
        it('should skip empty histograms in export', () => {
            // This should not appear in export
            const metrics = getAllMetrics();
            expect(Object.keys(metrics.histograms).length).toBe(0);
        });
    });

});
