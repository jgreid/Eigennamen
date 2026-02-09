/**
 * Final Branch Coverage Tests
 * Targets specific uncovered branches across multiple modules to push past 94%
 *
 * Targeted branches:
 * - errorHandler.ts line 81: || 500 fallback for unmapped error codes
 * - sanitize.ts lines 83-94: toEnglishLowerCase/toEnglishUpperCase non-string
 * - safeEmit.ts lines 92,144: logSuccess=true branches
 * - GameError.ts lines 90,277,299: default null/message params
 * - auditService.ts lines 133-134: memoryPush with new key
 * - rateLimit.ts lines 460,466: sort comparators with multiple events
 */

jest.mock('../utils/logger', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn()
}));

describe('Final Branch Coverage - errorHandler', () => {
    let errorHandler: any;

    beforeEach(() => {
        jest.clearAllMocks();
        const mod = require('../middleware/errorHandler');
        errorHandler = mod.errorHandler;
    });

    const makeRes = () => {
        const res: any = { statusCode: 200, body: null };
        res.status = jest.fn((code: number) => { res.statusCode = code; return res; });
        res.json = jest.fn((body: any) => { res.body = body; return res; });
        return res;
    };

    it('should fall back to 500 for known error code not in statusMap', () => {
        // NO_CLUE is in ERROR_CODES but NOT in errorHandler's statusMap
        const err = Object.assign(new Error('No clue given'), { code: 'NO_CLUE' });
        const res = makeRes();
        errorHandler(err, {} as any, res, jest.fn());
        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.body.error.code).toBe('NO_CLUE');
    });

    it('should fall back to 500 for GAME_NOT_STARTED error code', () => {
        const err = Object.assign(new Error('Game not started'), { code: 'GAME_NOT_STARTED' });
        const res = makeRes();
        errorHandler(err, {} as any, res, jest.fn());
        expect(res.status).toHaveBeenCalledWith(500);
    });

    it('should fall back to 500 for CANNOT_CHANGE_ROLE_DURING_TURN', () => {
        const err = Object.assign(new Error('Cannot change role'), { code: 'CANNOT_CHANGE_ROLE_DURING_TURN' });
        const res = makeRes();
        errorHandler(err, {} as any, res, jest.fn());
        expect(res.status).toHaveBeenCalledWith(500);
    });
});

describe('Final Branch Coverage - sanitize', () => {
    let toEnglishLowerCase: any;
    let toEnglishUpperCase: any;

    beforeEach(() => {
        const mod = require('../utils/sanitize');
        toEnglishLowerCase = mod.toEnglishLowerCase;
        toEnglishUpperCase = mod.toEnglishUpperCase;
    });

    it('should return empty string for non-string input to toEnglishLowerCase', () => {
        expect(toEnglishLowerCase(42)).toBe('');
        expect(toEnglishLowerCase(null)).toBe('');
        expect(toEnglishLowerCase(undefined)).toBe('');
        expect(toEnglishLowerCase({})).toBe('');
    });

    it('should return lowercase for string input to toEnglishLowerCase', () => {
        expect(toEnglishLowerCase('HELLO')).toBe('hello');
        expect(toEnglishLowerCase('Test')).toBe('test');
    });

    it('should return empty string for non-string input to toEnglishUpperCase', () => {
        expect(toEnglishUpperCase(42)).toBe('');
        expect(toEnglishUpperCase(null)).toBe('');
        expect(toEnglishUpperCase(undefined)).toBe('');
        expect(toEnglishUpperCase({})).toBe('');
    });

    it('should return uppercase for string input to toEnglishUpperCase', () => {
        expect(toEnglishUpperCase('hello')).toBe('HELLO');
        expect(toEnglishUpperCase('Test')).toBe('TEST');
    });
});

