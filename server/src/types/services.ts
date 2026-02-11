/**
 * Service Type Definitions
 *
 * Types for service layer interfaces and return types.
 */

import type { Team, GameState, PlayerGameState, CreateGameOptions, RevealResult, ClueWithGuesses, EndTurnResult, ForfeitResult, GameHistoryEntry, Role } from './game';
import type { Room, CreateRoomSettings, CreateRoomResult, JoinRoomResult, LeaveRoomResult, RoomSettings } from './room';
import type { Player, PlayerUpdate, ReconnectionResult, HostTransferResult } from './player';

// ============================================================================
// Game Service Types
// ============================================================================

/**
 * Game service interface
 */
export interface IGameService {
  createGame(roomCode: string, options?: CreateGameOptions): Promise<GameState>;
  getGame(roomCode: string): Promise<GameState | null>;
  getGameStateForPlayer(game: GameState, player: Player | null): PlayerGameState;
  revealCard(roomCode: string, index: number, playerNickname?: string, playerTeam?: string): Promise<RevealResult>;
  giveClue(roomCode: string, team: Team, word: string, number: number, spymasterNickname?: string): Promise<ClueWithGuesses>;
  endTurn(roomCode: string, playerNickname?: string, expectedTeam?: string): Promise<EndTurnResult>;
  forfeitGame(roomCode: string, forfeitTeam?: Team): Promise<ForfeitResult>;
  getGameHistory(roomCode: string): Promise<GameHistoryEntry[]>;
  cleanupGame(roomCode: string): Promise<void>;
}

// ============================================================================
// Room Service Types
// ============================================================================

/**
 * Room service interface
 */
export interface IRoomService {
  createRoom(roomId: string, hostSessionId: string, settings?: CreateRoomSettings): Promise<CreateRoomResult>;
  getRoom(roomId: string): Promise<Room | null>;
  joinRoom(roomId: string, sessionId: string, nickname: string): Promise<JoinRoomResult>;
  leaveRoom(code: string, sessionId: string): Promise<LeaveRoomResult>;
  updateSettings(code: string, sessionId: string, newSettings: Partial<RoomSettings>): Promise<RoomSettings>;
  roomExists(code: string): Promise<boolean>;
  refreshRoomTTL(code: string): Promise<void>;
  cleanupRoom(code: string): Promise<void>;
  deleteRoom(code: string): Promise<void>;
}

// ============================================================================
// Player Service Types
// ============================================================================

/**
 * Player service interface
 */
export interface IPlayerService {
  createPlayer(sessionId: string, roomCode: string, nickname: string, isHost: boolean, addToRoom?: boolean): Promise<Player>;
  getPlayer(sessionId: string): Promise<Player | null>;
  updatePlayer(sessionId: string, updates: PlayerUpdate): Promise<Player | null>;
  removePlayer(sessionId: string): Promise<void>;
  getPlayersInRoom(roomCode: string): Promise<Player[]>;
  setTeam(sessionId: string, team: Team | null): Promise<Player | null>;
  setRole(sessionId: string, role: Role): Promise<Player | null>;
  setNickname(sessionId: string, nickname: string): Promise<Player | null>;
  atomicHostTransfer(oldHostId: string, newHostId: string, roomCode: string): Promise<HostTransferResult>;
  generateReconnectionToken(sessionId: string): Promise<string>;
  validateRoomReconnectToken(token: string, code: string): Promise<ReconnectionResult>;
  markDisconnected(sessionId: string): Promise<void>;
  markConnected(sessionId: string): Promise<void>;
}

// ============================================================================
// Timer Service Types
// ============================================================================

/**
 * Timer state
 */
export interface TimerState {
  /** Whether the timer is active */
  active: boolean;
  /** Remaining time in seconds */
  remaining: number;
  /** Total time in seconds */
  total: number;
  /** Whether the timer is paused */
  paused: boolean;
  /** Which team the timer is for */
  team?: Team;
  /** Room code */
  roomCode?: string;
}

/**
 * Timer callback function
 */
export type TimerCallback = (roomCode: string) => void | Promise<void>;

/**
 * Timer service interface
 */
export interface ITimerService {
  startTimer(roomCode: string, durationSeconds: number, onExpire: TimerCallback): Promise<void>;
  stopTimer(roomCode: string): Promise<void>;
  pauseTimer(roomCode: string): Promise<TimerState | null>;
  resumeTimer(roomCode: string): Promise<TimerState | null>;
  addTime(roomCode: string, seconds: number): Promise<TimerState | null>;
  getTimerStatus(roomCode: string): Promise<TimerState>;
  hasActiveTimer(roomCode: string): Promise<boolean>;
}

// ============================================================================
// Word List Service Types
// ============================================================================

/**
 * Word list data
 */
export interface WordList {
  id: string;
  name: string;
  words: string[];
  isPublic: boolean;
  createdBy?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Word list service interface
 */
export interface IWordListService {
  getWordList(id: string): Promise<WordList | null>;
  getWordsForGame(id: string): Promise<string[] | null>;
  createWordList(name: string, words: string[], isPublic?: boolean, createdBy?: string): Promise<WordList>;
  listPublicWordLists(): Promise<WordList[]>;
}

// ============================================================================
// Game History Service Types
// ============================================================================

/**
 * Game history record
 */
export interface GameHistoryRecord {
  id: string;
  roomCode: string;
  gameState: GameState;
  players: Player[];
  winner: Team | null;
  endReason: 'completed' | 'assassin' | 'forfeit' | null;
  startedAt: Date;
  endedAt: Date | null;
}

/**
 * Game history service interface
 */
export interface IGameHistoryService {
  saveGame(roomCode: string, game: GameState, players: Player[]): Promise<string>;
  getGameHistory(gameId: string): Promise<GameHistoryRecord | null>;
  getRecentGames(limit?: number): Promise<GameHistoryRecord[]>;
}

// ============================================================================
// Event Log Service Types
// ============================================================================

// ============================================================================
// Audit Service Types
// ============================================================================

/**
 * Audit log entry
 */
export interface AuditLogEntry {
  id: string;
  action: string;
  actor: string;
  target?: string;
  details?: Record<string, unknown>;
  ip?: string;
  timestamp: Date;
}

/**
 * Audit service interface
 */
export interface IAuditService {
  log(action: string, actor: string, details?: Record<string, unknown>): Promise<void>;
  getAuditLog(filter?: { action?: string; actor?: string; since?: Date }): Promise<AuditLogEntry[]>;
}

// ============================================================================
// Redis Operation Types
// ============================================================================

/**
 * Redis transaction result
 */
export type RedisTransactionResult = Array<[Error | null, unknown]> | null;

/**
 * Redis operation options
 */
export interface RedisSetOptions {
  EX?: number;
  PX?: number;
  NX?: boolean;
  XX?: boolean;
}

/**
 * Lua script evaluation options
 */
export interface LuaEvalOptions {
  keys: string[];
  arguments: string[];
}
