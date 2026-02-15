/**
 * Socket.io event listener registration for the Codenames WebSocket Client.
 *
 * Extracted from socket-client.ts. Registers all server-to-client event
 * listeners and maps them to the adapter's internal event bus.
 */
/**
 * Register all Socket.io server-to-client event listeners.
 *
 * @param register - Registers a socket listener and tracks it for cleanup
 * @param emit     - Emits an event to the adapter's internal listener map
 * @param client   - Read/write access to the client state the handlers update
 */
export function registerAllEventListeners(register, emit, client) {
    // Room events
    register('room:created', (data) => {
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
    register('room:joined', (data) => {
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
    register('room:playerJoined', (data) => {
        emit('playerJoined', data);
    });
    register('room:playerLeft', (data) => {
        emit('playerLeft', data);
    });
    register('room:settingsUpdated', (data) => {
        emit('settingsUpdated', data);
    });
    register('room:statsUpdated', (data) => {
        emit('statsUpdated', data);
    });
    register('room:hostChanged', (data) => {
        // Update local player if we became host
        if (client.player && data.newHostSessionId === client.player.sessionId) {
            client.player.isHost = true;
        }
        emit('hostChanged', data);
    });
    // Handle being kicked from the room
    register('room:kicked', (data) => {
        client.roomCode = null;
        client.player = null;
        emit('kicked', data);
    });
    // Handle another player being kicked
    register('player:kicked', (data) => {
        emit('playerKicked', data);
    });
    register('room:error', (error) => {
        emit('error', { type: 'room', ...error });
    });
    // Handle room:warning (non-fatal issues like stale stats)
    register('room:warning', (data) => {
        emit('roomWarning', data);
    });
    // Handle room:resynced (response to requestResync)
    register('room:resynced', (data) => {
        client.roomCode = data.room.code;
        client.player = data.you;
        emit('roomResynced', data);
    });
    // Handle room:reconnected (response to token-based reconnection)
    register('room:reconnected', (data) => {
        client.roomCode = data.room.code;
        client.player = data.you;
        client.saveSession();
        emit('roomReconnected', data);
    });
    // Player events
    register('player:updated', (data) => {
        if (data.sessionId === client.player?.sessionId) {
            client.player = { ...client.player, ...data.changes };
        }
        emit('playerUpdated', data);
    });
    register('player:disconnected', (data) => {
        emit('playerDisconnected', data);
    });
    register('player:reconnected', (data) => {
        emit('playerReconnected', data);
    });
    // Handle room:playerReconnected (from secure token reconnection)
    register('room:playerReconnected', (data) => {
        emit('playerReconnected', data);
    });
    register('player:error', (error) => {
        emit('error', { type: 'player', ...error });
    });
    // Game events
    register('game:started', (data) => {
        emit('gameStarted', data);
    });
    register('game:cardRevealed', (data) => {
        emit('cardRevealed', data);
    });
    register('game:turnEnded', (data) => {
        emit('turnEnded', data);
    });
    register('game:over', (data) => {
        emit('gameOver', data);
    });
    register('game:spymasterView', (data) => {
        emit('spymasterView', data);
    });
    register('game:historyData', (data) => {
        emit('historyData', data);
    });
    register('game:historyResult', (data) => {
        emit('historyResult', data);
    });
    register('game:replayData', (data) => {
        emit('replayData', data);
    });
    register('game:error', (error) => {
        emit('error', { type: 'game', ...error });
    });
    // Timer events
    register('timer:started', (data) => {
        emit('timerStarted', data);
    });
    register('timer:stopped', (data) => {
        emit('timerStopped', data);
    });
    register('timer:tick', (data) => {
        emit('timerTick', data);
    });
    register('timer:expired', (data) => {
        emit('timerExpired', data);
    });
    register('timer:status', (data) => {
        emit('timerStatus', data);
    });
    register('timer:paused', (data) => {
        emit('timerPaused', data);
    });
    register('timer:resumed', (data) => {
        emit('timerResumed', data);
    });
    register('timer:timeAdded', (data) => {
        emit('timerTimeAdded', data);
    });
    // Chat events
    register('chat:message', (data) => {
        emit('chatMessage', data);
    });
    register('chat:spectatorMessage', (data) => {
        emit('spectatorChatMessage', data);
    });
}
//# sourceMappingURL=socket-client-events.js.map