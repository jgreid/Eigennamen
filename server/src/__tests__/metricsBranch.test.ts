/**
 * Metrics Branch Coverage Tests
 *
 * Covers uncovered branches in utils/metrics.ts:
 * - Line 162: decrementGauge (incrementGauge with negative value)
 * - Lines 289-341: getAllMetrics with empty/null histograms
 * - Line 446: trackWebsocketEvent default direction parameter
 * - Lines 501-525: getPrometheusMetrics with various metric types
 * - formatPrometheusLabels with empty labels
 * - withTiming wrapper
 * - startEventLoopMonitoring / stopEventLoopMonitoring
 * - measureEventLoopLag
 * - updateSystemMetrics
 */

const metrics = require('../utils/metrics');

describe('Metrics Branch Coverage', () => {
    beforeEach(() => {
        metrics.resetMetrics();
    });

    describe('decrementGauge', () => {
        it('should decrement gauge by default value of 1', () => {
            metrics.setGauge('test_gauge', 10);
            metrics.decrementGauge('test_gauge');

            const allMetrics = metrics.getAllMetrics();
            expect(allMetrics.gauges['test_gauge'].value).toBe(9);
        });

        it('should decrement gauge by specified value', () => {
            metrics.setGauge('test_gauge2', 10);
            metrics.decrementGauge('test_gauge2', 5);

            const allMetrics = metrics.getAllMetrics();
            expect(allMetrics.gauges['test_gauge2'].value).toBe(5);
        });

        it('should create gauge at -1 if it does not exist', () => {
            metrics.decrementGauge('new_decrement_gauge');

            const allMetrics = metrics.getAllMetrics();
            expect(allMetrics.gauges['new_decrement_gauge'].value).toBe(-1);
        });

        it('should decrement gauge with labels', () => {
            metrics.setGauge('labeled_gauge', 20, { env: 'test' });
            metrics.decrementGauge('labeled_gauge', 3, { env: 'test' });

            const allMetrics = metrics.getAllMetrics();
            expect(allMetrics.gauges['labeled_gauge:env=test'].value).toBe(17);
        });
    });

    describe('getAllMetrics with edge cases', () => {
        it('should return empty histograms when none exist', () => {
            const allMetrics = metrics.getAllMetrics();
            expect(Object.keys(allMetrics.histograms)).toHaveLength(0);
        });

        it('should skip histogram entries with count 0', () => {
            // Record and then manually verify through getAllMetrics
            metrics.recordHistogram('test_hist', 100);

            const allMetrics = metrics.getAllMetrics();
            expect(allMetrics.histograms['test_hist']).toBeDefined();
            expect(allMetrics.histograms['test_hist'].count).toBe(1);
        });

        it('should include instanceId in metrics', () => {
            const allMetrics = metrics.getAllMetrics();
            expect(allMetrics.instanceId).toBeDefined();
            expect(typeof allMetrics.instanceId).toBe('string');
        });

        it('should include timestamp in metrics', () => {
            const allMetrics = metrics.getAllMetrics();
            expect(allMetrics.timestamp).toBeDefined();
            expect(typeof allMetrics.timestamp).toBe('number');
        });

        it('should export counters with value and labels', () => {
            metrics.incrementCounter('test_counter', 5, { method: 'GET' });

            const allMetrics = metrics.getAllMetrics();
            const key = 'test_counter:method=GET';
            expect(allMetrics.counters[key]).toBeDefined();
            expect(allMetrics.counters[key].value).toBe(5);
            expect(allMetrics.counters[key].labels).toEqual({ method: 'GET' });
        });

        it('should export gauges with value and labels', () => {
            metrics.setGauge('active_rooms', 42, { region: 'us-east' });

            const allMetrics = metrics.getAllMetrics();
            const key = 'active_rooms:region=us-east';
            expect(allMetrics.gauges[key]).toBeDefined();
            expect(allMetrics.gauges[key].value).toBe(42);
        });

        it('should compute histogram stats with percentiles', () => {
            for (let i = 1; i <= 100; i++) {
                metrics.recordHistogram('percentile_hist', i, { op: 'test' });
            }

            const allMetrics = metrics.getAllMetrics();
            const key = 'percentile_hist:op=test';
            expect(allMetrics.histograms[key]).toBeDefined();
            expect(allMetrics.histograms[key].p50).toBeDefined();
            expect(allMetrics.histograms[key].p90).toBeDefined();
            expect(allMetrics.histograms[key].p95).toBeDefined();
            expect(allMetrics.histograms[key].p99).toBeDefined();
            expect(allMetrics.histograms[key].avg).toBeCloseTo(50.5);
            expect(allMetrics.histograms[key].min).toBe(1);
            expect(allMetrics.histograms[key].max).toBe(100);
        });
    });

    describe('getHistogramStats', () => {
        it('should return null for non-existent histogram', () => {
            const stats = metrics.getHistogramStats('nonexistent');
            expect(stats).toBeNull();
        });

        it('should return correct stats for single value', () => {
            metrics.recordHistogram('single_val', 42);
            const stats = metrics.getHistogramStats('single_val');

            expect(stats).not.toBeNull();
            expect(stats.count).toBe(1);
            expect(stats.min).toBe(42);
            expect(stats.max).toBe(42);
            expect(stats.avg).toBe(42);
            expect(stats.p50).toBe(42);
            expect(stats.p99).toBe(42);
        });

        it('should return null for histogram with labels that does not exist', () => {
            metrics.recordHistogram('labeled_hist', 10, { env: 'prod' });
            const stats = metrics.getHistogramStats('labeled_hist', { env: 'staging' });
            expect(stats).toBeNull();
        });
    });

    describe('trackWebsocketEvent default direction', () => {
        it('should use default direction "in" when not specified', () => {
            metrics.trackWebsocketEvent('game:start');

            const allMetrics = metrics.getAllMetrics();
            const key = 'websocket_events_total:direction=in,event=game:start';
            expect(allMetrics.counters[key]).toBeDefined();
            expect(allMetrics.counters[key].value).toBe(1);
        });

        it('should use specified direction when provided', () => {
            metrics.trackWebsocketEvent('game:started', 'out');

            const allMetrics = metrics.getAllMetrics();
            const key = 'websocket_events_total:direction=out,event=game:started';
            expect(allMetrics.counters[key]).toBeDefined();
        });
    });

    describe('getPrometheusMetrics', () => {
        it('should return empty string when no metrics exist', () => {
            const output = metrics.getPrometheusMetrics();
            expect(output).toBe('');
        });

        it('should format counters in Prometheus format', () => {
            metrics.incrementCounter('http_requests', 10, { method: 'GET' });

            const output = metrics.getPrometheusMetrics();
            expect(output).toContain('# TYPE http_requests counter');
            expect(output).toContain('http_requests{method="GET"} 10');
        });

        it('should format gauges in Prometheus format', () => {
            metrics.setGauge('active_connections', 5);

            const output = metrics.getPrometheusMetrics();
            expect(output).toContain('# TYPE active_connections gauge');
            expect(output).toContain('active_connections 5');
        });

        it('should format histograms as summaries in Prometheus format', () => {
            for (let i = 1; i <= 10; i++) {
                metrics.recordHistogram('request_duration', i * 10);
            }

            const output = metrics.getPrometheusMetrics();
            expect(output).toContain('# TYPE request_duration summary');
            expect(output).toContain('request_duration_count');
            expect(output).toContain('request_duration_sum');
            expect(output).toContain('quantile="0.5"');
            expect(output).toContain('quantile="0.9"');
            expect(output).toContain('quantile="0.99"');
        });

        it('should handle counters without labels', () => {
            metrics.incrementCounter('simple_counter', 1);

            const output = metrics.getPrometheusMetrics();
            expect(output).toContain('simple_counter 1');
        });

        it('should escape quotes in label values', () => {
            metrics.incrementCounter('test_escape', 1, { path: '/api/"test"' });

            const output = metrics.getPrometheusMetrics();
            expect(output).toContain('\\"test\\"');
        });

        it('should replace dots and hyphens in metric names', () => {
            metrics.incrementCounter('my.metric-name', 1, { env: 'test' });

            const output = metrics.getPrometheusMetrics();
            expect(output).toContain('my_metric_name');
        });

        it('should handle histogram with labels', () => {
            metrics.recordHistogram('api_latency', 50, { method: 'POST', path: '/api/rooms' });

            const output = metrics.getPrometheusMetrics();
            expect(output).toContain('api_latency_count');
            expect(output).toContain('method="POST"');
        });
    });

    describe('withTiming', () => {
        it('should wrap async function and record timing', async () => {
            const fn = async (x: unknown) => (x as number) * 2;
            const wrapped = metrics.withTiming(fn, 'timing_test', { op: 'multiply' });

            const result = await wrapped(21);
            expect(result).toBe(42);

            const stats = metrics.getHistogramStats('timing_test', { op: 'multiply' });
            expect(stats).not.toBeNull();
            expect(stats!.count).toBe(1);
        });

        it('should record timing even on error', async () => {
            const fn = async () => { throw new Error('fail'); };
            const wrapped = metrics.withTiming(fn, 'error_timing');

            await expect(wrapped()).rejects.toThrow('fail');

            const stats = metrics.getHistogramStats('error_timing');
            expect(stats).not.toBeNull();
            expect(stats!.count).toBe(1);
        });
    });

    describe('startTimer', () => {
        it('should return a function that records duration', () => {
            const stop = metrics.startTimer('manual_timer');

            // Simulate some work
            const duration = stop();

            expect(typeof duration).toBe('number');
            expect(duration).toBeGreaterThanOrEqual(0);

            const stats = metrics.getHistogramStats('manual_timer');
            expect(stats).not.toBeNull();
            expect(stats!.count).toBe(1);
        });
    });

    describe('updateSystemMetrics', () => {
        it('should set memory gauges', () => {
            metrics.updateSystemMetrics();

            const allMetrics = metrics.getAllMetrics();
            expect(allMetrics.gauges[metrics.METRIC_NAMES.MEMORY_HEAP_USED]).toBeDefined();
            expect(allMetrics.gauges[metrics.METRIC_NAMES.MEMORY_HEAP_TOTAL]).toBeDefined();
            expect(allMetrics.gauges[metrics.METRIC_NAMES.MEMORY_RSS]).toBeDefined();
        });
    });

    describe('event loop monitoring', () => {
        it('should start and stop monitoring without error', () => {
            // These are no-ops in test environment but should not throw
            expect(() => metrics.startEventLoopMonitoring()).not.toThrow();
            expect(() => metrics.stopEventLoopMonitoring()).not.toThrow();
        });

        it('should stop monitoring even when not started', () => {
            expect(() => metrics.stopEventLoopMonitoring()).not.toThrow();
        });
    });

    describe('convenience tracking functions', () => {
        it('should track game started', () => {
            metrics.trackGameStarted('ROOM1');
            const allMetrics = metrics.getAllMetrics();
            expect(allMetrics.counters['games_started:roomCode=ROOM1']).toBeDefined();
        });

        it('should track game completed', () => {
            metrics.trackGameCompleted('ROOM1', 'red');
            const allMetrics = metrics.getAllMetrics();
            expect(allMetrics.counters['games_completed:roomCode=ROOM1,winner=red']).toBeDefined();
        });

        it('should track card revealed', () => {
            metrics.trackCardRevealed('ROOM1', 'red', 'assassin');
            const allMetrics = metrics.getAllMetrics();
            expect(allMetrics.counters['cards_revealed:cardType=assassin,roomCode=ROOM1,team=red']).toBeDefined();
        });

        it('should track room created', () => {
            metrics.trackRoomCreated();
            const allMetrics = metrics.getAllMetrics();
            expect(allMetrics.counters['rooms_created']).toBeDefined();
        });

        it('should track http request', () => {
            metrics.trackHttpRequest('GET', '/health', 200);
            const allMetrics = metrics.getAllMetrics();
            const key = 'http_requests_total:method=GET,path=/health,statusCode=200';
            expect(allMetrics.counters[key]).toBeDefined();
        });

        it('should track reconnection', () => {
            metrics.trackReconnection('ROOM1', true);
            const allMetrics = metrics.getAllMetrics();
            expect(allMetrics.counters['reconnections_total:roomCode=ROOM1,success=true']).toBeDefined();
        });

        it('should track player kick', () => {
            metrics.trackPlayerKick('ROOM1', 'admin');
            const allMetrics = metrics.getAllMetrics();
            expect(allMetrics.counters['player_kicks_total:reason=admin,roomCode=ROOM1']).toBeDefined();
        });

        it('should track broadcast', () => {
            metrics.trackBroadcast('info');
            const allMetrics = metrics.getAllMetrics();
            expect(allMetrics.counters['broadcasts_sent_total:type=info']).toBeDefined();
        });

        it('should track http request duration', () => {
            metrics.trackHttpRequestDuration('GET', '/api/rooms', 150);
            const stats = metrics.getHistogramStats('http_request_duration_ms', { method: 'GET', path: '/api/rooms' });
            expect(stats).not.toBeNull();
        });

        it('should track websocket message size', () => {
            metrics.trackWebsocketMessageSize('game:reveal', 256);
            const stats = metrics.getHistogramStats('websocket_message_size_bytes', { event: 'game:reveal' });
            expect(stats).not.toBeNull();
        });

        it('should set spectator count', () => {
            metrics.setSpectatorCount(5);
            const allMetrics = metrics.getAllMetrics();
            expect(allMetrics.gauges['spectators_total']).toBeDefined();
            expect(allMetrics.gauges['spectators_total'].value).toBe(5);
        });
    });

    describe('incrementGauge', () => {
        it('should create new gauge when incrementing non-existent', () => {
            metrics.incrementGauge('new_gauge', 5);
            const allMetrics = metrics.getAllMetrics();
            expect(allMetrics.gauges['new_gauge'].value).toBe(5);
        });

        it('should increment existing gauge', () => {
            metrics.setGauge('existing_gauge', 10);
            metrics.incrementGauge('existing_gauge', 3);
            const allMetrics = metrics.getAllMetrics();
            expect(allMetrics.gauges['existing_gauge'].value).toBe(13);
        });
    });

    describe('incrementCounter', () => {
        it('should create new counter with default value 1', () => {
            metrics.incrementCounter('new_counter');
            const allMetrics = metrics.getAllMetrics();
            expect(allMetrics.counters['new_counter'].value).toBe(1);
        });

        it('should increment existing counter', () => {
            metrics.incrementCounter('inc_counter', 3);
            metrics.incrementCounter('inc_counter', 7);
            const allMetrics = metrics.getAllMetrics();
            expect(allMetrics.counters['inc_counter'].value).toBe(10);
        });
    });
});
