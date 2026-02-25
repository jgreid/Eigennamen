/**
 * Type definitions for the Eigennamen WebSocket Client Adapter.
 *
 * Extracted from socket-client.ts for clarity. These interfaces are
 * internal to the IIFE and only used by the socket-client modules.
 */

import type {
    ServerPlayerData, ServerRoomData, ServerGameData,
    GameStartedData, CardRevealedData, TurnEndedData, GameOverData,
    SpymasterViewData, PlayerJoinedData, PlayerLeftData, PlayerUpdatedData,
    PlayerDisconnectedData, HostChangedData, TimerEventData, RoomWarningData,
    ReconnectionData, SettingsUpdatedData, StatsUpdatedData, SpectatorChatData,
    ChatMessageData, KickedData, PlayerKickedData, HistoryResultData,
    ReplayData, JoinCreateResult
} from './multiplayerTypes.js';

// Event payload types for server-to-client events (adapter's internal bus)

/** Payload for room:created → 'roomCreated' */
export interface RoomCreatedPayload {
    room: ServerRoomData;
    player: ServerPlayerData;
    players?: ServerPlayerData[];
}

/** Payload for room:joined → 'roomJoined' */
export interface RoomJoinedPayload {
    room: ServerRoomData;
    you: ServerPlayerData;
    players: ServerPlayerData[];
    game?: ServerGameData;
}

/** Payload for room:resynced → 'roomResynced' */
export type RoomResyncedPayload = ReconnectionData;

/** Payload for room:reconnected → 'roomReconnected' */
export type RoomReconnectedPayload = ReconnectionData;

/**
 * Map of internal event names → payload types.
 *
 * This is the single source of truth for event type safety across the
 * socket-client adapter, socket-client-events, and multiplayerListeners.
 */
export interface ClientEventMap {
    // Client-generated lifecycle events
    connected: { wasReconnecting: boolean };
    disconnected: { reason: string; wasConnected: boolean };
    rejoining: { roomCode: string; nickname: string };
    rejoined: JoinCreateResult;
    rejoinFailed: ReconnectionData;

    // Room events
    roomCreated: RoomCreatedPayload;
    roomJoined: RoomJoinedPayload;
    playerJoined: PlayerJoinedData;
    playerLeft: PlayerLeftData;
    settingsUpdated: SettingsUpdatedData;
    statsUpdated: StatsUpdatedData;
    hostChanged: HostChangedData;
    kicked: KickedData;
    playerKicked: PlayerKickedData;
    roomWarning: RoomWarningData;
    roomResynced: RoomResyncedPayload;
    roomReconnected: RoomReconnectedPayload;

    // Player events
    playerUpdated: PlayerUpdatedData;
    playerDisconnected: PlayerDisconnectedData;
    playerReconnected: PlayerDisconnectedData;

    // Game events
    gameStarted: GameStartedData;
    cardRevealed: CardRevealedData;
    turnEnded: TurnEndedData;
    gameOver: GameOverData;
    spymasterView: SpymasterViewData;
    historyData: unknown;
    historyResult: HistoryResultData;
    replayData: ReplayData;

    // Timer events
    timerStarted: TimerEventData;
    timerStopped: unknown;
    timerTick: TimerEventData;
    timerExpired: unknown;
    timerStatus: TimerEventData;
    timerPaused: TimerEventData;
    timerResumed: TimerEventData;
    timerTimeAdded: TimerEventData;

    // Chat events
    chatMessage: ChatMessageData;
    spectatorChatMessage: SpectatorChatData;

    // Error events (merged from room, player, game errors + connection errors)
    error: ErrorData;
}

/** Helper: all valid client event names */
export type ClientEventName = keyof ClientEventMap;

// Core adapter interfaces

/** Minimal Socket.io socket shape used by this adapter. */
export interface SocketClientInstance {
    id: string;
    connected: boolean;
    on(event: string, handler: (...args: unknown[]) => void): void;
    off(event: string, handler: (...args: unknown[]) => void): void;
    emit(event: string, ...args: unknown[]): void;
    disconnect(): void;
}

/** Player data as tracked by the client adapter. */
export interface Player {
    sessionId: string;
    roomCode?: string;
    nickname: string;
    team: string | null;
    role: string | null;
    isHost: boolean;
    connected: boolean;
}

/** Room data returned by the server. */
export interface _RoomData {
    code: string;
    status?: string;
    settings?: Record<string, unknown>;
}

/** Options passed to connect(). */
export interface ConnectOptions {
    autoRejoin?: boolean;
    socketOptions?: Record<string, unknown>;
}

/** Options passed to createRoom(). */
export interface CreateRoomOptions {
    roomId: string;
    nickname?: string;
    [key: string]: unknown;
}

/** A tracked socket.io listener for cleanup. */
export interface SocketListenerEntry {
    event: string;
    handler: (...args: unknown[]) => void;
}

/** An event queued while the client is offline. */
export interface OfflineQueueItem {
    event: string;
    data: Record<string, unknown>;
    timestamp: number;
}

/** Error data emitted by the adapter. */
export interface ErrorData {
    type: string;
    code?: string;
    message?: string;
    error?: Error;
    attempt?: number;
    requestId?: string;
    [key: string]: unknown;
}

/** The map of event name -> array of listener callbacks (typed). */
export type ListenerMap = {
    [K in ClientEventName]?: Array<(data: ClientEventMap[K]) => void>;
} & {
    [event: string]: Array<(data: unknown) => void> | undefined;
};

/** Extended Window to allow setting EigennamenClient globally. */
export interface EigennamenGlobal {
    EigennamenClient?: unknown;
}
