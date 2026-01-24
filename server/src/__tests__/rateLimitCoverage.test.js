/**
 * Rate Limit Coverage Tests (Sprint 15)
 *
 * Tests to achieve 90%+ coverage for rateLimit.js
 */

const request = require('supertest');
const express = require('express');

// Save original environment
const originalEnv = { ...process.env };

describe('Rate Limit Coverage Tests', () => {
    let rateLimit;

    beforeEach(() => {
        jest.resetModules();
        // Set low limits for testing
        process.env.RATE_LIMIT_WINDOW_MS = '1000';
        process.env.RATE_LIMIT_MAX_REQUESTS = '3';
        process.env.RATE_LIMIT_MAX_ENTRIES = '10';
        rateLimit = require('../middleware/rateLimit');
    });

    afterEach(() => {
        process.env = { ...originalEnv };
        jest.clearAllMocks();
    });

    describe('httpRateLimitMetrics', () => {
        test('getHttpRateLimitMetrics returns stats', () => {
            const stats = rateLimit.getHttpRateLimitMetrics();

            expect(stats).toHaveProperty('totalRequests');
            expect(stats).toHaveProperty('blockedRequests');
            expect(stats).toHaveProperty('blockRate');
            expect(stats).toHaveProperty('uniqueIPs');
            expect(stats).toHaveProperty('blockedIPs');
            expect(stats).toHaveProperty('requestsPerMinute');
            expect(stats).toHaveProperty('uptimeMinutes');
        });

        test('resetHttpRateLimitMetrics resets stats', () => {
            // Get initial stats
            rateLimit.resetHttpRateLimitMetrics();
            const stats = rateLimit.getHttpRateLimitMetrics();

            expect(stats.totalRequests).toBe(0);
            expect(stats.blockedRequests).toBe(0);
        });
    });

    describe('apiLimiter', () => {
        let app;

        beforeEach(() => {
            app = express();
            app.use(rateLimit.apiLimiter);
            app.get('/test', (req, res) => res.json({ ok: true }));
        });

        test('allows requests within limit', async () => {
            const response = await request(app).get('/test');
            expect(response.status).toBe(200);
        });

        test('blocks requests exceeding limit', async () => {
            // Make requests up to the limit
            for (let i = 0; i < 3; i++) {
                await request(app).get('/test');
            }

            // This should be blocked
            const response = await request(app).get('/test');
            expect(response.status).toBe(429);
            expect(response.body.error.code).toBe('RATE_LIMITED');
        });
    });

    describe('strictLimiter', () => {
        let app;

        beforeEach(() => {
            app = express();
            app.use(rateLimit.strictLimiter);
            app.get('/strict', (req, res) => res.json({ ok: true }));
        });

        test('allows requests within strict limit', async () => {
            const response = await request(app).get('/strict');
            expect(response.status).toBe(200);
        });

        test('blocks requests exceeding strict limit', async () => {
            // Make 10 requests (strict limit is 10/min)
            for (let i = 0; i < 10; i++) {
                await request(app).get('/strict');
            }

            // This should be blocked
            const response = await request(app).get('/strict');
            expect(response.status).toBe(429);
            expect(response.body.error.code).toBe('RATE_LIMITED');
        });
    });

    describe('createSocketRateLimiter', () => {
        let limiter;
        const limits = {
            'room:create': { window: 60000, max: 5 },
            'game:start': { window: 30000, max: 3 }
        };

        beforeEach(() => {
            limiter = rateLimit.createSocketRateLimiter(limits);
        });

        test('getLimiter returns pass-through for undefined events', () => {
            const middleware = limiter.getLimiter('unknown:event');
            const next = jest.fn();

            middleware({}, {}, next);
            expect(next).toHaveBeenCalledWith();
        });

        test('getLimiter allows requests within limit', () => {
            const middleware = limiter.getLimiter('room:create');
            const socket = {
                id: 'test-socket-1',
                clientIP: '192.168.1.1',
                handshake: { address: '192.168.1.1' }
            };
            const next = jest.fn();

            middleware(socket, {}, next);
            expect(next).toHaveBeenCalledWith();
        });

        test('getLimiter blocks requests exceeding per-socket limit', () => {
            const middleware = limiter.getLimiter('room:create');
            const socket = {
                id: 'test-socket-2',
                clientIP: '192.168.1.2'
            };
            const next = jest.fn();

            // Make requests up to the limit
            for (let i = 0; i < 5; i++) {
                middleware(socket, {}, next);
            }
            expect(next).toHaveBeenCalledTimes(5);

            // This should be blocked
            next.mockClear();
            middleware(socket, {}, next);
            expect(next).toHaveBeenCalledWith(expect.any(Error));
            expect(next.mock.calls[0][0].message).toBe('Rate limit exceeded');
        });

        test('getLimiter blocks requests exceeding per-IP limit', () => {
            const middleware = limiter.getLimiter('game:start');
            const next = jest.fn();

            // Create multiple sockets from same IP
            // IP limit is max * 5 = 15
            for (let socketNum = 0; socketNum < 5; socketNum++) {
                const socket = {
                    id: `test-socket-${socketNum}`,
                    clientIP: '10.0.0.1'
                };
                for (let i = 0; i < 3; i++) {
                    middleware(socket, {}, next);
                }
            }

            // Should have allowed 15 requests
            const allowedCalls = next.mock.calls.filter(c => c.length === 0);
            expect(allowedCalls.length).toBe(15);

            // Next request should be blocked
            const socket = {
                id: 'test-socket-new',
                clientIP: '10.0.0.1'
            };
            next.mockClear();
            middleware(socket, {}, next);
            expect(next).toHaveBeenCalledWith(expect.any(Error));
            expect(next.mock.calls[0][0].message).toBe('IP rate limit exceeded');
        });

        test('cleanupSocket removes entries for socket', () => {
            const middleware = limiter.getLimiter('room:create');
            const socket = {
                id: 'socket-to-cleanup',
                clientIP: '192.168.1.3'
            };
            const next = jest.fn();

            // Make some requests
            middleware(socket, {}, next);
            middleware(socket, {}, next);

            const sizeBefore = limiter.getSize();
            expect(sizeBefore).toBeGreaterThan(0);

            // Cleanup
            limiter.cleanupSocket('socket-to-cleanup');

            // Socket entries should be removed (IP entries remain)
            const sizeAfter = limiter.getSize();
            expect(sizeAfter).toBeLessThan(sizeBefore);
        });

        test('cleanupStale removes old entries', async () => {
            const shortLimiter = rateLimit.createSocketRateLimiter({
                'test:event': { window: 100, max: 5 }
            });

            const middleware = shortLimiter.getLimiter('test:event');
            const socket = { id: 'socket-stale', clientIP: '1.2.3.4' };
            const next = jest.fn();

            middleware(socket, {}, next);

            // Wait for window to expire
            await new Promise(r => setTimeout(r, 150));

            // Run cleanup
            shortLimiter.cleanupStale();

            // Size should be reduced (entries removed)
            expect(shortLimiter.getSize()).toBe(0);
        });

        test('performLRUEviction removes oldest entries when threshold exceeded', () => {
            // Create limiter with low threshold
            process.env.RATE_LIMIT_MAX_ENTRIES = '5';
            jest.resetModules();
            const rl = require('../middleware/rateLimit');
            const lruLimiter = rl.createSocketRateLimiter({
                'test:event': { window: 60000, max: 100 }
            });

            const middleware = lruLimiter.getLimiter('test:event');

            // Create many entries
            for (let i = 0; i < 10; i++) {
                const socket = { id: `socket-${i}`, clientIP: `192.168.1.${i}` };
                middleware(socket, {}, jest.fn());
            }

            const sizeBefore = lruLimiter.getSize();
            expect(sizeBefore).toBeGreaterThan(5);

            // Perform LRU eviction
            const removed = lruLimiter.performLRUEviction();

            // Should have removed some entries
            expect(removed).toBeGreaterThan(0);
            expect(lruLimiter.getSize()).toBeLessThan(sizeBefore);
        });

        test('performLRUEviction does nothing when under threshold', () => {
            const removed = limiter.performLRUEviction();
            expect(removed).toBe(0);
        });

        test('getMetrics returns detailed metrics', () => {
            const middleware = limiter.getLimiter('room:create');
            const socket = { id: 'metrics-socket', clientIP: '192.168.1.100' };
            const next = jest.fn();

            // Make some requests
            for (let i = 0; i < 3; i++) {
                middleware(socket, {}, next);
            }

            const metrics = limiter.getMetrics();

            expect(metrics.totalRequests).toBe(3);
            expect(metrics.uniqueSockets).toBe(1);
            expect(metrics.uniqueIPs).toBe(1);
            expect(metrics.topRequestedEvents.length).toBeGreaterThan(0);
            expect(metrics.topRequestedEvents[0].event).toBe('room:create');
        });

        test('getMetrics shows blocked events', () => {
            const middleware = limiter.getLimiter('room:create');
            const socket = { id: 'block-socket', clientIP: '192.168.1.200' };
            const next = jest.fn();

            // Exceed limit
            for (let i = 0; i < 10; i++) {
                middleware(socket, {}, next);
            }

            const metrics = limiter.getMetrics();

            expect(metrics.blockedRequests).toBeGreaterThan(0);
            expect(metrics.topBlockedEvents.length).toBeGreaterThan(0);
        });

        test('resetMetrics clears all metrics', () => {
            const middleware = limiter.getLimiter('room:create');
            const socket = { id: 'reset-socket', clientIP: '192.168.1.50' };
            const next = jest.fn();

            middleware(socket, {}, next);

            limiter.resetMetrics();

            const metrics = limiter.getMetrics();
            expect(metrics.totalRequests).toBe(0);
            expect(metrics.uniqueSockets).toBe(0);
        });

        test('getSize returns total entry count', () => {
            const middleware = limiter.getLimiter('room:create');

            // Initially should be 0
            expect(limiter.getSize()).toBe(0);

            // Make a request
            const socket = { id: 'size-socket', clientIP: '192.168.1.60' };
            middleware(socket, {}, jest.fn());

            // Should have entries now
            expect(limiter.getSize()).toBeGreaterThan(0);
        });

        test('uses handshake address as fallback IP', () => {
            const middleware = limiter.getLimiter('room:create');
            const socket = {
                id: 'handshake-socket',
                handshake: { address: '10.0.0.50' }
            };
            const next = jest.fn();

            middleware(socket, {}, next);

            const metrics = limiter.getMetrics();
            expect(metrics.uniqueIPs).toBe(1);
        });

        test('uses unknown as fallback when no IP available', () => {
            const middleware = limiter.getLimiter('room:create');
            const socket = {
                id: 'unknown-socket',
                handshake: {}
            };
            const next = jest.fn();

            middleware(socket, {}, next);

            expect(next).toHaveBeenCalledWith();
        });

        test('cleanupStale handles errors gracefully', () => {
            // Create a limiter where we'll cause an error
            const errorLimiter = rateLimit.createSocketRateLimiter({
                'test:error': { window: 'invalid', max: 5 }
            });

            // Should not throw
            expect(() => errorLimiter.cleanupStale()).not.toThrow();
        });
    });
});
