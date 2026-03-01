/**
 * Pub/Sub Health Monitoring Tests
 */

jest.mock('../../utils/logger', () => ({
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
}));

const {
    getHealth,
    attachToClients,
    pingClients,
    stopPingInterval,
    reset,
    FAILURE_THRESHOLD,
    MAX_SILENCE_MS,
} = require('../../utils/pubSubHealth');

describe('pubSubHealth', () => {
    beforeEach(() => {
        reset();
        jest.useFakeTimers();
    });

    afterEach(() => {
        reset();
        jest.useRealTimers();
    });

    function createMockClient() {
        const listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
        return {
            on: jest.fn((event: string, cb: (...args: unknown[]) => void) => {
                if (!listeners[event]) listeners[event] = [];
                listeners[event].push(cb);
            }),
            ping: jest.fn().mockResolvedValue('PONG'),
            _emit(event: string, ...args: unknown[]) {
                (listeners[event] || []).forEach((cb) => cb(...args));
            },
        };
    }

    describe('getHealth (default state)', () => {
        test('returns healthy when not attached', () => {
            const health = getHealth();
            expect(health.isHealthy).toBe(true);
            expect(health.consecutiveFailures).toBe(0);
            expect(health.totalPublishes).toBe(0);
            expect(health.totalFailures).toBe(0);
            expect(health.failureRate).toBe('0%');
            expect(health.lastError).toBeNull();
            expect(health.lastSuccessfulPublish).toBeNull();
            expect(health.lastSuccessfulSubscribe).toBeNull();
        });
    });

    describe('attachToClients', () => {
        test('marks clients as healthy on attach', () => {
            const pub = createMockClient();
            const sub = createMockClient();

            attachToClients(pub, sub);

            const health = getHealth();
            expect(health.isHealthy).toBe(true);
            expect(health.lastSuccessfulPublish).not.toBeNull();
            expect(health.lastSuccessfulSubscribe).not.toBeNull();
        });

        test('registers error and ready listeners', () => {
            const pub = createMockClient();
            const sub = createMockClient();

            attachToClients(pub, sub);

            expect(pub.on).toHaveBeenCalledWith('error', expect.any(Function));
            expect(pub.on).toHaveBeenCalledWith('ready', expect.any(Function));
            expect(sub.on).toHaveBeenCalledWith('error', expect.any(Function));
            expect(sub.on).toHaveBeenCalledWith('ready', expect.any(Function));
        });

        test('error events increment consecutive failures', () => {
            const pub = createMockClient();
            const sub = createMockClient();

            attachToClients(pub, sub);

            pub._emit('error', new Error('pub error'));
            sub._emit('error', new Error('sub error'));

            const health = getHealth();
            expect(health.consecutiveFailures).toBe(2);
            expect(health.totalFailures).toBe(2);
            expect(health.lastError).toBeInstanceOf(Error);
            expect(health.lastError.message).toBe('sub error');
        });

        test('error events with non-Error values are wrapped', () => {
            const pub = createMockClient();
            const sub = createMockClient();

            attachToClients(pub, sub);
            pub._emit('error', 'string error');

            const health = getHealth();
            expect(health.lastError).toBeInstanceOf(Error);
            expect(health.lastError.message).toBe('string error');
        });

        test('ready events reset consecutive failures', () => {
            const pub = createMockClient();
            const sub = createMockClient();

            attachToClients(pub, sub);

            pub._emit('error', new Error('err1'));
            pub._emit('error', new Error('err2'));
            expect(getHealth().consecutiveFailures).toBe(2);

            pub._emit('ready');
            expect(getHealth().consecutiveFailures).toBe(0);
        });

        test('is idempotent (clears previous interval)', () => {
            const pub = createMockClient();
            const sub = createMockClient();

            attachToClients(pub, sub);
            attachToClients(pub, sub); // should not throw or double-interval
        });
    });

    describe('pingClients', () => {
        test('records success on successful PING', async () => {
            const pub = { ping: jest.fn().mockResolvedValue('PONG') };
            const sub = { ping: jest.fn().mockResolvedValue('PONG') };

            await pingClients(pub, sub);

            const health = getHealth();
            expect(health.totalPublishes).toBe(2);
            expect(health.consecutiveFailures).toBe(0);
            expect(health.lastSuccessfulPublish).not.toBeNull();
            expect(health.lastSuccessfulSubscribe).not.toBeNull();
        });

        test('records failure on pub PING error', async () => {
            const pub = { ping: jest.fn().mockRejectedValue(new Error('pub down')) };
            const sub = { ping: jest.fn().mockResolvedValue('PONG') };

            await pingClients(pub, sub);

            const health = getHealth();
            // pub fails (+1), sub succeeds (resets to 0)
            expect(health.consecutiveFailures).toBe(0);
            expect(health.totalFailures).toBe(1);
        });

        test('records failure on sub PING error', async () => {
            const pub = { ping: jest.fn().mockResolvedValue('PONG') };
            const sub = { ping: jest.fn().mockRejectedValue(new Error('sub down')) };

            await pingClients(pub, sub);

            const health = getHealth();
            expect(health.consecutiveFailures).toBe(1);
            expect(health.totalFailures).toBe(1);
        });

        test('both failing keeps incrementing', async () => {
            const pub = { ping: jest.fn().mockRejectedValue(new Error('down')) };
            const sub = { ping: jest.fn().mockRejectedValue(new Error('down')) };

            await pingClients(pub, sub);

            const health = getHealth();
            expect(health.consecutiveFailures).toBe(2);
            expect(health.totalFailures).toBe(2);
        });
    });

    describe('getHealth - unhealthy detection', () => {
        test('unhealthy after FAILURE_THRESHOLD consecutive failures', async () => {
            const pub = { ping: jest.fn().mockRejectedValue(new Error('down')) };
            const sub = { ping: jest.fn().mockRejectedValue(new Error('down')) };

            for (let i = 0; i < Math.ceil(FAILURE_THRESHOLD / 2); i++) {
                await pingClients(pub, sub);
            }

            const health = getHealth();
            expect(health.consecutiveFailures).toBeGreaterThanOrEqual(FAILURE_THRESHOLD);
            expect(health.isHealthy).toBe(false);
        });

        test('unhealthy when pub client goes stale', () => {
            const pub = createMockClient();
            const sub = createMockClient();
            attachToClients(pub, sub);

            jest.advanceTimersByTime(MAX_SILENCE_MS + 1000);

            const health = getHealth();
            expect(health.isHealthy).toBe(false);
        });

        test('healthy when not attached (no stale detection)', () => {
            jest.advanceTimersByTime(MAX_SILENCE_MS + 1000);

            const health = getHealth();
            expect(health.isHealthy).toBe(true);
        });

        test('failure rate is calculated correctly', async () => {
            const pub = { ping: jest.fn().mockResolvedValue('PONG') };
            const sub = { ping: jest.fn().mockResolvedValue('PONG') };

            // 2 successes
            await pingClients(pub, sub);

            // 1 failure
            sub.ping.mockRejectedValueOnce(new Error('fail'));
            await pingClients(pub, sub);

            const health = getHealth();
            // total: 3 successes + 1 failure = 4
            expect(health.totalPublishes).toBe(3);
            expect(health.totalFailures).toBe(1);
            expect(health.failureRate).toBe('25.0%');
        });
    });

    describe('stopPingInterval', () => {
        test('stops the interval safely', () => {
            const pub = createMockClient();
            const sub = createMockClient();
            attachToClients(pub, sub);

            stopPingInterval();
            stopPingInterval(); // should not throw
        });
    });

    describe('reset', () => {
        test('clears all state', async () => {
            const pub = { ping: jest.fn().mockRejectedValue(new Error('fail')) };
            const sub = { ping: jest.fn().mockRejectedValue(new Error('fail')) };

            await pingClients(pub, sub);
            expect(getHealth().totalFailures).toBe(2);

            reset();

            const health = getHealth();
            expect(health.totalFailures).toBe(0);
            expect(health.totalPublishes).toBe(0);
            expect(health.consecutiveFailures).toBe(0);
            expect(health.lastError).toBeNull();
            expect(health.lastSuccessfulPublish).toBeNull();
            expect(health.lastSuccessfulSubscribe).toBeNull();
        });
    });
});
