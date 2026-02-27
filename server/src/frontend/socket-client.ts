/**
 * Eigennamen Online - WebSocket Client Adapter
 *
 * This module connects the client to the real-time multiplayer server.
 * Socket.io client library is loaded automatically if not already present.
 *
 * Built as an IIFE -- loaded via <script src="/js/socket-client.js">.
 * NOT an ES module. Exposes EigennamenClient on the global window object.
 *
 * Sub-modules (bundled by esbuild into a single IIFE):
 *   socket-client-types.ts    — Type definitions
 *   socket-client-storage.ts  — Safe browser storage utilities
 *   socket-client-events.ts   — Server-to-client event listener registration
 */

import { logger } from './logger.js';
import { safeSetStorage, safeGetStorage, safeRemoveStorage } from './socket-client-storage.js';
import { registerAllEventListeners } from './socket-client-events.js';
import type {
    SocketClientInstance, Player, ConnectOptions, CreateRoomOptions,
    SocketListenerEntry, OfflineQueueItem, ErrorData, ListenerMap, EigennamenGlobal,
    ClientEventMap, ClientEventName
} from './socket-client-types.js';
import type { JoinCreateResult, ServerErrorData } from './multiplayerTypes.js';

(function (global: (Window & EigennamenGlobal) | (typeof globalThis & EigennamenGlobal)) {
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

    const EigennamenClient = {
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

                // Use safe storage methods with error handling
                this.sessionId = this._safeGetStorage(sessionStorage, 'eigennamen-session-id');
                this.storedNickname = this._safeGetStorage(localStorage, 'eigennamen-nickname');
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
                }) as unknown as SocketClientInstance;
                this.socket = socket;

                socket.on('connect', () => {
                    this.connected = true;
                    const wasReconnecting = this.reconnectAttempts > 0;
                    this.reconnectAttempts = 0;
                    logger.debug('Connected to server:', socket.id);

                    this._emit('connected', { wasReconnecting });

                    // Properly handle async _attemptRejoin with error catching
                    // Surface failure to user instead of silently swallowing (C3 from audit)
                    if (wasReconnecting && this.autoRejoin) {
                        this._attemptRejoin().catch((err: Error) => {
                            logger.error('Auto-rejoin failed:', err);
                            // Ensure progress flags are cleared so manual rejoin isn't blocked
                            this.joinInProgress = false;
                            this.createInProgress = false;
                        });
                    }

                    resolve(socket);
                });

                socket.on('disconnect', (...args: unknown[]) => {
                    const reason = (args[0] as string) || 'unknown';
                    this.connected = false;
                    // Clear operation flags so they don't block new operations after reconnect
                    this.createInProgress = false;
                    this.joinInProgress = false;
                    logger.debug('Disconnected:', reason);
                    this._emit('disconnected', { reason, wasConnected: true });
                });

                socket.on('connect_error', (...args: unknown[]) => {
                    const error = args[0] as Error;
                    logger.error('Connection error:', error);
                    this.reconnectAttempts++;
                    // Clear operation flags so they don't block new operations
                    this.createInProgress = false;
                    this.joinInProgress = false;

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
        async _attemptRejoin(): Promise<void> {
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

                // Request a full state resync to ensure local state is up-to-date
                // after potentially missing events while disconnected
                try {
                    await this.requestResync();
                } catch {
                    // Non-critical: rejoin already provides initial state
                    logger.debug('Post-rejoin resync failed (non-critical)');
                }
            } catch (error) {
                logger.error('Failed to rejoin room:', error);
                // Clear stored room code since it's no longer valid
                this._safeRemoveStorage(sessionStorage, 'eigennamen-room-code');
                this._emit('rejoinFailed', { error: error as ServerErrorData | undefined });
            }
        },

        /**
         * Register a socket listener with tracking for cleanup
         */
        _registerSocketListener(event: string, handler: (...args: unknown[]) => void): void {
            this.socket?.on(event, handler);
            this._socketListeners.push({ event, handler });
        },

        /**
         * Set up Socket.io event listeners.
         * Delegates to registerAllEventListeners() in socket-client-events.ts.
         */
        _setupEventListeners(): void {
            // Clear any previous listeners first
            this._cleanupSocketListeners();

            // The kicked handler also needs to clear storage, so wrap emit for that case
            const self = this;
            const wrappedEmit = <K extends ClientEventName>(event: K, data: ClientEventMap[K]): void => {
                if (event === 'kicked') {
                    safeRemoveStorage(sessionStorage, 'eigennamen-room-code');
                }
                self._emit(event, data);
            };

            registerAllEventListeners(
                this._registerSocketListener.bind(this),
                wrappedEmit,
                {
                    get roomCode() { return self.roomCode; },
                    set roomCode(v) { self.roomCode = v; },
                    get player() { return self.player; },
                    set player(v) { self.player = v; },
                    get sessionId() { return self.sessionId; },
                    set sessionId(v) { self.sessionId = v; },
                    saveSession: () => self._saveSession()
                }
            );
        },

        /** Delegate to extracted storage utility */
        _safeSetStorage(storage: Storage, key: string, value: string): boolean {
            return safeSetStorage(storage, key, value);
        },

        /** Delegate to extracted storage utility */
        _safeGetStorage(storage: Storage, key: string): string | null {
            return safeGetStorage(storage, key);
        },

        /** Delegate to extracted storage utility */
        _safeRemoveStorage(storage: Storage, key: string): void {
            safeRemoveStorage(storage, key);
        },

        /**
         * Save session to storage
         * Session ID uses sessionStorage (per-tab) with error handling
         * Room code and nickname use localStorage for user convenience across tabs
         */
        _saveSession(): void {
            if (this.sessionId) {
                safeSetStorage(sessionStorage, 'eigennamen-session-id', this.sessionId);
            }
            if (this.roomCode) {
                // Use sessionStorage for room code to prevent multi-tab conflicts
                safeSetStorage(sessionStorage, 'eigennamen-room-code', this.roomCode);
            }
            if (this.player?.nickname) {
                safeSetStorage(localStorage, 'eigennamen-nickname', this.player.nickname);
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
                    this.socket?.off(event, handler);
                });
            }
            this._socketListeners = [];
        },

        /**
         * Queue a socket event to send when reconnected, or emit immediately if connected.
         * Only queues safe-to-replay events (chat messages, non-state-changing actions).
         * Tags items with current room code to discard stale events after room change.
         * @param event - Socket event name
         * @param data - Event data
         */
        _queueOrEmit(event: string, data: Record<string, unknown>): void {
            if (this.isConnected()) {
                this.socket?.emit(event, data);
            } else {
                // Queue safe-to-replay events while disconnected.
                // State-mutating events (team/role changes) are included because
                // the server validates them against current state on replay.
                const queueableEvents = [
                    'chat:message', 'chat:spectator',
                    'player:setTeam', 'player:setRole', 'player:setNickname',
                    'game:endTurn'
                ];
                if (queueableEvents.includes(event) && this._offlineQueue.length < this._offlineQueueMaxSize) {
                    this._offlineQueue.push({ event, data, timestamp: Date.now(), roomCode: this.roomCode });
                }
            }
        },

        /**
         * Flush queued offline events after reconnection.
         * Discards events that are too old (>2min) or from a different room (C2 from audit).
         */
        _flushOfflineQueue(): void {
            if (this._offlineQueue.length === 0) return;

            const maxAge = 2 * 60 * 1000; // 2 minutes
            const now = Date.now();
            const currentRoom = this.roomCode;
            let replayed = 0;

            for (const item of this._offlineQueue) {
                // Discard stale events from a different room
                if (item.roomCode !== currentRoom) continue;
                if (now - item.timestamp >= maxAge) continue;
                if (!this.isConnected()) break;
                this.socket?.emit(item.event, item.data);
                replayed++;
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
        _generateRequestId(): string {
            this._nextRequestId = (this._nextRequestId + 1) % Number.MAX_SAFE_INTEGER;
            return 'req_' + this._nextRequestId;
        },

        /**
         * Emit event to listeners
         */
        _emit<K extends ClientEventName>(event: K, data: ClientEventMap[K]): void {
            const callbacks = (this.listeners[event] || []) as Array<(data: ClientEventMap[K]) => void>;
            callbacks.forEach((cb) => {
                try {
                    cb(data);
                } catch (err) {
                    logger.error(`Error in ${event} listener:`, err);
                }
            });
        },

        /**
         * Register event listener
         * @param event - Event name
         * @param callback - Callback function
         */
        on<K extends ClientEventName>(event: K, callback: (data: ClientEventMap[K]) => void): unknown {
            if (!this.listeners[event]) {
                (this.listeners as Record<string, unknown[]>)[event] = [];
            }
            ((this.listeners as Record<string, unknown[]>)[event]).push(callback);
            return this;
        },

        /**
         * Remove event listener
         * @param event - Event name
         * @param callback - Callback function (optional, removes all if not provided)
         */
        off<K extends ClientEventName>(event: K, callback?: (data: ClientEventMap[K]) => void): unknown {
            if (!callback) {
                delete this.listeners[event];
            } else {
                const listeners = (this.listeners as Record<string, unknown[]>)[event];
                if (listeners) {
                    (this.listeners as Record<string, unknown[]>)[event] = listeners.filter((cb) => cb !== callback);
                }
            }
            return this;
        },

        /**
         * Register one-time event listener
         * @param event - Event name
         * @param callback - Callback function
         */
        once<K extends ClientEventName>(event: K, callback: (data: ClientEventMap[K]) => void): unknown {
            const wrapper = (data: ClientEventMap[K]): void => {
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
        createRoom(options: CreateRoomOptions = { roomId: '' }): Promise<JoinCreateResult> {
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

                const onCreated = (data: JoinCreateResult): void => {
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
                this.socket?.emit('room:create', {
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
         * Proper listener cleanup and timeout cancellation
         * @param roomId - Room ID to join
         * @param nickname - Player nickname
         */
        joinRoom(roomId: string, nickname: string): Promise<JoinCreateResult> {
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

                const onJoined = (data: JoinCreateResult): void => {
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
                this.socket?.emit('room:join', { roomId, nickname, requestId });

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
         * Use safe storage methods
         */
        leaveRoom(): void {
            this._getSocket()?.emit('room:leave');
            this.roomCode = null;
            this.player = null;
            this._offlineQueue = [];
            this._safeRemoveStorage(sessionStorage, 'eigennamen-room-code');
        },

        /**
         * Update room settings (host only)
         * @param settings - New settings
         */
        updateSettings(settings: Record<string, unknown>): void {
            this._getSocket()?.emit('room:settings', settings);
        },

        /**
         * Kick a player from the room (host only)
         * @param targetSessionId - Session ID of player to kick
         */
        kickPlayer(targetSessionId: string): void {
            if (!this.player?.isHost) {
                logger.warn('Only the host can kick players');
                return;
            }
            this._getSocket()?.emit('player:kick', { targetSessionId });
        },

        /**
         * Request full state resync from server
         * Proper listener cleanup and timeout cancellation
         * Use this if you detect you're out of sync
         */
        requestResync(): Promise<ClientEventMap['roomResynced']> {
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

                const onResynced = (data: ClientEventMap['roomResynced']): void => {
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

                this._getSocket()?.emit('room:resync', { requestId });

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
        setTeam(team: string | null, callback?: (result: unknown) => void): void {
            if (callback) {
                // Callbacks can't be queued — emit directly or skip
                this._getSocket()?.emit('player:setTeam', { team }, callback);
            } else {
                this._queueOrEmit('player:setTeam', { team });
            }
        },

        /**
         * Set player role
         * @param role - 'spymaster', 'guesser', or 'spectator'
         * @param callback - Optional acknowledgement callback
         */
        setRole(role: string, callback?: (result: unknown) => void): void {
            if (callback) {
                this._getSocket()?.emit('player:setRole', { role }, callback);
            } else {
                this._queueOrEmit('player:setRole', { role });
            }
        },

        /**
         * Change nickname
         * @param nickname - New nickname
         */
        setNickname(nickname: string): void {
            this._queueOrEmit('player:setNickname', { nickname });
        },

        // =====================
        // Game Actions
        // =====================

        /**
         * Start a new game (host only)
         * @param options - Game options
         */
        startGame(options: Record<string, unknown> = {}): void {
            this._getSocket()?.emit('game:start', options);
        },

        /**
         * Reveal a card (host only)
         * @param index - Card index (0-24)
         */
        revealCard(index: number): void {
            this._getSocket()?.emit('game:reveal', { index });
        },

        /**
         * End current turn (host only)
         */
        endTurn(): void {
            this._queueOrEmit('game:endTurn', {});
        },

        /**
         * Forfeit the game (host only)
         */
        forfeit(): void {
            this._getSocket()?.emit('game:forfeit');
        },

        /**
         * Request past games history for replay
         * @param limit - Maximum number of games to return
         */
        getGameHistory(limit: number = 10): void {
            this._getSocket()?.emit('game:getHistory', { limit });
        },

        /**
         * Request replay data for a specific game
         * @param gameId - Game ID to replay
         */
        getReplay(gameId: string): void {
            this._getSocket()?.emit('game:getReplay', { gameId });
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
         * Send a spectator-only chat message
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
         * Get socket or null if not connected, with a warning log.
         * Use this instead of this.socket! in action methods.
         */
        _getSocket(): SocketClientInstance | null {
            if (!this.socket) {
                logger.warn('Socket action attempted but not connected');
                return null;
            }
            return this.socket;
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
         * Uses safe storage methods
         * Uses sessionStorage to prevent multi-tab conflicts
         */
        getStoredRoomCode(): string | null {
            return this._safeGetStorage(sessionStorage, 'eigennamen-room-code');
        },

        /**
         * Get stored nickname
         * Uses safe storage methods
         */
        getStoredNickname(): string | null {
            return this._safeGetStorage(localStorage, 'eigennamen-nickname');
        },

        /**
         * Clear all stored session data
         * Uses safe storage methods
         * Session ID and room code use sessionStorage (per-tab)
         * Nickname uses localStorage for user convenience
         */
        clearSession(): void {
            this._safeRemoveStorage(sessionStorage, 'eigennamen-session-id');
            this._safeRemoveStorage(sessionStorage, 'eigennamen-room-code');
            this._safeRemoveStorage(localStorage, 'eigennamen-nickname');
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
    global.EigennamenClient = EigennamenClient;

})(typeof window !== 'undefined' ? window : globalThis as any);
