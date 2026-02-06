/**
 * Audit Logging Service
 *
 * Records security-relevant actions for compliance and forensics.
 * Stores audit logs in Redis with configurable retention.
 */

/* eslint-disable @typescript-eslint/no-var-requires */
const logger = require('../utils/logger');
const { getRedis, isUsingMemoryMode } = require('../config/redis');
/* eslint-enable @typescript-eslint/no-var-requires */

/**
 * Severity levels for audit events
 */
export type AuditSeverity = 'critical' | 'high' | 'medium' | 'low';

/**
 * Audit event categories
 */
export type AuditCategory = 'admin' | 'security' | 'all';

/**
 * Audit log entry structure
 */
export interface AuditLogEntry {
    timestamp: string;
    event: string;
    actor: string;
    target: string | null;
    ip: string | null;
    metadata: Record<string, unknown>;
    severity: AuditSeverity;
}

/**
 * Details for logging an audit event
 */
export interface AuditEventDetails {
    actor?: string;
    target?: string;
    ip?: string;
    metadata?: Record<string, unknown>;
}

/**
 * Options for querying audit logs
 */
export interface AuditLogOptions {
    category?: AuditCategory;
    limit?: number;
    severity?: AuditSeverity | null;
}

/**
 * Audit summary statistics
 */
export interface AuditSummary {
    total: number;
    admin: number;
    security: number;
    bySeverity: Record<string, number>;
    error?: string;
}

/**
 * Redis client type (simplified for migration)
 */
interface RedisClient {
    lPush(key: string, value: string): Promise<number>;
    lTrim(key: string, start: number, stop: number): Promise<string>;
    lRange(key: string, start: number, stop: number): Promise<string[]>;
    lLen(key: string): Promise<number>;
    expire(key: string, seconds: number): Promise<number>;
}

// Audit event types
export const AUDIT_EVENTS = {
    // Admin actions
    ADMIN_LOGIN: 'admin.login',
    ADMIN_LOGIN_FAILED: 'admin.login_failed',
    ADMIN_ACTION: 'admin.action',
    ADMIN_ROOM_VIEW: 'admin.room_view',
    ADMIN_PLAYER_KICK: 'admin.player_kick',
    ADMIN_ROOM_DELETE: 'admin.room_delete',
    ADMIN_BROADCAST: 'admin.broadcast',

    // Security events
    RATE_LIMIT_HIT: 'security.rate_limit',
    AUTH_FAILURE: 'security.auth_failure',
    INVALID_TOKEN: 'security.invalid_token',
    SESSION_HIJACK_ATTEMPT: 'security.session_hijack',
    SUSPICIOUS_ACTIVITY: 'security.suspicious',

    // Room events
    ROOM_CREATED: 'room.created',
    ROOM_DELETED: 'room.deleted',
    PLAYER_KICKED: 'room.player_kicked',
    HOST_TRANSFERRED: 'room.host_transferred',

    // Game events
    GAME_STARTED: 'game.started',
    GAME_ENDED: 'game.ended',
    GAME_FORFEITED: 'game.forfeited'
} as const;

export type AuditEventType = typeof AUDIT_EVENTS[keyof typeof AUDIT_EVENTS];

// Audit log retention (7 days)
const AUDIT_LOG_TTL = 7 * 24 * 60 * 60;

// Maximum audit logs per category
const MAX_LOGS_PER_CATEGORY = 10000;

// Redis keys for audit logs
const AUDIT_KEY_PREFIX = 'audit';
const AUDIT_LOG_KEY = `${AUDIT_KEY_PREFIX}:log`;
const AUDIT_ADMIN_KEY = `${AUDIT_KEY_PREFIX}:admin`;
const AUDIT_SECURITY_KEY = `${AUDIT_KEY_PREFIX}:security`;

/**
 * Get severity level for an event
 */
