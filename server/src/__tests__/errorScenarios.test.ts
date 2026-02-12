/**
 * Error Scenario Tests
 *
 * Phase 3.3: Tests for error handling in edge cases like Redis timeouts,
 * corrupted data, and service failures.
 */

const gameService = require('../services/gameService');
const roomService = require('../services/roomService');
const playerService = require('../services/playerService');
const timerService = require('../services/timerService');
const { createMockRedis, createMockLogger, createMockRoom, createMockGame } = require('./helpers/mocks');

// Mock dependencies
jest.mock('../config/redis', () => ({
    getRedis: jest.fn()
}));

jest.mock('../utils/logger', () => ({
    child: jest.fn(() => ({
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        child: jest.fn(() => ({
            debug: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn()
        }))
    })),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
}));

const { getRedis } = require('../config/redis');

describe('Error Scenarios', () => {
    let mockRedis;

    beforeEach(() => {
        mockRedis = createMockRedis();
        createMockLogger();
        getRedis.mockReturnValue(mockRedis);
    });

    describe('Redis Timeout Scenarios', () => {
        test('propagates Redis timeout error during game retrieval', async () => {
            // Services propagate Redis errors to callers
            mockRedis.get.mockImplementation(async () => {
                throw new Error('ETIMEDOUT');
            });

            await expect(
                gameService.getGame('TESTROOM')
            ).rejects.toThrow('ETIMEDOUT');
        });

        test('propagates Redis timeout error during room retrieval', async () => {
            mockRedis.get.mockImplementation(async () => {
                throw new Error('Connection timeout');
            });

            await expect(
                roomService.getRoom('TESTROOM')
            ).rejects.toThrow('Connection timeout');
        });

        test('propagates Redis timeout error during player retrieval', async () => {
            mockRedis.get.mockImplementation(async () => {
                throw new Error('ECONNREFUSED');
            });

            await expect(
                playerService.getPlayer('session-123')
            ).rejects.toThrow('ECONNREFUSED');
        });

        test('handles Redis connection reset during timer start', async () => {
            mockRedis.get.mockResolvedValue(null);
            mockRedis.set.mockRejectedValue(new Error('ECONNRESET'));

            await expect(
                timerService.startTimer('TESTROOM', 60)
            ).rejects.toThrow();
        });
    });

    describe('Corrupted Data Scenarios', () => {
        test('handles corrupted JSON in game state', async () => {
            mockRedis.get.mockResolvedValue('{ invalid json }');

            const game = await gameService.getGame('TESTROOM');
            expect(game).toBeNull();
        });

        test('handles corrupted JSON in room state', async () => {
            mockRedis.get.mockResolvedValue('not a json at all');

            const room = await roomService.getRoom('TESTROOM');
            expect(room).toBeNull();
        });

        test('handles corrupted JSON in player state', async () => {
            mockRedis.get.mockResolvedValue('{corrupt: data]]]');

            const player = await playerService.getPlayer('session-123');
            expect(player).toBeNull();
        });

        test('handles partially corrupted game data', async () => {
            // Valid JSON but missing required fields
            mockRedis.get.mockResolvedValue(JSON.stringify({
                words: ['only', 'three', 'words'],
                // Missing types, revealed, etc.
            }));

            const game = await gameService.getGame('TESTROOM');
            // Should still return something but may have undefined fields
            expect(game).toBeDefined();
        });

        test('handles empty string from Redis', async () => {
            mockRedis.get.mockResolvedValue('');

            const game = await gameService.getGame('TESTROOM');
            expect(game).toBeNull();
        });

        test('handles null value from Redis', async () => {
            mockRedis.get.mockResolvedValue(null);

            const game = await gameService.getGame('TESTROOM');
            expect(game).toBeNull();
        });
    });

    describe('Service Failure Propagation', () => {
        test('room creation fails gracefully on Redis error', async () => {
            mockRedis.set.mockRejectedValue(new Error('Redis write error'));

            await expect(
                roomService.createRoom('test-room', 'session-123', {})
            ).rejects.toThrow();
        });

        test('player creation fails gracefully on Redis error', async () => {
            mockRedis.set.mockRejectedValue(new Error('Out of memory'));

            await expect(
                playerService.createPlayer('TESTROOM', 'session-123', 'TestPlayer')
            ).rejects.toThrow();
        });

        test('game creation fails when room does not exist', async () => {
            // Room lookup returns null
            mockRedis.get.mockResolvedValue(null);

            await expect(
                gameService.createGame('TESTROOM', {})
            ).rejects.toThrow('Room not found');
        });
    });

    describe('Concurrent Operation Errors', () => {
        test('handles race condition on room deletion', async () => {
            // First call returns room, second returns null (deleted)
            mockRedis.get
                .mockResolvedValueOnce(JSON.stringify(createMockRoom()))
                .mockResolvedValueOnce(null);
            mockRedis.del.mockResolvedValue(1);

            // Should not throw when room disappears mid-operation
            await expect(
                roomService.deleteRoom('TESTROOM')
            ).resolves.not.toThrow();
        });
    });

    describe('Network Error Recovery', () => {
        test('propagates network error for reads', async () => {
            mockRedis.get.mockImplementation(async () => {
                throw new Error('ENOTFOUND');
            });

            await expect(
                gameService.getGame('TESTROOM')
            ).rejects.toThrow('ENOTFOUND');
        });

        test('throws on network error for writes', async () => {
            mockRedis.set.mockRejectedValue(new Error('ENETUNREACH'));

            await expect(
                roomService.createRoom('test-room', 'session-123', {})
            ).rejects.toThrow();
        });
    });

    describe('Invalid State Handling', () => {
        test('handles game action on non-existent game', async () => {
            mockRedis.get.mockResolvedValue(null);

            await expect(
                gameService.revealCard('NOROOM', 0, 'red')
            ).rejects.toThrow();
        });

        test('handles card reveal on already revealed card', async () => {
            mockRedis.eval.mockResolvedValue(JSON.stringify({ error: 'ALREADY_REVEALED' }));

            await expect(
                gameService.revealCard('TESTROOM', 0, 'red')
            ).rejects.toThrow('Card already revealed');
        });

        test('handles turn action on game over state', async () => {
            mockRedis.eval.mockResolvedValue(JSON.stringify({ error: 'GAME_OVER' }));

            await expect(
                gameService.revealCard('TESTROOM', 1, 'red')
            ).rejects.toThrow('Game is already over');
        });

        test('handles invalid card index', async () => {
            const mockGame = createMockGame({ roomCode: 'TESTROOM' });
            mockRedis.get.mockResolvedValue(JSON.stringify(mockGame));

            await expect(
                gameService.revealCard('TESTROOM', 99, 'red')
            ).rejects.toThrow();
        });

        test('handles negative card index', async () => {
            const mockGame = createMockGame({ roomCode: 'TESTROOM' });
            mockRedis.get.mockResolvedValue(JSON.stringify(mockGame));

            await expect(
                gameService.revealCard('TESTROOM', -1, 'red')
            ).rejects.toThrow();
        });
    });

    describe('Memory/Resource Errors', () => {
        test('handles out of memory error gracefully', async () => {
            const oomError = new Error('OOM command not allowed when used memory > maxmemory');
            mockRedis.set.mockRejectedValue(oomError);

            await expect(
                gameService.createGame('TESTROOM', {})
            ).rejects.toThrow();
        });
    });

    describe('Clue Validation Errors', () => {
        test('handles empty clue word', async () => {
            const mockGame = createMockGame({
                roomCode: 'TESTROOM',
                currentTurn: 'red'
            });
            mockRedis.get.mockResolvedValue(JSON.stringify(mockGame));

            await expect(
                gameService.giveClue('TESTROOM', '', 2, 'red')
            ).rejects.toThrow();
        });

        test('handles invalid clue number', async () => {
            const mockGame = createMockGame({
                roomCode: 'TESTROOM',
                currentTurn: 'red'
            });
            mockRedis.get.mockResolvedValue(JSON.stringify(mockGame));

            await expect(
                gameService.giveClue('TESTROOM', 'test', -1, 'red')
            ).rejects.toThrow();
        });

        test('validates team before checking game over', async () => {
            const mockGame = createMockGame({
                roomCode: 'TESTROOM',
                currentTurn: 'red',
                gameOver: true,
                winner: 'blue'
            });
            mockRedis.get.mockResolvedValue(JSON.stringify(mockGame));

            // Team validation happens before game over check
            await expect(
                gameService.giveClue('TESTROOM', 'test', 2, null)
            ).rejects.toThrow('Spymaster must be on a team');
        });
    });
});

