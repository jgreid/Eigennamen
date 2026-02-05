/**
 * Application Metrics Collection
 *
 * Provides counters, gauges, and histograms for monitoring application performance.
 * Thread-safe and supports periodic reporting.
 */

// Metrics storage
const metrics = {
    counters: {},
    gauges: {},
    histograms: {}
};

// Configuration
const config = {
    histogramBuckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
    maxHistogramSize: 1000,
    reportingInterval: 60000 // 1 minute
};

// Instance ID for distributed metrics
const instanceId = process.env.FLY_ALLOC_ID || process.env.INSTANCE_ID || 'local';

/**
 * Increment a counter
 * @param {string} name - Counter name
 * @param {number} value - Value to add (default 1)
 * @param {Object} labels - Optional labels
 */
function incrementCounter(name, value = 1, labels = {}) {
    const key = createKey(name, labels);
    if (!metrics.counters[key]) {
        metrics.counters[key] = { value: 0, labels, createdAt: Date.now() };
    }
    metrics.counters[key].value += value;
    metrics.counters[key].lastUpdated = Date.now();
}

/**
 * Set a gauge value
 * @param {string} name - Gauge name
 * @param {number} value - Current value
 * @param {Object} labels - Optional labels
 */
function setGauge(name, value, labels = {}) {
    const key = createKey(name, labels);
    metrics.gauges[key] = {
        value,
        labels,
        lastUpdated: Date.now()
    };
}

/**
 * Increment a gauge
 * @param {string} name - Gauge name
 * @param {number} value - Value to add (default 1)
 * @param {Object} labels - Optional labels
 */
function incrementGauge(name, value = 1, labels = {}) {
    const key = createKey(name, labels);
    if (!metrics.gauges[key]) {
        metrics.gauges[key] = { value: 0, labels, createdAt: Date.now() };
    }
    metrics.gauges[key].value += value;
    metrics.gauges[key].lastUpdated = Date.now();
}

/**
 * Decrement a gauge
 * @param {string} name - Gauge name
 * @param {number} value - Value to subtract (default 1)
 * @param {Object} labels - Optional labels
 */
function decrementGauge(name, value = 1, labels = {}) {
    incrementGauge(name, -value, labels);
}

/**
 * Record a histogram value
 * @param {string} name - Histogram name
 * @param {number} value - Observed value
 * @param {Object} labels - Optional labels
 */
function recordHistogram(name, value, labels = {}) {
    const key = createKey(name, labels);
    if (!metrics.histograms[key]) {
        metrics.histograms[key] = {
            values: [],
            sum: 0,
            count: 0,
            min: Infinity,
            max: -Infinity,
            labels,
            createdAt: Date.now()
        };
    }

    const histogram = metrics.histograms[key];
    histogram.values.push(value);
    histogram.sum += value;
    histogram.count++;
    histogram.min = Math.min(histogram.min, value);
    histogram.max = Math.max(histogram.max, value);
    histogram.lastUpdated = Date.now();

    // Limit histogram size - recalculate stats from retained values for consistency
    if (histogram.values.length > config.maxHistogramSize) {
        histogram.values = histogram.values.slice(-config.maxHistogramSize);
        histogram.count = histogram.values.length;
        histogram.sum = histogram.values.reduce((a, b) => a + b, 0);
        histogram.min = Math.min(...histogram.values);
        histogram.max = Math.max(...histogram.values);
    }
}

/**
 * Create a timer that records duration to a histogram
 * @param {string} name - Histogram name
 * @param {Object} labels - Optional labels
 * @returns {Function} Function to stop the timer and record the duration
 */
function startTimer(name, labels = {}) {
    const start = process.hrtime.bigint();
    return () => {
        const end = process.hrtime.bigint();
        const durationMs = Number(end - start) / 1e6;
        recordHistogram(name, durationMs, labels);
        return durationMs;
    };
}

/**
 * Decorator function to time async functions
 * @param {string} name - Histogram name for timing
 * @param {Object} labels - Optional labels
 * @returns {Function} Decorator function
 */
function timed(name, labels = {}) {
    return function(target, propertyKey, descriptor) {
        const original = descriptor.value;
        descriptor.value = async function(...args) {
            const stopTimer = startTimer(name, {
                ...labels,
                operation: propertyKey
            });
            try {
                return await original.apply(this, args);
            } finally {
                stopTimer();
            }
        };
        return descriptor;
    };
}