describe('Final Branch Coverage - safeEmit logSuccess', () => {
    let safeEmitToRoom: any;
    let safeEmitToPlayer: any;
    let resetEmissionMetrics: any;

    beforeEach(() => {
        jest.clearAllMocks();
        const mod = require('../socket/safeEmit');
        safeEmitToRoom = mod.safeEmitToRoom;
        safeEmitToPlayer = mod.safeEmitToPlayer;
        resetEmissionMetrics = mod.resetEmissionMetrics;
        resetEmissionMetrics();
    });

    it('should log debug when logSuccess is true for safeEmitToRoom', () => {
        const logger = require('../utils/logger');
        const mockIo = {
            to: jest.fn().mockReturnValue({
                emit: jest.fn()
            })
        };

        const result = safeEmitToRoom(mockIo, 'ROOM1', 'game:started', { turn: 'red' }, { logSuccess: true });

        expect(result).toBe(true);
        expect(logger.debug).toHaveBeenCalledWith(
            expect.stringContaining('Emitted game:started'),
            expect.objectContaining({ dataKeys: expect.any(Array) })
        );
    });

    it('should log debug when logSuccess is true for safeEmitToPlayer', () => {
        const logger = require('../utils/logger');
        const mockIo = {
            to: jest.fn().mockReturnValue({
                emit: jest.fn()
            })
        };

        const result = safeEmitToPlayer(mockIo, 'session-123', 'player:updated', { team: 'red' }, { logSuccess: true });

        expect(result).toBe(true);
        expect(logger.debug).toHaveBeenCalledWith(
            expect.stringContaining('Emitted player:updated'),
            expect.objectContaining({ dataKeys: expect.any(Array) })
        );
    });

    it('should not log debug when logSuccess is false (default)', () => {
        const logger = require('../utils/logger');
        const mockIo = {
            to: jest.fn().mockReturnValue({
                emit: jest.fn()
            })
        };

        safeEmitToRoom(mockIo, 'ROOM1', 'game:started', {});
        // logger.debug should not be called for emit success
        const debugCalls = (logger.debug as jest.Mock).mock.calls.filter(
            (call: any[]) => call[0]?.includes?.('Emitted')
        );
        expect(debugCalls).toHaveLength(0);
    });

    it('should handle null data with logSuccess=true for safeEmitToRoom', () => {
        const mockIo = {
            to: jest.fn().mockReturnValue({
                emit: jest.fn()
            })
        };

        const result = safeEmitToRoom(mockIo, 'ROOM1', 'test:event', null, { logSuccess: true });
        expect(result).toBe(true);
    });

    it('should handle null data with logSuccess=true for safeEmitToPlayer', () => {
        const mockIo = {
            to: jest.fn().mockReturnValue({
                emit: jest.fn()
            })
        };

        const result = safeEmitToPlayer(mockIo, 'sess-1', 'test:event', null, { logSuccess: true });
        expect(result).toBe(true);
    });

    it('should handle undefined data with logSuccess=true for safeEmitToRoom', () => {
        const mockIo = {
            to: jest.fn().mockReturnValue({
                emit: jest.fn()
            })
        };

        const result = safeEmitToRoom(mockIo, 'ROOM1', 'test:event', undefined, { logSuccess: true });
        expect(result).toBe(true);
    });
});

describe('Final Branch Coverage - GameError defaults', () => {
    let RoomError: any;
    let ServerError: any;
    let WordListError: any;

    beforeEach(() => {
        const mod = require('../errors/GameError');
        RoomError = mod.RoomError;
        ServerError = mod.ServerError;
        WordListError = mod.WordListError;
    });

    it('should create RoomError with default null details', () => {
        const err = new RoomError('ROOM_NOT_FOUND', 'Room not found');
        expect(err.code).toBe('ROOM_NOT_FOUND');
        expect(err.details).toBeNull();
    });

    it('should create RoomError with explicit details', () => {
        const err = new RoomError('ROOM_NOT_FOUND', 'Room not found', { roomCode: 'ABC' });
        expect(err.details).toEqual({ roomCode: 'ABC' });
    });

    it('should create ServerError with default message', () => {
        const err = new ServerError();
        expect(err.message).toBe('An internal server error occurred');
        expect(err.code).toBe('SERVER_ERROR');
    });

    it('should create ServerError with custom message', () => {
        const err = new ServerError('Custom error');
        expect(err.message).toBe('Custom error');
    });

    it('should create ServerError with details', () => {
        const err = new ServerError('Error', { retryable: true });
        expect(err.details).toEqual({ retryable: true });
    });

    it('should create WordListError with default null details', () => {
        const err = new WordListError('WORD_LIST_NOT_FOUND', 'Not found');
        expect(err.code).toBe('WORD_LIST_NOT_FOUND');
        expect(err.details).toBeNull();
    });

    it('should create WordListError with explicit details', () => {
        const err = new WordListError('WORD_LIST_NOT_FOUND', 'Not found', { id: '123' });
        expect(err.details).toEqual({ id: '123' });
    });
});

