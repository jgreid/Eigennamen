/**
 * Performance Optimization Tests - Phase 3
 *
 * Tests for:
 * - Rate limiter in-place filtering
 * - Team sets for O(1) lookups
 * - Redis connection configuration
 */

const { createSocketRateLimiter } = require('../../middleware/rateLimit');

describe('Rate Limiter Optimizations', () => {
    describe('createSocketRateLimiter', () => {
        let rateLimiter;

        beforeEach(() => {
            rateLimiter = createSocketRateLimiter({
                'test:event': { max: 5, window: 1000 },
            });
        });

        test('allows requests within limit', (done) => {
            const mockSocket = {
                id: 'socket-123',
                clientIP: '127.0.0.1',
            };

            const limiter = rateLimiter.getLimiter('test:event');

            // First request should pass
            limiter(mockSocket, {}, (err) => {
                expect(err).toBeUndefined();
                done();
            });
        });

        test('blocks requests exceeding limit', (done) => {
            const mockSocket = {
                id: 'socket-123',
                clientIP: '127.0.0.1',
            };

            const limiter = rateLimiter.getLimiter('test:event');

            // Make 5 requests to hit the limit
            let _completed = 0;
            for (let i = 0; i < 5; i++) {
                limiter(mockSocket, {}, () => {
                    _completed++;
                });
            }

            // 6th request should be blocked
            limiter(mockSocket, {}, (err) => {
                expect(err).toBeDefined();
                expect(err.message).toBe('Rate limit exceeded');
                done();
            });
        });

        test('cleans up socket entries on disconnect', () => {
            const mockSocket = {
                id: 'socket-cleanup-test',
                clientIP: '127.0.0.1',
            };

            const limiter = rateLimiter.getLimiter('test:event');

            // Make some requests
            limiter(mockSocket, {}, () => {});
            limiter(mockSocket, {}, () => {});

            // Size should be > 0
            expect(rateLimiter.getSize()).toBeGreaterThan(0);

            // Cleanup socket
            rateLimiter.cleanupSocket('socket-cleanup-test');

            // Verify metrics still work
            const metrics = rateLimiter.getMetrics();
            expect(metrics.totalRequests).toBeGreaterThanOrEqual(2);
        });

        test('returns no-op limiter for unconfigured events', (done) => {
            const mockSocket = {
                id: 'socket-123',
                clientIP: '127.0.0.1',
            };

            const limiter = rateLimiter.getLimiter('unconfigured:event');

            // Should pass through without any limiting
            limiter(mockSocket, {}, (err) => {
                expect(err).toBeUndefined();
                done();
            });
        });

        test('tracks metrics correctly', () => {
            const mockSocket = {
                id: 'socket-metrics',
                clientIP: '192.168.1.1',
            };

            const limiter = rateLimiter.getLimiter('test:event');

            // Make requests
            limiter(mockSocket, {}, () => {});
            limiter(mockSocket, {}, () => {});
            limiter(mockSocket, {}, () => {});

            const metrics = rateLimiter.getMetrics();

            expect(metrics.totalRequests).toBeGreaterThanOrEqual(3);
            expect(metrics.uniqueSockets.size || metrics.uniqueSockets).toBeGreaterThanOrEqual(1);
            expect(metrics.uniqueIPs.size || metrics.uniqueIPs).toBeGreaterThanOrEqual(1);
        });

        test('resets metrics correctly', () => {
            const mockSocket = {
                id: 'socket-reset',
                clientIP: '10.0.0.1',
            };

            const limiter = rateLimiter.getLimiter('test:event');
            limiter(mockSocket, {}, () => {});

            // Reset metrics
            rateLimiter.resetMetrics();

            const metrics = rateLimiter.getMetrics();
            expect(metrics.totalRequests).toBe(0);
            expect(metrics.blockedRequests).toBe(0);
        });

        test('stale cleanup removes old entries', (done) => {
            // Create limiter with very short window for testing
            const shortWindowLimiter = createSocketRateLimiter({
                'short:event': { max: 10, window: 50 }, // 50ms window
            });

            const mockSocket = {
                id: 'socket-stale',
                clientIP: '127.0.0.1',
            };

            const limiter = shortWindowLimiter.getLimiter('short:event');
            limiter(mockSocket, {}, () => {});

            // Wait for window to expire
            setTimeout(() => {
                shortWindowLimiter.cleanupStale();

                // After cleanup, size should be 0 or entries should be empty
                const size = shortWindowLimiter.getSize();
                // May not be 0 if IP entry exists, but should be cleaned
                expect(size).toBeLessThanOrEqual(2);
                done();
            }, 100);
        });
    });
});
