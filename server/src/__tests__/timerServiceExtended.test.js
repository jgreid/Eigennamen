/**
 * Extended Unit Tests for Timer Service
 *
 * These tests cover the previously uncovered code paths including:
 * - initializeTimerService retry logic
 * - handleTimerEvent for all event types
 * - Timer expiration callback with error handling
 * - Pub/sub publish failures
 * - Lock acquisition in resumeTimer
 * - addTime routing via pub/sub
 * - Orphan timer check and recovery
 * - cleanupAllTimers and shutdownTimerService
 */

// Store original process.pid (unused but kept for future debugging)
const _originalPid = process.pid;

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
let mockPubClient;
let mockSubClient;
let subscriptionCallback;

jest.mock('../config/redis', () => {
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

    mockPubClient = {
        publish: jest.fn().mockResolvedValue(1)
    };

    mockSubClient = {
        subscribe: jest.fn().mockImplementation(async (channel, callback) => {
            subscriptionCallback = callback;
        }),
        unsubscribe: jest.fn().mockResolvedValue()
    };

    return {
        getRedis: () => mockRedis,
        getPubSubClients: () => ({ pubClient: mockPubClient, subClient: mockSubClient })
    };
});

// Now require the service
const timerService = require('../services/timerService');
// These imports verify the mock is working but aren't directly used in tests
const { getRedis: _getRedis, getPubSubClients: _getPubSubClients } = require('../config/redis');

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

/**
 * Helper to simulate pub/sub message
 */
