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

    it('should be safe to call stopConnectionsCleanup when no interval is running', () => {
        expect(() => tracker.stopConnectionsCleanup()).not.toThrow();
    });

    it('should replace existing cleanup interval when startConnectionsCleanup called twice', () => {
        const mockIO1 = { sockets: { sockets: new Map([['s1', { clientIP: '1.1.1.1' }]]) } };
        const mockIO2 = { sockets: { sockets: new Map([['s2', { clientIP: '2.2.2.2' }]]) } };

        tracker.incrementConnectionCount('stale');
        tracker.startConnectionsCleanup(mockIO1 as any);
        tracker.startConnectionsCleanup(mockIO2 as any);
        jest.advanceTimersByTime(100);

        // Should use second IO's sockets
        expect(tracker.getConnectionCount('2.2.2.2')).toBe(1);
        expect(tracker.getConnectionCount('1.1.1.1')).toBe(0);
    });

    describe('LRU eviction', () => {
        it('should evict zero-count IPs when map is full', () => {
            // The module uses MAX_TRACKED_IPS = 10000, but we can't easily change that.
            // Instead we access the internal maps via getConnectionsMap and fill them.
            const map = tracker.getConnectionsMap();

            // Fill the map to capacity with zero-count entries by incrementing and decrementing
            for (let i = 0; i < 10000; i++) {
                tracker.incrementConnectionCount(`ip-${i}`);
            }
            // Now decrement all to make them zero-count (but entries remain in map)
            for (let i = 0; i < 10000; i++) {
                tracker.decrementConnectionCount(`ip-${i}`);
            }

            // Map should be cleared as decrement removes zero-count entries
            expect(map.size).toBe(0);

            // Refill with active connections
            for (let i = 0; i < 10000; i++) {
                tracker.incrementConnectionCount(`active-${i}`);
            }
            expect(map.size).toBe(10000);

            // Adding a new IP should trigger eviction logic
            // First, decrement some to create zero-count entries for eviction
            for (let i = 0; i < 100; i++) {
                tracker.decrementConnectionCount(`active-${i}`);
            }
            // Those are removed by decrement, so size is now 9900
            expect(map.size).toBe(9900);

            // Refill to 10000
            for (let i = 0; i < 100; i++) {
                tracker.incrementConnectionCount(`filler-${i}`);
            }
            expect(map.size).toBe(10000);

            // Now add a brand new IP at capacity - should trigger evictStaleEntries
            tracker.incrementConnectionCount('new-ip');
            expect(tracker.getConnectionCount('new-ip')).toBe(1);
        });

        it('should force-evict oldest IPs regardless of count when no zero-count entries exist', () => {
            const map = tracker.getConnectionsMap();

            // Fill to capacity with active (non-zero) connections
            for (let i = 0; i < 10000; i++) {
                tracker.incrementConnectionCount(`active-${i}`);
            }
            expect(map.size).toBe(10000);

            // Adding a new IP triggers forced eviction (no zero-count IPs to reclaim)
            tracker.incrementConnectionCount('overflow-ip');

            expect(tracker.getConnectionCount('overflow-ip')).toBe(1);
            // Map should have been reduced by the forced eviction batch
            expect(map.size).toBeLessThan(10000);
        });
    });

    it('should handle decrement for unknown IP gracefully', () => {
        // Decrementing an IP that doesn't exist should not throw
        // and should clean up (current code treats missing as count 1)
        tracker.decrementConnectionCount('never-seen');
        expect(tracker.getConnectionCount('never-seen')).toBe(0);
    });
});
