/**
 * Socket.io connection lifecycle for the Eigennamen WebSocket Client.
 *
 * Extracted from socket-client.ts. Handles connection setup, reconnection,
 * auto-rejoin, and offline queue management.
 */

import { logger } from './logger.js';
import { CONNECTION } from './constants.js';
import { safeGetStorage, safeRemoveStorage } from './socket-client-storage.js';
import { registerAllEventListeners } from './socket-client-events.js';
import type {
    SocketClientInstance,
    ConnectOptions,
    SocketListenerEntry,
    OfflineQueueItem,
    ClientEventMap,
    ClientEventName,
} from './socket-client-types.js';
import type { ServerErrorData } from './multiplayerTypes.js';

/** Read/write accessors the connection module needs from the main adapter. */
export interface ConnectionHost {
    socket: SocketClientInstance | null;
    sessionId: string | null;
    /** Per-session auth secret the handshake must present to re-adopt the session (N1) */
    sessionToken: string | null;
    roomCode: string | null;
    player: import('./socket-client-types.js').Player | null;
    connected: boolean;
    reconnectAttempts: number;
    maxReconnectAttempts: number;
    autoRejoin: boolean;
    storedNickname: string | null;
    joinInProgress: boolean;
    createInProgress: boolean;
    /**
     * Set when an established connection drops for any reason other than an
     * intentional client disconnect. Socket.io's auto-reconnect can re-fire
     * 'connect' after a transient blip WITHOUT any 'connect_error' (so
     * reconnectAttempts stays 0), so this flag — not reconnectAttempts — is what
     * tells the connect handler a rejoin/resync is needed.
     */
    hadUnexpectedDisconnect?: boolean;
    _socketListeners: SocketListenerEntry[];
    _offlineQueue: OfflineQueueItem[];
    _offlineQueueMaxSize: number;

    /** Emit event on the adapter's internal listener bus */
    _emit<K extends ClientEventName>(event: K, data: ClientEventMap[K]): void;
    /** Save session to storage */
    _saveSession(): void;
    /** Join room (for auto-rejoin) */
    joinRoom(roomId: string, nickname: string): Promise<import('./multiplayerTypes.js').JoinCreateResult>;
    /** Request resync */
    requestResync(): Promise<ClientEventMap['roomResynced']>;
}

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
export function loadSocketIO(): Promise<void> {
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
            } else {
                reject(new Error('Socket.io script loaded but io global is missing'));
            }
        };
        script.onerror = function () {
            reject(
                new Error(
                    'Failed to load Socket.io client library. Check your network connection and refresh the page.'
                )
            );
        };
        document.head.appendChild(script);
    });
}

/** Check if Socket.io library is available */
export function isSocketIOAvailable(): boolean {
    return isSocketIOReady();
}

/**
 * Create and connect a Socket.io client instance.
 * @param host - The adapter object to bind to
 * @param serverUrl - Server URL (optional, defaults to current host)
 * @param options - Connection options
 */
