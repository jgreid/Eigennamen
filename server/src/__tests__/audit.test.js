/**
 * Audit Logging Tests
 */

const {
    AUDIT_EVENTS,
    audit,
    auditPasswordChanged,
    auditHostTransferred,
    auditSpymasterAssigned,
    auditRoleChanged,
    auditGameStarted,
    auditGameEnded,
    auditSessionHijackBlocked,
    auditRateLimitExceeded,
    auditPlayerKicked,
    auditWordListModified
} = require('../utils/audit');

// Mock the logger
jest.mock('../utils/logger', () => ({
    info: jest.fn()
}));

// Mock correlationId
jest.mock('../utils/correlationId', () => ({
    getCorrelationId: jest.fn().mockReturnValue('test-correlation-id')
}));

const logger = require('../utils/logger');

describe('Audit Logging', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('AUDIT_EVENTS', () => {
        test('contains all expected event types', () => {
            // Room events
            expect(AUDIT_EVENTS.ROOM_CREATED).toBe('ROOM_CREATED');
            expect(AUDIT_EVENTS.ROOM_PASSWORD_CHANGED).toBe('ROOM_PASSWORD_CHANGED');
            expect(AUDIT_EVENTS.ROOM_PASSWORD_REMOVED).toBe('ROOM_PASSWORD_REMOVED');
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

    describe('auditPasswordChanged()', () => {
        test('logs password set event', () => {
            const result = auditPasswordChanged('ROOM01', 'session-1', '192.168.1.1', true);

            expect(result.event).toBe('ROOM_PASSWORD_CHANGED');
            expect(result.roomCode).toBe('ROOM01');
            expect(result.sessionId).toBe('session-1');
            expect(result.ip).toBe('192.168.1.1');
            expect(result.metadata.wasSet).toBe(true);
        });

        test('logs password removed event', () => {
            const result = auditPasswordChanged('ROOM02', 'session-2', '10.0.0.1', false);

            expect(result.event).toBe('ROOM_PASSWORD_REMOVED');
            expect(result.metadata.wasSet).toBe(false);
        });
    });

    describe('auditHostTransferred()', () => {
        test('logs host transfer with all details', () => {
            const result = auditHostTransferred('ROOM03', 'from-session', 'to-session', 'manual', '127.0.0.1');

            expect(result.event).toBe('HOST_TRANSFERRED');
            expect(result.roomCode).toBe('ROOM03');
            expect(result.sessionId).toBe('from-session');
            expect(result.ip).toBe('127.0.0.1');
            expect(result.metadata.fromSessionId).toBe('from-session');
            expect(result.metadata.toSessionId).toBe('to-session');
            expect(result.metadata.reason).toBe('manual');
        });
    });

    describe('auditSpymasterAssigned()', () => {
        test('logs spymaster assignment', () => {
            const result = auditSpymasterAssigned('ROOM04', 'session-5', 'PlayerName', 'red', '1.2.3.4');

            expect(result.event).toBe('SPYMASTER_ASSIGNED');
            expect(result.roomCode).toBe('ROOM04');
            expect(result.sessionId).toBe('session-5');
            expect(result.nickname).toBe('PlayerName');
            expect(result.ip).toBe('1.2.3.4');
            expect(result.metadata.team).toBe('red');
        });
    });

    describe('auditRoleChanged()', () => {
        test('logs role change', () => {
            const result = auditRoleChanged('ROOM05', 'session-6', 'Player2', 'clicker', 'spymaster', '5.6.7.8');

            expect(result.event).toBe('ROLE_CHANGED');
            expect(result.roomCode).toBe('ROOM05');
            expect(result.sessionId).toBe('session-6');
            expect(result.nickname).toBe('Player2');
            expect(result.ip).toBe('5.6.7.8');
            expect(result.metadata.oldRole).toBe('clicker');
            expect(result.metadata.newRole).toBe('spymaster');
        });
    });

    describe('auditGameStarted()', () => {
        test('logs game start', () => {
            const result = auditGameStarted('ROOM06', 'session-7', 6, '10.10.10.10');

            expect(result.event).toBe('GAME_STARTED');
            expect(result.roomCode).toBe('ROOM06');
            expect(result.sessionId).toBe('session-7');
            expect(result.ip).toBe('10.10.10.10');
            expect(result.metadata.playerCount).toBe(6);
        });
    });

    describe('auditGameEnded()', () => {
        test('logs game end with all parameters', () => {
            const result = auditGameEnded('ROOM07', 'session-8', '11.11.11.11', 'blue', 'all_cards_found', 450);

            expect(result.event).toBe('GAME_ENDED');
            expect(result.roomCode).toBe('ROOM07');
            expect(result.sessionId).toBe('session-8');
            expect(result.ip).toBe('11.11.11.11');
            expect(result.metadata.winner).toBe('blue');
            expect(result.metadata.endReason).toBe('all_cards_found');
            expect(result.metadata.duration).toBe(450);
        });

        test('logs game end with null optional fields', () => {
            const result = auditGameEnded('ROOM08', null, null, 'red', 'forfeit', null);

            expect(result.event).toBe('GAME_ENDED');
            expect(result.sessionId).toBeNull();
            expect(result.ip).toBeNull();
            expect(result.metadata.duration).toBeNull();
        });
    });

    describe('auditSessionHijackBlocked()', () => {
        test('logs session hijack attempt', () => {
            const result = auditSessionHijackBlocked('session-9', '192.168.1.1', '10.0.0.99');

            expect(result.event).toBe('SESSION_HIJACK_BLOCKED');
            expect(result.sessionId).toBe('session-9');
            expect(result.ip).toBe('10.0.0.99');
            expect(result.metadata.originalIP).toBe('192.168.1.1');
        });
    });

    describe('auditRateLimitExceeded()', () => {
        test('logs rate limit exceeded', () => {
            const result = auditRateLimitExceeded('session-10', '8.8.8.8', 'room:create', 100);

            expect(result.event).toBe('RATE_LIMIT_EXCEEDED');
            expect(result.sessionId).toBe('session-10');
            expect(result.ip).toBe('8.8.8.8');
            expect(result.metadata.event).toBe('room:create');
            expect(result.metadata.attempts).toBe(100);
        });
    });

    describe('auditPlayerKicked()', () => {
        test('logs player kick', () => {
            const result = auditPlayerKicked('ROOM09', 'kicked-session', 'host-session', 'disruptive behavior', '1.1.1.1');

            expect(result.event).toBe('PLAYER_KICKED');
            expect(result.roomCode).toBe('ROOM09');
            expect(result.sessionId).toBe('host-session');
            expect(result.ip).toBe('1.1.1.1');
            expect(result.metadata.kickedSessionId).toBe('kicked-session');
            expect(result.metadata.reason).toBe('disruptive behavior');
        });
    });

    describe('auditWordListModified()', () => {
        test('logs word list creation', () => {
            const result = auditWordListModified('wordlist-123', 'create', 'session-11', '2.2.2.2');

            expect(result.event).toBe('WORD_LIST_CREATED');
            expect(result.sessionId).toBe('session-11');
            expect(result.ip).toBe('2.2.2.2');
            expect(result.metadata.wordListId).toBe('wordlist-123');
            expect(result.metadata.action).toBe('create');
        });

        test('logs word list modification', () => {
            const result = auditWordListModified('wordlist-456', 'update', 'session-12', '3.3.3.3');

            expect(result.event).toBe('WORD_LIST_MODIFIED');
        });

        test('logs word list deletion', () => {
            const result = auditWordListModified('wordlist-789', 'delete', 'session-13', '4.4.4.4');

            expect(result.event).toBe('WORD_LIST_DELETED');
        });
    });
});
