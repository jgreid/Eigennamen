/**
 * Error Type Definitions
 *
 * Types for error handling and error responses.
 */

/**
 * All possible error codes
 */
export type ErrorCode =
  | 'ROOM_NOT_FOUND'
  | 'ROOM_FULL'
  | 'ROOM_ALREADY_EXISTS'
  | 'GAME_IN_PROGRESS'
  | 'NOT_HOST'
  | 'NOT_SPYMASTER'
  | 'NOT_CLICKER'
  | 'NOT_YOUR_TURN'
  | 'CARD_ALREADY_REVEALED'
  | 'GAME_OVER'
  | 'INVALID_INPUT'
  | 'RATE_LIMITED'
  | 'SERVER_ERROR'
  | 'WORD_LIST_NOT_FOUND'
  | 'NOT_AUTHORIZED'
  | 'SESSION_EXPIRED'
  | 'SESSION_NOT_FOUND'
  | 'SESSION_VALIDATION_RATE_LIMITED'
  | 'RESERVED_NAME'
  | 'CANNOT_SWITCH_TEAM_DURING_TURN'
  | 'CANNOT_CHANGE_ROLE_DURING_TURN'
  | 'SPYMASTER_CANNOT_CHANGE_TEAM'
  | 'PLAYER_NOT_FOUND'
  | 'GAME_NOT_STARTED';

/**
 * Base interface for game errors
 */
export interface GameErrorData {
  /** Error name/class */
  name: string;
  /** Error code for programmatic handling */
  code: ErrorCode;
  /** Human-readable message */
  message: string;
  /** Additional context/details */
  details: Record<string, unknown> | null;
  /** When the error occurred */
  timestamp: number;
}

/**
 * Error details for room errors
 */
export interface RoomErrorDetails {
  roomCode?: string;
  roomId?: string;
}

/**
 * Error details for player errors
 */
export interface PlayerErrorDetails {
  sessionId?: string;
  team?: string;
}

/**
 * Error details for game state errors
 */
export interface GameStateErrorDetails {
  index?: number;
  roomCode?: string;
  recoverable?: boolean;
  suggestion?: string;
}

/**
 * Error details for validation errors
 */
export interface ValidationErrorDetails {
  index?: number;
  max?: number;
  field?: string;
  value?: unknown;
}

/**
 * Error details for server errors
 */
export interface ServerErrorDetails {
  roomCode?: string | null;
  operation?: string | null;
  retryable?: boolean;
}

/**
 * Error codes that are safe to expose to clients
 */
export type SafeErrorCode =
  | 'RATE_LIMITED'
  | 'ROOM_NOT_FOUND'
  | 'ROOM_FULL'
  | 'ROOM_ALREADY_EXISTS'
  | 'NOT_HOST'
  | 'NOT_YOUR_TURN'
  | 'GAME_OVER'
  | 'INVALID_INPUT'
  | 'CARD_ALREADY_REVEALED'
  | 'NOT_SPYMASTER'
  | 'NOT_CLICKER'
  | 'NOT_AUTHORIZED'
  | 'SESSION_EXPIRED'
  | 'PLAYER_NOT_FOUND'
  | 'GAME_IN_PROGRESS'
  | 'CANNOT_SWITCH_TEAM_DURING_TURN'
  | 'CANNOT_CHANGE_ROLE_DURING_TURN'
  | 'SPYMASTER_CANNOT_CHANGE_TEAM'
  | 'GAME_NOT_STARTED';

/**
 * Sanitized error for client emission
 */
export interface SanitizedError {
  code: string;
  message: string;
}

/**
 * Type guard for checking if an error has a code property
 */
export interface CodedError {
  code: ErrorCode;
  message: string;
}

/**
 * Lua script error codes
 */
export type LuaErrorCode =
  | 'NO_GAME'
  | 'GAME_OVER'
  | 'NO_GUESSES'
  | 'ALREADY_REVEALED'
  | 'NOT_YOUR_TURN'
  | 'INVALID_INDEX';

/**
 * Lua script error response
 */
export interface LuaErrorResponse {
  error: LuaErrorCode;
  word?: string;
}