export function doConnect(
    host: ConnectionHost,
    serverUrl: string | null = null,
    options: ConnectOptions = {}
): Promise<SocketClientInstance> {
    return new Promise((resolve, reject) => {
        host.sessionId = safeGetStorage(sessionStorage, 'eigennamen-session-id');
        host.sessionToken = safeGetStorage(sessionStorage, 'eigennamen-session-token');
        host.storedNickname = safeGetStorage(localStorage, 'eigennamen-nickname');
        host.autoRejoin = options.autoRejoin !== false;

        const url = serverUrl || window.location.origin;

        // Track whether the INITIAL connection has been settled (resolved or
        // rejected). Used to bound the initial handshake and to suppress
        // per-attempt error emits during background auto-reconnect (I4).
        let settled = false;

        // Tear down any pre-existing socket before creating a new one. During a
        // transient disconnect the old socket.io Manager keeps auto-reconnecting;
        // creating a second socket without disconnecting the first orphans the old
        // one with its listeners still attached (setupEventListeners' cleanup would
        // run against the NEW socket, not the old), leaking a live connection and
        // duplicating events. Clean listeners while host.socket still points at the
        // old instance, then disconnect it.
        if (host.socket) {
            cleanupSocketListeners(host);
            try {
                host.socket.disconnect();
            } catch {
                /* already closed */
            }
            host.socket = null;
        }

        const socket = io(url, {
            // auth as a FUNCTION so socket.io re-reads the CURRENT credentials on
            // every (re)connection attempt. A frozen object would replay the
            // values captured at first connect — a brand-new user's null
            // sessionId/sessionToken — on every auto-reconnect, even after the
            // server issued real ones via room:created/room:joined.
            auth: (cb: (data: Record<string, unknown>) => void) =>
                cb({
                    sessionId: host.sessionId,
                    // Required to re-adopt an existing session: peers know our
                    // playerId but never this secret, so a harvested sessionId
                    // alone can no longer hijack the seat (N1).
                    sessionToken: host.sessionToken,
                }),
            // WebSocket-first with a polling fallback, regardless of page scheme.
            // The production server is websocket-only (serverConfig.ts), so a
            // scheme-based choice (`polling` first for HTTP pages) left a
            // self-hosted HTTP+production deploy unable to connect at all — the
            // client opened with polling, the server rejected it, and engine.io
            // never advanced transports. websocket-first connects against that
            // server on HTTP or HTTPS; `tryAllTransports` keeps polling as a
            // genuine fallback for proxies that block websockets (I2).
            transports: ['websocket', 'polling'],
            tryAllTransports: true,
            reconnection: true,
            reconnectionAttempts: CONNECTION.MAX_RECONNECT_ATTEMPTS,
            reconnectionDelay: CONNECTION.RECONNECT_DELAY_MS,
            reconnectionDelayMax: CONNECTION.RECONNECT_DELAY_MAX_MS,
            ...options.socketOptions,
        }) as unknown as SocketClientInstance;
        host.socket = socket;

        socket.on('connect', () => {
            host.connected = true;
            // A reconnect is signalled EITHER by a prior failed attempt
            // (reconnectAttempts, bumped on connect_error) OR by an unexpected
            // disconnect whose first retry succeeded (no connect_error fires, so
            // reconnectAttempts stays 0). Both must trigger a rejoin — otherwise
            // the fresh socket is a member of zero rooms and silently receives no
            // more reveals/clues/chat until the player themselves acts.
            const wasReconnecting = host.reconnectAttempts > 0 || host.hadUnexpectedDisconnect === true;
            host.reconnectAttempts = 0;
            host.hadUnexpectedDisconnect = false;
            logger.debug('Connected to server:', socket.id);

            host._emit('connected', { wasReconnecting });

            if (wasReconnecting && host.autoRejoin) {
                attemptRejoin(host).catch((err: Error) => {
                    logger.error('Auto-rejoin failed:', err);
                    host.joinInProgress = false;
                    host.createInProgress = false;
                });
            }

            settled = true;
            resolve(socket);
        });

        socket.on('disconnect', (...args: unknown[]) => {
            const reason = (args[0] as string) || 'unknown';
            host.connected = false;
            host.createInProgress = false;
            host.joinInProgress = false;
            // Mark unexpected drops so the next 'connect' rejoins the room. An
            // intentional client-side disconnect (leaveRoom/disconnect) halts
            // auto-reconnect, so it neither needs nor should arm a rejoin.
            if (reason !== 'io client disconnect') {
                host.hadUnexpectedDisconnect = true;
            }
            logger.debug('Disconnected:', reason);
            host._emit('disconnected', { reason, wasConnected: true });
        });

        socket.on('connect_error', (...args: unknown[]) => {
            const error = args[0] as Error;
            logger.error('Connection error:', error);
            host.reconnectAttempts++;
            host.createInProgress = false;
            host.joinInProgress = false;

            // Once the initial connection has settled, the socket.io Manager
            // keeps retrying in the background up to CONNECTION.MAX_RECONNECT_ATTEMPTS
            // (now effectively unbounded, I4). The reconnection overlay — shown on
            // 'disconnected' — already communicates status, so re-emitting 'error'
            // on every ~5s retry would spam a toast for the whole outage. Only
            // surface connect errors while establishing the INITIAL connection.
            if (settled) return;

            if (host.reconnectAttempts >= host.maxReconnectAttempts) {
                settled = true;
                reject(error);
            }

            host._emit('error', { type: 'connection', error, attempt: host.reconnectAttempts });
        });

        setupEventListeners(host);
    });
}

