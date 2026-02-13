/**
 * Tests for Pub/Sub Health Monitoring
 */

const pubSubHealth = require('../../utils/pubSubHealth');

describe('pubSubHealth', () => {
    beforeEach(() => {
        pubSubHealth.reset();
    });

    describe('recordSuccess', () => {
        it('should record successful publish operations', () => {
            pubSubHealth.recordSuccess('publish');

            const health = pubSubHealth.getHealth();
            expect(health.totalPublishes).toBe(1);
            expect(health.lastSuccessfulPublish).toBeDefined();
        });

        it('should record successful subscribe operations', () => {
            pubSubHealth.recordSuccess('subscribe');

            const health = pubSubHealth.getHealth();
            expect(health.lastSuccessfulSubscribe).toBeDefined();
        });

        it('should reset consecutive failures on success', () => {
            // First create some failures
            pubSubHealth.recordFailure('publish', new Error('Test error'));
            pubSubHealth.recordFailure('publish', new Error('Test error'));

            let health = pubSubHealth.getHealth();
            expect(health.consecutiveFailures).toBe(2);

            // Success should reset
            pubSubHealth.recordSuccess('publish');

            health = pubSubHealth.getHealth();
            expect(health.consecutiveFailures).toBe(0);
        });

        it('should recover health after consecutive successes', () => {
            // Mark as unhealthy first
            pubSubHealth.recordFailure('publish', new Error('Test'));
            pubSubHealth.recordFailure('publish', new Error('Test'));
            pubSubHealth.recordFailure('publish', new Error('Test'));

            expect(pubSubHealth.isHealthy()).toBe(false);

            // Two successes should recover
            pubSubHealth.recordSuccess('publish');
            pubSubHealth.recordSuccess('publish');

            expect(pubSubHealth.isHealthy()).toBe(true);
        });
    });

    describe('recordFailure', () => {
        it('should record failures and increment counters', () => {
            const error = new Error('Connection lost');
            pubSubHealth.recordFailure('publish', error);

            const health = pubSubHealth.getHealth();
            expect(health.consecutiveFailures).toBe(1);
            expect(health.totalFailures).toBe(1);
            expect(health.lastError).toMatchObject({
                type: 'publish',
                message: 'Connection lost'
            });
        });

        it('should mark unhealthy after threshold failures', () => {
            const error = new Error('Test error');

            // Should still be healthy after 2 failures
            pubSubHealth.recordFailure('publish', error);
            pubSubHealth.recordFailure('publish', error);
            expect(pubSubHealth.isHealthy()).toBe(true);

            // Should become unhealthy after 3rd failure
            pubSubHealth.recordFailure('publish', error);
            expect(pubSubHealth.isHealthy()).toBe(false);
        });

        it('should reset recovery successes on failure', () => {
            // Make unhealthy
            pubSubHealth.recordFailure('publish', new Error('Test'));
            pubSubHealth.recordFailure('publish', new Error('Test'));
            pubSubHealth.recordFailure('publish', new Error('Test'));

            // One success towards recovery
            pubSubHealth.recordSuccess('publish');

            // Failure resets recovery
            pubSubHealth.recordFailure('publish', new Error('Test'));

            // Need 2 more successes to recover now
            pubSubHealth.recordSuccess('publish');
            expect(pubSubHealth.isHealthy()).toBe(false);

            pubSubHealth.recordSuccess('publish');
            expect(pubSubHealth.isHealthy()).toBe(true);
        });
    });

    describe('getHealth', () => {
        it('should return complete health status', () => {
            const health = pubSubHealth.getHealth();

            expect(health).toMatchObject({
                isHealthy: expect.any(Boolean),
                consecutiveFailures: expect.any(Number),
                totalPublishes: expect.any(Number),
                totalFailures: expect.any(Number),
                failureRate: expect.any(String)
            });
        });

        it('should calculate publish age correctly', () => {
            pubSubHealth.recordSuccess('publish');

            const health = pubSubHealth.getHealth();
            expect(health.publishAgeMs).toBeGreaterThanOrEqual(0);
            expect(health.publishAgeMs).toBeLessThan(1000);
        });

        it('should calculate subscribe age correctly', () => {
            pubSubHealth.recordSuccess('subscribe');

            const health = pubSubHealth.getHealth();
            expect(health.subscribeAgeMs).toBeGreaterThanOrEqual(0);
            expect(health.subscribeAgeMs).toBeLessThan(1000);
        });

        it('should return null ages when no operations recorded', () => {
            const health = pubSubHealth.getHealth();
            expect(health.publishAgeMs).toBeNull();
            expect(health.subscribeAgeMs).toBeNull();
        });

        it('should calculate failure rate correctly', () => {
            // 4 successes and 1 failure = 1/4 = 25% failure rate (relative to publishes)
            pubSubHealth.recordSuccess('publish');
            pubSubHealth.recordSuccess('publish');
            pubSubHealth.recordSuccess('publish');
            pubSubHealth.recordSuccess('publish');
            pubSubHealth.recordFailure('publish', new Error('Test'));

            const health = pubSubHealth.getHealth();
            // failureRate = totalFailures / totalPublishes * 100 = 1/4 = 25%
            expect(health.failureRate).toBe('25.00%');
        });

        it('should show 0% failure rate with no publishes', () => {
            const health = pubSubHealth.getHealth();
            expect(health.failureRate).toBe('0%');
        });
    });

    describe('isHealthy', () => {
        it('should return true initially', () => {
            expect(pubSubHealth.isHealthy()).toBe(true);
        });

        it('should return false after multiple failures', () => {
            pubSubHealth.recordFailure('publish', new Error('Test'));
            pubSubHealth.recordFailure('publish', new Error('Test'));
            pubSubHealth.recordFailure('publish', new Error('Test'));

            expect(pubSubHealth.isHealthy()).toBe(false);
        });
    });

    describe('reset', () => {
        it('should reset all state to initial values', () => {
            // Add some state
            pubSubHealth.recordSuccess('publish');
            pubSubHealth.recordSuccess('subscribe');
            pubSubHealth.recordFailure('publish', new Error('Test'));
            pubSubHealth.recordFailure('publish', new Error('Test'));
            pubSubHealth.recordFailure('publish', new Error('Test'));

            // Reset
            pubSubHealth.reset();

            const health = pubSubHealth.getHealth();
            expect(health.isHealthy).toBe(true);
            expect(health.lastSuccessfulPublish).toBeNull();
            expect(health.lastSuccessfulSubscribe).toBeNull();
            expect(health.lastError).toBeNull();
            expect(health.consecutiveFailures).toBe(0);
            expect(health.totalPublishes).toBe(0);
            expect(health.totalFailures).toBe(0);
        });
    });
});
