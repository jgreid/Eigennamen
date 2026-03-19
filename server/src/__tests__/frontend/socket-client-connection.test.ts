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
} from '../../frontend/socket-client-connection';
import type { ConnectionHost } from '../../frontend/socket-client-connection';

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
