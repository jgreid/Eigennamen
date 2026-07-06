/**
 * Unit Tests for Timer Service
 *
 * These tests mock Redis to test the timer service in isolation.
 * The service gracefully degrades when Redis is unavailable.
 */

// Mock Redis before requiring the service
jest.mock('../../config/redis', () => {
    const mockRedis = {
        set: jest.fn().mockResolvedValue('OK'),
        get: jest.fn().mockResolvedValue(null),
        del: jest.fn().mockResolvedValue(1),
        keys: jest.fn().mockResolvedValue([]),
        exists: jest.fn().mockResolvedValue(0),
        // Mock eval for atomic operations (Lua scripts)
        eval: jest.fn().mockResolvedValue(null),
    };

    const mockPubClient = {
        publish: jest.fn().mockResolvedValue(1),
    };

    const mockSubClient = {
        subscribe: jest.fn().mockResolvedValue(),
        unsubscribe: jest.fn().mockResolvedValue(),
    };

    return {
        getRedis: () => mockRedis,
        getPubSubClients: () => ({ pubClient: mockPubClient, subClient: mockSubClient }),
    };
});

const timerService = require('../../services/timerService');
const { getRedis } = require('../../config/redis');

// Fake timers are enabled/disabled per-test to avoid leaking across suites

/**
 * Helper to flush multiple microtasks and promises
 * The timer callback has multiple async operations that need to resolve
 */
async function flushPromises() {
    // Flush multiple microtask cycles to handle nested async operations
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
}

