/**
 * Connection Tracker Coverage Tests
 *
 * Tests for connectionTracker.ts to cover:
 * - incrementConnectionCount / decrementConnectionCount
 * - isConnectionLimitReached / getConnectionCount / getConnectionsMap
 * - startConnectionsCleanup / stopConnectionsCleanup
 * - Branch coverage for cleanup interval and error handling
 */

jest.mock('../utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));

jest.mock('../config/constants', () => ({
    SOCKET: {
        MAX_CONNECTIONS_PER_IP: 5,
        CONNECTIONS_CLEANUP_INTERVAL_MS: 100 // Short interval for testing
    }
}));

const logger = require('../utils/logger');

describe('Connection Tracker', () => {
    let tracker: typeof import('../socket/connectionTracker');

    function getTracker() {
        return require('../socket/connectionTracker');
    }

    function getLogger() {
        return require('../utils/logger');
    }

    beforeEach(() => {
        jest.resetModules();
        jest.useFakeTimers();
        tracker = getTracker();
        // Clear any state
        tracker.getConnectionsMap().clear();
    });

    afterEach(() => {
        tracker.stopConnectionsCleanup();
        jest.useRealTimers();
    });

    describe('incrementConnectionCount', () => {
        it('should increment count for a new IP', () => {
            tracker.incrementConnectionCount('192.168.1.1');
            expect(tracker.getConnectionCount('192.168.1.1')).toBe(1);
        });

        it('should increment count for an existing IP', () => {
            tracker.incrementConnectionCount('192.168.1.1');
            tracker.incrementConnectionCount('192.168.1.1');
            expect(tracker.getConnectionCount('192.168.1.1')).toBe(2);
        });

        it('should track multiple IPs independently', () => {
            tracker.incrementConnectionCount('192.168.1.1');
            tracker.incrementConnectionCount('192.168.1.2');
            tracker.incrementConnectionCount('192.168.1.1');
            expect(tracker.getConnectionCount('192.168.1.1')).toBe(2);
            expect(tracker.getConnectionCount('192.168.1.2')).toBe(1);
        });
    });

    describe('decrementConnectionCount', () => {
        it('should decrement count for an existing IP', () => {
            tracker.incrementConnectionCount('192.168.1.1');
            tracker.incrementConnectionCount('192.168.1.1');
            tracker.decrementConnectionCount('192.168.1.1');
            expect(tracker.getConnectionCount('192.168.1.1')).toBe(1);
        });

        it('should remove entry when count reaches zero', () => {
            tracker.incrementConnectionCount('192.168.1.1');
            tracker.decrementConnectionCount('192.168.1.1');
            expect(tracker.getConnectionCount('192.168.1.1')).toBe(0);
            expect(tracker.getConnectionsMap().has('192.168.1.1')).toBe(false);
        });

        it('should handle decrement for non-existent IP (defaults to 1, then removes)', () => {
            tracker.decrementConnectionCount('10.0.0.1');
            expect(tracker.getConnectionCount('10.0.0.1')).toBe(0);
            expect(tracker.getConnectionsMap().has('10.0.0.1')).toBe(false);
        });
    });

    describe('isConnectionLimitReached', () => {
        it('should return false when under limit', () => {
            tracker.incrementConnectionCount('192.168.1.1');
            expect(tracker.isConnectionLimitReached('192.168.1.1')).toBe(false);
        });

        it('should return true when at limit', () => {
            for (let i = 0; i < 5; i++) {
                tracker.incrementConnectionCount('192.168.1.1');
            }
            expect(tracker.isConnectionLimitReached('192.168.1.1')).toBe(true);
        });

        it('should return true when over limit', () => {
            for (let i = 0; i < 6; i++) {
                tracker.incrementConnectionCount('192.168.1.1');
            }
            expect(tracker.isConnectionLimitReached('192.168.1.1')).toBe(true);
        });

        it('should return false for unknown IP (0 connections)', () => {
            expect(tracker.isConnectionLimitReached('10.0.0.99')).toBe(false);
        });
    });

    describe('getConnectionCount', () => {
        it('should return 0 for unknown IP', () => {
            expect(tracker.getConnectionCount('unknown.ip')).toBe(0);
        });

        it('should return correct count', () => {
            tracker.incrementConnectionCount('192.168.1.1');
            tracker.incrementConnectionCount('192.168.1.1');
            tracker.incrementConnectionCount('192.168.1.1');
            expect(tracker.getConnectionCount('192.168.1.1')).toBe(3);
        });
    });

    describe('getConnectionsMap', () => {
        it('should return the internal map', () => {
            const map = tracker.getConnectionsMap();
            expect(map).toBeInstanceOf(Map);
        });

        it('should reflect changes', () => {
            tracker.incrementConnectionCount('1.2.3.4');
            const map = tracker.getConnectionsMap();
            expect(map.get('1.2.3.4')).toBe(1);
        });
    });

    describe('startConnectionsCleanup', () => {
        it('should reconcile tracked counts against actual connected sockets', () => {
            // Set up tracked connections that don't match actual sockets
            tracker.incrementConnectionCount('192.168.1.1');
            tracker.incrementConnectionCount('192.168.1.1');
            tracker.incrementConnectionCount('stale.ip.addr');

            const mockSockets = new Map();
            mockSockets.set('socket-1', { clientIP: '192.168.1.1' });
            mockSockets.set('socket-2', { clientIP: '10.0.0.1' });

            const mockIO = {
                sockets: {
                    sockets: mockSockets
                }
            };

            tracker.startConnectionsCleanup(mockIO as any);

            // Trigger interval
            jest.advanceTimersByTime(100);

            // After cleanup: only actual sockets should be counted
            expect(tracker.getConnectionCount('192.168.1.1')).toBe(1);
            expect(tracker.getConnectionCount('10.0.0.1')).toBe(1);
            expect(tracker.getConnectionCount('stale.ip.addr')).toBe(0);
        });

        it('should handle socket without clientIP (uses "unknown")', () => {
            const mockSockets = new Map();
            mockSockets.set('socket-1', {}); // no clientIP

            const mockIO = {
                sockets: {
                    sockets: mockSockets
                }
            };

            tracker.startConnectionsCleanup(mockIO as any);
            jest.advanceTimersByTime(100);

            expect(tracker.getConnectionCount('unknown')).toBe(1);
        });

        it('should handle null io gracefully', () => {
            tracker.startConnectionsCleanup(null as any);
            // Should not throw when interval fires
            jest.advanceTimersByTime(100);
            // No error logged since null check returns early
        });

        it('should handle errors during cleanup gracefully', () => {
            // Create a Map-like that throws on iteration
            const badSockets = {
                [Symbol.iterator]: () => {
                    throw new Error('Socket enumeration failed');
                }
            };

            const mockIO = {
                sockets: {
                    sockets: badSockets
                }
            };

            tracker.startConnectionsCleanup(mockIO as any);
            // Should not throw even when cleanup fails
            expect(() => jest.advanceTimersByTime(100)).not.toThrow();
            // Verify the error path was exercised by checking logger
            const loggerMod = getLogger();
            expect(loggerMod.error).toHaveBeenCalledWith(
                'Error during connectionsPerIP cleanup:',
                expect.any(Error)
            );
        });

        it('should clear previous interval when called again', () => {
            const mockSockets = new Map();
            const mockIO = {
                sockets: { sockets: mockSockets }
            };

            tracker.startConnectionsCleanup(mockIO as any);
            tracker.startConnectionsCleanup(mockIO as any); // Should clear previous

            jest.advanceTimersByTime(100);
            // Should not have doubled intervals
        });
    });

    describe('stopConnectionsCleanup', () => {
        it('should stop the cleanup interval', () => {
            const mockSockets = new Map();
            const mockIO = {
                sockets: { sockets: mockSockets }
            };

            tracker.startConnectionsCleanup(mockIO as any);
            tracker.stopConnectionsCleanup();

            // Adding a stale entry
            tracker.incrementConnectionCount('stale.ip');

            jest.advanceTimersByTime(200);

            // Should NOT have been cleaned up since interval was stopped
            expect(tracker.getConnectionCount('stale.ip')).toBe(1);
        });

        it('should be safe to call when no interval is running', () => {
            // Should not throw
            tracker.stopConnectionsCleanup();
        });

        it('should be safe to call multiple times', () => {
            const mockSockets = new Map();
            const mockIO = {
                sockets: { sockets: mockSockets }
            };

            tracker.startConnectionsCleanup(mockIO as any);
            tracker.stopConnectionsCleanup();
            tracker.stopConnectionsCleanup(); // Second call should be safe
        });
    });
});
