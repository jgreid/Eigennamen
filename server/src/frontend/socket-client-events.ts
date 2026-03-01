/**
 * Socket.io event listener registration for the Eigennamen WebSocket Client.
 *
 * Extracted from socket-client.ts. Registers all server-to-client event
 * listeners and maps them to the adapter's internal event bus.
 */

import type {
    Player,
    ClientEventMap,
    ClientEventName,
    RoomCreatedPayload,
    RoomJoinedPayload,
    RoomResyncedPayload,
    RoomReconnectedPayload,
} from './socket-client-types.js';
import type {
    PlayerJoinedData,
    PlayerLeftData,
    SettingsUpdatedData,
    StatsUpdatedData,
    HostChangedData,
    KickedData,
    PlayerKickedData,
    RoomWarningData,
    PlayerUpdatedData,
    PlayerDisconnectedData,
    GameStartedData,
    CardRevealedData,
    TurnEndedData,
    GameOverData,
    SpymasterViewData,
    HistoryResultData,
    ReplayData,
    TimerEventData,
    ChatMessageData,
    SpectatorChatData,
    ServerErrorData,
} from './multiplayerTypes.js';

/** Callback signature for registering a socket listener with tracking. */
type RegisterFn = (event: string, handler: (...args: unknown[]) => void) => void;
/** Callback signature for emitting to the adapter's internal event bus (typed). */
type EmitFn = <K extends ClientEventName>(event: K, data: ClientEventMap[K]) => void;
/** Read/write accessors for client state that event handlers need. */
interface ClientState {
    roomCode: string | null;
    player: Player | null;
    sessionId: string | null;
    saveSession(): void;
}

/**
 * Register all Socket.io server-to-client event listeners.
 *
 * @param register - Registers a socket listener and tracks it for cleanup
 * @param emit     - Emits an event to the adapter's internal listener map
 * @param client   - Read/write access to the client state the handlers update
 */
