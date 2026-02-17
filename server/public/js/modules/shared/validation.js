/**
 * Shared Validation Constants
 *
 * Single source of truth for validation rules used by both frontend and backend.
 * This module MUST remain environment-agnostic — no Node.js or browser APIs.
 */
// Nickname constraints
export const NICKNAME_MIN_LENGTH = 1;
export const NICKNAME_MAX_LENGTH = 30;
// Room ID constraints
export const ROOM_CODE_MIN_LENGTH = 3;
export const ROOM_CODE_MAX_LENGTH = 20;
// Chat message constraints
export const CHAT_MESSAGE_MAX_LENGTH = 500;
// Team name constraints
export const TEAM_NAME_MAX_LENGTH = 32;
// Regex patterns (Unicode-aware)
// Using string sources so they can be reconstructed in any environment
export const NICKNAME_REGEX = /^[\p{L}\p{N}\s\-_]+$/u;
export const ROOM_CODE_REGEX = /^[\p{L}\p{N}\-_]+$/u;
export const TEAM_NAME_REGEX = /^[\p{L}\p{N}\s\-]+$/u;
// Reserved nicknames (case-insensitive)
export const RESERVED_NAMES = [
    'admin', 'administrator', 'system', 'host', 'server',
    'mod', 'moderator', 'bot', 'eigennamen', 'game',
    'official', 'support', 'help', 'null', 'undefined'
];
//# sourceMappingURL=validation.js.map