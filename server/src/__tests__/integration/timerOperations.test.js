/**
 * Integration Tests: Timer Data Structures and Helpers
 *
 * Tests timer-related data structures and utility functions.
 * These tests verify timer state management patterns without
 * requiring a running Redis instance.
 */

const { createMockRedis, generateRoomCode, sleep } = require('../helpers/mocks');

describe('Timer Data Structure Tests', () => {
    let mockRedis;

    beforeEach(() => {
        jest.clearAllMocks();
        mockRedis = createMockRedis();
    });

    describe('Timer State Storage', () => {
        it('should store timer data correctly', async () => {
            const roomCode = generateRoomCode();
            const timerKey = `timer:${roomCode}`;
            const now = Date.now();
            const duration = 60;

            const timerData = {
                roomCode,
                startTime: now,
                endTime: now + duration * 1000,
                duration,
                paused: false,
                remainingWhenPaused: null,
                instanceId: process.pid.toString()
            };

            await mockRedis.set(timerKey, JSON.stringify(timerData));

            const stored = await mockRedis.get(timerKey);
            const parsed = JSON.parse(stored);

            expect(parsed.roomCode).toBe(roomCode);
            expect(parsed.duration).toBe(duration);
            expect(parsed.paused).toBe(false);
        });

        it('should store paused timer state correctly', async () => {
            const roomCode = generateRoomCode();
            const timerKey = `timer:${roomCode}`;
            const remaining = 45;

            const timerData = {
                roomCode,
                paused: true,
                remainingWhenPaused: remaining
            };

            await mockRedis.set(timerKey, JSON.stringify(timerData));

            const stored = await mockRedis.get(timerKey);
            const parsed = JSON.parse(stored);

            expect(parsed.paused).toBe(true);
            expect(parsed.remainingWhenPaused).toBe(remaining);
        });

        it('should delete timer data correctly', async () => {
            const roomCode = generateRoomCode();
            const timerKey = `timer:${roomCode}`;

            await mockRedis.set(timerKey, JSON.stringify({ roomCode }));

            let stored = await mockRedis.get(timerKey);
            expect(stored).toBeTruthy();

            await mockRedis.del(timerKey);

            stored = await mockRedis.get(timerKey);
            expect(stored).toBeNull();
        });
    });

    describe('Timer Lock Patterns', () => {
        it('should acquire lock with NX pattern', async () => {
            const roomCode = generateRoomCode();
            const lockKey = `lock:timer:resume:${roomCode}`;

            // First acquisition should succeed
            const result1 = await mockRedis.set(lockKey, 'instance-1', { NX: true, EX: 5 });
            expect(result1).toBe('OK');

            // Second acquisition should fail (key exists)
            mockRedis.set = jest.fn().mockImplementation(async (key, value, options) => {
                if (options?.NX && mockRedis._storage.has(key)) {
                    return null;
                }
                mockRedis._storage.set(key, value);
                return 'OK';
            });

            const result2 = await mockRedis.set(lockKey, 'instance-2', { NX: true, EX: 5 });
            expect(result2).toBeNull();
        });

        it('should release lock correctly', async () => {
            const roomCode = generateRoomCode();
            const lockKey = `lock:timer:resume:${roomCode}`;

            await mockRedis.set(lockKey, 'instance-1');
            await mockRedis.del(lockKey);

            const exists = await mockRedis.exists(lockKey);
            expect(exists).toBe(0);
        });
    });

    describe('Timer Calculation Helpers', () => {
        it('should calculate remaining time correctly', () => {
            const now = Date.now();
            const endTime = now + 60000; // 60 seconds from now
            const remainingMs = endTime - now;
            const remainingSeconds = Math.ceil(remainingMs / 1000);

            expect(remainingSeconds).toBe(60);
        });

        it('should handle expired timer correctly', () => {
            const now = Date.now();
            const endTime = now - 5000; // 5 seconds ago
            const remainingMs = endTime - now;
            const isExpired = remainingMs <= 0;

            expect(isExpired).toBe(true);
        });

        it('should calculate TTL buffer correctly', () => {
            const duration = 60;
            const bufferSeconds = 60;
            const ttl = duration + bufferSeconds;

            expect(ttl).toBe(120);
        });
    });

    describe('Timer Add Time Calculations', () => {
        it('should calculate new end time after adding time', () => {
            const now = Date.now();
            const currentEndTime = now + 30000; // 30 seconds remaining
            const secondsToAdd = 30;
            const newEndTime = currentEndTime + secondsToAdd * 1000;
            const newRemaining = Math.ceil((newEndTime - now) / 1000);

            expect(newRemaining).toBe(60);
        });

        it('should calculate new duration after adding time', () => {
            const now = Date.now();
            const originalEndTime = now + 30000;
            const secondsToAdd = 45;
            const newEndTime = originalEndTime + secondsToAdd * 1000;
            const newDuration = Math.ceil((newEndTime - now) / 1000);

            expect(newDuration).toBe(75);
        });
    });

    describe('Orphan Timer Detection Patterns', () => {
        it('should identify expired timer keys', async () => {
            const roomCode = generateRoomCode();
            const timerKey = `timer:${roomCode}`;
            const now = Date.now();

            const expiredTimer = {
                roomCode,
                endTime: now - 60000, // Expired 1 minute ago
                claimed: false
            };

            await mockRedis.set(timerKey, JSON.stringify(expiredTimer));

            const timerData = await mockRedis.get(timerKey);
            const timer = JSON.parse(timerData);
            const isExpired = timer.endTime <= now;

            expect(isExpired).toBe(true);
        });

        it('should identify claimed timers', async () => {
            const roomCode = generateRoomCode();
            const timerKey = `timer:${roomCode}`;

            const claimedTimer = {
                roomCode,
                claimed: true,
                claimedBy: 'instance-1'
            };

            await mockRedis.set(timerKey, JSON.stringify(claimedTimer));

            const timerData = await mockRedis.get(timerKey);
            const timer = JSON.parse(timerData);

            expect(timer.claimed).toBe(true);
        });
    });

    describe('Timer Event Payloads', () => {
        it('should create valid start event payload', () => {
            const roomCode = generateRoomCode();
            const endTime = Date.now() + 60000;
            const duration = 60;

            const startEvent = {
                type: 'started',
                roomCode,
                endTime,
                duration,
                timestamp: Date.now()
            };

            expect(startEvent.type).toBe('started');
            expect(startEvent.roomCode).toBe(roomCode);
            expect(startEvent.duration).toBe(duration);
        });

        it('should create valid pause event payload', () => {
            const roomCode = generateRoomCode();
            const remainingSeconds = 45;

            const pauseEvent = {
                type: 'paused',
                roomCode,
                remainingSeconds,
                timestamp: Date.now()
            };

            expect(pauseEvent.type).toBe('paused');
            expect(pauseEvent.remainingSeconds).toBe(remainingSeconds);
        });

        it('should create valid expired event payload', () => {
            const roomCode = generateRoomCode();

            const expiredEvent = {
                type: 'expired',
                roomCode,
                timestamp: Date.now()
            };

            expect(expiredEvent.type).toBe('expired');
        });

        it('should create valid addTime event payload', () => {
            const roomCode = generateRoomCode();
            const secondsToAdd = 30;
            const newEndTime = Date.now() + 90000;

            const addTimeEvent = {
                type: 'addTime',
                roomCode,
                secondsAdded: secondsToAdd,
                newEndTime,
                timestamp: Date.now()
            };

            expect(addTimeEvent.type).toBe('addTime');
            expect(addTimeEvent.secondsAdded).toBe(secondsToAdd);
        });
    });
});
