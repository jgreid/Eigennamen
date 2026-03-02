/**
 * Socket.io connection lifecycle for the Eigennamen WebSocket Client.
 *
 * Extracted from socket-client.ts. Handles connection setup, reconnection,
 * auto-rejoin, and offline queue management.
 */
import { logger } from './logger.js';
import { safeGetStorage, safeRemoveStorage } from './socket-client-storage.js';
import { registerAllEventListeners } from './socket-client-events.js';
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
export function loadSocketIO() {
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
/** Check if Socket.io library is available */
export function isSocketIOAvailable() {
    return isSocketIOReady();
}
/**
 * Create and connect a Socket.io client instance.
 * @param host - The adapter object to bind to
 * @param serverUrl - Server URL (optional, defaults to current host)
 * @param options - Connection options
 */
export function doConnect(host, serverUrl = null, options = {}) {
    return new Promise((resolve, reject) => {
        host.sessionId = safeGetStorage(sessionStorage, 'eigennamen-session-id');
        host.storedNickname = safeGetStorage(localStorage, 'eigennamen-nickname');
        host.autoRejoin = options.autoRejoin !== false;
        const url = serverUrl || window.location.origin;
        // Production (HTTPS) uses websocket only for better Fly.io compatibility
        // Development (HTTP) uses polling + websocket for easier debugging
        const isSecure = url.startsWith('https://');
        const transports = isSecure ? ['websocket'] : ['polling', 'websocket'];
        const socket = io(url, {
            auth: {
                sessionId: host.sessionId,
            },
            transports: transports,
            reconnection: true,
            reconnectionAttempts: host.maxReconnectAttempts,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
            ...options.socketOptions,
        });
        host.socket = socket;
        socket.on('connect', () => {
            host.connected = true;
            const wasReconnecting = host.reconnectAttempts > 0;
            host.reconnectAttempts = 0;
            logger.debug('Connected to server:', socket.id);
            host._emit('connected', { wasReconnecting });
            if (wasReconnecting && host.autoRejoin) {
                attemptRejoin(host).catch((err) => {
                    logger.error('Auto-rejoin failed:', err);
                    host.joinInProgress = false;
                    host.createInProgress = false;
                });
            }
            resolve(socket);
        });
        socket.on('disconnect', (...args) => {
            const reason = args[0] || 'unknown';
            host.connected = false;
            host.createInProgress = false;
            host.joinInProgress = false;
            logger.debug('Disconnected:', reason);
            host._emit('disconnected', { reason, wasConnected: true });
        });
        socket.on('connect_error', (...args) => {
            const error = args[0];
            logger.error('Connection error:', error);
            host.reconnectAttempts++;
            host.createInProgress = false;
            host.joinInProgress = false;
            if (host.reconnectAttempts >= host.maxReconnectAttempts) {
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
async function attemptRejoin(host) {
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
        }
        catch {
            logger.debug('Post-rejoin resync failed (non-critical)');
        }
    }
    catch (error) {
        logger.error('Failed to rejoin room:', error);
        safeRemoveStorage(sessionStorage, 'eigennamen-room-code');
        host._emit('rejoinFailed', { error: error });
    }
}
/**
 * Set up Socket.io event listeners.
 * Delegates to registerAllEventListeners() in socket-client-events.ts.
 */
export function setupEventListeners(host) {
    cleanupSocketListeners(host);
    const wrappedEmit = (event, data) => {
        if (event === 'kicked') {
            safeRemoveStorage(sessionStorage, 'eigennamen-room-code');
        }
        host._emit(event, data);
    };
    registerAllEventListeners((event, handler) => {
        host.socket?.on(event, handler);
        host._socketListeners.push({ event, handler });
    }, wrappedEmit, {
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
        saveSession: () => host._saveSession(),
    });
}
/**
 * Cleanup socket listeners to prevent memory leaks.
 */
export function cleanupSocketListeners(host) {
    if (host.socket && host._socketListeners.length > 0) {
        host._socketListeners.forEach(({ event, handler }) => {
            host.socket?.off(event, handler);
        });
    }
    host._socketListeners = [];
}
/**
 * Queue a socket event to send when reconnected, or emit immediately if connected.
 */
export function queueOrEmit(host, event, data) {
    if (host.connected && host.socket?.connected) {
        host.socket.emit(event, data);
    }
    else {
        const queueableEvents = [
            'chat:message',
            'chat:spectator',
            'player:setTeam',
            'player:setRole',
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
function flushOfflineQueue(host) {
    if (host._offlineQueue.length === 0)
        return;
    const maxAge = 2 * 60 * 1000;
    const now = Date.now();
    const currentRoom = host.roomCode;
    let replayed = 0;
    for (const item of host._offlineQueue) {
        if (item.roomCode !== currentRoom)
            continue;
        if (now - item.timestamp >= maxAge)
            continue;
        if (!host.connected || !host.socket?.connected)
            break;
        host.socket.emit(item.event, item.data);
        replayed++;
    }
    if (replayed > 0) {
        logger.debug(`Replayed ${replayed} queued event(s) after reconnection`);
    }
    host._offlineQueue = [];
}
//# sourceMappingURL=socket-client-connection.js.map