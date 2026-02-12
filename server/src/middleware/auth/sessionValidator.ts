/**
 * Session Validation
 *
 * Handles session lifecycle validation:
 *   - Rate limiting validation attempts by IP (Redis + in-memory fallback)
 *   - Session age checks
 *   - IP consistency verification
 *   - Reconnection token validation
 *   - Session ID resolution from handshake auth params
 */

import type { Player } from '../../types';

const { validate: isValidUuid } = require('uuid');
const logger = require('../../utils/logger');
const playerService = require('../../services/playerService');
const { getRedis } = require('../../config/redis');
const {
    SESSION_SECURITY,
    REDIS_TTL,
    ERROR_CODES
} = require('../../config/constants');

/**
 * Rate limit check result
 */
interface RateLimitResult {
    allowed: boolean;
    attempts: number;
}

/**
 * Session age validation result
 */
interface SessionAgeResult {
    valid: boolean;
    reason?: string;
}

/**
 * IP validation result
 */
interface IPValidationResult {
    valid: boolean;
    ipMismatch: boolean;
}

/**
 * Session validation result
 */
interface SessionValidationResult {
    valid: boolean;
    player?: Player;
    reason?: string;
    ipMismatch?: boolean;
}

/**
 * Session resolution result (internal)
 */
interface SessionResolutionResult {
    validatedSessionId: string | null;
    sessionValidation: SessionValidationResult | null;
    ipMismatch: boolean;
}

// ─── In-Memory Rate Limit Fallback ──────────────────────────────────

/**
 * In-memory rate limit fallback when Redis is unavailable.
 * Uses a simple Map with periodic cleanup to prevent unbounded growth.
 * This ensures rate limiting is never fully bypassed during Redis outages.
 */
const memoryRateLimits = new Map<string, { count: number; expiresAt: number }>();
const MEMORY_RATE_LIMIT_CLEANUP_INTERVAL = 60_000; // 1 minute
let memoryRateLimitCleanupTimer: ReturnType<typeof setInterval> | null = null;

function ensureMemoryRateLimitCleanup(): void {
    if (memoryRateLimitCleanupTimer) return;
    memoryRateLimitCleanupTimer = setInterval(() => {
        const now = Date.now();
        for (const [key, entry] of memoryRateLimits) {
            if (entry.expiresAt <= now) {
                memoryRateLimits.delete(key);
            }
        }
    }, MEMORY_RATE_LIMIT_CLEANUP_INTERVAL);
    // Don't block process exit
    if (memoryRateLimitCleanupTimer.unref) {
        memoryRateLimitCleanupTimer.unref();
    }
}

function checkMemoryRateLimit(clientIP: string): RateLimitResult {
    ensureMemoryRateLimitCleanup();
    const now = Date.now();
    const windowMs = REDIS_TTL.SESSION_VALIDATION_WINDOW * 1000;
    const key = `session:validation:${clientIP}`;
    const entry = memoryRateLimits.get(key);

    if (!entry || entry.expiresAt <= now) {
        memoryRateLimits.set(key, { count: 1, expiresAt: now + windowMs });
        return { allowed: true, attempts: 1 };
    }

    entry.count++;
    const maxAttempts = SESSION_SECURITY.MAX_VALIDATION_ATTEMPTS_PER_IP;
    if (entry.count > maxAttempts) {
        logger.warn('Session validation rate limited (in-memory fallback)', {
            clientIP,
            attempts: entry.count,
            maxAttempts
        });
        return { allowed: false, attempts: entry.count };
    }
    return { allowed: true, attempts: entry.count };
}

// ─── Redis Rate Limiting ────────────────────────────────────────────

/**
 * Rate limit session validation attempts by IP
 * Prevents brute-force session hijacking attempts
 * Falls back to in-memory rate limiting when Redis is unavailable
 */