export function registerAllEventListeners(register: RegisterFn, emit: EmitFn, client: ClientState): void {
    // Room events
    register('room:created', (raw: unknown) => {
        const data = raw as RoomCreatedPayload;
        client.roomCode = data.room.code;
        client.player = data.player;
        // Always sync sessionId from server — the server may have assigned a
        // new one if our old session was invalidated during auth.
        if (data.player?.sessionId) {
            client.sessionId = data.player.sessionId;
        }
        client.saveSession();
        emit('roomCreated', data);
    });

    register('room:joined', (raw: unknown) => {
        const data = raw as RoomJoinedPayload;
        client.roomCode = data.room.code;
        client.player = data.you;
        // Always sync sessionId from server — the server may have assigned a
        // new one if our old session was invalidated during auth.
        if (data.you?.sessionId) {
            client.sessionId = data.you.sessionId;
        }
        client.saveSession();
        emit('roomJoined', data);
    });

    register('room:playerJoined', (raw: unknown) => {
        emit('playerJoined', raw as PlayerJoinedData);
    });

    register('room:playerLeft', (raw: unknown) => {
        emit('playerLeft', raw as PlayerLeftData);
    });

    register('room:settingsUpdated', (raw: unknown) => {
        emit('settingsUpdated', raw as SettingsUpdatedData);
    });

    register('room:statsUpdated', (raw: unknown) => {
        emit('statsUpdated', raw as StatsUpdatedData);
    });

    register('room:hostChanged', (raw: unknown) => {
        const data = raw as HostChangedData;
        // Update local player if we became host
        if (client.player && data.newHostSessionId === client.player.sessionId) {
            client.player.isHost = true;
        }
        emit('hostChanged', data);
    });

    // Handle being kicked from the room
    register('room:kicked', (raw: unknown) => {
        client.roomCode = null;
        client.player = null;
        emit('kicked', raw as KickedData);
    });

    // Handle another player being kicked
    register('player:kicked', (raw: unknown) => {
        emit('playerKicked', raw as PlayerKickedData);
    });

    register('room:error', (raw: unknown) => {
        const error = raw as ServerErrorData;
        emit('error', { type: 'room', ...error });
    });

    // Handle room:warning (non-fatal issues like stale stats)
    register('room:warning', (raw: unknown) => {
        emit('roomWarning', raw as RoomWarningData);
    });

    // Handle room:resynced (response to requestResync)
    register('room:resynced', (raw: unknown) => {
        const data = raw as RoomResyncedPayload;
        client.roomCode = data.room?.code ?? client.roomCode;
        client.player = data.you ?? client.player;
        emit('roomResynced', data);
    });

    // Handle room:reconnected (response to token-based reconnection)
    register('room:reconnected', (raw: unknown) => {
        const data = raw as RoomReconnectedPayload;
        client.roomCode = data.room?.code ?? client.roomCode;
        client.player = data.you ?? client.player;
        client.saveSession();
        emit('roomReconnected', data);
    });

    // Player events
    register('player:updated', (raw: unknown) => {
        const data = raw as PlayerUpdatedData;
        if (data.sessionId === client.player?.sessionId && data.changes) {
            client.player = { ...client.player, ...data.changes } as Player;
        }
        emit('playerUpdated', data);
    });

    register('player:disconnected', (raw: unknown) => {
        emit('playerDisconnected', raw as PlayerDisconnectedData);
    });

    register('player:reconnected', (raw: unknown) => {
        emit('playerReconnected', raw as PlayerDisconnectedData);
    });

    // Handle room:playerReconnected (from secure token reconnection)
    register('room:playerReconnected', (raw: unknown) => {
        emit('playerReconnected', raw as PlayerDisconnectedData);
    });

    register('player:error', (raw: unknown) => {
        const error = raw as ServerErrorData;
        emit('error', { type: 'player', ...error });
    });

    // Game events
    register('game:started', (raw: unknown) => {
        emit('gameStarted', raw as GameStartedData);
    });

    register('game:cardRevealed', (raw: unknown) => {
        emit('cardRevealed', raw as CardRevealedData);
    });

    register('game:turnEnded', (raw: unknown) => {
        emit('turnEnded', raw as TurnEndedData);
    });

    register('game:over', (raw: unknown) => {
        emit('gameOver', raw as GameOverData);
    });

    register('game:spymasterView', (raw: unknown) => {
        emit('spymasterView', raw as SpymasterViewData);
    });

    register('game:historyResult', (raw: unknown) => {
        emit('historyResult', raw as HistoryResultData);
    });

    register('game:replayData', (raw: unknown) => {
        emit('replayData', raw as ReplayData);
    });

    register('game:error', (raw: unknown) => {
        const error = raw as ServerErrorData;
        emit('error', { type: 'game', ...error });
    });

    // Timer events
    register('timer:started', (raw: unknown) => {
        emit('timerStarted', raw as TimerEventData);
    });

    register('timer:stopped', (raw: unknown) => {
        emit('timerStopped', raw);
    });

    register('timer:tick', (raw: unknown) => {
        emit('timerTick', raw as TimerEventData);
    });

    register('timer:expired', (raw: unknown) => {
        emit('timerExpired', raw);
    });

    register('timer:status', (raw: unknown) => {
        emit('timerStatus', raw as TimerEventData);
    });

    register('timer:paused', (raw: unknown) => {
        emit('timerPaused', raw as TimerEventData);
    });

    register('timer:resumed', (raw: unknown) => {
        emit('timerResumed', raw as TimerEventData);
    });

    register('timer:timeAdded', (raw: unknown) => {
        emit('timerTimeAdded', raw as TimerEventData);
    });

    // Chat events
    register('chat:message', (raw: unknown) => {
        emit('chatMessage', raw as ChatMessageData);
    });

    register('chat:spectatorMessage', (raw: unknown) => {
        emit('spectatorChatMessage', raw as SpectatorChatData);
    });
}
