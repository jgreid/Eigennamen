/**
 * Codenames Online - WebSocket Client Adapter
 *
 * This module connects the client to the real-time multiplayer server.
 * Socket.io client library is loaded automatically if not already present.
 *
 * Built as an IIFE -- loaded via <script src="/js/socket-client.js">.
 * NOT an ES module. Exposes CodenamesClient on the global window object.
 */

// Socket.io `io` global is declared in globals.d.ts (loaded as a separate <script>).

/** Minimal Socket.io socket shape used by this adapter. */
interface SocketClientInstance {
    id: string;
    connected: boolean;
    on(event: string, handler: (...args: any[]) => void): void;
    off(event: string, handler: (...args: any[]) => void): void;
    emit(event: string, ...args: any[]): void;
    disconnect(): void;
}

/** Player data as tracked by the client adapter. */
interface Player {
    sessionId: string;
    roomCode?: string;
    nickname: string;
    team: string | null;
    role: string | null;
    isHost: boolean;
    connected: boolean;
}

/** Room data returned by the server. */
interface _RoomData {
    code: string;
    status?: string;
    settings?: Record<string, unknown>;
}

/** Options passed to connect(). */
interface ConnectOptions {
    autoRejoin?: boolean;
    socketOptions?: Record<string, any>;
}

/** Options passed to createRoom(). */
interface CreateRoomOptions {
    roomId: string;
    nickname?: string;
    [key: string]: unknown;
}

/** A tracked socket.io listener for cleanup. */
interface SocketListenerEntry {
    event: string;
    handler: (...args: any[]) => void;
}

/** An event queued while the client is offline. */
interface OfflineQueueItem {
    event: string;
    data: Record<string, unknown>;
    timestamp: number;
}

/** Error data emitted by the adapter. */
interface ErrorData {
    type: string;
    code?: string;
    message?: string;
    error?: Error;
    attempt?: number;
    requestId?: string;
    [key: string]: unknown;
}

/** The map of event name -> array of listener callbacks. */
interface ListenerMap {
    [event: string]: Array<(data: any) => void>;
}

/** Extended Window to allow setting CodenamesClient globally. */
interface CodenamesGlobal {
    CodenamesClient?: any;
}