async function checkValidationRateLimit(clientIP: string): Promise<RateLimitResult> {
    const redis = getRedis();
    const key = `session:validation:${clientIP}`;

    try {
        // Atomic incr + expire using Lua to prevent race condition where
        // the key is incremented but never gets an expiry set (if Redis
        // crashes between incr and expire, or concurrent requests interleave)
        const ATOMIC_RATE_LIMIT_SCRIPT = `
            local key = KEYS[1]
            local ttl = tonumber(ARGV[1])
            local count = redis.call('INCR', key)
            if count == 1 then
                redis.call('EXPIRE', key, ttl)
            end
            return count
        `;
        const attempts = await redis.eval(ATOMIC_RATE_LIMIT_SCRIPT, {
            keys: [key],
            arguments: [REDIS_TTL.SESSION_VALIDATION_WINDOW.toString()]
        }) as number;

        const maxAttempts = SESSION_SECURITY.MAX_VALIDATION_ATTEMPTS_PER_IP;
        if (attempts > maxAttempts) {
            logger.warn('Session validation rate limited', {
                clientIP,
                attempts,
                maxAttempts
            });
            return { allowed: false, attempts };
        }

        return { allowed: true, attempts };
    } catch (error) {
        // Redis failed — always enforce rate limiting via in-memory fallback
        logger.error('Rate limit Redis check failed, using in-memory fallback:', (error as Error).message);
        return checkMemoryRateLimit(clientIP);
    }
}

// ─── Session Validation ─────────────────────────────────────────────

/**
 * Validate session age
 */
function validateSessionAge(player: Player): SessionAgeResult {
    // Use only createdAt for session age. connectedAt is updated on every
    // reconnection, so using it as fallback would allow frequent reconnectors
    // to bypass the session age limit indefinitely.
    const createdAt = player.createdAt;
    if (!createdAt) {
        // No creation timestamp — likely a legacy session created before
        // createdAt was tracked. Allow but log for visibility.
        logger.debug('Session has no createdAt timestamp', { sessionId: player.sessionId });
        return { valid: true };
    }

    const sessionAge = Date.now() - createdAt;
    if (sessionAge > SESSION_SECURITY.MAX_SESSION_AGE_MS) {
        return {
            valid: false,
            reason: ERROR_CODES.SESSION_EXPIRED
        };
    }

    return { valid: true };
}

/**
 * Validate IP consistency for session reconnection
 */
function validateIPConsistency(player: Player, currentIP: string): IPValidationResult {
    if (!player.lastIP) {
        // No previous IP recorded - allow
        return { valid: true, ipMismatch: false };
    }

    if (player.lastIP !== currentIP) {
        logger.warn('IP mismatch on session reconnection', {
            sessionId: player.sessionId,
            previousIP: player.lastIP,
            currentIP,
            nickname: player.nickname,
            roomCode: player.roomCode
        });

        if (SESSION_SECURITY.IP_MISMATCH_ALLOWED) {
            // Allow but flag for monitoring
            return { valid: true, ipMismatch: true };
        }

        return { valid: false, ipMismatch: true };
    }

    return { valid: true, ipMismatch: false };
}

/**
 * Comprehensive session validation
 */
async function validateSession(sessionId: string, clientIP: string): Promise<SessionValidationResult> {
    // Check rate limit first
    const rateLimit = await checkValidationRateLimit(clientIP);
    if (!rateLimit.allowed) {
        return {
            valid: false,
            reason: ERROR_CODES.SESSION_VALIDATION_RATE_LIMITED
        };
    }

    // Get player data
    const player: Player | null = await playerService.getPlayer(sessionId);
    if (!player) {
        return {
            valid: false,
            reason: ERROR_CODES.SESSION_NOT_FOUND
        };
    }

    // Validate session age
    const ageValidation = validateSessionAge(player);
    if (!ageValidation.valid) {
        return {
            valid: false,
            reason: ageValidation.reason
        };
    }

    // Validate IP consistency
    const ipValidation = validateIPConsistency(player, clientIP);
    if (!ipValidation.valid) {
        return {
            valid: false,
            reason: ERROR_CODES.NOT_AUTHORIZED
        };
    }

    return {
        valid: true,
        player,
        ipMismatch: ipValidation.ipMismatch
    };
}

// ─── Reconnection Token ─────────────────────────────────────────────

/**
 * Validate reconnection token format and value.
 * Returns true if the token is valid (or absent but accepted by playerService).
 * Returns false if the token has an invalid format or fails validation.
 */
