/**
 * Codenames Online - WebSocket Client Adapter
 *
 * This module connects the client to the real-time multiplayer server.
 * Socket.io client library is loaded automatically if not already present.
 *
 * Built as an IIFE -- loaded via <script src="/js/socket-client.js">.
 * NOT an ES module. Exposes CodenamesClient on the global window object.
 */
import { logger } from './logger.js';
(function (global) {
    'use strict';
    /**
     * Check whether the Socket.io global `io` is available and valid.
     * io.Manager is a stable export across all Socket.io v4.x releases.
     */
    function isSocketIOReady() {
        return typeof io !== 'undefined' && typeof io === 'function' && typeof io.Manager === 'function';
    }
    /**
     * Dynamically load the Socket.io client library if the static <script>
     * tag failed (network hiccup, stale SRI hash after upgrade, ad-blocker,
     * cached HTML referencing an old bundle, etc.).
     * Returns a Promise that resolves once `io` is available.
     */
    function loadSocketIO() {
        return new Promise((resolve, reject) => {
            if (isSocketIOReady()) {
                resolve();
                return;
            }
            const script = document.createElement('script');
            script.src = '/js/socket.io.min.js';
            script.onload = function () {
                if (isSocketIOReady()) {
                    resolve();
                }
                else {
                    reject(new Error('Socket.io script loaded but io global is missing'));
                }
            };
            script.onerror = function () {
                reject(new Error('Failed to load Socket.io client library. Check your network connection and refresh the page.'));
            };
            document.head.appendChild(script);
        });
    }
    const CodenamesClient = {
        socket: null,
        sessionId: null,
        roomCode: null,
        player: null,
        connected: false,
        reconnectAttempts: 0,
        maxReconnectAttempts: 5,
        autoRejoin: true, // Automatically rejoin room on reconnection
        storedNickname: null, // Remember nickname for reconnection
        listeners: {},
        joinInProgress: false, // Prevent double-join race condition
        createInProgress: false, // Prevent double-create race condition
        _socketListeners: [], // Track socket.io listeners for cleanup
        _offlineQueue: [], // Queue for events sent while disconnected
        _offlineQueueMaxSize: 20, // Max queued events to prevent memory growth
        _nextRequestId: 0, // Incrementing counter for request correlation
        /**
         * Connect to the server
         * @param serverUrl - Server URL (optional, defaults to current host)
         * @param options - Connection options
         */
        connect(serverUrl = null, options = {}) {
            // Ensure Socket.io is loaded before attempting connection.
            // If the static <script> tag failed, dynamically load it.
            const self = this;
            return loadSocketIO().then(function () {
                return self._doConnect(serverUrl, options);
            });
        },
        /**
         * Internal connect implementation (called after io is confirmed available)
         */
        _doConnect(serverUrl = null, options = {}) {
            return new Promise((resolve, reject) => {
                // Use safe storage methods with error handling
                this.sessionId = this._safeGetStorage(sessionStorage, 'codenames-session-id');
                this.storedNickname = this._safeGetStorage(localStorage, 'codenames-nickname');
                this.autoRejoin = options.autoRejoin !== false;
                const url = serverUrl || window.location.origin;
                // Improved transport configuration
                // - Production (HTTPS) uses websocket only for better Fly.io compatibility
                // - Development (HTTP) uses polling + websocket for easier debugging
                // - Use the target URL's protocol, not the page's protocol
                const isSecure = url.startsWith('https://');
                const transports = isSecure ? ['websocket'] : ['polling', 'websocket'];
                const socket = io(url, {
                    auth: {
                        sessionId: this.sessionId
                    },
                    transports: transports,
                    reconnection: true,
                    reconnectionAttempts: this.maxReconnectAttempts,
                    reconnectionDelay: 1000,
                    reconnectionDelayMax: 5000,
                    ...options.socketOptions
                });
                this.socket = socket;
                socket.on('connect', () => {
                    this.connected = true;
                    const wasReconnecting = this.reconnectAttempts > 0;
                    this.reconnectAttempts = 0;
                    logger.debug('Connected to server:', socket.id);
                    this._emit('connected', { wasReconnecting });
                    // Properly handle async _attemptRejoin with error catching
                    if (wasReconnecting && this.autoRejoin) {
                        this._attemptRejoin().catch((err) => {
                            logger.error('Auto-rejoin failed:', err);
                        });
                    }
                    resolve(socket);
                });
                socket.on('disconnect', (reason) => {
                    this.connected = false;
                    // Clear operation flags so they don't block new operations after reconnect
                    this.createInProgress = false;
                    this.joinInProgress = false;
                    logger.debug('Disconnected:', reason);
                    this._emit('disconnected', { reason, wasConnected: true });
                });
                socket.on('connect_error', (error) => {
                    logger.error('Connection error:', error);
                    this.reconnectAttempts++;
                    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
                        reject(error);
                    }
                    this._emit('error', { type: 'connection', error, attempt: this.reconnectAttempts });
                });
                // Set up all event listeners
                this._setupEventListeners();
            });
        },
        /**
         * Attempt to rejoin the previous room
         * Use safe storage methods
         */
        async _attemptRejoin() {
            const storedRoomCode = this.getStoredRoomCode();
            const nickname = this.storedNickname || this.player?.nickname;
            if (!storedRoomCode || !nickname) {
                logger.debug('Cannot auto-rejoin: missing room code or nickname');
                return;
            }
            logger.debug(`Attempting to rejoin room ${storedRoomCode} as ${nickname}`);
            this._emit('rejoining', { roomCode: storedRoomCode, nickname });
            try {
                const result = await this.joinRoom(storedRoomCode, nickname);
                logger.debug('Successfully rejoined room:', storedRoomCode);
                this._emit('rejoined', result);
                // Replay any queued offline events
                this._flushOfflineQueue();
            }
            catch (error) {
                logger.error('Failed to rejoin room:', error);
                // Clear stored room code since it's no longer valid
                this._safeRemoveStorage(sessionStorage, 'codenames-room-code');
                this._emit('rejoinFailed', { roomCode: storedRoomCode, error });
            }
        },
        /**
         * Register a socket listener with tracking for cleanup
         */
        _registerSocketListener(event, handler) {
            this.socket.on(event, handler);
            this._socketListeners.push({ event, handler });
        },
        /**
         * Set up Socket.io event listeners
         */
        _setupEventListeners() {
            // Clear any previous listeners first
            this._cleanupSocketListeners();
            // Room events
            this._registerSocketListener('room:created', (data) => {
                this.roomCode = data.room.code;
                this.player = data.player;
                // Sync sessionId from server if not already set
                // This ensures client knows its server-assigned session ID
                if (data.player?.sessionId && !this.sessionId) {
                    this.sessionId = data.player.sessionId;
                }
                this._saveSession();
                this._emit('roomCreated', data);
            });
            this._registerSocketListener('room:joined', (data) => {
                this.roomCode = data.room.code;
                this.player = data.you;
                // Sync sessionId from server if not already set
                if (data.you?.sessionId && !this.sessionId) {
                    this.sessionId = data.you.sessionId;
                }
                this._saveSession();
                this._emit('roomJoined', data);
            });
            this._registerSocketListener('room:playerJoined', (data) => {
                this._emit('playerJoined', data);
            });
            this._registerSocketListener('room:playerLeft', (data) => {
                this._emit('playerLeft', data);
            });
            this._registerSocketListener('room:settingsUpdated', (data) => {
                this._emit('settingsUpdated', data);
            });
            // Add room:statsUpdated listener
            this._registerSocketListener('room:statsUpdated', (data) => {
                this._emit('statsUpdated', data);
            });
            this._registerSocketListener('room:hostChanged', (data) => {
                // Update local player if we became host
                if (this.player && data.newHostSessionId === this.player.sessionId) {
                    this.player.isHost = true;
                }
                this._emit('hostChanged', data);
            });
            // Handle being kicked from the room
            // Use safe storage methods
            this._registerSocketListener('room:kicked', (data) => {
                this.roomCode = null;
                this.player = null;
                this._safeRemoveStorage(sessionStorage, 'codenames-room-code');
                this._emit('kicked', data);
            });
            // Handle another player being kicked
            this._registerSocketListener('player:kicked', (data) => {
                this._emit('playerKicked', data);
            });
            this._registerSocketListener('room:error', (error) => {
                this._emit('error', { type: 'room', ...error });
            });
            // Handle room:warning (non-fatal issues like stale stats)
            this._registerSocketListener('room:warning', (data) => {
                this._emit('roomWarning', data);
            });
            // Handle room:resynced (response to requestResync)
            this._registerSocketListener('room:resynced', (data) => {
                this.roomCode = data.room.code;
                this.player = data.you;
                this._emit('roomResynced', data);
            });
            // Handle room:reconnected (response to token-based reconnection)
            this._registerSocketListener('room:reconnected', (data) => {
                this.roomCode = data.room.code;
                this.player = data.you;
                this._saveSession();
                this._emit('roomReconnected', data);
            });
            // Player events
            this._registerSocketListener('player:updated', (data) => {
                if (data.sessionId === this.player?.sessionId) {
                    this.player = { ...this.player, ...data.changes };
                }
                this._emit('playerUpdated', data);
            });
            this._registerSocketListener('player:disconnected', (data) => {
                this._emit('playerDisconnected', data);
            });
            this._registerSocketListener('player:reconnected', (data) => {
                this._emit('playerReconnected', data);
            });
            // Handle room:playerReconnected (from secure token reconnection)
            this._registerSocketListener('room:playerReconnected', (data) => {
                this._emit('playerReconnected', data);
            });
            this._registerSocketListener('player:error', (error) => {
                this._emit('error', { type: 'player', ...error });
            });
            // Game events
            this._registerSocketListener('game:started', (data) => {
                this._emit('gameStarted', data);
            });
            this._registerSocketListener('game:cardRevealed', (data) => {
                this._emit('cardRevealed', data);
            });
            this._registerSocketListener('game:turnEnded', (data) => {
                this._emit('turnEnded', data);
            });
            this._registerSocketListener('game:over', (data) => {
                this._emit('gameOver', data);
            });
            this._registerSocketListener('game:spymasterView', (data) => {
                this._emit('spymasterView', data);
            });
            this._registerSocketListener('game:historyData', (data) => {
                this._emit('historyData', data);
            });
            this._registerSocketListener('game:historyResult', (data) => {
                this._emit('historyResult', data);
            });
            this._registerSocketListener('game:replayData', (data) => {
                this._emit('replayData', data);
            });
            this._registerSocketListener('game:error', (error) => {
                this._emit('error', { type: 'game', ...error });
            });
            // Timer events
            this._registerSocketListener('timer:started', (data) => {
                this._emit('timerStarted', data);
            });
            this._registerSocketListener('timer:stopped', (data) => {
                this._emit('timerStopped', data);
            });
            this._registerSocketListener('timer:tick', (data) => {
                this._emit('timerTick', data);
            });
            this._registerSocketListener('timer:expired', (data) => {
                this._emit('timerExpired', data);
            });
            this._registerSocketListener('timer:status', (data) => {
                this._emit('timerStatus', data);
            });
            // Add timer control event listeners
            this._registerSocketListener('timer:paused', (data) => {
                this._emit('timerPaused', data);
            });
            this._registerSocketListener('timer:resumed', (data) => {
                this._emit('timerResumed', data);
            });
            this._registerSocketListener('timer:timeAdded', (data) => {
                this._emit('timerTimeAdded', data);
            });
            // Chat events
            this._registerSocketListener('chat:message', (data) => {
                this._emit('chatMessage', data);
            });
            // Add spectator chat listener
            this._registerSocketListener('chat:spectatorMessage', (data) => {
                this._emit('spectatorChatMessage', data);
            });
        },
        /**
         * Safely set item in storage with quota error handling
         * Handles QuotaExceededError for private browsing mode
         * @param storage - sessionStorage or localStorage
         * @param key - Storage key
         * @param value - Value to store
         * @returns True if successful
         */
        _safeSetStorage(storage, key, value) {
            try {
                storage.setItem(key, value);
                return true;
            }
            catch (e) {
                // QuotaExceededError in private browsing or when storage is full
                if (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
                    logger.warn(`Storage quota exceeded for ${key}, continuing without persistence`);
                }
                else {
                    logger.error(`Storage error for ${key}:`, e);
                }
                return false;
            }
        },
        /**
         * Safely get item from storage
         * Handles storage access errors
         * @param storage - sessionStorage or localStorage
         * @param key - Storage key
         * @returns Stored value or null
         */
        _safeGetStorage(storage, key) {
            try {
                return storage.getItem(key);
            }
            catch (e) {
                logger.warn(`Storage access error for ${key}:`, e);
                return null;
            }
        },
        /**
         * Safely remove item from storage
         * Handles storage access errors
         * @param storage - sessionStorage or localStorage
         * @param key - Storage key
         */
        _safeRemoveStorage(storage, key) {
            try {
                storage.removeItem(key);
            }
            catch (e) {
                logger.warn(`Storage removal error for ${key}:`, e);
            }
        },
        /**
         * Save session to storage
         * Session ID uses sessionStorage (per-tab) with error handling
         * Room code and nickname use localStorage for user convenience across tabs
         */
        _saveSession() {
            if (this.sessionId) {
                this._safeSetStorage(sessionStorage, 'codenames-session-id', this.sessionId);
            }
            if (this.roomCode) {
                // Use sessionStorage for room code to prevent multi-tab conflicts
                this._safeSetStorage(sessionStorage, 'codenames-room-code', this.roomCode);
            }
            if (this.player?.nickname) {
                this._safeSetStorage(localStorage, 'codenames-nickname', this.player.nickname);
                this.storedNickname = this.player.nickname;
            }
        },
        /**
         * Cleanup socket listeners to prevent memory leaks
         * Call this before reinitializing or disconnecting
         */
        _cleanupSocketListeners() {
            if (this.socket && this._socketListeners.length > 0) {
                this._socketListeners.forEach(({ event, handler }) => {
                    this.socket.off(event, handler);
                });
            }
            this._socketListeners = [];
        },
        /**
         * Queue a socket event to send when reconnected, or emit immediately if connected.
         * Only queues safe-to-replay events (chat messages, non-state-changing actions).
         * @param event - Socket event name
         * @param data - Event data
         */
        _queueOrEmit(event, data) {
            if (this.isConnected()) {
                this.socket.emit(event, data);
            }
            else {
                // Only queue certain safe events (chat messages)
                const queueableEvents = ['chat:message', 'chat:spectator'];
                if (queueableEvents.includes(event) && this._offlineQueue.length < this._offlineQueueMaxSize) {
                    this._offlineQueue.push({ event, data, timestamp: Date.now() });
                }
            }
        },
        /**
         * Flush queued offline events after reconnection.
         * Only replays events less than 2 minutes old.
         */
        _flushOfflineQueue() {
            if (this._offlineQueue.length === 0)
                return;
            const maxAge = 2 * 60 * 1000; // 2 minutes
            const now = Date.now();
            let replayed = 0;
            for (const item of this._offlineQueue) {
                if (now - item.timestamp < maxAge && this.isConnected()) {
                    this.socket.emit(item.event, item.data);
                    replayed++;
                }
            }
            if (replayed > 0) {
                logger.debug(`Replayed ${replayed} queued event(s) after reconnection`);
            }
            this._offlineQueue = [];
        },
        /**
         * Generate a unique request ID for correlating server responses.
         * Uses an incrementing counter (sufficient for per-connection correlation).
         */
        _generateRequestId() {
            this._nextRequestId = (this._nextRequestId + 1) % Number.MAX_SAFE_INTEGER;
            return 'req_' + this._nextRequestId;
        },
        /**
         * Emit event to listeners
         */
        _emit(event, data) {
            const callbacks = this.listeners[event] || [];
            callbacks.forEach((cb) => {
                try {
                    cb(data);
                }
                catch (err) {
                    logger.error(`Error in ${event} listener:`, err);
                }
            });
        },
        /**
         * Register event listener
         * @param event - Event name
         * @param callback - Callback function
         */
        on(event, callback) {
            if (!this.listeners[event]) {
                this.listeners[event] = [];
            }
            this.listeners[event].push(callback);
            return this;
        },
        /**
         * Remove event listener
         * @param event - Event name
         * @param callback - Callback function (optional, removes all if not provided)
         */
        off(event, callback) {
            if (!callback) {
                delete this.listeners[event];
            }
            else if (this.listeners[event]) {
                this.listeners[event] = this.listeners[event].filter((cb) => cb !== callback);
            }
            return this;
        },
        /**
         * Register one-time event listener
         * @param event - Event name
         * @param callback - Callback function
         */
        once(event, callback) {
            const wrapper = (data) => {
                this.off(event, wrapper);
                callback(data);
            };
            return this.on(event, wrapper);
        },
        // =====================
        // Room Actions
        // =====================
        /**
         * Create a new room
         * Proper listener cleanup and timeout cancellation
         * @param options - Room options including roomId and settings
         */
        createRoom(options = { roomId: '' }) {
            // Prevent double-create race condition
            if (this.createInProgress) {
                return Promise.reject(new Error('Room creation already in progress'));
            }
            this.createInProgress = true;
            return new Promise((resolve, reject) => {
                const { roomId, nickname, ...settings } = options;
                if (!roomId) {
                    this.createInProgress = false;
                    reject(new Error('Room ID is required'));
                    return;
                }
                const requestId = this._generateRequestId();
                let timeoutId = null;
                let settled = false;
                const cleanup = () => {
                    this.createInProgress = false;
                    if (timeoutId) {
                        clearTimeout(timeoutId);
                        timeoutId = null;
                    }
                    this.off('roomCreated', onCreated);
                    this.off('error', onError);
                };
                const onCreated = (data) => {
                    if (settled)
                        return;
                    settled = true;
                    cleanup();
                    resolve(data);
                };
                const onError = (error) => {
                    if (settled)
                        return;
                    // Connection errors always match (not from server handler)
                    if (error.type === 'connection') {
                        settled = true;
                        cleanup();
                        reject(error);
                        return;
                    }
                    if (error.type === 'room') {
                        // Only match errors correlated to our request (ignore other operations' errors)
                        if (error.requestId !== undefined && error.requestId !== requestId)
                            return;
                        settled = true;
                        cleanup();
                        reject(error);
                    }
                };
                this.on('roomCreated', onCreated);
                this.on('error', onError);
                // Send roomId, settings, and requestId to server
                this.socket.emit('room:create', {
                    roomId,
                    settings: { nickname, ...settings },
                    requestId
                });
                // Timeout matches server SOCKET_HANDLER timeout (30s)
                timeoutId = setTimeout(() => {
                    if (settled)
                        return;
                    settled = true;
                    cleanup();
                    reject(new Error('Create room timeout'));
                }, 30000);
            });
        },
        /**
         * Join an existing room
         * Proper listener cleanup and timeout cancellation
         * @param roomId - Room ID to join
         * @param nickname - Player nickname
         */
        joinRoom(roomId, nickname) {
            // Prevent double-join race condition
            if (this.joinInProgress) {
                return Promise.reject(new Error('Join already in progress'));
            }
            this.joinInProgress = true;
            return new Promise((resolve, reject) => {
                const requestId = this._generateRequestId();
                let timeoutId = null;
                let settled = false;
                const cleanup = () => {
                    this.joinInProgress = false;
                    if (timeoutId) {
                        clearTimeout(timeoutId);
                        timeoutId = null;
                    }
                    this.off('roomJoined', onJoined);
                    this.off('error', onError);
                };
                const onJoined = (data) => {
                    if (settled)
                        return;
                    settled = true;
                    cleanup();
                    resolve(data);
                };
                const onError = (error) => {
                    if (settled)
                        return;
                    // Connection errors always match (not from server handler)
                    if (error.type === 'connection') {
                        settled = true;
                        cleanup();
                        reject(error);
                        return;
                    }
                    if (error.type === 'room') {
                        // Only match errors correlated to our request (ignore other operations' errors)
                        if (error.requestId !== undefined && error.requestId !== requestId)
                            return;
                        settled = true;
                        cleanup();
                        reject(error);
                    }
                };
                this.on('roomJoined', onJoined);
                this.on('error', onError);
                // Send roomId, nickname, and requestId to server
                this.socket.emit('room:join', { roomId, nickname, requestId });
                // Client timeout (20s) exceeds server JOIN_ROOM timeout (15s) to
                // account for post-join processing (stats, token invalidation) and network latency.
                timeoutId = setTimeout(() => {
                    if (settled)
                        return;
                    settled = true;
                    cleanup();
                    reject(new Error('Join room timeout'));
                }, 20000);
            });
        },
        /**
         * Leave current room
         * Use safe storage methods
         */
        leaveRoom() {
            this.socket.emit('room:leave');
            this.roomCode = null;
            this.player = null;
            this._safeRemoveStorage(sessionStorage, 'codenames-room-code');
        },
        /**
         * Update room settings (host only)
         * @param settings - New settings
         */
        updateSettings(settings) {
            this.socket.emit('room:settings', settings);
        },
        /**
         * Kick a player from the room (host only)
         * @param targetSessionId - Session ID of player to kick
         */
        kickPlayer(targetSessionId) {
            if (!this.player?.isHost) {
                logger.warn('Only the host can kick players');
                return;
            }
            this.socket.emit('player:kick', { targetSessionId });
        },
        /**
         * Request full state resync from server
         * Proper listener cleanup and timeout cancellation
         * Use this if you detect you're out of sync
         */
        requestResync() {
            return new Promise((resolve, reject) => {
                if (!this.roomCode) {
                    reject(new Error('Not in a room'));
                    return;
                }
                const requestId = this._generateRequestId();
                let timeoutId = null;
                let settled = false;
                const cleanup = () => {
                    if (timeoutId) {
                        clearTimeout(timeoutId);
                        timeoutId = null;
                    }
                    this.off('roomResynced', onResynced);
                    this.off('error', onError);
                };
                const onResynced = (data) => {
                    if (settled)
                        return;
                    settled = true;
                    cleanup();
                    resolve(data);
                };
                const onError = (error) => {
                    if (settled)
                        return;
                    // Connection errors always match (not from server handler)
                    if (error.type === 'connection') {
                        settled = true;
                        cleanup();
                        reject(error);
                        return;
                    }
                    if (error.type === 'room') {
                        // Only match errors correlated to our request (ignore other operations' errors)
                        if (error.requestId !== undefined && error.requestId !== requestId)
                            return;
                        settled = true;
                        cleanup();
                        reject(error);
                    }
                };
                this.on('roomResynced', onResynced);
                this.on('error', onError);
                this.socket.emit('room:resync', { requestId });
                timeoutId = setTimeout(() => {
                    if (settled)
                        return;
                    settled = true;
                    cleanup();
                    reject(new Error('Resync timeout'));
                }, 10000);
            });
        },
        // =====================
        // Player Actions
        // =====================
        /**
         * Join a team
         * @param team - 'red', 'blue', or null to leave team
         * @param callback - Optional acknowledgement callback
         */
        setTeam(team, callback) {
            this.socket.emit('player:setTeam', { team }, callback);
        },
        /**
         * Set player role
         * @param role - 'spymaster', 'guesser', or 'spectator'
         * @param callback - Optional acknowledgement callback
         */
        setRole(role, callback) {
            this.socket.emit('player:setRole', { role }, callback);
        },
        /**
         * Change nickname
         * @param nickname - New nickname
         */
        setNickname(nickname) {
            this.socket.emit('player:setNickname', { nickname });
        },
        // =====================
        // Game Actions
        // =====================
        /**
         * Start a new game (host only)
         * @param options - Game options
         */
        startGame(options = {}) {
            this.socket.emit('game:start', options);
        },
        /**
         * Reveal a card (host only)
         * @param index - Card index (0-24)
         */
        revealCard(index) {
            this.socket.emit('game:reveal', { index });
        },
        /**
         * End current turn (host only)
         */
        endTurn() {
            this.socket.emit('game:endTurn');
        },
        /**
         * Forfeit the game (host only)
         */
        forfeit() {
            this.socket.emit('game:forfeit');
        },
        /**
         * Request game history (current game moves)
         */
        getHistory() {
            this.socket.emit('game:history');
        },
        /**
         * Request past games history for replay
         * @param limit - Maximum number of games to return
         */
        getGameHistory(limit = 10) {
            this.socket.emit('game:getHistory', { limit });
        },
        /**
         * Request replay data for a specific game
         * @param gameId - Game ID to replay
         */
        getReplay(gameId) {
            this.socket.emit('game:getReplay', { gameId });
        },
        // =====================
        // Chat Actions
        // =====================
        /**
         * Send a chat message
         * @param text - Message text
         * @param teamOnly - Send to team only
         */
        sendMessage(text, teamOnly = false) {
            this._queueOrEmit('chat:message', { text, teamOnly });
        },
        /**
         * Send a spectator-only chat message
         * @param message - Message text
         */
        sendSpectatorChat(message) {
            if (!message?.trim())
                return;
            this._queueOrEmit('chat:spectator', { message: message.trim() });
        },
        // =====================
        // Utility
        // =====================
        /**
         * Disconnect from server
         */
        disconnect() {
            // Cleanup socket listeners before disconnecting
            this._cleanupSocketListeners();
            if (this.socket) {
                this.socket.disconnect();
                this.socket = null;
            }
            this.connected = false;
            this.roomCode = null;
            this.player = null;
            this.joinInProgress = false;
            this.createInProgress = false;
            this._offlineQueue = [];
        },
        /**
         * Check if Socket.io library is available
         */
        isSocketIOAvailable() {
            return isSocketIOReady();
        },
        /**
         * Check if connected
         */
        isConnected() {
            return this.connected && !!this.socket?.connected;
        },
        /**
         * Check if in a room
         */
        isInRoom() {
            return !!this.roomCode;
        },
        /**
         * Check if current player is host
         */
        isHost() {
            return this.player?.isHost === true;
        },
        /**
         * Check if current player is spymaster
         */
        isSpymaster() {
            return this.player?.role === 'spymaster';
        },
        /**
         * Get current room code
         */
        getRoomCode() {
            return this.roomCode;
        },
        /**
         * Get current player
         */
        getPlayer() {
            return this.player;
        },
        /**
         * Get stored room code (for reconnection)
         * Uses safe storage methods
         * Uses sessionStorage to prevent multi-tab conflicts
         */
        getStoredRoomCode() {
            return this._safeGetStorage(sessionStorage, 'codenames-room-code');
        },
        /**
         * Get stored nickname
         * Uses safe storage methods
         */
        getStoredNickname() {
            return this._safeGetStorage(localStorage, 'codenames-nickname');
        },
        /**
         * Clear all stored session data
         * Uses safe storage methods
         * Session ID and room code use sessionStorage (per-tab)
         * Nickname uses localStorage for user convenience
         */
        clearSession() {
            this._safeRemoveStorage(sessionStorage, 'codenames-session-id');
            this._safeRemoveStorage(sessionStorage, 'codenames-room-code');
            this._safeRemoveStorage(localStorage, 'codenames-nickname');
            this.sessionId = null;
            this.storedNickname = null;
            this.joinInProgress = false;
            this.createInProgress = false;
        },
        /**
         * Enable or disable auto-rejoin
         * @param enabled - Whether auto-rejoin is enabled
         */
        setAutoRejoin(enabled) {
            this.autoRejoin = enabled;
        }
    };
    // Export to global scope
    global.CodenamesClient = CodenamesClient;
})(typeof window !== 'undefined' ? window : globalThis);
//# sourceMappingURL=socket-client.js.map