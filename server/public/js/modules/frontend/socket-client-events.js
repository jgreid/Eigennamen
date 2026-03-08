/**
 * Socket.io event listener registration for the Eigennamen WebSocket Client.
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
    register('room:created', (raw) => {
        const data = raw;
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
    register('room:joined', (raw) => {
        const data = raw;
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
    register('room:playerJoined', (raw) => {
        emit('playerJoined', raw);
    });
    register('room:playerLeft', (raw) => {
        emit('playerLeft', raw);
    });
    register('room:settingsUpdated', (raw) => {
        emit('settingsUpdated', raw);
    });
    register('room:statsUpdated', (raw) => {
        emit('statsUpdated', raw);
    });
    register('room:hostChanged', (raw) => {
        const data = raw;
        // Update local player if we became host
        if (client.player && data.newHostSessionId === client.player.sessionId) {
            client.player.isHost = true;
        }
        emit('hostChanged', data);
    });
    // Handle being kicked from the room
    register('room:kicked', (raw) => {
        client.roomCode = null;
        client.player = null;
        emit('kicked', raw);
    });
    // Handle another player being kicked
    register('player:kicked', (raw) => {
        emit('playerKicked', raw);
    });
    register('room:error', (raw) => {
        const error = raw;
        emit('error', { type: 'room', ...error });
    });
    // Handle room:warning (non-fatal issues like stale stats)
    register('room:warning', (raw) => {
        emit('roomWarning', raw);
    });
    // Handle room:resynced (response to requestResync)
    register('room:resynced', (raw) => {
        const data = raw;
        client.roomCode = data.room?.code ?? client.roomCode;
        client.player = data.you ?? client.player;
        emit('roomResynced', data);
    });
    // Handle room:reconnected (response to token-based reconnection)
    register('room:reconnected', (raw) => {
        const data = raw;
        client.roomCode = data.room?.code ?? client.roomCode;
        client.player = data.you ?? client.player;
        client.saveSession();
        emit('roomReconnected', data);
    });
    // Player events
    register('player:updated', (raw) => {
        const data = raw;
        if (data.sessionId === client.player?.sessionId && data.changes) {
            client.player = { ...client.player, ...data.changes };
        }
        emit('playerUpdated', data);
    });
    register('player:disconnected', (raw) => {
        emit('playerDisconnected', raw);
    });
    register('player:reconnected', (raw) => {
        emit('playerReconnected', raw);
    });
    // Handle room:playerReconnected (from secure token reconnection)
    register('room:playerReconnected', (raw) => {
        emit('playerReconnected', raw);
    });
    register('player:error', (raw) => {
        const error = raw;
        emit('error', { type: 'player', ...error });
    });
    // Game events
    register('game:started', (raw) => {
        emit('gameStarted', raw);
    });
    register('game:cardRevealed', (raw) => {
        emit('cardRevealed', raw);
    });
    register('game:turnEnded', (raw) => {
        emit('turnEnded', raw);
    });
    register('game:over', (raw) => {
        emit('gameOver', raw);
    });
    register('game:roundEnded', (raw) => {
        emit('game:roundEnded', raw);
    });
    register('game:matchOver', (raw) => {
        emit('game:matchOver', raw);
    });
    register('game:spymasterView', (raw) => {
        emit('spymasterView', raw);
    });
    register('game:historyResult', (raw) => {
        emit('historyResult', raw);
    });
    register('game:replayData', (raw) => {
        emit('replayData', raw);
    });
    register('game:historyCleared', (raw) => {
        emit('historyCleared', raw);
    });
    register('game:error', (raw) => {
        const error = raw;
        emit('error', { type: 'game', ...error });
    });
    // Timer events
    register('timer:started', (raw) => {
        emit('timerStarted', raw);
    });
    register('timer:stopped', (raw) => {
        emit('timerStopped', raw);
    });
    register('timer:tick', (raw) => {
        emit('timerTick', raw);
    });
    register('timer:expired', (raw) => {
        emit('timerExpired', raw);
    });
    register('timer:status', (raw) => {
        emit('timerStatus', raw);
    });
    register('timer:paused', (raw) => {
        emit('timerPaused', raw);
    });
    register('timer:resumed', (raw) => {
        emit('timerResumed', raw);
    });
    register('timer:timeAdded', (raw) => {
        emit('timerTimeAdded', raw);
    });
    // Chat events
    register('chat:message', (raw) => {
        emit('chatMessage', raw);
    });
    register('chat:spectatorMessage', (raw) => {
        emit('spectatorChatMessage', raw);
    });
}
//# sourceMappingURL=socket-client-events.js.map