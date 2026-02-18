/**
 * Tests for pruneStaleMetrics in utils/metrics
 *
 * Covers: stale counter/gauge/histogram pruning
 */

const {
    incrementCounter,
    setGauge,
    recordHistogram,
    getAllMetrics,
    resetMetrics,
    pruneStaleMetrics
} = require('../../utils/metrics');

describe('pruneStaleMetrics', () => {
    beforeEach(() => {
        resetMetrics();
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    test('removes stale counters beyond maxAge', () => {
        incrementCounter('old_counter', 1);

        // Advance past default maxAge (1 hour)
        jest.advanceTimersByTime(2 * 60 * 60 * 1000);

        pruneStaleMetrics();

        const metrics = getAllMetrics();
        expect(metrics.counters['old_counter']).toBeUndefined();
    });

    test('removes stale gauges beyond maxAge', () => {
        setGauge('old_gauge', 42);

        jest.advanceTimersByTime(2 * 60 * 60 * 1000);

        pruneStaleMetrics();

        const metrics = getAllMetrics();
        expect(metrics.gauges['old_gauge']).toBeUndefined();
    });

    test('removes stale histograms beyond maxAge', () => {
        recordHistogram('old_histogram', 100);

        jest.advanceTimersByTime(2 * 60 * 60 * 1000);

        pruneStaleMetrics();

        const metrics = getAllMetrics();
        expect(metrics.histograms['old_histogram']).toBeUndefined();
    });

    test('preserves recent metrics', () => {
        incrementCounter('fresh_counter', 5);
        setGauge('fresh_gauge', 10);
        recordHistogram('fresh_histogram', 50);

        // Advance only 30 minutes (under 1-hour default)
        jest.advanceTimersByTime(30 * 60 * 1000);

        pruneStaleMetrics();

        const metrics = getAllMetrics();
        expect(metrics.counters['fresh_counter']).toBeDefined();
        expect(metrics.gauges['fresh_gauge']).toBeDefined();
        expect(metrics.histograms['fresh_histogram']).toBeDefined();
    });

    test('supports custom maxAge', () => {
        incrementCounter('short_lived', 1);

        // Advance 10 minutes
        jest.advanceTimersByTime(10 * 60 * 1000);

        // Prune with 5-minute maxAge
        pruneStaleMetrics(5 * 60 * 1000);

        const metrics = getAllMetrics();
        expect(metrics.counters['short_lived']).toBeUndefined();
    });

    test('selectively prunes only stale metrics', () => {
        incrementCounter('old_one', 1);

        jest.advanceTimersByTime(90 * 60 * 1000);

        // Add a fresh one after advancing time
        incrementCounter('new_one', 1);

        pruneStaleMetrics();

        const metrics = getAllMetrics();
        expect(metrics.counters['old_one']).toBeUndefined();
        expect(metrics.counters['new_one']).toBeDefined();
    });
});
