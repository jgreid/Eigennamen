import {
    NICKNAME_MIN_LENGTH,
    NICKNAME_MAX_LENGTH,
    TEAM_NAME_MAX_LENGTH,
    CHAT_MESSAGE_MAX_LENGTH,
    RESERVED_NAMES as SHARED_RESERVED_NAMES,
} from '../shared';
/**
 * Retry configuration
 */
export interface RetryConfig {
    maxRetries: number;
    baseDelayMs: number;
}

/**
 * Get reconnection token TTL from environment with bounds clamping.
 * @returns TTL in seconds, clamped to [60, 1800], default 300
 */
function getReconnectTokenTtl(): number {
    const raw = process.env.RECONNECT_TOKEN_TTL_SECONDS;
    const val = raw ? parseInt(raw, 10) : 300;
    return Math.max(60, Math.min(1800, Number.isFinite(val) ? val : 300));
}

// Session security configuration
export const SESSION_SECURITY = {
    MAX_SESSION_AGE_MS: 8 * 60 * 60 * 1000, // 8 hours max session lifetime (reduced from 24h for security)
    MAX_VALIDATION_ATTEMPTS_PER_IP: 20, // Max validation attempts per IP per minute
    IP_MISMATCH_ALLOWED: process.env.ALLOW_IP_MISMATCH === 'true', // Deny reconnection from different IP by default; set ALLOW_IP_MISMATCH=true to allow
    SESSION_ID_MIN_LENGTH: 36, // UUID length
    RECONNECTION_TOKEN_TTL_SECONDS: getReconnectTokenTtl(), // Configurable via RECONNECT_TOKEN_TTL_SECONDS env var (default 300, range 60-1800)
    RECONNECTION_TOKEN_LENGTH: 32, // Bytes for secure token
    ROTATE_SESSION_ON_RECONNECT: true, // Issue new session token after successful reconnection
} as const;

// Validation constraints — sourced from shared module, extended with backend-only fields
export const VALIDATION = {
    NICKNAME_MIN_LENGTH,
    NICKNAME_MAX_LENGTH,
    TEAM_NAME_MAX_LENGTH,
    CHAT_MESSAGE_MAX_LENGTH,
    WORD_MIN_LENGTH: 2,
    WORD_MAX_LENGTH: 30,
} as const;

// Re-export reserved names from shared module
export const RESERVED_NAMES = SHARED_RESERVED_NAMES;

// Lock timeouts (in seconds)
export const LOCKS = {
    SPYMASTER_ROLE: 5, // Lock for spymaster role assignment
    HOST_TRANSFER: 3, // Lock for host transfer (reduced from 10s - DB ops are fast)
    TIMER_RESTART: 5, // Lock for timer restart
    CARD_REVEAL: 15, // Lock for card reveal operation (longer due to retry logic)
    GAME_CREATE: 10, // Lock for game creation
} as const;

// Retry configuration (centralized for all retry operations)
export const RETRY_CONFIG = {
    OPTIMISTIC_LOCK: { maxRetries: 3, baseDelayMs: 100 },
    REDIS_OPERATION: { maxRetries: 3, baseDelayMs: 50 },
    DISTRIBUTED_LOCK: { maxRetries: 50, baseDelayMs: 100 },
    NETWORK_REQUEST: { maxRetries: 4, baseDelayMs: 2000 },
    RACE_CONDITION: { delayMs: 100 }, // Delay between race condition retries
} as const;
