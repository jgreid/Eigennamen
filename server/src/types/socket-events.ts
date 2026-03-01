/**
 * Socket.IO Event Type Definitions
 *
 * Type-safe event definitions for client-server communication.
 * These types ensure emit/on handlers have correct payloads.
 */

import type {
    Team,
    Role,
    CardType,
    PlayerGameState,
    RevealResult,
    GameHistoryEntry
} from './game';
import type { Room, RoomSettings, TeamNames } from './room';
import type { Player, PlayerInfo } from './player';

// Client to Server Events (what clients send to the server)

/**
 * Room creation payload
 */
export interface RoomCreatePayload {
  roomId: string;
  settings?: {
    teamNames?: TeamNames;
    turnTimer?: number | null;
    allowSpectators?: boolean;
    wordListId?: string | null;
    nickname?: string;
  };
}

/**
 * Room join payload
 */
export interface RoomJoinPayload {
  roomId: string;
  nickname: string;
}

/**
 * Room reconnection payload
 */
export interface RoomReconnectPayload {
  code: string;
  reconnectionToken: string;
}

/**
 * Room settings update payload
 */
export interface RoomSettingsPayload {
  teamNames?: TeamNames;
  turnTimer?: number | null;
  allowSpectators?: boolean;
}

/**
 * Game start payload
 */
export interface GameStartPayload {
  wordListId?: string | null;
  wordList?: string[];
}

/**
 * Card reveal payload
 */
export interface GameRevealPayload {
  index: number;
}

/**
 * Player team change payload
 */
export interface PlayerTeamPayload {
  team: Team | null;
}

/**
 * Player role change payload
 */
export interface PlayerRolePayload {
  role: Role;
}

/**
 * Player nickname change payload
 */
export interface PlayerNicknamePayload {
  nickname: string;
}

/**
 * Player kick payload
 */
export interface PlayerKickPayload {
  targetSessionId: string;
}

/**
 * Chat message payload
 */
export interface ChatMessagePayload {
  text: string;
  teamOnly?: boolean;
  spectatorOnly?: boolean;
}

/**
 * Spectator chat payload
 */
export interface SpectatorChatPayload {
  message: string;
}

/**
 * Timer add time payload
 */
export interface TimerAddTimePayload {
  seconds: number;
}

/**
 * Game history request payload
 */
export interface GameHistoryPayload {
  limit?: number;
}

/**
 * Game replay request payload
 */
export interface GameReplayPayload {
  gameId: string;
}

/**
 * Events sent from client to server
 */
export interface ClientToServerEvents {
  // Room events
  'room:create': (data: RoomCreatePayload, callback?: (response: RoomCreatedResponse) => void) => void;
  'room:join': (data: RoomJoinPayload, callback?: (response: RoomJoinedResponse) => void) => void;
  'room:leave': () => void;
  'room:settings': (data: RoomSettingsPayload) => void;
  'room:resync': () => void;
  'room:getReconnectionToken': () => void;
  'room:reconnect': (data: RoomReconnectPayload, callback?: (response: RoomReconnectedResponse) => void) => void;

  // Game events
  'game:start': (data?: GameStartPayload) => void;
  'game:reveal': (data: GameRevealPayload) => void;
  'game:endTurn': () => void;
  'game:forfeit': () => void;
  'game:getHistory': (data?: GameHistoryPayload) => void;
  'game:getReplay': (data: GameReplayPayload) => void;

  // Player events
  'player:setTeam': (data: PlayerTeamPayload) => void;
  'player:setRole': (data: PlayerRolePayload) => void;
  'player:setNickname': (data: PlayerNicknamePayload) => void;
  'player:kick': (data: PlayerKickPayload) => void;

  // Chat events
  'chat:message': (data: ChatMessagePayload) => void;
  'chat:spectator': (data: SpectatorChatPayload) => void;

  // Timer events
  'timer:pause': () => void;
  'timer:resume': () => void;
  'timer:stop': () => void;
  'timer:addTime': (data: TimerAddTimePayload) => void;
  'timer:status': () => void;
}

// Server to Client Events (what server sends to clients)

/**
 * Room created response
 */
export interface RoomCreatedResponse {
  room: Room;
  player: Player;
}

/**
 * Room joined response
 */
export interface RoomJoinedResponse {
  room: Room;
  players: PlayerInfo[];
  game: PlayerGameState | null;
  player: Player;
  isReconnecting?: boolean;
}

/**
 * Room reconnected response
 */
export interface RoomReconnectedResponse {
  success: boolean;
  room?: Room;
  players?: PlayerInfo[];
  game?: PlayerGameState | null;
  player?: Player;
  newSessionId?: string;
  newToken?: string;
  error?: string;
}

/**
 * Error response structure
 */
export interface ErrorResponse {
  code: string;
  message: string;
}

/**
 * Player joined notification
 */
export interface PlayerJoinedPayload {
  player: PlayerInfo;
  players: PlayerInfo[];
}

/**
 * Player left notification
 */
export interface PlayerLeftPayload {
  sessionId: string;
  players: PlayerInfo[];
  newHostId?: string | null;
}

