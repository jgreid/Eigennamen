/**
 * Reconnection Service Direct Tests
 *
 * Tests for cleanupOrphanedReconnectionTokens and validateSocketAuthToken
 * edge cases in the reconnection token management functions.
 */

const mockRedis: any = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    eval: jest.fn().mockResolvedValue(null),
    scanIterator: jest.fn(),
};

jest.mock('../../config/redis', () => ({
    getRedis: jest.fn(() => mockRedis),
    isUsingMemoryMode: jest.fn(() => true),
}));

jest.mock('../../utils/logger', () => ({
    info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn()
}));

jest.mock('../../config/constants', () => ({
    SESSION_SECURITY: {
        RECONNECTION_TOKEN_TTL_SECONDS: 300,
        RECONNECTION_TOKEN_LENGTH: 32,
        ROTATE_SESSION_ON_RECONNECT: false,
    },
    PLAYER_CLEANUP: {
        BATCH_SIZE: 50,
    },
}));

// Mock getPlayer used internally by reconnection.ts
jest.mock('../../services/playerService', () => ({
    getPlayer: jest.fn(),
}));

const logger = require('../../utils/logger');
const { getPlayer } = require('../../services/playerService');
const {
    cleanupOrphanedReconnectionTokens,
    validateSocketAuthToken,
} = require('../../services/player/reconnection');

describe('Reconnection Service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockRedis.get.mockResolvedValue(null);
        mockRedis.del.mockResolvedValue(1);
        mockRedis.scanIterator = jest.fn();
    });

    describe('cleanupOrphanedReconnectionTokens', () => {
        it('should clean up orphaned tokens when player no longer exists', async () => {
            const keys = ['reconnect:session:orphan-1', 'reconnect:session:active-1'];
            mockRedis.scanIterator.mockReturnValue((async function* () {
                for (const key of keys) yield key;
            })());

            // Lua script returns 1 if orphaned (cleaned), 0 if player exists
            mockRedis.eval.mockImplementation(async (_script: string, opts: any) => {
                const sessionKey = opts.keys[0];
                if (sessionKey === 'reconnect:session:orphan-1') return 1;
                return 0; // active-1 player still exists
            });

            const cleaned = await cleanupOrphanedReconnectionTokens();

            expect(cleaned).toBe(1);
            // Lua script handles deletion atomically — verify eval was called for both keys
            expect(mockRedis.eval).toHaveBeenCalledTimes(2);
            expect(logger.info).toHaveBeenCalledWith(
                expect.stringContaining('Cleaned up 1 orphaned')
            );
        });

        it('should handle orphaned session with no token mapping', async () => {
            mockRedis.scanIterator.mockReturnValue((async function* () {
                yield 'reconnect:session:orphan-1';
            })());

            // Lua script handles missing token mapping internally — still returns 1 (cleaned)
            mockRedis.eval.mockResolvedValue(1);

            const cleaned = await cleanupOrphanedReconnectionTokens();

            expect(cleaned).toBe(1);
            expect(mockRedis.eval).toHaveBeenCalledTimes(1);
        });

        it('should respect BATCH_SIZE limit', async () => {
            const keys: string[] = [];
            for (let i = 0; i < 100; i++) {
                keys.push(`reconnect:session:orphan-${i}`);
            }

            mockRedis.scanIterator.mockReturnValue((async function* () {
                for (const key of keys) yield key;
            })());

            // All orphaned — Lua script returns 1 for each
            mockRedis.eval.mockResolvedValue(1);

            const cleaned = await cleanupOrphanedReconnectionTokens();

            expect(cleaned).toBe(50);
        });

        it('should return 0 when no orphans found', async () => {
            mockRedis.scanIterator.mockReturnValue((async function* () {
                yield 'reconnect:session:active-1';
            })());

            // Player still exists — Lua script returns 0 (not cleaned)
            mockRedis.eval.mockResolvedValue(0);

            const cleaned = await cleanupOrphanedReconnectionTokens();

            expect(cleaned).toBe(0);
            expect(logger.info).not.toHaveBeenCalledWith(
                expect.stringContaining('Cleaned up')
            );
        });

        it('should handle scanIterator errors gracefully', async () => {
            mockRedis.scanIterator.mockReturnValue((async function* () {
                throw new Error('SCAN failed');
            })());

            const cleaned = await cleanupOrphanedReconnectionTokens();

            expect(cleaned).toBe(0);
            expect(logger.warn).toHaveBeenCalledWith(
                'Reconnection token cleanup skipped:',
                'SCAN failed'
            );
        });

        it('should return 0 when scanIterator is not available', async () => {
            delete mockRedis.scanIterator;

            const cleaned = await cleanupOrphanedReconnectionTokens();

            expect(cleaned).toBe(0);
        });
    });

    describe('validateSocketAuthToken', () => {
        it('should return false for disconnected player without token', async () => {
            (getPlayer as jest.Mock).mockResolvedValue({
                sessionId: 's1',
                connected: false,
            });

            const result = await validateSocketAuthToken('s1');

            expect(result).toBe(false);
            expect(logger.warn).toHaveBeenCalledWith(
                'Reconnection attempted without token',
                expect.objectContaining({ sessionId: 's1' })
            );
        });

        it('should return true for connected player without token', async () => {
            (getPlayer as jest.Mock).mockResolvedValue({
                sessionId: 's1',
                connected: true,
            });

            const result = await validateSocketAuthToken('s1');

            expect(result).toBe(true);
        });

        it('should return false for null player without token', async () => {
            (getPlayer as jest.Mock).mockResolvedValue(null);

            const result = await validateSocketAuthToken('s1');

            expect(result).toBe(false);
        });

        it('should return true for valid token via constant-time comparison', async () => {
            const token = 'a'.repeat(64);
            mockRedis.get.mockImplementation(async (key: string) => {
                if (key === 'reconnect:session:s1') return token;
                return null;
            });

            const result = await validateSocketAuthToken('s1', token);

            expect(result).toBe(true);
            expect(logger.info).toHaveBeenCalledWith(
                'Reconnection token verified (not consumed)',
                expect.objectContaining({ sessionId: 's1' })
            );
        });

        it('should reject mismatched token lengths', async () => {
            mockRedis.get.mockImplementation(async (key: string) => {
                if (key === 'reconnect:session:s1') return 'short-stored';
                return null;
            });

            const result = await validateSocketAuthToken('s1', 'different-length-provided-token-longer');

            expect(result).toBe(false);
            expect(logger.warn).toHaveBeenCalledWith(
                'Reconnection token length mismatch',
                expect.objectContaining({ sessionId: 's1' })
            );
        });

        it('should reject invalid token with same length', async () => {
            const storedToken = 'a'.repeat(64);
            const wrongToken = 'b'.repeat(64);

            mockRedis.get.mockImplementation(async (key: string) => {
                if (key === 'reconnect:session:s1') return storedToken;
                return null;
            });

            const result = await validateSocketAuthToken('s1', wrongToken);

            expect(result).toBe(false);
            expect(logger.warn).toHaveBeenCalledWith(
                'Invalid reconnection token',
                expect.objectContaining({ sessionId: 's1' })
            );
        });

        it('should return false when no stored token exists', async () => {
            mockRedis.get.mockResolvedValue(null);

            const result = await validateSocketAuthToken('s1', 'some-token');

            expect(result).toBe(false);
            expect(logger.debug).toHaveBeenCalledWith(
                'No reconnection token found',
                expect.objectContaining({ sessionId: 's1' })
            );
        });
    });
});
