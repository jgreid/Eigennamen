/**
 * Security Configuration
 *
 * Session security, validation constraints, reserved names,
 * distributed locks, and retry configuration.
 */

/**
 * Retry configuration
 */
export interface RetryConfig {
    maxRetries: number;
    baseDelayMs: number;
}

// Session security configuration
export const SESSION_SECURITY = {
    MAX_SESSION_AGE_MS: 8 * 60 * 60 * 1000,      // 8 hours max session lifetime (reduced from 24h for security)
    MAX_VALIDATION_ATTEMPTS_PER_IP: 20,          // Max validation attempts per IP per minute
    IP_MISMATCH_ALLOWED: process.env.ALLOW_IP_MISMATCH === 'true',  // Deny reconnection from different IP by default; set ALLOW_IP_MISMATCH=true to allow
    SESSION_ID_MIN_LENGTH: 36,                   // UUID length
    RECONNECTION_TOKEN_TTL_SECONDS: 300,         // 5 minutes TTL for reconnection tokens (HARDENING: reduced from 15 min to limit session hijacking window)
    RECONNECTION_TOKEN_LENGTH: 32,               // Bytes for secure token
    ROTATE_SESSION_ON_RECONNECT: true            // Issue new session token after successful reconnection
} as const;

// Validation constraints
export const VALIDATION = {
    NICKNAME_MIN_LENGTH: 1,
    NICKNAME_MAX_LENGTH: 30,
    TEAM_NAME_MAX_LENGTH: 32,
    CLUE_MAX_LENGTH: 50,
    CLUE_NUMBER_MIN: 0,
    CLUE_NUMBER_MAX: 25,
    CHAT_MESSAGE_MAX_LENGTH: 500,
    WORD_MIN_LENGTH: 2,
    WORD_MAX_LENGTH: 30,
    WORD_LIST_MIN_SIZE: 25,  // BOARD_SIZE
    WORD_LIST_MAX_SIZE: 500
} as const;

// Reserved nicknames (case-insensitive)
export const RESERVED_NAMES = [
    'admin', 'administrator', 'system', 'host', 'server',
    'mod', 'moderator', 'bot', 'codenames', 'game',
    'official', 'support', 'help', 'null', 'undefined'
] as const;

// Lock timeouts (in seconds)
export const LOCKS = {
    SPYMASTER_ROLE: 5,        // Lock for spymaster role assignment
    HOST_TRANSFER: 3,         // Lock for host transfer (reduced from 10s - DB ops are fast)
    TIMER_RESTART: 5,         // Lock for timer restart
    CARD_REVEAL: 15,          // Lock for card reveal operation (longer due to retry logic)
    GAME_CREATE: 10,          // Lock for game creation
} as const;

// Retry configuration (centralized for all retry operations)
export const RETRY_CONFIG = {
    OPTIMISTIC_LOCK: { maxRetries: 3, baseDelayMs: 100 },
    REDIS_OPERATION: { maxRetries: 3, baseDelayMs: 50 },
    DISTRIBUTED_LOCK: { maxRetries: 50, baseDelayMs: 100 },
    NETWORK_REQUEST: { maxRetries: 4, baseDelayMs: 2000 },
    RACE_CONDITION: { delayMs: 100 }  // Delay between race condition retries
} as const;

