/**
 * Audit Logging for Sensitive Operations
 *
 * ISSUE #70 FIX: Provides detailed logging for security-sensitive operations
 * to enable security auditing and incident investigation.
 *
 * Operations logged:
 * - Host transfers
 * - Role changes (especially spymaster)
 * - Player kicks/bans
 * - Game start/end
 * - Word list modifications
 */

const logger = require('./logger');
const { getCorrelationId } = require('./correlationId');

// Instance ID for distributed deployments
const instanceId: string = process.env.FLY_ALLOC_ID || process.env.INSTANCE_ID || 'local';

/**
 * Audit event types
 */
const AUDIT_EVENTS = {
    // Room events
    ROOM_CREATED: 'ROOM_CREATED',
    ROOM_SETTINGS_CHANGED: 'ROOM_SETTINGS_CHANGED',
    ROOM_DELETED: 'ROOM_DELETED',

    // Player events
    PLAYER_JOINED: 'PLAYER_JOINED',
    PLAYER_LEFT: 'PLAYER_LEFT',
    PLAYER_KICKED: 'PLAYER_KICKED',
    HOST_TRANSFERRED: 'HOST_TRANSFERRED',

    // Role events
    ROLE_CHANGED: 'ROLE_CHANGED',
    SPYMASTER_ASSIGNED: 'SPYMASTER_ASSIGNED',
    TEAM_CHANGED: 'TEAM_CHANGED',

    // Game events
    GAME_STARTED: 'GAME_STARTED',
    GAME_ENDED: 'GAME_ENDED',
    GAME_FORFEITED: 'GAME_FORFEITED',

    // Word list events
    WORD_LIST_CREATED: 'WORD_LIST_CREATED',
    WORD_LIST_MODIFIED: 'WORD_LIST_MODIFIED',
    WORD_LIST_DELETED: 'WORD_LIST_DELETED',

    // Security events
    SESSION_HIJACK_BLOCKED: 'SESSION_HIJACK_BLOCKED',
    RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
    VALIDATION_FAILED: 'VALIDATION_FAILED',
    IP_MISMATCH_DETECTED: 'IP_MISMATCH_DETECTED'
} as const;

type AuditEventType = typeof AUDIT_EVENTS[keyof typeof AUDIT_EVENTS];

/**
 * Audit entry details interface
 */
interface AuditDetails {
    roomCode?: string;
    sessionId?: string;
    ip?: string;
    nickname?: string;
    metadata?: Record<string, unknown>;
}

/**
 * Audit entry interface
 */
interface AuditEntry extends AuditDetails {
    type: 'AUDIT';
    event: AuditEventType;
    timestamp: string;
    correlationId: string;
    instanceId: string;
}

/**
 * Log an audit event
 * @param event - Event type from AUDIT_EVENTS
 * @param details - Event details
 */
function audit(event: AuditEventType, details: AuditDetails = {}): AuditEntry {
    const entry: AuditEntry = {
        type: 'AUDIT',
        event,
        timestamp: new Date().toISOString(),
        correlationId: getCorrelationId() || 'unknown',
        instanceId,
        ...details
    };

    // Log at info level - audit logs should always be visible
    logger.info(`AUDIT: ${event}`, entry);

    return entry;
}

// Convenience functions for common audit events

/**
 * Log host transfer
 */
function auditHostTransferred(
    roomCode: string,
    fromSessionId: string,
    toSessionId: string,
    reason: string,
    ip?: string
): AuditEntry {
    return audit(AUDIT_EVENTS.HOST_TRANSFERRED, {
        roomCode,
        sessionId: fromSessionId,
        ip,
        metadata: {
            fromSessionId,
            toSessionId,
            reason
        }
    });
}

/**
 * Log spymaster assignment
 */
function auditSpymasterAssigned(
    roomCode: string,
    sessionId: string,
    nickname: string,
    team: string,
    ip?: string
): AuditEntry {
    return audit(AUDIT_EVENTS.SPYMASTER_ASSIGNED, {
        roomCode,
        sessionId,
        nickname,
        ip,
        metadata: { team }
    });
}

