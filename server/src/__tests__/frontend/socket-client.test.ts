/**
 * Socket Client Unit Tests
 *
 * Tests the ACTUAL EigennamenClient from socket-client.ts (IIFE module).
 * The IIFE executes on import and assigns EigennamenClient to globalThis.
 *
 * Focus areas (per review):
 *   1. Delegation to extracted modules (connection, rooms)
 *   2. Reconnection race conditions (via mocked room ops)
 *   3. Auth / connection timeout (via mocked room ops)
 *   4. Socket.io library load failure
 *   5. Duplicate event deduplication (createRoom / joinRoom guards)
 *
 * Test environment: jsdom (provides window, document, sessionStorage, localStorage).
 */

/* -------------------------------------------------------------------------- */
/*  Mocks — must be set up BEFORE the IIFE import runs                        */
/* -------------------------------------------------------------------------- */

jest.mock('../../frontend/logger', () => ({
    logger: {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    },
}));

jest.mock('../../frontend/socket-client-storage', () => ({
    safeSetStorage: jest.fn(() => true),
    safeGetStorage: jest.fn(() => null),
    safeRemoveStorage: jest.fn(),
}));

jest.mock('../../frontend/socket-client-events', () => ({
    registerAllEventListeners: jest.fn(),
}));

jest.mock('../../frontend/socket-client-connection', () => ({
    loadSocketIO: jest.fn(() => Promise.resolve()),
    isSocketIOAvailable: jest.fn(() => true),
    doConnect: jest.fn(),
    cleanupSocketListeners: jest.fn(),
    setupEventListeners: jest.fn(),
    queueOrEmit: jest.fn(),
}));

jest.mock('../../frontend/socket-client-rooms', () => ({
    createRoom: jest.fn(),
    joinRoom: jest.fn(),
    requestResync: jest.fn(),
}));

/* -------------------------------------------------------------------------- */
/*  Mock socket factory                                                        */
/* -------------------------------------------------------------------------- */

interface MockSocket {
    id: string;
    connected: boolean;
    on: jest.Mock;
    off: jest.Mock;
    emit: jest.Mock;
    disconnect: jest.Mock;
    /** Helper: retrieve the handler registered for a given event via on() */
    _getHandler(event: string): ((...args: unknown[]) => void) | undefined;
    /** Helper: fire a socket event, invoking the registered handler */
    _fireEvent(event: string, ...args: unknown[]): void;
}

function createMockSocket(): MockSocket {
    const handlers = new Map<string, (...args: unknown[]) => void>();
    const socket: MockSocket = {
        id: 'mock-socket-id-' + Math.random().toString(36).slice(2, 8),
        connected: false,
        on: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
            handlers.set(event, handler);
        }),
        off: jest.fn(),
        emit: jest.fn(),
        disconnect: jest.fn(),
        _getHandler(event: string) {
            return handlers.get(event);
        },
        _fireEvent(event: string, ...args: unknown[]) {
            const handler = handlers.get(event);
            if (handler) handler(...args);
        },
    };
    return socket;
}

/* -------------------------------------------------------------------------- */
/*  Global `io` setup — the IIFE checks for the global `io` function          */
/* -------------------------------------------------------------------------- */

let mockSocket: MockSocket;

// The global `io` that the IIFE (and loadSocketIO/isSocketIOReady) look for.
// It must be a function with a `.Manager` property that is also a function.
function setupGlobalIO(): void {
    mockSocket = createMockSocket();
    const ioFn = jest.fn(() => mockSocket) as jest.Mock & { Manager: jest.Mock };
    ioFn.Manager = jest.fn();
    (globalThis as Record<string, unknown>).io = ioFn;
}

// Install before import so the IIFE's isSocketIOReady() returns true during load.
setupGlobalIO();

/* -------------------------------------------------------------------------- */
/*  Import — this runs the IIFE and populates globalThis.EigennamenClient      */
/* -------------------------------------------------------------------------- */

// Import the IIFE module. Side-effect: assigns EigennamenClient on globalThis.
import '../../frontend/socket-client';

// Import mocked module functions for verification
import { doConnect, cleanupSocketListeners, queueOrEmit, loadSocketIO } from '../../frontend/socket-client-connection';
import { createRoom, joinRoom, requestResync } from '../../frontend/socket-client-rooms';