describe('Final Branch Coverage - rateLimit getMetrics sort', () => {
    let createSocketRateLimiter: any;

    beforeEach(() => {
        jest.clearAllMocks();
        const mod = require('../middleware/rateLimit');
        createSocketRateLimiter = mod.createSocketRateLimiter;
    });

    it('should sort topRequestedEvents and topBlockedEvents with multiple events', () => {
        const limiter = createSocketRateLimiter({
            'event:a': { max: 1, window: 60000 },
            'event:b': { max: 1, window: 60000 }
        });

        const makeSocket = (id: string) => ({
            id,
            handshake: { address: '127.0.0.1' },
            clientIP: '127.0.0.1'
        });

        const next = jest.fn();

        // Make requests for event:a (2 requests from different sockets)
        limiter.getLimiter('event:a')(makeSocket('s1'), {}, next);
        limiter.getLimiter('event:a')(makeSocket('s2'), {}, next);

        // Make requests for event:b (3 requests from different sockets)
        limiter.getLimiter('event:b')(makeSocket('s3'), {}, next);
        limiter.getLimiter('event:b')(makeSocket('s4'), {}, next);
        limiter.getLimiter('event:b')(makeSocket('s5'), {}, next);

        // Trigger blocked events by exceeding limits (max: 1)
        // s1 already has 1 request for event:a, so second request blocks
        limiter.getLimiter('event:a')(makeSocket('s1'), {}, jest.fn());
        limiter.getLimiter('event:b')(makeSocket('s3'), {}, jest.fn());

        const metrics = limiter.getMetrics();

        expect(metrics.topRequestedEvents.length).toBeGreaterThanOrEqual(2);
        // event:b has more requests, should be first
        expect(metrics.topRequestedEvents[0].event).toBe('event:b');
        expect(metrics.topRequestedEvents[1].event).toBe('event:a');

        expect(metrics.topBlockedEvents.length).toBeGreaterThanOrEqual(1);
    });
});

describe('Final Branch Coverage - retry default params', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.resetModules();
        jest.mock('../config/constants', () => ({
            RETRY_CONFIG: {
                REDIS_OPERATION: { maxRetries: 3, baseDelayMs: 1 },
                DATABASE: { maxRetries: 3, baseDelayMs: 1 },
                OPTIMISTIC_LOCK: { maxRetries: 3, baseDelayMs: 1 },
                NETWORK_REQUEST: { maxRetries: 4, baseDelayMs: 1 },
                DISTRIBUTED_LOCK: { maxRetries: 3, baseDelayMs: 1 },
                RACE_CONDITION: { delayMs: 1 }
            }
        }));
    });

    it('should use default options when none provided (covers line 63)', async () => {
        const { withRetry } = require('../utils/retry');
        const result = await withRetry(async () => 'success');
        expect(result).toBe('success');
    });

    it('should use default maxRetries=3 when not specified (covers line 65)', async () => {
        const { withRetry } = require('../utils/retry');
        let attempts = 0;
        const result = await withRetry(async () => {
            attempts++;
            if (attempts < 3) throw new Error('retry');
            return 'done';
        }, { baseDelayMs: 1 });
        expect(result).toBe('done');
        expect(attempts).toBe(3);
    });

    it('should create wrapper with no default options (covers line 121)', async () => {
        const { createRetryWrapper } = require('../utils/retry');
        const wrapper = createRetryWrapper();
        const result = await wrapper(async () => 'wrapped-default');
        expect(result).toBe('wrapped-default');
    });
});