describe('Timer Service', () => {
    let mockRedis;

    beforeEach(() => {
        jest.useFakeTimers();
        mockRedis = getRedis();
        // Reset mocks
        jest.clearAllMocks();
        // Make get return timer data when set
        mockRedis.get.mockImplementation(async (key) => {
            // Return stored data if available
            return mockRedis._storage?.[key] || null;
        });
        mockRedis.set.mockImplementation(async (key, value) => {
            mockRedis._storage = mockRedis._storage || {};
            mockRedis._storage[key] = value;
            return 'OK';
        });
        mockRedis.del.mockImplementation(async (key) => {
            if (mockRedis._storage) {
                delete mockRedis._storage[key];
            }
            return 1;
        });
        // Mock eval for Lua scripts (addTime + timerStatus)
        mockRedis.eval.mockImplementation(async (script, options) => {
            const key = options.keys[0];
            const timerData = mockRedis._storage?.[key];
            if (!timerData) return null;

            try {
                const timer = JSON.parse(timerData);

                // Detect which script is being called by checking the script content.
                // Pause timer script contains 'ALREADY_PAUSED' (2 args: nowMs, pausedTimerTTL).
                // Resume timer script contains 'NOT_PAUSED' (1 arg: nowMs).
                // Timer status script has 1 arg and is neither pause nor resume.
                // AddTime script passes 4 arguments (secondsToAdd, instanceId, now, ttlBuffer).
                const isPauseTimerScript = typeof script === 'string' && script.includes('ALREADY_PAUSED');
                const isResumeTimerScript = typeof script === 'string' && script.includes('NOT_PAUSED');
                // Compare-and-delete expiry script (A11) — also 1-arg, so detect it
                // by content before the timer-status branch claims all 1-arg evals.
                const isExpireTimerScript = typeof script === 'string' && script.includes('SUPERSEDED');
                const isTimerStatusScript =
                    options.arguments.length === 1 &&
                    !isResumeTimerScript &&
                    !isPauseTimerScript &&
                    !isExpireTimerScript;

                if (isExpireTimerScript) {
                    // Simulate ATOMIC_EXPIRE_TIMER_SCRIPT: expire only if the stored
                    // timer still matches the armed endTime and is not paused.
                    if (timer.paused) return 'PAUSED';
                    const expectedEndTime = parseInt(options.arguments[0], 10);
                    if (timer.endTime !== expectedEndTime) return 'SUPERSEDED';
                    delete mockRedis._storage[key];
                    return 'EXPIRED';
                }

                if (isPauseTimerScript) {
                    // Simulate ATOMIC_PAUSE_TIMER_SCRIPT
                    const now = parseInt(options.arguments[0], 10);

                    if (timer.paused) {
                        return JSON.stringify({ error: 'ALREADY_PAUSED' });
                    }

                    const remainingMs = timer.endTime - now;
                    if (remainingMs <= 0) {
                        delete mockRedis._storage[key];
                        return JSON.stringify({ error: 'EXPIRED' });
                    }

                    const remainingSeconds = Math.ceil(remainingMs / 1000);
                    timer.paused = true;
                    timer.remainingWhenPaused = remainingSeconds;
                    timer.pausedAt = now;
                    mockRedis._storage[key] = JSON.stringify(timer);

                    return JSON.stringify({ remainingSeconds });
                }

                if (isResumeTimerScript) {
                    // Simulate ATOMIC_RESUME_TIMER_SCRIPT
                    if (!timer.paused) {
                        return JSON.stringify({ error: 'NOT_PAUSED' });
                    }

                    const remainingSeconds = timer.remainingWhenPaused;
                    if (remainingSeconds === undefined || remainingSeconds <= 0) {
                        return JSON.stringify({ error: 'INVALID_REMAINING' });
                    }

                    if (timer.pausedAt) {
                        const now = parseInt(options.arguments[0], 10);
                        const pausedDurationMs = now - timer.pausedAt;
                        const remainingMs = remainingSeconds * 1000;
                        if (pausedDurationMs >= remainingMs) {
                            delete mockRedis._storage[key];
                            return JSON.stringify({
                                expired: true,
                                pausedFor: pausedDurationMs,
                                hadRemaining: remainingMs,
                            });
                        }
                    }

                    return JSON.stringify({ expired: false, remainingSeconds });
                }

                if (isTimerStatusScript) {
                    // Simulate ATOMIC_TIMER_STATUS_SCRIPT
                    const now = parseInt(options.arguments[0], 10);

                    if (timer.paused && timer.pausedAt !== undefined && timer.remainingWhenPaused !== undefined) {
                        const pausedDuration = now - timer.pausedAt;
                        const remainingMs = timer.remainingWhenPaused * 1000;
                        if (pausedDuration >= remainingMs) {
                            delete mockRedis._storage[key];
                            return 'EXPIRED';
                        }
                        return JSON.stringify({
                            startTime: timer.startTime,
                            endTime: timer.endTime,
                            duration: timer.duration,
                            remainingSeconds: timer.remainingWhenPaused,
                            expired: false,
                            isPaused: true,
                        });
                    }

                    const remainingMs = timer.endTime - now;
                    const expired = remainingMs <= 0;
                    const remainingSeconds = expired ? 0 : Math.ceil(remainingMs / 1000);

                    return JSON.stringify({
                        startTime: timer.startTime,
                        endTime: timer.endTime,
                        duration: timer.duration,
                        remainingSeconds,
                        expired,
                        isPaused: false,
                    });
                }

                // Simulate ATOMIC_ADD_TIME_SCRIPT
                if (timer.paused) return null;

                const now = Date.now();
                const remainingMs = timer.endTime - now;
                if (remainingMs <= 0) return null;

                const secondsToAdd = parseInt(options.arguments[0], 10);
                const newEndTime = timer.endTime + secondsToAdd * 1000;
                const newDuration = Math.ceil((newEndTime - now) / 1000);

                // Update storage
                timer.endTime = newEndTime;
                timer.duration = newDuration;
                mockRedis._storage[key] = JSON.stringify(timer);

                return JSON.stringify({
                    endTime: newEndTime,
                    duration: newDuration,
                    remainingSeconds: newDuration,
                });
            } catch {
                return null;
            }
        });
        mockRedis._storage = {};
    });

    afterEach(async () => {
        // Clean up all timers after each test
        await timerService.cleanupAllTimers();
        jest.clearAllTimers();
        jest.useRealTimers();
        mockRedis._storage = {};
    });

    describe('startTimer', () => {
        test('starts a timer with correct duration', async () => {
            const onExpire = jest.fn();
            const result = await timerService.startTimer('ROOM1', 60, onExpire);

            expect(result.duration).toBe(60);
            expect(result.remainingSeconds).toBe(60);
            expect(result.startTime).toBeDefined();
            expect(result.endTime).toBeDefined();
        });

        test('timer expires after duration', async () => {
            const onExpire = jest.fn();
            await timerService.startTimer('ROOM1', 30, onExpire);

            expect(onExpire).not.toHaveBeenCalled();

            // Fast-forward 30 seconds
            jest.advanceTimersByTime(30000);

            // Need to allow async callbacks to resolve
            await flushPromises();

            expect(onExpire).toHaveBeenCalledWith('ROOM1');
            expect(onExpire).toHaveBeenCalledTimes(1);
        });

        test('replacing timer clears old timer', async () => {
            const onExpire1 = jest.fn();
            const onExpire2 = jest.fn();

            await timerService.startTimer('ROOM1', 60, onExpire1);
            await timerService.startTimer('ROOM1', 30, onExpire2);

            // Fast-forward 60 seconds
            jest.advanceTimersByTime(60000);
            await flushPromises();

            // First callback should not have been called (timer was replaced)
            expect(onExpire1).not.toHaveBeenCalled();
            // Second callback should have been called
            expect(onExpire2).toHaveBeenCalledTimes(1);
        });
    });

    describe('stopTimer', () => {
        test('stops an active timer', async () => {
            const onExpire = jest.fn();
            await timerService.startTimer('ROOM1', 30, onExpire);
            await timerService.stopTimer('ROOM1');

            // Fast-forward past the original duration
            jest.advanceTimersByTime(60000);
            await flushPromises();

            expect(onExpire).not.toHaveBeenCalled();
        });

        test('handles stopping non-existent timer', async () => {
            await expect(timerService.stopTimer('NONEXISTENT')).resolves.not.toThrow();
        });
    });

    describe('getTimerStatus', () => {
        test('returns status for active timer', async () => {
            await timerService.startTimer('ROOM1', 60, jest.fn());

            const status = await timerService.getTimerStatus('ROOM1');

            expect(status).not.toBeNull();
            expect(status.duration).toBe(60);
            expect(status.remainingSeconds).toBe(60);
            expect(status.expired).toBe(false);
        });

        test('returns null for non-existent timer', async () => {
            const status = await timerService.getTimerStatus('NONEXISTENT');
            expect(status).toBeNull();
        });

        test('shows correct remaining time after partial duration', async () => {
            await timerService.startTimer('ROOM1', 60, jest.fn());

            // Fast-forward 20 seconds
            jest.advanceTimersByTime(20000);

            const status = await timerService.getTimerStatus('ROOM1');
            expect(status.remainingSeconds).toBe(40);
        });
    });

    describe('hasActiveTimer', () => {
        test('returns true for active timer', async () => {
            await timerService.startTimer('ROOM1', 60, jest.fn());
            expect(await timerService.hasActiveTimer('ROOM1')).toBe(true);
        });

        test('returns false for non-existent timer', async () => {
            expect(await timerService.hasActiveTimer('NONEXISTENT')).toBe(false);
        });

        test('returns false after timer stops', async () => {
            await timerService.startTimer('ROOM1', 60, jest.fn());
            await timerService.stopTimer('ROOM1');
            expect(await timerService.hasActiveTimer('ROOM1')).toBe(false);
        });
    });

    describe('pauseTimer', () => {
        test('pauses an active timer', async () => {
            const onExpire = jest.fn();
            await timerService.startTimer('ROOM1', 60, onExpire);

            // Fast-forward 20 seconds
            jest.advanceTimersByTime(20000);

            const result = await timerService.pauseTimer('ROOM1');
            // pauseTimer returns object with remainingSeconds
            expect(result).toEqual({ remainingSeconds: 40 });

            // Fast-forward more - should not expire
            jest.advanceTimersByTime(60000);
            await flushPromises();
            expect(onExpire).not.toHaveBeenCalled();
        });

        test('returns null for non-existent timer', async () => {
            const result = await timerService.pauseTimer('NONEXISTENT');
            expect(result).toBeNull();
        });
    });

    describe('resumeTimer', () => {
        test('resumes a paused timer with remaining time', async () => {
            const onExpire = jest.fn();
            await timerService.startTimer('ROOM1', 60, onExpire);

            jest.advanceTimersByTime(20000);
            await timerService.pauseTimer('ROOM1');

            jest.advanceTimersByTime(10000); // While paused

            await timerService.resumeTimer('ROOM1', onExpire);

            // Should now have 40 seconds remaining
            jest.advanceTimersByTime(39000);
            await flushPromises();
            expect(onExpire).not.toHaveBeenCalled();

            jest.advanceTimersByTime(2000);
            await flushPromises();
            expect(onExpire).toHaveBeenCalled();
        });

        test('returns null for non-paused timer', async () => {
            await timerService.startTimer('ROOM1', 60, jest.fn());
            const result = await timerService.resumeTimer('ROOM1', jest.fn());
            expect(result).toBeNull();
        });
    });

    describe('addTime', () => {
        test('adds time to active timer', async () => {
            const onExpire = jest.fn();
            await timerService.startTimer('ROOM1', 30, onExpire);

            jest.advanceTimersByTime(20000); // 10 seconds remaining

            const result = await timerService.addTime('ROOM1', 20, onExpire);
            expect(result.remainingSeconds).toBe(30); // 10 + 20

            // Original timer should be replaced
            jest.advanceTimersByTime(25000);
            await flushPromises();
            expect(onExpire).not.toHaveBeenCalled();

            jest.advanceTimersByTime(10000);
            await flushPromises();
            expect(onExpire).toHaveBeenCalled();
        });

        test('returns null for non-existent timer', async () => {
            const result = await timerService.addTime('NONEXISTENT', 30, jest.fn());
            expect(result).toBeNull();
        });
    });

    // A11: a setTimeout armed for one endTime can fire AFTER the timer it was armed
    // for was extended (addTime) or paused. The compare-and-delete expiry must then
    // be a no-op — it must not delete the extended timer or end the just-extended turn.
    describe('stale expiry guard (A11)', () => {
        test('a stale timeout firing after the timer was extended does not end the turn', async () => {
            const onExpire = jest.fn();
            const { endTime: armedEndTime } = await timerService.startTimer('ROOM1', 30, onExpire);

            // Simulate addTime's Lua landing (endTime pushed out) while the ORIGINAL
            // timeout — armed for the pre-extension endTime — is still pending. We
            // mutate storage directly so the original timeout survives to fire (the
            // real race: the timeout fires before addTime's clearTimeout runs).
            const key = 'timer:ROOM1';
            const stored = JSON.parse(mockRedis._storage[key]);
            stored.endTime = armedEndTime + 30000;
            mockRedis._storage[key] = JSON.stringify(stored);

            jest.advanceTimersByTime(30000);
            await flushPromises();

            // The stale timeout must NOT end the turn, and the extended timer survives.
            expect(onExpire).not.toHaveBeenCalled();
            expect(mockRedis._storage[key]).toBeDefined();
            expect(JSON.parse(mockRedis._storage[key]).endTime).toBe(armedEndTime + 30000);
        });

        test('a stale timeout firing after the timer was paused does not end the turn', async () => {
            const onExpire = jest.fn();
            await timerService.startTimer('ROOM1', 30, onExpire);

            // Simulate pause landing (paused flag set) while the original timeout is
            // still pending — resume, not this stale timeout, owns a paused timer.
            const key = 'timer:ROOM1';
            const stored = JSON.parse(mockRedis._storage[key]);
            stored.paused = true;
            stored.remainingWhenPaused = 5;
            stored.pausedAt = Date.now();
            mockRedis._storage[key] = JSON.stringify(stored);

            jest.advanceTimersByTime(30000);
            await flushPromises();

            expect(onExpire).not.toHaveBeenCalled();
            expect(mockRedis._storage[key]).toBeDefined();
        });
    });

    describe('cleanupAllTimers', () => {
        test('clears all active timers', async () => {
            const onExpire1 = jest.fn();
            const onExpire2 = jest.fn();

            await timerService.startTimer('ROOM1', 60, onExpire1);
            await timerService.startTimer('ROOM2', 30, onExpire2);

            await timerService.cleanupAllTimers();

            jest.advanceTimersByTime(120000);
            await flushPromises();

            expect(onExpire1).not.toHaveBeenCalled();
            expect(onExpire2).not.toHaveBeenCalled();

            expect(await timerService.hasActiveTimer('ROOM1')).toBe(false);
            expect(await timerService.hasActiveTimer('ROOM2')).toBe(false);
        });
    });

    describe('multiple rooms', () => {
        test('handles multiple room timers independently', async () => {
            const onExpire1 = jest.fn();
            const onExpire2 = jest.fn();
            const onExpire3 = jest.fn();

            await timerService.startTimer('ROOM1', 60, onExpire1);
            await timerService.startTimer('ROOM2', 30, onExpire2);
            await timerService.startTimer('ROOM3', 90, onExpire3);

            jest.advanceTimersByTime(30000);
            await flushPromises();
            expect(onExpire2).toHaveBeenCalledWith('ROOM2');
            expect(onExpire1).not.toHaveBeenCalled();
            expect(onExpire3).not.toHaveBeenCalled();

            jest.advanceTimersByTime(30000);
            await flushPromises();
            expect(onExpire1).toHaveBeenCalledWith('ROOM1');
            expect(onExpire3).not.toHaveBeenCalled();

            jest.advanceTimersByTime(30000);
            await flushPromises();
            expect(onExpire3).toHaveBeenCalledWith('ROOM3');
        });
    });
});
