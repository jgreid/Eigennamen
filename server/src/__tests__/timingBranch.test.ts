/**
 * Timing Middleware Branch Coverage Tests
 * Targets uncovered lines: 89, 123, 125, 179-185
 *
 * Line 89: HTTP request slow warning (duration > 1000ms)
 * Line 123: Socket event slow warning (duration > 500ms)
 * Line 125: Socket event debug log (100 < duration < 500ms)
 * Lines 179-185: Memory monitoring critical threshold with memory storage cleanup
 */

jest.mock('../utils/logger', () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
}));

describe('Timing Branch Coverage', () => {
    let timing: any;
    let loggerMod: any;

    beforeEach(() => {
        jest.clearAllMocks();
        jest.resetModules();

        jest.mock('../utils/logger', () => ({
            debug: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn()
        }));
        timing = require('../middleware/timing');
        loggerMod = require('../utils/logger');
        timing.stopMemoryMonitoring();
    });

    afterEach(() => {
        timing.stopMemoryMonitoring();
        jest.restoreAllMocks();
    });

    describe('Line 89: slow HTTP request warning', () => {
        it('should log warn for requests taking > 1000ms', () => {
            const mockReq: any = {
                headers: {},
                method: 'GET',
                path: '/api/slow',
                get: jest.fn((header: string) => {
                    if (header === 'User-Agent') return 'Test';
                    return null;
                })
            };
            const finishHandlers: Function[] = [];
            const mockRes: any = {
                setHeader: jest.fn(),
                get: jest.fn(() => '100'),
                statusCode: 200,
                on: jest.fn((event: string, handler: Function) => {
                    if (event === 'finish') finishHandlers.push(handler);
                })
            };
            const mockNext = jest.fn();

            let callCount = 0;
            jest.spyOn(process.hrtime, 'bigint').mockImplementation(() => {
                callCount++;
                if (callCount === 1) return BigInt(0);
                return BigInt(1500 * 1e6); // 1500ms
            });

            timing.requestTiming(mockReq, mockRes, mockNext);
            finishHandlers[0]();

            expect(loggerMod.warn).toHaveBeenCalledWith(
                'HTTP request slow',
                expect.objectContaining({ path: '/api/slow' })
            );

            jest.restoreAllMocks();
        });
    });

    describe('Lines 123/125: socket event timing branches', () => {
        it('should warn for socket events taking > 500ms', async () => {
            let callCount = 0;
            jest.spyOn(process.hrtime, 'bigint').mockImplementation(() => {
                callCount++;
                if (callCount === 1) return BigInt(0);
                return BigInt(600 * 1e6); // 600ms
            });

            const handler = jest.fn().mockResolvedValue('result');
            const wrapped = timing.socketEventTiming('test:event', handler);

            const socket = { id: 'socket-1', sessionId: 'sess-1' };
            await wrapped.call(socket);

            expect(loggerMod.warn).toHaveBeenCalledWith(
                'Socket event slow',
                expect.objectContaining({ event: 'test:event', socketId: 'socket-1' })
            );

            jest.restoreAllMocks();
        });

        it('should debug log for socket events between 100-500ms', async () => {
            let callCount = 0;
            jest.spyOn(process.hrtime, 'bigint').mockImplementation(() => {
                callCount++;
                if (callCount === 1) return BigInt(0);
                return BigInt(200 * 1e6); // 200ms
            });

            const handler = jest.fn().mockResolvedValue('result');
            const wrapped = timing.socketEventTiming('test:event', handler);

            const socket = { id: 'socket-2', sessionId: 'sess-2' };
            await wrapped.call(socket);

            expect(loggerMod.debug).toHaveBeenCalledWith(
                'Socket event timing',
                expect.objectContaining({ event: 'test:event', socketId: 'socket-2' })
            );

            jest.restoreAllMocks();
        });
    });

    describe('Lines 179-185: critical memory with MemoryStorage cleanup', () => {
        it('should trigger emergency cleanup when heap exceeds critical threshold', () => {
            jest.useFakeTimers();

            const mockCleanup = jest.fn().mockReturnValue(50);
            const mockKeyCount = jest.fn().mockReturnValue(100);

            jest.spyOn(process, 'memoryUsage').mockReturnValue({
                heapUsed: 450 * 1024 * 1024, // 450MB
                heapTotal: 512 * 1024 * 1024,
                rss: 500 * 1024 * 1024,
                external: 10 * 1024 * 1024,
                arrayBuffers: 0
            });

            jest.resetModules();
            jest.doMock('../utils/logger', () => ({
                debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn()
            }));
            jest.doMock('../config/memoryStorage', () => ({
                isMemoryMode: jest.fn(() => true),
                getMemoryStorage: jest.fn(() => ({
                    forceCleanup: mockCleanup,
                    getKeyCount: mockKeyCount
                }))
            }));
            const timingMod = require('../middleware/timing');

            timingMod.startMemoryMonitoring();
            jest.advanceTimersByTime(60001);

            expect(mockCleanup).toHaveBeenCalled();

            timingMod.stopMemoryMonitoring();
            jest.useRealTimers();
            jest.restoreAllMocks();
        });

        it('should handle cleanup error when memoryStorage module throws', () => {
            jest.useFakeTimers();

            jest.spyOn(process, 'memoryUsage').mockReturnValue({
                heapUsed: 450 * 1024 * 1024,
                heapTotal: 512 * 1024 * 1024,
                rss: 500 * 1024 * 1024,
                external: 10 * 1024 * 1024,
                arrayBuffers: 0
            });

            jest.resetModules();
            const errorLogFn = jest.fn();
            jest.doMock('../utils/logger', () => ({
                debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: errorLogFn
            }));
            jest.doMock('../config/memoryStorage', () => {
                throw new Error('Module not available');
            });

            const timingMod = require('../middleware/timing');

            timingMod.startMemoryMonitoring();
            jest.advanceTimersByTime(60001);

            // Should log the critical memory error first, then the cleanup failure
            expect(errorLogFn).toHaveBeenCalledWith(
                'Critical memory usage - forcing cleanup',
                expect.any(Object)
            );
            expect(errorLogFn).toHaveBeenCalledWith(
                'Failed to run emergency cleanup:',
                expect.any(Error)
            );

            timingMod.stopMemoryMonitoring();
            jest.useRealTimers();
            jest.restoreAllMocks();
        });
    });
});
