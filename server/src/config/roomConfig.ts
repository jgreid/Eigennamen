/**
 * Room Configuration
 *
 * Room settings, Redis TTLs, turn timer, TTL constants,
 * and player cleanup configuration.
 */

// Room configuration
export const ROOM_CODE_LENGTH = 6;
export const ROOM_MAX_PLAYERS = 20;
export const ROOM_EXPIRY_HOURS = 24;

// Redis TTLs (in seconds)
export const REDIS_TTL = {
    ROOM: 24 * 60 * 60,      // 24 hours
    PLAYER: 24 * 60 * 60,    // 24 hours (same as room to prevent orphaned players)
    SESSION_SOCKET: 5 * 60,  // 5 minutes
    DISCONNECTED_PLAYER: 10 * 60,  // 10 minutes grace period for reconnection
    PAUSED_TIMER: 24 * 60 * 60,  // 24 hours for paused timers
    SESSION_VALIDATION_WINDOW: 60  // 1 minute window for session validation rate limiting
} as const;

// Turn timer configuration
export const TIMER = {
    DEFAULT_TURN_SECONDS: 120,  // 2 minutes default
    MIN_TURN_SECONDS: 30,
    MAX_TURN_SECONDS: 300,
    WARNING_SECONDS: 30,        // Warn when this many seconds remain
    TIMER_TTL_BUFFER_SECONDS: 60     // Extra TTL buffer for timer keys
} as const;

// TTL constants (in seconds) - centralized for consistency
export const TTL = {
    PLAYER_CONNECTED: 24 * 60 * 60,        // 24 hours
    PLAYER_DISCONNECTED: 10 * 60,          // 10 minutes grace period for reconnection
    GAME_STATE: 24 * 60 * 60,              // 24 hours
    EVENT_LOG: 5 * 60,                     // 5 minutes
    DISTRIBUTED_LOCK: 5,                   // 5 seconds
    SESSION_VALIDATION_WINDOW: 60,         // 1 minute
    PAUSED_TIMER: 24 * 60 * 60             // 24 hours for paused timers
} as const;

// Player service internal constants
export const PLAYER_CLEANUP = {
    INTERVAL_MS: 60000,         // Run cleanup every 60 seconds
    BATCH_SIZE: 50              // Process up to 50 cleanups per run
} as const;
