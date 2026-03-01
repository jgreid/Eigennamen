/**
 * Audit Logging Tests
 */

const { AUDIT_EVENTS, audit } = require('../../utils/audit');

// Mock the logger
jest.mock('../../utils/logger', () => ({
    info: jest.fn(),
}));

// Mock correlationId
jest.mock('../../utils/correlationId', () => ({
    getCorrelationId: jest.fn().mockReturnValue('test-correlation-id'),
}));

const logger = require('../../utils/logger');

describe('Audit Logging', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('AUDIT_EVENTS', () => {
        test('contains expected event types', () => {
            expect(AUDIT_EVENTS.GAME_STARTED).toBe('GAME_STARTED');
            expect(AUDIT_EVENTS.GAME_ENDED).toBe('GAME_ENDED');
        });

        test('contains only 2 events', () => {
            expect(Object.keys(AUDIT_EVENTS)).toHaveLength(2);
        });
    });

    describe('audit()', () => {
        test('logs audit event with required fields', () => {
            const result = audit(AUDIT_EVENTS.GAME_STARTED, {
                roomCode: 'ABCDEF',
                sessionId: 'session-123',
            });

            expect(result.type).toBe('AUDIT');
            expect(result.event).toBe('GAME_STARTED');
            expect(result.timestamp).toBeDefined();
            expect(result.correlationId).toBe('test-correlation-id');
            expect(result.instanceId).toBeDefined();
            expect(result.roomCode).toBe('ABCDEF');
            expect(result.sessionId).toBe('session-123');

            expect(logger.info).toHaveBeenCalledWith('AUDIT: GAME_STARTED', expect.any(Object));
        });

        test('handles empty details', () => {
            const result = audit(AUDIT_EVENTS.GAME_ENDED);
            expect(result.event).toBe('GAME_ENDED');
            expect(logger.info).toHaveBeenCalled();
        });

        test('includes metadata in log', () => {
            const result = audit(AUDIT_EVENTS.GAME_ENDED, {
                roomCode: 'XYZABC',
                metadata: { winner: 'red', duration: 300 },
            });

            expect(result.metadata.winner).toBe('red');
            expect(result.metadata.duration).toBe(300);
        });
    });
});