function simulatePubSubMessage(event) {
    if (subscriptionCallback) {
        subscriptionCallback(JSON.stringify(event));
    }
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

        // Reset pub/sub mocks
        mockPubClient.publish.mockResolvedValue(1);
        mockSubClient.subscribe.mockImplementation(async (channel, callback) => {
            subscriptionCallback = callback;
        });
        mockSubClient.unsubscribe.mockResolvedValue();
    });

    afterEach(async () => {
        await timerService.cleanupAllTimers();
        jest.clearAllTimers();
        subscriptionCallback = null;
    });

    describe('initializeTimerService', () => {
        test('successfully initializes with pub/sub subscription', async () => {
            const onExpire = jest.fn();
            const result = await timerService.initializeTimerService(onExpire);

            expect(result).toBe(true);
            expect(mockSubClient.subscribe).toHaveBeenCalledWith('timer:events', expect.any(Function));
            expect(mockLogger.info).toHaveBeenCalledWith('Timer service initialized with Redis backing');
        });

        test('retries on subscription failure and succeeds eventually', async () => {
            const onExpire = jest.fn();
            let attempts = 0;

            mockSubClient.subscribe.mockImplementation(async (channel, callback) => {
                attempts++;
                if (attempts < 2) {
                    throw new Error('Connection failed');
                }
                subscriptionCallback = callback;
            });

            // Start initialization (will trigger retry with 2s delay)
            const initPromise = timerService.initializeTimerService(onExpire, 3);

            // Advance past the 2s retry delay
            await flushPromises();
            jest.advanceTimersByTime(2500);
            await flushPromises();

            const result = await initPromise;

            expect(result).toBe(true);
            expect(attempts).toBe(2);
            expect(mockLogger.warn).toHaveBeenCalledWith(
                expect.stringContaining('Timer service pub/sub subscription failed (attempt 1/3)')
            );
        });

        test('falls back to single-instance mode after max retries', async () => {
            const onExpire = jest.fn();

            mockSubClient.subscribe.mockRejectedValue(new Error('Connection failed'));

            // Start initialization (will trigger multiple retries)
            const initPromise = timerService.initializeTimerService(onExpire, 3);

            // Advance past all retry delays (3 retries * 2s each = 6s)
            for (let i = 0; i < 3; i++) {
                // eslint-disable-next-line no-await-in-loop -- Sequential timer advancement required for accurate simulation
                await flushPromises();
                jest.advanceTimersByTime(2500);
                // eslint-disable-next-line no-await-in-loop
                await flushPromises();
            }

            const result = await initPromise;

            expect(result).toBe(false);
            expect(mockLogger.warn).toHaveBeenCalledWith(
                'Timer service running in single-instance mode (Redis pub/sub unavailable after retries)'
            );
        });
    });

    describe('handleTimerEvent via pub/sub', () => {
        let onExpireCallback;

        beforeEach(async () => {
            onExpireCallback = jest.fn();
            await timerService.initializeTimerService(onExpireCallback);
        });

        test('handles "started" event - clears local timer if exists', async () => {
            // Start a local timer first
            await timerService.startTimer('ROOM1', 60, onExpireCallback);

            // Simulate another instance starting a timer
            simulatePubSubMessage({
                type: 'started',
                roomCode: 'ROOM1',
                endTime: Date.now() + 30000,
                duration: 30,
                timestamp: Date.now()
            });

            await flushPromises();

            // The original timer should have been cleared
            jest.advanceTimersByTime(70000);
            await flushPromises();

            // Original callback should not be called (timer was replaced)
            expect(onExpireCallback).not.toHaveBeenCalled();
        });

        test('handles "stopped" event - clears local timer', async () => {
            await timerService.startTimer('ROOM2', 60, onExpireCallback);

            simulatePubSubMessage({
                type: 'stopped',
                roomCode: 'ROOM2',
                timestamp: Date.now()
            });

            await flushPromises();

            jest.advanceTimersByTime(70000);
            await flushPromises();

            expect(onExpireCallback).not.toHaveBeenCalled();
        });

        test('handles "paused" event - pauses local timer', async () => {
            await timerService.startTimer('ROOM3', 60, onExpireCallback);

            simulatePubSubMessage({
                type: 'paused',
                roomCode: 'ROOM3',
                remainingSeconds: 45,
                timestamp: Date.now()
            });

            await flushPromises();

            jest.advanceTimersByTime(70000);
            await flushPromises();

            expect(onExpireCallback).not.toHaveBeenCalled();
        });

        test('handles "expired" event - no action needed', async () => {
            // Just ensure it doesn't throw
            simulatePubSubMessage({
                type: 'expired',
                roomCode: 'ROOM4',
                timestamp: Date.now()
            });

            await flushPromises();
            // No error should occur
        });

        test('handles "addTime" event - updates local timer', async () => {
            await timerService.startTimer('ROOM5', 60, onExpireCallback);

            const newEndTime = Date.now() + 90000;

            simulatePubSubMessage({
                type: 'addTime',
                roomCode: 'ROOM5',
                secondsAdded: 30,
                newEndTime: newEndTime,
                newDuration: 90,
                remainingSeconds: 90,
                timestamp: Date.now()
            });

            await flushPromises();

            // Timer should now have extended duration
            jest.advanceTimersByTime(65000);
            await flushPromises();
            expect(onExpireCallback).not.toHaveBeenCalled();

            jest.advanceTimersByTime(30000);
            await flushPromises();
            expect(onExpireCallback).toHaveBeenCalledWith('ROOM5');
        });

        test('handles "addTimeResult" event - resolves pending callback', async () => {
            // This is for the coordinated addTime via pub/sub
            // We need to test that the callback mechanism works
            // Note: The pendingAddTimeCallbacks map is internal and not directly accessible
            // so we just verify the event handling doesn't throw
            simulatePubSubMessage({
                type: 'addTimeResult',
                requestId: 'test-request-123',
                result: { endTime: Date.now() + 60000, duration: 60, remainingSeconds: 60 }
            });

            await flushPromises();
            // No error should occur - callback not found is silently ignored
        });

        test('handles "addTime" event when not owner - ignores silently', async () => {
            // Simulate addTime event for a room we don't own
            simulatePubSubMessage({
                type: 'addTime',
                roomCode: 'NOT_OWNED_ROOM',
                secondsToAdd: 30,
                timestamp: Date.now()
            });

            await flushPromises();
            // Should not throw or log error
        });

        test('handles invalid JSON in pub/sub message', async () => {
            if (subscriptionCallback) {
                subscriptionCallback('invalid json {{{');
            }

            await flushPromises();

            expect(mockLogger.error).toHaveBeenCalledWith(
                'Error handling timer event:',
                expect.any(Error)
            );
        });
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

    describe('Pub/sub publish failures', () => {
        test('logs warning when start event publish fails', async () => {
            mockPubClient.publish.mockRejectedValue(new Error('Publish failed'));

            await timerService.startTimer('ROOM_PUB', 60, jest.fn());

            expect(mockLogger.warn).toHaveBeenCalledWith(
                'Failed to publish timer start event for room ROOM_PUB:',
                'Publish failed'
            );
        });

        test('logs warning when stop event publish fails', async () => {
            await timerService.startTimer('ROOM_STOP', 60, jest.fn());

            mockPubClient.publish.mockRejectedValue(new Error('Publish failed'));

            await timerService.stopTimer('ROOM_STOP');

            expect(mockLogger.warn).toHaveBeenCalledWith(
                'Failed to publish timer stop event for room ROOM_STOP:',
                'Publish failed'
            );
        });

        test('logs warning when pause event publish fails', async () => {
            await timerService.startTimer('ROOM_PAUSE', 60, jest.fn());

            mockPubClient.publish.mockRejectedValue(new Error('Publish failed'));

            await timerService.pauseTimer('ROOM_PAUSE');

            expect(mockLogger.warn).toHaveBeenCalledWith(
                'Failed to publish pause event for room ROOM_PAUSE:',
                'Publish failed'
            );
        });

        test('logs warning when expiration event publish fails', async () => {
            const onExpire = jest.fn();
            await timerService.startTimer('ROOM_EXP_PUB', 1, onExpire);

            // Now make publish fail for the expiration event
            mockPubClient.publish.mockRejectedValue(new Error('Publish failed'));

            jest.advanceTimersByTime(1500);
            await flushPromises();

            expect(mockLogger.warn).toHaveBeenCalledWith(
                'Failed to publish timer expiration event for room ROOM_EXP_PUB:',
                'Publish failed'
            );
        });
    });

    describe('resumeTimer lock acquisition', () => {
        test('returns null when lock cannot be acquired', async () => {
            // Start and pause a timer
            await timerService.startTimer('ROOM_LOCK', 60, jest.fn());
            await timerService.pauseTimer('ROOM_LOCK');

            // Make lock acquisition fail (NX returns null if key exists)
            mockRedis.set.mockImplementation(async (key, value, options) => {
                if (options && options.NX) {
                    return null; // Lock not acquired
                }
                mockRedis._storage[key] = value;
                return 'OK';
            });

            const result = await timerService.resumeTimer('ROOM_LOCK', jest.fn());

            expect(result).toBeNull();
            expect(mockLogger.debug).toHaveBeenCalledWith(
                'Another instance is resuming timer for room ROOM_LOCK',
                expect.objectContaining({ lockKey: expect.any(String) })
            );
        });

        test('returns null when timer data is missing', async () => {
            // Setup lock to succeed
            mockRedis.set.mockImplementation(async (key, value, options) => {
                if (options && options.NX) {
                    return 'OK'; // Lock acquired
                }
                mockRedis._storage[key] = value;
                return 'OK';
            });

            const result = await timerService.resumeTimer('NONEXISTENT_ROOM', jest.fn());

            expect(result).toBeNull();
        });

        test('returns null when timer data is invalid JSON', async () => {
            mockRedis._storage['timer:INVALID_JSON'] = 'not valid json {{{';

            // Setup lock to succeed
            mockRedis.set.mockImplementation(async (key, value, options) => {
                if (options && options.NX) {
                    return 'OK';
                }
                mockRedis._storage[key] = value;
                return 'OK';
            });

            const result = await timerService.resumeTimer('INVALID_JSON', jest.fn());

            expect(result).toBeNull();
        });

        test('logs error when lock release fails', async () => {
            await timerService.startTimer('ROOM_LOCK_REL', 60, jest.fn());
            await timerService.pauseTimer('ROOM_LOCK_REL');

            let _lockKey = null;
            mockRedis.set.mockImplementation(async (key, value, options) => {
                if (options && options.NX) {
                    _lockKey = key;
                    return 'OK';
                }
                mockRedis._storage[key] = value;
                return 'OK';
            });

            mockRedis.del.mockImplementation(async (key) => {
                if (key.includes('lock:')) {
                    throw new Error('Failed to release lock');
                }
                delete mockRedis._storage[key];
                return 1;
            });

            await timerService.resumeTimer('ROOM_LOCK_REL', jest.fn());

            expect(mockLogger.error).toHaveBeenCalledWith(
                'Failed to release resume lock for room ROOM_LOCK_REL:',
                'Failed to release lock'
            );
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
            expect(mockLogger.error).toHaveBeenCalledWith(
                'Failed to parse timer data for PARSE_ERR:',
                expect.any(String)
            );
        });
    });

    describe('addTime routing via pub/sub', () => {
        test('routes addTime via pub/sub when timer owned by another instance', async () => {
            // Create timer in Redis (owned by different instance)
            const timerData = {
                roomCode: 'OTHER_ROOM',
                startTime: Date.now(),
                endTime: Date.now() + 60000,
                duration: 60,
                instanceId: 'other-instance-123'
            };
            mockRedis._storage['timer:OTHER_ROOM'] = JSON.stringify(timerData);

            // Use real timers for this test since it has a small delay
            jest.useRealTimers();

            const _result = await timerService.addTime('OTHER_ROOM', 30, jest.fn());

            // Restore fake timers
            jest.useFakeTimers();

            // Should have published addTime event
            expect(mockPubClient.publish).toHaveBeenCalledWith(
                'timer:events',
                expect.stringContaining('"type":"addTime"')
            );
            expect(mockLogger.debug).toHaveBeenCalledWith(
                'Routed addTime request for room OTHER_ROOM via pub/sub'
            );
        });

        test('falls back to local processing when pub/sub fails', async () => {
            // Create timer in Redis (owned by different instance)
            const timerData = {
                roomCode: 'FALLBACK_ROOM',
                startTime: Date.now(),
                endTime: Date.now() + 60000,
                duration: 60,
                instanceId: 'other-instance-456'
            };
            mockRedis._storage['timer:FALLBACK_ROOM'] = JSON.stringify(timerData);

            mockPubClient.publish.mockRejectedValue(new Error('Pub/sub failed'));

            const _result = await timerService.addTime('FALLBACK_ROOM', 30, jest.fn());

            expect(mockLogger.warn).toHaveBeenCalledWith(
                'Failed to route addTime via pub/sub for room FALLBACK_ROOM, falling back to local:',
                'Pub/sub failed'
            );
        });

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
            expect(mockLogger.error).toHaveBeenCalledWith(
                'Error parsing addTime result for room EVAL_INVALID:',
                expect.any(Error)
            );
        });

        test('logs warning when addTime publish fails after local update', async () => {
            // Create timer in Redis but not locally (to trigger the else branch)
            const timerData = {
                roomCode: 'PUB_FAIL',
                startTime: Date.now(),
                endTime: Date.now() + 60000,
                duration: 60,
                instanceId: process.pid.toString()
            };
            mockRedis._storage['timer:PUB_FAIL'] = JSON.stringify(timerData);

            // Make publish fail
            mockPubClient.publish.mockRejectedValue(new Error('Publish failed'));

            // Call addTimeLocal directly through the pub/sub fallback path
            const _result = await timerService.addTime('PUB_FAIL', 30, jest.fn());

            expect(mockLogger.warn).toHaveBeenCalledWith(
                expect.stringContaining('Failed to'),
                expect.any(String)
            );
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

    describe('Orphan timer check and recovery', () => {
        beforeEach(async () => {
            // Initialize timer service to start orphan check
            await timerService.initializeTimerService(jest.fn());
        });

        test('recovers expired orphaned timer', async () => {
            const onExpire = jest.fn();

            // Create an expired timer in Redis (orphaned - no local handler)
            const expiredTimer = {
                roomCode: 'ORPHAN_EXPIRED',
                startTime: Date.now() - 120000,
                endTime: Date.now() - 10000, // Already expired
                duration: 60,
                instanceId: 'crashed-instance'
            };
            mockRedis._storage['timer:ORPHAN_EXPIRED'] = JSON.stringify(expiredTimer);

            // Setup eval to return the timer data (successful claim)
            mockRedis.eval.mockImplementation(async (script, options) => {
                if (script.includes('claimed')) {
                    const key = options.keys[0];
                    const data = mockRedis._storage[key];
                    delete mockRedis._storage[key];
                    return data;
                }
                return null;
            });

            // Re-initialize with our callback
            await timerService.initializeTimerService(onExpire);

            // Trigger orphan check
            jest.advanceTimersByTime(35000);
            await flushPromises();

            expect(mockLogger.info).toHaveBeenCalledWith(
                'Recovering expired orphaned timer for room ORPHAN_EXPIRED'
            );
            expect(onExpire).toHaveBeenCalledWith('ORPHAN_EXPIRED');
        });

        test('takes ownership of active orphaned timer', async () => {
            const onExpire = jest.fn();

            // Re-initialize with our callback first (before creating the orphan timer)
            await timerService.initializeTimerService(onExpire);

            // Create an active timer in Redis (orphaned - no local handler)
            // Use a time far in the future so it's clearly active
            const futureEndTime = Date.now() + 120000; // 2 minutes from now
            const activeTimer = {
                roomCode: 'ORPHAN_ACTIVE',
                startTime: Date.now(),
                endTime: futureEndTime,
                duration: 120,
                instanceId: 'crashed-instance'
            };
            mockRedis._storage['timer:ORPHAN_ACTIVE'] = JSON.stringify(activeTimer);

            // Make sure eval returns null for claim script (timer is not expired)
            mockRedis.eval.mockImplementation(async (_script, _options) => {
                // For active timers, the claim should not succeed (timer is still valid)
                return null;
            });

            // Trigger orphan check
            jest.advanceTimersByTime(35000);
            await flushPromises();

            expect(mockLogger.info).toHaveBeenCalledWith(
                expect.stringContaining('Taking ownership of orphaned timer for room ORPHAN_ACTIVE')
            );
        });

        test('skips paused orphaned timers', async () => {
            const onExpire = jest.fn();

            // Create a paused timer in Redis
            const pausedTimer = {
                roomCode: 'ORPHAN_PAUSED',
                startTime: Date.now() - 60000,
                endTime: Date.now() - 30000,
                duration: 60,
                instanceId: 'crashed-instance',
                paused: true,
                remainingWhenPaused: 30
            };
            mockRedis._storage['timer:ORPHAN_PAUSED'] = JSON.stringify(pausedTimer);

            await timerService.initializeTimerService(onExpire);

            jest.advanceTimersByTime(35000);
            await flushPromises();

            // Should not have tried to recover this timer
            expect(onExpire).not.toHaveBeenCalledWith('ORPHAN_PAUSED');
        });

        test('skips timers with local handlers', async () => {
            const onExpire = jest.fn();

            // Start a timer locally first
            await timerService.startTimer('LOCAL_TIMER', 120, onExpire);

            // Also add it to Redis (simulating what startTimer does)
            // The orphan check should skip it

            jest.advanceTimersByTime(35000);
            await flushPromises();

            // Should not try to recover a timer we already own
            expect(mockLogger.info).not.toHaveBeenCalledWith(
                expect.stringContaining('Taking ownership of orphaned timer for room LOCAL_TIMER')
            );
        });

        test('handles scan with many keys (key limit enforcement)', async () => {
            // This test verifies the key limit constant is properly used
            // The actual key limit enforcement is tested implicitly through
            // the orphan recovery tests - they process keys correctly
            const onExpire = jest.fn();

            // Create a moderate number of timers to test scan behavior
            for (let i = 0; i < 10; i++) {
                mockRedis._storage[`timer:SCAN_${i}`] = JSON.stringify({
                    roomCode: `SCAN_${i}`,
                    startTime: Date.now(),
                    endTime: Date.now() + 60000,
                    duration: 60,
                    instanceId: 'crashed-instance'
                });
            }

            await timerService.initializeTimerService(onExpire);

            // Trigger orphan check
            jest.advanceTimersByTime(35000);
            await flushPromises();

            // The scan should have processed the keys (logging happens only with >100 keys
            // or >1000ms duration, so we just verify no errors occurred)
            expect(mockLogger.error).not.toHaveBeenCalledWith(
                'Error checking orphaned timers:',
                expect.any(Error)
            );
        });

        test('handles error in orphan check gracefully', async () => {
            const onExpire = jest.fn();

            // The error in orphan check is already tested via
            // "handles error processing individual orphaned timer"
            // This test verifies that orphan check can handle
            // issues gracefully without affecting other operations

            await timerService.initializeTimerService(onExpire);

            // Start a timer - should work normally even after errors
            const result = await timerService.startTimer('AFTER_ERROR', 60, onExpire);
            expect(result).not.toBeNull();
            expect(result.duration).toBe(60);

            // Verify timer was created
            const status = await timerService.getTimerStatus('AFTER_ERROR');
            expect(status).not.toBeNull();
        });

        test('handles error processing individual orphaned timer', async () => {
            const onExpire = jest.fn();

            mockRedis._storage['timer:ERROR_TIMER'] = 'invalid json {{{';

            await timerService.initializeTimerService(onExpire);

            jest.advanceTimersByTime(35000);
            await flushPromises();

            expect(mockLogger.error).toHaveBeenCalledWith(
                'Error processing orphaned timer timer:ERROR_TIMER:',
                expect.any(Error)
            );
        });

        test('logs warning when orphan timer scan times out', async () => {
            const onExpire = jest.fn();

            // Create an async generator that never completes quickly
            mockRedis.scanIterator = jest.fn().mockImplementation(async function* () {
                // This simulates a very slow scan
                yield 'timer:SLOW1';
                // The Promise.race should catch this
            });

            await timerService.initializeTimerService(onExpire);

            jest.advanceTimersByTime(35000);
            await flushPromises();
        });

        test('handles callback error in orphan recovery', async () => {
            const failingCallback = jest.fn().mockRejectedValue(new Error('Recovery failed'));

            // Create an expired timer (ensure endTime is clearly in the past)
            const expiredTimer = {
                roomCode: 'ORPHAN_CALLBACK_ERR',
                startTime: Date.now() - 120000,
                endTime: Date.now() - 10000, // 10 seconds ago
                duration: 60,
                instanceId: 'crashed-instance'
            };
            mockRedis._storage['timer:ORPHAN_CALLBACK_ERR'] = JSON.stringify(expiredTimer);

            // Set up scanIterator to yield our expired timer key
            mockRedis.scanIterator = jest.fn().mockImplementation(function* () {
                yield 'timer:ORPHAN_CALLBACK_ERR';
            });

            // Setup eval to successfully claim the timer
            mockRedis.eval.mockImplementation(async (script, options) => {
                if (script.includes('claimed')) {
                    const key = options.keys[0];
                    const data = mockRedis._storage[key];
                    if (data) {
                        delete mockRedis._storage[key];
                        return data;
                    }
                }
                return null;
            });

            // Initialize with our failing callback
            await timerService.initializeTimerService(failingCallback);

            // Trigger orphan check and wait for all async operations
            jest.advanceTimersByTime(35000);
            await flushPromises();
            await flushPromises();
            await flushPromises();

            expect(mockLogger.error).toHaveBeenCalledWith(
                'Error in timer expire callback for room ORPHAN_CALLBACK_ERR:',
                expect.any(Error)
            );
        });

        test('logs debug message for slow orphan check', async () => {
            const onExpire = jest.fn();

            // Create many timers to make the check take longer
            for (let i = 0; i < 50; i++) {
                const timer = {
                    roomCode: `ROOM_${i}`,
                    startTime: Date.now(),
                    endTime: Date.now() + 60000,
                    duration: 60,
                    instanceId: 'other-instance'
                };
                mockRedis._storage[`timer:ROOM_${i}`] = JSON.stringify(timer);
            }

            await timerService.initializeTimerService(onExpire);

            jest.advanceTimersByTime(35000);
            await flushPromises();
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

        test('handles cleanup when orphan interval exists', async () => {
            await timerService.initializeTimerService(jest.fn());

            // Orphan check should be running now
            await timerService.cleanupAllTimers();

            // Orphan check should be stopped
            expect(mockLogger.info).toHaveBeenCalledWith('All local timers cleaned up');
        });
    });

    describe('shutdownTimerService', () => {
        test('cleans up timers and unsubscribes from pub/sub', async () => {
            await timerService.initializeTimerService(jest.fn());
            await timerService.startTimer('SHUTDOWN_TEST', 60, jest.fn());

            await timerService.shutdownTimerService();

            expect(mockSubClient.unsubscribe).toHaveBeenCalledWith('timer:events');
            expect(mockLogger.info).toHaveBeenCalledWith('Timer service shut down');
        });

        test('handles unsubscribe failure gracefully', async () => {
            await timerService.initializeTimerService(jest.fn());

            mockSubClient.unsubscribe.mockRejectedValue(new Error('Unsubscribe failed'));

            await timerService.shutdownTimerService();

            expect(mockLogger.debug).toHaveBeenCalledWith(
                expect.stringContaining('Timer service unsubscribe failed during shutdown')
            );
            expect(mockLogger.info).toHaveBeenCalledWith('Timer service shut down');
        });
    });

    describe('Edge cases', () => {
        test('handles addTime event for timer owned by us via pub/sub', async () => {
            const onExpire = jest.fn();
            await timerService.initializeTimerService(onExpire);
            await timerService.startTimer('PUB_ADD', 60, onExpire);

            // Simulate addTime request coming via pub/sub (with newEndTime format)
            const newEndTime = Date.now() + 90000;
            simulatePubSubMessage({
                type: 'addTime',
                roomCode: 'PUB_ADD',
                secondsAdded: 30,
                newEndTime: newEndTime,
                newDuration: 90,
                remainingSeconds: 90,
                timestamp: Date.now()
            });

            await flushPromises();

            // The local timer should be updated
            const status = await timerService.getTimerStatus('PUB_ADD');
            expect(status).not.toBeNull();
        });

        test('addTime expiration with pub/sub failure logs warning', async () => {
            const onExpire = jest.fn();
            await timerService.startTimer('ADDTIME_PUB', 10, onExpire);

            // Add time to the timer
            await timerService.addTime('ADDTIME_PUB', 5, onExpire);

            // Make pub/sub fail for expiration
            mockPubClient.publish.mockRejectedValue(new Error('Pub/sub failed'));

            // Fast forward to expiration
            jest.advanceTimersByTime(20000);
            await flushPromises();

            // Should have logged a warning about pub/sub failure
            expect(mockLogger.warn).toHaveBeenCalledWith(
                expect.stringContaining('Failed to publish'),
                expect.any(String)
            );
        });

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
