import { TIMER_MIN_TURN_SECONDS, TIMER_MAX_TURN_SECONDS, TIMER_DEFAULT_TURN_SECONDS } from '../shared';
import { isMemoryMode } from './memoryMode';

// Room configuration
export const ROOM_CODE_LENGTH = 6;
export const ROOM_MAX_PLAYERS = 20;

// TTL adjustment based on memory mode (evaluated at startup)
const ROOM_TTL_SECONDS = isMemoryMode() ? 4 * 60 * 60 : 24 * 60 * 60; // 4h memory / 24h Redis
const PAUSED_TIMER_TTL = isMemoryMode() ? 4 * 60 * 60 : 24 * 60 * 60;

export const ROOM_EXPIRY_HOURS = isMemoryMode() ? 4 : 24;

// Redis TTLs (in seconds)
export const REDIS_TTL = {
    ROOM: ROOM_TTL_SECONDS,
    PLAYER: ROOM_TTL_SECONDS, // Same as room to prevent orphaned players
    SESSION_SOCKET: 5 * 60, // 5 minutes
    DISCONNECTED_PLAYER: 10 * 60, // 10 minutes grace period for reconnection
    PAUSED_TIMER: PAUSED_TIMER_TTL,
    SESSION_VALIDATION_WINDOW: 60, // 1 minute window for session validation rate limiting
} as const;

// Turn timer configuration — bounds sourced from shared module
export const TIMER = {
    DEFAULT_TURN_SECONDS: TIMER_DEFAULT_TURN_SECONDS,
    MIN_TURN_SECONDS: TIMER_MIN_TURN_SECONDS,
    MAX_TURN_SECONDS: TIMER_MAX_TURN_SECONDS,
    WARNING_SECONDS: 30, // Warn when this many seconds remain
    TIMER_TTL_BUFFER_SECONDS: 60, // Extra TTL buffer for timer keys
} as const;

// Player service internal constants
export const PLAYER_CLEANUP = {
    INTERVAL_MS: 30000, // Run cleanup every 30 seconds (faster response for large rooms)
    BATCH_SIZE: 100, // Process up to 100 cleanups per run
} as const;
