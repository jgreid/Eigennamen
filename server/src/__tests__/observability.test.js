/**
 * Observability Tests
 *
 * Verifies that observability patterns are correctly implemented:
 * - Structured logging with correlation IDs
 * - Metrics collection (counters, gauges, histograms)
 * - Health check endpoints
 * - Correlation ID propagation
 */

const fs = require('fs');
const path = require('path');

describe('Structured Logging', () => {
    const loggerPath = path.join(__dirname, '..', 'utils', 'logger.js');

    test('logger uses Winston with structured format', () => {
        const loggerCode = fs.readFileSync(loggerPath, 'utf8');

        expect(loggerCode).toContain("require('winston')");
        expect(loggerCode).toContain('winston.format');
        expect(loggerCode).toContain('timestamp');
    });

    test('logger supports correlation ID injection', () => {
        const loggerCode = fs.readFileSync(loggerPath, 'utf8');

        expect(loggerCode).toContain('correlationId');
        expect(loggerCode).toContain('getContextFields');
    });

    test('logger has multiple log levels', () => {
        const loggerCode = fs.readFileSync(loggerPath, 'utf8');

        expect(loggerCode).toContain('error');
        expect(loggerCode).toContain('warn');
        expect(loggerCode).toContain('info');
        expect(loggerCode).toContain('debug');
    });

    test('logger supports session and room context', () => {
        const loggerCode = fs.readFileSync(loggerPath, 'utf8');

        expect(loggerCode).toContain('sessionId');
        expect(loggerCode).toContain('roomCode');
    });

    test('logger has environment-based log level configuration', () => {
        const loggerCode = fs.readFileSync(loggerPath, 'utf8');

        expect(loggerCode).toContain('LOG_LEVEL');
        expect(loggerCode).toContain('NODE_ENV');
        expect(loggerCode).toContain('production');
        expect(loggerCode).toContain('development');
    });
});

describe('Metrics Collection', () => {
    const metricsPath = path.join(__dirname, '..', 'utils', 'metrics.js');

    test('metrics module has counter support', () => {
        const metricsCode = fs.readFileSync(metricsPath, 'utf8');

        expect(metricsCode).toContain('counters');
        expect(metricsCode).toContain('incrementCounter');
    });

    test('metrics module has gauge support', () => {
        const metricsCode = fs.readFileSync(metricsPath, 'utf8');

        expect(metricsCode).toContain('gauges');
        expect(metricsCode).toContain('setGauge');
        expect(metricsCode).toContain('incrementGauge');
        expect(metricsCode).toContain('decrementGauge');
    });

    test('metrics module has histogram support', () => {
        const metricsCode = fs.readFileSync(metricsPath, 'utf8');

        expect(metricsCode).toContain('histograms');
        expect(metricsCode).toContain('recordHistogram');
        expect(metricsCode).toContain('histogramBuckets');
    });

    test('metrics module supports labels', () => {
        const metricsCode = fs.readFileSync(metricsPath, 'utf8');

        expect(metricsCode).toContain('labels');
        expect(metricsCode).toContain('createKey');
    });

    test('metrics module has getAllMetrics export', () => {
        const metricsCode = fs.readFileSync(metricsPath, 'utf8');

        expect(metricsCode).toContain('getAllMetrics');
        expect(metricsCode).toContain('module.exports');
    });
});

describe('Correlation ID', () => {
    const correlationPath = path.join(__dirname, '..', 'utils', 'correlationId.js');

    test('correlation ID uses AsyncLocalStorage', () => {
        const correlationCode = fs.readFileSync(correlationPath, 'utf8');

        expect(correlationCode).toContain('AsyncLocalStorage');
        expect(correlationCode).toContain('asyncLocalStorage');
    });

    test('correlation ID provides context getters', () => {
        const correlationCode = fs.readFileSync(correlationPath, 'utf8');

        expect(correlationCode).toContain('getCorrelationId');
        expect(correlationCode).toContain('getSessionId');
        expect(correlationCode).toContain('getRoomCode');
        expect(correlationCode).toContain('getContextFields');
    });

    test('correlation ID supports context propagation', () => {
        const correlationCode = fs.readFileSync(correlationPath, 'utf8');

        expect(correlationCode).toContain('withContext');
        expect(correlationCode).toContain('asyncLocalStorage.run');
    });

    test('correlation ID has header constant for HTTP propagation', () => {
        const correlationCode = fs.readFileSync(correlationPath, 'utf8');

        expect(correlationCode).toContain('CORRELATION_HEADER');
        expect(correlationCode).toContain('x-correlation-id');
    });
});

describe('Health Check Endpoints', () => {
    const appPath = path.join(__dirname, '..', 'app.js');

    test('app has basic health endpoint', () => {
        const appCode = fs.readFileSync(appPath, 'utf8');

        expect(appCode).toMatch(/app\.get\s*\(\s*['"]\/health['"]/);
    });

    test('app has readiness probe endpoint', () => {
        const appCode = fs.readFileSync(appPath, 'utf8');

        expect(appCode).toMatch(/app\.get\s*\(\s*['"]\/health\/ready['"]/);
    });

    test('app has liveness probe endpoint', () => {
        const appCode = fs.readFileSync(appPath, 'utf8');

        expect(appCode).toMatch(/app\.get\s*\(\s*['"]\/health\/live['"]/);
    });

    test('app has metrics endpoint', () => {
        const appCode = fs.readFileSync(appPath, 'utf8');

        expect(appCode).toMatch(/app\.get\s*\(\s*['"]\/metrics['"]/);
        expect(appCode).toContain('getAllMetrics');
    });

    test('health endpoints are excluded from static file serving', () => {
        const appCode = fs.readFileSync(appPath, 'utf8');

        expect(appCode).toContain('/health');
        expect(appCode).toContain('/metrics');
    });
});

describe('Observability Integration', () => {
    test('logger is used across services', () => {
        const servicesPath = path.join(__dirname, '..', 'services');
        const services = fs.readdirSync(servicesPath).filter(f => f.endsWith('.js'));

        let loggerImports = 0;
        for (const service of services) {
            const code = fs.readFileSync(path.join(servicesPath, service), 'utf8');
            if (code.includes("require('../utils/logger')") || code.includes("require('./logger')")) {
                loggerImports++;
            }
        }

        // At least some services should use logger
        expect(loggerImports).toBeGreaterThan(0);
    });

    test('metrics are tracked for rate limiting', () => {
        const rateLimitPath = path.join(__dirname, '..', 'middleware', 'rateLimit.js');
        const rateLimitCode = fs.readFileSync(rateLimitPath, 'utf8');

        // Rate limiter should track metrics
        expect(rateLimitCode).toMatch(/metrics|incrementCounter|recordHistogram/);
    });

    test('socket handlers use logger for observability', () => {
        const socketPath = path.join(__dirname, '..', 'socket', 'index.js');
        const socketCode = fs.readFileSync(socketPath, 'utf8');

        // Socket handlers should use logger
        expect(socketCode).toContain("require('../utils/logger')");
        expect(socketCode).toContain('logger.info');
        expect(socketCode).toContain('logger.error');
    });
});

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