/**
 * Wrap an async function with timing
 * @param {Function} fn - Function to wrap
 * @param {string} name - Histogram name
 * @param {Object} labels - Optional labels
 * @returns {Function} Wrapped function
 */
function withTiming(fn, name, labels = {}) {
    return async function(...args) {
        const stopTimer = startTimer(name, labels);
        try {
            return await fn.apply(this, args);
        } finally {
            stopTimer();
        }
    };
}

/**
 * Get histogram statistics
 * @param {string} name - Histogram name
 * @param {Object} labels - Optional labels
 * @returns {Object} Statistics including percentiles
 */
function getHistogramStats(name, labels = {}) {
    const key = createKey(name, labels);
    const histogram = metrics.histograms[key];

    if (!histogram || histogram.count === 0) {
        return null;
    }

    const sorted = [...histogram.values].sort((a, b) => a - b);
    const percentile = (p) => {
        const idx = Math.ceil(sorted.length * p) - 1;
        return sorted[Math.max(0, idx)];
    };

    return {
        count: histogram.count,
        sum: histogram.sum,
        avg: histogram.sum / histogram.count,
        min: histogram.min,
        max: histogram.max,
        p50: percentile(0.5),
        p90: percentile(0.9),
        p95: percentile(0.95),
        p99: percentile(0.99),
        labels: histogram.labels
    };
}

/**
 * Get all metrics in a format suitable for export
 * @returns {Object} All metrics
 */
function getAllMetrics() {
    const result = {
        timestamp: Date.now(),
        instanceId,
        counters: {},
        gauges: {},
        histograms: {}
    };

    // Export counters
    for (const [key, counter] of Object.entries(metrics.counters)) {
        result.counters[key] = {
            value: counter.value,
            labels: counter.labels
        };
    }

    // Export gauges
    for (const [key, gauge] of Object.entries(metrics.gauges)) {
        result.gauges[key] = {
            value: gauge.value,
            labels: gauge.labels
        };
    }

    // Export histogram stats directly from stored histograms
    for (const [key, histogram] of Object.entries(metrics.histograms)) {
        if (!histogram || histogram.count === 0) continue;
        const sorted = [...histogram.values].sort((a, b) => a - b);
        const percentile = (p) => {
            const idx = Math.ceil(sorted.length * p) - 1;
            return sorted[Math.max(0, idx)];
        };
        result.histograms[key] = {
            count: histogram.count,
            sum: histogram.sum,
            avg: histogram.sum / histogram.count,
            min: histogram.min,
            max: histogram.max,
            p50: percentile(0.5),
            p90: percentile(0.9),
            p95: percentile(0.95),
            p99: percentile(0.99),
            labels: histogram.labels
        };
    }

    return result;
}

/**
 * Reset all metrics
 */
function resetMetrics() {
    metrics.counters = {};
    metrics.gauges = {};
    metrics.histograms = {};
}

/**
 * Create a key for metric storage
 */