(function (global: (Window & CodenamesGlobal) | (typeof globalThis & CodenamesGlobal)) {
    'use strict';

    /**
     * Check whether the Socket.io global `io` is available and valid.
     * io.Manager is a stable export across all Socket.io v4.x releases.
     */
    function isSocketIOReady(): boolean {
        return typeof io !== 'undefined' && typeof io === 'function' && typeof io.Manager === 'function';
    }

    /**
     * Dynamically load the Socket.io client library if the static <script>
     * tag failed (network hiccup, stale SRI hash after upgrade, ad-blocker,
     * cached HTML referencing an old bundle, etc.).
     * Returns a Promise that resolves once `io` is available.
     */
    function loadSocketIO(): Promise<void> {
        return new Promise((resolve, reject) => {
            if (isSocketIOReady()) { resolve(); return; }

            const script = document.createElement('script');
            script.src = '/js/socket.io.min.js';
            script.onload = function () {
                if (isSocketIOReady()) {
                    resolve();
                } else {
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
        socket: null as SocketClientInstance | null,
        sessionId: null as string | null,
        roomCode: null as string | null,
        player: null as Player | null,
        connected: false,
        reconnectAttempts: 0,
        maxReconnectAttempts: 5,
        autoRejoin: true,           // Automatically rejoin room on reconnection
        storedNickname: null as string | null,       // Remember nickname for reconnection
        listeners: {} as ListenerMap,
        joinInProgress: false,      // Prevent double-join race condition
        createInProgress: false,    // Prevent double-create race condition
        _socketListeners: [] as SocketListenerEntry[],       // Track socket.io listeners for cleanup
        _offlineQueue: [] as OfflineQueueItem[],          // Queue for events sent while disconnected
        _offlineQueueMaxSize: 20,   // Max queued events to prevent memory growth
        _nextRequestId: 0,         // Incrementing counter for request correlation

        /**
         * Connect to the server
         * @param serverUrl - Server URL (optional, defaults to current host)
         * @param options - Connection options
         */
        connect(serverUrl: string | null = null, options: ConnectOptions = {}): Promise<SocketClientInstance> {
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
        _doConnect(serverUrl: string | null = null, options: ConnectOptions = {}): Promise<SocketClientInstance> {
            return new Promise((resolve, reject) => {

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
                }) as unknown as SocketClientInstance;
                this.socket = socket;

                socket.on('connect', () => {
                    this.connected = true;
                    const wasReconnecting = this.reconnectAttempts > 0;
                    this.reconnectAttempts = 0;
                    console.log('Connected to server:', socket.id);

                    this._emit('connected', { wasReconnecting });

                    // ISSUE #11 FIX: Properly handle async _attemptRejoin with error catching
                    if (wasReconnecting && this.autoRejoin) {
                        this._attemptRejoin().catch((err: Error) => {
                            console.error('Auto-rejoin failed:', err);
                        });
                    }

                    resolve(socket);
                });

                socket.on('disconnect', (reason: string) => {
                    this.connected = false;
                    // Clear operation flags so they don't block new operations after reconnect
                    this.createInProgress = false;
                    this.joinInProgress = false;
                    console.log('Disconnected:', reason);
                    this._emit('disconnected', { reason, wasConnected: true });
                });

                socket.on('connect_error', (error: Error) => {
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
        async _attemptRejoin(): Promise<void> {
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
        _registerSocketListener(event: string, handler: (...args: any[]) => void): void {
            this.socket!.on(event, handler);
            this._socketListeners.push({ event, handler });
        },

        /**
         * Set up Socket.io event listeners
         */
        _setupEventListeners(): void {
            // Clear any previous listeners first
            this._cleanupSocketListeners();

            // Room events
            this._registerSocketListener('room:created', (data: any) => {
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

            this._registerSocketListener('room:joined', (data: any) => {
                this.roomCode = data.room.code;
                this.player = data.you;
                // ISSUE FIX: Sync sessionId from server if not already set
                if (data.you?.sessionId && !this.sessionId) {
                    this.sessionId = data.you.sessionId;
                }
                this._saveSession();
                this._emit('roomJoined', data);
            });

            this._registerSocketListener('room:playerJoined', (data: any) => {
                this._emit('playerJoined', data);
            });

            this._registerSocketListener('room:playerLeft', (data: any) => {
                this._emit('playerLeft', data);
            });

            this._registerSocketListener('room:settingsUpdated', (data: any) => {
                this._emit('settingsUpdated', data);
            });

            // ISSUE FIX: Add missing room:statsUpdated listener
            this._registerSocketListener('room:statsUpdated', (data: any) => {
                this._emit('statsUpdated', data);
            });

            this._registerSocketListener('room:hostChanged', (data: any) => {
                // Update local player if we became host
                if (this.player && data.newHostSessionId === this.player.sessionId) {
                    this.player.isHost = true;
                }
                this._emit('hostChanged', data);
            });

            // Handle being kicked from the room
            // ISSUE #5 FIX: Use safe storage methods
            this._registerSocketListener('room:kicked', (data: any) => {
                this.roomCode = null;
                this.player = null;
                this._safeRemoveStorage(sessionStorage, 'codenames-room-code');
                this._emit('kicked', data);
            });

            // Handle another player being kicked
            this._registerSocketListener('player:kicked', (data: any) => {
                this._emit('playerKicked', data);
            });

            this._registerSocketListener('room:error', (error: any) => {
                this._emit('error', { type: 'room', ...error });
            });

            // Handle room:warning (non-fatal issues like stale stats)
            this._registerSocketListener('room:warning', (data: any) => {
                this._emit('roomWarning', data);
            });

            // Handle room:resynced (response to requestResync)
            this._registerSocketListener('room:resynced', (data: any) => {
                this.roomCode = data.room.code;
                this.player = data.you;
                this._emit('roomResynced', data);
            });

            // Handle room:reconnected (response to token-based reconnection)
            this._registerSocketListener('room:reconnected', (data: any) => {
                this.roomCode = data.room.code;
                this.player = data.you;
                this._saveSession();
                this._emit('roomReconnected', data);
            });

            // Player events
            this._registerSocketListener('player:updated', (data: any) => {
                if (data.sessionId === this.player?.sessionId) {
                    this.player = { ...this.player, ...data.changes };
                }
                this._emit('playerUpdated', data);
            });

            this._registerSocketListener('player:disconnected', (data: any) => {
                this._emit('playerDisconnected', data);
            });

            this._registerSocketListener('player:reconnected', (data: any) => {
                this._emit('playerReconnected', data);
            });

            // Handle room:playerReconnected (from secure token reconnection)
            this._registerSocketListener('room:playerReconnected', (data: any) => {
                this._emit('playerReconnected', data);
            });

            this._registerSocketListener('player:error', (error: any) => {
                this._emit('error', { type: 'player', ...error });
            });

            // Game events
            this._registerSocketListener('game:started', (data: any) => {
                this._emit('gameStarted', data);
            });

            this._registerSocketListener('game:cardRevealed', (data: any) => {
                this._emit('cardRevealed', data);
            });

            this._registerSocketListener('game:clueGiven', (data: any) => {
                this._emit('clueGiven', data);
            });

            this._registerSocketListener('game:turnEnded', (data: any) => {
                this._emit('turnEnded', data);
            });

            this._registerSocketListener('game:over', (data: any) => {
                this._emit('gameOver', data);
            });

            this._registerSocketListener('game:spymasterView', (data: any) => {
                this._emit('spymasterView', data);
            });

            this._registerSocketListener('game:historyData', (data: any) => {
                this._emit('historyData', data);
            });

            this._registerSocketListener('game:historyResult', (data: any) => {
                this._emit('historyResult', data);
            });

            this._registerSocketListener('game:replayData', (data: any) => {
                this._emit('replayData', data);
            });

            this._registerSocketListener('game:error', (error: any) => {
                this._emit('error', { type: 'game', ...error });
            });

            // Timer events
            this._registerSocketListener('timer:started', (data: any) => {
                this._emit('timerStarted', data);
            });

            this._registerSocketListener('timer:stopped', (data: any) => {
                this._emit('timerStopped', data);
            });

            this._registerSocketListener('timer:tick', (data: any) => {
                this._emit('timerTick', data);
            });

            this._registerSocketListener('timer:expired', (data: any) => {
                this._emit('timerExpired', data);
            });

            this._registerSocketListener('timer:status', (data: any) => {
                this._emit('timerStatus', data);
            });

            // ISSUE FIX: Add missing timer control event listeners
            this._registerSocketListener('timer:paused', (data: any) => {
                this._emit('timerPaused', data);
            });

            this._registerSocketListener('timer:resumed', (data: any) => {
                this._emit('timerResumed', data);
            });

            this._registerSocketListener('timer:timeAdded', (data: any) => {
                this._emit('timerTimeAdded', data);
            });

            // Chat events
            this._registerSocketListener('chat:message', (data: any) => {
                this._emit('chatMessage', data);
            });

            // ISSUE FIX: Add missing spectator chat listener
            this._registerSocketListener('chat:spectatorMessage', (data: any) => {
                this._emit('spectatorChatMessage', data);
            });
        },

        /**
         * Safely set item in storage with quota error handling
         * ISSUE #5 FIX: Handles QuotaExceededError for private browsing mode
         * @param storage - sessionStorage or localStorage
         * @param key - Storage key
         * @param value - Value to store
         * @returns True if successful
         */
        _safeSetStorage(storage: Storage, key: string, value: string): boolean {
            try {
                storage.setItem(key, value);
                return true;
            } catch (e: any) {
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
         * @param storage - sessionStorage or localStorage
         * @param key - Storage key
         * @returns Stored value or null
         */
        _safeGetStorage(storage: Storage, key: string): string | null {
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
         * @param storage - sessionStorage or localStorage
         * @param key - Storage key
         */
        _safeRemoveStorage(storage: Storage, key: string): void {
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
        _saveSession(): void {
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
        _cleanupSocketListeners(): void {
            if (this.socket && this._socketListeners.length > 0) {
                this._socketListeners.forEach(({ event, handler }: SocketListenerEntry) => {
                    this.socket!.off(event, handler);
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
        _queueOrEmit(event: string, data: Record<string, unknown>): void {
            if (this.isConnected()) {
                this.socket!.emit(event, data);
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
        _flushOfflineQueue(): void {
            if (this._offlineQueue.length === 0) return;

            const maxAge = 2 * 60 * 1000; // 2 minutes
            const now = Date.now();
            let replayed = 0;

            for (const item of this._offlineQueue) {
                if (now - item.timestamp < maxAge && this.isConnected()) {
                    this.socket!.emit(item.event, item.data);
                    replayed++;
                }
            }

            if (replayed > 0) {
                console.log(`Replayed ${replayed} queued event(s) after reconnection`);
            }
            this._offlineQueue = [];
        },

        /**
         * Generate a unique request ID for correlating server responses.
         * Uses an incrementing counter (sufficient for per-connection correlation).
         */
        _generateRequestId(): string {
            this._nextRequestId = (this._nextRequestId + 1) % Number.MAX_SAFE_INTEGER;
            return 'req_' + this._nextRequestId;
        },

        /**
         * Emit event to listeners
         */
        _emit(event: string, data: any): void {
            const callbacks = this.listeners[event] || [];
            callbacks.forEach((cb: (data: any) => void) => {
                try {
                    cb(data);
                } catch (err) {
                    console.error(`Error in ${event} listener:`, err);
                }
            });
        },

        /**
         * Register event listener
         * @param event - Event name
         * @param callback - Callback function
         */
        on(event: string, callback: (data: any) => void): any {
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
        off(event: string, callback?: (data: any) => void): any {
            if (!callback) {
                delete this.listeners[event];
            } else if (this.listeners[event]) {
                this.listeners[event] = this.listeners[event].filter((cb: (data: any) => void) => cb !== callback);
            }
            return this;
        },

        /**
         * Register one-time event listener
         * @param event - Event name
         * @param callback - Callback function
         */
        once(event: string, callback: (data: any) => void): any {
            const wrapper = (data: any): void => {
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
         * @param options - Room options including roomId and settings
         */
        createRoom(options: CreateRoomOptions = { roomId: '' }): Promise<any> {
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
                let timeoutId: ReturnType<typeof setTimeout> | null = null;
                let settled = false;

                const cleanup = (): void => {
                    this.createInProgress = false;
                    if (timeoutId) {
                        clearTimeout(timeoutId);
                        timeoutId = null;
                    }
                    this.off('roomCreated', onCreated);
                    this.off('error', onError);
                };

                const onCreated = (data: any): void => {
                    if (settled) return;
                    settled = true;
                    cleanup();
                    resolve(data);
                };

                const onError = (error: ErrorData): void => {
                    if (settled) return;
                    // Connection errors always match (not from server handler)
                    if (error.type === 'connection') {
                        settled = true;
                        cleanup();
                        reject(error);
                        return;
                    }
                    if (error.type === 'room') {
                        // Only match errors correlated to our request (ignore other operations' errors)
                        if (error.requestId !== undefined && error.requestId !== requestId) return;
                        settled = true;
                        cleanup();
                        reject(error);
                    }
                };

                this.on('roomCreated', onCreated);
                this.on('error', onError);

                // Send roomId, settings, and requestId to server
                this.socket!.emit('room:create', {
                    roomId,
                    settings: { nickname, ...settings },
                    requestId
                });

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
         * @param roomId - Room ID to join
         * @param nickname - Player nickname
         */
        joinRoom(roomId: string, nickname: string): Promise<any> {
            // Prevent double-join race condition
            if (this.joinInProgress) {
                return Promise.reject(new Error('Join already in progress'));
            }
            this.joinInProgress = true;

            return new Promise((resolve, reject) => {
                const requestId = this._generateRequestId();
                let timeoutId: ReturnType<typeof setTimeout> | null = null;
                let settled = false;

                const cleanup = (): void => {
                    this.joinInProgress = false;
                    if (timeoutId) {
                        clearTimeout(timeoutId);
                        timeoutId = null;
                    }
                    this.off('roomJoined', onJoined);
                    this.off('error', onError);
                };

                const onJoined = (data: any): void => {
                    if (settled) return;
                    settled = true;
                    cleanup();
                    resolve(data);
                };

                const onError = (error: ErrorData): void => {
                    if (settled) return;
                    // Connection errors always match (not from server handler)
                    if (error.type === 'connection') {
                        settled = true;
                        cleanup();
                        reject(error);
                        return;
                    }
                    if (error.type === 'room') {
                        // Only match errors correlated to our request (ignore other operations' errors)
                        if (error.requestId !== undefined && error.requestId !== requestId) return;
                        settled = true;
                        cleanup();
                        reject(error);
                    }
                };

                this.on('roomJoined', onJoined);
                this.on('error', onError);

                // Send roomId, nickname, and requestId to server
                this.socket!.emit('room:join', { roomId, nickname, requestId });

                // Client timeout (20s) exceeds server JOIN_ROOM timeout (15s) to
                // account for post-join processing (stats, token invalidation) and network latency.
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
        leaveRoom(): void {
            this.socket!.emit('room:leave');
            this.roomCode = null;
            this.player = null;
            this._safeRemoveStorage(sessionStorage, 'codenames-room-code');
        },

        /**
         * Update room settings (host only)
         * @param settings - New settings
         */
        updateSettings(settings: Record<string, unknown>): void {
            this.socket!.emit('room:settings', settings);
        },

        /**
         * Kick a player from the room (host only)
         * @param targetSessionId - Session ID of player to kick
         */
        kickPlayer(targetSessionId: string): void {
            if (!this.player?.isHost) {
                console.warn('Only the host can kick players');
                return;
            }
            this.socket!.emit('player:kick', { targetSessionId });
        },

        /**
         * Request full state resync from server
         * ISSUE #6 & #20 FIX: Proper listener cleanup and timeout cancellation
         * Use this if you detect you're out of sync
         */
        requestResync(): Promise<any> {
            return new Promise((resolve, reject) => {
                if (!this.roomCode) {
                    reject(new Error('Not in a room'));
                    return;
                }

                const requestId = this._generateRequestId();
                let timeoutId: ReturnType<typeof setTimeout> | null = null;
                let settled = false;

                const cleanup = (): void => {
                    if (timeoutId) {
                        clearTimeout(timeoutId);
                        timeoutId = null;
                    }
                    this.off('roomResynced', onResynced);
                    this.off('error', onError);
                };

                const onResynced = (data: any): void => {
                    if (settled) return;
                    settled = true;
                    cleanup();
                    resolve(data);
                };

                const onError = (error: ErrorData): void => {
                    if (settled) return;
                    // Connection errors always match (not from server handler)
                    if (error.type === 'connection') {
                        settled = true;
                        cleanup();
                        reject(error);
                        return;
                    }
                    if (error.type === 'room') {
                        // Only match errors correlated to our request (ignore other operations' errors)
                        if (error.requestId !== undefined && error.requestId !== requestId) return;
                        settled = true;
                        cleanup();
                        reject(error);
                    }
                };

                this.on('roomResynced', onResynced);
                this.on('error', onError);

                this.socket!.emit('room:resync', { requestId });

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
         * @param team - 'red', 'blue', or null to leave team
         * @param callback - Optional acknowledgement callback
         */
        setTeam(team: string | null, callback?: (result: any) => void): void {
            this.socket!.emit('player:setTeam', { team }, callback);
        },

        /**
         * Set player role
         * @param role - 'spymaster', 'guesser', or 'spectator'
         * @param callback - Optional acknowledgement callback
         */
        setRole(role: string, callback?: (result: any) => void): void {
            this.socket!.emit('player:setRole', { role }, callback);
        },

        /**
         * Change nickname
         * @param nickname - New nickname
         */
        setNickname(nickname: string): void {
            this.socket!.emit('player:setNickname', { nickname });
        },

        // =====================
        // Game Actions
        // =====================

        /**
         * Start a new game (host only)
         * @param options - Game options
         */
        startGame(options: Record<string, unknown> = {}): void {
            this.socket!.emit('game:start', options);
        },

        /**
         * Reveal a card (host only)
         * @param index - Card index (0-24)
         */
        revealCard(index: number): void {
            this.socket!.emit('game:reveal', { index });
        },

        /**
         * Give a clue (spymaster only)
         * @param word - Clue word
         * @param number - Number of related cards
         */
        giveClue(word: string, number: number): void {
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
            this.socket!.emit('game:clue', { word: trimmed, number });
        },

        /**
         * End current turn (host only)
         */
        endTurn(): void {
            this.socket!.emit('game:endTurn');
        },

        /**
         * Forfeit the game (host only)
         */
        forfeit(): void {
            this.socket!.emit('game:forfeit');
        },

        /**
         * Request game history (current game moves)
         */
        getHistory(): void {
            this.socket!.emit('game:history');
        },

        /**
         * Request past games history for replay
         * @param limit - Maximum number of games to return
         */
        getGameHistory(limit: number = 10): void {
            this.socket!.emit('game:getHistory', { limit });
        },

        /**
         * Request replay data for a specific game
         * @param gameId - Game ID to replay
         */
        getReplay(gameId: string): void {
            this.socket!.emit('game:getReplay', { gameId });
        },

        // =====================
        // Chat Actions
        // =====================

        /**
         * Send a chat message
         * @param text - Message text
         * @param teamOnly - Send to team only
         */
        sendMessage(text: string, teamOnly: boolean = false): void {
            this._queueOrEmit('chat:message', { text, teamOnly });
        },

        /**
         * PHASE 4: Send a spectator-only chat message
         * @param message - Message text
         */
        sendSpectatorChat(message: string): void {
            if (!message?.trim()) return;
            this._queueOrEmit('chat:spectator', { message: message.trim() });
        },

        // =====================
        // Utility
        // =====================

        /**
         * Disconnect from server
         */
        disconnect(): void {
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
        isSocketIOAvailable(): boolean {
            return isSocketIOReady();
        },

        /**
         * Check if connected
         */
        isConnected(): boolean {
            return this.connected && !!this.socket?.connected;
        },

        /**
         * Check if in a room
         */
        isInRoom(): boolean {
            return !!this.roomCode;
        },

        /**
         * Check if current player is host
         */
        isHost(): boolean {
            return this.player?.isHost === true;
        },

        /**
         * Check if current player is spymaster
         */
        isSpymaster(): boolean {
            return this.player?.role === 'spymaster';
        },

        /**
         * Get current room code
         */
        getRoomCode(): string | null {
            return this.roomCode;
        },

        /**
         * Get current player
         */
        getPlayer(): Player | null {
            return this.player;
        },

        /**
         * Get stored room code (for reconnection)
         * ISSUE #5 FIX: Uses safe storage methods
         * Uses sessionStorage to prevent multi-tab conflicts
         */
        getStoredRoomCode(): string | null {
            return this._safeGetStorage(sessionStorage, 'codenames-room-code');
        },

        /**
         * Get stored nickname
         * ISSUE #5 FIX: Uses safe storage methods
         */
        getStoredNickname(): string | null {
            return this._safeGetStorage(localStorage, 'codenames-nickname');
        },

        /**
         * Clear all stored session data
         * ISSUE #5 FIX: Uses safe storage methods
         * Session ID and room code use sessionStorage (per-tab)
         * Nickname uses localStorage for user convenience
         */
        clearSession(): void {
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
        setAutoRejoin(enabled: boolean): void {
            this.autoRejoin = enabled;
        }
    };

    // Export to global scope
    global.CodenamesClient = CodenamesClient;

})(typeof window !== 'undefined' ? window : globalThis as any);
