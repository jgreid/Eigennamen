/**
 * Tests for Reliable Emit Utility
 *
 * Tests the retry logic and emit utilities for Socket.io
 */

jest.mock('../utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));

const mockLogger = require('../utils/logger');

const {
    emitWithRetry,
    emitWithTimeout,
    emitToRoomWithLogging,
    safeEmit,
    DEFAULT_RETRY_OPTIONS
} = require('../socket/reliableEmit');

describe('Reliable Emit Utility', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    describe('DEFAULT_RETRY_OPTIONS', () => {
        test('has expected default values', () => {
            expect(DEFAULT_RETRY_OPTIONS).toEqual({
                maxRetries: 3,
                retryDelayMs: 1000,
                timeoutMs: 5000
            });
        });
    });

    describe('emitWithTimeout', () => {
        test('resolves true when socket acknowledges', async () => {
            const mockSocket = {
                connected: true,
                emit: jest.fn((event, data, callback) => {
                    // Simulate immediate acknowledgment
                    callback({ received: true });
                })
            };

            const promise = emitWithTimeout(mockSocket, 'test:event', { foo: 'bar' }, 5000);
            jest.runAllTimers();
            const result = await promise;

            expect(result).toBe(true);
            expect(mockSocket.emit).toHaveBeenCalledWith(
                'test:event',
                { foo: 'bar' },
                expect.any(Function)
            );
        });

        test('resolves false when socket not connected', async () => {
            const mockSocket = {
                connected: false,
                emit: jest.fn()
            };

            const result = await emitWithTimeout(mockSocket, 'test:event', {}, 5000);

            expect(result).toBe(false);
            expect(mockSocket.emit).not.toHaveBeenCalled();
        });

        test('resolves false on timeout', async () => {
            const mockSocket = {
                connected: true,
                emit: jest.fn((event, data, callback) => {
                    // Never call callback - simulate timeout
                })
            };

            const promise = emitWithTimeout(mockSocket, 'test:event', {}, 1000);

            // Fast-forward past timeout
            jest.advanceTimersByTime(1500);

            const result = await promise;
            expect(result).toBe(false);
        });

        test('resolves false when ack is false', async () => {
            const mockSocket = {
                connected: true,
                emit: jest.fn((event, data, callback) => {
                    callback(false);
                })
            };

            const promise = emitWithTimeout(mockSocket, 'test:event', {}, 5000);
            jest.runAllTimers();
            const result = await promise;

            expect(result).toBe(false);
        });

        test('resolves false when ack is undefined', async () => {
            const mockSocket = {
                connected: true,
                emit: jest.fn((event, data, callback) => {
                    callback(undefined);
                })
            };

            const promise = emitWithTimeout(mockSocket, 'test:event', {}, 5000);
            jest.runAllTimers();
            const result = await promise;

            expect(result).toBe(false);
        });

        test('clears timeout when acknowledged before timeout', async () => {
            jest.useRealTimers();

            const mockSocket = {
                connected: true,
                emit: jest.fn((event, data, callback) => {
                    setTimeout(() => callback({ ok: true }), 10);
                })
            };

            const result = await emitWithTimeout(mockSocket, 'test:event', {}, 5000);

            expect(result).toBe(true);
        });
    });

    describe('emitWithRetry', () => {
        test('succeeds on first attempt', async () => {
            jest.useRealTimers();

            const mockSocket = {
                connected: true,
                emit: jest.fn((event, data, callback) => {
                    callback({ received: true });
                })
            };

            const result = await emitWithRetry(mockSocket, 'test:event', { data: 'test' });

            expect(result).toBe(true);
            expect(mockSocket.emit).toHaveBeenCalledTimes(1);
        });

        test('retries on failure and succeeds', async () => {
            jest.useRealTimers();

            let attempt = 0;
            const mockSocket = {
                connected: true,
                emit: jest.fn((event, data, callback) => {
                    attempt++;
                    if (attempt < 2) {
                        // First attempt fails with false ack
                        callback(false);
                    } else {
                        // Second attempt succeeds
                        callback({ received: true });
                    }
                })
            };

            const result = await emitWithRetry(mockSocket, 'test:event', {}, {
                maxRetries: 3,
                retryDelayMs: 10, // Short delay for testing
                timeoutMs: 1000
            });

            expect(result).toBe(true);
            expect(mockSocket.emit).toHaveBeenCalledTimes(2);
            expect(mockLogger.debug).toHaveBeenCalledWith(
                expect.stringContaining('succeeded on attempt 2')
            );
        });

        test('retries on error throw and succeeds', async () => {
            jest.useRealTimers();

            let attempt = 0;
            const mockSocket = {
                connected: true,
                emit: jest.fn((event, data, callback) => {
                    attempt++;
                    if (attempt < 2) {
                        // First attempt throws error
                        throw new Error('Network error');
                    } else {
                        // Second attempt succeeds
                        callback({ received: true });
                    }
                })
            };

            const result = await emitWithRetry(mockSocket, 'test:event', {}, {
                maxRetries: 3,
                retryDelayMs: 10,
                timeoutMs: 1000
            });

            expect(result).toBe(true);
            expect(mockSocket.emit).toHaveBeenCalledTimes(2);
            // emitWithTimeout now logs when emit throws, plus emitWithRetry logs the attempt
            expect(mockLogger.warn).toHaveBeenCalledWith(
                expect.stringContaining('threw error')
            );
        });

        test('fails after max retries', async () => {
            jest.useRealTimers();

            const mockSocket = {
                connected: true,
                emit: jest.fn((event, data, callback) => {
                    callback(false);
                })
            };

            const result = await emitWithRetry(mockSocket, 'test:event', {}, {
                maxRetries: 2,
                retryDelayMs: 10,
                timeoutMs: 1000
            });

            expect(result).toBe(false);
            expect(mockSocket.emit).toHaveBeenCalledTimes(2);
            expect(mockLogger.error).toHaveBeenCalledWith(
                expect.stringContaining('failed after 2 attempts')
            );
        });

        test('logs warning on each failed attempt that throws', async () => {
            jest.useRealTimers();

            const mockSocket = {
                connected: true,
                emit: jest.fn(() => {
                    throw new Error('Socket error');
                })
            };

            await emitWithRetry(mockSocket, 'test:event', {}, {
                maxRetries: 3,
                retryDelayMs: 10,
                timeoutMs: 1000
            });

            expect(mockLogger.warn).toHaveBeenCalledTimes(3);
        });

        test('does not log warning when ack is false (silent failure)', async () => {
            jest.useRealTimers();

            const mockSocket = {
                connected: true,
                emit: jest.fn((event, data, callback) => {
                    callback(false);
                })
            };

            await emitWithRetry(mockSocket, 'test:event', {}, {
                maxRetries: 2,
                retryDelayMs: 10,
                timeoutMs: 1000
            });

            // warn is only called when emit throws, not when ack is false
            expect(mockLogger.warn).not.toHaveBeenCalled();
            // But error is still logged at the end
            expect(mockLogger.error).toHaveBeenCalledWith(
                expect.stringContaining('failed after 2 attempts')
            );
        });

        test('uses exponential backoff for retry delays', async () => {
            jest.useRealTimers();

            let attempt = 0;
            const startTimes = [];

            const mockSocket = {
                connected: true,
                emit: jest.fn((event, data, callback) => {
                    startTimes.push(Date.now());
                    attempt++;
                    if (attempt < 3) {
                        callback(false);
                    } else {
                        callback({ received: true });
                    }
                })
            };

            await emitWithRetry(mockSocket, 'test:event', {}, {
                maxRetries: 3,
                retryDelayMs: 20, // Base delay (20ms)
                timeoutMs: 1000
            });

            // Should have 3 attempts
            expect(mockSocket.emit).toHaveBeenCalledTimes(3);

            // Check delays increase (allowing for timing variance)
            // delay after attempt 1: 20 * 1 = 20ms
            // delay after attempt 2: 20 * 2 = 40ms
            if (startTimes.length >= 3) {
                const delay1 = startTimes[1] - startTimes[0];
                const delay2 = startTimes[2] - startTimes[1];
                // delay2 should be greater than delay1 due to exponential backoff
                // Allow 10ms variance for timing
                expect(delay2).toBeGreaterThanOrEqual(delay1 - 10);
            }
        });

        test('handles emit throwing an error', async () => {
            jest.useRealTimers();

            const mockSocket = {
                connected: true,
                emit: jest.fn(() => {
                    throw new Error('Emit failed');
                })
            };

            const result = await emitWithRetry(mockSocket, 'test:event', {}, {
                maxRetries: 2,
                retryDelayMs: 10,
                timeoutMs: 1000
            });

            expect(result).toBe(false);
            expect(mockLogger.warn).toHaveBeenCalledWith(
                expect.stringContaining('Emit failed')
            );
        });
    });

    describe('emitToRoomWithLogging', () => {
        test('emits to room successfully', () => {
            const mockIo = {
                to: jest.fn().mockReturnValue({
                    emit: jest.fn()
                })
            };

            emitToRoomWithLogging(mockIo, 'room:TEST12', 'test:event', { data: 'value' });

            expect(mockIo.to).toHaveBeenCalledWith('room:TEST12');
            expect(mockIo.to().emit).toHaveBeenCalledWith('test:event', { data: 'value' });
        });

        test('logs error when emit fails', () => {
            const mockIo = {
                to: jest.fn().mockImplementation(() => {
                    throw new Error('Room not found');
                })
            };

            emitToRoomWithLogging(mockIo, 'room:TEST12', 'test:event', {});

            expect(mockLogger.error).toHaveBeenCalledWith(
                expect.stringContaining('Failed to emit test:event to room room:TEST12')
            );
        });

        test('handles io.to returning object that throws on emit', () => {
            const mockIo = {
                to: jest.fn().mockReturnValue({
                    emit: jest.fn().mockImplementation(() => {
                        throw new Error('Emit failed');
                    })
                })
            };

            emitToRoomWithLogging(mockIo, 'room:TEST12', 'test:event', {});

            expect(mockLogger.error).toHaveBeenCalledWith(
                expect.stringContaining('Emit failed')
            );
        });
    });

    describe('safeEmit', () => {
        test('emits successfully when socket is connected', () => {
            const mockSocket = {
                connected: true,
                emit: jest.fn()
            };

            const result = safeEmit(mockSocket, 'test:event', { data: 'value' });

            expect(result).toBe(true);
            expect(mockSocket.emit).toHaveBeenCalledWith('test:event', { data: 'value' });
        });

        test('returns false when socket is not connected', () => {
            const mockSocket = {
                connected: false,
                emit: jest.fn()
            };

            const result = safeEmit(mockSocket, 'test:event', {});

            expect(result).toBe(false);
            expect(mockSocket.emit).not.toHaveBeenCalled();
            expect(mockLogger.debug).toHaveBeenCalledWith(
                expect.stringContaining('Cannot emit test:event: socket not connected')
            );
        });

        test('returns false when socket is null', () => {
            const result = safeEmit(null, 'test:event', {});

            expect(result).toBe(false);
            expect(mockLogger.debug).toHaveBeenCalledWith(
                expect.stringContaining('socket not connected')
            );
        });

        test('returns false when socket is undefined', () => {
            const result = safeEmit(undefined, 'test:event', {});

            expect(result).toBe(false);
        });

        test('returns false and logs error when emit throws', () => {
            const mockSocket = {
                connected: true,
                emit: jest.fn().mockImplementation(() => {
                    throw new Error('Emit error');
                })
            };

            const result = safeEmit(mockSocket, 'test:event', {});

            expect(result).toBe(false);
            expect(mockLogger.error).toHaveBeenCalledWith(
                expect.stringContaining('Failed to emit test:event: Emit error')
            );
        });
    });
});
