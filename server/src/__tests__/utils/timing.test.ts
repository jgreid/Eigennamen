/**
 * Timing Middleware Tests
 * Tests for request timing, socket event timing, and memory monitoring
 */

jest.mock('../../utils/logger');

const logger = require('../../utils/logger');
const {
    requestTiming,
    socketEventTiming,
    startMemoryMonitoring,
    stopMemoryMonitoring,
} = require('../../middleware/timing');

describe('Timing Middleware', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Stop any running memory monitoring from previous tests
        stopMemoryMonitoring();
    });

    afterEach(() => {
        stopMemoryMonitoring();
    });

    describe('requestTiming', () => {
        let mockReq, mockRes, mockNext;

        beforeEach(() => {
            mockReq = {
                headers: {},
                method: 'GET',
                path: '/test',
                get: jest.fn((header) => {
                    if (header === 'User-Agent') return 'Test Browser';
                    return null;
                }),
            };
            mockRes = {
                setHeader: jest.fn(),
                get: jest.fn(),
                statusCode: 200,
                on: jest.fn(),
            };
            mockNext = jest.fn();
        });

        it('should attach request ID to request and response', () => {
            requestTiming(mockReq, mockRes, mockNext);

            expect(mockReq.requestId).toBeDefined();
            expect(mockRes.setHeader).toHaveBeenCalledWith('X-Request-ID', expect.any(String));
            expect(mockNext).toHaveBeenCalled();
        });

        it('should use existing X-Request-ID header if present', () => {
            mockReq.headers['x-request-id'] = 'existing-request-id';

            requestTiming(mockReq, mockRes, mockNext);

            expect(mockReq.requestId).toBe('existing-request-id');
            expect(mockRes.setHeader).toHaveBeenCalledWith('X-Request-ID', 'existing-request-id');
        });

        it('should log on response finish', () => {
            requestTiming(mockReq, mockRes, mockNext);

            // Capture the finish handler
            const finishHandler = mockRes.on.mock.calls.find((call) => call[0] === 'finish')[1];
            expect(finishHandler).toBeDefined();

            // Trigger finish
            finishHandler();

            expect(logger.debug).toHaveBeenCalledWith(
                'HTTP request completed',
                expect.objectContaining({
                    method: 'GET',
                    path: '/test',
                    statusCode: 200,
                })
            );
        });

        it('should log error level for 5xx status codes', () => {
            mockRes.statusCode = 500;

            requestTiming(mockReq, mockRes, mockNext);

            const finishHandler = mockRes.on.mock.calls.find((call) => call[0] === 'finish')[1];
            finishHandler();

            expect(logger.error).toHaveBeenCalledWith('HTTP request completed with error', expect.any(Object));
        });

        it('should not log health check endpoints', () => {
            mockReq.path = '/health';

            requestTiming(mockReq, mockRes, mockNext);

            const finishHandler = mockRes.on.mock.calls.find((call) => call[0] === 'finish')[1];
            finishHandler();

            expect(logger.debug).not.toHaveBeenCalled();
        });

        it('should not log health/live endpoint', () => {
            mockReq.path = '/health/live';

            requestTiming(mockReq, mockRes, mockNext);

            const finishHandler = mockRes.on.mock.calls.find((call) => call[0] === 'finish')[1];
            finishHandler();

            expect(logger.debug).not.toHaveBeenCalled();
        });

        it('should truncate long user agents', () => {
            const longUserAgent = 'A'.repeat(200);
            mockReq.get = jest.fn((header) => {
                if (header === 'User-Agent') return longUserAgent;
                return null;
            });

            requestTiming(mockReq, mockRes, mockNext);

            const finishHandler = mockRes.on.mock.calls.find((call) => call[0] === 'finish')[1];
            finishHandler();

            expect(logger.debug).toHaveBeenCalledWith(
                'HTTP request completed',
                expect.objectContaining({
                    userAgent: 'A'.repeat(100),
                })
            );
        });

        it('should handle missing content-length', () => {
            mockRes.get = jest.fn().mockReturnValue(undefined);

            requestTiming(mockReq, mockRes, mockNext);

            const finishHandler = mockRes.on.mock.calls.find((call) => call[0] === 'finish')[1];
            finishHandler();

            expect(logger.debug).toHaveBeenCalledWith(
                'HTTP request completed',
                expect.objectContaining({
                    contentLength: 0,
                })
            );
        });
    });

    describe('socketEventTiming', () => {
        let mockSocket;

        beforeEach(() => {
            mockSocket = {
                id: 'socket-123',
                sessionId: 'session-456',
            };
        });

        it('should return a function', () => {
            const handler = jest.fn();
            const wrappedHandler = socketEventTiming('test:event', handler);
            expect(typeof wrappedHandler).toBe('function');
        });

        it('should call the original handler', async () => {
            const handler = jest.fn().mockResolvedValue('result');
            const wrappedHandler = socketEventTiming('test:event', handler);

            const result = await wrappedHandler.call(mockSocket, 'arg1', 'arg2');

            expect(handler).toHaveBeenCalledWith('arg1', 'arg2');
            expect(result).toBe('result');
        });

        it('should pass through handler return value', async () => {
            const handler = jest.fn().mockResolvedValue({ data: 'test' });
            const wrappedHandler = socketEventTiming('test:event', handler);

            const result = await wrappedHandler.call(mockSocket);

            expect(result).toEqual({ data: 'test' });
        });

        it('should re-throw handler errors', async () => {
            const error = new Error('Handler error');
            const handler = jest.fn().mockRejectedValue(error);
            const wrappedHandler = socketEventTiming('test:event', handler);

            await expect(wrappedHandler.call(mockSocket)).rejects.toThrow('Handler error');
        });

        it('should log error on handler failure', async () => {
            const error = new Error('Handler error');
            const handler = jest.fn().mockRejectedValue(error);
            const wrappedHandler = socketEventTiming('test:event', handler);

            try {
                await wrappedHandler.call(mockSocket);
            } catch {
                // Expected
            }

            expect(logger.error).toHaveBeenCalledWith(
                'Socket event error',
                expect.objectContaining({
                    event: 'test:event',
                    socketId: 'socket-123',
                    sessionId: 'session-456',
                    error: 'Handler error',
                })
            );
        });

        it('should measure duration for fast handlers', async () => {
            const handler = jest.fn().mockResolvedValue(undefined);
            const wrappedHandler = socketEventTiming('test:event', handler);

            await wrappedHandler.call(mockSocket);

            // Fast handlers (< 100ms) should not log
            expect(logger.debug).not.toHaveBeenCalled();
            expect(logger.warn).not.toHaveBeenCalled();
        });

        it('should handle synchronous handlers', async () => {
            const handler = jest.fn().mockReturnValue('sync-result');
            const wrappedHandler = socketEventTiming('test:event', handler);

            const result = await wrappedHandler.call(mockSocket);

            expect(result).toBe('sync-result');
        });
    });

    describe('Memory Monitoring', () => {
        let memoryUsageSpy;

        beforeEach(() => {
            jest.useFakeTimers();
            // Mock process.memoryUsage to return values below warning threshold (300MB)
            memoryUsageSpy = jest.spyOn(process, 'memoryUsage').mockReturnValue({
                rss: 150 * 1024 * 1024,
                heapTotal: 200 * 1024 * 1024,
                heapUsed: 100 * 1024 * 1024,
                external: 10 * 1024 * 1024,
                arrayBuffers: 5 * 1024 * 1024,
            });
        });

        afterEach(() => {
            jest.useRealTimers();
            stopMemoryMonitoring();
            memoryUsageSpy.mockRestore();
        });

        it('should start memory monitoring', () => {
            startMemoryMonitoring();
            expect(logger.info).toHaveBeenCalledWith('Memory monitoring started');
        });

        it('should not start monitoring twice', () => {
            startMemoryMonitoring();
            startMemoryMonitoring();

            // Should only log once
            expect(logger.info.mock.calls.filter((call) => call[0] === 'Memory monitoring started').length).toBe(1);
        });

        it('should stop memory monitoring', () => {
            startMemoryMonitoring();
            stopMemoryMonitoring();
            expect(logger.info).toHaveBeenCalledWith('Memory monitoring stopped');
        });

        it('should handle stop when not started', () => {
            stopMemoryMonitoring();
            // Should not throw and should not log
            expect(logger.info).not.toHaveBeenCalledWith('Memory monitoring stopped');
        });

        it('should log memory usage periodically', () => {
            startMemoryMonitoring();

            // Advance timer by 1 minute
            jest.advanceTimersByTime(60000);

            expect(logger.debug).toHaveBeenCalledWith(
                'Memory usage',
                expect.objectContaining({
                    heapUsedMB: expect.any(Number),
                    heapTotalMB: expect.any(Number),
                    rssMB: expect.any(Number),
                })
            );
        });

        it('should log multiple times at intervals', () => {
            startMemoryMonitoring();

            jest.advanceTimersByTime(60000);
            jest.advanceTimersByTime(60000);
            jest.advanceTimersByTime(60000);

            // Should have logged 3 times
            const memoryCalls = logger.debug.mock.calls.filter((call) => call[0] === 'Memory usage');
            expect(memoryCalls.length).toBe(3);
        });

        it('should stop logging after stopMemoryMonitoring', () => {
            startMemoryMonitoring();

            jest.advanceTimersByTime(60000);
            stopMemoryMonitoring();
            logger.debug.mockClear();

            jest.advanceTimersByTime(60000);

            // Should not have logged after stop
            expect(logger.debug).not.toHaveBeenCalled();
        });

        it('should log heap usage percentage', () => {
            startMemoryMonitoring();

            jest.advanceTimersByTime(60000);

            expect(logger.debug).toHaveBeenCalledWith(
                'Memory usage',
                expect.objectContaining({
                    heapUsagePercent: expect.any(Number),
                })
            );
        });
    });

    describe('generateRequestId', () => {
        it('should generate unique IDs', () => {
            // Access through requestTiming by checking IDs
            const ids = new Set();
            for (let i = 0; i < 100; i++) {
                const mockReq = { headers: {}, method: 'GET', path: '/test', get: jest.fn() };
                const mockRes = { setHeader: jest.fn(), on: jest.fn() };
                const mockNext = jest.fn();

                requestTiming(mockReq, mockRes, mockNext);
                ids.add(mockReq.requestId);
            }

            // All IDs should be unique
            expect(ids.size).toBe(100);
        });
    });
});
