/**
 * Connection Tracker Tests
 *
 * Tests for the DoS protection connection tracking module.
 */

import type * as ConnectionTracker from '../../socket/connectionTracker';

jest.mock('../../utils/logger', () => ({
    info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn()
}));

jest.mock('../../config/constants', () => ({
    SOCKET: {
        MAX_CONNECTIONS_PER_IP: 5,
        CONNECTIONS_CLEANUP_INTERVAL_MS: 100
    }
}));

describe('Connection Tracker', () => {
    let tracker: typeof ConnectionTracker;

    beforeEach(() => {
        jest.resetModules();
        jest.useFakeTimers();
        tracker = require('../../socket/connectionTracker');
        tracker.getConnectionsMap().clear();
    });

    afterEach(() => {
        tracker.stopConnectionsCleanup();
        jest.useRealTimers();
    });

    it('should track increment, decrement, and limit per IP', () => {
        tracker.incrementConnectionCount('1.2.3.4');
        tracker.incrementConnectionCount('1.2.3.4');
        expect(tracker.getConnectionCount('1.2.3.4')).toBe(2);
        expect(tracker.isConnectionLimitReached('1.2.3.4')).toBe(false);

        // Hit the limit (5)
        for (let i = 0; i < 3; i++) tracker.incrementConnectionCount('1.2.3.4');
        expect(tracker.isConnectionLimitReached('1.2.3.4')).toBe(true);

        tracker.decrementConnectionCount('1.2.3.4');
        expect(tracker.getConnectionCount('1.2.3.4')).toBe(4);
        expect(tracker.isConnectionLimitReached('1.2.3.4')).toBe(false);
    });

    it('should remove entry when count reaches zero', () => {
        tracker.incrementConnectionCount('5.6.7.8');
        tracker.decrementConnectionCount('5.6.7.8');
        expect(tracker.getConnectionsMap().has('5.6.7.8')).toBe(false);
    });

    it('should return 0 for unknown IP', () => {
        expect(tracker.getConnectionCount('unknown')).toBe(0);
        expect(tracker.isConnectionLimitReached('unknown')).toBe(false);
    });

    it('should reconcile tracked counts against actual sockets on cleanup', () => {
        tracker.incrementConnectionCount('1.1.1.1');
        tracker.incrementConnectionCount('1.1.1.1');
        tracker.incrementConnectionCount('stale.ip');

        const mockSockets = new Map([
            ['s1', { clientIP: '1.1.1.1' }],
            ['s2', { clientIP: '2.2.2.2' }],
        ]);
        tracker.startConnectionsCleanup({ sockets: { sockets: mockSockets } } as any);
        jest.advanceTimersByTime(100);

        expect(tracker.getConnectionCount('1.1.1.1')).toBe(1);
        expect(tracker.getConnectionCount('2.2.2.2')).toBe(1);
        expect(tracker.getConnectionCount('stale.ip')).toBe(0);
    });

    it('should handle cleanup errors gracefully', () => {
        const logger = require('../../utils/logger');
        const badSockets = { [Symbol.iterator]: () => { throw new Error('boom'); } };
        tracker.startConnectionsCleanup({ sockets: { sockets: badSockets } } as any);
        expect(() => jest.advanceTimersByTime(100)).not.toThrow();
        expect(logger.error).toHaveBeenCalled();
    });

    it('should handle null io in cleanup', () => {
        tracker.startConnectionsCleanup(null as any);
        expect(() => jest.advanceTimersByTime(100)).not.toThrow();
    });

    it('should stop cleanup interval', () => {
        tracker.incrementConnectionCount('keep.me');
        const mockIO = { sockets: { sockets: new Map() } };
        tracker.startConnectionsCleanup(mockIO as any);
        tracker.stopConnectionsCleanup();
        jest.advanceTimersByTime(200);
        // Entry not cleaned because interval was stopped
        expect(tracker.getConnectionCount('keep.me')).toBe(1);
    });
});
