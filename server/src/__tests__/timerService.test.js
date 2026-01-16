/**
 * Unit Tests for Timer Service
 */

const timerService = require('../services/timerService');

// Use fake timers
jest.useFakeTimers();

describe('Timer Service', () => {
    afterEach(() => {
        // Clean up all timers after each test
        timerService.cleanupAllTimers();
        jest.clearAllTimers();
    });

    describe('startTimer', () => {
        test('starts a timer with correct duration', () => {
            const onExpire = jest.fn();
            const result = timerService.startTimer('ROOM1', 60, onExpire);

            expect(result.duration).toBe(60);
            expect(result.remainingSeconds).toBe(60);
            expect(result.startTime).toBeDefined();
            expect(result.endTime).toBeDefined();
        });

        test('timer expires after duration', () => {
            const onExpire = jest.fn();
            timerService.startTimer('ROOM1', 30, onExpire);

            expect(onExpire).not.toHaveBeenCalled();

            // Fast-forward 30 seconds
            jest.advanceTimersByTime(30000);

            expect(onExpire).toHaveBeenCalledWith('ROOM1');
            expect(onExpire).toHaveBeenCalledTimes(1);
        });

        test('replacing timer clears old timer', () => {
            const onExpire1 = jest.fn();
            const onExpire2 = jest.fn();

            timerService.startTimer('ROOM1', 60, onExpire1);
            timerService.startTimer('ROOM1', 30, onExpire2);

            // Fast-forward 60 seconds
            jest.advanceTimersByTime(60000);

            // First callback should not have been called (timer was replaced)
            expect(onExpire1).not.toHaveBeenCalled();
            // Second callback should have been called
            expect(onExpire2).toHaveBeenCalledTimes(1);
        });
    });

    describe('stopTimer', () => {
        test('stops an active timer', () => {
            const onExpire = jest.fn();
            timerService.startTimer('ROOM1', 30, onExpire);
            timerService.stopTimer('ROOM1');

            // Fast-forward past the original duration
            jest.advanceTimersByTime(60000);

            expect(onExpire).not.toHaveBeenCalled();
        });

        test('handles stopping non-existent timer', () => {
            expect(() => {
                timerService.stopTimer('NONEXISTENT');
            }).not.toThrow();
        });
    });

    describe('getTimerStatus', () => {
        test('returns status for active timer', () => {
            timerService.startTimer('ROOM1', 60, jest.fn());

            const status = timerService.getTimerStatus('ROOM1');

            expect(status).not.toBeNull();
            expect(status.duration).toBe(60);
            expect(status.remainingSeconds).toBe(60);
            expect(status.expired).toBe(false);
        });

        test('returns null for non-existent timer', () => {
            const status = timerService.getTimerStatus('NONEXISTENT');
            expect(status).toBeNull();
        });

        test('shows correct remaining time after partial duration', () => {
            timerService.startTimer('ROOM1', 60, jest.fn());

            // Fast-forward 20 seconds
            jest.advanceTimersByTime(20000);

            const status = timerService.getTimerStatus('ROOM1');
            expect(status.remainingSeconds).toBe(40);
        });

        test('shows expired after timer completes', () => {
            timerService.startTimer('ROOM1', 10, jest.fn());

            // Fast-forward past duration
            jest.advanceTimersByTime(15000);

            // Timer should have been removed from active timers
            const status = timerService.getTimerStatus('ROOM1');
            expect(status).toBeNull();
        });
    });

    describe('hasActiveTimer', () => {
        test('returns true for active timer', () => {
            timerService.startTimer('ROOM1', 60, jest.fn());
            expect(timerService.hasActiveTimer('ROOM1')).toBe(true);
        });

        test('returns false for non-existent timer', () => {
            expect(timerService.hasActiveTimer('NONEXISTENT')).toBe(false);
        });

        test('returns false after timer stops', () => {
            timerService.startTimer('ROOM1', 60, jest.fn());
            timerService.stopTimer('ROOM1');
            expect(timerService.hasActiveTimer('ROOM1')).toBe(false);
        });
    });

    describe('pauseTimer', () => {
        test('pauses an active timer', () => {
            const onExpire = jest.fn();
            timerService.startTimer('ROOM1', 60, onExpire);

            // Fast-forward 20 seconds
            jest.advanceTimersByTime(20000);

            const remaining = timerService.pauseTimer('ROOM1');
            expect(remaining).toBe(40);

            // Fast-forward more - should not expire
            jest.advanceTimersByTime(60000);
            expect(onExpire).not.toHaveBeenCalled();
        });

        test('returns null for non-existent timer', () => {
            const result = timerService.pauseTimer('NONEXISTENT');
            expect(result).toBeNull();
        });
    });

    describe('resumeTimer', () => {
        test('resumes a paused timer with remaining time', () => {
            const onExpire = jest.fn();
            timerService.startTimer('ROOM1', 60, onExpire);

            jest.advanceTimersByTime(20000);
            timerService.pauseTimer('ROOM1');

            jest.advanceTimersByTime(10000); // While paused

            timerService.resumeTimer('ROOM1', onExpire);

            // Should now have 40 seconds remaining
            jest.advanceTimersByTime(39000);
            expect(onExpire).not.toHaveBeenCalled();

            jest.advanceTimersByTime(2000);
            expect(onExpire).toHaveBeenCalled();
        });

        test('returns null for non-paused timer', () => {
            timerService.startTimer('ROOM1', 60, jest.fn());
            const result = timerService.resumeTimer('ROOM1', jest.fn());
            expect(result).toBeNull();
        });
    });

    describe('addTime', () => {
        test('adds time to active timer', () => {
            const onExpire = jest.fn();
            timerService.startTimer('ROOM1', 30, onExpire);

            jest.advanceTimersByTime(20000); // 10 seconds remaining

            const result = timerService.addTime('ROOM1', 20, onExpire);
            expect(result.remainingSeconds).toBe(30); // 10 + 20

            // Original timer should be replaced
            jest.advanceTimersByTime(25000);
            expect(onExpire).not.toHaveBeenCalled();

            jest.advanceTimersByTime(10000);
            expect(onExpire).toHaveBeenCalled();
        });

        test('returns null for non-existent timer', () => {
            const result = timerService.addTime('NONEXISTENT', 30, jest.fn());
            expect(result).toBeNull();
        });
    });

    describe('cleanupAllTimers', () => {
        test('clears all active timers', () => {
            const onExpire1 = jest.fn();
            const onExpire2 = jest.fn();

            timerService.startTimer('ROOM1', 60, onExpire1);
            timerService.startTimer('ROOM2', 30, onExpire2);

            timerService.cleanupAllTimers();

            jest.advanceTimersByTime(120000);

            expect(onExpire1).not.toHaveBeenCalled();
            expect(onExpire2).not.toHaveBeenCalled();

            expect(timerService.hasActiveTimer('ROOM1')).toBe(false);
            expect(timerService.hasActiveTimer('ROOM2')).toBe(false);
        });
    });

    describe('multiple rooms', () => {
        test('handles multiple room timers independently', () => {
            const onExpire1 = jest.fn();
            const onExpire2 = jest.fn();
            const onExpire3 = jest.fn();

            timerService.startTimer('ROOM1', 60, onExpire1);
            timerService.startTimer('ROOM2', 30, onExpire2);
            timerService.startTimer('ROOM3', 90, onExpire3);

            jest.advanceTimersByTime(30000);
            expect(onExpire2).toHaveBeenCalledWith('ROOM2');
            expect(onExpire1).not.toHaveBeenCalled();
            expect(onExpire3).not.toHaveBeenCalled();

            jest.advanceTimersByTime(30000);
            expect(onExpire1).toHaveBeenCalledWith('ROOM1');
            expect(onExpire3).not.toHaveBeenCalled();

            jest.advanceTimersByTime(30000);
            expect(onExpire3).toHaveBeenCalledWith('ROOM3');
        });
    });
});