function getSeverity(event: string): AuditSeverity {
    const criticalEvents: string[] = [
        AUDIT_EVENTS.SESSION_HIJACK_ATTEMPT,
        AUDIT_EVENTS.ADMIN_ROOM_DELETE
    ];

    const highEvents: string[] = [
        AUDIT_EVENTS.ADMIN_LOGIN_FAILED,
        AUDIT_EVENTS.AUTH_FAILURE,
        AUDIT_EVENTS.INVALID_TOKEN,
        AUDIT_EVENTS.SUSPICIOUS_ACTIVITY,
        AUDIT_EVENTS.ADMIN_PLAYER_KICK,
        AUDIT_EVENTS.ADMIN_BROADCAST
    ];

    const mediumEvents: string[] = [
        AUDIT_EVENTS.RATE_LIMIT_HIT,
        AUDIT_EVENTS.ADMIN_LOGIN,
        AUDIT_EVENTS.ADMIN_ACTION,
        AUDIT_EVENTS.PLAYER_KICKED
    ];

    if (criticalEvents.includes(event)) return 'critical';
    if (highEvents.includes(event)) return 'high';
    if (mediumEvents.includes(event)) return 'medium';
    return 'low';
}

/**
 * Get Redis list key for event type
 */
function getAuditListKey(event: string): string {
    if (event.startsWith('admin.')) return AUDIT_ADMIN_KEY;
    if (event.startsWith('security.')) return AUDIT_SECURITY_KEY;
    return AUDIT_LOG_KEY;
}

/**
 * Record an audit event
 */
export async function logAuditEvent(
    event: string,
    details: AuditEventDetails = {}
): Promise<void> {
    const timestamp = new Date().toISOString();
    const logEntry: AuditLogEntry = {
        timestamp,
        event,
        actor: details.actor || 'unknown',
        target: details.target || null,
        ip: details.ip || null,
        metadata: details.metadata || {},
        severity: getSeverity(event)
    };

    // Always log to structured logger
    const logLevel = logEntry.severity === 'critical' ? 'error' :
        logEntry.severity === 'high' ? 'warn' : 'info';

    logger[logLevel]('Audit event', {
        audit: true,
        ...logEntry
    });

    // Store in Redis for queryability (if available)
    try {
        if (!isUsingMemoryMode()) {
            const redis: RedisClient = getRedis();
            const logJson = JSON.stringify(logEntry);

            // Store in appropriate lists based on event type
            const listKey = getAuditListKey(event);
            await redis.lPush(listKey, logJson);
            await redis.lTrim(listKey, 0, MAX_LOGS_PER_CATEGORY - 1);
            await redis.expire(listKey, AUDIT_LOG_TTL);

            // Also store in main audit log
            await redis.lPush(AUDIT_LOG_KEY, logJson);
            await redis.lTrim(AUDIT_LOG_KEY, 0, MAX_LOGS_PER_CATEGORY - 1);
            await redis.expire(AUDIT_LOG_KEY, AUDIT_LOG_TTL);
        }
    } catch (error) {
        // Don't fail if audit storage fails, but log the error
        logger.error('Failed to store audit log', {
            error: (error as Error).message,
            event,
            actor: details.actor
        });
    }
}

/**
 * Get recent audit logs
 */
export async function getAuditLogs(options: AuditLogOptions = {}): Promise<AuditLogEntry[]> {
    const { category = 'all', limit = 100, severity = null } = options;

    try {
        if (isUsingMemoryMode()) {
            return [];
        }

        const redis: RedisClient = getRedis();
        let key = AUDIT_LOG_KEY;

        if (category === 'admin') key = AUDIT_ADMIN_KEY;
        else if (category === 'security') key = AUDIT_SECURITY_KEY;

        const logs = await redis.lRange(key, 0, limit - 1);
        let parsed: AuditLogEntry[] = logs.map(log => {
            try {
                return JSON.parse(log) as AuditLogEntry;
            } catch {
                return null;
            }
        }).filter((entry): entry is AuditLogEntry => entry !== null);

        // Filter by severity if specified
        if (severity) {
            parsed = parsed.filter(log => log.severity === severity);
        }

        return parsed;
    } catch (error) {
        logger.error('Failed to retrieve audit logs', { error: (error as Error).message });
        return [];
    }
}

/**
 * Get audit summary statistics
 */
