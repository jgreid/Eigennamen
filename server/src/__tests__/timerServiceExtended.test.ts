/**
 * Extended Unit Tests for Timer Service
 *
 * These tests cover code paths including:
 * - Timer expiration callback with error handling
 * - pauseTimer error handling
 * - addTime local processing
 * - getTimerStatus edge cases
 * - cleanupAllTimers
 * - Edge cases for timer operations
 */

// Mock logger before requiring any modules
const mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
};
jest.mock('../utils/logger', () => mockLogger);

// Create controllable mock implementations
let mockRedis;

jest.mock('../infrastructure/redis', () => {
    // Initialize mocks
    mockRedis = {
        set: jest.fn().mockResolvedValue('OK'),
        get: jest.fn().mockResolvedValue(null),
        del: jest.fn().mockResolvedValue(1),
        keys: jest.fn().mockResolvedValue([]),
        exists: jest.fn().mockResolvedValue(0),
        eval: jest.fn().mockResolvedValue(null),
        scanIterator: jest.fn(),
        _storage: {}
    };

    return {
        getRedis: () => mockRedis
    };
});

// Now require the service
const timerService = require('../services/timerService');
// This import verifies the mock is working but isn't directly used in tests
const { getRedis: _getRedis } = require('../infrastructure/redis');

// Use fake timers
jest.useFakeTimers();

/**
 * Helper to flush multiple microtasks and promises
 */
async function flushPromises() {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
}