describe('Timer Service Error Scenarios', () => {
    let mockRedis;

    beforeEach(() => {
        mockRedis = createMockRedis();
        getRedis.mockReturnValue(mockRedis);
    });

    test('handles getting status for non-existent timer', async () => {
        mockRedis.get.mockResolvedValue(null);

        const status = await timerService.getTimerStatus('TESTROOM');
        expect(status).toBeNull();
    });

    test('handles pause on already paused timer', async () => {
        const pausedTimer = JSON.stringify({
            roomCode: 'TESTROOM',
            duration: 60,
            startTime: Date.now() - 30000,
            endTime: Date.now() + 30000,
            isPaused: true,
            pausedAt: Date.now(),
            remainingWhenPaused: 30
        });
        mockRedis.get.mockResolvedValue(pausedTimer);

        // Should return remaining time without re-pausing
        const result = await timerService.pauseTimer('TESTROOM');
        expect(result).toBeDefined();
    });

    test('handles resume on non-paused timer', async () => {
        const activeTimer = JSON.stringify({
            roomCode: 'TESTROOM',
            duration: 60,
            startTime: Date.now() - 30000,
            endTime: Date.now() + 30000,
            isPaused: false
        });
        mockRedis.get.mockResolvedValue(activeTimer);

        // Should handle gracefully
        const result = await timerService.resumeTimer('TESTROOM');
        expect(result).toBeDefined();
    });

    test('handles stop on non-existent timer', async () => {
        mockRedis.get.mockResolvedValue(null);
        mockRedis.del.mockResolvedValue(0);

        // Should not throw
        await expect(
            timerService.stopTimer('TESTROOM')
        ).resolves.not.toThrow();
    });

    test('handles corrupted timer data', async () => {
        mockRedis.get.mockResolvedValue('not valid json');

        const status = await timerService.getTimerStatus('TESTROOM');
        expect(status).toBeNull();
    });
});