async function validateRoomReconnectToken(
    sessionId: string,
    reconnectToken: string | undefined,
    currentIP: string
): Promise<boolean> {
    // Validate token format before processing
    // Reconnection tokens are hex-encoded, so length should be 64 chars (32 bytes * 2)
    const expectedTokenLength = (SESSION_SECURITY.RECONNECTION_TOKEN_LENGTH || 32) * 2;
    const isValidFormat = !reconnectToken ||
        (typeof reconnectToken === 'string' &&
         reconnectToken.length === expectedTokenLength &&
         /^[0-9a-f]+$/i.test(reconnectToken));

    if (reconnectToken && !isValidFormat) {
        logger.warn('Invalid reconnection token format', {
            sessionId,
            tokenLength: reconnectToken?.length,
            expectedLength: expectedTokenLength,
            clientIP: currentIP
        });
        return false;
    }

    // Validate token value via playerService
    const tokenValid: boolean = await playerService.validateSocketAuthToken(sessionId, reconnectToken);

    if (!tokenValid) {
        logger.warn('Reconnection token validation failed', {
            sessionId,
            hasToken: !!reconnectToken,
            clientIP: currentIP
        });
        return false;
    }

    return true;
}

// ─── Session Resolution ─────────────────────────────────────────────

/**
 * Resolve session ID from handshake auth params.
 * Validates existing sessions, checks for hijacking attempts,
 * and verifies reconnection tokens. Uses early returns to keep nesting flat.
 */
async function resolveSessionId(
    auth: { sessionId?: string; token?: string; reconnectToken?: string },
    currentIP: string
): Promise<SessionResolutionResult> {
    const { sessionId } = auth;
    const noSession: SessionResolutionResult = { validatedSessionId: null, sessionValidation: null, ipMismatch: false };

    // No session ID provided - will generate a new one
    if (!sessionId) {
        return noSession;
    }

    // Validate session ID format (must be valid UUID)
    if (!isValidUuid(sessionId)) {
        logger.warn('Invalid session ID format rejected', {
            sessionId: sessionId.substring(0, 10) + '...',
            clientIP: currentIP
        });
        return noSession;
    }

    // Check if there's an existing player with this session
    const existingPlayer: Player | null = await playerService.getPlayer(sessionId);

    // No existing player - could be returning user or stale session
    // Allow it (session will be created fresh when they join a room)
    if (!existingPlayer) {
        return { validatedSessionId: sessionId, sessionValidation: null, ipMismatch: false };
    }

    // Player is currently connected - potential hijacking attempt
    // Generate new session instead of rejecting (more user-friendly)
    if (existingPlayer.connected) {
        logger.warn('Session hijacking attempt blocked', {
            sessionId,
            clientIP: currentIP
        });
        return noSession;
    }

    // Disconnected player - perform full session validation
    const sessionValidation = await validateSession(sessionId, currentIP);

    if (!sessionValidation.valid) {
        logger.warn('Session validation failed', {
            sessionId,
            reason: sessionValidation.reason,
            clientIP: currentIP
        });
        return { validatedSessionId: null, sessionValidation, ipMismatch: false };
    }

    // Validate reconnection token (ISSUE #17 FIX)
    const tokenValid = await validateRoomReconnectToken(sessionId, auth.reconnectToken, currentIP);

    if (!tokenValid) {
        // Token invalid - generate new session
        return { validatedSessionId: null, sessionValidation, ipMismatch: false };
    }

    logger.debug('Session validated for reconnection with token', {
        sessionId,
        ipMismatch: sessionValidation.ipMismatch
    });

    return {
        validatedSessionId: sessionId,
        sessionValidation,
        ipMismatch: !!sessionValidation.ipMismatch
    };
}

module.exports = {
    validateSession,
    resolveSessionId,
    validateSessionAge,
    validateIPConsistency,
    validateRoomReconnectToken,
    checkValidationRateLimit
};

export {
    validateSession,
    resolveSessionId,
    validateSessionAge,
    validateIPConsistency,
    validateRoomReconnectToken,
    checkValidationRateLimit
};

export type { SessionValidationResult, SessionResolutionResult, RateLimitResult };
