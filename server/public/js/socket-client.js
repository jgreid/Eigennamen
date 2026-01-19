/**
 * Codenames Online - WebSocket Client Adapter
 *
 * This module connects the client to the real-time multiplayer server.
 * Include Socket.io client library before this script:
 * <script src="https://cdn.socket.io/4.7.2/socket.io.min.js"></script>
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

        /**
         * Connect to the server
         * @param {string} serverUrl - Server URL (optional, defaults to current host)
         * @param {Object} options - Connection options
         * @returns {Promise}
         */
        connect(serverUrl = null, options = {}) {
            return new Promise((resolve, reject) => {
                // Load session from storage
                this.sessionId = localStorage.getItem('codenames-session-id');
                this.storedNickname = localStorage.getItem('codenames-nickname');
                this.autoRejoin = options.autoRejoin !== false;

                const url = serverUrl || window.location.origin;

                // Determine transport based on environment:
                // - Production (HTTPS) uses websocket only for better Fly.io compatibility
                // - Development (HTTP) uses polling + websocket for easier debugging
                const isSecure = url.startsWith('https://') || window.location.protocol === 'https:';
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

                    // Auto-rejoin room on reconnection
                    if (wasReconnecting && this.autoRejoin) {
                        this._attemptRejoin();
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
            } catch (error) {
                console.error('Failed to rejoin room:', error);
                // Clear stored room code since it's no longer valid
                localStorage.removeItem('codenames-room-code');
                this._emit('rejoinFailed', { roomCode: storedRoomCode, error });
            }
        },

        /**
         * Set up Socket.io event listeners
         */
        _setupEventListeners() {
            // Room events
            this.socket.on('room:created', (data) => {
                this.roomCode = data.room.code;
                this.player = data.player;
                this._saveSession();
                this._emit('roomCreated', data);
            });

            this.socket.on('room:joined', (data) => {
                this.roomCode = data.room.code;
                this.player = data.you;
                this._saveSession();
                this._emit('roomJoined', data);
            });

            this.socket.on('room:playerJoined', (data) => {
                this._emit('playerJoined', data);
            });

            this.socket.on('room:playerLeft', (data) => {
                this._emit('playerLeft', data);
            });

            this.socket.on('room:settingsUpdated', (data) => {
                this._emit('settingsUpdated', data);
            });

            this.socket.on('room:hostChanged', (data) => {
                // Update local player if we became host
                if (this.player && data.newHostSessionId === this.player.sessionId) {
                    this.player.isHost = true;
                }
                this._emit('hostChanged', data);
            });

            this.socket.on('room:error', (error) => {
                this._emit('error', { type: 'room', ...error });
            });

            // Player events
            this.socket.on('player:updated', (data) => {
                if (data.sessionId === this.player?.sessionId) {
                    this.player = { ...this.player, ...data.changes };
                }
                this._emit('playerUpdated', data);
            });

            this.socket.on('player:disconnected', (data) => {
                this._emit('playerDisconnected', data);
            });

            this.socket.on('player:reconnected', (data) => {
                this._emit('playerReconnected', data);
            });

            this.socket.on('player:error', (error) => {
                this._emit('error', { type: 'player', ...error });
            });

            // Game events
            this.socket.on('game:started', (data) => {
                this._emit('gameStarted', data);
            });

            this.socket.on('game:cardRevealed', (data) => {
                this._emit('cardRevealed', data);
            });

            this.socket.on('game:clueGiven', (data) => {
                this._emit('clueGiven', data);
            });

            this.socket.on('game:turnEnded', (data) => {
                this._emit('turnEnded', data);
            });

            this.socket.on('game:over', (data) => {
                this._emit('gameOver', data);
            });

            this.socket.on('game:spymasterView', (data) => {
                this._emit('spymasterView', data);
            });

            this.socket.on('game:historyData', (data) => {
                this._emit('historyData', data);
            });

            this.socket.on('game:error', (error) => {
                this._emit('error', { type: 'game', ...error });
            });

            // Timer events
            this.socket.on('timer:started', (data) => {
                this._emit('timerStarted', data);
            });

            this.socket.on('timer:stopped', (data) => {
                this._emit('timerStopped', data);
            });

            this.socket.on('timer:tick', (data) => {
                this._emit('timerTick', data);
            });

            this.socket.on('timer:expired', (data) => {
                this._emit('timerExpired', data);
            });

            // Chat events
            this.socket.on('chat:message', (data) => {
                this._emit('chatMessage', data);
            });
        },

        /**
         * Save session to local storage
         */
        _saveSession() {
            if (this.sessionId) {
                localStorage.setItem('codenames-session-id', this.sessionId);
            }
            if (this.roomCode) {
                localStorage.setItem('codenames-room-code', this.roomCode);
            }
            if (this.player?.nickname) {
                localStorage.setItem('codenames-nickname', this.player.nickname);
                this.storedNickname = this.player.nickname;
            }
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
         * @param {Object} settings - Room settings
         * @returns {Promise}
         */
        createRoom(settings = {}) {
            return new Promise((resolve, reject) => {
                this.socket.emit('room:create', { settings });

                const onCreated = (data) => {
                    this.off('roomCreated', onCreated);
                    this.off('error', onError);
                    resolve(data);
                };

                const onError = (error) => {
                    if (error.type === 'room') {
                        this.off('roomCreated', onCreated);
                        this.off('error', onError);
                        reject(error);
                    }
                };

                this.on('roomCreated', onCreated);
                this.on('error', onError);

                // Timeout
                setTimeout(() => {
                    this.off('roomCreated', onCreated);
                    this.off('error', onError);
                    reject(new Error('Create room timeout'));
                }, 10000);
            });
        },

        /**
         * Join an existing room
         * @param {string} code - Room code
         * @param {string} nickname - Player nickname
         * @returns {Promise}
         */
        joinRoom(code, nickname) {
            return new Promise((resolve, reject) => {
                this.socket.emit('room:join', { code, nickname });

                const onJoined = (data) => {
                    this.off('roomJoined', onJoined);
                    this.off('error', onError);
                    resolve(data);
                };

                const onError = (error) => {
                    if (error.type === 'room') {
                        this.off('roomJoined', onJoined);
                        this.off('error', onError);
                        reject(error);
                    }
                };

                this.on('roomJoined', onJoined);
                this.on('error', onError);

                setTimeout(() => {
                    this.off('roomJoined', onJoined);
                    this.off('error', onError);
                    reject(new Error('Join room timeout'));
                }, 10000);
            });
        },

        /**
         * Leave current room
         */
        leaveRoom() {
            this.socket.emit('room:leave');
            this.roomCode = null;
            this.player = null;
            localStorage.removeItem('codenames-room-code');
        },

        /**
         * Update room settings (host only)
         * @param {Object} settings - New settings
         */
        updateSettings(settings) {
            this.socket.emit('room:settings', settings);
        },

        // =====================
        // Player Actions
        // =====================

        /**
         * Join a team
         * @param {string|null} team - 'red', 'blue', or null to leave team
         */
        setTeam(team) {
            this.socket.emit('player:setTeam', { team });
        },

        /**
         * Set player role
         * @param {string} role - 'spymaster', 'guesser', or 'spectator'
         */
        setRole(role) {
            this.socket.emit('player:setRole', { role });
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
            this.socket.emit('game:clue', { word, number });
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
         * Request game history
         */
        getHistory() {
            this.socket.emit('game:history');
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
            this.socket.emit('chat:message', { text, teamOnly });
        },

        // =====================
        // Utility
        // =====================

        /**
         * Disconnect from server
         */
        disconnect() {
            if (this.socket) {
                this.socket.disconnect();
                this.socket = null;
            }
            this.connected = false;
            this.roomCode = null;
            this.player = null;
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
         * @returns {string|null}
         */
        getStoredRoomCode() {
            return localStorage.getItem('codenames-room-code');
        },

        /**
         * Get stored nickname
         * @returns {string|null}
         */
        getStoredNickname() {
            return localStorage.getItem('codenames-nickname');
        },

        /**
         * Clear all stored session data
         */
        clearSession() {
            localStorage.removeItem('codenames-session-id');
            localStorage.removeItem('codenames-room-code');
            localStorage.removeItem('codenames-nickname');
            this.sessionId = null;
            this.storedNickname = null;
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
