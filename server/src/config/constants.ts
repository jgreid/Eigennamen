/**
 * Game Constants
 *
 * Centralized configuration for all game settings, rate limits, and system parameters.
 * This file serves as the single source of truth for all configurable values.
 *
 * Constants are now organized into domain-specific files for maintainability:
 *   - gameConfig.ts     Board layout, game modes, teams, roles, internals, history, default words
 *   - rateLimits.ts     Rate limits for socket events and HTTP API
 *   - socketConfig.ts   Socket.io settings and event name constants
 *   - errorCodes.ts     Application error codes
 *   - securityConfig.ts Session security, validation, reserved names, locks, retry config
 *   - roomConfig.ts     Room settings, Redis TTLs, timer, player cleanup
 *
 * This file re-exports everything so existing imports remain unchanged.
 */

// Re-export everything from domain files for backward compatibility
export * from './gameConfig';
export * from './rateLimits';
export * from './socketConfig';
export * from './errorCodes';
export * from './securityConfig';
export * from './roomConfig';

// CommonJS re-exports for backward compatibility with require('../config/constants')
import {
    BOARD_SIZE, FIRST_TEAM_CARDS, SECOND_TEAM_CARDS, NEUTRAL_CARDS, ASSASSIN_CARDS,
    GAME_MODES, GAME_MODE_CONFIG, DUET_BOARD_CONFIG,
    TEAMS, ROLES, CARD_TYPES, ROOM_STATUS,
    GAME_INTERNALS, GAME_HISTORY, DEFAULT_WORDS
} from './gameConfig';

import { RATE_LIMITS, API_RATE_LIMITS } from './rateLimits';

import { SOCKET, SOCKET_EVENTS } from './socketConfig';

import { ERROR_CODES } from './errorCodes';

import {
    SESSION_SECURITY, VALIDATION, RESERVED_NAMES, LOCKS,
    RETRY_CONFIG, RETRIES
} from './securityConfig';

import {
    ROOM_CODE_LENGTH, ROOM_MAX_PLAYERS, ROOM_EXPIRY_HOURS,
    REDIS_TTL, TIMER, TTL, PLAYER_CLEANUP
} from './roomConfig';

module.exports = {
    BOARD_SIZE,
    FIRST_TEAM_CARDS,
    SECOND_TEAM_CARDS,
    NEUTRAL_CARDS,
    ASSASSIN_CARDS,
    ROOM_CODE_LENGTH,
    ROOM_MAX_PLAYERS,
    ROOM_EXPIRY_HOURS,
    REDIS_TTL,
    SESSION_SECURITY,
    TIMER,
    SOCKET,
    RATE_LIMITS,
    API_RATE_LIMITS,
    GAME_HISTORY,
    VALIDATION,
    LOCKS,
    RETRIES,
    GAME_MODES,
    GAME_MODE_CONFIG,
    DUET_BOARD_CONFIG,
    TEAMS,
    ROLES,
    CARD_TYPES,
    ROOM_STATUS,
    SOCKET_EVENTS,
    TTL,
    RETRY_CONFIG,
    GAME_INTERNALS,
    PLAYER_CLEANUP,
    ERROR_CODES,
    RESERVED_NAMES,
    DEFAULT_WORDS
};
