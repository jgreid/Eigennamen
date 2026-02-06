/**
 * Tests for Application Metrics Collection
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
    METRIC_NAMES,
    trackGameStarted,
    trackGameCompleted,
    trackCardRevealed,
    trackClueGiven,
    trackRoomCreated,
    trackRoomJoined,
    trackError,
    trackRateLimitHit,
    setActiveRooms,
    setActivePlayers,
    setActiveGames,
    setSocketConnections,
    trackOperationLatency,
    trackRedisLatency,
    trackSocketEventLatency
} = require('../utils/metrics');

// Mock correlationId
jest.mock('../utils/correlationId', () => ({
    getCorrelationId: jest.fn().mockReturnValue('test-correlation-id')
}));

describe('Metrics Collection', () => {
    beforeEach(() => {
        resetMetrics();
    });

    describe('Counters', () => {
        describe('incrementCounter', () => {
            it('should create and increment counter', () => {
                incrementCounter('test_counter');

                const metrics = getAllMetrics();
                expect(metrics.counters['test_counter'].value).toBe(1);
            });

            it('should increment existing counter', () => {
                incrementCounter('test_counter');
                incrementCounter('test_counter');
                incrementCounter('test_counter');

                const metrics = getAllMetrics();
                expect(metrics.counters['test_counter'].value).toBe(3);
            });

            it('should increment by custom value', () => {
                incrementCounter('test_counter', 10);

                const metrics = getAllMetrics();
                expect(metrics.counters['test_counter'].value).toBe(10);
            });

            it('should support labels', () => {
                incrementCounter('test_counter', 1, { env: 'test' });

                const metrics = getAllMetrics();
                const key = 'test_counter:env=test';
                expect(metrics.counters[key].value).toBe(1);
                expect(metrics.counters[key].labels).toEqual({ env: 'test' });
            });

            it('should handle multiple labels', () => {
                incrementCounter('test_counter', 1, { env: 'test', region: 'us-east' });

                const metrics = getAllMetrics();
                // Labels should be sorted alphabetically
                const key = 'test_counter:env=test,region=us-east';
                expect(metrics.counters[key].value).toBe(1);
            });
        });
    });

    describe('Gauges', () => {
        describe('setGauge', () => {
            it('should set gauge value', () => {
                setGauge('test_gauge', 42);

                const metrics = getAllMetrics();
                expect(metrics.gauges['test_gauge'].value).toBe(42);
            });

            it('should overwrite gauge value', () => {
                setGauge('test_gauge', 10);
                setGauge('test_gauge', 20);

                const metrics = getAllMetrics();
                expect(metrics.gauges['test_gauge'].value).toBe(20);
            });

            it('should support labels', () => {
                setGauge('test_gauge', 42, { type: 'memory' });

                const metrics = getAllMetrics();
                const key = 'test_gauge:type=memory';
                expect(metrics.gauges[key].value).toBe(42);
            });
        });

        describe('incrementGauge', () => {
            it('should increment gauge', () => {
                incrementGauge('test_gauge');

                const metrics = getAllMetrics();
                expect(metrics.gauges['test_gauge'].value).toBe(1);
            });

            it('should increment existing gauge', () => {
                setGauge('test_gauge', 10);
                incrementGauge('test_gauge', 5);

                const metrics = getAllMetrics();
                expect(metrics.gauges['test_gauge'].value).toBe(15);
            });
        });

        describe('decrementGauge', () => {
            it('should decrement gauge', () => {
                setGauge('test_gauge', 10);
                decrementGauge('test_gauge', 3);

                const metrics = getAllMetrics();
                expect(metrics.gauges['test_gauge'].value).toBe(7);
            });

            it('should go negative', () => {
                decrementGauge('test_gauge', 5);

                const metrics = getAllMetrics();
                expect(metrics.gauges['test_gauge'].value).toBe(-5);
            });
        });
    });

    describe('Histograms', () => {
        describe('recordHistogram', () => {
            it('should record histogram value', () => {
                recordHistogram('test_histogram', 100);

                const stats = getHistogramStats('test_histogram');
                expect(stats.count).toBe(1);
                expect(stats.sum).toBe(100);
                expect(stats.min).toBe(100);
                expect(stats.max).toBe(100);
            });

            it('should accumulate histogram values', () => {
                recordHistogram('test_histogram', 10);
                recordHistogram('test_histogram', 20);
                recordHistogram('test_histogram', 30);

                const stats = getHistogramStats('test_histogram');
                expect(stats.count).toBe(3);
                expect(stats.sum).toBe(60);
                expect(stats.avg).toBe(20);
                expect(stats.min).toBe(10);
                expect(stats.max).toBe(30);
            });

            it('should calculate percentiles', () => {
                for (let i = 1; i <= 100; i++) {
                    recordHistogram('test_histogram', i);
                }

                const stats = getHistogramStats('test_histogram');
                expect(stats.p50).toBe(50);
                expect(stats.p90).toBe(90);
                expect(stats.p95).toBe(95);
                expect(stats.p99).toBe(99);
            });

            it('should support labels', () => {
                recordHistogram('test_histogram', 100, { operation: 'read' });

                const stats = getHistogramStats('test_histogram', { operation: 'read' });
                expect(stats).not.toBeNull();
                expect(stats.count).toBe(1);
            });

            it('should return null for non-existent histogram', () => {
                const stats = getHistogramStats('nonexistent');
                expect(stats).toBeNull();
            });
        });

        describe('startTimer', () => {
            it('should record duration', async () => {
                const stopTimer = startTimer('test_timer');

                // Wait a bit
                await new Promise(resolve => setTimeout(resolve, 10));

                const duration = stopTimer();

                expect(duration).toBeGreaterThan(0);

                const stats = getHistogramStats('test_timer');
                expect(stats.count).toBe(1);
                expect(stats.sum).toBeGreaterThan(0);
            });

            it('should support labels', async () => {
                const stopTimer = startTimer('test_timer', { operation: 'query' });
                stopTimer();

                const stats = getHistogramStats('test_timer', { operation: 'query' });
                expect(stats).not.toBeNull();
            });
        });
    });

    describe('Wrappers', () => {
        describe('withTiming', () => {
            it('should wrap async function with timing', async () => {
                const fn = jest.fn().mockResolvedValue('result');
                const wrapped = withTiming(fn, 'wrapped_function');

                const result = await wrapped('arg1', 'arg2');

                expect(result).toBe('result');
                expect(fn).toHaveBeenCalledWith('arg1', 'arg2');

                const stats = getHistogramStats('wrapped_function');
                expect(stats.count).toBe(1);
            });

            it('should record timing even if function throws', async () => {
                const fn = jest.fn().mockRejectedValue(new Error('test error'));
                const wrapped = withTiming(fn, 'wrapped_function');

                await expect(wrapped()).rejects.toThrow('test error');

                const stats = getHistogramStats('wrapped_function');
                expect(stats.count).toBe(1);
            });
        });

        describe('timed decorator', () => {
            it('should be a function', () => {
                expect(typeof timed).toBe('function');
            });

            it('should return a decorator function', () => {
                const decorator = timed('test_metric');
                expect(typeof decorator).toBe('function');
            });
        });
    });

    describe('getAllMetrics', () => {
        it('should return all metric types', () => {
            incrementCounter('counter');
            setGauge('gauge', 10);
            recordHistogram('histogram', 100);

            const metrics = getAllMetrics();

            expect(metrics).toHaveProperty('timestamp');
            expect(metrics).toHaveProperty('instanceId');
            expect(metrics).toHaveProperty('counters');
            expect(metrics).toHaveProperty('gauges');
            expect(metrics).toHaveProperty('histograms');
        });

        it('should include counter data', () => {
            incrementCounter('test_counter', 5);

            const metrics = getAllMetrics();
            expect(metrics.counters['test_counter']).toMatchObject({
                value: 5,
                labels: {}
            });
        });

        it('should include gauge data', () => {
            setGauge('test_gauge', 42);

            const metrics = getAllMetrics();
            expect(metrics.gauges['test_gauge']).toMatchObject({
                value: 42,
                labels: {}
            });
        });

        it('should include histogram stats', () => {
            recordHistogram('test_histogram', 100);

            const metrics = getAllMetrics();
            expect(metrics.histograms).toHaveProperty('test_histogram');
        });
    });

    describe('resetMetrics', () => {
        it('should clear all metrics', () => {
            incrementCounter('counter');
            setGauge('gauge', 10);
            recordHistogram('histogram', 100);

            resetMetrics();

            const metrics = getAllMetrics();
            expect(Object.keys(metrics.counters)).toHaveLength(0);
            expect(Object.keys(metrics.gauges)).toHaveLength(0);
            expect(Object.keys(metrics.histograms)).toHaveLength(0);
        });
    });

    describe('METRIC_NAMES', () => {
        it('should define counter names', () => {
            expect(METRIC_NAMES.GAMES_STARTED).toBeDefined();
            expect(METRIC_NAMES.GAMES_COMPLETED).toBeDefined();
            expect(METRIC_NAMES.CARDS_REVEALED).toBeDefined();
            expect(METRIC_NAMES.ERRORS).toBeDefined();
        });

        it('should define gauge names', () => {
            expect(METRIC_NAMES.ACTIVE_ROOMS).toBeDefined();
            expect(METRIC_NAMES.ACTIVE_PLAYERS).toBeDefined();
            expect(METRIC_NAMES.SOCKET_CONNECTIONS).toBeDefined();
        });

        it('should define histogram names', () => {
            expect(METRIC_NAMES.OPERATION_LATENCY).toBeDefined();
            expect(METRIC_NAMES.REDIS_LATENCY).toBeDefined();
        });
    });

    describe('Convenience Functions', () => {
        describe('Game tracking', () => {
            it('trackGameStarted should increment games_started counter', () => {
                trackGameStarted('ROOM1');

                const metrics = getAllMetrics();
                const key = 'games_started:roomCode=ROOM1';
                expect(metrics.counters[key].value).toBe(1);
            });

            it('trackGameCompleted should increment games_completed counter', () => {
                trackGameCompleted('ROOM1', 'red');

                const metrics = getAllMetrics();
                const key = 'games_completed:roomCode=ROOM1,winner=red';
                expect(metrics.counters[key].value).toBe(1);
            });

            it('trackCardRevealed should increment cards_revealed counter', () => {
                trackCardRevealed('ROOM1', 'red', 'blue');

                const metrics = getAllMetrics();
                const key = 'cards_revealed:cardType=blue,roomCode=ROOM1,team=red';
                expect(metrics.counters[key].value).toBe(1);
            });

            it('trackClueGiven should increment clues_given counter', () => {
                trackClueGiven('ROOM1', 'blue');

                const metrics = getAllMetrics();
                const key = 'clues_given:roomCode=ROOM1,team=blue';
                expect(metrics.counters[key].value).toBe(1);
            });
        });

        describe('Room tracking', () => {
            it('trackRoomCreated should increment rooms_created counter', () => {
                trackRoomCreated();

                const metrics = getAllMetrics();
                expect(metrics.counters['rooms_created'].value).toBe(1);
            });

            it('trackRoomJoined should increment rooms_joined counter', () => {
                trackRoomJoined('ROOM1');

                const metrics = getAllMetrics();
                const key = 'rooms_joined:roomCode=ROOM1';
                expect(metrics.counters[key].value).toBe(1);
            });
        });

        describe('Error tracking', () => {
            it('trackError should increment errors counter', () => {
                trackError('VALIDATION_ERROR', 'createRoom');

                const metrics = getAllMetrics();
                const key = 'errors:errorCode=VALIDATION_ERROR,operation=createRoom';
                expect(metrics.counters[key].value).toBe(1);
            });

            it('trackRateLimitHit should increment rate_limit_hits counter', () => {
                trackRateLimitHit('game:reveal');

                const metrics = getAllMetrics();
                const key = 'rate_limit_hits:event=game:reveal';
                expect(metrics.counters[key].value).toBe(1);
            });
        });

        describe('Gauge updates', () => {
            it('setActiveRooms should set gauge', () => {
                setActiveRooms(10);

                const metrics = getAllMetrics();
                expect(metrics.gauges['active_rooms'].value).toBe(10);
            });

            it('setActivePlayers should set gauge', () => {
                setActivePlayers(50);

                const metrics = getAllMetrics();
                expect(metrics.gauges['active_players'].value).toBe(50);
            });

            it('setActiveGames should set gauge', () => {
                setActiveGames(5);

                const metrics = getAllMetrics();
                expect(metrics.gauges['active_games'].value).toBe(5);
            });

            it('setSocketConnections should set gauge', () => {
                setSocketConnections(100);

                const metrics = getAllMetrics();
                expect(metrics.gauges['socket_connections'].value).toBe(100);
            });
        });

        describe('Latency tracking', () => {
            it('trackOperationLatency should record histogram', () => {
                trackOperationLatency('createRoom', 50);

                const stats = getHistogramStats('operation_latency_ms', { operation: 'createRoom' });
                expect(stats).not.toBeNull();
                expect(stats.sum).toBe(50);
            });

            it('trackRedisLatency should record histogram', () => {
                trackRedisLatency('GET', 5);

                const stats = getHistogramStats('redis_latency_ms', { command: 'GET' });
                expect(stats).not.toBeNull();
                expect(stats.sum).toBe(5);
            });

            it('trackSocketEventLatency should record histogram', () => {
                trackSocketEventLatency('game:reveal', 10);

                const stats = getHistogramStats('socket_event_latency_ms', { event: 'game:reveal' });
                expect(stats).not.toBeNull();
                expect(stats.sum).toBe(10);
            });
        });
    });
});
