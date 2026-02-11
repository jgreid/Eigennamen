/**
 * Application Metrics Collection
 *
 * Provides counters, gauges, and histograms for monitoring application performance.
 * Thread-safe and supports periodic reporting.
 */

/**
 * Labels for metrics
 */
interface MetricLabels {
    [key: string]: string;
}

/**
 * Counter metric interface
 */
interface CounterMetric {
    value: number;
    labels: MetricLabels;
    createdAt: number;
    lastUpdated?: number;
}

/**
 * Gauge metric interface
 */
interface GaugeMetric {
    value: number;
    labels: MetricLabels;
    createdAt?: number;
    lastUpdated: number;
}

/**
 * Histogram metric interface
 */
interface HistogramMetric {
    values: number[];
    sum: number;
    count: number;
    min: number;
    max: number;
    labels: MetricLabels;
    createdAt: number;
    lastUpdated?: number;
}

/**
 * Metrics storage interface
 */
interface MetricsStorage {
    counters: Record<string, CounterMetric>;
    gauges: Record<string, GaugeMetric>;
    histograms: Record<string, HistogramMetric>;
}

/**
 * Histogram statistics interface
 */
interface HistogramStats {
    count: number;
    sum: number;
    avg: number;
    min: number;
    max: number;
    p50: number;
    p90: number;
    p95: number;
    p99: number;
    labels: MetricLabels;
}

/**
 * All metrics export interface
 */
interface AllMetrics {
    timestamp: number;
    instanceId: string;
    counters: Record<string, { value: number; labels: MetricLabels }>;
    gauges: Record<string, { value: number; labels: MetricLabels }>;
    histograms: Record<string, HistogramStats>;
}

/**
 * Configuration interface
 */
interface MetricsConfig {
    histogramBuckets: number[];
    maxHistogramSize: number;
    reportingInterval: number;
}

// Metrics storage
const metrics: MetricsStorage = {
    counters: {},
    gauges: {},
    histograms: {}
};

// Configuration
const config: MetricsConfig = {
    histogramBuckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
    maxHistogramSize: 1000,
    reportingInterval: 60000 // 1 minute
};

// Instance ID for distributed metrics
const instanceId: string = process.env.FLY_ALLOC_ID || process.env.INSTANCE_ID || 'local';

/**
 * Increment a counter
 * @param name - Counter name
 * @param value - Value to add (default 1)
 * @param labels - Optional labels
 */
function incrementCounter(name: string, value: number = 1, labels: MetricLabels = {}): void {
    const key = createKey(name, labels);
    if (!metrics.counters[key]) {
        metrics.counters[key] = { value: 0, labels, createdAt: Date.now() };
    }
    metrics.counters[key].value += value;
    metrics.counters[key].lastUpdated = Date.now();
}

/**
 * Set a gauge value
 * @param name - Gauge name
 * @param value - Current value
 * @param labels - Optional labels
 */
function setGauge(name: string, value: number, labels: MetricLabels = {}): void {
    const key = createKey(name, labels);
    metrics.gauges[key] = {
        value,
        labels,
        lastUpdated: Date.now()
    };
}

/**
 * Increment a gauge
 * @param name - Gauge name
 * @param value - Value to add (default 1)
 * @param labels - Optional labels
 */
function incrementGauge(name: string, value: number = 1, labels: MetricLabels = {}): void {
    const key = createKey(name, labels);
    if (!metrics.gauges[key]) {
        metrics.gauges[key] = { value: 0, labels, createdAt: Date.now(), lastUpdated: Date.now() };
    }
    metrics.gauges[key].value += value;
    metrics.gauges[key].lastUpdated = Date.now();
}

/**
 * Decrement a gauge
 * @param name - Gauge name
 * @param value - Value to subtract (default 1)
 * @param labels - Optional labels
 */
function decrementGauge(name: string, value: number = 1, labels: MetricLabels = {}): void {
    incrementGauge(name, -value, labels);
}

/**
 * Record a histogram value
 * @param name - Histogram name
 * @param value - Observed value
 * @param labels - Optional labels
 */