export async function getAuditSummary(): Promise<AuditSummary> {
    try {
        if (isUsingMemoryMode()) {
            return {
                total: 0,
                admin: 0,
                security: 0,
                bySeverity: {}
            };
        }

        const redis: RedisClient = getRedis();
        const [total, admin, security] = await Promise.all([
            redis.lLen(AUDIT_LOG_KEY),
            redis.lLen(AUDIT_ADMIN_KEY),
            redis.lLen(AUDIT_SECURITY_KEY)
        ]);

        // Get recent logs to calculate severity breakdown
        const recentLogs = await getAuditLogs({ limit: 1000 });
        const bySeverity = recentLogs.reduce<Record<string, number>>((acc, log) => {
            acc[log.severity] = (acc[log.severity] || 0) + 1;
            return acc;
        }, {});

        return {
            total,
            admin,
            security,
            bySeverity
        };
    } catch (error) {
        logger.error('Failed to get audit summary', { error: (error as Error).message });
        return {
            total: 0,
            admin: 0,
            security: 0,
            bySeverity: {},
            error: (error as Error).message
        };
    }
}

// Convenience functions for common audit events
export const audit = {
    /**
     * Log admin login
     */
    adminLogin: (ip: string, success: boolean = true): Promise<void> => {
        return logAuditEvent(
            success ? AUDIT_EVENTS.ADMIN_LOGIN : AUDIT_EVENTS.ADMIN_LOGIN_FAILED,
            { actor: 'admin', ip, metadata: { success } }
        );
    },

    /**
     * Log admin action
     */
    adminAction: (
        action: string,
        target: string,
        ip: string,
        metadata: Record<string, unknown> = {}
    ): Promise<void> => {
        return logAuditEvent(AUDIT_EVENTS.ADMIN_ACTION, {
            actor: 'admin',
            target,
            ip,
            metadata: { action, ...metadata }
        });
    },

    /**
     * Log player kick by admin
     */
    adminKickPlayer: (
        roomCode: string,
        playerId: string,
        ip: string,
        reason: string
    ): Promise<void> => {
        return logAuditEvent(AUDIT_EVENTS.ADMIN_PLAYER_KICK, {
            actor: 'admin',
            target: `${roomCode}/${playerId}`,
            ip,
            metadata: { roomCode, playerId, reason }
        });
    },

    /**
     * Log room deletion by admin
     */
    adminDeleteRoom: (roomCode: string, ip: string, reason: string): Promise<void> => {
        return logAuditEvent(AUDIT_EVENTS.ADMIN_ROOM_DELETE, {
            actor: 'admin',
            target: roomCode,
            ip,
            metadata: { reason }
        });
    },

    /**
     * Log rate limit hit
     */
    rateLimitHit: (event: string, identifier: string, ip: string): Promise<void> => {
        return logAuditEvent(AUDIT_EVENTS.RATE_LIMIT_HIT, {
            actor: identifier,
            ip,
            metadata: { event, identifier }
        });
    },

    /**
     * Log authentication failure
     */
    authFailure: (
        reason: string,
        ip: string,
        metadata: Record<string, unknown> = {}
    ): Promise<void> => {
        return logAuditEvent(AUDIT_EVENTS.AUTH_FAILURE, {
            actor: 'unknown',
            ip,
            metadata: { reason, ...metadata }
        });
    },

    /**
     * Log suspicious activity
     */
    suspicious: (
        description: string,
        actor: string,
        ip: string,
        metadata: Record<string, unknown> = {}
    ): Promise<void> => {
        return logAuditEvent(AUDIT_EVENTS.SUSPICIOUS_ACTIVITY, {
            actor,
            ip,
            metadata: { description, ...metadata }
        });
    },

    /**
     * Log room creation
     */
    roomCreated: (roomCode: string, hostSessionId: string, ip: string): Promise<void> => {
        return logAuditEvent(AUDIT_EVENTS.ROOM_CREATED, {
            actor: hostSessionId,
            target: roomCode,
            ip
        });
    },

    /**
     * Log player kick
     */
    playerKicked: (
        roomCode: string,
        kickedBy: string,
        kickedPlayer: string,
        reason: string
    ): Promise<void> => {
        return logAuditEvent(AUDIT_EVENTS.PLAYER_KICKED, {
            actor: kickedBy,
            target: `${roomCode}/${kickedPlayer}`,
            metadata: { roomCode, kickedPlayer, reason }
        });
    }
};

// CommonJS exports for compatibility
module.exports = {
    AUDIT_EVENTS,
    logAuditEvent,
    getAuditLogs,
    getAuditSummary,
    audit
};
