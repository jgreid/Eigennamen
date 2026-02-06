/**
 * Safe Emit Utility Tests
 *
 * Tests for socket/safeEmit.js - error-handling wrappers for socket emissions.
 */

// Mock logger
jest.mock('../utils/logger', () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
}));

const {
    safeEmitToRoom,
    safeEmitToPlayer,
    safeEmitToPlayers,
    getEmissionMetrics,
    resetEmissionMetrics
} = require('../socket/safeEmit');
const logger = require('../utils/logger');

describe('Safe Emit Utilities', () => {
    let mockIo;
    let mockEmit;

    beforeEach(() => {
        jest.clearAllMocks();
        resetEmissionMetrics();

        mockEmit = jest.fn();
        mockIo = {
            to: jest.fn().mockReturnValue({
                emit: mockEmit
            })
        };
    });

    describe('safeEmitToRoom()', () => {
        it('should emit event to room with correct target', () => {
            const result = safeEmitToRoom(mockIo, 'ABCDEF', 'game:started', { seed: 123 });

            expect(result).toBe(true);
            expect(mockIo.to).toHaveBeenCalledWith('room:ABCDEF');
            expect(mockEmit).toHaveBeenCalledWith('game:started', { seed: 123 });
        });

        it('should return true on successful emission', () => {
            const result = safeEmitToRoom(mockIo, 'ROOM01', 'test:event', {});
            expect(result).toBe(true);
        });

        it('should return false when io is null', () => {
            const result = safeEmitToRoom(null, 'ROOM01', 'test:event', {});

            expect(result).toBe(false);
            expect(logger.error).toHaveBeenCalled();
        });

        it('should return false when io is undefined', () => {
            const result = safeEmitToRoom(undefined, 'ROOM01', 'test:event', {});

            expect(result).toBe(false);
            expect(logger.error).toHaveBeenCalled();
        });

        it('should throw error when throwOnError option is true', () => {
            expect(() => {
                safeEmitToRoom(null, 'ROOM01', 'test:event', {}, { throwOnError: true });
            }).toThrow('Socket.io instance not available');
        });

        it('should log debug message when logSuccess is true', () => {
            safeEmitToRoom(mockIo, 'ROOM01', 'test:event', { key: 'value' }, { logSuccess: true });

            expect(logger.debug).toHaveBeenCalledWith(
                expect.stringContaining('Emitted test:event'),
                expect.objectContaining({ dataKeys: ['key'] })
            );
        });

        it('should not log debug message when logSuccess is false', () => {
            safeEmitToRoom(mockIo, 'ROOM01', 'test:event', { key: 'value' });
            expect(logger.debug).not.toHaveBeenCalled();
        });

        it('should handle emit throwing an error', () => {
            mockEmit.mockImplementation(() => {
                throw new Error('Socket disconnected');
            });

            const result = safeEmitToRoom(mockIo, 'ROOM01', 'test:event', {});

            expect(result).toBe(false);
            expect(logger.error).toHaveBeenCalled();
        });

        it('should update metrics on success', () => {
            safeEmitToRoom(mockIo, 'ROOM01', 'event1', {});
            safeEmitToRoom(mockIo, 'ROOM02', 'event2', {});

            const metrics = getEmissionMetrics();
            expect(metrics.total).toBe(2);
            expect(metrics.successful).toBe(2);
            expect(metrics.failed).toBe(0);
        });

        it('should update metrics on failure', () => {
            safeEmitToRoom(null, 'ROOM01', 'event1', {});

            const metrics = getEmissionMetrics();
            expect(metrics.total).toBe(1);
            expect(metrics.successful).toBe(0);
            expect(metrics.failed).toBe(1);
            expect(metrics.lastFailure).toBeDefined();
            expect(metrics.lastFailure.roomCode).toBe('ROOM01');
        });

        it('should handle null data', () => {
            const result = safeEmitToRoom(mockIo, 'ROOM01', 'test:event', null);
            expect(result).toBe(true);
            expect(mockEmit).toHaveBeenCalledWith('test:event', null);
        });
    });

    describe('safeEmitToPlayer()', () => {
        it('should emit event to player with correct target', () => {
            const result = safeEmitToPlayer(mockIo, 'session-123', 'player:updated', { name: 'Test' });

            expect(result).toBe(true);
            expect(mockIo.to).toHaveBeenCalledWith('player:session-123');
            expect(mockEmit).toHaveBeenCalledWith('player:updated', { name: 'Test' });
        });

        it('should return true on successful emission', () => {
            const result = safeEmitToPlayer(mockIo, 'session-456', 'test:event', {});
            expect(result).toBe(true);
        });

        it('should return false when io is null', () => {
            const result = safeEmitToPlayer(null, 'session-123', 'test:event', {});

            expect(result).toBe(false);
            expect(logger.error).toHaveBeenCalled();
        });

        it('should throw error when throwOnError is true and io is null', () => {
            expect(() => {
                safeEmitToPlayer(null, 'session-123', 'test:event', {}, { throwOnError: true });
            }).toThrow('Socket.io instance not available');
        });

        it('should log debug when logSuccess is true', () => {
            safeEmitToPlayer(mockIo, 'session-123', 'test:event', { data: 'test' }, { logSuccess: true });

            expect(logger.debug).toHaveBeenCalledWith(
                expect.stringContaining('player:session-123'),
                expect.any(Object)
            );
        });

        it('should track failure in metrics with sessionId', () => {
            safeEmitToPlayer(null, 'session-xyz', 'test:event', {});

            const metrics = getEmissionMetrics();
            expect(metrics.lastFailure.sessionId).toBe('session-xyz');
        });

        it('should handle emit throwing an error', () => {
            mockEmit.mockImplementation(() => {
                throw new Error('Connection reset');
            });

            const result = safeEmitToPlayer(mockIo, 'session-123', 'test:event', {});

            expect(result).toBe(false);
            expect(logger.error).toHaveBeenCalledWith(
                expect.stringContaining('Failed to emit'),
                expect.any(Object)
            );
        });
    });

    describe('safeEmitToPlayers()', () => {
        it('should emit to multiple players', () => {
            const players = [
                { sessionId: 'session-1', name: 'Player 1' },
                { sessionId: 'session-2', name: 'Player 2' },
                { sessionId: 'session-3', name: 'Player 3' }
            ];

            const result = safeEmitToPlayers(mockIo, players, 'game:update', { turn: 'red' });

            expect(result.successful).toBe(3);
            expect(result.failed).toBe(0);
            expect(mockIo.to).toHaveBeenCalledTimes(3);
        });

        it('should use dataFn function to generate per-player data', () => {
            const players = [
                { sessionId: 'session-1', role: 'spymaster' },
                { sessionId: 'session-2', role: 'clicker' }
            ];

            const dataFn = (player) => ({ yourRole: player.role });

            safeEmitToPlayers(mockIo, players, 'player:info', dataFn);

            expect(mockEmit).toHaveBeenNthCalledWith(1, 'player:info', { yourRole: 'spymaster' });
            expect(mockEmit).toHaveBeenNthCalledWith(2, 'player:info', { yourRole: 'clicker' });
        });

        it('should handle non-function dataFn by passing it directly', () => {
            const players = [{ sessionId: 'session-1' }];
            const staticData = { message: 'Hello' };

            safeEmitToPlayers(mockIo, players, 'test:event', staticData);

            expect(mockEmit).toHaveBeenCalledWith('test:event', staticData);
        });

        it('should return empty results for non-array players', () => {
            const result = safeEmitToPlayers(mockIo, 'not-an-array', 'test:event', {});

            expect(result.successful).toBe(0);
            expect(result.failed).toBe(0);
            expect(logger.error).toHaveBeenCalledWith(
                expect.stringContaining('non-array')
            );
        });

        it('should skip invalid player objects', () => {
            const players = [
                { sessionId: 'valid-session' },
                null,
                { name: 'no-sessionId' },
                undefined,
                { sessionId: 'another-valid' }
            ];

            const result = safeEmitToPlayers(mockIo, players, 'test:event', {});

            expect(result.successful).toBe(2);
            expect(result.failed).toBe(3);
            expect(result.errors.length).toBe(3);
        });

        it('should handle dataFn throwing an error', () => {
            const players = [{ sessionId: 'session-1' }];
            const badDataFn = () => {
                throw new Error('Data generation failed');
            };

            const result = safeEmitToPlayers(mockIo, players, 'test:event', badDataFn);

            expect(result.failed).toBe(1);
            expect(result.errors[0].error).toBe('Data generation failed');
        });

        it('should count emission failures per player', () => {
            const players = [
                { sessionId: 'session-1' },
                { sessionId: 'session-2' }
            ];

            // Make first emission succeed, second fail
            mockEmit
                .mockImplementationOnce(() => {})
                .mockImplementationOnce(() => {
                    throw new Error('Failed');
                });

            const result = safeEmitToPlayers(mockIo, players, 'test:event', {});

            expect(result.successful).toBe(1);
            expect(result.failed).toBe(1);
        });
    });

    describe('getEmissionMetrics()', () => {
        it('should return current metrics', () => {
            const metrics = getEmissionMetrics();

            expect(metrics).toHaveProperty('total');
            expect(metrics).toHaveProperty('successful');
            expect(metrics).toHaveProperty('failed');
            expect(metrics).toHaveProperty('lastFailure');
        });

        it('should return a copy, not the original object', () => {
            const metrics1 = getEmissionMetrics();
            metrics1.total = 999;

            const metrics2 = getEmissionMetrics();
            expect(metrics2.total).not.toBe(999);
        });

        it('should accumulate metrics across multiple emissions', () => {
            safeEmitToRoom(mockIo, 'ROOM01', 'event1', {});
            safeEmitToRoom(mockIo, 'ROOM02', 'event2', {});
            safeEmitToRoom(null, 'ROOM03', 'event3', {});
            safeEmitToPlayer(mockIo, 'session-1', 'event4', {});
            safeEmitToPlayer(null, 'session-2', 'event5', {});

            const metrics = getEmissionMetrics();
            expect(metrics.total).toBe(5);
            expect(metrics.successful).toBe(3);
            expect(metrics.failed).toBe(2);
        });
    });

    describe('resetEmissionMetrics()', () => {
        it('should reset all metrics to zero', () => {
            // Generate some metrics
            safeEmitToRoom(mockIo, 'ROOM01', 'event1', {});
            safeEmitToRoom(null, 'ROOM02', 'event2', {});

            // Reset
            resetEmissionMetrics();

            const metrics = getEmissionMetrics();
            expect(metrics.total).toBe(0);
            expect(metrics.successful).toBe(0);
            expect(metrics.failed).toBe(0);
            expect(metrics.lastFailure).toBeNull();
        });
    });

    describe('Error message formatting', () => {
        it('should include event and room code in error message for room emission', () => {
            safeEmitToRoom(null, 'TESTROOM', 'game:event', {});

            expect(logger.error).toHaveBeenCalledWith(
                expect.stringContaining('game:event'),
                expect.objectContaining({ roomCode: 'TESTROOM' })
            );
        });

        it('should include event and sessionId in error message for player emission', () => {
            safeEmitToPlayer(null, 'test-session', 'player:event', {});

            expect(logger.error).toHaveBeenCalledWith(
                expect.stringContaining('player:event'),
                expect.objectContaining({ sessionId: 'test-session' })
            );
        });
    });
});
