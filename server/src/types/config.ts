/**
 * Configuration Type Definitions
 *
 * Types for application configuration, constants, and environment.
 */

import type { Team, Role, CardType } from './game';
import type { RoomStatus } from './room';
import type { ErrorCode } from './errors';

// ============================================================================
// Rate Limit Configuration
// ============================================================================

/**
 * Rate limit configuration for a single event/endpoint
 */
export interface RateLimitConfig {
  /** Window size in milliseconds */
  window: number;
  /** Maximum requests allowed in window */
  max: number;
}

/**
 * All socket event rate limits
 */
export interface SocketRateLimits {
  // Room events
  'room:create': RateLimitConfig;
  'room:join': RateLimitConfig;
  'room:join:failed': RateLimitConfig;
  'room:leave': RateLimitConfig;
  'room:settings': RateLimitConfig;
  'room:resync': RateLimitConfig;
  'room:reconnect': RateLimitConfig;
  'room:getReconnectionToken': RateLimitConfig;
  // Game events
  'game:start': RateLimitConfig;
  'game:reveal': RateLimitConfig;
  'game:endTurn': RateLimitConfig;
  'game:forfeit': RateLimitConfig;
  'game:history': RateLimitConfig;
  'game:getHistory': RateLimitConfig;
  'game:getReplay': RateLimitConfig;
  // Player events
  'player:setTeam': RateLimitConfig;
  'player:setRole': RateLimitConfig;
  'player:setNickname': RateLimitConfig;
  'player:kick': RateLimitConfig;
  // Chat events
  'chat:message': RateLimitConfig;
  'chat:spectator': RateLimitConfig;
  // Timer events
  'timer:status': RateLimitConfig;
  'timer:pause': RateLimitConfig;
  'timer:resume': RateLimitConfig;
  'timer:addTime': RateLimitConfig;
  'timer:stop': RateLimitConfig;
}

/**
 * HTTP API rate limits
 */
export interface ApiRateLimits {
  GENERAL: RateLimitConfig;
  WORD_LIST_CREATE: RateLimitConfig;
  ADMIN: RateLimitConfig;
}

// ============================================================================
// Redis TTL Configuration
// ============================================================================

/**
 * Redis TTL values (in seconds)
 */
export interface RedisTTLConfig {
  ROOM: number;
  PLAYER: number;
  SESSION_SOCKET: number;
  DISCONNECTED_PLAYER: number;
  PAUSED_TIMER: number;
  SESSION_VALIDATION_WINDOW: number;
}

// ============================================================================
// Session Security Configuration
// ============================================================================

/**
 * Session security settings
 */
export interface SessionSecurityConfig {
  MAX_SESSION_AGE_MS: number;
  MAX_VALIDATION_ATTEMPTS_PER_IP: number;
  IP_MISMATCH_ALLOWED: boolean;
  SESSION_ID_MIN_LENGTH: number;
  RECONNECTION_TOKEN_TTL_SECONDS: number;
  RECONNECTION_TOKEN_LENGTH: number;
  ROTATE_SESSION_ON_RECONNECT: boolean;
}

// ============================================================================
// Timer Configuration
// ============================================================================

/**
 * Timer settings
 */
export interface TimerConfig {
  DEFAULT_TURN_SECONDS: number;
  MIN_TURN_SECONDS: number;
  MAX_TURN_SECONDS: number;
  WARNING_SECONDS: number;
  TIMER_TTL_BUFFER_SECONDS: number;
}

// ============================================================================
// Socket Configuration
// ============================================================================

/**
 * Socket.IO settings
 */
export interface SocketConfig {
  PING_TIMEOUT_MS: number;
  PING_INTERVAL_MS: number;
  MAX_DISCONNECTION_DURATION_MS: number;
  SOCKET_COUNT_CACHE_MS: number;
  SOCKET_COUNT_TIMEOUT_MS: number;
  REDIS_KEEPALIVE_MS: number;
  MAX_CONNECTIONS_PER_IP: number;
  MAX_HTTP_BUFFER_SIZE: number;
}

// ============================================================================
// Validation Configuration
// ============================================================================

/**
 * Input validation constraints
 */
export interface ValidationConfig {
  NICKNAME_MIN_LENGTH: number;
  NICKNAME_MAX_LENGTH: number;
  TEAM_NAME_MAX_LENGTH: number;
  CHAT_MESSAGE_MAX_LENGTH: number;
  WORD_MIN_LENGTH: number;
  WORD_MAX_LENGTH: number;
  WORD_LIST_MIN_SIZE: number;
  WORD_LIST_MAX_SIZE: number;
}

// ============================================================================
// Lock Configuration
// ============================================================================

/**
 * Distributed lock timeouts (in seconds)
 */
export interface LockConfig {
  SPYMASTER_ROLE: number;
  HOST_TRANSFER: number;
  TIMER_RESTART: number;
  CARD_REVEAL: number;
  GAME_CREATE: number;
}

// ============================================================================
// Retry Configuration
// ============================================================================

/**
 * Retry settings for a specific operation type
 */
export interface RetrySettings {
  maxRetries: number;
  baseDelayMs: number;
}

/**
 * All retry configurations
 */
export interface RetryConfig {
  OPTIMISTIC_LOCK: RetrySettings;
  REDIS_OPERATION: RetrySettings;
  DISTRIBUTED_LOCK: RetrySettings;
  NETWORK_REQUEST: RetrySettings;
  RACE_CONDITION: { delayMs: number };
}

