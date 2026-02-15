/**
 * Pub/Sub Health Monitoring
 *
 * Reports pub/sub health status for health check endpoints.
 */

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

/**
 * Get current pub/sub health status
 * @returns Health status object
 */
function getHealth(): HealthStatus {
    return {
        isHealthy: true,
        lastSuccessfulPublish: null,
        lastSuccessfulSubscribe: null,
        publishAgeMs: null,
        subscribeAgeMs: null,
        consecutiveFailures: 0,
        totalPublishes: 0,
        totalFailures: 0,
        failureRate: '0%',
        lastError: null
    };
}

export { getHealth };

export type { HealthStatus };
