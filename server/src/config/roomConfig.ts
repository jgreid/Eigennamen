/**
 * Room Configuration
 *
 * Room settings, Redis TTLs, turn timer,
 * and player cleanup configuration.
 *
 * Memory mode adjustments:
 * When running with REDIS_URL=memory (single-instance, no persistence),
 * TTLs are shortened to prevent unbounded memory growth on constrained VMs.
 * A Codenames game typically lasts 30-60 minutes, so 4 hours is generous.
 */

// Room configuration
export const ROOM_CODE_LENGTH = 6;
export const ROOM_MAX_PLAYERS = 20;

// Detect memory mode at startup for TTL adjustment
const _isMemoryMode = (process.env['REDIS_URL'] || '') === 'memory' || (process.env['REDIS_URL'] || '') === 'memory://';
const ROOM_TTL_SECONDS = _isMemoryMode ? 4 * 60 * 60 : 24 * 60 * 60;  // 4h memory / 24h Redis
const PAUSED_TIMER_TTL = _isMemoryMode ? 4 * 60 * 60 : 24 * 60 * 60;

export const ROOM_EXPIRY_HOURS = _isMemoryMode ? 4 : 24;

// Redis TTLs (in seconds)
export const REDIS_TTL = {
    ROOM: ROOM_TTL_SECONDS,
    PLAYER: ROOM_TTL_SECONDS,    // Same as room to prevent orphaned players
    SESSION_SOCKET: 5 * 60,  // 5 minutes
    DISCONNECTED_PLAYER: 10 * 60,  // 10 minutes grace period for reconnection
    PAUSED_TIMER: PAUSED_TIMER_TTL,
    SESSION_VALIDATION_WINDOW: 60  // 1 minute window for session validation rate limiting
} as const;

// Turn timer configuration
export const TIMER = {
    DEFAULT_TURN_SECONDS: 120,  // 2 minutes default
    MIN_TURN_SECONDS: 30,
    MAX_TURN_SECONDS: 600,
    WARNING_SECONDS: 30,        // Warn when this many seconds remain
    TIMER_TTL_BUFFER_SECONDS: 60     // Extra TTL buffer for timer keys
} as const;

// Player service internal constants
export const PLAYER_CLEANUP = {
    INTERVAL_MS: 60000,         // Run cleanup every 60 seconds
    BATCH_SIZE: 50              // Process up to 50 cleanups per run
} as const;