function createKey(name, labels) {
    const labelStr = Object.entries(labels)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}=${v}`)
        .join(',');
    return labelStr ? `${name}:${labelStr}` : name;
}

// Pre-defined metric names
const METRIC_NAMES = {
    // Counters
    GAMES_STARTED: 'games_started',
    GAMES_COMPLETED: 'games_completed',
    CARDS_REVEALED: 'cards_revealed',
    CLUES_GIVEN: 'clues_given',
    ROOMS_CREATED: 'rooms_created',
    ROOMS_JOINED: 'rooms_joined',
    ERRORS: 'errors',
    RATE_LIMIT_HITS: 'rate_limit_hits',
    // PHASE 5.1: Additional counters for better observability
    HTTP_REQUESTS: 'http_requests_total',
    WEBSOCKET_EVENTS: 'websocket_events_total',
    RECONNECTIONS: 'reconnections_total',
    PLAYER_KICKS: 'player_kicks_total',
    BROADCASTS_SENT: 'broadcasts_sent_total',

    // Gauges
    ACTIVE_ROOMS: 'active_rooms',
    ACTIVE_PLAYERS: 'active_players',
    ACTIVE_GAMES: 'active_games',
    ACTIVE_TIMERS: 'active_timers',
    SOCKET_CONNECTIONS: 'socket_connections',
    REDIS_CONNECTION_STATUS: 'redis_connection_status',
    // PHASE 5.1: Additional gauges for system health
    MEMORY_HEAP_USED: 'memory_heap_used_bytes',
    MEMORY_HEAP_TOTAL: 'memory_heap_total_bytes',
    MEMORY_RSS: 'memory_rss_bytes',
    EVENT_LOOP_LAG: 'event_loop_lag_ms',
    SPECTATORS: 'spectators_total',

    // Histograms
    OPERATION_LATENCY: 'operation_latency_ms',
    REDIS_LATENCY: 'redis_latency_ms',
    GAME_DURATION: 'game_duration_seconds',
    TURN_DURATION: 'turn_duration_seconds',
    SOCKET_EVENT_LATENCY: 'socket_event_latency_ms',
    // PHASE 5.1: Additional histograms
    HTTP_REQUEST_DURATION: 'http_request_duration_ms',
    WEBSOCKET_MESSAGE_SIZE: 'websocket_message_size_bytes'
};

// Convenience functions for common metrics
const trackGameStarted = (roomCode) => incrementCounter(METRIC_NAMES.GAMES_STARTED, 1, { roomCode });
const trackGameCompleted = (roomCode, winner) => incrementCounter(METRIC_NAMES.GAMES_COMPLETED, 1, { roomCode, winner });
const trackCardRevealed = (roomCode, team, cardType) => incrementCounter(METRIC_NAMES.CARDS_REVEALED, 1, { roomCode, team, cardType });
const trackClueGiven = (roomCode, team) => incrementCounter(METRIC_NAMES.CLUES_GIVEN, 1, { roomCode, team });
const trackRoomCreated = () => incrementCounter(METRIC_NAMES.ROOMS_CREATED);
const trackRoomJoined = (roomCode) => incrementCounter(METRIC_NAMES.ROOMS_JOINED, 1, { roomCode });
const trackError = (errorCode, operation) => incrementCounter(METRIC_NAMES.ERRORS, 1, { errorCode, operation });
const trackRateLimitHit = (event) => incrementCounter(METRIC_NAMES.RATE_LIMIT_HITS, 1, { event });

const setActiveRooms = (count) => setGauge(METRIC_NAMES.ACTIVE_ROOMS, count);
const setActivePlayers = (count) => setGauge(METRIC_NAMES.ACTIVE_PLAYERS, count);
const setActiveGames = (count) => setGauge(METRIC_NAMES.ACTIVE_GAMES, count);
const setSocketConnections = (count) => setGauge(METRIC_NAMES.SOCKET_CONNECTIONS, count);

const trackOperationLatency = (operation, durationMs) => recordHistogram(METRIC_NAMES.OPERATION_LATENCY, durationMs, { operation });
const trackRedisLatency = (command, durationMs) => recordHistogram(METRIC_NAMES.REDIS_LATENCY, durationMs, { command });
const trackSocketEventLatency = (event, durationMs) => recordHistogram(METRIC_NAMES.SOCKET_EVENT_LATENCY, durationMs, { event });

// PHASE 5.1: Additional tracking functions
const trackHttpRequest = (method, path, statusCode) => incrementCounter(METRIC_NAMES.HTTP_REQUESTS, 1, { method, path, statusCode: String(statusCode) });
const trackWebsocketEvent = (event, direction = 'in') => incrementCounter(METRIC_NAMES.WEBSOCKET_EVENTS, 1, { event, direction });
const trackReconnection = (roomCode, success) => incrementCounter(METRIC_NAMES.RECONNECTIONS, 1, { roomCode, success: String(success) });
const trackPlayerKick = (roomCode, reason) => incrementCounter(METRIC_NAMES.PLAYER_KICKS, 1, { roomCode, reason });
const trackBroadcast = (type) => incrementCounter(METRIC_NAMES.BROADCASTS_SENT, 1, { type });
const trackHttpRequestDuration = (method, path, durationMs) => recordHistogram(METRIC_NAMES.HTTP_REQUEST_DURATION, durationMs, { method, path });
const trackWebsocketMessageSize = (event, bytes) => recordHistogram(METRIC_NAMES.WEBSOCKET_MESSAGE_SIZE, bytes, { event });
const setSpectatorCount = (count) => setGauge(METRIC_NAMES.SPECTATORS, count);

// PHASE 5.1: Update system metrics (call periodically)
function updateSystemMetrics() {
    const mem = process.memoryUsage();
    setGauge(METRIC_NAMES.MEMORY_HEAP_USED, mem.heapUsed);
    setGauge(METRIC_NAMES.MEMORY_HEAP_TOTAL, mem.heapTotal);
    setGauge(METRIC_NAMES.MEMORY_RSS, mem.rss);
}

// PHASE 5.1: Measure event loop lag
let lastLoopTime = process.hrtime.bigint();
function measureEventLoopLag() {
    const now = process.hrtime.bigint();
    const expected = 100n * 1000000n; // 100ms in nanoseconds
    const actual = now - lastLoopTime;
    const lag = Number(actual - expected) / 1e6; // Convert to ms
    if (lag > 0) {
        setGauge(METRIC_NAMES.EVENT_LOOP_LAG, lag);
    }
    lastLoopTime = now;
}

// Start event loop monitoring (only in non-test environments)
let eventLoopInterval = null;
function startEventLoopMonitoring() {
    if (process.env.NODE_ENV !== 'test' && !eventLoopInterval) {
        eventLoopInterval = setInterval(measureEventLoopLag, 100);
        eventLoopInterval.unref(); // Don't keep process alive
    }
}

function stopEventLoopMonitoring() {
    if (eventLoopInterval) {
        clearInterval(eventLoopInterval);
        eventLoopInterval = null;
    }
}

/**
 * PHASE 5.1: Export metrics in Prometheus text format
 * @returns {string} Prometheus-compatible metrics text
 */
function getPrometheusMetrics() {
    const lines = [];
    const timestamp = Date.now();

    // Add help and type for counters
    for (const [key, counter] of Object.entries(metrics.counters)) {
        const name = key.split(':')[0].replace(/[.-]/g, '_');
        const labelStr = formatPrometheusLabels(counter.labels);
        lines.push(`# TYPE ${name} counter`);
        lines.push(`${name}${labelStr} ${counter.value} ${timestamp}`);
    }

    // Add help and type for gauges
    for (const [key, gauge] of Object.entries(metrics.gauges)) {
        const name = key.split(':')[0].replace(/[.-]/g, '_');
        const labelStr = formatPrometheusLabels(gauge.labels);
        lines.push(`# TYPE ${name} gauge`);
        lines.push(`${name}${labelStr} ${gauge.value} ${timestamp}`);
    }

    // Add histogram summaries
    for (const [key, histogram] of Object.entries(metrics.histograms)) {
        if (!histogram || histogram.count === 0) continue;
        const name = key.split(':')[0].replace(/[.-]/g, '_');
        const baseLabels = histogram.labels || {};
        const sorted = [...histogram.values].sort((a, b) => a - b);
        const percentile = (p) => {
            const idx = Math.ceil(sorted.length * p) - 1;
            return sorted[Math.max(0, idx)];
        };

        lines.push(`# TYPE ${name} summary`);
        lines.push(`${name}_count${formatPrometheusLabels(baseLabels)} ${histogram.count} ${timestamp}`);
        lines.push(`${name}_sum${formatPrometheusLabels(baseLabels)} ${histogram.sum} ${timestamp}`);
        lines.push(`${name}${formatPrometheusLabels({ ...baseLabels, quantile: '0.5' })} ${percentile(0.5)} ${timestamp}`);
        lines.push(`${name}${formatPrometheusLabels({ ...baseLabels, quantile: '0.9' })} ${percentile(0.9)} ${timestamp}`);
        lines.push(`${name}${formatPrometheusLabels({ ...baseLabels, quantile: '0.99' })} ${percentile(0.99)} ${timestamp}`);
    }

    return lines.join('\n');
}

/**
 * Format labels for Prometheus
 */
function formatPrometheusLabels(labels) {
    if (!labels || Object.keys(labels).length === 0) return '';
    const pairs = Object.entries(labels)
        .map(([k, v]) => `${k}="${String(v).replace(/"/g, '\\"')}"`)
        .join(',');
    return `{${pairs}}`;
}

module.exports = {
    // Core functions
    incrementCounter,
    setGauge,
    incrementGauge,
    decrementGauge,
    recordHistogram,
    startTimer,

    // Wrappers
    timed,
    withTiming,

    // Retrieval
    getHistogramStats,
    getAllMetrics,
    resetMetrics,

    // PHASE 5.1: Prometheus export
    getPrometheusMetrics,

    // PHASE 5.1: System monitoring
    updateSystemMetrics,
    startEventLoopMonitoring,
    stopEventLoopMonitoring,

    // Metric names
    METRIC_NAMES,

    // Convenience functions
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
    trackSocketEventLatency,

    // PHASE 5.1: Additional tracking functions
    trackHttpRequest,
    trackWebsocketEvent,
    trackReconnection,
    trackPlayerKick,
    trackBroadcast,
    trackHttpRequestDuration,
    trackWebsocketMessageSize,
    setSpectatorCount
};
