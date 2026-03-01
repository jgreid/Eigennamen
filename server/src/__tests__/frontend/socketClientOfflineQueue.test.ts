/**
 * Socket Client Offline Queue Behavior Tests
 *
 * Tests the offline queue patterns used by EigennamenClient in socket-client.ts.
 * Since socket-client.ts is an IIFE that depends on the global `io` from socket.io-client
 * and sets up EigennamenClient on window, we test the queue logic in isolation
 * by extracting the core patterns into testable units.
 *
 * Test environment: jsdom (provides window).
 */

jest.mock('socket.io-client', () => ({
    io: jest.fn(() => ({
        connected: false,
        on: jest.fn(),
        off: jest.fn(),
        emit: jest.fn(),
        connect: jest.fn(),
        disconnect: jest.fn(),
        removeAllListeners: jest.fn(),
        id: 'mock-socket-id',
    })),
}));

/**
 * Offline queue item shape matching socket-client.ts OfflineQueueItem
 */
interface OfflineQueueItem {
    event: string;
    data: Record<string, unknown>;
    timestamp: number;
}

/**
 * Extracted offline queue logic from socket-client.ts _queueOrEmit / _flushOfflineQueue.
 * This mirrors the exact behavior of the real implementation.
 */
function createOfflineQueue(maxSize: number = 20) {
    let queue: OfflineQueueItem[] = [];

    /**
     * The set of events that are safe to queue for offline replay.
     * Matches the queueableEvents list in socket-client.ts _queueOrEmit.
     */
    const queueableEvents = [
        'chat:message',
        'chat:spectator',
        'player:setTeam',
        'player:setRole',
        'player:setNickname',
        'game:endTurn',
    ];

    return {
        get queue() {
            return queue;
        },
        get queueableEvents() {
            return queueableEvents;
        },

        /**
         * Queue an event if the client is offline and the event is queueable.
         * Mirrors _queueOrEmit when socket is disconnected.
         */
        queueIfOffline(event: string, data: Record<string, unknown>): boolean {
            if (queueableEvents.includes(event) && queue.length < maxSize) {
                queue.push({ event, data, timestamp: Date.now() });
                return true;
            }
            return false;
        },

        /**
         * Flush queued events, filtering out those older than maxAge.
         * Mirrors _flushOfflineQueue from socket-client.ts.
         * Returns the number of events that would be replayed.
         */
        flush(maxAgeMs: number = 2 * 60 * 1000): OfflineQueueItem[] {
            if (queue.length === 0) return [];

            const now = Date.now();
            const toReplay: OfflineQueueItem[] = [];

            for (const item of queue) {
                if (now - item.timestamp < maxAgeMs) {
                    toReplay.push(item);
                }
            }

            queue = [];
            return toReplay;
        },

        clear(): void {
            queue = [];
        },
    };
}

