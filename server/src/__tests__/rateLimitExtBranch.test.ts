/**
 * Rate Limit Extended Branch Coverage Tests
 *
 * Tests core rate limiting behavior: per-socket limits, per-IP limits,
 * cleanup, stale entry removal, and metrics tracking.
 */

jest.mock('../utils/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
}));

const { createSocketRateLimiter } = require('../middleware/rateLimit');

describe('Rate Limit Extended Branch Coverage', () => {
    describe('createSocketRateLimiter', () => {
        let limiter: ReturnType<typeof createSocketRateLimiter>;

        beforeEach(() => {
            limiter = createSocketRateLimiter({
                'test:event': { max: 3, window: 1000 },
                'fast:event': { max: 1, window: 500 }
            });
        });

        describe('getLimiter - basic flow', () => {
            it('should allow requests within rate limit', () => {
                const middleware = limiter.getLimiter('test:event');
                const socket = { id: 'socket-1', clientIP: '192.168.1.1' };
                const next = jest.fn();

                middleware(socket, {}, next);
                expect(next).toHaveBeenCalledWith();
            });

            it('should pass through for unknown event', () => {
                const middleware = limiter.getLimiter('unknown:event');
                const next = jest.fn();
                middleware({ id: 's1' }, {}, next);
                expect(next).toHaveBeenCalledWith();
            });

            it('should block after exceeding limit', () => {
                const middleware = limiter.getLimiter('fast:event');
                const socket = { id: 'socket-1', clientIP: '192.168.1.1' };
                const next = jest.fn();

                // First request: allowed
                middleware(socket, {}, next);
                expect(next).toHaveBeenCalledWith();

                // Second request: blocked
                const next2 = jest.fn();
                middleware(socket, {}, next2);
                expect(next2).toHaveBeenCalledWith(expect.any(Error));
                expect(next2.mock.calls[0][0].message).toBe('Rate limit exceeded');
            });
        });

        describe('IP rate limiting', () => {
            it('should block requests from same IP across different sockets', () => {
                const middleware = limiter.getLimiter('fast:event');

                // 1 request from each of 3 sockets (same IP), IP limit = 1 * 3 = 3
                for (let i = 0; i < 3; i++) {
                    const next = jest.fn();
                    middleware({ id: `socket-${i}`, clientIP: '10.0.0.1' }, {}, next);
                    expect(next).toHaveBeenCalledWith();
                }

                // 4th request from another socket but same IP: should be blocked
                const next = jest.fn();
                middleware({ id: 'socket-99', clientIP: '10.0.0.1' }, {}, next);
                expect(next).toHaveBeenCalledWith(expect.any(Error));
                expect(next.mock.calls[0][0].message).toBe('IP rate limit exceeded');
            });

            it('should use handshake address when clientIP not available', () => {
                const middleware = limiter.getLimiter('test:event');
                const socket = {
                    id: 'socket-1',
                    handshake: { address: '172.16.0.1' }
                };
                const next = jest.fn();

                middleware(socket, {}, next);
                expect(next).toHaveBeenCalledWith();
            });
        });

        describe('cleanupSocket', () => {
            it('should remove socket entries but leave IP entries', () => {
                const middleware = limiter.getLimiter('test:event');
                const socket = { id: 'socket-cleanup', clientIP: '10.0.0.1' };
                middleware(socket, {}, jest.fn());

                const sizeBefore = limiter.getSize();
                expect(sizeBefore).toBe(2); // 1 socket + 1 IP

                limiter.cleanupSocket('socket-cleanup');
                expect(limiter.getSize()).toBe(1); // IP entry remains
            });
        });

        describe('cleanupStale', () => {
            it('should remove expired entries after window passes', async () => {
                const staleLimiter = createSocketRateLimiter({
                    'stale:event': { max: 100, window: 10 } // 10ms window
                });

                const middleware = staleLimiter.getLimiter('stale:event');
                middleware({ id: 'stale-socket', clientIP: '10.0.0.1' }, {}, jest.fn());
                expect(staleLimiter.getSize()).toBe(2);

                // Wait for entries to expire
                await new Promise(resolve => setTimeout(resolve, 50));

                staleLimiter.cleanupStale();
                expect(staleLimiter.getSize()).toBe(0);
            });
        });

        describe('getMetrics', () => {
            it('should accurately track request and block counts', () => {
                const ml = createSocketRateLimiter({
                    'test': { max: 2, window: 1000 }
                });

                const middleware = ml.getLimiter('test');
                const socket = { id: 's1', clientIP: '10.0.0.1' };

                middleware(socket, {}, jest.fn());
                middleware(socket, {}, jest.fn());
                middleware(socket, {}, jest.fn()); // blocked

                const metrics = ml.getMetrics();
                expect(metrics.totalRequests).toBe(3);
                expect(metrics.blockedRequests).toBe(1);
                expect(metrics.blockRate).toBe('33.3%');
                expect(metrics.topRequestedEvents).toHaveLength(1);
                expect(metrics.topRequestedEvents[0]).toEqual({ event: 'test', count: 3 });
                expect(metrics.topBlockedEvents).toHaveLength(1);
                expect(metrics.topBlockedEvents[0]).toEqual({ event: 'test', count: 1 });
            });

            it('should track IP blocks separately from socket blocks', () => {
                const ml = createSocketRateLimiter({
                    'test': { max: 1, window: 1000 }
                });
                const middleware = ml.getLimiter('test');

                // 3 different sockets, same IP: IP limit is 1 * 3 = 3
                for (let i = 0; i < 3; i++) {
                    middleware({ id: `s${i}`, clientIP: '10.0.0.1' }, {}, jest.fn());
                }
                // 4th from new socket same IP: IP blocked
                middleware({ id: 's99', clientIP: '10.0.0.1' }, {}, jest.fn());

                const metrics = ml.getMetrics();
                expect(metrics.blockedByIP).toBe(1);
            });
        });

        describe('socketKeyIndex cleanup', () => {
            it('should track multi-event entries per socket and clean all on disconnect', () => {
                const ml = createSocketRateLimiter({
                    'e1': { max: 10, window: 1000 },
                    'e2': { max: 10, window: 1000 }
                });

                const m1 = ml.getLimiter('e1');
                const m2 = ml.getLimiter('e2');
                const socket = { id: 's1', clientIP: '10.0.0.1' };

                m1(socket, {}, jest.fn());
                m2(socket, {}, jest.fn());
                // 2 socket entries + 2 IP entries = 4
                expect(ml.getSize()).toBe(4);

                ml.cleanupSocket('s1');
                // Socket entries removed, IP entries remain = 2
                expect(ml.getSize()).toBe(2);
            });
        });
    });
});
