/**
 * Tests for Event Log Service
 */

const {
    EVENT_TYPES,
    logEvent,
    getEventsSince,
    getRecentEvents,
    getLatestVersion,
    canReplayFrom,
    clearEventLog,
    getEventLogStats,
    EVENT_LOG_TTL,
    MAX_EVENTS_PER_ROOM
} = require('../services/eventLogService');

// Mock Redis
const mockPipeline = {
    lPush: jest.fn().mockReturnThis(),
    lTrim: jest.fn().mockReturnThis(),
    expire: jest.fn().mockReturnThis(),
    exec: jest.fn()
};

const mockRedis = {
    multi: jest.fn(() => mockPipeline),
    lRange: jest.fn(),
    lIndex: jest.fn(),
    lLen: jest.fn(),
    del: jest.fn()
};

jest.mock('../config/redis', () => ({
    getRedis: () => mockRedis
}));

// Mock logger
jest.mock('../utils/logger', () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
}));

// Mock uuid
jest.mock('uuid', () => ({
    v4: jest.fn(() => 'mock-uuid-123')
}));

describe('EventLogService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockPipeline.exec.mockResolvedValue([]);
    });

    describe('EVENT_TYPES', () => {
        it('should define room events', () => {
            expect(EVENT_TYPES.ROOM_CREATED).toBe('room:created');
            expect(EVENT_TYPES.PLAYER_JOINED).toBe('player:joined');
            expect(EVENT_TYPES.PLAYER_LEFT).toBe('player:left');
            expect(EVENT_TYPES.PLAYER_DISCONNECTED).toBe('player:disconnected');
            expect(EVENT_TYPES.HOST_CHANGED).toBe('host:changed');
        });

        it('should define game events', () => {
            expect(EVENT_TYPES.GAME_STARTED).toBe('game:started');
            expect(EVENT_TYPES.CLUE_GIVEN).toBe('clue:given');
            expect(EVENT_TYPES.CARD_REVEALED).toBe('card:revealed');
            expect(EVENT_TYPES.TURN_ENDED).toBe('turn:ended');
            expect(EVENT_TYPES.GAME_OVER).toBe('game:over');
        });

        it('should define timer events', () => {
            expect(EVENT_TYPES.TIMER_STARTED).toBe('timer:started');
            expect(EVENT_TYPES.TIMER_PAUSED).toBe('timer:paused');
            expect(EVENT_TYPES.TIMER_EXPIRED).toBe('timer:expired');
        });
    });

    describe('logEvent', () => {
        it('should log event to Redis', async () => {
            const result = await logEvent('ABC123', EVENT_TYPES.GAME_STARTED, { team: 'red' }, 1);

            expect(result).toMatchObject({
                id: 'mock-uuid-123',
                type: EVENT_TYPES.GAME_STARTED,
                data: { team: 'red' },
                version: 1
            });
            expect(result.timestamp).toBeDefined();

            expect(mockRedis.multi).toHaveBeenCalled();
            expect(mockPipeline.lPush).toHaveBeenCalledWith(
                'room:events:ABC123',
                expect.stringContaining('"type":"game:started"')
            );
            expect(mockPipeline.lTrim).toHaveBeenCalledWith('room:events:ABC123', 0, MAX_EVENTS_PER_ROOM - 1);
            expect(mockPipeline.expire).toHaveBeenCalledWith('room:events:ABC123', EVENT_LOG_TTL);
            expect(mockPipeline.exec).toHaveBeenCalled();
        });

        it('should handle null version', async () => {
            const result = await logEvent('ABC123', EVENT_TYPES.CARD_REVEALED, { index: 5 });

            expect(result.version).toBeNull();
        });

        it('should return null on Redis error', async () => {
            mockPipeline.exec.mockRejectedValueOnce(new Error('Redis error'));

            const result = await logEvent('ABC123', EVENT_TYPES.GAME_STARTED, {});

            expect(result).toBeNull();
        });
    });

    describe('getEventsSince', () => {
        it('should return events newer than specified version', async () => {
            mockRedis.lRange.mockResolvedValueOnce([
                JSON.stringify({ id: '1', type: 'card:revealed', version: 5, timestamp: 1000 }),
                JSON.stringify({ id: '2', type: 'clue:given', version: 4, timestamp: 900 }),
                JSON.stringify({ id: '3', type: 'game:started', version: 3, timestamp: 800 })
            ]);

            const events = await getEventsSince('ABC123', 3);

            expect(events).toHaveLength(2);
            expect(events[0].version).toBe(4);  // Oldest first (reversed)
            expect(events[1].version).toBe(5);
        });

        it('should return empty array when no events', async () => {
            mockRedis.lRange.mockResolvedValueOnce([]);

            const events = await getEventsSince('ABC123', 0);

            expect(events).toEqual([]);
        });

        it('should handle invalid JSON gracefully', async () => {
            mockRedis.lRange.mockResolvedValueOnce([
                'invalid-json',
                JSON.stringify({ id: '1', type: 'card:revealed', version: 5 })
            ]);

            const events = await getEventsSince('ABC123', 0);

            expect(events).toHaveLength(1);
            expect(events[0].id).toBe('1');
        });

        it('should return empty array on Redis error', async () => {
            mockRedis.lRange.mockRejectedValueOnce(new Error('Redis error'));

            const events = await getEventsSince('ABC123', 0);

            expect(events).toEqual([]);
        });
    });

    describe('getRecentEvents', () => {
        it('should return recent events', async () => {
            mockRedis.lRange.mockResolvedValueOnce([
                JSON.stringify({ id: '1', type: 'card:revealed', timestamp: 1000 }),
                JSON.stringify({ id: '2', type: 'clue:given', timestamp: 900 })
            ]);

            const events = await getRecentEvents('ABC123');

            expect(events).toHaveLength(2);
            expect(events[0].id).toBe('1');  // Newest first
            expect(mockRedis.lRange).toHaveBeenCalledWith('room:events:ABC123', 0, MAX_EVENTS_PER_ROOM - 1);
        });

        it('should respect custom limit', async () => {
            mockRedis.lRange.mockResolvedValueOnce([
                JSON.stringify({ id: '1', type: 'card:revealed' })
            ]);

            await getRecentEvents('ABC123', 10);

            expect(mockRedis.lRange).toHaveBeenCalledWith('room:events:ABC123', 0, 9);
        });

        it('should return empty array when no events', async () => {
            mockRedis.lRange.mockResolvedValueOnce([]);

            const events = await getRecentEvents('ABC123');

            expect(events).toEqual([]);
        });

        it('should handle invalid JSON', async () => {
            mockRedis.lRange.mockResolvedValueOnce([
                'not-json',
                JSON.stringify({ id: '1' })
            ]);

            const events = await getRecentEvents('ABC123');

            expect(events).toHaveLength(1);
        });

        it('should return empty array on error', async () => {
            mockRedis.lRange.mockRejectedValueOnce(new Error('Error'));

            const events = await getRecentEvents('ABC123');

            expect(events).toEqual([]);
        });
    });

    describe('getLatestVersion', () => {
        it('should return latest version', async () => {
            mockRedis.lIndex.mockResolvedValueOnce(
                JSON.stringify({ version: 10 })
            );

            const version = await getLatestVersion('ABC123');

            expect(version).toBe(10);
            expect(mockRedis.lIndex).toHaveBeenCalledWith('room:events:ABC123', 0);
        });

        it('should return null when no events', async () => {
            mockRedis.lIndex.mockResolvedValueOnce(null);

            const version = await getLatestVersion('ABC123');

            expect(version).toBeNull();
        });

        it('should return null on error', async () => {
            mockRedis.lIndex.mockRejectedValueOnce(new Error('Error'));

            const version = await getLatestVersion('ABC123');

            expect(version).toBeNull();
        });
    });

    describe('canReplayFrom', () => {
        it('should return canReplay: true for continuous sequence', async () => {
            mockRedis.lRange.mockResolvedValueOnce([
                JSON.stringify({ version: 5 }),
                JSON.stringify({ version: 4 }),
                JSON.stringify({ version: 3 })
            ]);

            const result = await canReplayFrom('ABC123', 2);

            expect(result).toEqual({ canReplay: true, gapExists: false });
        });

        it('should return canReplay: false when gap exists', async () => {
            mockRedis.lRange.mockResolvedValueOnce([
                JSON.stringify({ version: 5 }),
                JSON.stringify({ version: 3 })  // Gap - missing version 4
            ]);

            const result = await canReplayFrom('ABC123', 2);

            expect(result).toEqual({ canReplay: false, gapExists: true });
        });

        it('should return canReplay: false when first event is not next version', async () => {
            mockRedis.lRange.mockResolvedValueOnce([
                JSON.stringify({ version: 5 })  // Expected version 3
            ]);

            const result = await canReplayFrom('ABC123', 2);

            expect(result).toEqual({ canReplay: false, gapExists: true });
        });

        it('should return canReplay: false when no events', async () => {
            mockRedis.lRange.mockResolvedValueOnce([]);

            const result = await canReplayFrom('ABC123', 0);

            expect(result).toEqual({ canReplay: false, gapExists: false });
        });

        it('should handle events without versions', async () => {
            // Events without versions are filtered out by getEventsSince (version > sinceVersion fails for null)
            // So canReplayFrom returns canReplay: false when no events match
            mockRedis.lRange.mockResolvedValueOnce([
                JSON.stringify({ type: 'event1' }),
                JSON.stringify({ type: 'event2' })
            ]);

            const result = await canReplayFrom('ABC123', 0);

            // Since null > 0 is false, events without versions don't pass the filter
            expect(result).toEqual({ canReplay: false, gapExists: false });
        });
    });

    describe('clearEventLog', () => {
        it('should delete event log from Redis', async () => {
            mockRedis.del.mockResolvedValueOnce(1);

            await clearEventLog('ABC123');

            expect(mockRedis.del).toHaveBeenCalledWith('room:events:ABC123');
        });

        it('should handle Redis errors', async () => {
            mockRedis.del.mockRejectedValueOnce(new Error('Error'));

            // Should not throw
            await expect(clearEventLog('ABC123')).resolves.not.toThrow();
        });
    });

    describe('getEventLogStats', () => {
        it('should return stats for room', async () => {
            mockRedis.lLen.mockResolvedValueOnce(50);
            mockRedis.lIndex
                .mockResolvedValueOnce(JSON.stringify({ id: 'newest', timestamp: 2000 }))
                .mockResolvedValueOnce(JSON.stringify({ id: 'oldest', timestamp: 1000 }));

            const stats = await getEventLogStats('ABC123');

            expect(stats.count).toBe(50);
            expect(stats.newest.id).toBe('newest');
            expect(stats.oldest.id).toBe('oldest');
        });

        it('should return empty stats when no events', async () => {
            mockRedis.lLen.mockResolvedValueOnce(0);

            const stats = await getEventLogStats('ABC123');

            expect(stats).toEqual({ count: 0, oldest: null, newest: null });
        });

        it('should return error stats on failure', async () => {
            mockRedis.lLen.mockRejectedValueOnce(new Error('Redis error'));

            const stats = await getEventLogStats('ABC123');

            expect(stats).toEqual({
                count: 0,
                oldest: null,
                newest: null,
                error: 'Redis error'
            });
        });
    });

    describe('Constants', () => {
        it('should export EVENT_LOG_TTL', () => {
            expect(EVENT_LOG_TTL).toBe(300);
        });

        it('should export MAX_EVENTS_PER_ROOM', () => {
            expect(MAX_EVENTS_PER_ROOM).toBe(100);
        });
    });
});
