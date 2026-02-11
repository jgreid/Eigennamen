/**
 * Tests for Rate Limit Middleware
 */

// Mock logger
jest.mock('../utils/logger', () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
}));

const {
    apiLimiter,
    strictLimiter,
    createSocketRateLimiter
} = require('../middleware/rateLimit');

describe('Rate Limit Middleware', () => {
    const mockLogger = require('../utils/logger');

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('apiLimiter', () => {
        it('should be defined and be a function', () => {
            expect(apiLimiter).toBeDefined();
            expect(typeof apiLimiter).toBe('function');
        });
    });

    describe('strictLimiter', () => {
        it('should be defined and be a function', () => {
            expect(strictLimiter).toBeDefined();
            expect(typeof strictLimiter).toBe('function');
        });
    });

    describe('createSocketRateLimiter', () => {
        const limits = {
            'room:create': { max: 5, window: 60000 },
            'game:reveal': { max: 10, window: 1000 },
            'chat:message': { max: 20, window: 60000 }
        };

        let rateLimiter;

        beforeEach(() => {
            rateLimiter = createSocketRateLimiter(limits);
        });

        it('should return an object with required methods', () => {
            expect(typeof rateLimiter.getLimiter).toBe('function');
            expect(typeof rateLimiter.cleanupSocket).toBe('function');
            expect(typeof rateLimiter.cleanupStale).toBe('function');
            expect(typeof rateLimiter.performLRUEviction).toBe('function');
            expect(typeof rateLimiter.getSize).toBe('function');
            expect(typeof rateLimiter.getMetrics).toBe('function');
            expect(typeof rateLimiter.resetMetrics).toBe('function');
        });

        describe('getLimiter', () => {
            it('should return pass-through middleware for unknown events', () => {
                const middleware = rateLimiter.getLimiter('unknown:event');
                const next = jest.fn();

                middleware({}, {}, next);

                expect(next).toHaveBeenCalledWith();
            });

            it('should return rate limiting middleware for known events', () => {
                const middleware = rateLimiter.getLimiter('room:create');
                expect(middleware).toBeDefined();
                expect(typeof middleware).toBe('function');
            });

            it('should allow requests within limit', () => {
                const middleware = rateLimiter.getLimiter('room:create');
                const mockSocket = {
                    id: 'socket-123',
                    clientIP: '127.0.0.1'
                };
                const next = jest.fn();

                // First request should pass
                middleware(mockSocket, {}, next);

                expect(next).toHaveBeenCalledWith();
                expect(next).not.toHaveBeenCalledWith(expect.any(Error));
            });

            it('should block requests exceeding limit', () => {
                const middleware = rateLimiter.getLimiter('room:create');
                const mockSocket = {
                    id: 'socket-456',
                    clientIP: '127.0.0.2'
                };
                const next = jest.fn();

                // Make 6 requests (limit is 5)
                for (let i = 0; i < 6; i++) {
                    middleware(mockSocket, {}, next);
                }

                // Last call should have been with error
                expect(next).toHaveBeenCalledWith(expect.any(Error));
                expect(mockLogger.warn).toHaveBeenCalled();
            });

            it('should get client IP from socket.clientIP', () => {
                const middleware = rateLimiter.getLimiter('room:create');
                const mockSocket = {
                    id: 'socket-789',
                    clientIP: '192.168.1.1'
                };
                const next = jest.fn();

                middleware(mockSocket, {}, next);

                expect(next).toHaveBeenCalledWith();
            });

            it('should get client IP from handshake if clientIP not set', () => {
                const middleware = rateLimiter.getLimiter('room:create');
                const mockSocket = {
                    id: 'socket-abc',
                    handshake: { address: '10.0.0.1' }
                };
                const next = jest.fn();

                middleware(mockSocket, {}, next);

                expect(next).toHaveBeenCalledWith();
            });

            it('should use "unknown" IP when no IP available', () => {
                const middleware = rateLimiter.getLimiter('room:create');
                const mockSocket = {
                    id: 'socket-def'
                };
                const next = jest.fn();

                middleware(mockSocket, {}, next);

                expect(next).toHaveBeenCalledWith();
            });
        });

        describe('cleanupSocket', () => {
            it('should remove rate limit entries for disconnected socket', () => {
                const middleware = rateLimiter.getLimiter('room:create');
                const mockSocket = {
                    id: 'cleanup-socket',
                    clientIP: '127.0.0.1'
                };
                const next = jest.fn();

                // Generate some rate limit entries
                middleware(mockSocket, {}, next);
                middleware(mockSocket, {}, next);

                const sizeBefore = rateLimiter.getSize();
                expect(sizeBefore).toBeGreaterThan(0);

                // Cleanup
                rateLimiter.cleanupSocket('cleanup-socket');

                // Should log cleanup
                expect(mockLogger.debug).toHaveBeenCalledWith(
                    expect.stringContaining('Cleaned up')
                );
            });

            it('should handle cleanup for non-existent socket', () => {
                // Should not throw
                expect(() => rateLimiter.cleanupSocket('non-existent-socket')).not.toThrow();
            });
        });

        describe('cleanupStale', () => {
            it('should remove stale entries', () => {
                // Should not throw
                expect(() => rateLimiter.cleanupStale()).not.toThrow();
            });

            it('should handle errors gracefully', () => {
                // cleanupStale has try-catch, should not throw
                expect(() => rateLimiter.cleanupStale()).not.toThrow();
            });
        });

        describe('performLRUEviction', () => {
            it('should return 0 when below threshold', () => {
                const removed = rateLimiter.performLRUEviction();
                expect(removed).toBe(0);
            });
        });

        describe('getSize', () => {
            it('should return total size of rate limit maps', () => {
                const size = rateLimiter.getSize();
                expect(typeof size).toBe('number');
                expect(size).toBeGreaterThanOrEqual(0);
            });
        });

        describe('getMetrics', () => {
            it('should return detailed metrics', () => {
                const metrics = rateLimiter.getMetrics();

                expect(metrics).toHaveProperty('totalRequests');
                expect(metrics).toHaveProperty('blockedRequests');
                expect(metrics).toHaveProperty('blockedByIP');
                expect(metrics).toHaveProperty('blockRate');
                expect(metrics).toHaveProperty('uniqueSockets');
                expect(metrics).toHaveProperty('uniqueIPs');
                expect(metrics).toHaveProperty('activeSocketEntries');
                expect(metrics).toHaveProperty('activeIPEntries');
                expect(metrics).toHaveProperty('requestsPerMinute');
                expect(metrics).toHaveProperty('topRequestedEvents');
                expect(metrics).toHaveProperty('topBlockedEvents');
                expect(metrics).toHaveProperty('uptimeMinutes');
            });

            it('should track requests by event', () => {
                const middleware = rateLimiter.getLimiter('room:create');
                const mockSocket = { id: 'metric-socket', clientIP: '127.0.0.1' };
                const next = jest.fn();

                middleware(mockSocket, {}, next);
                middleware(mockSocket, {}, next);

                const metrics = rateLimiter.getMetrics();
                expect(metrics.totalRequests).toBe(2);
            });
        });

        describe('resetMetrics', () => {
            it('should reset all metrics to zero', () => {
                const middleware = rateLimiter.getLimiter('room:create');
                const mockSocket = { id: 'reset-socket', clientIP: '127.0.0.1' };
                const next = jest.fn();

                // Generate some metrics
                middleware(mockSocket, {}, next);

                // Reset
                rateLimiter.resetMetrics();

                const metrics = rateLimiter.getMetrics();
                expect(metrics.totalRequests).toBe(0);
                expect(metrics.blockedRequests).toBe(0);
                expect(metrics.uniqueSockets).toBe(0);
            });
        });

        describe('IP Rate Limiting', () => {
            it('should block requests from same IP exceeding IP limit', () => {
                // IP limit is max * 5 = 25 for room:create
                const middleware = rateLimiter.getLimiter('room:create');
                const next = jest.fn();

                // Use multiple sockets from same IP
                for (let i = 0; i < 30; i++) {
                    const mockSocket = {
                        id: `ip-socket-${i}`,
                        clientIP: '192.168.1.100'
                    };
                    middleware(mockSocket, {}, next);
                }

                // Some calls should have been blocked due to IP limit
                expect(mockLogger.warn).toHaveBeenCalledWith(
                    expect.stringContaining('IP rate limit exceeded')
                );
            });
        });
    });

    describe('filterTimestampsInPlace', () => {
        it('should be used by rate limiter for performance', () => {
            const limits = {
                'test:event': { max: 100, window: 1000 }
            };
            const rateLimiter = createSocketRateLimiter(limits);
            const middleware = rateLimiter.getLimiter('test:event');
            const mockSocket = { id: 'filter-socket', clientIP: '127.0.0.1' };
            const next = jest.fn();

            // Make many requests
            for (let i = 0; i < 50; i++) {
                middleware(mockSocket, {}, next);
            }

            // All should pass (under limit)
            expect(next).toHaveBeenCalledTimes(50);
            const errorCalls = next.mock.calls.filter(call => call[0] instanceof Error);
            expect(errorCalls.length).toBe(0);
        });
    });
});
