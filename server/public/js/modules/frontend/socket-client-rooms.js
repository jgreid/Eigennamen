/**
 * Room action methods for the Eigennamen WebSocket Client.
 *
 * Extracted from socket-client.ts. Contains the promise-based
 * room operations (create, join, resync) with proper timeout
 * and cleanup handling.
 */
import { logger } from './logger.js';
function generateRequestId(host) {
    host._nextRequestId = (host._nextRequestId + 1) % Number.MAX_SAFE_INTEGER;
    return 'req_' + host._nextRequestId;
}
function getSocket(host) {
    if (!host.socket) {
        logger.warn('Socket action attempted but not connected');
        return null;
    }
    return host.socket;
}
/**
 * Create a new room.
 * @param host - The adapter object
 * @param options - Room options including roomId and settings
 */
export function createRoom(host, options = { roomId: '' }) {
    if (host.createInProgress) {
        return Promise.reject(new Error('Room creation already in progress'));
    }
    host.createInProgress = true;
    return new Promise((resolve, reject) => {
        const { roomId, nickname, ...settings } = options;
        if (!roomId) {
            host.createInProgress = false;
            reject(new Error('Room ID is required'));
            return;
        }
        const requestId = generateRequestId(host);
        let timeoutId = null;
        let settled = false;
        const cleanup = () => {
            host.createInProgress = false;
            if (timeoutId) {
                clearTimeout(timeoutId);
                timeoutId = null;
            }
            host.off('roomCreated', onCreated);
            host.off('error', onError);
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
            if (error.type === 'connection') {
                settled = true;
                cleanup();
                reject(error);
                return;
            }
            if (error.type === 'room') {
                if (error.requestId !== undefined && error.requestId !== requestId)
                    return;
                settled = true;
                cleanup();
                reject(error);
            }
        };
        host.on('roomCreated', onCreated);
        host.on('error', onError);
        host.socket?.emit('room:create', {
            roomId,
            settings: { nickname, ...settings },
            requestId,
        });
        timeoutId = setTimeout(() => {
            if (settled)
                return;
            settled = true;
            cleanup();
            reject(new Error('Create room timeout'));
        }, 30000);
    });
}
/**
 * Join an existing room.
 * @param host - The adapter object
 * @param roomId - Room ID to join
 * @param nickname - Player nickname
 */
export function joinRoom(host, roomId, nickname) {
    if (host.joinInProgress) {
        return Promise.reject(new Error('Join already in progress'));
    }
    host.joinInProgress = true;
    return new Promise((resolve, reject) => {
        const requestId = generateRequestId(host);
        let timeoutId = null;
        let settled = false;
        const cleanup = () => {
            host.joinInProgress = false;
            if (timeoutId) {
                clearTimeout(timeoutId);
                timeoutId = null;
            }
            host.off('roomJoined', onJoined);
            host.off('error', onError);
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
            if (error.type === 'connection') {
                settled = true;
                cleanup();
                reject(error);
                return;
            }
            if (error.type === 'room') {
                if (error.requestId !== undefined && error.requestId !== requestId)
                    return;
                settled = true;
                cleanup();
                reject(error);
            }
        };
        host.on('roomJoined', onJoined);
        host.on('error', onError);
        host.socket?.emit('room:join', { roomId, nickname, requestId });
        // Client timeout (20s) exceeds server JOIN_ROOM timeout (15s)
        timeoutId = setTimeout(() => {
            if (settled)
                return;
            settled = true;
            cleanup();
            reject(new Error('Join room timeout'));
        }, 20000);
    });
}
/**
 * Request a full state resync from the server.
 * @param host - The adapter object
 */
export function requestResync(host) {
    return new Promise((resolve, reject) => {
        if (!host.roomCode) {
            reject(new Error('Not in a room'));
            return;
        }
        const requestId = generateRequestId(host);
        let timeoutId = null;
        let settled = false;
        const cleanup = () => {
            if (timeoutId) {
                clearTimeout(timeoutId);
                timeoutId = null;
            }
            host.off('roomResynced', onResynced);
            host.off('error', onError);
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
            if (error.type === 'connection') {
                settled = true;
                cleanup();
                reject(error);
                return;
            }
            if (error.type === 'room') {
                if (error.requestId !== undefined && error.requestId !== requestId)
                    return;
                settled = true;
                cleanup();
                reject(error);
            }
        };
        host.on('roomResynced', onResynced);
        host.on('error', onError);
        getSocket(host)?.emit('room:resync', { requestId });
        timeoutId = setTimeout(() => {
            if (settled)
                return;
            settled = true;
            cleanup();
            reject(new Error('Resync timeout'));
        }, 10000);
    });
}
//# sourceMappingURL=socket-client-rooms.js.map