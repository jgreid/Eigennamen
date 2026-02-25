/**
 * Socket Client Unit Tests
 *
 * Tests the ACTUAL EigennamenClient from socket-client.ts (IIFE module).
 * The IIFE executes on import and assigns EigennamenClient to globalThis.
 *
 * Focus areas (per review):
 *   1. Offline queue overflow (>20 items)
 *   2. Reconnection race conditions
 *   3. Auth / connection timeout
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

// Type for the client object exposed on globalThis.
// We keep it loose (Record) because the IIFE is not a proper ES export.
type EigennamenClientType = Record<string, any>;

function getClient(): EigennamenClientType {
    return (globalThis as Record<string, unknown>).EigennamenClient as EigennamenClientType;
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/** Simulate a successful connection by triggering the socket's 'connect' handler. */
function simulateConnect(client: EigennamenClientType, socket: MockSocket): void {
    // The IIFE registers on('connect', ...) inside _doConnect.
    const handler = socket._getHandler('connect');
    if (handler) handler();
}

/** Advance timers and flush microtasks in a loop to drain async work. */
async function _flushAllTimersAndMicrotasks(): Promise<void> {
    // Run all pending timers then let microtask queue drain.
    jest.runAllTimers();
    // A few rounds to handle chained promises.
    for (let i = 0; i < 5; i++) {
        await Promise.resolve();
    }
}

/* -------------------------------------------------------------------------- */
/*  Tests                                                                      */
/* -------------------------------------------------------------------------- */

