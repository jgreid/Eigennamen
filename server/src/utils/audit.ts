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

import logger from './logger';
import { getCorrelationId } from './correlationId';

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

export {
    AUDIT_EVENTS,
    audit
};

export type { AuditEventType, AuditDetails, AuditEntry };
