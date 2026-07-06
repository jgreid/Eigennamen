/**
 * Socket Client Connection Tests
 *
 * Tests the connection lifecycle module: queueOrEmit, cleanupSocketListeners,
 * loadSocketIO, and isSocketIOAvailable.
 */

jest.mock('../../frontend/logger', () => ({
    logger: { debug: jest.fn(), warn: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

jest.mock('../../frontend/socket-client-storage', () => ({
    safeGetStorage: jest.fn(() => null),
    safeRemoveStorage: jest.fn(),
}));

jest.mock('../../frontend/socket-client-events', () => ({
    registerAllEventListeners: jest.fn(),
}));

import {
    queueOrEmit,
    cleanupSocketListeners,
    loadSocketIO,
    isSocketIOAvailable,
    setupEventListeners,
    doConnect,
} from '../../frontend/socket-client-connection';
import type { ConnectionHost } from '../../frontend/socket-client-connection';
import { safeGetStorage } from '../../frontend/socket-client-storage';

function createMockHost(overrides: Partial<ConnectionHost> = {}): ConnectionHost {
    return {
        socket: null,
        sessionId: null,
        roomCode: 'TEST',
        player: null,
        connected: false,
        reconnectAttempts: 0,
        maxReconnectAttempts: 5,
        autoRejoin: true,
        storedNickname: null,
        joinInProgress: false,
        createInProgress: false,
        _socketListeners: [],
        _offlineQueue: [],
        _offlineQueueMaxSize: 50,
        _emit: jest.fn(),
        _saveSession: jest.fn(),
        joinRoom: jest.fn(),
        requestResync: jest.fn(),
        ...overrides,
    };
}

describe('queueOrEmit', () => {
    test('emits directly when connected', () => {
        const mockEmit = jest.fn();
        const host = createMockHost({
            connected: true,
            socket: { connected: true, emit: mockEmit, on: jest.fn(), off: jest.fn() } as never,
        });

        queueOrEmit(host, 'chat:message', { text: 'hello' });
        expect(mockEmit).toHaveBeenCalledWith('chat:message', { text: 'hello' });
        expect(host._offlineQueue).toHaveLength(0);
    });

    test('queues queueable events when disconnected', () => {
        const host = createMockHost({ connected: false });

        queueOrEmit(host, 'chat:message', { text: 'hello' });
        expect(host._offlineQueue).toHaveLength(1);
        expect(host._offlineQueue[0].event).toBe('chat:message');
        expect(host._offlineQueue[0].data).toEqual({ text: 'hello' });
        expect(host._offlineQueue[0].roomCode).toBe('TEST');
    });

    test('does not queue non-queueable events', () => {
        const host = createMockHost({ connected: false });

        queueOrEmit(host, 'game:reveal', { index: 5 });
        expect(host._offlineQueue).toHaveLength(0);
    });

    test('respects max queue size', () => {
        const host = createMockHost({
            connected: false,
            _offlineQueueMaxSize: 2,
            _offlineQueue: [
                { event: 'chat:message', data: { text: '1' }, timestamp: Date.now(), roomCode: 'TEST' },
                { event: 'chat:message', data: { text: '2' }, timestamp: Date.now(), roomCode: 'TEST' },
            ],
        });

        queueOrEmit(host, 'chat:message', { text: '3' });
        expect(host._offlineQueue).toHaveLength(2); // Not added
    });

    test('queues player:setTeam when disconnected', () => {
        const host = createMockHost({ connected: false });
        queueOrEmit(host, 'player:setTeam', { team: 'blue' });
        expect(host._offlineQueue).toHaveLength(1);
    });

    test('queues game:endTurn when disconnected', () => {
        const host = createMockHost({ connected: false });
        queueOrEmit(host, 'game:endTurn', {});
        expect(host._offlineQueue).toHaveLength(1);
    });
});

describe('cleanupSocketListeners', () => {
    test('removes all registered listeners from socket', () => {
        const mockOff = jest.fn();
        const handler1 = jest.fn();
        const handler2 = jest.fn();
        const host = createMockHost({
            socket: { off: mockOff, on: jest.fn(), emit: jest.fn(), connected: true } as never,
            _socketListeners: [
                { event: 'room:created', handler: handler1 },
                { event: 'game:started', handler: handler2 },
            ],
        });

        cleanupSocketListeners(host);
        expect(mockOff).toHaveBeenCalledWith('room:created', handler1);
        expect(mockOff).toHaveBeenCalledWith('game:started', handler2);
        expect(host._socketListeners).toHaveLength(0);
    });

    test('handles empty listener list', () => {
        const host = createMockHost({
            socket: { off: jest.fn(), on: jest.fn(), emit: jest.fn(), connected: true } as never,
            _socketListeners: [],
        });

        expect(() => cleanupSocketListeners(host)).not.toThrow();
        expect(host._socketListeners).toHaveLength(0);
    });

    test('handles null socket', () => {
        const host = createMockHost({
            socket: null,
            _socketListeners: [{ event: 'test', handler: jest.fn() }],
        });

        expect(() => cleanupSocketListeners(host)).not.toThrow();
        expect(host._socketListeners).toHaveLength(0);
    });
});

describe('isSocketIOAvailable', () => {
    const originalIo = (globalThis as Record<string, unknown>).io;

    afterEach(() => {
        if (originalIo !== undefined) {
            (globalThis as Record<string, unknown>).io = originalIo;
        } else {
            delete (globalThis as Record<string, unknown>).io;
        }
    });

    test('returns false when io is not defined', () => {
        delete (globalThis as Record<string, unknown>).io;
        expect(isSocketIOAvailable()).toBe(false);
    });

    test('returns false when io is not a function', () => {
        (globalThis as Record<string, unknown>).io = 'not a function';
        expect(isSocketIOAvailable()).toBe(false);
    });

    test('returns true when io is a function with Manager', () => {
        const mockIo = Object.assign(jest.fn(), { Manager: jest.fn() });
        (globalThis as Record<string, unknown>).io = mockIo;
        expect(isSocketIOAvailable()).toBe(true);
    });
});

describe('loadSocketIO', () => {
    const originalIo = (globalThis as Record<string, unknown>).io;

    afterEach(() => {
        if (originalIo !== undefined) {
            (globalThis as Record<string, unknown>).io = originalIo;
        } else {
            delete (globalThis as Record<string, unknown>).io;
        }
    });

    test('resolves immediately when io is already available', async () => {
        const mockIo = Object.assign(jest.fn(), { Manager: jest.fn() });
        (globalThis as Record<string, unknown>).io = mockIo;
        await expect(loadSocketIO()).resolves.toBeUndefined();
    });

    test('creates a script tag when io is not available', () => {
        delete (globalThis as Record<string, unknown>).io;
        // loadSocketIO creates a script element; we just verify it does not throw
        const promise = loadSocketIO();

        const scripts = document.querySelectorAll('script[src="/js/socket.io.min.js"]');
        expect(scripts.length).toBe(1);

        // Simulate error to settle the promise (cleanup)
        const script = scripts[0] as HTMLScriptElement;
        script.onerror?.(new Event('error'));

        return promise.catch(() => {
            // Expected rejection since script load fails in jsdom
        });
    });
});

describe('setupEventListeners', () => {
    test('calls registerAllEventListeners and cleans up old listeners first', () => {
        const { registerAllEventListeners } = require('../../frontend/socket-client-events');
        const mockOn = jest.fn();
        const host = createMockHost({
            socket: { on: mockOn, off: jest.fn(), emit: jest.fn(), connected: true } as never,
            _socketListeners: [],
        });

        setupEventListeners(host);
        expect(registerAllEventListeners).toHaveBeenCalled();
    });
});

describe('doConnect reconnection detection (A2)', () => {
    /** @type {Record<string, (...a: unknown[]) => void>} */
    let handlers: Record<string, (...a: unknown[]) => void>;
    let mockSocket: { on: jest.Mock; id: string };
    let originalIo: unknown;

    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

    beforeEach(() => {
        handlers = {};
        mockSocket = {
            on: jest.fn((event: string, handler: (...a: unknown[]) => void) => {
                handlers[event] = handler;
            }),
            id: 'socket-abc',
        };
        originalIo = (globalThis as unknown as { io?: unknown }).io;
        (globalThis as unknown as { io: unknown }).io = jest.fn(() => mockSocket);
        // Key-aware storage: a stored nickname + room code so attemptRejoin proceeds.
        (safeGetStorage as jest.Mock).mockImplementation((_store: unknown, key: string) => {
            if (key === 'eigennamen-nickname') return 'Alice';
            if (key === 'eigennamen-room-code') return 'ROOM123';
            return null;
        });
    });

    afterEach(() => {
        (globalThis as unknown as { io: unknown }).io = originalIo;
        (safeGetStorage as jest.Mock).mockReset();
        (safeGetStorage as jest.Mock).mockReturnValue(null);
    });

    test('rejoins after a transient disconnect whose first retry succeeds (no connect_error)', async () => {
        const host = createMockHost({
            joinRoom: jest.fn().mockResolvedValue({ room: { code: 'ROOM123' } }),
            requestResync: jest.fn().mockResolvedValue({}),
        });
        doConnect(host, 'http://localhost', {}).catch(() => {});

        // Initial connect — not a reconnect, so no rejoin.
        handlers['connect']();
        expect(host.joinRoom).not.toHaveBeenCalled();

        // Transient network drop; socket.io will auto-reconnect.
        handlers['disconnect']('transport close');
        expect(host.hadUnexpectedDisconnect).toBe(true);

        // First retry succeeds — connect fires with NO connect_error, so
        // reconnectAttempts is still 0. The rejoin must fire off hadUnexpectedDisconnect.
        handlers['connect']();
        await flush();

        expect(host.joinRoom).toHaveBeenCalledWith('ROOM123', 'Alice');
        expect(host.requestResync).toHaveBeenCalled();
        expect(host.hadUnexpectedDisconnect).toBe(false);
    });

    test('an intentional client disconnect does not arm a rejoin', async () => {
        const host = createMockHost({
            joinRoom: jest.fn().mockResolvedValue({}),
            requestResync: jest.fn().mockResolvedValue({}),
        });
        doConnect(host, 'http://localhost', {}).catch(() => {});

        handlers['connect']();
        handlers['disconnect']('io client disconnect');
        expect(host.hadUnexpectedDisconnect).toBeFalsy();

        handlers['connect']();
        await flush();
        expect(host.joinRoom).not.toHaveBeenCalled();
    });

    test('still rejoins the classic way when a connect_error preceded the reconnect', async () => {
        const host = createMockHost({
            joinRoom: jest.fn().mockResolvedValue({}),
            requestResync: jest.fn().mockResolvedValue({}),
        });
        doConnect(host, 'http://localhost', {}).catch(() => {});

        handlers['connect']();
        // A failed retry bumps reconnectAttempts (the pre-existing signal).
        host.reconnectAttempts = 1;
        handlers['connect']();
        await flush();
        expect(host.joinRoom).toHaveBeenCalledWith('ROOM123', 'Alice');
    });
});

describe('doConnect transport + reconnect configuration (I2 / I4)', () => {
    let handlers: Record<string, (...a: unknown[]) => void>;
    let mockSocket: { on: jest.Mock; id: string };
    let ioMock: jest.Mock;
    let originalIo: unknown;

    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

    beforeEach(() => {
        handlers = {};
        mockSocket = {
            on: jest.fn((event: string, handler: (...a: unknown[]) => void) => {
                handlers[event] = handler;
            }),
            id: 'socket-xyz',
        };
        originalIo = (globalThis as unknown as { io?: unknown }).io;
        ioMock = jest.fn(() => mockSocket);
        (globalThis as unknown as { io: unknown }).io = ioMock;
        (safeGetStorage as jest.Mock).mockReturnValue(null);
    });

    afterEach(() => {
        (globalThis as unknown as { io: unknown }).io = originalIo;
        (safeGetStorage as jest.Mock).mockReset();
        (safeGetStorage as jest.Mock).mockReturnValue(null);
    });

    test('connects websocket-first with a polling fallback regardless of scheme (I2)', () => {
        // An HTTP page must still reach the websocket-only production server.
        const host = createMockHost();
        doConnect(host, 'http://localhost', {}).catch(() => {});

        const opts = ioMock.mock.calls[0][1] as Record<string, unknown>;
        expect(opts.transports).toEqual(['websocket', 'polling']);
        expect(opts.tryAllTransports).toBe(true);
    });

    test('auto-reconnect budget is sized to outlast the server window (I4)', () => {
        const host = createMockHost();
        doConnect(host, 'https://localhost', {}).catch(() => {});

        const opts = ioMock.mock.calls[0][1] as Record<string, unknown>;
        // Manager retries effectively forever (capped backoff), not the old 5.
        expect(opts.reconnectionAttempts).toBe(Infinity);
        expect(opts.reconnectionDelayMax).toBe(5000);
    });

    test('the INITIAL connection still gives up after maxReconnectAttempts (I4)', async () => {
        const host = createMockHost({ maxReconnectAttempts: 3 });
        const outcome = doConnect(host, 'http://localhost', {}).then(
            () => 'resolved',
            () => 'rejected'
        );

        handlers['connect_error'](new Error('boom')); // 1
        handlers['connect_error'](new Error('boom')); // 2
        handlers['connect_error'](new Error('boom')); // 3 → reject

        expect(await outcome).toBe('rejected');
        // Each pre-connect failure is surfaced so Host/Join can show an error.
        expect(host._emit).toHaveBeenCalledWith('error', expect.objectContaining({ type: 'connection' }));
    });

    test('does not re-emit connection errors once connected — no reconnect toast spam (I4)', async () => {
        const host = createMockHost();
        doConnect(host, 'http://localhost', {}).catch(() => {});

        // Establish the session, then clear the 'connected' emit.
        handlers['connect']();
        (host._emit as jest.Mock).mockClear();

        // A prolonged outage: the Manager fires connect_error on every retry.
        handlers['connect_error'](new Error('flap'));
        handlers['connect_error'](new Error('flap'));
        handlers['connect_error'](new Error('flap'));
        await flush();

        // None of them should surface a toast-triggering 'error' event.
        expect(host._emit).not.toHaveBeenCalledWith('error', expect.anything());
    });
});
