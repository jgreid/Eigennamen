/**
 * Audit Logging for Sensitive Operations
 *
 * ISSUE #70 FIX: Provides detailed logging for security-sensitive operations
 * to enable security auditing and incident investigation.
 *
 * Operations logged:
 * - Room password changes
 * - Host transfers
 * - Role changes (especially spymaster)
 * - Player kicks/bans
 * - Game start/end
 * - Word list modifications
 */

const logger = require('./logger');
const { getCorrelationId } = require('./correlationId');

// Instance ID for distributed deployments
const instanceId = process.env.FLY_ALLOC_ID || process.env.INSTANCE_ID || 'local';

/**
 * Audit event types
 */
const AUDIT_EVENTS = {
    // Room events
    ROOM_CREATED: 'ROOM_CREATED',
    ROOM_PASSWORD_CHANGED: 'ROOM_PASSWORD_CHANGED',
    ROOM_PASSWORD_REMOVED: 'ROOM_PASSWORD_REMOVED',
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
};

/**
 * Log an audit event
 * @param {string} event - Event type from AUDIT_EVENTS
 * @param {Object} details - Event details
 * @param {string} details.roomCode - Room code (if applicable)
 * @param {string} details.sessionId - Session ID of the actor
 * @param {string} details.ip - IP address of the actor
 * @param {string} details.nickname - Nickname of the actor
 * @param {Object} details.metadata - Additional event-specific data
 */
function audit(event, details = {}) {
    const entry = {
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
 * Log room password change
 */
function auditPasswordChanged(roomCode, sessionId, ip, wasSet) {
    return audit(wasSet ? AUDIT_EVENTS.ROOM_PASSWORD_CHANGED : AUDIT_EVENTS.ROOM_PASSWORD_REMOVED, {
        roomCode,
        sessionId,
        ip,
        metadata: { wasSet }
    });
}

/**
 * Log host transfer
 */
function auditHostTransferred(roomCode, fromSessionId, toSessionId, reason, ip) {
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
function auditSpymasterAssigned(roomCode, sessionId, nickname, team, ip) {
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
function auditRoleChanged(roomCode, sessionId, nickname, oldRole, newRole, ip) {
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
function auditGameStarted(roomCode, sessionId, playerCount, ip) {
    return audit(AUDIT_EVENTS.GAME_STARTED, {
        roomCode,
        sessionId,
        ip,
        metadata: { playerCount }
    });
}

/**
 * Log game end
 */
function auditGameEnded(roomCode, winner, endReason, duration) {
    return audit(AUDIT_EVENTS.GAME_ENDED, {
        roomCode,
        metadata: { winner, endReason, duration }
    });
}

/**
 * Log session hijack blocked
 */
function auditSessionHijackBlocked(sessionId, ip, attemptedFromIP) {
    return audit(AUDIT_EVENTS.SESSION_HIJACK_BLOCKED, {
        sessionId,
        ip: attemptedFromIP,
        metadata: { originalIP: ip }
    });
}

/**
 * Log rate limit exceeded
 */
function auditRateLimitExceeded(sessionId, ip, event, attempts) {
    return audit(AUDIT_EVENTS.RATE_LIMIT_EXCEEDED, {
        sessionId,
        ip,
        metadata: { event, attempts }
    });
}

/**
 * Log player kicked
 */
function auditPlayerKicked(roomCode, kickedSessionId, kickedBy, reason, ip) {
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
function auditWordListModified(wordListId, action, sessionId, ip) {
    const eventType = action === 'create' ? AUDIT_EVENTS.WORD_LIST_CREATED :
                      action === 'delete' ? AUDIT_EVENTS.WORD_LIST_DELETED :
                      AUDIT_EVENTS.WORD_LIST_MODIFIED;
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
};
