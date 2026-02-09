/**
 * Event Log Service Coverage Tests
 *
 * Tests for the eventLogService stub to ensure all exported functions
 * are covered: logEvent, getEventsSince, getRecentEvents, clearEventLog, EVENT_TYPES
 */

describe('EventLogService Stub', () => {
    let eventLogService: typeof import('../services/eventLogService');

    beforeEach(() => {
        jest.resetModules();
        eventLogService = require('../services/eventLogService');
    });

    describe('EVENT_TYPES', () => {
        it('should export an empty object', () => {
            expect(eventLogService.EVENT_TYPES).toBeDefined();
            expect(Object.keys(eventLogService.EVENT_TYPES)).toHaveLength(0);
        });
    });

    describe('logEvent', () => {
        it('should be a no-op that resolves', async () => {
            await expect(
                eventLogService.logEvent('ROOM01', 'TEST_EVENT', { key: 'value' })
            ).resolves.toBeUndefined();
        });

        it('should accept any parameters', async () => {
            await expect(
                eventLogService.logEvent('', '', {})
            ).resolves.toBeUndefined();
        });
    });

    describe('getEventsSince', () => {
        it('should return an empty array', async () => {
            const events = await eventLogService.getEventsSince('ROOM01', Date.now());
            expect(events).toEqual([]);
        });

        it('should return empty array without timestamp', async () => {
            const events = await eventLogService.getEventsSince('ROOM01');
            expect(events).toEqual([]);
        });
    });

    describe('getRecentEvents', () => {
        it('should return an empty array', async () => {
            const events = await eventLogService.getRecentEvents('ROOM01', 10);
            expect(events).toEqual([]);
        });

        it('should return empty array without limit', async () => {
            const events = await eventLogService.getRecentEvents('ROOM01');
            expect(events).toEqual([]);
        });
    });

    describe('clearEventLog', () => {
        it('should be a no-op that resolves', async () => {
            await expect(
                eventLogService.clearEventLog('ROOM01')
            ).resolves.toBeUndefined();
        });
    });
});
