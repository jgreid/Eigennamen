/**
 * Lightweight structured audit logging for game lifecycle events.
 * Logs to stdout via the logger (not Redis). For Redis-backed audit
 * logging (admin, security events), see services/auditService.ts.
 */

import logger from './logger';
import { getCorrelationId } from './correlationId';

// Instance ID for distributed deployments
const instanceId: string = process.env.FLY_ALLOC_ID || process.env.INSTANCE_ID || 'local';

/**
 * Audit event types (only events that are actually emitted)
 */
const AUDIT_EVENTS = {
    GAME_STARTED: 'GAME_STARTED',
    GAME_ENDED: 'GAME_ENDED'
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
