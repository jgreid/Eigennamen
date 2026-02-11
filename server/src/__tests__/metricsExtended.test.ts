/**
 * Extended Metrics Tests
 *
 * Tests for utils/metrics.js - covers system monitoring, event loop monitoring,
 * and Prometheus export functionality.
 */

const {
    incrementCounter,
    setGauge,
    incrementGauge,
    decrementGauge,
    recordHistogram,
    startTimer,
    timed,
    withTiming,
    getHistogramStats,
    getAllMetrics,
    resetMetrics,
    getPrometheusMetrics,
    updateSystemMetrics,
    startEventLoopMonitoring,
    stopEventLoopMonitoring,
    METRIC_NAMES
} = require('../utils/metrics');

describe('Metrics Extended Tests', () => {
    beforeEach(() => {
        resetMetrics();
    });

    describe('Core counter operations', () => {
        it('should increment counter with labels', () => {
            incrementCounter('test_counter', 1, { env: 'test' });
            incrementCounter('test_counter', 2, { env: 'test' });

            const metrics = getAllMetrics();
            expect(metrics.counters['test_counter:env=test'].value).toBe(3);
        });

        it('should track different labels separately', () => {
            incrementCounter('requests', 1, { method: 'GET' });
            incrementCounter('requests', 1, { method: 'POST' });
            incrementCounter('requests', 1, { method: 'GET' });

            const metrics = getAllMetrics();
            expect(metrics.counters['requests:method=GET'].value).toBe(2);
            expect(metrics.counters['requests:method=POST'].value).toBe(1);
        });
    });

    describe('Core gauge operations', () => {
        it('should set gauge with labels', () => {
            setGauge('connections', 50, { type: 'websocket' });

            const metrics = getAllMetrics();
            expect(metrics.gauges['connections:type=websocket'].value).toBe(50);
        });

        it('should increment gauge', () => {
            incrementGauge('active_users', 1, { region: 'us' });
            incrementGauge('active_users', 1, { region: 'us' });

            const metrics = getAllMetrics();
            expect(metrics.gauges['active_users:region=us'].value).toBe(2);
        });

        it('should decrement gauge', () => {
            setGauge('rooms', 10);
            decrementGauge('rooms', 3);

            const metrics = getAllMetrics();
            expect(metrics.gauges['rooms'].value).toBe(7);
        });
    });

    describe('Histogram operations', () => {
        it('should record histogram values', () => {
            recordHistogram('latency', 100);
            recordHistogram('latency', 200);
            recordHistogram('latency', 150);

            const stats = getHistogramStats('latency');
            expect(stats.count).toBe(3);
            expect(stats.sum).toBe(450);
            expect(stats.avg).toBe(150);
            expect(stats.min).toBe(100);
            expect(stats.max).toBe(200);
        });

        it('should calculate percentiles', () => {
            for (let i = 1; i <= 100; i++) {
                recordHistogram('response_time', i);
            }

            const stats = getHistogramStats('response_time');
            expect(stats.p50).toBe(50);
            expect(stats.p90).toBe(90);
            expect(stats.p95).toBe(95);
            expect(stats.p99).toBe(99);
        });

        it('should return null for non-existent histogram', () => {
            const stats = getHistogramStats('nonexistent');
            expect(stats).toBeNull();
        });

        it('should limit histogram size to maxHistogramSize', () => {
            // Record more than maxHistogramSize (1000) values
            for (let i = 0; i < 1100; i++) {
                recordHistogram('large_histogram', i);
            }

            const stats = getHistogramStats('large_histogram');
            expect(stats.count).toBe(1000); // Limited to max size
        });
    });

    describe('Timer operations', () => {
        it('should time operations', async () => {
            const stopTimer = startTimer('operation_time');
            await new Promise(resolve => setTimeout(resolve, 10));
            const duration = stopTimer();

            expect(duration).toBeGreaterThan(9);
            expect(duration).toBeLessThan(100);

            const stats = getHistogramStats('operation_time');
            expect(stats.count).toBe(1);
        });

        it('should wrap async functions with timing', async () => {
            const asyncFn = async (x) => {
                await new Promise(resolve => setTimeout(resolve, 5));
                return x * 2;
            };

            const timedFn = withTiming(asyncFn, 'async_operation');
            const result = await timedFn(5);

            expect(result).toBe(10);

            const stats = getHistogramStats('async_operation');
            expect(stats.count).toBe(1);
            expect(stats.min).toBeGreaterThan(4);
        });
    });

    describe('timed decorator', () => {
        it('should create a decorator function', () => {
            const decorator = timed('method_time');
            expect(typeof decorator).toBe('function');
        });

        it('should wrap method with timing', async () => {
            const descriptor = {
                value: async function testMethod(x) {
                    await new Promise(resolve => setTimeout(resolve, 5));
                    return x + 1;
                }
            };

            const decorator = timed('decorated_method');
            const result = decorator({}, 'testMethod', descriptor);

            expect(result).toBe(descriptor);
            expect(typeof descriptor.value).toBe('function');

            const returnValue = await descriptor.value(10);
            expect(returnValue).toBe(11);
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

    describe('Event loop monitoring', () => {
        afterEach(() => {
            stopEventLoopMonitoring();
        });

        it('should start and stop event loop monitoring', () => {
            // In test environment, this should not start
            startEventLoopMonitoring();
            // Should not throw
            stopEventLoopMonitoring();
            stopEventLoopMonitoring(); // Should handle double stop
        });

        it('should measure event loop lag when not in test mode', () => {
            // Save original NODE_ENV
            const originalEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'development';

            startEventLoopMonitoring();

            // Wait a bit for measurement
            return new Promise(resolve => {
                setTimeout(() => {
                    stopEventLoopMonitoring();
                    process.env.NODE_ENV = originalEnv;
                    resolve();
                }, 150);
            });
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

    describe('Convenience tracking functions', () => {
        it('should track game started', () => {
            incrementCounter(METRIC_NAMES.GAMES_STARTED, 1, { roomCode: 'ROOM01' });

            const metrics = getAllMetrics();
            expect(metrics.counters['games_started:roomCode=ROOM01'].value).toBe(1);
        });

        it('should track game completed', () => {
            incrementCounter(METRIC_NAMES.GAMES_COMPLETED, 1, { roomCode: 'ROOM02', winner: 'red' });

            const metrics = getAllMetrics();
            expect(metrics.counters['games_completed:roomCode=ROOM02,winner=red'].value).toBe(1);
        });

        it('should track card revealed', () => {
            incrementCounter(METRIC_NAMES.CARDS_REVEALED, 1, { roomCode: 'ROOM03', team: 'blue', cardType: 'agent' });

            const metrics = getAllMetrics();
            expect(metrics.counters['cards_revealed:cardType=agent,roomCode=ROOM03,team=blue'].value).toBe(1);
        });

        it('should track clue given', () => {
            incrementCounter(METRIC_NAMES.CLUES_GIVEN, 1, { roomCode: 'ROOM04', team: 'red' });

            const metrics = getAllMetrics();
            expect(metrics.counters['clues_given:roomCode=ROOM04,team=red'].value).toBe(1);
        });

        it('should track room created', () => {
            incrementCounter(METRIC_NAMES.ROOMS_CREATED);
            incrementCounter(METRIC_NAMES.ROOMS_CREATED);

            const metrics = getAllMetrics();
            expect(metrics.counters['rooms_created'].value).toBe(2);
        });

        it('should track room joined', () => {
            incrementCounter(METRIC_NAMES.ROOMS_JOINED, 1, { roomCode: 'ROOM05' });

            const metrics = getAllMetrics();
            expect(metrics.counters['rooms_joined:roomCode=ROOM05'].value).toBe(1);
        });

        it('should track errors', () => {
            incrementCounter(METRIC_NAMES.ERRORS, 1, { errorCode: 'ROOM_NOT_FOUND', operation: 'joinRoom' });

            const metrics = getAllMetrics();
            expect(metrics.counters['errors:errorCode=ROOM_NOT_FOUND,operation=joinRoom'].value).toBe(1);
        });

        it('should track rate limit hits', () => {
            incrementCounter(METRIC_NAMES.RATE_LIMIT_HITS, 1, { event: 'room:create' });

            const metrics = getAllMetrics();
            expect(metrics.counters['rate_limit_hits:event=room:create'].value).toBe(1);
        });

        it('should set active rooms gauge', () => {
            setGauge(METRIC_NAMES.ACTIVE_ROOMS, 15);

            const metrics = getAllMetrics();
            expect(metrics.gauges['active_rooms'].value).toBe(15);
        });

        it('should set active players gauge', () => {
            setGauge(METRIC_NAMES.ACTIVE_PLAYERS, 100);

            const metrics = getAllMetrics();
            expect(metrics.gauges['active_players'].value).toBe(100);
        });

        it('should set active games gauge', () => {
            setGauge(METRIC_NAMES.ACTIVE_GAMES, 5);

            const metrics = getAllMetrics();
            expect(metrics.gauges['active_games'].value).toBe(5);
        });

        it('should set socket connections gauge', () => {
            setGauge(METRIC_NAMES.SOCKET_CONNECTIONS, 200);

            const metrics = getAllMetrics();
            expect(metrics.gauges['socket_connections'].value).toBe(200);
        });

        it('should track operation latency', () => {
            recordHistogram(METRIC_NAMES.OPERATION_LATENCY, 150, { operation: 'createRoom' });

            const stats = getHistogramStats('operation_latency_ms', { operation: 'createRoom' });
            expect(stats.count).toBe(1);
            expect(stats.avg).toBe(150);
        });

        it('should track Redis latency', () => {
            recordHistogram(METRIC_NAMES.REDIS_LATENCY, 5, { command: 'GET' });

            const stats = getHistogramStats('redis_latency_ms', { command: 'GET' });
            expect(stats.count).toBe(1);
        });

        it('should track socket event latency', () => {
            recordHistogram(METRIC_NAMES.SOCKET_EVENT_LATENCY, 25, { event: 'room:join' });

            const stats = getHistogramStats('socket_event_latency_ms', { event: 'room:join' });
            expect(stats.count).toBe(1);
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
        it('should include timestamp and instanceId', () => {
            const metrics = getAllMetrics();

            expect(metrics.timestamp).toBeDefined();
            expect(typeof metrics.timestamp).toBe('number');
            expect(metrics.instanceId).toBeDefined();
        });

        it('should return all metric types', () => {
            incrementCounter('test_counter', 1);
            setGauge('test_gauge', 100);
            recordHistogram('test_histogram', 50);

            const metrics = getAllMetrics();

            expect(metrics.counters.test_counter).toBeDefined();
            expect(metrics.gauges.test_gauge).toBeDefined();
            expect(metrics.histograms.test_histogram).toBeDefined();
        });

        it('should skip empty histograms in export', () => {
            // This should not appear in export
            const metrics = getAllMetrics();
            expect(Object.keys(metrics.histograms).length).toBe(0);
        });
    });

    describe('METRIC_NAMES constants', () => {
        it('should define all counter names', () => {
            expect(METRIC_NAMES.GAMES_STARTED).toBe('games_started');
            expect(METRIC_NAMES.GAMES_COMPLETED).toBe('games_completed');
            expect(METRIC_NAMES.CARDS_REVEALED).toBe('cards_revealed');
            expect(METRIC_NAMES.CLUES_GIVEN).toBe('clues_given');
            expect(METRIC_NAMES.ROOMS_CREATED).toBe('rooms_created');
            expect(METRIC_NAMES.ROOMS_JOINED).toBe('rooms_joined');
            expect(METRIC_NAMES.ERRORS).toBe('errors');
            expect(METRIC_NAMES.RATE_LIMIT_HITS).toBe('rate_limit_hits');
            expect(METRIC_NAMES.HTTP_REQUESTS).toBe('http_requests_total');
            expect(METRIC_NAMES.WEBSOCKET_EVENTS).toBe('websocket_events_total');
            expect(METRIC_NAMES.RECONNECTIONS).toBe('reconnections_total');
            expect(METRIC_NAMES.PLAYER_KICKS).toBe('player_kicks_total');
            expect(METRIC_NAMES.BROADCASTS_SENT).toBe('broadcasts_sent_total');
        });

        it('should define all gauge names', () => {
            expect(METRIC_NAMES.ACTIVE_ROOMS).toBe('active_rooms');
            expect(METRIC_NAMES.ACTIVE_PLAYERS).toBe('active_players');
            expect(METRIC_NAMES.ACTIVE_GAMES).toBe('active_games');
            expect(METRIC_NAMES.ACTIVE_TIMERS).toBe('active_timers');
            expect(METRIC_NAMES.SOCKET_CONNECTIONS).toBe('socket_connections');
            expect(METRIC_NAMES.REDIS_CONNECTION_STATUS).toBe('redis_connection_status');
            expect(METRIC_NAMES.MEMORY_HEAP_USED).toBe('memory_heap_used_bytes');
            expect(METRIC_NAMES.MEMORY_HEAP_TOTAL).toBe('memory_heap_total_bytes');
            expect(METRIC_NAMES.MEMORY_RSS).toBe('memory_rss_bytes');
            expect(METRIC_NAMES.EVENT_LOOP_LAG).toBe('event_loop_lag_ms');
            expect(METRIC_NAMES.SPECTATORS).toBe('spectators_total');
        });

        it('should define all histogram names', () => {
            expect(METRIC_NAMES.OPERATION_LATENCY).toBe('operation_latency_ms');
            expect(METRIC_NAMES.REDIS_LATENCY).toBe('redis_latency_ms');
            expect(METRIC_NAMES.GAME_DURATION).toBe('game_duration_seconds');
            expect(METRIC_NAMES.TURN_DURATION).toBe('turn_duration_seconds');
            expect(METRIC_NAMES.SOCKET_EVENT_LATENCY).toBe('socket_event_latency_ms');
            expect(METRIC_NAMES.HTTP_REQUEST_DURATION).toBe('http_request_duration_ms');
            expect(METRIC_NAMES.WEBSOCKET_MESSAGE_SIZE).toBe('websocket_message_size_bytes');
        });
    });
});
