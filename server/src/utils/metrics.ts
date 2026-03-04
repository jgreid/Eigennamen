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
    histograms: {},
};

// Configuration
const config: MetricsConfig = {
    histogramBuckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
    maxHistogramSize: 1000,
    reportingInterval: 60000, // 1 minute
};

// Instance ID for distributed metrics — shared constant from config/env
import { instanceId } from '../config/env';

/**
 * Calculate a percentile value from a sorted array of numbers.
 */
function calculatePercentile(sorted: number[], p: number): number {
    const idx = Math.ceil(sorted.length * p) - 1;
    return sorted[Math.max(0, idx)] ?? 0;
}

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
        lastUpdated: Date.now(),
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
            createdAt: Date.now(),
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

    return {
        count: histogram.count,
        sum: histogram.sum,
        avg: histogram.sum / histogram.count,
        min: histogram.min,
        max: histogram.max,
        p50: calculatePercentile(sorted, 0.5),
        p90: calculatePercentile(sorted, 0.9),
        p95: calculatePercentile(sorted, 0.95),
        p99: calculatePercentile(sorted, 0.99),
        labels: histogram.labels,
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
        histograms: {},
    };

    // Export counters
    for (const [key, counter] of Object.entries(metrics.counters)) {
        result.counters[key] = {
            value: counter.value,
            labels: counter.labels,
        };
    }

    // Export gauges
    for (const [key, gauge] of Object.entries(metrics.gauges)) {
        result.gauges[key] = {
            value: gauge.value,
            labels: gauge.labels,
        };
    }

    // Export histogram stats directly from stored histograms
    for (const [key, histogram] of Object.entries(metrics.histograms)) {
        if (!histogram || histogram.count === 0) continue;
        const sorted = [...histogram.values].sort((a, b) => a - b);
        result.histograms[key] = {
            count: histogram.count,
            sum: histogram.sum,
            avg: histogram.sum / histogram.count,
            min: histogram.min,
            max: histogram.max,
            p50: calculatePercentile(sorted, 0.5),
            p90: calculatePercentile(sorted, 0.9),
            p95: calculatePercentile(sorted, 0.95),
            p99: calculatePercentile(sorted, 0.99),
            labels: histogram.labels,
        };
    }

    return result;
}

/**
 * Prune stale metrics that haven't been updated within the given window.
 * Prevents unbounded growth of metric keys on long-running servers.
 * @param maxAgeMs - Maximum age in ms before a metric is pruned (default: 1 hour)
 */
function pruneStaleMetrics(maxAgeMs: number = 3600000): void {
    const now = Date.now();

    for (const key of Object.keys(metrics.counters)) {
        const counter = metrics.counters[key];
        if (counter && now - (counter.lastUpdated || counter.createdAt) > maxAgeMs) {
            delete metrics.counters[key];
        }
    }

    for (const key of Object.keys(metrics.gauges)) {
        const gauge = metrics.gauges[key];
        if (gauge && now - gauge.lastUpdated > maxAgeMs) {
            delete metrics.gauges[key];
        }
    }

    for (const key of Object.keys(metrics.histograms)) {
        const histogram = metrics.histograms[key];
        if (histogram && now - (histogram.lastUpdated || histogram.createdAt) > maxAgeMs) {
            delete metrics.histograms[key];
        }
    }
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
    HISTORY_ENTRIES_DROPPED: 'history_entries_dropped_total',

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
    CLEANUP_QUEUE_DEPTH: 'cleanup_queue_depth',
    TIMER_SWEEP_ORPHANS: 'timer_sweep_orphans',

    // Histograms
    OPERATION_LATENCY: 'operation_latency_ms',
    REDIS_LATENCY: 'redis_latency_ms',
    GAME_DURATION: 'game_duration_seconds',
    TURN_DURATION: 'turn_duration_seconds',
    SOCKET_EVENT_LATENCY: 'socket_event_latency_ms',
    // Additional histograms
    HTTP_REQUEST_DURATION: 'http_request_duration_ms',
    WEBSOCKET_MESSAGE_SIZE: 'websocket_message_size_bytes',
} as const;

type MetricName = (typeof METRIC_NAMES)[keyof typeof METRIC_NAMES];

// Update system metrics (call periodically)
function updateSystemMetrics(): void {
    const mem = process.memoryUsage();
    setGauge(METRIC_NAMES.MEMORY_HEAP_USED, mem.heapUsed);
    setGauge(METRIC_NAMES.MEMORY_HEAP_TOTAL, mem.heapTotal);
    setGauge(METRIC_NAMES.MEMORY_RSS, mem.rss);
}

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
        lines.push(
            `${name}${formatPrometheusLabels({ ...baseLabels, quantile: '0.5' })} ${percentile(0.5)} ${timestamp}`
        );
        lines.push(
            `${name}${formatPrometheusLabels({ ...baseLabels, quantile: '0.9' })} ${percentile(0.9)} ${timestamp}`
        );
        lines.push(
            `${name}${formatPrometheusLabels({ ...baseLabels, quantile: '0.99' })} ${percentile(0.99)} ${timestamp}`
        );
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

export {
    incrementCounter,
    setGauge,
    incrementGauge,
    recordHistogram,
    getHistogramStats,
    getAllMetrics,
    resetMetrics,
    pruneStaleMetrics,
    getPrometheusMetrics,
    updateSystemMetrics,
    METRIC_NAMES,
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
};
