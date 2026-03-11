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
import {
    loadSocketIO,
    isSocketIOAvailable,
    doConnect,
    cleanupSocketListeners,
    queueOrEmit,
} from './socket-client-connection.js';
import { createRoom, joinRoom, requestResync } from './socket-client-rooms.js';
import type {
    SocketClientInstance,
    Player,
    ConnectOptions,
    CreateRoomOptions,
    SocketListenerEntry,
    OfflineQueueItem,
    ListenerMap,
    EigennamenGlobal,
    ClientEventMap,
    ClientEventName,
} from './socket-client-types.js';
import type { JoinCreateResult } from './multiplayerTypes.js';

(function (global: (Window & EigennamenGlobal) | (typeof globalThis & EigennamenGlobal)) {
    'use strict';

    const EigennamenClient = {
        socket: null as SocketClientInstance | null,
        sessionId: null as string | null,
        roomCode: null as string | null,
        player: null as Player | null,
        connected: false,
        reconnectAttempts: 0,
        maxReconnectAttempts: 5,
        autoRejoin: true,
        storedNickname: null as string | null,
        listeners: {} as ListenerMap,
        joinInProgress: false,
        createInProgress: false,
        _socketListeners: [] as SocketListenerEntry[],
        _offlineQueue: [] as OfflineQueueItem[],
        _offlineQueueMaxSize: 20,
        _nextRequestId: 0,

        // =====================
        // Connection Lifecycle
        // =====================

        connect(serverUrl: string | null = null, options: ConnectOptions = {}): Promise<SocketClientInstance> {
            const self = this;
            return loadSocketIO().then(function () {
                return doConnect(self, serverUrl, options);
            });
        },

        // =====================
        // Event Bus
        // =====================

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

        on<K extends ClientEventName>(event: K, callback: (data: ClientEventMap[K]) => void): unknown {
            if (!this.listeners[event]) {
                (this.listeners as Record<string, unknown[]>)[event] = [];
            }
            (this.listeners as Record<string, unknown[]>)[event]!.push(callback);
            return this;
        },

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

        createRoom(options: CreateRoomOptions = { roomId: '' }): Promise<JoinCreateResult> {
            return createRoom(this, options);
        },

        joinRoom(roomId: string, nickname: string): Promise<JoinCreateResult> {
            return joinRoom(this, roomId, nickname);
        },

        leaveRoom(): void {
            this._getSocket()?.emit('room:leave');
            this.roomCode = null;
            this.player = null;
            this._offlineQueue = [];
            safeRemoveStorage(sessionStorage, 'eigennamen-room-code');
        },

        updateSettings(settings: Record<string, unknown>): void {
            this._getSocket()?.emit('room:settings', settings);
        },

        kickPlayer(targetSessionId: string): void {
            if (!this.player?.isHost) {
                logger.warn('Only the host can kick players');
                return;
            }
            this._getSocket()?.emit('player:kick', { targetSessionId });
        },

        requestResync(): Promise<ClientEventMap['roomResynced']> {
            return requestResync(this);
        },

        // =====================
        // Player Actions
        // =====================

        setTeam(team: string | null, callback?: (result: unknown) => void): void {
            if (callback) {
                this._getSocket()?.emit('player:setTeam', { team }, callback);
            } else {
                queueOrEmit(this, 'player:setTeam', { team });
            }
        },

        setRole(role: string, callback?: (result: unknown) => void): void {
            if (callback) {
                this._getSocket()?.emit('player:setRole', { role }, callback);
            } else {
                queueOrEmit(this, 'player:setRole', { role });
            }
        },

        setTeamRole(team: string, role: string, callback?: (result: unknown) => void): void {
            if (callback) {
                this._getSocket()?.emit('player:setTeamRole', { team, role }, callback);
            } else {
                queueOrEmit(this, 'player:setTeamRole', { team, role });
            }
        },

        setNickname(nickname: string): void {
            queueOrEmit(this, 'player:setNickname', { nickname });
        },

        // =====================
        // Game Actions
        // =====================

        startGame(options: Record<string, unknown> = {}): void {
            this._getSocket()?.emit('game:start', options);
        },

        nextRound(): void {
            this._getSocket()?.emit('game:nextRound');
        },

        revealCard(index: number): void {
            this._getSocket()?.emit('game:reveal', { index });
        },

        endTurn(): void {
            queueOrEmit(this, 'game:endTurn', {});
        },

        forfeit(team?: string): void {
            if (team) {
                this._getSocket()?.emit('game:forfeit', { team });
            } else {
                this._getSocket()?.emit('game:forfeit');
            }
        },

        getGameHistory(limit: number = 10): void {
            this._getSocket()?.emit('game:getHistory', { limit });
        },

        getReplay(gameId: string): void {
            this._getSocket()?.emit('game:getReplay', { gameId });
        },

        abandonGame(): void {
            this._getSocket()?.emit('game:abandon');
        },

        clearHistory(): void {
            this._getSocket()?.emit('game:clearHistory');
        },

        // =====================
        // Chat Actions
        // =====================

        sendMessage(text: string, teamOnly: boolean = false): void {
            queueOrEmit(this, 'chat:message', { text, teamOnly });
        },

        sendSpectatorChat(message: string): void {
            if (!message?.trim()) return;
            queueOrEmit(this, 'chat:spectator', { message: message.trim() });
        },

        // =====================
        // Session & Storage
        // =====================

        _saveSession(): void {
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

        disconnect(): void {
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

        isSocketIOAvailable(): boolean {
            return isSocketIOAvailable();
        },

        _getSocket(): SocketClientInstance | null {
            if (!this.socket) {
                logger.warn('Socket action attempted but not connected');
                return null;
            }
            return this.socket;
        },

        isConnected(): boolean {
            return this.connected && !!this.socket?.connected;
        },

        isInRoom(): boolean {
            return !!this.roomCode;
        },

        isHost(): boolean {
            return this.player?.isHost === true;
        },

        isSpymaster(): boolean {
            return this.player?.role === 'spymaster';
        },

        getRoomCode(): string | null {
            return this.roomCode;
        },

        getPlayer(): Player | null {
            return this.player;
        },

        getStoredRoomCode(): string | null {
            try {
                return sessionStorage.getItem('eigennamen-room-code');
            } catch {
                return null;
            }
        },

        getStoredNickname(): string | null {
            try {
                return localStorage.getItem('eigennamen-nickname');
            } catch {
                return null;
            }
        },

        clearSession(): void {
            safeRemoveStorage(sessionStorage, 'eigennamen-session-id');
            safeRemoveStorage(sessionStorage, 'eigennamen-room-code');
            safeRemoveStorage(localStorage, 'eigennamen-nickname');
            this.sessionId = null;
            this.storedNickname = null;
            this.joinInProgress = false;
            this.createInProgress = false;
        },

        setAutoRejoin(enabled: boolean): void {
            this.autoRejoin = enabled;
        },
    };

    // Export to global scope
    global.EigennamenClient = EigennamenClient;
})(typeof window !== 'undefined' ? window : (globalThis as typeof globalThis & EigennamenGlobal));
