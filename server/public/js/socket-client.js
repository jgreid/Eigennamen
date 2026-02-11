/**
 * Codenames Online - WebSocket Client Adapter
 *
 * This module connects the client to the real-time multiplayer server.
 * Include Socket.io client library before this script:
 * <script src="/js/socket.io.min.js"></script>
 */

(function(global) {
    'use strict';

    const CodenamesClient = {
        socket: null,
        sessionId: null,
        roomCode: null,
        player: null,
        connected: false,
        reconnectAttempts: 0,
        maxReconnectAttempts: 5,
        autoRejoin: true,           // Automatically rejoin room on reconnection
        storedNickname: null,       // Remember nickname for reconnection
        listeners: {},
        joinInProgress: false,      // Prevent double-join race condition
        createInProgress: false,    // Prevent double-create race condition
        _socketListeners: [],       // Track socket.io listeners for cleanup
        _offlineQueue: [],          // Queue for events sent while disconnected
        _offlineQueueMaxSize: 20,   // Max queued events to prevent memory growth

        /**
         * Connect to the server
         * @param {string} serverUrl - Server URL (optional, defaults to current host)
         * @param {Object} options - Connection options
         * @returns {Promise}
         */
        connect(serverUrl = null, options = {}) {
            return new Promise((resolve, reject) => {
                // Check if Socket.io library is loaded and is the genuine constructor
                // CRITICAL FIX: Validate io is actually the Socket.io factory function
                if (typeof io === 'undefined' || typeof io !== 'function' || typeof io.protocol === 'undefined') {
                    reject(new Error('Socket.io client library not loaded. Please check your network connection and refresh the page.'));
                    return;
                }

                // ISSUE #5 & #48 FIX: Use safe storage methods with error handling
                this.sessionId = this._safeGetStorage(sessionStorage, 'codenames-session-id');
                this.storedNickname = this._safeGetStorage(localStorage, 'codenames-nickname');
                this.autoRejoin = options.autoRejoin !== false;

                const url = serverUrl || window.location.origin;

                // ISSUE #26 FIX: Improved transport configuration
                // - Production (HTTPS) uses websocket only for better Fly.io compatibility
                // - Development (HTTP) uses polling + websocket for easier debugging
                // - Use the target URL's protocol, not the page's protocol
                const isSecure = url.startsWith('https://');
                const transports = isSecure ? ['websocket'] : ['polling', 'websocket'];

                this.socket = io(url, {
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

                this.socket.on('connect', () => {
                    this.connected = true;
                    const wasReconnecting = this.reconnectAttempts > 0;
                    this.reconnectAttempts = 0;
                    console.log('Connected to server:', this.socket.id);

                    this._emit('connected', { wasReconnecting });

                    // ISSUE #11 FIX: Properly handle async _attemptRejoin with error catching
                    if (wasReconnecting && this.autoRejoin) {
                        this._attemptRejoin().catch(err => {
                            console.error('Auto-rejoin failed:', err);
                        });
                    }

                    resolve(this.socket);
                });

                this.socket.on('disconnect', (reason) => {
                    this.connected = false;
                    console.log('Disconnected:', reason);
                    this._emit('disconnected', { reason, wasConnected: true });
                });

                this.socket.on('connect_error', (error) => {
                    console.error('Connection error:', error);
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
         * ISSUE #5 FIX: Use safe storage methods
         */
        async _attemptRejoin() {
            const storedRoomCode = this.getStoredRoomCode();
            const nickname = this.storedNickname || this.player?.nickname;

            if (!storedRoomCode || !nickname) {
                console.log('Cannot auto-rejoin: missing room code or nickname');
                return;
            }

            console.log(`Attempting to rejoin room ${storedRoomCode} as ${nickname}`);
            this._emit('rejoining', { roomCode: storedRoomCode, nickname });

            try {
                const result = await this.joinRoom(storedRoomCode, nickname);
                console.log('Successfully rejoined room:', storedRoomCode);
                this._emit('rejoined', result);
                // Replay any queued offline events
                this._flushOfflineQueue();
            } catch (error) {
                console.error('Failed to rejoin room:', error);
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
                // ISSUE FIX: Sync sessionId from server if not already set
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
                // ISSUE FIX: Sync sessionId from server if not already set
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

            // ISSUE FIX: Add missing room:statsUpdated listener
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
            // ISSUE #5 FIX: Use safe storage methods
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

            this._registerSocketListener('game:clueGiven', (data) => {
                this._emit('clueGiven', data);
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

            // ISSUE FIX: Add missing timer control event listeners
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

            // ISSUE FIX: Add missing spectator chat listener
            this._registerSocketListener('chat:spectatorMessage', (data) => {
                this._emit('spectatorChatMessage', data);
            });
        },

        /**
         * Safely set item in storage with quota error handling
         * ISSUE #5 FIX: Handles QuotaExceededError for private browsing mode
         * @param {Storage} storage - sessionStorage or localStorage
         * @param {string} key - Storage key
         * @param {string} value - Value to store
         * @returns {boolean} True if successful
         */
        _safeSetStorage(storage, key, value) {
            try {
                storage.setItem(key, value);
                return true;
            } catch (e) {
                // QuotaExceededError in private browsing or when storage is full
                if (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
                    console.warn(`Storage quota exceeded for ${key}, continuing without persistence`);
                } else {
                    console.error(`Storage error for ${key}:`, e);
                }
                return false;
            }
        },

        /**
         * Safely get item from storage
         * ISSUE #5 FIX: Handles storage access errors
         * @param {Storage} storage - sessionStorage or localStorage
         * @param {string} key - Storage key
         * @returns {string|null} Stored value or null
         */
        _safeGetStorage(storage, key) {
            try {
                return storage.getItem(key);
            } catch (e) {
                console.warn(`Storage access error for ${key}:`, e);
                return null;
            }
        },

        /**
         * Safely remove item from storage
         * ISSUE #5 FIX: Handles storage access errors
         * @param {Storage} storage - sessionStorage or localStorage
         * @param {string} key - Storage key
         */
        _safeRemoveStorage(storage, key) {
            try {
                storage.removeItem(key);
            } catch (e) {
                console.warn(`Storage removal error for ${key}:`, e);
            }
        },

        /**
         * Save session to storage
         * ISSUE #5 & #48 FIX: Session ID uses sessionStorage (per-tab) with error handling
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
         * @param {string} event - Socket event name
         * @param {Object} data - Event data
         */
        _queueOrEmit(event, data) {
            if (this.isConnected()) {
                this.socket.emit(event, data);
            } else {
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
            if (this._offlineQueue.length === 0) return;

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
                console.log(`Replayed ${replayed} queued event(s) after reconnection`);
            }
            this._offlineQueue = [];
        },

        /**
         * Emit event to listeners
         */
        _emit(event, data) {
            const callbacks = this.listeners[event] || [];
            callbacks.forEach(cb => {
                try {
                    cb(data);
                } catch (err) {
                    console.error(`Error in ${event} listener:`, err);
                }
            });
        },

        /**
         * Register event listener
         * @param {string} event - Event name
         * @param {Function} callback - Callback function
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
         * @param {string} event - Event name
         * @param {Function} callback - Callback function (optional, removes all if not provided)
         */
        off(event, callback) {
            if (!callback) {
                delete this.listeners[event];
            } else if (this.listeners[event]) {
                this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
            }
            return this;
        },

        /**
         * Register one-time event listener
         * @param {string} event - Event name
         * @param {Function} callback - Callback function
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
         * ISSUE #6 & #20 FIX: Proper listener cleanup and timeout cancellation
         * @param {Object} options - Room options including roomId and settings
         * @param {string} options.roomId - Room ID (required) - serves as room name and access key
         * @param {string} options.nickname - Host nickname (optional)
         * @param {Object} options.settings - Additional room settings (optional)
         * @returns {Promise}
         */
        createRoom(options = {}) {
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
                    if (settled) return;
                    settled = true;
                    cleanup();
                    resolve(data);
                };

                // ISSUE #6 FIX: Clean up on ANY error, not just room errors
                const onError = (error) => {
                    if (settled) return;
                    if (error.type === 'room' || error.type === 'connection') {
                        settled = true;
                        cleanup();
                        reject(error);
                    }
                };

                this.on('roomCreated', onCreated);
                this.on('error', onError);

                // Send roomId and settings to server
                this.socket.emit('room:create', {
                    roomId,
                    settings: { nickname, ...settings }
                });

                // ISSUE #20 FIX: Store timeout ID for cancellation
                // Timeout matches server SOCKET_HANDLER timeout (30s)
                timeoutId = setTimeout(() => {
                    if (settled) return;
                    settled = true;
                    cleanup();
                    reject(new Error('Create room timeout'));
                }, 30000);
            });
        },

        /**
         * Join an existing room
         * ISSUE #6 & #20 FIX: Proper listener cleanup and timeout cancellation
         * @param {string} roomId - Room ID to join
         * @param {string} nickname - Player nickname
         * @returns {Promise}
         */
        joinRoom(roomId, nickname) {
            // Prevent double-join race condition
            if (this.joinInProgress) {
                return Promise.reject(new Error('Join already in progress'));
            }
            this.joinInProgress = true;

            return new Promise((resolve, reject) => {
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
                    if (settled) return;
                    settled = true;
                    cleanup();
                    resolve(data);
                };

                // ISSUE #6 FIX: Clean up on ANY error, not just room errors
                const onError = (error) => {
                    if (settled) return;
                    if (error.type === 'room' || error.type === 'connection') {
                        settled = true;
                        cleanup();
                        reject(error);
                    }
                };

                this.on('roomJoined', onJoined);
                this.on('error', onError);

                // Send roomId and nickname to server (no password needed)
                this.socket.emit('room:join', { roomId, nickname });

                // ISSUE #20 FIX: Store timeout ID for cancellation
                // FIX: Client timeout (20s) exceeds server JOIN_ROOM timeout (15s) to
                // account for post-join processing (stats, token invalidation) and network latency.
                // Previously both were 15s, causing the client to timeout before receiving
                // the server's response when post-join operations added even small delays.
                timeoutId = setTimeout(() => {
                    if (settled) return;
                    settled = true;
                    cleanup();
                    reject(new Error('Join room timeout'));
                }, 20000);
            });
        },

        /**
         * Leave current room
         * ISSUE #5 FIX: Use safe storage methods
         */
        leaveRoom() {
            this.socket.emit('room:leave');
            this.roomCode = null;
            this.player = null;
            this._safeRemoveStorage(sessionStorage, 'codenames-room-code');
        },

        /**
         * Update room settings (host only)
         * @param {Object} settings - New settings
         */
        updateSettings(settings) {
            this.socket.emit('room:settings', settings);
        },

        /**
         * Kick a player from the room (host only)
         * @param {string} targetSessionId - Session ID of player to kick
         */
        kickPlayer(targetSessionId) {
            if (!this.player?.isHost) {
                console.warn('Only the host can kick players');
                return;
            }
            this.socket.emit('player:kick', { targetSessionId });
        },

        /**
         * Request full state resync from server
         * ISSUE #6 & #20 FIX: Proper listener cleanup and timeout cancellation
         * Use this if you detect you're out of sync
         * @returns {Promise}
         */
        requestResync() {
            return new Promise((resolve, reject) => {
                if (!this.roomCode) {
                    reject(new Error('Not in a room'));
                    return;
                }

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
                    if (settled) return;
                    settled = true;
                    cleanup();
                    resolve(data);
                };

                // ISSUE #6 FIX: Clean up on ANY error, not just room errors
                const onError = (error) => {
                    if (settled) return;
                    if (error.type === 'room' || error.type === 'connection') {
                        settled = true;
                        cleanup();
                        reject(error);
                    }
                };

                this.on('roomResynced', onResynced);
                this.on('error', onError);

                this.socket.emit('room:resync');

                // ISSUE #20 FIX: Store timeout ID for cancellation
                timeoutId = setTimeout(() => {
                    if (settled) return;
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
         * @param {string|null} team - 'red', 'blue', or null to leave team
         */
        setTeam(team, callback) {
            this.socket.emit('player:setTeam', { team }, callback);
        },

        /**
         * Set player role
         * @param {string} role - 'spymaster', 'guesser', or 'spectator'
         */
        setRole(role, callback) {
            this.socket.emit('player:setRole', { role }, callback);
        },

        /**
         * Change nickname
         * @param {string} nickname - New nickname
         */
        setNickname(nickname) {
            this.socket.emit('player:setNickname', { nickname });
        },

        // =====================
        // Game Actions
        // =====================

        /**
         * Start a new game (host only)
         * @param {Object} options - Game options
         */
        startGame(options = {}) {
            this.socket.emit('game:start', options);
        },

        /**
         * Reveal a card (host only)
         * @param {number} index - Card index (0-24)
         */
        revealCard(index) {
            this.socket.emit('game:reveal', { index });
        },

        /**
         * Give a clue (spymaster only)
         * @param {string} word - Clue word
         * @param {number} number - Number of related cards
         */
        giveClue(word, number) {
            // Client-side validation matching server's clueWordRegex
            const clueWordRegex = /^[\p{L}]+(?:[\s\-'][\p{L}]+){0,9}$/u;
            const trimmed = (word || '').trim().replace(/\s+/g, ' ');
            if (!trimmed || trimmed.length > 50 || !clueWordRegex.test(trimmed)) {
                this._emit('error', {
                    type: 'game',
                    code: 'INVALID_INPUT',
                    message: 'Clue must be words separated by spaces, hyphens, or apostrophes'
                });
                return;
            }
            this.socket.emit('game:clue', { word: trimmed, number });
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
         * @param {number} limit - Maximum number of games to return
         */
        getGameHistory(limit = 10) {
            this.socket.emit('game:getHistory', { limit });
        },

        /**
         * Request replay data for a specific game
         * @param {string} gameId - Game ID to replay
         */
        getReplay(gameId) {
            this.socket.emit('game:getReplay', { gameId });
        },

        // =====================
        // Chat Actions
        // =====================

        /**
         * Send a chat message
         * @param {string} text - Message text
         * @param {boolean} teamOnly - Send to team only
         */
        sendMessage(text, teamOnly = false) {
            this._queueOrEmit('chat:message', { text, teamOnly });
        },

        /**
         * PHASE 4: Send a spectator-only chat message
         * @param {string} message - Message text
         */
        sendSpectatorChat(message) {
            if (!message?.trim()) return;
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
         * @returns {boolean}
         */
        isSocketIOAvailable() {
            return typeof io !== 'undefined';
        },

        /**
         * Check if connected
         * @returns {boolean}
         */
        isConnected() {
            return this.connected && this.socket?.connected;
        },

        /**
         * Check if in a room
         * @returns {boolean}
         */
        isInRoom() {
            return !!this.roomCode;
        },

        /**
         * Check if current player is host
         * @returns {boolean}
         */
        isHost() {
            return this.player?.isHost === true;
        },

        /**
         * Check if current player is spymaster
         * @returns {boolean}
         */
        isSpymaster() {
            return this.player?.role === 'spymaster';
        },

        /**
         * Get current room code
         * @returns {string|null}
         */
        getRoomCode() {
            return this.roomCode;
        },

        /**
         * Get current player
         * @returns {Object|null}
         */
        getPlayer() {
            return this.player;
        },

        /**
         * Get stored room code (for reconnection)
         * ISSUE #5 FIX: Uses safe storage methods
         * Uses sessionStorage to prevent multi-tab conflicts
         * @returns {string|null}
         */
        getStoredRoomCode() {
            return this._safeGetStorage(sessionStorage, 'codenames-room-code');
        },

        /**
         * Get stored nickname
         * ISSUE #5 FIX: Uses safe storage methods
         * @returns {string|null}
         */
        getStoredNickname() {
            return this._safeGetStorage(localStorage, 'codenames-nickname');
        },

        /**
         * Clear all stored session data
         * ISSUE #5 FIX: Uses safe storage methods
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
         * @param {boolean} enabled
         */
        setAutoRejoin(enabled) {
            this.autoRejoin = enabled;
        }
    };

    // Export to global scope
    global.CodenamesClient = CodenamesClient;

})(typeof window !== 'undefined' ? window : global);
