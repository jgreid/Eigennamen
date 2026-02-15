/**
 * Socket.io event listener registration for the Codenames WebSocket Client.
 *
 * Extracted from socket-client.ts. Registers all server-to-client event
 * listeners and maps them to the adapter's internal event bus.
 */

import type { Player } from './socket-client-types.js';

/** Callback signature for registering a socket listener with tracking. */
type RegisterFn = (event: string, handler: (...args: any[]) => void) => void;
/** Callback signature for emitting to the adapter's internal event bus. */
type EmitFn = (event: string, data: any) => void;
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
export function registerAllEventListeners(
    register: RegisterFn,
    emit: EmitFn,
    client: ClientState
): void {
    // Room events
    register('room:created', (data: any) => {
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

    register('room:joined', (data: any) => {
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

    register('room:playerJoined', (data: any) => {
        emit('playerJoined', data);
    });

    register('room:playerLeft', (data: any) => {
        emit('playerLeft', data);
    });

    register('room:settingsUpdated', (data: any) => {
        emit('settingsUpdated', data);
    });

    register('room:statsUpdated', (data: any) => {
        emit('statsUpdated', data);
    });

    register('room:hostChanged', (data: any) => {
        // Update local player if we became host
        if (client.player && data.newHostSessionId === client.player.sessionId) {
            client.player.isHost = true;
        }
        emit('hostChanged', data);
    });

    // Handle being kicked from the room
    register('room:kicked', (data: any) => {
        client.roomCode = null;
        client.player = null;
        emit('kicked', data);
    });

    // Handle another player being kicked
    register('player:kicked', (data: any) => {
        emit('playerKicked', data);
    });

    register('room:error', (error: any) => {
        emit('error', { type: 'room', ...error });
    });

    // Handle room:warning (non-fatal issues like stale stats)
    register('room:warning', (data: any) => {
        emit('roomWarning', data);
    });

    // Handle room:resynced (response to requestResync)
    register('room:resynced', (data: any) => {
        client.roomCode = data.room.code;
        client.player = data.you;
        emit('roomResynced', data);
    });

    // Handle room:reconnected (response to token-based reconnection)
    register('room:reconnected', (data: any) => {
        client.roomCode = data.room.code;
        client.player = data.you;
        client.saveSession();
        emit('roomReconnected', data);
    });

    // Player events
    register('player:updated', (data: any) => {
        if (data.sessionId === client.player?.sessionId) {
            client.player = { ...client.player, ...data.changes };
        }
        emit('playerUpdated', data);
    });

    register('player:disconnected', (data: any) => {
        emit('playerDisconnected', data);
    });

    register('player:reconnected', (data: any) => {
        emit('playerReconnected', data);
    });

    // Handle room:playerReconnected (from secure token reconnection)
    register('room:playerReconnected', (data: any) => {
        emit('playerReconnected', data);
    });

    register('player:error', (error: any) => {
        emit('error', { type: 'player', ...error });
    });

    // Game events
    register('game:started', (data: any) => {
        emit('gameStarted', data);
    });

    register('game:cardRevealed', (data: any) => {
        emit('cardRevealed', data);
    });

    register('game:turnEnded', (data: any) => {
        emit('turnEnded', data);
    });

    register('game:over', (data: any) => {
        emit('gameOver', data);
    });

    register('game:spymasterView', (data: any) => {
        emit('spymasterView', data);
    });

    register('game:historyData', (data: any) => {
        emit('historyData', data);
    });

    register('game:historyResult', (data: any) => {
        emit('historyResult', data);
    });

    register('game:replayData', (data: any) => {
        emit('replayData', data);
    });

    register('game:error', (error: any) => {
        emit('error', { type: 'game', ...error });
    });

    // Timer events
    register('timer:started', (data: any) => {
        emit('timerStarted', data);
    });

    register('timer:stopped', (data: any) => {
        emit('timerStopped', data);
    });

    register('timer:tick', (data: any) => {
        emit('timerTick', data);
    });

    register('timer:expired', (data: any) => {
        emit('timerExpired', data);
    });

    register('timer:status', (data: any) => {
        emit('timerStatus', data);
    });

    register('timer:paused', (data: any) => {
        emit('timerPaused', data);
    });

    register('timer:resumed', (data: any) => {
        emit('timerResumed', data);
    });

    register('timer:timeAdded', (data: any) => {
        emit('timerTimeAdded', data);
    });

    // Chat events
    register('chat:message', (data: any) => {
        emit('chatMessage', data);
    });

    register('chat:spectatorMessage', (data: any) => {
        emit('spectatorChatMessage', data);
    });
}