/**
 * Player updated notification
 */
export interface PlayerUpdatedPayload {
  sessionId: string;
  updates: Partial<PlayerInfo>;
  players: PlayerInfo[];
}

/**
 * Player kicked notification
 */
export interface PlayerKickedPayload {
  sessionId: string;
  reason: string;
}

/**
 * Game started notification
 */
export interface GameStartedPayload {
  game: PlayerGameState;
}

/**
 * Card revealed notification
 */
export interface CardRevealedPayload extends RevealResult {
  // Inherits all from RevealResult
}

/**
 * Turn ended notification
 */
export interface TurnEndedPayload {
  currentTurn: Team;
  previousTurn: Team;
  reason?: 'manual' | 'timeout' | 'maxGuesses' | 'wrongGuess';
}

/**
 * Game over notification
 */
export interface GameOverPayload {
  winner: Team;
  reason: 'completed' | 'assassin' | 'forfeit';
  allTypes: CardType[];
}

/**
 * Chat message notification
 */
export interface ChatReceivedPayload {
  from: string;
  sessionId: string;
  text: string;
  team: Team | null;
  teamOnly: boolean;
  timestamp: number;
}

/**
 * Spectator chat notification
 */
export interface SpectatorChatReceivedPayload {
  from: string;
  sessionId: string;
  message: string;
  timestamp: number;
}

/**
 * Timer tick notification
 */
export interface TimerTickPayload {
  remaining: number;
  total: number;
  paused: boolean;
}

/**
 * Timer status notification
 */
export interface TimerStatusPayload {
  active: boolean;
  remaining: number;
  total: number;
  paused: boolean;
}

/**
 * Host changed notification
 */
export interface HostChangedPayload {
  newHostId: string;
  players: PlayerInfo[];
}

/**
 * Reconnection token response
 */
export interface ReconnectionTokenPayload {
  token: string;
  expiresIn: number;
}

/**
 * Room resync response
 */
export interface RoomResyncPayload {
  room: Room;
  players: PlayerInfo[];
  game: PlayerGameState | null;
}

/**
 * Game history response
 */
export interface GameHistoryResultPayload {
  history: GameHistoryEntry[];
  gameId: string;
}

/**
 * Spymaster view (reveals all card types)
 */
export interface SpymasterViewPayload {
  types: CardType[];
  cardScores?: number[];
}

/**
 * Events sent from server to client
 */
export interface ServerToClientEvents {
  // Room events
  'room:created': (data: RoomCreatedResponse) => void;
  'room:joined': (data: RoomJoinedResponse) => void;
  'room:playerJoined': (data: PlayerJoinedPayload) => void;
  'room:playerLeft': (data: PlayerLeftPayload) => void;
  'room:settingsUpdated': (data: RoomSettings) => void;
  'room:kicked': (data: PlayerKickedPayload) => void;
  'room:hostChanged': (data: HostChangedPayload) => void;
  'room:reconnected': (data: RoomReconnectedResponse) => void;
  'room:playerReconnected': (data: PlayerJoinedPayload) => void;
  'room:reconnectionToken': (data: ReconnectionTokenPayload) => void;
  'room:resynced': (data: RoomResyncPayload) => void;
  'room:error': (data: ErrorResponse) => void;

  // Game events
  'game:started': (data: GameStartedPayload) => void;
  'game:cardRevealed': (data: CardRevealedPayload) => void;
  'game:turnEnded': (data: TurnEndedPayload) => void;
  'game:over': (data: GameOverPayload) => void;
  'game:spymasterView': (data: SpymasterViewPayload) => void;
  'game:historyResult': (data: GameHistoryResultPayload) => void;
  'game:error': (data: ErrorResponse) => void;

  // Player events
  'player:updated': (data: PlayerUpdatedPayload) => void;
  'player:kicked': (data: PlayerKickedPayload) => void;
  'player:disconnected': (data: { sessionId: string }) => void;
  'player:error': (data: ErrorResponse) => void;

  // Chat events
  'chat:message': (data: ChatReceivedPayload) => void;
  'chat:spectatorMessage': (data: SpectatorChatReceivedPayload) => void;
  'chat:error': (data: ErrorResponse) => void;

  // Timer events
  'timer:started': (data: TimerStatusPayload) => void;
  'timer:tick': (data: TimerTickPayload) => void;
  'timer:paused': (data: TimerStatusPayload) => void;
  'timer:resumed': (data: TimerStatusPayload) => void;
  'timer:stopped': () => void;
  'timer:expired': () => void;
  'timer:timeAdded': (data: { seconds: number; remaining: number }) => void;
  'timer:status': (data: TimerStatusPayload) => void;
  'timer:error': (data: ErrorResponse) => void;
}

/**
 * Inter-server events (for Socket.IO adapter/pub-sub)
 */
export interface InterServerEvents {
  ping: () => void;
}

/**
 * Socket data stored on each connection
 */
export interface SocketData {
  sessionId?: string;
  roomCode?: string;
  nickname?: string;
  team?: Team | null;
  role?: Role;
  isHost?: boolean;
  lastValidated?: number;
  ip?: string;
}
