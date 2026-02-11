/**
 * Configuration Type Definitions
 *
 * Types derived from config const objects to maintain single source of truth.
 * Instead of manually mirroring config shapes, we use typeof to derive types
 * so they automatically stay in sync with the actual config values.
 */

import type {
    RATE_LIMITS,
    API_RATE_LIMITS,
    REDIS_TTL,
    SESSION_SECURITY,
    TIMER,
    SOCKET,
    SOCKET_EVENTS,
    VALIDATION,
    LOCKS,
    RETRY_CONFIG,
    GAME_HISTORY,
    GAME_INTERNALS,
    PLAYER_CLEANUP
} from '../config/constants';

// Derived config types - automatically stay in sync with the const objects
export type SocketRateLimits = typeof RATE_LIMITS;
export type ApiRateLimits = typeof API_RATE_LIMITS;
export type RedisTTLConfig = typeof REDIS_TTL;
export type SessionSecurityConfig = typeof SESSION_SECURITY;
export type TimerConfig = typeof TIMER;
export type SocketConfig = typeof SOCKET;
export type SocketEventNames = typeof SOCKET_EVENTS;
export type ValidationConfig = typeof VALIDATION;
export type LockConfig = typeof LOCKS;
export type RetryConfig = typeof RETRY_CONFIG;
export type GameHistoryConfig = typeof GAME_HISTORY;
export type GameInternalsConfig = typeof GAME_INTERNALS;
export type PlayerCleanupConfig = typeof PLAYER_CLEANUP;

// Small helper type that remains as a manual interface
export interface RateLimitConfig {
    window: number;
    max: number;
}
