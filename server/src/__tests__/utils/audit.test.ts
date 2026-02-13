/**
 * Audit Logging Tests
 */

const {
    AUDIT_EVENTS,
    audit
} = require('../../utils/audit');

// Mock the logger
jest.mock('../../utils/logger', () => ({
    info: jest.fn()
}));

// Mock correlationId
jest.mock('../../utils/correlationId', () => ({
    getCorrelationId: jest.fn().mockReturnValue('test-correlation-id')
}));

const logger = require('../../utils/logger');

describe('Audit Logging', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('AUDIT_EVENTS', () => {
        test('contains all expected event types', () => {
            // Room events
            expect(AUDIT_EVENTS.ROOM_CREATED).toBe('ROOM_CREATED');
            expect(AUDIT_EVENTS.ROOM_SETTINGS_CHANGED).toBe('ROOM_SETTINGS_CHANGED');
            expect(AUDIT_EVENTS.ROOM_DELETED).toBe('ROOM_DELETED');

            // Player events
            expect(AUDIT_EVENTS.PLAYER_JOINED).toBe('PLAYER_JOINED');
            expect(AUDIT_EVENTS.PLAYER_LEFT).toBe('PLAYER_LEFT');
            expect(AUDIT_EVENTS.PLAYER_KICKED).toBe('PLAYER_KICKED');
            expect(AUDIT_EVENTS.HOST_TRANSFERRED).toBe('HOST_TRANSFERRED');

            // Role events
            expect(AUDIT_EVENTS.ROLE_CHANGED).toBe('ROLE_CHANGED');
            expect(AUDIT_EVENTS.SPYMASTER_ASSIGNED).toBe('SPYMASTER_ASSIGNED');
            expect(AUDIT_EVENTS.TEAM_CHANGED).toBe('TEAM_CHANGED');

            // Game events
            expect(AUDIT_EVENTS.GAME_STARTED).toBe('GAME_STARTED');
            expect(AUDIT_EVENTS.GAME_ENDED).toBe('GAME_ENDED');
            expect(AUDIT_EVENTS.GAME_FORFEITED).toBe('GAME_FORFEITED');

            // Word list events
            expect(AUDIT_EVENTS.WORD_LIST_CREATED).toBe('WORD_LIST_CREATED');
            expect(AUDIT_EVENTS.WORD_LIST_MODIFIED).toBe('WORD_LIST_MODIFIED');
            expect(AUDIT_EVENTS.WORD_LIST_DELETED).toBe('WORD_LIST_DELETED');

            // Security events
            expect(AUDIT_EVENTS.SESSION_HIJACK_BLOCKED).toBe('SESSION_HIJACK_BLOCKED');
            expect(AUDIT_EVENTS.RATE_LIMIT_EXCEEDED).toBe('RATE_LIMIT_EXCEEDED');
            expect(AUDIT_EVENTS.VALIDATION_FAILED).toBe('VALIDATION_FAILED');
            expect(AUDIT_EVENTS.IP_MISMATCH_DETECTED).toBe('IP_MISMATCH_DETECTED');
        });
    });

    describe('audit()', () => {
        test('logs audit event with required fields', () => {
            const result = audit(AUDIT_EVENTS.ROOM_CREATED, {
                roomCode: 'ABCDEF',
                sessionId: 'session-123'
            });

            expect(result.type).toBe('AUDIT');
            expect(result.event).toBe('ROOM_CREATED');
            expect(result.timestamp).toBeDefined();
            expect(result.correlationId).toBe('test-correlation-id');
            expect(result.instanceId).toBeDefined();
            expect(result.roomCode).toBe('ABCDEF');
            expect(result.sessionId).toBe('session-123');

            expect(logger.info).toHaveBeenCalledWith('AUDIT: ROOM_CREATED', expect.any(Object));
        });

        test('handles empty details', () => {
            const result = audit(AUDIT_EVENTS.ROOM_DELETED);
            expect(result.event).toBe('ROOM_DELETED');
            expect(logger.info).toHaveBeenCalled();
        });

        test('includes metadata in log', () => {
            const result = audit(AUDIT_EVENTS.GAME_ENDED, {
                roomCode: 'XYZABC',
                metadata: { winner: 'red', duration: 300 }
            });

            expect(result.metadata.winner).toBe('red');
            expect(result.metadata.duration).toBe(300);
        });
    });

    describe('audit HOST_TRANSFERRED', () => {
        test('logs host transfer with all details', () => {
            const result = audit(AUDIT_EVENTS.HOST_TRANSFERRED, {
                roomCode: 'ROOM03',
                sessionId: 'from-session',
                ip: '127.0.0.1',
                metadata: { fromSessionId: 'from-session', toSessionId: 'to-session', reason: 'manual' }
            });

            expect(result.event).toBe('HOST_TRANSFERRED');
            expect(result.roomCode).toBe('ROOM03');
            expect(result.sessionId).toBe('from-session');
            expect(result.ip).toBe('127.0.0.1');
            expect(result.metadata.fromSessionId).toBe('from-session');
            expect(result.metadata.toSessionId).toBe('to-session');
            expect(result.metadata.reason).toBe('manual');
        });
    });

    describe('audit SPYMASTER_ASSIGNED', () => {
        test('logs spymaster assignment', () => {
            const result = audit(AUDIT_EVENTS.SPYMASTER_ASSIGNED, {
                roomCode: 'ROOM04',
                sessionId: 'session-5',
                nickname: 'PlayerName',
                ip: '1.2.3.4',
                metadata: { team: 'red' }
            });

            expect(result.event).toBe('SPYMASTER_ASSIGNED');
            expect(result.roomCode).toBe('ROOM04');
            expect(result.sessionId).toBe('session-5');
            expect(result.nickname).toBe('PlayerName');
            expect(result.ip).toBe('1.2.3.4');
            expect(result.metadata.team).toBe('red');
        });
    });

    describe('audit ROLE_CHANGED', () => {
        test('logs role change', () => {
            const result = audit(AUDIT_EVENTS.ROLE_CHANGED, {
                roomCode: 'ROOM05',
                sessionId: 'session-6',
                nickname: 'Player2',
                ip: '5.6.7.8',
                metadata: { oldRole: 'clicker', newRole: 'spymaster' }
            });

            expect(result.event).toBe('ROLE_CHANGED');
            expect(result.roomCode).toBe('ROOM05');
            expect(result.sessionId).toBe('session-6');
            expect(result.nickname).toBe('Player2');
            expect(result.ip).toBe('5.6.7.8');
            expect(result.metadata.oldRole).toBe('clicker');
            expect(result.metadata.newRole).toBe('spymaster');
        });
    });

    describe('audit GAME_STARTED', () => {
        test('logs game start', () => {
            const result = audit(AUDIT_EVENTS.GAME_STARTED, {
                roomCode: 'ROOM06',
                sessionId: 'session-7',
                ip: '10.10.10.10',
                metadata: { playerCount: 6 }
            });

            expect(result.event).toBe('GAME_STARTED');
            expect(result.roomCode).toBe('ROOM06');
            expect(result.sessionId).toBe('session-7');
            expect(result.ip).toBe('10.10.10.10');
            expect(result.metadata.playerCount).toBe(6);
        });
    });

    describe('audit GAME_ENDED', () => {
        test('logs game end with all parameters', () => {
            const result = audit(AUDIT_EVENTS.GAME_ENDED, {
                roomCode: 'ROOM07',
                sessionId: 'session-8',
                ip: '11.11.11.11',
                metadata: { winner: 'blue', endReason: 'all_cards_found', duration: 450 }
            });

            expect(result.event).toBe('GAME_ENDED');
            expect(result.roomCode).toBe('ROOM07');
            expect(result.sessionId).toBe('session-8');
            expect(result.ip).toBe('11.11.11.11');
            expect(result.metadata.winner).toBe('blue');
            expect(result.metadata.endReason).toBe('all_cards_found');
            expect(result.metadata.duration).toBe(450);
        });

        test('logs game end with null optional fields', () => {
            const result = audit(AUDIT_EVENTS.GAME_ENDED, {
                roomCode: 'ROOM08',
                sessionId: null,
                ip: null,
                metadata: { winner: 'red', endReason: 'forfeit', duration: null }
            });

            expect(result.event).toBe('GAME_ENDED');
            expect(result.sessionId).toBeNull();
            expect(result.ip).toBeNull();
            expect(result.metadata.duration).toBeNull();
        });
    });

    describe('audit SESSION_HIJACK_BLOCKED', () => {
        test('logs session hijack attempt', () => {
            const result = audit(AUDIT_EVENTS.SESSION_HIJACK_BLOCKED, {
                sessionId: 'session-9',
                ip: '10.0.0.99',
                metadata: { originalIP: '192.168.1.1' }
            });

            expect(result.event).toBe('SESSION_HIJACK_BLOCKED');
            expect(result.sessionId).toBe('session-9');
            expect(result.ip).toBe('10.0.0.99');
            expect(result.metadata.originalIP).toBe('192.168.1.1');
        });
    });

    describe('audit RATE_LIMIT_EXCEEDED', () => {
        test('logs rate limit exceeded', () => {
            const result = audit(AUDIT_EVENTS.RATE_LIMIT_EXCEEDED, {
                sessionId: 'session-10',
                ip: '8.8.8.8',
                metadata: { event: 'room:create', attempts: 100 }
            });

            expect(result.event).toBe('RATE_LIMIT_EXCEEDED');
            expect(result.sessionId).toBe('session-10');
            expect(result.ip).toBe('8.8.8.8');
            expect(result.metadata.event).toBe('room:create');
            expect(result.metadata.attempts).toBe(100);
        });
    });

    describe('audit PLAYER_KICKED', () => {
        test('logs player kick', () => {
            const result = audit(AUDIT_EVENTS.PLAYER_KICKED, {
                roomCode: 'ROOM09',
                sessionId: 'host-session',
                ip: '1.1.1.1',
                metadata: { kickedSessionId: 'kicked-session', reason: 'disruptive behavior' }
            });

            expect(result.event).toBe('PLAYER_KICKED');
            expect(result.roomCode).toBe('ROOM09');
            expect(result.sessionId).toBe('host-session');
            expect(result.ip).toBe('1.1.1.1');
            expect(result.metadata.kickedSessionId).toBe('kicked-session');
            expect(result.metadata.reason).toBe('disruptive behavior');
        });
    });

    describe('audit WORD_LIST events', () => {
        test('logs word list creation', () => {
            const result = audit(AUDIT_EVENTS.WORD_LIST_CREATED, {
                sessionId: 'session-11',
                ip: '2.2.2.2',
                metadata: { wordListId: 'wordlist-123', action: 'create' }
            });

            expect(result.event).toBe('WORD_LIST_CREATED');
            expect(result.sessionId).toBe('session-11');
            expect(result.ip).toBe('2.2.2.2');
            expect(result.metadata.wordListId).toBe('wordlist-123');
            expect(result.metadata.action).toBe('create');
        });

        test('logs word list modification', () => {
            const result = audit(AUDIT_EVENTS.WORD_LIST_MODIFIED, {
                sessionId: 'session-12',
                ip: '3.3.3.3',
                metadata: { wordListId: 'wordlist-456', action: 'update' }
            });

            expect(result.event).toBe('WORD_LIST_MODIFIED');
        });

        test('logs word list deletion', () => {
            const result = audit(AUDIT_EVENTS.WORD_LIST_DELETED, {
                sessionId: 'session-13',
                ip: '4.4.4.4',
                metadata: { wordListId: 'wordlist-789', action: 'delete' }
            });

            expect(result.event).toBe('WORD_LIST_DELETED');
        });
    });
});
