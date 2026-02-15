/**
 * Type definitions for the Codenames WebSocket Client Adapter.
 *
 * Extracted from socket-client.ts for clarity. These interfaces are
 * internal to the IIFE and only used by the socket-client modules.
 */

/** Minimal Socket.io socket shape used by this adapter. */
export interface SocketClientInstance {
    id: string;
    connected: boolean;
    on(event: string, handler: (...args: any[]) => void): void;
    off(event: string, handler: (...args: any[]) => void): void;
    emit(event: string, ...args: any[]): void;
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
    socketOptions?: Record<string, any>;
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
    handler: (...args: any[]) => void;
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

/** The map of event name -> array of listener callbacks. */
export interface ListenerMap {
    [event: string]: Array<(data: any) => void>;
}

/** Extended Window to allow setting CodenamesClient globally. */
export interface CodenamesGlobal {
    CodenamesClient?: any;
}
