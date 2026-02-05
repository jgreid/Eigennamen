/**
 * Player Type Definitions
 *
 * Types for player management, sessions, and state.
 */

import type { Team, Role } from './game';

/**
 * Player data stored in Redis
 */
export interface Player {
  /** Player's session ID (UUID) */
  sessionId: string;
  /** Room code the player is in */
  roomCode: string;
  /** Player's display name */
  nickname: string;
  /** Player's team (null if unassigned) */
  team: Team | null;
  /** Player's role */
  role: Role;
  /** Whether this player is the room host */
  isHost: boolean;
  /** Whether the player is currently connected */
  connected: boolean;
  /** Last activity timestamp */
  lastSeen: number;
  /** When the player joined */
  joinedAt: number;
}

/**
 * Player information for client display (public view)
 */
export interface PlayerInfo {
  /** Session ID */
  sessionId: string;
  /** Display name */
  nickname: string;
  /** Team assignment */
  team: Team | null;
  /** Player role */
  role: Role;
  /** Whether this is the host */
  isHost: boolean;
  /** Whether currently connected */
  connected: boolean;
}

/**
 * Update payload for player data
 */
export interface PlayerUpdate {
  /** New nickname */
  nickname?: string;
  /** New team */
  team?: Team | null;
  /** New role */
  role?: Role;
  /** New host status */
  isHost?: boolean;
  /** Connection status */
  connected?: boolean;
  /** Last seen timestamp */
  lastSeen?: number;
}

/**
 * Reconnection token data stored in Redis
 */
export interface ReconnectionToken {
  /** The reconnection token string */
  token: string;
  /** Session ID this token reconnects to */
  sessionId: string;
  /** Room code for the session */
  roomCode: string;
  /** When the token was created */
  createdAt: number;
  /** When the token expires */
  expiresAt: number;
}

/**
 * Result of reconnection validation
 */
export interface ReconnectionResult {
  /** Whether reconnection succeeded */
  success: boolean;
  /** The player data (if successful) */
  player?: Player;
  /** New session ID (if rotated) */
  newSessionId?: string;
  /** New reconnection token (if rotated) */
  newToken?: string;
  /** Error message (if failed) */
  error?: string;
}

/**
 * Player context stored per-socket
 */
export interface PlayerContext {
  /** Session ID */
  sessionId: string;
  /** Room code */
  roomCode: string;
  /** Player nickname */
  nickname: string;
  /** Player team */
  team: Team | null;
  /** Player role */
  role: Role;
  /** Whether player is host */
  isHost: boolean;
  /** When context was last validated */
  lastValidated: number;
}

/**
 * Host transfer result
 */
export interface HostTransferResult {
  /** Whether transfer succeeded */
  success: boolean;
  /** Reason for failure (if any) */
  reason?: string;
}

/**
 * Players grouped by team
 */
export interface PlayersByTeam {
  red: Player[];
  blue: Player[];
  spectators: Player[];
  unassigned: Player[];
}

/**
 * Player validation result
 */
export interface PlayerValidation {
  /** Whether the player is valid */
  valid: boolean;
  /** The player data (if valid) */
  player?: Player;
  /** Error message (if invalid) */
  error?: string;
}