function recordHistogram(name: string, value: number, labels: MetricLabels = {}): void {
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
 * Timer stop function type
 */
type TimerStopFunction = () => number;

/**
 * Create a timer that records duration to a histogram
 * @param name - Histogram name
 * @param labels - Optional labels
 * @returns Function to stop the timer and record the duration
 */
function startTimer(name: string, labels: MetricLabels = {}): TimerStopFunction {
    const start = process.hrtime.bigint();
    return (): number => {
        const end = process.hrtime.bigint();
        const durationMs = Number(end - start) / 1e6;
        recordHistogram(name, durationMs, labels);
        return durationMs;
    };
}

/**
 * Decorator function to time async functions
 * @param name - Histogram name for timing
 * @param labels - Optional labels
 * @returns Decorator function
 */
function timed(name: string, labels: MetricLabels = {}): MethodDecorator {
    return function(_target: unknown, propertyKey: string | symbol, descriptor: PropertyDescriptor): PropertyDescriptor {
        const original = descriptor.value;
        descriptor.value = async function(this: unknown, ...args: unknown[]): Promise<unknown> {
            const stopTimer = startTimer(name, {
                ...labels,
                operation: String(propertyKey)
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
 * Async function type for withTiming
 */
type AsyncFunction<T> = (...args: unknown[]) => Promise<T>;

/**
 * Wrap an async function with timing
 * @param fn - Function to wrap
 * @param name - Histogram name
 * @param labels - Optional labels
 * @returns Wrapped function
 */
function withTiming<T>(fn: AsyncFunction<T>, name: string, labels: MetricLabels = {}): AsyncFunction<T> {
    return async function(this: unknown, ...args: unknown[]): Promise<T> {
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
 * @param name - Histogram name
 * @param labels - Optional labels
 * @returns Statistics including percentiles
 */
function getHistogramStats(name: string, labels: MetricLabels = {}): HistogramStats | null {
    const key = createKey(name, labels);
    const histogram = metrics.histograms[key];

    if (!histogram || histogram.count === 0) {
        return null;
    }

    const sorted = [...histogram.values].sort((a, b) => a - b);
    const percentile = (p: number): number => {
        const idx = Math.ceil(sorted.length * p) - 1;
        return sorted[Math.max(0, idx)] ?? 0;
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
 * @returns All metrics
 */
function getAllMetrics(): AllMetrics {
    const result: AllMetrics = {
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
        const percentile = (p: number): number => {
            const idx = Math.ceil(sorted.length * p) - 1;
            return sorted[Math.max(0, idx)] ?? 0;
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
function resetMetrics(): void {
    metrics.counters = {};
    metrics.gauges = {};
    metrics.histograms = {};
}

/**
 * Create a key for metric storage
 */
function createKey(name: string, labels: MetricLabels): string {
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
    // Additional counters for better observability
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
    // Additional gauges for system health
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
    // Additional histograms
    HTTP_REQUEST_DURATION: 'http_request_duration_ms',
    WEBSOCKET_MESSAGE_SIZE: 'websocket_message_size_bytes'
} as const;

type MetricName = typeof METRIC_NAMES[keyof typeof METRIC_NAMES];

// Convenience functions for common metrics
const trackGameStarted = (roomCode: string): void => incrementCounter(METRIC_NAMES.GAMES_STARTED, 1, { roomCode });
const trackGameCompleted = (roomCode: string, winner: string): void => incrementCounter(METRIC_NAMES.GAMES_COMPLETED, 1, { roomCode, winner });
const trackCardRevealed = (roomCode: string, team: string, cardType: string): void => incrementCounter(METRIC_NAMES.CARDS_REVEALED, 1, { roomCode, team, cardType });
const trackClueGiven = (roomCode: string, team: string): void => incrementCounter(METRIC_NAMES.CLUES_GIVEN, 1, { roomCode, team });
const trackRoomCreated = (): void => incrementCounter(METRIC_NAMES.ROOMS_CREATED);
const trackRoomJoined = (roomCode: string): void => incrementCounter(METRIC_NAMES.ROOMS_JOINED, 1, { roomCode });
const trackError = (errorCode: string, operation: string): void => incrementCounter(METRIC_NAMES.ERRORS, 1, { errorCode, operation });
const trackRateLimitHit = (event: string): void => incrementCounter(METRIC_NAMES.RATE_LIMIT_HITS, 1, { event });

const setActiveRooms = (count: number): void => setGauge(METRIC_NAMES.ACTIVE_ROOMS, count);
const setActivePlayers = (count: number): void => setGauge(METRIC_NAMES.ACTIVE_PLAYERS, count);
const setActiveGames = (count: number): void => setGauge(METRIC_NAMES.ACTIVE_GAMES, count);
const setSocketConnections = (count: number): void => setGauge(METRIC_NAMES.SOCKET_CONNECTIONS, count);

const trackOperationLatency = (operation: string, durationMs: number): void => recordHistogram(METRIC_NAMES.OPERATION_LATENCY, durationMs, { operation });
const trackRedisLatency = (command: string, durationMs: number): void => recordHistogram(METRIC_NAMES.REDIS_LATENCY, durationMs, { command });
const trackSocketEventLatency = (event: string, durationMs: number): void => recordHistogram(METRIC_NAMES.SOCKET_EVENT_LATENCY, durationMs, { event });

// Additional tracking functions
const trackHttpRequest = (method: string, path: string, statusCode: number): void => incrementCounter(METRIC_NAMES.HTTP_REQUESTS, 1, { method, path, statusCode: String(statusCode) });
const trackWebsocketEvent = (event: string, direction: string = 'in'): void => incrementCounter(METRIC_NAMES.WEBSOCKET_EVENTS, 1, { event, direction });
const trackReconnection = (roomCode: string, success: boolean): void => incrementCounter(METRIC_NAMES.RECONNECTIONS, 1, { roomCode, success: String(success) });
const trackPlayerKick = (roomCode: string, reason: string): void => incrementCounter(METRIC_NAMES.PLAYER_KICKS, 1, { roomCode, reason });
const trackBroadcast = (type: string): void => incrementCounter(METRIC_NAMES.BROADCASTS_SENT, 1, { type });
const trackHttpRequestDuration = (method: string, path: string, durationMs: number): void => recordHistogram(METRIC_NAMES.HTTP_REQUEST_DURATION, durationMs, { method, path });
const trackWebsocketMessageSize = (event: string, bytes: number): void => recordHistogram(METRIC_NAMES.WEBSOCKET_MESSAGE_SIZE, bytes, { event });
const setSpectatorCount = (count: number): void => setGauge(METRIC_NAMES.SPECTATORS, count);

// Update system metrics (call periodically)
function updateSystemMetrics(): void {
    const mem = process.memoryUsage();
    setGauge(METRIC_NAMES.MEMORY_HEAP_USED, mem.heapUsed);
    setGauge(METRIC_NAMES.MEMORY_HEAP_TOTAL, mem.heapTotal);
    setGauge(METRIC_NAMES.MEMORY_RSS, mem.rss);
}

// Measure event loop lag
let lastLoopTime = process.hrtime.bigint();
function measureEventLoopLag(): void {
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
let eventLoopInterval: ReturnType<typeof setInterval> | null = null;
function startEventLoopMonitoring(): void {
    if (process.env.NODE_ENV !== 'test' && !eventLoopInterval) {
        eventLoopInterval = setInterval(measureEventLoopLag, 100);
        eventLoopInterval.unref(); // Don't keep process alive
    }
}

function stopEventLoopMonitoring(): void {
    if (eventLoopInterval) {
        clearInterval(eventLoopInterval);
        eventLoopInterval = null;
    }
}

/**
 * Export metrics in Prometheus text format
 * @returns Prometheus-compatible metrics text
 */
function getPrometheusMetrics(): string {
    const lines: string[] = [];
    const timestamp = Date.now();

    // Add help and type for counters
    for (const [key, counter] of Object.entries(metrics.counters)) {
        if (!counter) continue;
        const name = key.split(':')[0]?.replace(/[.-]/g, '_') ?? key;
        const labelStr = formatPrometheusLabels(counter.labels);
        lines.push(`# TYPE ${name} counter`);
        lines.push(`${name}${labelStr} ${counter.value} ${timestamp}`);
    }

    // Add help and type for gauges
    for (const [key, gauge] of Object.entries(metrics.gauges)) {
        if (!gauge) continue;
        const name = key.split(':')[0]?.replace(/[.-]/g, '_') ?? key;
        const labelStr = formatPrometheusLabels(gauge.labels);
        lines.push(`# TYPE ${name} gauge`);
        lines.push(`${name}${labelStr} ${gauge.value} ${timestamp}`);
    }

    // Add histogram summaries
    for (const [key, histogram] of Object.entries(metrics.histograms)) {
        if (!histogram || histogram.count === 0) continue;
        const name = key.split(':')[0]?.replace(/[.-]/g, '_') ?? key;
        const baseLabels = histogram.labels || {};
        const sorted = [...histogram.values].sort((a, b) => a - b);
        const percentile = (p: number): number => {
            const idx = Math.ceil(sorted.length * p) - 1;
            return sorted[Math.max(0, idx)] ?? 0;
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
function formatPrometheusLabels(labels: MetricLabels): string {
    if (!labels || Object.keys(labels).length === 0) return '';
    const pairs = Object.entries(labels)
        .map(([k, v]) => `${k}="${String(v).replace(/"/g, '\\"')}"`)
        .join(',');
    return `{${pairs}}`;
}

// ES6 exports
export {
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
    trackSocketEventLatency,
    trackHttpRequest,
    trackWebsocketEvent,
    trackReconnection,
    trackPlayerKick,
    trackBroadcast,
    trackHttpRequestDuration,
    trackWebsocketMessageSize,
    setSpectatorCount
};

export type {
    MetricLabels,
    CounterMetric,
    GaugeMetric,
    HistogramMetric,
    MetricsStorage,
    HistogramStats,
    AllMetrics,
    MetricsConfig,
    MetricName,
    TimerStopFunction,
    AsyncFunction
};