// ============================================================================
// Game History Configuration
// ============================================================================

/**
 * Game history limits
 */
export interface GameHistoryConfig {
  MAX_ENTRIES: number;
  MAX_CLUES: number;
}

// ============================================================================
// Game Internals Configuration
// ============================================================================

/**
 * Internal game service constants
 */
export interface GameInternalsConfig {
  FIRST_TEAM_SEED_OFFSET: number;
  TYPES_SHUFFLE_SEED_OFFSET: number;
  LAZY_HISTORY_MULTIPLIER: number;
}

// ============================================================================
// Player Cleanup Configuration
// ============================================================================

/**
 * Player cleanup settings
 */
export interface PlayerCleanupConfig {
  INTERVAL_MS: number;
  BATCH_SIZE: number;
}

// ============================================================================
// Socket Event Names
// ============================================================================

/**
 * All socket event name constants
 */
export interface SocketEventNames {
  // Room events
  ROOM_CREATE: string;
  ROOM_CREATED: string;
  ROOM_JOIN: string;
  ROOM_JOINED: string;
  ROOM_LEAVE: string;
  ROOM_LEFT: string;
  ROOM_PLAYER_LEFT: string;
  ROOM_SETTINGS: string;
  ROOM_SETTINGS_UPDATED: string;
  ROOM_RESYNCED: string;
  ROOM_RESYNC: string;
  ROOM_GET_RECONNECTION_TOKEN: string;
  ROOM_RECONNECT: string;
  ROOM_RECONNECTED: string;
  ROOM_RECONNECTION_TOKEN: string;
  ROOM_PLAYER_JOINED: string;
  ROOM_PLAYER_RECONNECTED: string;
  ROOM_KICKED: string;
  ROOM_STATS_UPDATED: string;
  ROOM_HOST_CHANGED: string;
  ROOM_ERROR: string;

  // Game events
  GAME_START: string;
  GAME_STARTED: string;
  GAME_REVEAL: string;
  GAME_CARD_REVEALED: string;
  GAME_END_TURN: string;
  GAME_TURN_ENDED: string;
  GAME_FORFEIT: string;
  GAME_OVER: string;
  GAME_HISTORY: string;
  GAME_HISTORY_DATA: string;
  GAME_GET_HISTORY: string;
  GAME_GET_REPLAY: string;
  GAME_HISTORY_RESULT: string;
  GAME_REPLAY_DATA: string;
  GAME_SPYMASTER_VIEW: string;
  GAME_ERROR: string;

  // Player events
  PLAYER_SET_TEAM: string;
  PLAYER_SET_ROLE: string;
  PLAYER_SET_NICKNAME: string;
  PLAYER_KICK: string;
  PLAYER_KICKED: string;
  PLAYER_UPDATED: string;
  PLAYER_DISCONNECTED: string;
  PLAYER_ERROR: string;

  // Timer events
  TIMER_START: string;
  TIMER_TICK: string;
  TIMER_EXPIRED: string;
  TIMER_PAUSE: string;
  TIMER_RESUME: string;
  TIMER_STOP: string;
  TIMER_ADD_TIME: string;
  TIMER_STOPPED: string;
  TIMER_PAUSED: string;
  TIMER_RESUMED: string;
  TIMER_TIME_ADDED: string;
  TIMER_STARTED: string;
  TIMER_STATUS: string;
  TIMER_ERROR: string;

  // Chat events
  CHAT_MESSAGE: string;
  CHAT_ERROR: string;
  CHAT_SPECTATOR: string;
  CHAT_SPECTATOR_MESSAGE: string;
}

// ============================================================================
// Complete Constants Type
// ============================================================================

/**
 * Complete game constants object type
 */
export interface GameConstants {
  // Board configuration
  BOARD_SIZE: number;
  FIRST_TEAM_CARDS: number;
  SECOND_TEAM_CARDS: number;
  NEUTRAL_CARDS: number;
  ASSASSIN_CARDS: number;

  // Room configuration
  ROOM_CODE_LENGTH: number;
  ROOM_MAX_PLAYERS: number;
  ROOM_EXPIRY_HOURS: number;

  // Redis TTLs
  REDIS_TTL: RedisTTLConfig;

  // Session security
  SESSION_SECURITY: SessionSecurityConfig;

  // Timer
  TIMER: TimerConfig;

  // Socket
  SOCKET: SocketConfig;

  // Rate limits
  RATE_LIMITS: SocketRateLimits;
  API_RATE_LIMITS: ApiRateLimits;

  // Game history
  GAME_HISTORY: GameHistoryConfig;

  // Validation
  VALIDATION: ValidationConfig;

  // Locks
  LOCKS: LockConfig;

  // Retries
  RETRY_CONFIG: RetryConfig;

  // Enums as arrays
  TEAMS: readonly Team[];
  ROLES: readonly Role[];
  CARD_TYPES: readonly CardType[];

  // Room statuses
  ROOM_STATUS: {
    WAITING: RoomStatus;
    PLAYING: RoomStatus;
    FINISHED: RoomStatus;
  };

  // Socket events
  SOCKET_EVENTS: SocketEventNames;

  // Game internals
  GAME_INTERNALS: GameInternalsConfig;

  // Player cleanup
  PLAYER_CLEANUP: PlayerCleanupConfig;

  // Error codes
  ERROR_CODES: { [K in ErrorCode]: K };

  // Reserved names
  RESERVED_NAMES: readonly string[];

  // Default words
  DEFAULT_WORDS: readonly string[];
}