describe('Player Service Error Scenarios', () => {
    let mockRedis;

    beforeEach(() => {
        mockRedis = createMockRedis();
        getRedis.mockReturnValue(mockRedis);
    });

    test('throws when updating non-existent player', async () => {
        mockRedis.get.mockResolvedValue(null);

        await expect(
            playerService.updatePlayer('non-existent-session', { team: 'red' })
        ).rejects.toThrow('Player not found');
    });

    test('handles removing non-existent player', async () => {
        mockRedis.get.mockResolvedValue(null);
        mockRedis.del.mockResolvedValue(0);
        mockRedis.sRem.mockResolvedValue(0);

        // Should not throw
        await expect(
            playerService.removePlayer('non-existent-session')
        ).resolves.not.toThrow();
    });

    test('handles getPlayersInRoom with empty room', async () => {
        mockRedis.sMembers.mockResolvedValue([]);

        const players = await playerService.getPlayersInRoom('TESTROOM');
        expect(players).toEqual([]);
    });

    test('handles disconnect for non-existent player', async () => {
        mockRedis.get.mockResolvedValue(null);

        const result = await playerService.handleDisconnect('non-existent-session');
        expect(result).toBeNull();
    });
});

describe('Room Service Error Scenarios', () => {
    let mockRedis;

    beforeEach(() => {
        mockRedis = createMockRedis();
        getRedis.mockReturnValue(mockRedis);
    });

    test('handles room exists check with Redis error', async () => {
        mockRedis.get.mockImplementation(async () => {
            throw new Error('Redis error');
        });

        const exists = await roomService.roomExists('TESTROOM');
        expect(exists).toBe(false);
    });

    test('handles deleting non-existent room', async () => {
        mockRedis.get.mockResolvedValue(null);
        mockRedis.del.mockResolvedValue(0);

        // Should not throw
        await expect(
            roomService.deleteRoom('NOROOM')
        ).resolves.not.toThrow();
    });

    test('handles getRoom when room does not exist', async () => {
        mockRedis.get.mockResolvedValue(null);

        const result = await roomService.getRoom('NOROOM');
        expect(result).toBeNull();
    });

    test('propagates error during room creation', async () => {
        mockRedis.set.mockRejectedValue(new Error('Redis write failed'));

        await expect(
            roomService.createRoom('test-room', 'session-123', {})
        ).rejects.toThrow('Redis write failed');
    });
});
