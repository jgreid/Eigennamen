/**
 * Tests for debouncedRefreshRoomTTL in roomService
 *
 * Covers: debounce behavior, stale entry eviction, error recovery
 */

const mockRedis = {
    eval: jest.fn().mockResolvedValue(1),
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    exists: jest.fn().mockResolvedValue(0),
    expire: jest.fn().mockResolvedValue(1),
};

jest.mock('../../config/redis', () => ({
    getRedis: () => mockRedis
}));

jest.mock('../../utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));

jest.mock('../../services/timerService', () => ({
    stopTimer: jest.fn()
}));

jest.mock('../../services/playerService', () => ({}));

jest.mock('../../utils/metrics', () => ({
    incrementCounter: jest.fn(),
    METRIC_NAMES: { ERRORS: 'errors' }
}));

const { debouncedRefreshRoomTTL, clearTTLRefreshEntry } = require('../../services/roomService');
const { incrementCounter } = require('../../utils/metrics');

describe('debouncedRefreshRoomTTL', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Clear debounce state between tests
        clearTTLRefreshEntry('test-room');
        clearTTLRefreshEntry('room-a');
        clearTTLRefreshEntry('room-b');
    });

    test('calls refreshRoomTTL on first call', async () => {
        await debouncedRefreshRoomTTL('test-room');
        expect(mockRedis.eval).toHaveBeenCalled();
    });

    test('skips refresh within debounce window', async () => {
        await debouncedRefreshRoomTTL('test-room');
        expect(mockRedis.eval).toHaveBeenCalledTimes(1);

        // Second call within 60s should be skipped
        await debouncedRefreshRoomTTL('test-room');
        expect(mockRedis.eval).toHaveBeenCalledTimes(1);
    });

    test('allows refresh for different rooms', async () => {
        await debouncedRefreshRoomTTL('room-a');
        await debouncedRefreshRoomTTL('room-b');
        expect(mockRedis.eval).toHaveBeenCalledTimes(2);
    });

    test('does not record timestamp on Redis failure', async () => {
        mockRedis.eval.mockRejectedValueOnce(new Error('Redis down'));

        await debouncedRefreshRoomTTL('test-room');

        // Should have logged warning and incremented error counter
        const logger = require('../../utils/logger');
        expect(logger.warn).toHaveBeenCalledWith(
            expect.stringContaining('Debounced TTL refresh failed')
        );
        expect(incrementCounter).toHaveBeenCalled();

        // Next call should retry (timestamp was not set)
        mockRedis.eval.mockResolvedValueOnce(1);
        await debouncedRefreshRoomTTL('test-room');
        expect(mockRedis.eval).toHaveBeenCalledTimes(2);
    });

    test('clearTTLRefreshEntry allows immediate re-refresh', async () => {
        await debouncedRefreshRoomTTL('test-room');
        expect(mockRedis.eval).toHaveBeenCalledTimes(1);

        clearTTLRefreshEntry('test-room');

        await debouncedRefreshRoomTTL('test-room');
        expect(mockRedis.eval).toHaveBeenCalledTimes(2);
    });
});
