/**
 * Redis Failure Mode Tests
 *
 * Verifies that services behave predictably when Redis is down:
 * - Operations that wrap Redis calls reject with the original error
 * - Operations with try/catch guards return safe defaults
 * - No operations hang indefinitely
 */

const { createFailingRedis } = require('../helpers/mocks');

const failingRedis = createFailingRedis('Connection refused');

jest.mock('../../config/redis', () => ({
    getRedis: () => failingRedis,
    isRedisHealthy: jest.fn().mockResolvedValue(false),
    getPubSubClients: jest.fn().mockReturnValue({ pubClient: null, subClient: null }),
    isUsingMemoryMode: jest.fn().mockReturnValue(false),
}));

jest.mock('../../utils/logger', () => ({
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
}));

describe('Service behavior when Redis is down', () => {
    describe('timerService', () => {
        const timerService = require('../../services/timerService');

        test('startTimer rejects with Redis error', async () => {
            await expect(timerService.startTimer('ROOM01', 30)).rejects.toThrow('Connection refused');
        });

        test('stopTimer rejects with Redis error', async () => {
            await expect(timerService.stopTimer('ROOM01')).rejects.toThrow('Connection refused');
        });

        test('getTimerStatus rejects with Redis error', async () => {
            await expect(timerService.getTimerStatus('ROOM01')).rejects.toThrow('Connection refused');
        });

        test('hasActiveTimer rejects with Redis error', async () => {
            await expect(timerService.hasActiveTimer('ROOM01')).rejects.toThrow('Connection refused');
        });

        test('cleanupAllTimers does not throw (local-only operation)', () => {
            expect(() => timerService.cleanupAllTimers()).not.toThrow();
        });
    });

    describe('playerService', () => {
        const playerService = require('../../services/playerService');

        test('getPlayer rejects with Redis error', async () => {
            await expect(playerService.getPlayer('session123')).rejects.toThrow('Connection refused');
        });

        test('getPlayersInRoom rejects with Redis error', async () => {
            await expect(playerService.getPlayersInRoom('ROOM01')).rejects.toThrow('Connection refused');
        });
    });

    describe('roomService', () => {
        const roomService = require('../../services/roomService');

        test('roomExists rejects with Redis error', async () => {
            await expect(roomService.roomExists('ROOM01')).rejects.toThrow('Connection refused');
        });

        test('getRoom rejects with Redis error', async () => {
            await expect(roomService.getRoom('ROOM01')).rejects.toThrow('Connection refused');
        });
    });

    describe('FailingRedisMock itself', () => {
        test('all common operations reject', async () => {
            const ops = ['get', 'set', 'del', 'exists', 'expire', 'eval', 'incr', 'ping'];
            for (const op of ops) {
                await expect(failingRedis[op]('test')).rejects.toThrow('Connection refused');
            }
        });

        test('error has ECONNRESET code', () => {
            expect(failingRedis._error.code).toBe('ECONNRESET');
        });

        test('failAfter mode allows initial calls to succeed', async () => {
            const { createMockRedis, createFailingRedis: createFailing } = require('../helpers/mocks');
            const delegate = createMockRedis();
            // Pre-populate delegate storage (call goes to delegate, not hybrid)
            await delegate.set('key', 'value');

            const hybrid = createFailing('fail after 2', { failAfter: 2 }, delegate);
            // First call (1/2) succeeds via delegate
            const v1 = await hybrid.get('key');
            expect(v1).toBe('value');
            // Second call (2/2) succeeds via delegate
            const v2 = await hybrid.get('key');
            expect(v2).toBe('value');
            // Third call exceeds failAfter threshold → fails
            await expect(hybrid.get('key')).rejects.toThrow('fail after 2');
        });
    });
});