/**
 * Attempt to rejoin the previous room on reconnection.
 */
async function attemptRejoin(host: ConnectionHost): Promise<void> {
    const storedRoomCode = safeGetStorage(sessionStorage, 'eigennamen-room-code');
    const nickname = host.storedNickname || host.player?.nickname;

    if (!storedRoomCode || !nickname) {
        logger.debug('Cannot auto-rejoin: missing room code or nickname');
        return;
    }

    logger.debug(`Attempting to rejoin room ${storedRoomCode} as ${nickname}`);
    host._emit('rejoining', { roomCode: storedRoomCode, nickname });

    try {
        const result = await host.joinRoom(storedRoomCode, nickname);
        logger.debug('Successfully rejoined room:', storedRoomCode);
        host._emit('rejoined', result);
        flushOfflineQueue(host);

        try {
            await host.requestResync();
        } catch {
            logger.debug('Post-rejoin resync failed (non-critical)');
        }
    } catch (error) {
        logger.error('Failed to rejoin room:', error);
        safeRemoveStorage(sessionStorage, 'eigennamen-room-code');
        host._emit('rejoinFailed', { error: error as ServerErrorData | undefined });
    }
}

/**
 * Set up Socket.io event listeners.
 * Delegates to registerAllEventListeners() in socket-client-events.ts.
 */
export function setupEventListeners(host: ConnectionHost): void {
    cleanupSocketListeners(host);

    const wrappedEmit = <K extends ClientEventName>(event: K, data: ClientEventMap[K]): void => {
        if (event === 'kicked') {
            safeRemoveStorage(sessionStorage, 'eigennamen-room-code');
        }
        host._emit(event, data);
    };

    registerAllEventListeners(
        (event: string, handler: (...args: unknown[]) => void) => {
            host.socket?.on(event, handler);
            host._socketListeners.push({ event, handler });
        },
        wrappedEmit,
        {
            get roomCode() {
                return host.roomCode;
            },
            set roomCode(v) {
                host.roomCode = v;
            },
            get player() {
                return host.player;
            },
            set player(v) {
                host.player = v;
            },
            get sessionId() {
                return host.sessionId;
            },
            set sessionId(v) {
                host.sessionId = v;
            },
            get sessionToken() {
                return host.sessionToken;
            },
            set sessionToken(v) {
                host.sessionToken = v;
            },
            saveSession: () => host._saveSession(),
        }
    );
}

/**
 * Cleanup socket listeners to prevent memory leaks.
 */
export function cleanupSocketListeners(host: ConnectionHost): void {
    if (host.socket && host._socketListeners.length > 0) {
        host._socketListeners.forEach(({ event, handler }: SocketListenerEntry) => {
            host.socket?.off(event, handler);
        });
    }
    host._socketListeners = [];
}

/**
 * Queue a socket event to send when reconnected, or emit immediately if connected.
 */
export function queueOrEmit(host: ConnectionHost, event: string, data: Record<string, unknown>): void {
    if (host.connected && host.socket?.connected) {
        host.socket.emit(event, data);
    } else {
        const queueableEvents = [
            'chat:message',
            'chat:spectator',
            'player:setTeam',
            'player:setRole',
            'player:setTeamRole',
            'player:setNickname',
            'game:endTurn',
        ];
        if (queueableEvents.includes(event) && host._offlineQueue.length < host._offlineQueueMaxSize) {
            host._offlineQueue.push({ event, data, timestamp: Date.now(), roomCode: host.roomCode });
        }
    }
}

/**
 * Flush queued offline events after reconnection.
 * Discards events that are too old (>2min) or from a different room.
 */
function flushOfflineQueue(host: ConnectionHost): void {
    if (host._offlineQueue.length === 0) return;

    const maxAge = 2 * 60 * 1000;
    const now = Date.now();
    const currentRoom = host.roomCode;
    let replayed = 0;

    for (const item of host._offlineQueue) {
        if (item.roomCode !== currentRoom) continue;
        if (now - item.timestamp >= maxAge) continue;
        if (!host.connected || !host.socket?.connected) break;
        host.socket.emit(item.event, item.data);
        replayed++;
    }

    if (replayed > 0) {
        logger.debug(`Replayed ${replayed} queued event(s) after reconnection`);
    }
    host._offlineQueue = [];
}