describe('socketClientOfflineQueue', () => {
    // ─── Queueable Events List ──────────────────────────────────────

    describe('queueable events list', () => {
        const offlineQueue = createOfflineQueue();

        it('includes chat:message for queuing chat while offline', () => {
            expect(offlineQueue.queueableEvents).toContain('chat:message');
        });

        it('includes chat:spectator for spectator chat', () => {
            expect(offlineQueue.queueableEvents).toContain('chat:spectator');
        });

        it('includes player:setTeam for team changes', () => {
            expect(offlineQueue.queueableEvents).toContain('player:setTeam');
        });

        it('includes player:setRole for role changes', () => {
            expect(offlineQueue.queueableEvents).toContain('player:setRole');
        });

        it('includes player:setNickname for nickname changes', () => {
            expect(offlineQueue.queueableEvents).toContain('player:setNickname');
        });

        it('includes game:endTurn for ending turns', () => {
            expect(offlineQueue.queueableEvents).toContain('game:endTurn');
        });

        it('does not include game:reveal (state-critical, not safe to replay)', () => {
            expect(offlineQueue.queueableEvents).not.toContain('game:reveal');
        });

        it('does not include game:start (state-critical, not safe to replay)', () => {
            expect(offlineQueue.queueableEvents).not.toContain('game:start');
        });

        it('does not include room:create', () => {
            expect(offlineQueue.queueableEvents).not.toContain('room:create');
        });

        it('does not include room:join', () => {
            expect(offlineQueue.queueableEvents).not.toContain('room:join');
        });

        it('does not include room:leave', () => {
            expect(offlineQueue.queueableEvents).not.toContain('room:leave');
        });
    });

    // ─── Queue max size behavior ────────────────────────────────────

    describe('offline queue max size behavior', () => {
        it('accepts events up to the max size limit', () => {
            const maxSize = 20;
            const offlineQueue = createOfflineQueue(maxSize);

            for (let i = 0; i < maxSize; i++) {
                const queued = offlineQueue.queueIfOffline('chat:message', { text: `msg-${i}` });
                expect(queued).toBe(true);
            }

            expect(offlineQueue.queue).toHaveLength(maxSize);
        });

        it('rejects events beyond the max size limit', () => {
            const maxSize = 20;
            const offlineQueue = createOfflineQueue(maxSize);

            // Fill the queue to capacity
            for (let i = 0; i < maxSize; i++) {
                offlineQueue.queueIfOffline('chat:message', { text: `msg-${i}` });
            }

            // This one should be rejected
            const queued = offlineQueue.queueIfOffline('chat:message', { text: 'overflow' });
            expect(queued).toBe(false);
            expect(offlineQueue.queue).toHaveLength(maxSize);
        });

        it('respects a custom max size', () => {
            const offlineQueue = createOfflineQueue(5);

            for (let i = 0; i < 5; i++) {
                offlineQueue.queueIfOffline('chat:message', { text: `msg-${i}` });
            }

            const queued = offlineQueue.queueIfOffline('chat:message', { text: 'overflow' });
            expect(queued).toBe(false);
            expect(offlineQueue.queue).toHaveLength(5);
        });

        it('does not queue non-queueable events regardless of space', () => {
            const offlineQueue = createOfflineQueue();

            const queued = offlineQueue.queueIfOffline('game:reveal', { index: 3 });
            expect(queued).toBe(false);
            expect(offlineQueue.queue).toHaveLength(0);
        });

        it('queues different types of queueable events', () => {
            const offlineQueue = createOfflineQueue();

            offlineQueue.queueIfOffline('chat:message', { text: 'hello' });
            offlineQueue.queueIfOffline('player:setTeam', { team: 'red' });
            offlineQueue.queueIfOffline('game:endTurn', {});

            expect(offlineQueue.queue).toHaveLength(3);
            expect(offlineQueue.queue[0].event).toBe('chat:message');
            expect(offlineQueue.queue[1].event).toBe('player:setTeam');
            expect(offlineQueue.queue[2].event).toBe('game:endTurn');
        });

        it('stores timestamp with each queued event', () => {
            const offlineQueue = createOfflineQueue();
            const before = Date.now();

            offlineQueue.queueIfOffline('chat:message', { text: 'hello' });

            const after = Date.now();
            expect(offlineQueue.queue[0].timestamp).toBeGreaterThanOrEqual(before);
            expect(offlineQueue.queue[0].timestamp).toBeLessThanOrEqual(after);
        });
    });

    // ─── Flush with timestamp expiry ────────────────────────────────

    describe('flush behavior with timestamp expiry', () => {
        it('replays all events that are within the 2-minute window', () => {
            const offlineQueue = createOfflineQueue();

            offlineQueue.queueIfOffline('chat:message', { text: 'recent' });
            offlineQueue.queueIfOffline('player:setTeam', { team: 'blue' });

            const replayed = offlineQueue.flush();
            expect(replayed).toHaveLength(2);
            expect(replayed[0].event).toBe('chat:message');
            expect(replayed[1].event).toBe('player:setTeam');
        });

        it('filters out events older than 2 minutes', () => {
            const offlineQueue = createOfflineQueue();
            const twoMinutesAgo = Date.now() - (2 * 60 * 1000 + 1);

            // Manually push an old event
            offlineQueue.queue.push({
                event: 'chat:message',
                data: { text: 'old message' },
                timestamp: twoMinutesAgo,
            });

            // Add a recent event
            offlineQueue.queueIfOffline('chat:message', { text: 'recent message' });

            const replayed = offlineQueue.flush();
            expect(replayed).toHaveLength(1);
            expect(replayed[0].data.text).toBe('recent message');
        });

        it('clears the queue after flushing regardless of expiry', () => {
            const offlineQueue = createOfflineQueue();
            const oldTimestamp = Date.now() - 3 * 60 * 1000; // 3 min ago

            offlineQueue.queue.push({
                event: 'chat:message',
                data: { text: 'very old' },
                timestamp: oldTimestamp,
            });

            offlineQueue.flush();

            // Queue should be empty even though the old event was not replayed
            expect(offlineQueue.queue).toHaveLength(0);
        });

        it('returns empty array when queue is empty', () => {
            const offlineQueue = createOfflineQueue();

            const replayed = offlineQueue.flush();
            expect(replayed).toEqual([]);
        });

        it('allows custom maxAge for flush', () => {
            const offlineQueue = createOfflineQueue();
            const thirtySecondsAgo = Date.now() - 30000;

            offlineQueue.queue.push({
                event: 'chat:message',
                data: { text: 'semi-old' },
                timestamp: thirtySecondsAgo,
            });

            // With a 10-second maxAge, the 30-second-old event should be expired
            const replayed = offlineQueue.flush(10000);
            expect(replayed).toHaveLength(0);
        });

        it('replays events just under the age limit', () => {
            const offlineQueue = createOfflineQueue();
            const justUnderTwoMinutes = Date.now() - (2 * 60 * 1000 - 100);

            offlineQueue.queue.push({
                event: 'game:endTurn',
                data: {},
                timestamp: justUnderTwoMinutes,
            });

            const replayed = offlineQueue.flush();
            expect(replayed).toHaveLength(1);
            expect(replayed[0].event).toBe('game:endTurn');
        });

        it('preserves event data through the queue and flush cycle', () => {
            const offlineQueue = createOfflineQueue();
            const chatData = { text: 'Hello world!', teamOnly: true };

            offlineQueue.queueIfOffline('chat:message', chatData);

            const replayed = offlineQueue.flush();
            expect(replayed[0].data).toEqual(chatData);
        });
    });

    // ─── Queue clear on leave ───────────────────────────────────────

    describe('queue clear behavior', () => {
        it('clear empties all queued events', () => {
            const offlineQueue = createOfflineQueue();

            offlineQueue.queueIfOffline('chat:message', { text: 'msg1' });
            offlineQueue.queueIfOffline('chat:message', { text: 'msg2' });
            expect(offlineQueue.queue).toHaveLength(2);

            offlineQueue.clear();
            expect(offlineQueue.queue).toHaveLength(0);
        });

        it('allows queuing new events after clear', () => {
            const offlineQueue = createOfflineQueue();

            offlineQueue.queueIfOffline('chat:message', { text: 'msg1' });
            offlineQueue.clear();
            offlineQueue.queueIfOffline('chat:message', { text: 'msg2' });

            expect(offlineQueue.queue).toHaveLength(1);
            expect(offlineQueue.queue[0].data.text).toBe('msg2');
        });
    });
});
