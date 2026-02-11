/**
 * Pub/Sub Health Monitoring
 *
 * Tracks the health of Redis pub/sub connections for monitoring and health checks.
 * Used by the timer service and other pub/sub consumers to report connection status.
 */

import logger from './logger';
/**
 * Last error interface
 */
interface LastError {
    type: string;
    message: string;
    timestamp: number;
}

/**
 * Health state interface
 */
interface HealthState {
    isHealthy: boolean;
    lastSuccessfulPublish: number | null;
    lastSuccessfulSubscribe: number | null;
    lastError: LastError | null;
    consecutiveFailures: number;
    totalPublishes: number;
    totalFailures: number;
}

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
    lastError: LastError | null;
}

// Health state
const healthState: HealthState = {
    isHealthy: true,
    lastSuccessfulPublish: null,
    lastSuccessfulSubscribe: null,
    lastError: null,
    consecutiveFailures: 0,
    totalPublishes: 0,
    totalFailures: 0
};

// Thresholds
const UNHEALTHY_FAILURE_THRESHOLD = 3;
const RECOVERY_SUCCESS_THRESHOLD = 2;

let recoverySuccesses = 0;

/**
 * Operation type for pub/sub operations
 */
type OperationType = 'publish' | 'subscribe';

/**
 * Record a successful pub/sub operation
 * @param operationType - 'publish' or 'subscribe'
 */
function recordSuccess(operationType: OperationType): void {
    const now = Date.now();

    if (operationType === 'publish') {
        healthState.lastSuccessfulPublish = now;
        healthState.totalPublishes++;
    } else if (operationType === 'subscribe') {
        healthState.lastSuccessfulSubscribe = now;
    }

    // Track recovery
    if (!healthState.isHealthy) {
        recoverySuccesses++;
        if (recoverySuccesses >= RECOVERY_SUCCESS_THRESHOLD) {
            healthState.isHealthy = true;
            healthState.consecutiveFailures = 0;
            recoverySuccesses = 0;
            logger.info('Pub/sub health recovered after consecutive successes');
        }
    } else {
        healthState.consecutiveFailures = 0;
    }
}

/**
 * Record a failed pub/sub operation
 * @param operationType - 'publish' or 'subscribe'
 * @param error - The error that occurred
 */
function recordFailure(operationType: OperationType, error: Error): void {
    healthState.consecutiveFailures++;
    healthState.totalFailures++;
    healthState.lastError = {
        type: operationType,
        message: error.message,
        timestamp: Date.now()
    };

    recoverySuccesses = 0;

    if (healthState.consecutiveFailures >= UNHEALTHY_FAILURE_THRESHOLD) {
        if (healthState.isHealthy) {
            healthState.isHealthy = false;
            logger.error('Pub/sub marked unhealthy after consecutive failures', {
                consecutiveFailures: healthState.consecutiveFailures,
                lastError: error.message
            });
        }
    }
}

/**
 * Get current pub/sub health status
 * @returns Health status object
 */
function getHealth(): HealthStatus {
    const now = Date.now();
    const publishAge = healthState.lastSuccessfulPublish
        ? now - healthState.lastSuccessfulPublish
        : null;
    const subscribeAge = healthState.lastSuccessfulSubscribe
        ? now - healthState.lastSuccessfulSubscribe
        : null;

    return {
        isHealthy: healthState.isHealthy,
        lastSuccessfulPublish: healthState.lastSuccessfulPublish,
        lastSuccessfulSubscribe: healthState.lastSuccessfulSubscribe,
        publishAgeMs: publishAge,
        subscribeAgeMs: subscribeAge,
        consecutiveFailures: healthState.consecutiveFailures,
        totalPublishes: healthState.totalPublishes,
        totalFailures: healthState.totalFailures,
        failureRate: healthState.totalPublishes > 0
            ? ((healthState.totalFailures / healthState.totalPublishes) * 100).toFixed(2) + '%'
            : '0%',
        lastError: healthState.lastError
    };
}

/**
 * Check if pub/sub is healthy
 * @returns True if healthy
 */
function isHealthy(): boolean {
    return healthState.isHealthy;
}

/**
 * Reset health state (for testing)
 */
function reset(): void {
    healthState.isHealthy = true;
    healthState.lastSuccessfulPublish = null;
    healthState.lastSuccessfulSubscribe = null;
    healthState.lastError = null;
    healthState.consecutiveFailures = 0;
    healthState.totalPublishes = 0;
    healthState.totalFailures = 0;
    recoverySuccesses = 0;
}
// ES6 exports for TypeScript imports
export {
    recordSuccess,
    recordFailure,
    getHealth,
    isHealthy,
    reset
};

export type { LastError, HealthState, HealthStatus, OperationType };
