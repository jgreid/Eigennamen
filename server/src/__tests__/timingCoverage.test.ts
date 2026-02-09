/**
 * Timing Middleware Coverage Tests
 *
 * Tests for timing.ts to cover uncovered lines:
 * - requestTiming: 500 status, slow request, health check path skip
 * - socketEventTiming: slow events, error events
 * - startMemoryMonitoring / stopMemoryMonitoring: critical/warning/normal thresholds
 */

jest.mock('../utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));

describe('Timing Middleware - Extended Coverage', () => {
    // Re-require after resetModules to get the same instance
    function getTimingAndLogger() {
        const logger = require('../utils/logger');
        const timing = require('../middleware/timing');
        return { timing, logger };
    }

    beforeEach(() => {
        jest.clearAllMocks();
        jest.resetModules();
    });

    describe('requestTiming', () => {
        function createMockReqRes(overrides: any = {}) {
            const listeners: Record<string, Function[]> = {};
            const req = {
                method: 'GET',
                path: '/api/test',
                headers: {},
                get: jest.fn((header: string) => {
                    if (header === 'User-Agent') return 'TestAgent/1.0';
                    return undefined;
                }),
                ...overrides.req
            };
            const res = {
                statusCode: 200,
                setHeader: jest.fn(),
                get: jest.fn(() => '100'),
                on: jest.fn((event: string, handler: Function) => {
                    if (!listeners[event]) listeners[event] = [];
                    listeners[event].push(handler);
                }),
                _triggerFinish: () => {
                    (listeners['finish'] || []).forEach(fn => fn());
                },
                ...overrides.res
            };
            const next = jest.fn();
            return { req, res, next };
        }

        it('should set X-Request-ID header and call next', () => {
            const { timing } = getTimingAndLogger();
            const { req, res, next } = createMockReqRes();
            timing.requestTiming(req as any, res as any, next);

            expect(res.setHeader).toHaveBeenCalledWith('X-Request-ID', expect.any(String));
            expect(next).toHaveBeenCalled();
        });

        it('should use existing x-request-id from request', () => {
            const { timing } = getTimingAndLogger();
            const { req, res, next } = createMockReqRes({
                req: { headers: { 'x-request-id': 'custom-id-123' } }
            });
            timing.requestTiming(req as any, res as any, next);

            expect(res.setHeader).toHaveBeenCalledWith('X-Request-ID', 'custom-id-123');
        });

        it('should log error for 500 status codes', () => {
            const { timing, logger } = getTimingAndLogger();
            const { req, res, next } = createMockReqRes({
                res: { statusCode: 500 }
            });
            timing.requestTiming(req as any, res as any, next);
            res._triggerFinish();

            expect(logger.error).toHaveBeenCalledWith(
                'HTTP request completed with error',
                expect.objectContaining({ statusCode: 500 })
            );
        });

        it('should not log health check paths', () => {
            const { timing, logger } = getTimingAndLogger();
            const { req, res, next } = createMockReqRes({
                req: { path: '/health' }
            });
            timing.requestTiming(req as any, res as any, next);
            res._triggerFinish();

            expect(logger.debug).not.toHaveBeenCalledWith(
                'HTTP request completed',
                expect.anything()
            );
        });

        it('should not log /health/live paths', () => {
            const { timing, logger } = getTimingAndLogger();
            const { req, res, next } = createMockReqRes({
                req: { path: '/health/live' }
            });
            timing.requestTiming(req as any, res as any, next);
            res._triggerFinish();

            expect(logger.debug).not.toHaveBeenCalledWith(
                'HTTP request completed',
                expect.anything()
            );
        });

        it('should log normal requests at debug level', () => {
            const { timing, logger } = getTimingAndLogger();
            const { req, res, next } = createMockReqRes({
                req: { path: '/api/rooms' }
            });
            timing.requestTiming(req as any, res as any, next);
            res._triggerFinish();

            expect(logger.debug).toHaveBeenCalledWith(
                'HTTP request completed',
                expect.objectContaining({
                    method: 'GET',
                    path: '/api/rooms'
                })
            );
        });
    });

    describe('socketEventTiming', () => {
        it('should wrap a handler and record timing', async () => {
            const { timing } = getTimingAndLogger();
            const handler = jest.fn().mockResolvedValue('result');
            const wrapped = timing.socketEventTiming('game:start', handler);

            const context = { id: 'socket-1', sessionId: 'session-1' };
            const result = await wrapped.call(context as any, 'arg1');

            expect(handler).toHaveBeenCalledWith('arg1');
            expect(result).toBe('result');
        });

        it('should re-throw errors and log them', async () => {
            const { timing, logger } = getTimingAndLogger();
            const error = new Error('Handler failed');
            const handler = jest.fn().mockRejectedValue(error);

            const wrapped = timing.socketEventTiming('game:clue', handler);
            const context = { id: 'socket-1', sessionId: 'session-1' };

            await expect(wrapped.call(context as any)).rejects.toThrow('Handler failed');

            expect(logger.error).toHaveBeenCalledWith(
                'Socket event error',
                expect.objectContaining({
                    event: 'game:clue',
                    socketId: 'socket-1',
                    error: 'Handler failed'
                })
            );
        });

        it('should handle synchronous handlers', async () => {
            const { timing } = getTimingAndLogger();
            const handler = jest.fn().mockReturnValue('sync-result');
            const wrapped = timing.socketEventTiming('player:setTeam', handler);
            const context = { id: 'socket-1', sessionId: 'session-1' };

            const result = await wrapped.call(context as any);
            expect(result).toBe('sync-result');
        });
    });

    describe('Memory Monitoring', () => {
        let timing: any;
        let logger: any;

        beforeEach(() => {
            // Order matters: reset modules first, then set up fake timers, then load
            jest.resetModules();
            jest.useFakeTimers();
            // Load modules AFTER fake timers are set up and modules are reset
            logger = require('../utils/logger');
            timing = require('../middleware/timing');
        });

        afterEach(() => {
            timing.stopMemoryMonitoring();
            jest.clearAllTimers();
            jest.useRealTimers();
        });

        it('should start monitoring and report started', () => {
            timing.startMemoryMonitoring();
            expect(logger.info).toHaveBeenCalledWith('Memory monitoring started');
        });

        it('should not start duplicate monitoring', () => {
            timing.startMemoryMonitoring();
            timing.startMemoryMonitoring();
            const infoCallsWithStarted = (logger.info as jest.Mock).mock.calls
                .filter((c: any[]) => c[0] === 'Memory monitoring started');
            expect(infoCallsWithStarted).toHaveLength(1);
        });

        it('should stop monitoring', () => {
            timing.startMemoryMonitoring();
            timing.stopMemoryMonitoring();

            expect(logger.info).toHaveBeenCalledWith('Memory monitoring stopped');
        });

        it('should be safe to stop when not running', () => {
            timing.stopMemoryMonitoring();
        });

        it('should warn on high memory usage (>300MB)', () => {
            const originalMemoryUsage = process.memoryUsage;
            process.memoryUsage = jest.fn().mockReturnValue({
                heapUsed: 350 * 1024 * 1024,
                heapTotal: 512 * 1024 * 1024,
                rss: 400 * 1024 * 1024,
                external: 10 * 1024 * 1024,
                arrayBuffers: 5 * 1024 * 1024
            }) as any;

            timing.startMemoryMonitoring();
            jest.advanceTimersByTime(60000);

            expect(logger.warn).toHaveBeenCalledWith(
                'High memory usage detected',
                expect.objectContaining({
                    heapUsedMB: 350
                })
            );

            timing.stopMemoryMonitoring();
            process.memoryUsage = originalMemoryUsage;
        });

        it('should trigger emergency cleanup on critical memory usage (>400MB)', () => {
            const originalMemoryUsage = process.memoryUsage;
            process.memoryUsage = jest.fn().mockReturnValue({
                heapUsed: 450 * 1024 * 1024,
                heapTotal: 512 * 1024 * 1024,
                rss: 500 * 1024 * 1024,
                external: 10 * 1024 * 1024,
                arrayBuffers: 5 * 1024 * 1024
            }) as any;

            timing.startMemoryMonitoring();
            jest.advanceTimersByTime(60000);

            expect(logger.error).toHaveBeenCalledWith(
                'Critical memory usage - forcing cleanup',
                expect.objectContaining({
                    heapUsedMB: 450
                })
            );

            timing.stopMemoryMonitoring();
            process.memoryUsage = originalMemoryUsage;
        });
    });
});
