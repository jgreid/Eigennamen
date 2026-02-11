/**
 * Timer Service Branch Coverage Tests
 *
 * Covers uncovered branches in services/timerService.ts:
 * - Line 255: getTimerStatus paused timer branch (timer.paused && timer.remainingWhenPaused !== undefined)
 * - Lines 358-371: resumeTimer expired-while-paused branch (pausedDuration >= remainingWhenPausedMs)
 * - Line 377: resumeTimer undefined remainingSeconds branch
 * - Timer expire callback error handling
 * - addTime validation branches
 */

const mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
};

jest.mock('../utils/logger', () => mockLogger);

let mockRedisStorage: Record<string, string> = {};

const mockRedis = {
    set: jest.fn(async (key: string, value: string) => {
        mockRedisStorage[key] = value;
        return 'OK';
    }),
    get: jest.fn(async (key: string) => {
        return mockRedisStorage[key] || null;
    }),
    del: jest.fn(async (key: string) => {
        delete mockRedisStorage[key];
        return 1;
    }),
    eval: jest.fn(async () => null)
};

jest.mock('../infrastructure/redis', () => ({
    getRedis: () => mockRedis
}));

const timerService = require('../services/timerService');

jest.useFakeTimers();

async function flushPromises() {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
}

describe('Timer Service Branch Coverage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockRedisStorage = {};

        mockRedis.get.mockImplementation(async (key: string) => {
            return mockRedisStorage[key] || null;
        });
        mockRedis.set.mockImplementation(async (key: string, value: string) => {
            mockRedisStorage[key] = value;
            return 'OK';
        });
        mockRedis.del.mockImplementation(async (key: string) => {
            delete mockRedisStorage[key];
            return 1;
        });
        mockRedis.eval.mockResolvedValue(null);
    });

    afterEach(async () => {
        await timerService.cleanupAllTimers();
        jest.clearAllTimers();
    });

    describe('getTimerStatus paused timer branch (line 255)', () => {
        it('should return paused status with remainingWhenPaused', async () => {
            const timerData = {
                roomCode: 'PAUSED_ROOM',
                startTime: Date.now() - 30000,
                endTime: Date.now() + 30000,
                duration: 60,
                instanceId: '123',
                paused: true,
                remainingWhenPaused: 30
            };
            mockRedisStorage['timer:PAUSED_ROOM'] = JSON.stringify(timerData);

            const status = await timerService.getTimerStatus('PAUSED_ROOM');

            expect(status).not.toBeNull();
            expect(status.isPaused).toBe(true);
            expect(status.remainingSeconds).toBe(30);
            expect(status.expired).toBe(false);
        });

        it('should handle paused timer with undefined remainingWhenPaused', async () => {
            const timerData = {
                roomCode: 'PAUSED_NOREMAINING',
                startTime: Date.now() - 30000,
                endTime: Date.now() + 30000,
                duration: 60,
                instanceId: '123',
                paused: true
                // no remainingWhenPaused - should fall through to normal calculation
            };
            mockRedisStorage['timer:PAUSED_NOREMAINING'] = JSON.stringify(timerData);

            const status = await timerService.getTimerStatus('PAUSED_NOREMAINING');

            expect(status).not.toBeNull();
            // Should not be treated as paused since remainingWhenPaused is undefined
            expect(status.isPaused).toBe(false);
            expect(status.remainingSeconds).toBeGreaterThan(0);
        });

        it('should handle non-paused timer normally', async () => {
            const timerData = {
                roomCode: 'NORMAL_ROOM',
                startTime: Date.now() - 30000,
                endTime: Date.now() + 30000,
                duration: 60,
                instanceId: '123',
                paused: false
            };
            mockRedisStorage['timer:NORMAL_ROOM'] = JSON.stringify(timerData);

            const status = await timerService.getTimerStatus('NORMAL_ROOM');

            expect(status).not.toBeNull();
            expect(status.isPaused).toBe(false);
            expect(status.remainingSeconds).toBeGreaterThan(0);
            expect(status.expired).toBe(false);
        });
    });

    describe('resumeTimer expired-while-paused branch (lines 358-371)', () => {
        it('should treat timer as expired when paused longer than remaining time', async () => {
            const onExpire = jest.fn();

            // Create a paused timer that has been paused for longer than remaining time
            const timerData = {
                roomCode: 'EXPIRED_PAUSED',
                startTime: Date.now() - 120000,
                endTime: Date.now() - 60000,
                duration: 60,
                instanceId: '123',
                paused: true,
                remainingWhenPaused: 10, // had 10 seconds left
                pausedAt: Date.now() - 30000 // was paused 30 seconds ago
            };
            mockRedisStorage['timer:EXPIRED_PAUSED'] = JSON.stringify(timerData);

            const result = await timerService.resumeTimer('EXPIRED_PAUSED', onExpire);

            expect(result).toBeNull();
            expect(onExpire).toHaveBeenCalledWith('EXPIRED_PAUSED');
            expect(mockLogger.info).toHaveBeenCalledWith(
                expect.stringContaining('would have expired while paused')
            );
            // Timer should be deleted from Redis
            expect(mockRedisStorage['timer:EXPIRED_PAUSED']).toBeUndefined();
        });

        it('should call expire callback and handle errors in it', async () => {
            const onExpire = jest.fn().mockRejectedValue(new Error('Callback error'));

            const timerData = {
                roomCode: 'EXPIRE_ERR',
                startTime: Date.now() - 120000,
                endTime: Date.now() - 60000,
                duration: 60,
                instanceId: '123',
                paused: true,
                remainingWhenPaused: 5,
                pausedAt: Date.now() - 30000
            };
            mockRedisStorage['timer:EXPIRE_ERR'] = JSON.stringify(timerData);

            const result = await timerService.resumeTimer('EXPIRE_ERR', onExpire);

            expect(result).toBeNull();
            expect(onExpire).toHaveBeenCalledWith('EXPIRE_ERR');
            expect(mockLogger.error).toHaveBeenCalledWith(
                expect.stringContaining('Error in timer expire callback'),
                expect.any(Error)
            );
        });

        it('should resume timer normally when not expired while paused', async () => {
            const onExpire = jest.fn();

            const timerData = {
                roomCode: 'RESUME_OK',
                startTime: Date.now() - 30000,
                endTime: Date.now() + 30000,
                duration: 60,
                instanceId: '123',
                paused: true,
                remainingWhenPaused: 30,
                pausedAt: Date.now() - 5000 // only paused for 5 seconds
            };
            mockRedisStorage['timer:RESUME_OK'] = JSON.stringify(timerData);

            const result = await timerService.resumeTimer('RESUME_OK', onExpire);

            expect(result).not.toBeNull();
            expect(result.remainingSeconds).toBe(30);
            expect(onExpire).not.toHaveBeenCalled();
        });

        it('should not check expiration when pausedAt is not set', async () => {
            const onExpire = jest.fn();

            const timerData = {
                roomCode: 'NO_PAUSED_AT',
                startTime: Date.now() - 30000,
                endTime: Date.now() + 30000,
                duration: 60,
                instanceId: '123',
                paused: true,
                remainingWhenPaused: 30
                // no pausedAt
            };
            mockRedisStorage['timer:NO_PAUSED_AT'] = JSON.stringify(timerData);

            const result = await timerService.resumeTimer('NO_PAUSED_AT', onExpire);

            expect(result).not.toBeNull();
            expect(result.remainingSeconds).toBe(30);
        });
    });

    describe('resumeTimer undefined remainingSeconds branch (line 377)', () => {
        it('should return null when remainingWhenPaused is undefined', async () => {
            const timerData = {
                roomCode: 'UNDEFINED_REMAINING',
                startTime: Date.now() - 30000,
                endTime: Date.now() + 30000,
                duration: 60,
                instanceId: '123',
                paused: true
                // no remainingWhenPaused
            };
            mockRedisStorage['timer:UNDEFINED_REMAINING'] = JSON.stringify(timerData);

            const result = await timerService.resumeTimer('UNDEFINED_REMAINING');

            expect(result).toBeNull();
        });
    });

    describe('resumeTimer edge cases', () => {
        it('should return null when timer is not paused', async () => {
            const timerData = {
                roomCode: 'NOT_PAUSED',
                startTime: Date.now() - 30000,
                endTime: Date.now() + 30000,
                duration: 60,
                instanceId: '123',
                paused: false
            };
            mockRedisStorage['timer:NOT_PAUSED'] = JSON.stringify(timerData);

            const result = await timerService.resumeTimer('NOT_PAUSED');
            expect(result).toBeNull();
        });

        it('should return null when no timer data exists', async () => {
            const result = await timerService.resumeTimer('NONEXISTENT');
            expect(result).toBeNull();
        });

        it('should return null when timer data is invalid JSON', async () => {
            mockRedisStorage['timer:BAD_JSON'] = 'not valid json';

            const result = await timerService.resumeTimer('BAD_JSON');
            expect(result).toBeNull();
        });

        it('should resume without expire callback when paused-expired and no callback', async () => {
            const timerData = {
                roomCode: 'EXPIRED_NO_CB',
                startTime: Date.now() - 120000,
                endTime: Date.now() - 60000,
                duration: 60,
                instanceId: '123',
                paused: true,
                remainingWhenPaused: 5,
                pausedAt: Date.now() - 30000
            };
            mockRedisStorage['timer:EXPIRED_NO_CB'] = JSON.stringify(timerData);

            const result = await timerService.resumeTimer('EXPIRED_NO_CB');
            expect(result).toBeNull();
            // Should still clean up
            expect(mockRedisStorage['timer:EXPIRED_NO_CB']).toBeUndefined();
        });
    });

    describe('timer expire callback error handling', () => {
        it('should log error when expire callback throws', async () => {
            const failingCallback = jest.fn().mockRejectedValue(new Error('Callback failed'));

            await timerService.startTimer('ROOM_CALLBACK_ERR', 1, failingCallback);

            jest.advanceTimersByTime(1500);
            await flushPromises();

            expect(failingCallback).toHaveBeenCalledWith('ROOM_CALLBACK_ERR');
            expect(mockLogger.error).toHaveBeenCalledWith(
                'Error in timer expire callback for room ROOM_CALLBACK_ERR:',
                expect.any(Error)
            );
        });

        it('should log error when Redis del fails during expiration', async () => {
            const onExpire = jest.fn();
            await timerService.startTimer('ROOM_REDIS_ERR', 1, onExpire);

            mockRedis.del.mockRejectedValue(new Error('Redis connection lost'));

            jest.advanceTimersByTime(1500);
            await flushPromises();

            expect(mockLogger.error).toHaveBeenCalledWith(
                'Error handling timer expiration for room ROOM_REDIS_ERR:',
                expect.any(Error)
            );
        });

        it('should expire timer without callback', async () => {
            await timerService.startTimer('ROOM_NO_CB', 1);

            jest.advanceTimersByTime(1500);
            await flushPromises();

            expect(mockLogger.info).toHaveBeenCalledWith(
                'Timer expired for room ROOM_NO_CB'
            );
        });
    });

    describe('addTime validation', () => {
        it('should throw for empty roomCode', async () => {
            await expect(timerService.addTime('', 30)).rejects.toThrow('Invalid roomCode');
        });

        it('should throw for non-string roomCode', async () => {
            await expect(timerService.addTime(123 as any, 30)).rejects.toThrow('Invalid roomCode');
        });

        it('should throw for negative secondsToAdd', async () => {
            await expect(timerService.addTime('ROOM1', -5)).rejects.toThrow('Invalid secondsToAdd');
        });

        it('should throw for zero secondsToAdd', async () => {
            await expect(timerService.addTime('ROOM1', 0)).rejects.toThrow('Invalid secondsToAdd');
        });

        it('should throw for NaN secondsToAdd', async () => {
            await expect(timerService.addTime('ROOM1', NaN)).rejects.toThrow('Invalid secondsToAdd');
        });

        it('should throw for Infinity secondsToAdd', async () => {
            await expect(timerService.addTime('ROOM1', Infinity)).rejects.toThrow('Invalid secondsToAdd');
        });

        it('should throw when secondsToAdd exceeds MAX_TURN_SECONDS', async () => {
            await expect(timerService.addTime('ROOM1', 999999)).rejects.toThrow('cannot exceed');
        });

        it('should return null when timer does not exist', async () => {
            const result = await timerService.addTime('NONEXISTENT', 30);
            expect(result).toBeNull();
        });
    });

    describe('addTime with local timer', () => {
        it('should update local timer when eval returns result', async () => {
            await timerService.startTimer('ADD_TIME_ROOM', 60);

            const newEndTime = Date.now() + 90000;
            mockRedis.eval.mockResolvedValue(JSON.stringify({
                endTime: newEndTime,
                duration: 90,
                remainingSeconds: 90
            }));

            const result = await timerService.addTime('ADD_TIME_ROOM', 30);

            expect(result).not.toBeNull();
            expect(result!.remainingSeconds).toBe(90);
        });

        it('should handle invalid eval result JSON', async () => {
            await timerService.startTimer('EVAL_BAD_JSON', 60);

            mockRedis.eval.mockResolvedValue('not valid json');

            const result = await timerService.addTime('EVAL_BAD_JSON', 30);

            expect(result).toBeNull();
        });
    });

    describe('pauseTimer', () => {
        it('should return null when timer does not exist', async () => {
            const result = await timerService.pauseTimer('NONEXISTENT');
            expect(result).toBeNull();
        });

        it('should return null when timer is expired', async () => {
            const timerData = {
                roomCode: 'EXPIRED_PAUSE',
                startTime: Date.now() - 120000,
                endTime: Date.now() - 60000,
                duration: 60,
                instanceId: '123'
            };
            mockRedisStorage['timer:EXPIRED_PAUSE'] = JSON.stringify(timerData);

            const result = await timerService.pauseTimer('EXPIRED_PAUSE');
            expect(result).toBeNull();
        });

        it('should pause an active timer successfully', async () => {
            await timerService.startTimer('PAUSE_ACTIVE', 60);

            const result = await timerService.pauseTimer('PAUSE_ACTIVE');

            expect(result).not.toBeNull();
            expect(result!.remainingSeconds).toBeGreaterThan(0);
        });

        it('should handle parse error in pauseTimer body', async () => {
            // Create valid timer first for getTimerStatus
            const validTimer = {
                roomCode: 'PARSE_ERR',
                startTime: Date.now(),
                endTime: Date.now() + 60000,
                duration: 60,
                instanceId: '123'
            };
            mockRedisStorage['timer:PARSE_ERR'] = JSON.stringify(validTimer);

            // Make second get return invalid JSON
            let getCount = 0;
            mockRedis.get.mockImplementation(async (key: string) => {
                if (key === 'timer:PARSE_ERR') {
                    getCount++;
                    if (getCount === 1) return JSON.stringify(validTimer);
                    return 'invalid json {{{';
                }
                return mockRedisStorage[key] || null;
            });

            const result = await timerService.pauseTimer('PARSE_ERR');
            expect(result).toBeNull();
        });
    });

    describe('hasActiveTimer', () => {
        it('should return false when no timer exists', async () => {
            const result = await timerService.hasActiveTimer('NONEXISTENT');
            expect(result).toBe(false);
        });

        it('should return true when active timer exists', async () => {
            await timerService.startTimer('ACTIVE_TIMER', 60);
            const result = await timerService.hasActiveTimer('ACTIVE_TIMER');
            expect(result).toBe(true);
        });

        it('should return false when timer is expired', async () => {
            const timerData = {
                roomCode: 'EXPIRED_TIMER',
                startTime: Date.now() - 120000,
                endTime: Date.now() - 60000,
                duration: 60,
                instanceId: '123'
            };
            mockRedisStorage['timer:EXPIRED_TIMER'] = JSON.stringify(timerData);

            const result = await timerService.hasActiveTimer('EXPIRED_TIMER');
            expect(result).toBe(false);
        });
    });

    describe('stopTimer', () => {
        it('should stop existing timer', async () => {
            await timerService.startTimer('STOP_TIMER', 60);
            await timerService.stopTimer('STOP_TIMER');

            expect(mockLogger.info).toHaveBeenCalledWith('Timer stopped for room STOP_TIMER');
        });

        it('should handle stopping non-existent timer gracefully', async () => {
            await timerService.stopTimer('NONEXISTENT');
            expect(mockLogger.info).toHaveBeenCalledWith('Timer stopped for room NONEXISTENT');
        });
    });

    describe('cleanupAllTimers', () => {
        it('should clear all local timers', async () => {
            await timerService.startTimer('CLEANUP1', 60);
            await timerService.startTimer('CLEANUP2', 60);

            timerService.cleanupAllTimers();

            expect(mockLogger.info).toHaveBeenCalledWith('All local timers cleaned up');

            // Timers should not fire after cleanup
            jest.advanceTimersByTime(120000);
            await flushPromises();
        });
    });
});