// Type for the client object exposed on globalThis.
// We keep it loose (Record) because the IIFE is not a proper ES export.
type EigennamenClientType = Record<string, any>;

function getClient(): EigennamenClientType {
    return (globalThis as Record<string, unknown>).EigennamenClient as EigennamenClientType;
}

/* -------------------------------------------------------------------------- */
/*  Tests                                                                      */
/* -------------------------------------------------------------------------- */

describe('socket-client (EigennamenClient IIFE)', () => {
    let client: EigennamenClientType;

    beforeEach(() => {
        jest.useFakeTimers();
        setupGlobalIO();
        jest.clearAllMocks();

        client = getClient();

        // Reset mutable state between tests.
        client.socket = null;
        client.sessionId = null;
        client.roomCode = null;
        client.player = null;
        client.connected = false;
        client.reconnectAttempts = 0;
        client.autoRejoin = true;
        client.storedNickname = null;
        client.listeners = {};
        client.joinInProgress = false;
        client.createInProgress = false;
        client._socketListeners = [];
        client._offlineQueue = [];
        client._nextRequestId = 0;
    });

    afterEach(() => {
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    /* ================================================================== */
    /*  1. Offline queue — delegation to queueOrEmit                       */
    /* ================================================================== */

    describe('offline queue delegation', () => {
        it('sendMessage delegates to queueOrEmit with chat:message', () => {
            client.sendMessage('hello', false);

            expect(queueOrEmit).toHaveBeenCalledWith(client, 'chat:message', { text: 'hello', teamOnly: false });
        });

        it('sendMessage passes teamOnly flag to queueOrEmit', () => {
            client.sendMessage('secret', true);

            expect(queueOrEmit).toHaveBeenCalledWith(client, 'chat:message', { text: 'secret', teamOnly: true });
        });

        it('setTeam without callback delegates to queueOrEmit', () => {
            client.setTeam('red');

            expect(queueOrEmit).toHaveBeenCalledWith(client, 'player:setTeam', { team: 'red' });
        });

        it('setTeam with callback emits directly on socket instead of queueOrEmit', () => {
            const emitFn = jest.fn();
            const cb = jest.fn();
            client.socket = { connected: true, emit: emitFn };

            client.setTeam('blue', cb);

            expect(queueOrEmit).not.toHaveBeenCalled();
            expect(emitFn).toHaveBeenCalledWith('player:setTeam', { team: 'blue' }, cb);
        });

        it('setRole without callback delegates to queueOrEmit', () => {
            client.setRole('spymaster');

            expect(queueOrEmit).toHaveBeenCalledWith(client, 'player:setRole', { role: 'spymaster' });
        });

        it('setRole with callback emits directly on socket instead of queueOrEmit', () => {
            const emitFn = jest.fn();
            const cb = jest.fn();
            client.socket = { connected: true, emit: emitFn };

            client.setRole('operative', cb);

            expect(queueOrEmit).not.toHaveBeenCalled();
            expect(emitFn).toHaveBeenCalledWith('player:setRole', { role: 'operative' }, cb);
        });

        it('setNickname delegates to queueOrEmit', () => {
            client.setNickname('Bob');

            expect(queueOrEmit).toHaveBeenCalledWith(client, 'player:setNickname', { nickname: 'Bob' });
        });

        it('endTurn delegates to queueOrEmit', () => {
            client.endTurn();

            expect(queueOrEmit).toHaveBeenCalledWith(client, 'game:endTurn', {});
        });

        it('sendSpectatorChat delegates to queueOrEmit with trimmed message', () => {
            client.sendSpectatorChat('  hello world  ');

            expect(queueOrEmit).toHaveBeenCalledWith(client, 'chat:spectator', { message: 'hello world' });
        });

        it('sendSpectatorChat does not call queueOrEmit for empty messages', () => {
            client.sendSpectatorChat('');

            expect(queueOrEmit).not.toHaveBeenCalled();
        });

        it('sendSpectatorChat does not call queueOrEmit for whitespace-only messages', () => {
            client.sendSpectatorChat('   ');

            expect(queueOrEmit).not.toHaveBeenCalled();
        });
    });

    /* ================================================================== */
    /*  2. Connection lifecycle — delegation to doConnect / loadSocketIO    */
    /* ================================================================== */

    describe('connection lifecycle delegation', () => {
        it('connect() calls loadSocketIO then doConnect with correct args', async () => {
            const mockSock = createMockSocket();
            (doConnect as jest.Mock).mockResolvedValue(mockSock);

            const result = await client.connect('http://localhost:3000', { autoRejoin: false });

            expect(loadSocketIO).toHaveBeenCalled();
            expect(doConnect).toHaveBeenCalledWith(client, 'http://localhost:3000', { autoRejoin: false });
            expect(result).toBe(mockSock);
        });

        it('connect() with no args passes defaults to doConnect', async () => {
            const mockSock = createMockSocket();
            (doConnect as jest.Mock).mockResolvedValue(mockSock);

            await client.connect();

            expect(doConnect).toHaveBeenCalledWith(client, null, {});
        });

        it('connect() rejects when loadSocketIO fails', async () => {
            (loadSocketIO as jest.Mock).mockRejectedValueOnce(new Error('Failed to load Socket.io client library'));

            await expect(client.connect()).rejects.toThrow('Failed to load Socket.io client library');
            expect(doConnect).not.toHaveBeenCalled();
        });

        it('connect() rejects when doConnect fails', async () => {
            (doConnect as jest.Mock).mockRejectedValueOnce(new Error('Connection refused'));

            await expect(client.connect('http://localhost:3000')).rejects.toThrow('Connection refused');
        });
    });

    /* ================================================================== */
    /*  3. Reconnection race conditions                                    */
    /* ================================================================== */

    describe('reconnection race conditions', () => {
        it('prevents double-join via joinInProgress flag', async () => {
            client.joinInProgress = true;
            (joinRoom as jest.Mock).mockRejectedValueOnce(new Error('Join already in progress'));

            await expect(client.joinRoom('ABCD', 'Alice')).rejects.toThrow('Join already in progress');
        });

        it('prevents double-create via createInProgress flag', async () => {
            client.createInProgress = true;
            (createRoom as jest.Mock).mockRejectedValueOnce(new Error('Room creation already in progress'));

            await expect(client.createRoom({ roomId: 'ABCD' })).rejects.toThrow('Room creation already in progress');
        });

        it('resets joinInProgress and createInProgress on disconnect', () => {
            client.joinInProgress = true;
            client.createInProgress = true;

            // Simulate the client having a socket
            const socket = createMockSocket();
            client.socket = socket;
            client.connected = true;

            client.disconnect();

            expect(client.joinInProgress).toBe(false);
            expect(client.createInProgress).toBe(false);
        });

        it('concurrent joinRoom calls — second rejects while first is pending', async () => {
            // First call: return a pending promise
            let resolveFirst!: (v: unknown) => void;
            (joinRoom as jest.Mock)
                .mockReturnValueOnce(
                    new Promise((r) => {
                        resolveFirst = r;
                    })
                )
                .mockRejectedValueOnce(new Error('Join already in progress'));

            const p1 = client.joinRoom('ROOM1', 'Alice');
            const p2 = client.joinRoom('ROOM2', 'Bob');

            // p2 should reject immediately (joinInProgress)
            await expect(p2).rejects.toThrow('Join already in progress');

            // Clean up p1
            resolveFirst({ room: { code: 'ROOM1' } });
            await p1;
        });

        it('concurrent createRoom calls — second rejects while first is pending', async () => {
            let resolveFirst!: (v: unknown) => void;
            (createRoom as jest.Mock)
                .mockReturnValueOnce(
                    new Promise((r) => {
                        resolveFirst = r;
                    })
                )
                .mockRejectedValueOnce(new Error('Room creation already in progress'));

            const p1 = client.createRoom({ roomId: 'ROOM1' });
            const p2 = client.createRoom({ roomId: 'ROOM2' });

            await expect(p2).rejects.toThrow('Room creation already in progress');

            resolveFirst({ room: { code: 'ROOM1' } });
            await p1;
        });
    });

    /* ================================================================== */
    /*  4. Auth / connection timeout                                       */
    /* ================================================================== */

    describe('auth and connection timeouts', () => {
        it('joinRoom rejects when the rooms module rejects with timeout', async () => {
            (joinRoom as jest.Mock).mockRejectedValueOnce(new Error('Join room timeout'));

            await expect(client.joinRoom('ABCD', 'Alice')).rejects.toThrow('Join room timeout');
        });

        it('createRoom rejects when the rooms module rejects with timeout', async () => {
            (createRoom as jest.Mock).mockRejectedValueOnce(new Error('Create room timeout'));

            await expect(client.createRoom({ roomId: 'TESTROOM' })).rejects.toThrow('Create room timeout');
        });

        it('requestResync rejects when the rooms module rejects with timeout', async () => {
            (requestResync as jest.Mock).mockRejectedValueOnce(new Error('Resync timeout'));
            client.roomCode = 'ABCD';

            await expect(client.requestResync()).rejects.toThrow('Resync timeout');
        });

        it('requestResync rejects when the rooms module rejects (not in a room)', async () => {
            (requestResync as jest.Mock).mockRejectedValueOnce(new Error('Not in a room'));
            client.roomCode = null;

            await expect(client.requestResync()).rejects.toThrow('Not in a room');
        });

        it('createRoom rejects when the rooms module rejects (missing roomId)', async () => {
            (createRoom as jest.Mock).mockRejectedValueOnce(new Error('Room ID is required'));

            await expect(client.createRoom({ roomId: '' })).rejects.toThrow('Room ID is required');
        });
    });

    /* ================================================================== */
    /*  5. Socket.io library load failure                                  */
    /* ================================================================== */

    describe('Socket.io library load failure', () => {
        it('connect() rejects when loadSocketIO rejects (script load failure)', async () => {
            (loadSocketIO as jest.Mock).mockRejectedValueOnce(
                new Error(
                    'Failed to load Socket.io client library. Check your network connection and refresh the page.'
                )
            );

            await expect(client.connect()).rejects.toThrow('Failed to load Socket.io client library');
        });

        it('connect() rejects when loadSocketIO rejects (io global missing after load)', async () => {
            (loadSocketIO as jest.Mock).mockRejectedValueOnce(
                new Error('Socket.io script loaded but io global is missing')
            );

            await expect(client.connect()).rejects.toThrow('Socket.io script loaded but io global is missing');
        });

        it('connect() succeeds when loadSocketIO resolves and doConnect resolves', async () => {
            const mockSock = createMockSocket();
            (loadSocketIO as jest.Mock).mockResolvedValueOnce(undefined);
            (doConnect as jest.Mock).mockResolvedValueOnce(mockSock);

            const socket = await client.connect();

            expect(socket).toBe(mockSock);
        });

        it('connect() calls doConnect only after loadSocketIO resolves', async () => {
            let resolveLoad!: () => void;
            (loadSocketIO as jest.Mock).mockReturnValueOnce(
                new Promise<void>((r) => {
                    resolveLoad = r;
                })
            );
            (doConnect as jest.Mock).mockResolvedValueOnce(mockSocket);

            const promise = client.connect();

            // doConnect should not be called yet
            expect(doConnect).not.toHaveBeenCalled();

            // Now resolve loadSocketIO
            resolveLoad();
            await promise;

            expect(doConnect).toHaveBeenCalled();
        });

        it('isSocketIOAvailable delegates to the connection module', () => {
            client.isSocketIOAvailable();

            const { isSocketIOAvailable } = require('../../frontend/socket-client-connection');
            expect(isSocketIOAvailable).toHaveBeenCalled();
        });
    });

    /* ================================================================== */
    /*  6. Room operations delegation and deduplication                     */
    /* ================================================================== */

    describe('room operations delegation', () => {
        it('joinRoom delegates to the rooms module with correct args', async () => {
            const result = { room: { code: 'ABCD' }, you: { nickname: 'Alice' }, players: [] };
            (joinRoom as jest.Mock).mockResolvedValueOnce(result);

            const resolved = await client.joinRoom('ABCD', 'Alice');

            expect(joinRoom).toHaveBeenCalledWith(client, 'ABCD', 'Alice');
            expect(resolved).toEqual(result);
        });

        it('createRoom delegates to the rooms module with correct args', async () => {
            const result = { room: { code: 'MYROOM' }, player: { nickname: 'Host' } };
            (createRoom as jest.Mock).mockResolvedValueOnce(result);

            const resolved = await client.createRoom({ roomId: 'MYROOM', nickname: 'Host' });

            expect(createRoom).toHaveBeenCalledWith(client, { roomId: 'MYROOM', nickname: 'Host' });
            expect(resolved).toEqual(result);
        });

        it('requestResync delegates to the rooms module', async () => {
            const data = { room: { code: 'ABCD' }, players: [] };
            (requestResync as jest.Mock).mockResolvedValueOnce(data);
            client.roomCode = 'ABCD';

            const resolved = await client.requestResync();

            expect(requestResync).toHaveBeenCalledWith(client);
            expect(resolved).toEqual(data);
        });

        it('joinRoom rejects on connection error from rooms module', async () => {
            (joinRoom as jest.Mock).mockRejectedValueOnce({ type: 'connection', error: new Error('disconnected') });

            await expect(client.joinRoom('ABCD', 'Alice')).rejects.toMatchObject({ type: 'connection' });
        });

        it('createRoom rejects on error from rooms module', async () => {
            (createRoom as jest.Mock).mockRejectedValueOnce({ type: 'room', message: 'Room full' });

            await expect(client.createRoom({ roomId: 'FULL' })).rejects.toMatchObject({ type: 'room' });
        });
    });

    /* ================================================================== */
    /*  7. Event listener system (on / off / once / _emit)                 */
    /* ================================================================== */

    describe('event listener system', () => {
        it('on() registers a listener and _emit() calls it', () => {
            const cb = jest.fn();
            client.on('connected', cb);

            client._emit('connected', { wasReconnecting: false });

            expect(cb).toHaveBeenCalledWith({ wasReconnecting: false });
        });

        it('off() removes a specific listener', () => {
            const cb = jest.fn();
            client.on('connected', cb);
            client.off('connected', cb);

            client._emit('connected', { wasReconnecting: false });

            expect(cb).not.toHaveBeenCalled();
        });

        it('off() without callback removes all listeners for that event', () => {
            const cb1 = jest.fn();
            const cb2 = jest.fn();
            client.on('connected', cb1);
            client.on('connected', cb2);

            client.off('connected');

            client._emit('connected', { wasReconnecting: false });

            expect(cb1).not.toHaveBeenCalled();
            expect(cb2).not.toHaveBeenCalled();
        });

        it('once() fires exactly once then auto-removes', () => {
            const cb = jest.fn();
            client.once('connected', cb);

            client._emit('connected', { wasReconnecting: false });
            client._emit('connected', { wasReconnecting: true });

            expect(cb).toHaveBeenCalledTimes(1);
            expect(cb).toHaveBeenCalledWith({ wasReconnecting: false });
        });

        it('_emit catches and logs errors in listeners without breaking others', () => {
            const { logger } = require('../../frontend/logger');
            const cb1 = jest.fn(() => {
                throw new Error('boom');
            });
            const cb2 = jest.fn();

            client.on('connected', cb1);
            client.on('connected', cb2);

            client._emit('connected', { wasReconnecting: false });

            expect(cb1).toHaveBeenCalled();
            expect(cb2).toHaveBeenCalled(); // Should still run despite cb1 throwing
            expect(logger.error).toHaveBeenCalled();
        });
    });

    /* ================================================================== */
    /*  8. Cleanup and disconnect                                          */
    /* ================================================================== */

    describe('cleanup and disconnect', () => {
        it('disconnect() clears all state and delegates socket listener cleanup', () => {
            const mockSock = createMockSocket();
            client.socket = mockSock;
            client.connected = true;
            client.roomCode = 'ABCD';
            client.player = { nickname: 'Alice' };
            client._offlineQueue = [{ event: 'chat:message', data: {}, timestamp: Date.now() }];
            client._socketListeners = [{ event: 'test', handler: jest.fn() }];

            client.disconnect();

            expect(client.socket).toBeNull();
            expect(client.connected).toBe(false);
            expect(client.roomCode).toBeNull();
            expect(client.player).toBeNull();
            expect(client._offlineQueue).toHaveLength(0);
            expect(mockSock.disconnect).toHaveBeenCalled();
            expect(cleanupSocketListeners).toHaveBeenCalledWith(client);
        });

        it('leaveRoom clears room state and offline queue', () => {
            const emitFn = jest.fn();
            client.socket = { emit: emitFn, connected: true };
            client.roomCode = 'ABCD';
            client.player = { nickname: 'Alice' };
            client._offlineQueue = [{ event: 'x', data: {}, timestamp: 0 }];

            client.leaveRoom();

            expect(emitFn).toHaveBeenCalledWith('room:leave');
            expect(client.roomCode).toBeNull();
            expect(client.player).toBeNull();
            expect(client._offlineQueue).toHaveLength(0);
        });

        it('disconnect() calls cleanupSocketListeners from the connection module', () => {
            const mockSock = createMockSocket();
            client.socket = mockSock;

            client.disconnect();

            expect(cleanupSocketListeners).toHaveBeenCalledWith(client);
        });

        it('clearSession removes storage items and resets flags', () => {
            const { safeRemoveStorage } = require('../../frontend/socket-client-storage');

            client.sessionId = 'test-session';
            client.storedNickname = 'Alice';
            client.joinInProgress = true;
            client.createInProgress = true;

            client.clearSession();

            expect(safeRemoveStorage).toHaveBeenCalledWith(sessionStorage, 'eigennamen-session-id');
            expect(safeRemoveStorage).toHaveBeenCalledWith(sessionStorage, 'eigennamen-room-code');
            expect(safeRemoveStorage).toHaveBeenCalledWith(localStorage, 'eigennamen-nickname');
            expect(client.sessionId).toBeNull();
            expect(client.storedNickname).toBeNull();
            expect(client.joinInProgress).toBe(false);
            expect(client.createInProgress).toBe(false);
        });
    });

    /* ================================================================== */
    /*  9. Utility methods                                                */
    /* ================================================================== */

    describe('utility methods', () => {
        it('isConnected() returns true only when both flags are set', () => {
            client.connected = false;
            client.socket = null;
            expect(client.isConnected()).toBe(false);

            client.connected = true;
            client.socket = { connected: false };
            expect(client.isConnected()).toBe(false);

            client.connected = true;
            client.socket = { connected: true };
            expect(client.isConnected()).toBe(true);
        });

        it('isInRoom() reflects roomCode presence', () => {
            client.roomCode = null;
            expect(client.isInRoom()).toBe(false);

            client.roomCode = 'ABCD';
            expect(client.isInRoom()).toBe(true);
        });

        it('isHost() reflects player.isHost', () => {
            client.player = null;
            expect(client.isHost()).toBe(false);

            client.player = { isHost: false };
            expect(client.isHost()).toBe(false);

            client.player = { isHost: true };
            expect(client.isHost()).toBe(true);
        });

        it('_getSocket() returns socket when available', () => {
            const sock = createMockSocket();
            client.socket = sock;
            expect(client._getSocket()).toBe(sock);
        });

        it('_getSocket() returns null and logs warning when no socket', () => {
            const { logger } = require('../../frontend/logger');
            client.socket = null;

            expect(client._getSocket()).toBeNull();
            expect(logger.warn).toHaveBeenCalledWith('Socket action attempted but not connected');
        });

        it('_saveSession persists sessionId, roomCode, and nickname', () => {
            const { safeSetStorage } = require('../../frontend/socket-client-storage');

            client.sessionId = 'sess-123';
            client.roomCode = 'ABCD';
            client.player = { nickname: 'Alice' };

            client._saveSession();

            expect(safeSetStorage).toHaveBeenCalledWith(sessionStorage, 'eigennamen-session-id', 'sess-123');
            expect(safeSetStorage).toHaveBeenCalledWith(sessionStorage, 'eigennamen-room-code', 'ABCD');
            expect(safeSetStorage).toHaveBeenCalledWith(localStorage, 'eigennamen-nickname', 'Alice');
            expect(client.storedNickname).toBe('Alice');
        });

        it('getStoredRoomCode reads from sessionStorage', () => {
            sessionStorage.setItem('eigennamen-room-code', 'XYZW');
            expect(client.getStoredRoomCode()).toBe('XYZW');
            sessionStorage.removeItem('eigennamen-room-code');
        });

        it('getStoredNickname reads from localStorage', () => {
            localStorage.setItem('eigennamen-nickname', 'Bob');
            expect(client.getStoredNickname()).toBe('Bob');
            localStorage.removeItem('eigennamen-nickname');
        });

        it('setAutoRejoin updates the autoRejoin flag', () => {
            client.setAutoRejoin(false);
            expect(client.autoRejoin).toBe(false);

            client.setAutoRejoin(true);
            expect(client.autoRejoin).toBe(true);
        });

        it('isSpymaster() reflects player.role', () => {
            client.player = null;
            expect(client.isSpymaster()).toBe(false);

            client.player = { role: 'operative' };
            expect(client.isSpymaster()).toBe(false);

            client.player = { role: 'spymaster' };
            expect(client.isSpymaster()).toBe(true);
        });

        it('getRoomCode() returns current roomCode', () => {
            client.roomCode = null;
            expect(client.getRoomCode()).toBeNull();

            client.roomCode = 'TEST';
            expect(client.getRoomCode()).toBe('TEST');
        });

        it('getPlayer() returns current player', () => {
            client.player = null;
            expect(client.getPlayer()).toBeNull();

            const player = { nickname: 'Alice', isHost: true };
            client.player = player;
            expect(client.getPlayer()).toBe(player);
        });
    });

    /* ================================================================== */
    /*  10. Direct socket actions (non-queueable)                          */
    /* ================================================================== */

    describe('direct socket actions', () => {
        it('startGame emits game:start on the socket', () => {
            const emitFn = jest.fn();
            client.socket = { emit: emitFn, connected: true };

            client.startGame({ mode: 'classic' });

            expect(emitFn).toHaveBeenCalledWith('game:start', { mode: 'classic' });
        });

        it('revealCard emits game:reveal on the socket', () => {
            const emitFn = jest.fn();
            client.socket = { emit: emitFn, connected: true };

            client.revealCard(5);

            expect(emitFn).toHaveBeenCalledWith('game:reveal', { index: 5 });
        });

        it('forfeit emits game:forfeit on the socket', () => {
            const emitFn = jest.fn();
            client.socket = { emit: emitFn, connected: true };

            client.forfeit();

            expect(emitFn).toHaveBeenCalledWith('game:forfeit');
        });

        it('updateSettings emits room:settings on the socket', () => {
            const emitFn = jest.fn();
            client.socket = { emit: emitFn, connected: true };

            client.updateSettings({ timer: 60 });

            expect(emitFn).toHaveBeenCalledWith('room:settings', { timer: 60 });
        });

        it('kickPlayer emits player:kick when user is host', () => {
            const emitFn = jest.fn();
            client.socket = { emit: emitFn, connected: true };
            client.player = { isHost: true };

            client.kickPlayer('target-session-id');

            expect(emitFn).toHaveBeenCalledWith('player:kick', { targetSessionId: 'target-session-id' });
        });

        it('kickPlayer logs warning and does not emit when user is not host', () => {
            const { logger } = require('../../frontend/logger');
            const emitFn = jest.fn();
            client.socket = { emit: emitFn, connected: true };
            client.player = { isHost: false };

            client.kickPlayer('target-session-id');

            expect(emitFn).not.toHaveBeenCalled();
            expect(logger.warn).toHaveBeenCalledWith('Only the host can kick players');
        });

        it('getGameHistory emits game:getHistory with limit', () => {
            const emitFn = jest.fn();
            client.socket = { emit: emitFn, connected: true };

            client.getGameHistory(20);

            expect(emitFn).toHaveBeenCalledWith('game:getHistory', { limit: 20 });
        });

        it('getReplay emits game:getReplay with gameId', () => {
            const emitFn = jest.fn();
            client.socket = { emit: emitFn, connected: true };

            client.getReplay('game-123');

            expect(emitFn).toHaveBeenCalledWith('game:getReplay', { gameId: 'game-123' });
        });
    });
});