describe('Timer Service Extended Tests', () => {
    beforeEach(() => {
        // Reset all mocks
        jest.clearAllMocks();
        mockRedis._storage = {};

        // Setup default Redis behavior
        mockRedis.get.mockImplementation(async (key) => {
            return mockRedis._storage[key] || null;
        });

        mockRedis.set.mockImplementation(async (key, value) => {
            mockRedis._storage[key] = value;
            return 'OK';
        });

        mockRedis.del.mockImplementation(async (key) => {
            delete mockRedis._storage[key];
            return 1;
        });

        mockRedis.exists.mockImplementation(async (key) => {
            return mockRedis._storage[key] ? 1 : 0;
        });

        // Setup eval for atomic operations
        mockRedis.eval.mockImplementation(async (script, options) => {
            const key = options.keys[0];
            const timerData = mockRedis._storage[key];
            if (!timerData) return null;

            try {
                const timer = JSON.parse(timerData);
                if (timer.paused) return null;
                if (timer.claimed) return null;

                const now = Date.now();
                const remainingMs = timer.endTime - now;
                if (remainingMs <= 0) {
                    // For claim script - mark as claimed and return data
                    if (script.includes('claimed')) {
                        delete mockRedis._storage[key];
                        return timerData;
                    }
                    return null;
                }

                // For addTime script
                if (options.arguments && options.arguments.length >= 3) {
                    const secondsToAdd = parseInt(options.arguments[0], 10);
                    const newEndTime = timer.endTime + (secondsToAdd * 1000);
                    const newDuration = Math.ceil((newEndTime - now) / 1000);

                    timer.endTime = newEndTime;
                    timer.duration = newDuration;
                    mockRedis._storage[key] = JSON.stringify(timer);

                    return JSON.stringify({
                        endTime: newEndTime,
                        duration: newDuration,
                        remainingSeconds: newDuration
                    });
                }

                return timerData;
            } catch {
                return null;
            }
        });

        // Setup scanIterator
        mockRedis.scanIterator = jest.fn().mockImplementation(function* () {
            for (const key of Object.keys(mockRedis._storage)) {
                if (key.startsWith('timer:')) {
                    yield key;
                }
            }
        });

    });

    afterEach(async () => {
        await timerService.cleanupAllTimers();
        jest.clearAllTimers();
    });

    describe('Timer expiration callback error handling', () => {
        test('logs error when expire callback throws', async () => {
            const failingCallback = jest.fn().mockRejectedValue(new Error('Callback failed'));

            await timerService.startTimer('ROOM_ERR', 1, failingCallback);

            jest.advanceTimersByTime(1500);
            await flushPromises();

            expect(failingCallback).toHaveBeenCalledWith('ROOM_ERR');
            expect(mockLogger.error).toHaveBeenCalledWith(
                'Error in timer expire callback for room ROOM_ERR:',
                expect.any(Error)
            );
        });

        test('logs error when Redis operations fail during expiration', async () => {
            const onExpire = jest.fn();
            await timerService.startTimer('ROOM_REDIS_ERR', 1, onExpire);

            // Make Redis del fail
            mockRedis.del.mockRejectedValue(new Error('Redis connection lost'));

            jest.advanceTimersByTime(1500);
            await flushPromises();

            expect(mockLogger.error).toHaveBeenCalledWith(
                'Error handling timer expiration for room ROOM_REDIS_ERR:',
                expect.any(Error)
            );
        });
    });

    describe('resumeTimer edge cases', () => {
        test('returns null when timer data is missing', async () => {
            const result = await timerService.resumeTimer('NONEXISTENT_ROOM', jest.fn());

            expect(result).toBeNull();
        });

        test('returns null when timer data is invalid JSON', async () => {
            mockRedis._storage['timer:INVALID_JSON'] = 'not valid json {{{';

            const result = await timerService.resumeTimer('INVALID_JSON', jest.fn());

            expect(result).toBeNull();
        });
    });

    describe('pauseTimer error handling', () => {
        test('returns null when timer data parsing fails', async () => {
            // Create a timer entry with valid format first for getTimerStatus
            const validTimer = {
                roomCode: 'PARSE_ERR',
                startTime: Date.now(),
                endTime: Date.now() + 60000,
                duration: 60,
                instanceId: '123'
            };
            mockRedis._storage['timer:PARSE_ERR'] = JSON.stringify(validTimer);

            // Make second get (in pauseTimer body) return invalid JSON
            let getCount = 0;
            mockRedis.get.mockImplementation(async (key) => {
                getCount++;
                if (key === 'timer:PARSE_ERR') {
                    if (getCount === 1) {
                        return JSON.stringify(validTimer); // For getTimerStatus
                    }
                    return 'invalid json {{{'; // For pauseTimer
                }
                return mockRedis._storage[key] || null;
            });

            const result = await timerService.pauseTimer('PARSE_ERR');

            expect(result).toBeNull();
        });
    });

    describe('addTime', () => {
        test('returns null when timer does not exist', async () => {
            const result = await timerService.addTime('NONEXISTENT', 30, jest.fn());
            expect(result).toBeNull();
        });
    });

    describe('addTimeLocal', () => {
        test('logs info when publishing addTime for non-owner', async () => {
            // Create timer locally first
            await timerService.startTimer('ADD_LOCAL', 60, jest.fn());

            // Now add time - we own it locally
            const result = await timerService.addTime('ADD_LOCAL', 30, jest.fn());

            expect(result).not.toBeNull();
            expect(result.remainingSeconds).toBe(90);
        });

        test('returns null when eval returns null', async () => {
            await timerService.startTimer('EVAL_NULL', 60, jest.fn());

            mockRedis.eval.mockResolvedValue(null);

            const result = await timerService.addTime('EVAL_NULL', 30, jest.fn());
            expect(result).toBeNull();
        });

        test('handles invalid eval result JSON', async () => {
            await timerService.startTimer('EVAL_INVALID', 60, jest.fn());

            mockRedis.eval.mockResolvedValue('invalid json {{{');

            const result = await timerService.addTime('EVAL_INVALID', 30, jest.fn());

            expect(result).toBeNull();
        });

        test('handles expire callback error in addTimeLocal timeout', async () => {
            const failingCallback = jest.fn().mockRejectedValue(new Error('Callback error'));
            await timerService.startTimer('CALLBACK_ERR', 30, failingCallback);

            // Add time with failing callback
            await timerService.addTime('CALLBACK_ERR', 10, failingCallback);

            // Fast forward to expiration
            jest.advanceTimersByTime(45000);
            await flushPromises();

            expect(mockLogger.error).toHaveBeenCalledWith(
                expect.stringContaining('Error in timer expire callback'),
                expect.any(Error)
            );
        });
    });

    describe('getTimerStatus', () => {
        test('returns null for invalid JSON in Redis', async () => {
            mockRedis._storage['timer:INVALID'] = 'not valid json';

            const status = await timerService.getTimerStatus('INVALID');
            expect(status).toBeNull();
        });

        test('returns expired status correctly', async () => {
            const timerData = {
                roomCode: 'EXPIRED_ROOM',
                startTime: Date.now() - 120000,
                endTime: Date.now() - 60000, // Already expired
                duration: 60
            };
            mockRedis._storage['timer:EXPIRED_ROOM'] = JSON.stringify(timerData);

            const status = await timerService.getTimerStatus('EXPIRED_ROOM');

            expect(status.expired).toBe(true);
            expect(status.remainingSeconds).toBe(0);
        });
    });

    describe('cleanupAllTimers', () => {
        test('clears all local timers and stops orphan check', async () => {
            const onExpire1 = jest.fn();
            const onExpire2 = jest.fn();

            await timerService.startTimer('CLEANUP1', 60, onExpire1);
            await timerService.startTimer('CLEANUP2', 60, onExpire2);

            await timerService.cleanupAllTimers();

            jest.advanceTimersByTime(120000);
            await flushPromises();

            expect(onExpire1).not.toHaveBeenCalled();
            expect(onExpire2).not.toHaveBeenCalled();
            expect(mockLogger.info).toHaveBeenCalledWith('All local timers cleaned up');
        });

    });

    describe('Edge cases', () => {
        test('addTime when no remaining time returns null', async () => {
            // Create a local timer first so addTime processes locally
            await timerService.startTimer('EXPIRED_ADD', 60, jest.fn());

            // Now make the eval return null (simulating expired timer)
            mockRedis.eval.mockResolvedValue(null);

            const result = await timerService.addTime('EXPIRED_ADD', 30, jest.fn());
            expect(result).toBeNull();
        });

        test('handles multiple timer operations in quick succession', async () => {
            const onExpire = jest.fn();

            await timerService.startTimer('QUICK1', 60, onExpire);
            await timerService.pauseTimer('QUICK1');
            await timerService.resumeTimer('QUICK1', onExpire);
            await timerService.addTime('QUICK1', 30, onExpire);
            await timerService.stopTimer('QUICK1');

            jest.advanceTimersByTime(120000);
            await flushPromises();

            expect(onExpire).not.toHaveBeenCalled();
        });

        test('timer correctly expires after addTime', async () => {
            const onExpire = jest.fn();
            await timerService.startTimer('ADD_EXPIRE', 10, onExpire);

            jest.advanceTimersByTime(5000); // 5 seconds remaining

            await timerService.addTime('ADD_EXPIRE', 10, onExpire); // Now 15 seconds remaining

            jest.advanceTimersByTime(10000); // 5 seconds remaining
            await flushPromises();
            expect(onExpire).not.toHaveBeenCalled();

            jest.advanceTimersByTime(10000);
            await flushPromises();
            expect(onExpire).toHaveBeenCalled();
        });
    });
});