/**
 * Log role change
 */
function auditRoleChanged(
    roomCode: string,
    sessionId: string,
    nickname: string,
    oldRole: string,
    newRole: string,
    ip?: string
): AuditEntry {
    return audit(AUDIT_EVENTS.ROLE_CHANGED, {
        roomCode,
        sessionId,
        nickname,
        ip,
        metadata: { oldRole, newRole }
    });
}

/**
 * Log game start
 */
function auditGameStarted(
    roomCode: string,
    sessionId: string,
    playerCount: number,
    ip?: string
): AuditEntry {
    return audit(AUDIT_EVENTS.GAME_STARTED, {
        roomCode,
        sessionId,
        ip,
        metadata: { playerCount }
    });
}

/**
 * Log game end
 * @param roomCode - Room code
 * @param sessionId - Session ID of player who triggered game end (optional for timeouts)
 * @param ip - IP address of player (optional)
 * @param winner - Winning team
 * @param endReason - Reason game ended
 * @param duration - Game duration in seconds (optional)
 */
function auditGameEnded(
    roomCode: string,
    sessionId: string | undefined,
    ip: string | undefined,
    winner: string,
    endReason: string,
    duration?: number
): AuditEntry {
    return audit(AUDIT_EVENTS.GAME_ENDED, {
        roomCode,
        sessionId,
        ip,
        metadata: { winner, endReason, duration }
    });
}

/**
 * Log session hijack blocked
 */
function auditSessionHijackBlocked(
    sessionId: string,
    ip: string,
    attemptedFromIP: string
): AuditEntry {
    return audit(AUDIT_EVENTS.SESSION_HIJACK_BLOCKED, {
        sessionId,
        ip: attemptedFromIP,
        metadata: { originalIP: ip }
    });
}

/**
 * Log rate limit exceeded
 */
function auditRateLimitExceeded(
    sessionId: string,
    ip: string,
    event: string,
    attempts: number
): AuditEntry {
    return audit(AUDIT_EVENTS.RATE_LIMIT_EXCEEDED, {
        sessionId,
        ip,
        metadata: { event, attempts }
    });
}

/**
 * Log player kicked
 */
function auditPlayerKicked(
    roomCode: string,
    kickedSessionId: string,
    kickedBy: string,
    reason: string,
    ip?: string
): AuditEntry {
    return audit(AUDIT_EVENTS.PLAYER_KICKED, {
        roomCode,
        sessionId: kickedBy,
        ip,
        metadata: { kickedSessionId, reason }
    });
}

/**
 * Log word list modification
 */
function auditWordListModified(
    wordListId: string,
    action: 'create' | 'delete' | 'modify',
    sessionId: string,
    ip?: string
): AuditEntry {
    const eventType = action === 'create' ? AUDIT_EVENTS.WORD_LIST_CREATED
        : action === 'delete' ? AUDIT_EVENTS.WORD_LIST_DELETED
            : AUDIT_EVENTS.WORD_LIST_MODIFIED;
    return audit(eventType, {
        sessionId,
        ip,
        metadata: { wordListId, action }
    });
}

module.exports = {
    AUDIT_EVENTS,
    audit,
    // Convenience functions
    auditHostTransferred,
    auditSpymasterAssigned,
    auditRoleChanged,
    auditGameStarted,
    auditGameEnded,
    auditSessionHijackBlocked,
    auditRateLimitExceeded,
    auditPlayerKicked,
    auditWordListModified
};

// ES6 exports for TypeScript imports
export {
    AUDIT_EVENTS,
    audit,
    auditHostTransferred,
    auditSpymasterAssigned,
    auditRoleChanged,
    auditGameStarted,
    auditGameEnded,
    auditSessionHijackBlocked,
    auditRateLimitExceeded,
    auditPlayerKicked,
    auditWordListModified
};

export type { AuditEventType, AuditDetails, AuditEntry };