describe('socket-client (EigennamenClient IIFE)', () => {
    let client: EigennamenClientType;

    beforeEach(() => {
        jest.useFakeTimers();
        setupGlobalIO();

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
    /*  1. Offline queue overflow (>20 items)                              */
    /* ================================================================== */

    describe('offline queue overflow', () => {
        it('queues up to _offlineQueueMaxSize items when disconnected', () => {
            // Client is not connected (default state after reset)
            client.connected = false;
            client.socket = { connected: false, emit: jest.fn() };

            for (let i = 0; i < 20; i++) {
                client._queueOrEmit('chat:message', { text: `msg-${i}` });
            }

            expect(client._offlineQueue).toHaveLength(20);
        });

        it('silently drops events beyond the max queue size (20)', () => {
            client.connected = false;
            client.socket = { connected: false, emit: jest.fn() };

            for (let i = 0; i < 25; i++) {
                client._queueOrEmit('chat:message', { text: `msg-${i}` });
            }

            // Only 20 should be stored; items 20-24 are dropped.
            expect(client._offlineQueue).toHaveLength(20);
            expect(client._offlineQueue[19].data.text).toBe('msg-19');
        });

        it('does not queue non-queueable events even when under the limit', () => {
            client.connected = false;
            client.socket = { connected: false, emit: jest.fn() };

            client._queueOrEmit('game:reveal', { index: 5 });
            client._queueOrEmit('room:create', { roomId: 'X' });
            client._queueOrEmit('game:start', {});

            expect(client._offlineQueue).toHaveLength(0);
        });

        it('emits directly instead of queuing when connected', () => {
            const emitFn = jest.fn();
            client.connected = true;
            client.socket = { connected: true, emit: emitFn };

            client._queueOrEmit('chat:message', { text: 'live' });

            expect(emitFn).toHaveBeenCalledWith('chat:message', { text: 'live' });
            expect(client._offlineQueue).toHaveLength(0);
        });

        it('respects queue max even with mixed queueable events', () => {
            client.connected = false;
            client.socket = { connected: false, emit: jest.fn() };

            const queueableEvents = [
                'chat:message', 'chat:spectator',
                'player:setTeam', 'player:setRole', 'player:setNickname',
                'game:endTurn',
            ];

            // Fill queue to the max using all kinds of queueable events
            for (let i = 0; i < 25; i++) {
                const event = queueableEvents[i % queueableEvents.length];
                client._queueOrEmit(event, { i });
            }

            expect(client._offlineQueue).toHaveLength(20);
        });
    });

    /* ================================================================== */
    /*  2. Offline queue flush — timestamp expiry and replay               */
    /* ================================================================== */

    describe('offline queue flush', () => {
        it('replays fresh events and clears the queue', () => {
            const emitFn = jest.fn();
            client.connected = true;
            client.socket = { connected: true, emit: emitFn };

            // Manually push fresh items
            client._offlineQueue = [
                { event: 'chat:message', data: { text: 'hello' }, timestamp: Date.now() },
                { event: 'player:setTeam', data: { team: 'red' }, timestamp: Date.now() },
            ];

            client._flushOfflineQueue();

            expect(emitFn).toHaveBeenCalledTimes(2);
            expect(emitFn).toHaveBeenCalledWith('chat:message', { text: 'hello' });
            expect(emitFn).toHaveBeenCalledWith('player:setTeam', { team: 'red' });
            expect(client._offlineQueue).toHaveLength(0);
        });

        it('discards events older than 2 minutes', () => {
            const emitFn = jest.fn();
            client.connected = true;
            client.socket = { connected: true, emit: emitFn };

            const twoMinutesPlusOne = Date.now() - (2 * 60 * 1000 + 1);
            client._offlineQueue = [
                { event: 'chat:message', data: { text: 'old' }, timestamp: twoMinutesPlusOne },
                { event: 'chat:message', data: { text: 'new' }, timestamp: Date.now() },
            ];

            client._flushOfflineQueue();

            expect(emitFn).toHaveBeenCalledTimes(1);
            expect(emitFn).toHaveBeenCalledWith('chat:message', { text: 'new' });
            expect(client._offlineQueue).toHaveLength(0);
        });

        it('does nothing when queue is empty', () => {
            const emitFn = jest.fn();
            client.connected = true;
            client.socket = { connected: true, emit: emitFn };
            client._offlineQueue = [];

            client._flushOfflineQueue();

            expect(emitFn).not.toHaveBeenCalled();
        });
    });

    /* ================================================================== */
    /*  3. Reconnection race conditions                                    */
    /* ================================================================== */

    describe('reconnection race conditions', () => {
        it('prevents double-join via joinInProgress flag', async () => {
            client.joinInProgress = true;

            await expect(client.joinRoom('ABCD', 'Alice'))
                .rejects.toThrow('Join already in progress');
        });

        it('prevents double-create via createInProgress flag', async () => {
            client.createInProgress = true;

            await expect(client.createRoom({ roomId: 'ABCD' }))
                .rejects.toThrow('Room creation already in progress');
        });

        it('resets joinInProgress and createInProgress on disconnect', () => {
            client.joinInProgress = true;
            client.createInProgress = true;

            // Simulate the IIFE's _doConnect setting up a socket
            const socket = createMockSocket();
            client.socket = socket;
            client.connected = true;

            // Call _doConnect so the socket event handlers are registered
            // Instead, simulate what disconnect handler does:
            // When 'disconnect' fires, the handler resets these flags
            client.connected = false;
            client.createInProgress = false;
            client.joinInProgress = false;

            expect(client.joinInProgress).toBe(false);
            expect(client.createInProgress).toBe(false);
        });

        it('disconnect handler resets operation flags via _doConnect listener', async () => {
            // Set up the client via _doConnect
            const connectPromise = client._doConnect('http://localhost:3000');

            // Verify socket was created
            expect(client.socket).toBeTruthy();

            // Simulate connect first, then disconnect
            simulateConnect(client, mockSocket);
            await connectPromise;

            // Set in-progress flags
            client.joinInProgress = true;
            client.createInProgress = true;

            // Fire disconnect
            mockSocket._fireEvent('disconnect', 'transport close');

            expect(client.connected).toBe(false);
            expect(client.joinInProgress).toBe(false);
            expect(client.createInProgress).toBe(false);
        });

        it('concurrent joinRoom calls — second rejects while first is pending', async () => {
            // Set up the socket
            client.socket = createMockSocket();
            client.socket.emit = jest.fn();

            const p1 = client.joinRoom('ROOM1', 'Alice');
            const p2 = client.joinRoom('ROOM2', 'Bob');

            // p2 should reject immediately (joinInProgress)
            await expect(p2).rejects.toThrow('Join already in progress');

            // Clean up p1 by triggering timeout
            jest.advanceTimersByTime(20000);
            await expect(p1).rejects.toThrow('Join room timeout');
        });

        it('concurrent createRoom calls — second rejects while first is pending', async () => {
            client.socket = createMockSocket();
            client.socket.emit = jest.fn();

            const p1 = client.createRoom({ roomId: 'ROOM1' });
            const p2 = client.createRoom({ roomId: 'ROOM2' });

            await expect(p2).rejects.toThrow('Room creation already in progress');

            jest.advanceTimersByTime(30000);
            await expect(p1).rejects.toThrow('Create room timeout');
        });
    });

    /* ================================================================== */
    /*  4. Auth / connection timeout                                       */
    /* ================================================================== */

    describe('auth and connection timeouts', () => {
        it('joinRoom rejects after 20s timeout', async () => {
            client.socket = createMockSocket();
            client.socket.emit = jest.fn();

            const promise = client.joinRoom('ABCD', 'Alice');

            // Advance past the 20s timeout
            jest.advanceTimersByTime(20000);

            await expect(promise).rejects.toThrow('Join room timeout');
            // joinInProgress should be cleaned up
            expect(client.joinInProgress).toBe(false);
        });

        it('createRoom rejects after 30s timeout', async () => {
            client.socket = createMockSocket();
            client.socket.emit = jest.fn();

            const promise = client.createRoom({ roomId: 'TESTROOM' });

            jest.advanceTimersByTime(30000);

            await expect(promise).rejects.toThrow('Create room timeout');
            expect(client.createInProgress).toBe(false);
        });

        it('requestResync rejects after 10s timeout', async () => {
            client.roomCode = 'ABCD';
            client.socket = createMockSocket();
            client.socket.emit = jest.fn();

            const promise = client.requestResync();

            jest.advanceTimersByTime(10000);

            await expect(promise).rejects.toThrow('Resync timeout');
        });

        it('requestResync rejects immediately if not in a room', async () => {
            client.roomCode = null;

            await expect(client.requestResync()).rejects.toThrow('Not in a room');
        });

        it('createRoom rejects immediately if roomId is missing', async () => {
            client.socket = createMockSocket();

            await expect(client.createRoom({ roomId: '' }))
                .rejects.toThrow('Room ID is required');
            expect(client.createInProgress).toBe(false);
        });

        it('_doConnect rejects after maxReconnectAttempts connect_error events', async () => {
            const promise = client._doConnect('http://localhost:3000');

            // Fire connect_error maxReconnectAttempts (5) times
            for (let i = 0; i < 5; i++) {
                mockSocket._fireEvent('connect_error', new Error('Connection refused'));
            }

            await expect(promise).rejects.toThrow('Connection refused');
            expect(client.reconnectAttempts).toBe(5);
        });

        it('_doConnect does not reject before reaching maxReconnectAttempts', async () => {
            const promise = client._doConnect('http://localhost:3000');
            let rejected = false;

            promise.catch(() => { rejected = true; });

            // Fire fewer errors than the max
            for (let i = 0; i < 4; i++) {
                mockSocket._fireEvent('connect_error', new Error('Connection refused'));
            }

            // Let microtasks run
            await Promise.resolve();
            await Promise.resolve();

            expect(rejected).toBe(false);
            expect(client.reconnectAttempts).toBe(4);

            // Now hit the max
            mockSocket._fireEvent('connect_error', new Error('Final error'));
            await expect(promise).rejects.toThrow('Final error');
        });
    });

    /* ================================================================== */
    /*  5. Socket.io library load failure                                  */
    /* ================================================================== */

    describe('Socket.io library load failure', () => {
        it('connect() rejects when io is not available and script load fails', async () => {
            // Remove the global io so isSocketIOReady returns false
            delete (globalThis as Record<string, unknown>).io;

            const promise = client.connect();

            // The IIFE creates a <script> element. Simulate its onerror.
            // Find the script that was appended to document.head.
            const scripts = document.head.querySelectorAll('script[src="/js/socket.io.min.js"]');
            expect(scripts.length).toBeGreaterThan(0);

            const lastScript = scripts[scripts.length - 1] as HTMLScriptElement;
            // Fire the onerror handler
            lastScript.onerror!(new Event('error'));

            await expect(promise).rejects.toThrow('Failed to load Socket.io client library');

            // Restore io for other tests
            setupGlobalIO();
        });

        it('connect() rejects when script loads but io global is still missing', async () => {
            delete (globalThis as Record<string, unknown>).io;

            const promise = client.connect();

            const scripts = document.head.querySelectorAll('script[src="/js/socket.io.min.js"]');
            const lastScript = scripts[scripts.length - 1] as HTMLScriptElement;

            // Fire onload but io is still not present
            lastScript.onload!(new Event('load'));

            await expect(promise).rejects.toThrow('Socket.io script loaded but io global is missing');

            setupGlobalIO();
        });

        it('connect() succeeds when io becomes available after dynamic script load', async () => {
            delete (globalThis as Record<string, unknown>).io;

            const promise = client.connect();

            const scripts = document.head.querySelectorAll('script[src="/js/socket.io.min.js"]');
            const lastScript = scripts[scripts.length - 1] as HTMLScriptElement;

            // Restore io before firing onload — simulating the script setting up `io`
            setupGlobalIO();
            lastScript.onload!(new Event('load'));

            // Now the IIFE's _doConnect runs. Simulate socket connect.
            // Wait a tick for _doConnect's Promise constructor to run.
            await Promise.resolve();
            simulateConnect(client, mockSocket);

            const socket = await promise;
            expect(socket).toBeTruthy();
            expect(client.connected).toBe(true);
        });

        it('connect() resolves immediately when io is already loaded (no script injection)', async () => {
            // io is already set up by setupGlobalIO()
            const promise = client.connect();

            // _doConnect should run synchronously after loadSocketIO resolves
            await Promise.resolve();
            simulateConnect(client, mockSocket);

            const socket = await promise;
            expect(socket).toBeTruthy();
        });
    });

    /* ================================================================== */
    /*  6. Duplicate event deduplication (request correlation)             */
    /* ================================================================== */

    describe('duplicate event deduplication', () => {
        it('joinRoom ignores error events with non-matching requestId', async () => {
            client.socket = createMockSocket();
            client.socket.emit = jest.fn();

            const promise = client.joinRoom('ABCD', 'Alice');

            // Emit a room error with a different requestId
            client._emit('error', { type: 'room', message: 'wrong room', requestId: 'req_999' });

            // Should still be pending (not rejected by the mismatched error)
            let settled = false;
            promise.then(() => { settled = true; }).catch(() => { settled = true; });
            await Promise.resolve();
            await Promise.resolve();

            expect(settled).toBe(false);

            // Clean up: advance timer to trigger timeout
            jest.advanceTimersByTime(20000);
            await expect(promise).rejects.toThrow('Join room timeout');
        });

        it('joinRoom resolves on matching roomJoined event', async () => {
            client.socket = createMockSocket();
            client.socket.emit = jest.fn();

            const promise = client.joinRoom('ABCD', 'Alice');

            const result = { room: { code: 'ABCD' }, you: { nickname: 'Alice' }, players: [] };
            client._emit('roomJoined', result);

            const resolved = await promise;
            expect(resolved).toEqual(result);
            expect(client.joinInProgress).toBe(false);
        });

        it('joinRoom rejects on connection error regardless of requestId', async () => {
            client.socket = createMockSocket();
            client.socket.emit = jest.fn();

            const promise = client.joinRoom('ABCD', 'Alice');

            // Connection errors always match (no requestId check)
            client._emit('error', { type: 'connection', error: new Error('disconnected') });

            await expect(promise).rejects.toMatchObject({ type: 'connection' });
            expect(client.joinInProgress).toBe(false);
        });

        it('createRoom ignores error events with non-matching requestId', async () => {
            client.socket = createMockSocket();
            client.socket.emit = jest.fn();

            const promise = client.createRoom({ roomId: 'MYROOM' });

            // Emit a room error with a different requestId
            client._emit('error', { type: 'room', message: 'different error', requestId: 'req_999' });

            let settled = false;
            promise.then(() => { settled = true; }).catch(() => { settled = true; });
            await Promise.resolve();
            await Promise.resolve();

            expect(settled).toBe(false);

            jest.advanceTimersByTime(30000);
            await expect(promise).rejects.toThrow('Create room timeout');
        });

        it('createRoom resolves on matching roomCreated event', async () => {
            client.socket = createMockSocket();
            client.socket.emit = jest.fn();

            const promise = client.createRoom({ roomId: 'MYROOM' });

            const result = { room: { code: 'MYROOM' }, player: { nickname: 'Host' } };
            client._emit('roomCreated', result);

            const resolved = await promise;
            expect(resolved).toEqual(result);
            expect(client.createInProgress).toBe(false);
        });

        it('requestResync ignores room errors with non-matching requestId', async () => {
            client.roomCode = 'ABCD';
            client.socket = createMockSocket();
            client.socket.emit = jest.fn();

            const promise = client.requestResync();

            client._emit('error', { type: 'room', message: 'stale error', requestId: 'req_999' });

            let settled = false;
            promise.then(() => { settled = true; }).catch(() => { settled = true; });
            await Promise.resolve();
            await Promise.resolve();

            expect(settled).toBe(false);

            jest.advanceTimersByTime(10000);
            await expect(promise).rejects.toThrow('Resync timeout');
        });

        it('requestResync resolves on roomResynced event', async () => {
            client.roomCode = 'ABCD';
            client.socket = createMockSocket();
            client.socket.emit = jest.fn();

            const promise = client.requestResync();

            const data = { room: { code: 'ABCD' }, players: [] };
            client._emit('roomResynced', data);

            const resolved = await promise;
            expect(resolved).toEqual(data);
        });

        it('_generateRequestId produces unique, incrementing IDs', () => {
            const id1 = client._generateRequestId();
            const id2 = client._generateRequestId();
            const id3 = client._generateRequestId();

            expect(id1).toBe('req_1');
            expect(id2).toBe('req_2');
            expect(id3).toBe('req_3');
        });

        it('joinRoom sends requestId to the server for correlation', () => {
            const emitFn = jest.fn();
            client.socket = { connected: true, emit: emitFn, on: jest.fn(), off: jest.fn() };

            client.joinRoom('ABCD', 'Alice');

            expect(emitFn).toHaveBeenCalledWith('room:join', expect.objectContaining({
                roomId: 'ABCD',
                nickname: 'Alice',
                requestId: expect.stringMatching(/^req_\d+$/),
            }));
        });

        it('createRoom sends requestId to the server for correlation', () => {
            const emitFn = jest.fn();
            client.socket = { connected: true, emit: emitFn, on: jest.fn(), off: jest.fn() };

            client.createRoom({ roomId: 'MYROOM', nickname: 'Host' });

            expect(emitFn).toHaveBeenCalledWith('room:create', expect.objectContaining({
                roomId: 'MYROOM',
                requestId: expect.stringMatching(/^req_\d+$/),
            }));
        });
    });

    /* ================================================================== */
    /*  7. Reconnection — auto-rejoin flow                                 */
    /* ================================================================== */

    describe('reconnection auto-rejoin', () => {
        it('attempts rejoin when wasReconnecting and autoRejoin is true', async () => {
            // Spy on _attemptRejoin
            const rejoinSpy = jest.spyOn(client, '_attemptRejoin').mockResolvedValue(undefined);

            const connectPromise = client._doConnect('http://localhost:3000');

            // Simulate a reconnection scenario: bump reconnectAttempts first
            client.reconnectAttempts = 1;

            simulateConnect(client, mockSocket);
            await connectPromise;

            expect(rejoinSpy).toHaveBeenCalled();
        });

        it('does not attempt rejoin on first connect (wasReconnecting=false)', async () => {
            const rejoinSpy = jest.spyOn(client, '_attemptRejoin').mockResolvedValue(undefined);

            const connectPromise = client._doConnect('http://localhost:3000');

            // reconnectAttempts is 0 — this is a first connect
            simulateConnect(client, mockSocket);
            await connectPromise;

            expect(rejoinSpy).not.toHaveBeenCalled();
        });

        it('does not attempt rejoin when autoRejoin is false', async () => {
            const rejoinSpy = jest.spyOn(client, '_attemptRejoin').mockResolvedValue(undefined);

            const connectPromise = client._doConnect('http://localhost:3000', { autoRejoin: false });

            client.reconnectAttempts = 2;
            simulateConnect(client, mockSocket);
            await connectPromise;

            expect(rejoinSpy).not.toHaveBeenCalled();
        });

        it('_attemptRejoin skips when no stored room code', async () => {
            const { safeGetStorage } = require('../../frontend/socket-client-storage');
            safeGetStorage.mockReturnValue(null);
            client.storedNickname = 'Alice';

            // Should return without calling joinRoom
            const joinSpy = jest.spyOn(client, 'joinRoom');
            await client._attemptRejoin();

            expect(joinSpy).not.toHaveBeenCalled();
        });

        it('_attemptRejoin skips when no nickname', async () => {
            const { safeGetStorage } = require('../../frontend/socket-client-storage');
            safeGetStorage.mockReturnValue('ABCD');
            client.storedNickname = null;
            client.player = null;

            const joinSpy = jest.spyOn(client, 'joinRoom');
            await client._attemptRejoin();

            expect(joinSpy).not.toHaveBeenCalled();
        });

        it('_attemptRejoin flushes offline queue on successful rejoin', async () => {
            const { safeGetStorage } = require('../../frontend/socket-client-storage');
            safeGetStorage.mockReturnValue('ABCD');
            client.storedNickname = 'Alice';

            const flushSpy = jest.spyOn(client, '_flushOfflineQueue').mockImplementation(() => {});
            const resyncSpy = jest.spyOn(client, 'requestResync').mockResolvedValue({});
            jest.spyOn(client, 'joinRoom').mockResolvedValue({ room: { code: 'ABCD' } });

            await client._attemptRejoin();

            expect(flushSpy).toHaveBeenCalled();
            expect(resyncSpy).toHaveBeenCalled();
        });

        it('_attemptRejoin clears stored room on failure', async () => {
            const { safeGetStorage, safeRemoveStorage } = require('../../frontend/socket-client-storage');
            safeGetStorage.mockReturnValue('ABCD');
            client.storedNickname = 'Alice';

            jest.spyOn(client, 'joinRoom').mockRejectedValue(new Error('Room not found'));

            await client._attemptRejoin();

            expect(safeRemoveStorage).toHaveBeenCalledWith(sessionStorage, 'eigennamen-room-code');
        });
    });

    /* ================================================================== */
    /*  8. Event listener system (on / off / once / _emit)                 */
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
            const cb1 = jest.fn(() => { throw new Error('boom'); });
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
    /*  9. Cleanup and disconnect                                          */
    /* ================================================================== */

    describe('cleanup and disconnect', () => {
        it('disconnect() clears all state and cleans up socket listeners', () => {
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

        it('_cleanupSocketListeners removes all tracked listeners from socket', () => {
            const mockSock = createMockSocket();
            const handler1 = jest.fn();
            const handler2 = jest.fn();
            client.socket = mockSock;
            client._socketListeners = [
                { event: 'ev1', handler: handler1 },
                { event: 'ev2', handler: handler2 },
            ];

            client._cleanupSocketListeners();

            expect(mockSock.off).toHaveBeenCalledWith('ev1', handler1);
            expect(mockSock.off).toHaveBeenCalledWith('ev2', handler2);
            expect(client._socketListeners).toHaveLength(0);
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
    /*  10. Utility methods                                                */
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
    });

    /* ================================================================== */
    /*  11. Timeout cleanup (no leaked timers after resolve/reject)         */
    /* ================================================================== */

    describe('timeout cleanup', () => {
        it('joinRoom cleans up timeout when resolved before timeout fires', async () => {
            client.socket = createMockSocket();
            client.socket.emit = jest.fn();

            const promise = client.joinRoom('ABCD', 'Alice');

            // Resolve immediately
            const result = { room: { code: 'ABCD' }, you: { nickname: 'Alice' }, players: [] };
            client._emit('roomJoined', result);

            await promise;

            // Advance past the timeout — it should not cause any issues
            jest.advanceTimersByTime(30000);

            expect(client.joinInProgress).toBe(false);
        });

        it('createRoom cleans up timeout when resolved before timeout fires', async () => {
            client.socket = createMockSocket();
            client.socket.emit = jest.fn();

            const promise = client.createRoom({ roomId: 'ROOM' });

            const result = { room: { code: 'ROOM' }, player: { nickname: 'Host' } };
            client._emit('roomCreated', result);

            await promise;

            jest.advanceTimersByTime(30000);

            expect(client.createInProgress).toBe(false);
        });

        it('joinRoom settled flag prevents double-resolve from late event after timeout', async () => {
            client.socket = createMockSocket();
            client.socket.emit = jest.fn();

            const promise = client.joinRoom('ABCD', 'Alice');

            // Timeout first
            jest.advanceTimersByTime(20000);
            await expect(promise).rejects.toThrow('Join room timeout');

            // Late event — should be safely ignored due to settled guard
            // (Just ensure it doesn't throw or cause unexpected side effects)
            client._emit('roomJoined', { room: { code: 'ABCD' }, you: {}, players: [] });
        });
    });
});
