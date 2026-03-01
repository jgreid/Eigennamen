import logger from './logger';

/**
 * Health status interface
 */
interface HealthStatus {
    isHealthy: boolean;
    lastSuccessfulPublish: number | null;
    lastSuccessfulSubscribe: number | null;
    publishAgeMs: number | null;
    subscribeAgeMs: number | null;
    consecutiveFailures: number;
    totalPublishes: number;
    totalFailures: number;
    failureRate: string;
    lastError: Error | null;
}

/** Timestamp of the last successful pub client PING/event */
let lastPubSuccess: number | null = null;

/** Timestamp of the last successful sub client PING/event */
let lastSubSuccess: number | null = null;

/** Running count of consecutive pub/sub errors */
let consecutiveFailures = 0;

/** Total number of successful PING probes */
let totalPublishes = 0;

/** Total number of failed PING probes or error events */
let totalFailures = 0;

/** Most recent error from either client */
let lastError: Error | null = null;

/** PING interval handle */
let pingInterval: ReturnType<typeof setInterval> | null = null;

/** How often to PING pub/sub clients (ms) */
const PING_INTERVAL_MS = 30_000;

/** Max age (ms) before considering a client stale even without errors */
const MAX_SILENCE_MS = 90_000;

/**
 * Number of consecutive failures before considering pub/sub unhealthy.
 * A single transient error should not flip the health status.
 */
const FAILURE_THRESHOLD = 3;

function recordSuccess(client: 'pub' | 'sub'): void {
    const now = Date.now();
    if (client === 'pub') {
        lastPubSuccess = now;
    } else {
        lastSubSuccess = now;
    }
    consecutiveFailures = 0;
    totalPublishes++;
}

function recordFailure(err: Error): void {
    consecutiveFailures++;
    totalFailures++;
    lastError = err;
}

/**
 * Attach health monitoring to pub/sub Redis clients.
 *
 * Registers 'error' and 'ready' listeners and starts a periodic
 * PING probe. Safe to call multiple times (idempotent: clears
 * previous interval before starting a new one).
 *
 * @param pubClient - The Redis publish client (must support .ping())
 * @param subClient - The Redis subscribe client (must support .ping())
 */
function attachToClients(
    pubClient: {
        on: (event: string, cb: (...args: unknown[]) => void) => void;
        removeAllListeners?: (event: string) => void;
        ping: () => Promise<string>;
    },
    subClient: {
        on: (event: string, cb: (...args: unknown[]) => void) => void;
        removeAllListeners?: (event: string) => void;
        ping: () => Promise<string>;
    }
): void {
    // Mark both as healthy on attach (they just connected)
    const now = Date.now();
    lastPubSuccess = now;
    lastSubSuccess = now;
    consecutiveFailures = 0;

    // Remove prior listeners to prevent accumulation on reconnection
    if (pubClient.removeAllListeners) {
        pubClient.removeAllListeners('error');
        pubClient.removeAllListeners('ready');
    }
    if (subClient.removeAllListeners) {
        subClient.removeAllListeners('error');
        subClient.removeAllListeners('ready');
    }

    // Listen for client-level errors
    pubClient.on('error', (err: unknown) => {
        recordFailure(err instanceof Error ? err : new Error(String(err)));
    });
    subClient.on('error', (err: unknown) => {
        recordFailure(err instanceof Error ? err : new Error(String(err)));
    });

    // Listen for ready events (reconnection success)
    pubClient.on('ready', () => recordSuccess('pub'));
    subClient.on('ready', () => recordSuccess('sub'));

    // Start periodic PING probes
    stopPingInterval();
    pingInterval = setInterval(() => {
        pingClients(pubClient, subClient);
    }, PING_INTERVAL_MS);

    // Don't hold the process open for health pings
    if (pingInterval && typeof pingInterval === 'object' && 'unref' in pingInterval) {
        pingInterval.unref();
    }
}

/**
 * PING both pub/sub clients and record success/failure.
 * Exported for testing; normally called by the interval.
 */
async function pingClients(
    pubClient: { ping: () => Promise<string> },
    subClient: { ping: () => Promise<string> }
): Promise<void> {
    try {
        await pubClient.ping();
        recordSuccess('pub');
    } catch (err) {
        recordFailure(err instanceof Error ? err : new Error(String(err)));
        logger.warn('Pub/sub health: pub client PING failed', (err as Error).message);
    }

    try {
        await subClient.ping();
        recordSuccess('sub');
    } catch (err) {
        recordFailure(err instanceof Error ? err : new Error(String(err)));
        logger.warn('Pub/sub health: sub client PING failed', (err as Error).message);
    }
}

/**
 * Get current pub/sub health status.
 * @returns Health status object
 */
function getHealth(): HealthStatus {
    const now = Date.now();
    const pubAge = lastPubSuccess !== null ? now - lastPubSuccess : null;
    const subAge = lastSubSuccess !== null ? now - lastSubSuccess : null;

    // Unhealthy if:
    //  - consecutive failures >= threshold, OR
    //  - either client hasn't been heard from in MAX_SILENCE_MS
    //    (but only if we've attached — null means we haven't attached yet,
    //     which is treated as healthy to avoid false alarms during startup)
    const failureUnhealthy = consecutiveFailures >= FAILURE_THRESHOLD;
    const pubStale = pubAge !== null && pubAge > MAX_SILENCE_MS;
    const subStale = subAge !== null && subAge > MAX_SILENCE_MS;

    const isHealthy = !failureUnhealthy && !pubStale && !subStale;

    const total = totalPublishes + totalFailures;
    const failureRate = total > 0 ? `${((totalFailures / total) * 100).toFixed(1)}%` : '0%';

    return {
        isHealthy,
        lastSuccessfulPublish: lastPubSuccess,
        lastSuccessfulSubscribe: lastSubSuccess,
        publishAgeMs: pubAge,
        subscribeAgeMs: subAge,
        consecutiveFailures,
        totalPublishes,
        totalFailures,
        failureRate,
        lastError,
    };
}

/**
 * Stop the periodic PING interval.
 * Safe to call even if no interval is running.
 */
function stopPingInterval(): void {
    if (pingInterval) {
        clearInterval(pingInterval);
        pingInterval = null;
    }
}

/**
 * Reset all tracking state (for testing).
 */
function reset(): void {
    stopPingInterval();
    lastPubSuccess = null;
    lastSubSuccess = null;
    consecutiveFailures = 0;
    totalPublishes = 0;
    totalFailures = 0;
    lastError = null;
}

export {
    getHealth,
    attachToClients,
    pingClients,
    stopPingInterval,
    reset,
    FAILURE_THRESHOLD,
    MAX_SILENCE_MS,
    PING_INTERVAL_MS,
};

export type { HealthStatus };
