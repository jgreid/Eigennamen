/**
 * Observability Tests
 *
 * Tests for observability functionality:
 * - Metrics collection (counters, gauges, histograms)
 * - Correlation ID propagation
 */

describe('Metrics Functionality', () => {
    const {
        incrementCounter,
        setGauge,
        incrementGauge,
        decrementGauge,
        recordHistogram,
        getAllMetrics,
        resetMetrics
    } = require('../utils/metrics');

    beforeEach(() => {
        resetMetrics();
    });

    test('incrementCounter increases counter value', () => {
        incrementCounter('test_counter');
        incrementCounter('test_counter');
        incrementCounter('test_counter', 5);

        const metrics = getAllMetrics();
        expect(metrics.counters['test_counter'].value).toBe(7);
    });

    test('setGauge sets gauge value', () => {
        setGauge('test_gauge', 42);

        const metrics = getAllMetrics();
        expect(metrics.gauges['test_gauge'].value).toBe(42);
    });

    test('incrementGauge and decrementGauge work correctly', () => {
        incrementGauge('test_gauge', 10);
        decrementGauge('test_gauge', 3);

        const metrics = getAllMetrics();
        expect(metrics.gauges['test_gauge'].value).toBe(7);
    });

    test('recordHistogram tracks values', () => {
        recordHistogram('test_histogram', 100);
        recordHistogram('test_histogram', 200);
        recordHistogram('test_histogram', 300);

        const metrics = getAllMetrics();
        const hist = metrics.histograms['test_histogram'];
        expect(hist.count).toBe(3);
        expect(hist.sum).toBe(600);
        expect(hist.min).toBe(100);
        expect(hist.max).toBe(300);
    });

    test('metrics support labels', () => {
        incrementCounter('requests', 1, { method: 'GET' });
        incrementCounter('requests', 1, { method: 'POST' });

        const metrics = getAllMetrics();
        expect(Object.keys(metrics.counters).length).toBe(2);
    });
});

describe('Correlation ID Functionality', () => {
    const {
        getCorrelationId,
        getSessionId,
        getRoomCode,
        getContextFields,
        withContext,
        withNewCorrelation
    } = require('../utils/correlationId');

    test('withContext propagates correlation ID', async () => {
        let capturedId = null;

        await withContext({ correlationId: 'test-123' }, () => {
            capturedId = getCorrelationId();
        });

        expect(capturedId).toBe('test-123');
    });

    test('withContext propagates session and room', async () => {
        let capturedSession = null;
        let capturedRoom = null;

        await withContext({
            correlationId: 'test-123',
            sessionId: 'session-456',
            roomCode: 'ABCDEF'
        }, () => {
            capturedSession = getSessionId();
            capturedRoom = getRoomCode();
        });

        expect(capturedSession).toBe('session-456');
        expect(capturedRoom).toBe('ABCDEF');
    });

    test('getContextFields returns all context', async () => {
        let fields = null;

        await withContext({
            correlationId: 'corr-123',
            sessionId: 'sess-456',
            roomCode: 'ROOM01'
        }, () => {
            fields = getContextFields();
        });

        expect(fields.correlationId).toBe('corr-123');
        expect(fields.sessionId).toBe('sess-456');
        expect(fields.roomCode).toBe('ROOM01');
    });

    test('withNewCorrelation generates new correlation ID', async () => {
        let id = null;

        await withNewCorrelation(() => {
            id = getCorrelationId();
        });

        expect(id).toBeTruthy();
        expect(id.length).toBe(36); // UUID format
    });
});
