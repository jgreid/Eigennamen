/**
 * Room Type Definitions
 *
 * Types for room management, settings, and state.
 */

import type { Player } from './player';
import type { PlayerGameState } from './game';
import type { GameMode } from '../config/gameConfig';

/**
 * Room status states
 */
export type RoomStatus = 'waiting' | 'playing' | 'finished';

/**
 * Team name configuration
 */
export interface TeamNames {
  red: string;
  blue: string;
}

// Re-export GameMode from the canonical source (config/gameConfig.ts)
export type { GameMode };

/**
 * Room settings that can be configured
 */
export interface RoomSettings {
  /** Custom team names */
  teamNames: TeamNames;
  /** Turn timer duration in seconds (null = no timer) */
  turnTimer: number | null;
  /** Whether spectators are allowed */
  allowSpectators: boolean;
  /** ID of word list to use */
  wordListId?: string | null;
  /** Game mode (classic or blitz) */
  gameMode: GameMode;
}

/**
 * Settings provided when creating a room
 */
export interface CreateRoomSettings extends Partial<RoomSettings> {
  /** Optional nickname for the host */
  nickname?: string;
}

/**
 * Room data stored in Redis
 */
export interface Room {
  /** Unique room identifier (UUID) */
  id: string;
  /** Room code (normalized, lowercase) */
  code: string;
  /** Original room ID as entered by host (for display) */
  roomId: string;
  /** Session ID of the room host */
  hostSessionId: string;
  /** Current room status */
  status: RoomStatus;
  /** Room settings */
  settings: RoomSettings;
  /** When the room was created */
  createdAt: number;
  /** When the room expires */
  expiresAt: number;
}

/**
 * Result of creating a room
 */
export interface CreateRoomResult {
  /** The created room */
  room: Room;
  /** The host player */
  player: Player;
}

/**
 * Result of joining a room
 */
export interface JoinRoomResult {
  /** The room joined */
  room: Room;
  /** All players in the room */
  players: Player[];
  /** Current game state (if any) */
  game: PlayerGameState | null;
  /** The joining player */
  player: Player;
  /** Whether this was a reconnection */
  isReconnecting: boolean;
}

/**
 * Result of leaving a room
 */
export interface LeaveRoomResult {
  /** New host session ID (if host left and was replaced) */
  newHostId: string | null;
  /** Whether the room was deleted (no players left) */
  roomDeleted: boolean;
}

/**
 * Room information for API responses (public view)
 */
export interface RoomInfo {
  /** Room code */
  code: string;
  /** Room ID as entered by host */
  roomId: string;
  /** Current status */
  status: RoomStatus;
  /** Number of players */
  playerCount: number;
  /** Team names */
  teamNames: TeamNames;
  /** Whether spectators are allowed */
  allowSpectators: boolean;
  /** When created */
  createdAt: number;
}