describe('Final Branch Coverage - rateLimit LRU IP eviction', () => {
    const origEnv = process.env.RATE_LIMIT_MAX_ENTRIES;

    beforeEach(() => {
        jest.clearAllMocks();
        jest.resetModules();
        process.env.RATE_LIMIT_MAX_ENTRIES = '2';
    });

    afterEach(() => {
        if (origEnv !== undefined) {
            process.env.RATE_LIMIT_MAX_ENTRIES = origEnv;
        } else {
            delete process.env.RATE_LIMIT_MAX_ENTRIES;
        }
        jest.restoreAllMocks();
    });

    it('should evict IP entries during LRU eviction (covers line 322)', () => {
        // Mock Date.now to control timestamps
        let mockTime = 1000;
        const dateNowSpy = jest.spyOn(Date, 'now').mockImplementation(() => mockTime);

        const { createSocketRateLimiter } = require('../middleware/rateLimit');
        const limiter = createSocketRateLimiter({
            'event:a': { max: 100, window: 60000 },
            'event:b': { max: 100, window: 60000 }
        });

        const next = jest.fn();

        // Step 1: Add entries at time=1000 (old entries)
        const socket0 = { id: 'sock-0', handshake: { address: '10.0.0.1' }, clientIP: '10.0.0.1' };
        limiter.getLimiter('event:a')(socket0, {}, next);
        // Creates socket entry "sock-0:event:a" and IP entry "ip:10.0.0.1:event:a" at time 1000

        // Step 2: Clean up socket entries (IP entries remain with old timestamp)
        limiter.cleanupSocket('sock-0');

        // Step 3: Advance time
        mockTime = 5000;

        // Step 4: Add newer entries at time=5000
        const socket1 = { id: 'sock-1', handshake: { address: '10.0.0.2' }, clientIP: '10.0.0.2' };
        limiter.getLimiter('event:a')(socket1, {}, next);
        limiter.getLimiter('event:b')(socket1, {}, next);
        // Creates socket entries at time 5000, IP entries at time 5000

        // Now: socketRequests has 2 entries (sock-1:event:a, sock-1:event:b) at time 5000
        // ipRequests has 3 entries:
        //   ip:10.0.0.1:event:a at time 1000 (OLDEST)
        //   ip:10.0.0.2:event:a at time 5000
        //   ip:10.0.0.2:event:b at time 5000
        // Total: 5 entries, exceeds MAX_TRACKED_ENTRIES=2

        // LRU eviction: sorts by lastActivity, evicts oldest first
        // Oldest is ip:10.0.0.1:event:a at time 1000 → IP entry eviction (line 322)
        const evicted = limiter.performLRUEviction();
        expect(evicted).toBeGreaterThan(0);

        dateNowSpy.mockRestore();
    });
});

describe('Final Branch Coverage - auditService memoryPush', () => {
    beforeEach(() => {
        jest.resetModules();
        jest.mock('../config/redis', () => ({
            getRedis: jest.fn(),
            isUsingMemoryMode: jest.fn().mockReturnValue(true)
        }));
    });

    it('should exercise memoryPush for security events (different key path)', async () => {
        const { logAuditEvent, clearMemoryLogs, getAuditLogs, AUDIT_EVENTS } = require('../services/auditService');
        clearMemoryLogs();

        // Log a security event - goes to security key AND main log key
        await logAuditEvent(AUDIT_EVENTS.RATE_LIMIT_HIT, {
            actor: 'test-user',
            ip: '1.2.3.4'
        });

        // Log an admin event - goes to admin key AND main log key
        await logAuditEvent(AUDIT_EVENTS.ADMIN_LOGIN, {
            actor: 'admin',
            ip: '1.2.3.4'
        });

        // Log a room event - goes to main log key only
        await logAuditEvent(AUDIT_EVENTS.ROOM_CREATED, {
            actor: 'player1'
        });

        // Verify logs are stored in memory
        const allLogs = await getAuditLogs('all');
        expect(allLogs.length).toBeGreaterThanOrEqual(3);

        const securityLogs = await getAuditLogs('security');
        expect(securityLogs.length).toBeGreaterThanOrEqual(1);
    });
});
