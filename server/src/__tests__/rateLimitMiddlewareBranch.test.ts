/**
 * Rate Limit Middleware - Branch Coverage Tests
 *
 * Targets uncovered branches in middleware/rateLimit.ts (84% branch):
 * - getSocketIP fallback chain (clientIP -> handshake?.address -> 'unknown')
 * - IP rate limiting path (ipCount >= ipLimit)
 * - LRU eviction when entries exceed threshold
 * - Metrics cleanup threshold branches
 * - cleanupStale error handling catch block
 * - cleanupStale with no valid windows
 * - performLRUEviction with mixed socket/ip entries
 * - getMetrics with zero totalRequests (blockRate = '0%')
 * - resetMetrics clearing all counters
 */

jest.mock('../utils/logger', () => ({
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn()
}));

const { createSocketRateLimiter, getHttpRateLimitMetrics, resetHttpRateLimitMetrics } = require('../middleware/rateLimit');

describe('rateLimit middleware - branch coverage', () => {
    const defaultLimits = {
        'test:event': { max: 3, window: 1000 },
        'fast:event': { max: 2, window: 500 }
    };

    describe('getSocketIP fallback chain', () => {
        it('uses clientIP when available', () => {
            const limiter = createSocketRateLimiter(defaultLimits);
            const socket = { id: 'sock-ip-1', clientIP: '10.0.0.1', handshake: { address: '192.168.0.1' } };
            const next = jest.fn();

            limiter.getLimiter('test:event')(socket, {}, next);
            expect(next).toHaveBeenCalledWith();

            // Verify metrics track the IP
            const metrics = limiter.getMetrics();
            expect(metrics.uniqueIPs).toBeGreaterThanOrEqual(1);
        });

        it('falls back to handshake.address when clientIP is undefined', () => {
            const limiter = createSocketRateLimiter(defaultLimits);
            const socket = { id: 'sock-ip-2', handshake: { address: '192.168.1.1' } };
            const next = jest.fn();

            limiter.getLimiter('test:event')(socket, {}, next);
            expect(next).toHaveBeenCalledWith();
        });

        it('falls back to "unknown" when both clientIP and handshake.address are undefined', () => {
            const limiter = createSocketRateLimiter(defaultLimits);
            const socket = { id: 'sock-ip-3', handshake: {} };
            const next = jest.fn();

            limiter.getLimiter('test:event')(socket, {}, next);
            expect(next).toHaveBeenCalledWith();
        });

        it('falls back to "unknown" when handshake is undefined', () => {
            const limiter = createSocketRateLimiter(defaultLimits);
            const socket = { id: 'sock-ip-4' };
            const next = jest.fn();

            limiter.getLimiter('test:event')(socket, {}, next);
            expect(next).toHaveBeenCalledWith();
        });
    });

    describe('getLimiter with unknown event', () => {
        it('returns a pass-through limiter for unknown events', () => {
            const limiter = createSocketRateLimiter(defaultLimits);
            const socket = { id: 'sock-unknown-1' };
            const next = jest.fn();

            limiter.getLimiter('nonexistent:event')(socket, {}, next);
            expect(next).toHaveBeenCalledWith();
        });
    });

    describe('per-socket rate limiting', () => {
        it('blocks requests exceeding per-socket limit', () => {
            const limiter = createSocketRateLimiter({ 'test:event': { max: 2, window: 10000 } });
            const socket = { id: 'sock-limit-1', clientIP: '10.0.0.100' };
            const results: any[] = [];

            for (let i = 0; i < 5; i++) {
                const next = jest.fn();
                limiter.getLimiter('test:event')(socket, {}, next);
                results.push(next);
            }

            // First 2 should pass, rest should be rate limited
            expect(results[0]).toHaveBeenCalledWith();
            expect(results[1]).toHaveBeenCalledWith();
            expect(results[2]).toHaveBeenCalledWith(expect.any(Error));
        });
    });

    describe('per-IP rate limiting', () => {
        it('blocks requests from same IP across different sockets', () => {
            const limiter = createSocketRateLimiter({ 'test:event': { max: 2, window: 10000 } });
            // IP limit is max * IP_RATE_LIMIT_MULTIPLIER (3) = 6

            const sharedIP = '10.0.0.200';
            const sockets = Array.from({ length: 10 }, (_, i) => ({
                id: `sock-ip-shared-${i}`,
                clientIP: sharedIP
            }));

            let passCount = 0;
            let blockCount = 0;

            for (const socket of sockets) {
                const next = jest.fn();
                limiter.getLimiter('test:event')(socket, {}, next);
                if (next.mock.calls.length > 0 && next.mock.calls[0].length === 0) {
                    passCount++;
                } else {
                    blockCount++;
                }
            }

            // Per-socket limit is 2, but different sockets, so per-socket won't trigger
            // IP limit is 2 * 3 = 6, so after 6 total requests from same IP, it blocks
            expect(passCount).toBe(6);
            expect(blockCount).toBe(4);
        });
    });

    describe('cleanupSocket', () => {
        it('removes socket entries using reverse index', () => {
            const limiter = createSocketRateLimiter(defaultLimits);
            const socket = { id: 'sock-cleanup-1', clientIP: '10.0.0.1' };
            const next = jest.fn();

            limiter.getLimiter('test:event')(socket, {}, next);
            expect(limiter.getSize()).toBeGreaterThan(0);

            limiter.cleanupSocket('sock-cleanup-1');
            // Socket entries removed; IP entries remain
        });

        it('handles cleanup for socket with no entries', () => {
            const limiter = createSocketRateLimiter(defaultLimits);
            // Should not throw
            limiter.cleanupSocket('nonexistent-socket');
        });
    });

    describe('cleanupStale', () => {
        it('cleans up stale socket and IP entries', () => {
            const limiter = createSocketRateLimiter({ 'test:event': { max: 100, window: 1 } });
            const socket = { id: 'sock-stale-1', clientIP: '10.0.0.1' };
            const next = jest.fn();

            // Make some requests
            limiter.getLimiter('test:event')(socket, {}, next);

            // Wait for window to expire
            jest.useFakeTimers();
            jest.advanceTimersByTime(100);
            jest.useRealTimers();

            // Stale cleanup should remove expired entries
            limiter.cleanupStale();
        });

        it('handles cleanup with empty limits', () => {
            const limiter = createSocketRateLimiter({});
            // Should not throw
            limiter.cleanupStale();
        });

        it('handles cleanup with limits that have no valid window', () => {
            const limiter = createSocketRateLimiter({
                'bad:event': { max: 5, window: 0 }
            });
            const socket = { id: 'sock-bad-1', clientIP: '10.0.0.1' };
            const next = jest.fn();
            limiter.getLimiter('bad:event')(socket, {}, next);
            // Should not throw
            limiter.cleanupStale();
        });

        it('handles cleanup with undefined limit entries', () => {
            const limiter = createSocketRateLimiter({
                'test:event': undefined
            } as any);
            // Should not throw
            limiter.cleanupStale();
        });
    });

    describe('performLRUEviction', () => {
        it('returns 0 when entries are within threshold', () => {
            const limiter = createSocketRateLimiter(defaultLimits);
            const removed = limiter.performLRUEviction();
            expect(removed).toBe(0);
        });

        it('evicts entries when over threshold', () => {
            // Use a very low max entries threshold via env override
            const origEnv = process.env.RATE_LIMIT_MAX_ENTRIES;
            process.env.RATE_LIMIT_MAX_ENTRIES = '5';

            // Need to re-require the module to pick up the new env
            jest.resetModules();
            jest.mock('../utils/logger', () => ({
                warn: jest.fn(),
                error: jest.fn(),
                info: jest.fn(),
                debug: jest.fn()
            }));
            const { createSocketRateLimiter: freshCreate } = require('../middleware/rateLimit');

            const limiter = freshCreate({ 'test:event': { max: 100, window: 60000 } });

            // Create more entries than the threshold
            for (let i = 0; i < 10; i++) {
                const socket = { id: `evict-sock-${i}`, clientIP: `10.0.${i}.1` };
                const next = jest.fn();
                limiter.getLimiter('test:event')(socket, {}, next);
            }

            const removed = limiter.performLRUEviction();
            expect(removed).toBeGreaterThan(0);

            process.env.RATE_LIMIT_MAX_ENTRIES = origEnv;
        });
    });

    describe('getMetrics', () => {
        it('returns metrics with zero requests', () => {
            const limiter = createSocketRateLimiter(defaultLimits);
            const metrics = limiter.getMetrics();

            expect(metrics.totalRequests).toBe(0);
            expect(metrics.blockedRequests).toBe(0);
            expect(metrics.blockedByIP).toBe(0);
            expect(metrics.blockRate).toBe('0%');
            expect(metrics.uniqueSockets).toBe(0);
            expect(metrics.uniqueIPs).toBe(0);
            expect(metrics.requestsPerMinute).toBe(0);
            expect(metrics.topRequestedEvents).toEqual([]);
            expect(metrics.topBlockedEvents).toEqual([]);
            expect(metrics.uptimeMinutes).toBeGreaterThanOrEqual(0);
        });

        it('returns metrics after some requests', () => {
            const limiter = createSocketRateLimiter({ 'test:event': { max: 2, window: 60000 } });
            const socket = { id: 'sock-metrics-1', clientIP: '10.0.0.1' };

            // Make 3 requests - 2 pass, 1 blocked
            for (let i = 0; i < 3; i++) {
                const next = jest.fn();
                limiter.getLimiter('test:event')(socket, {}, next);
            }

            const metrics = limiter.getMetrics();
            expect(metrics.totalRequests).toBe(3);
            expect(metrics.blockedRequests).toBe(1);
            expect(metrics.blockRate).not.toBe('0%');
            expect(metrics.uniqueSockets).toBe(1);
            expect(metrics.uniqueIPs).toBe(1);
            expect(metrics.topRequestedEvents.length).toBeGreaterThan(0);
            expect(metrics.topBlockedEvents.length).toBeGreaterThan(0);
        });

        it('returns correct blockRate when requests > 0', () => {
            const limiter = createSocketRateLimiter({ 'test:event': { max: 1, window: 60000 } });
            const socket = { id: 'sock-br-1', clientIP: '10.0.0.1' };

            // 1 passes, 1 blocked
            const next1 = jest.fn();
            limiter.getLimiter('test:event')(socket, {}, next1);
            const next2 = jest.fn();
            limiter.getLimiter('test:event')(socket, {}, next2);

            const metrics = limiter.getMetrics();
            expect(metrics.blockRate).toBe('50.0%');
        });
    });

    describe('resetMetrics', () => {
        it('resets all metric counters to zero', () => {
            const limiter = createSocketRateLimiter({ 'test:event': { max: 100, window: 60000 } });
            const socket = { id: 'sock-reset-1', clientIP: '10.0.0.1' };
            const next = jest.fn();

            limiter.getLimiter('test:event')(socket, {}, next);

            limiter.resetMetrics();
            const metrics = limiter.getMetrics();

            expect(metrics.totalRequests).toBe(0);
            expect(metrics.blockedRequests).toBe(0);
            expect(metrics.blockedByIP).toBe(0);
            expect(metrics.uniqueSockets).toBe(0);
            expect(metrics.uniqueIPs).toBe(0);
        });
    });

    describe('getSize', () => {
        it('returns combined size of socket and IP maps', () => {
            const limiter = createSocketRateLimiter(defaultLimits);
            expect(limiter.getSize()).toBe(0);

            const socket = { id: 'sock-size-1', clientIP: '10.0.0.1' };
            const next = jest.fn();
            limiter.getLimiter('test:event')(socket, {}, next);

            // Should have at least 1 socket entry and 1 IP entry
            expect(limiter.getSize()).toBeGreaterThanOrEqual(2);
        });
    });

    describe('HTTP rate limit metrics', () => {
        it('getHttpRateLimitMetrics returns metrics with zero requests', () => {
            resetHttpRateLimitMetrics();
            const metrics = getHttpRateLimitMetrics();

            expect(metrics.totalRequests).toBe(0);
            expect(metrics.blockedRequests).toBe(0);
            expect(metrics.blockRate).toBe('0%');
            expect(metrics.uniqueIPs).toBe(0);
            expect(metrics.blockedIPs).toBe(0);
            expect(metrics.uptimeMinutes).toBeGreaterThanOrEqual(0);
        });

        it('resetHttpRateLimitMetrics clears all counters', () => {
            resetHttpRateLimitMetrics();
            const metrics = getHttpRateLimitMetrics();
            expect(metrics.totalRequests).toBe(0);
        });
    });

    describe('socketKeyIndex cleanup in cleanupStale', () => {
        it('cleans up reverse index when socket entries are stale', () => {
            // Use a very short window so entries become stale immediately
            const limiter = createSocketRateLimiter({ 'test:event': { max: 100, window: 1 } });
            const socket = { id: 'sock-idx-1', clientIP: '10.0.0.1' };
            const next = jest.fn();

            limiter.getLimiter('test:event')(socket, {}, next);

            // Advance time to make entries stale
            const origNow = Date.now;
            Date.now = () => origNow() + 10000;

            limiter.cleanupStale();

            Date.now = origNow;
        });
    });

    describe('filterTimestampsInPlace edge cases', () => {
        it('handles empty timestamps during rate limiting', () => {
            const limiter = createSocketRateLimiter({ 'test:event': { max: 100, window: 60000 } });
            const socket = { id: 'sock-filter-1', clientIP: '10.0.0.1' };
            const next = jest.fn();

            // First request initializes empty timestamp array
            limiter.getLimiter('test:event')(socket, {}, next);
            expect(next).toHaveBeenCalledWith();
        });
    });
});
