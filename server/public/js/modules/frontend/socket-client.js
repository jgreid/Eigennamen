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
 *   socket-client-types.ts       — Type definitions
 *   socket-client-storage.ts     — Safe browser storage utilities
 *   socket-client-events.ts      — Server-to-client event listener registration
 *   socket-client-connection.ts  — Connection lifecycle, reconnection, offline queue
 *   socket-client-rooms.ts       — Promise-based room actions (create, join, resync)
 */
import { logger } from './logger.js';
import { safeSetStorage, safeRemoveStorage } from './socket-client-storage.js';
import { loadSocketIO, isSocketIOAvailable, doConnect, cleanupSocketListeners, queueOrEmit, } from './socket-client-connection.js';
import { createRoom, joinRoom, requestResync } from './socket-client-rooms.js';
(function (global) {
    'use strict';
    const EigennamenClient = {
        socket: null,
        sessionId: null,
        roomCode: null,
        player: null,
        connected: false,
        reconnectAttempts: 0,
        maxReconnectAttempts: 5,
        autoRejoin: true,
        storedNickname: null,
        listeners: {},
        joinInProgress: false,
        createInProgress: false,
        _socketListeners: [],
        _offlineQueue: [],
        _offlineQueueMaxSize: 20,
        _nextRequestId: 0,
        // =====================
        // Connection Lifecycle
        // =====================
        connect(serverUrl = null, options = {}) {
            const self = this;
            return loadSocketIO().then(function () {
                return doConnect(self, serverUrl, options);
            });
        },
        // =====================
        // Event Bus
        // =====================
        _emit(event, data) {
            const callbacks = (this.listeners[event] || []);
            callbacks.forEach((cb) => {
                try {
                    cb(data);
                }
                catch (err) {
                    logger.error(`Error in ${event} listener:`, err);
                }
            });
        },
        on(event, callback) {
            if (!this.listeners[event]) {
                this.listeners[event] = [];
            }
            this.listeners[event].push(callback);
            return this;
        },
        off(event, callback) {
            if (!callback) {
                delete this.listeners[event];
            }
            else {
                const listeners = this.listeners[event];
                if (listeners) {
                    this.listeners[event] = listeners.filter((cb) => cb !== callback);
                }
            }
            return this;
        },
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
        createRoom(options = { roomId: '' }) {
            return createRoom(this, options);
        },
        joinRoom(roomId, nickname) {
            return joinRoom(this, roomId, nickname);
        },
        leaveRoom() {
            this._getSocket()?.emit('room:leave');
            this.roomCode = null;
            this.player = null;
            this._offlineQueue = [];
            safeRemoveStorage(sessionStorage, 'eigennamen-room-code');
        },
        updateSettings(settings) {
            this._getSocket()?.emit('room:settings', settings);
        },
        kickPlayer(targetSessionId) {
            if (!this.player?.isHost) {
                logger.warn('Only the host can kick players');
                return;
            }
            this._getSocket()?.emit('player:kick', { targetSessionId });
        },
        requestResync() {
            return requestResync(this);
        },
        // =====================
        // Player Actions
        // =====================
        setTeam(team, callback) {
            if (callback) {
                this._getSocket()?.emit('player:setTeam', { team }, callback);
            }
            else {
                queueOrEmit(this, 'player:setTeam', { team });
            }
        },
        setRole(role, callback) {
            if (callback) {
                this._getSocket()?.emit('player:setRole', { role }, callback);
            }
            else {
                queueOrEmit(this, 'player:setRole', { role });
            }
        },
        setNickname(nickname) {
            queueOrEmit(this, 'player:setNickname', { nickname });
        },
        // =====================
        // Game Actions
        // =====================
        startGame(options = {}) {
            this._getSocket()?.emit('game:start', options);
        },
        nextRound() {
            this._getSocket()?.emit('game:nextRound');
        },
        revealCard(index) {
            this._getSocket()?.emit('game:reveal', { index });
        },
        endTurn() {
            queueOrEmit(this, 'game:endTurn', {});
        },
        forfeit() {
            this._getSocket()?.emit('game:forfeit');
        },
        getGameHistory(limit = 10) {
            this._getSocket()?.emit('game:getHistory', { limit });
        },
        getReplay(gameId) {
            this._getSocket()?.emit('game:getReplay', { gameId });
        },
        abandonGame() {
            this._getSocket()?.emit('game:abandon');
        },
        clearHistory() {
            this._getSocket()?.emit('game:clearHistory');
        },
        // =====================
        // Chat Actions
        // =====================
        sendMessage(text, teamOnly = false) {
            queueOrEmit(this, 'chat:message', { text, teamOnly });
        },
        sendSpectatorChat(message) {
            if (!message?.trim())
                return;
            queueOrEmit(this, 'chat:spectator', { message: message.trim() });
        },
        // =====================
        // Session & Storage
        // =====================
        _saveSession() {
            if (this.sessionId) {
                safeSetStorage(sessionStorage, 'eigennamen-session-id', this.sessionId);
            }
            if (this.roomCode) {
                safeSetStorage(sessionStorage, 'eigennamen-room-code', this.roomCode);
            }
            if (this.player?.nickname) {
                safeSetStorage(localStorage, 'eigennamen-nickname', this.player.nickname);
                this.storedNickname = this.player.nickname;
            }
        },
        // =====================
        // Utility
        // =====================
        disconnect() {
            cleanupSocketListeners(this);
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
        isSocketIOAvailable() {
            return isSocketIOAvailable();
        },
        _getSocket() {
            if (!this.socket) {
                logger.warn('Socket action attempted but not connected');
                return null;
            }
            return this.socket;
        },
        isConnected() {
            return this.connected && !!this.socket?.connected;
        },
        isInRoom() {
            return !!this.roomCode;
        },
        isHost() {
            return this.player?.isHost === true;
        },
        isSpymaster() {
            return this.player?.role === 'spymaster';
        },
        getRoomCode() {
            return this.roomCode;
        },
        getPlayer() {
            return this.player;
        },
        getStoredRoomCode() {
            try {
                return sessionStorage.getItem('eigennamen-room-code');
            }
            catch {
                return null;
            }
        },
        getStoredNickname() {
            try {
                return localStorage.getItem('eigennamen-nickname');
            }
            catch {
                return null;
            }
        },
        clearSession() {
            safeRemoveStorage(sessionStorage, 'eigennamen-session-id');
            safeRemoveStorage(sessionStorage, 'eigennamen-room-code');
            safeRemoveStorage(localStorage, 'eigennamen-nickname');
            this.sessionId = null;
            this.storedNickname = null;
            this.joinInProgress = false;
            this.createInProgress = false;
        },
        setAutoRejoin(enabled) {
            this.autoRejoin = enabled;
        },
    };
    // Export to global scope
    global.EigennamenClient = EigennamenClient;
})(typeof window !== 'undefined' ? window : globalThis);
//# sourceMappingURL=socket-client.js.map