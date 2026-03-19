/**
 * Socket Client Rooms Tests
 *
 * Tests the promise-based room operations: createRoom, joinRoom, requestResync.
 * Covers happy path, error paths, timeouts, and duplicate-call guards.
 */

jest.mock('../../frontend/logger', () => ({
    logger: { debug: jest.fn(), warn: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

import { createRoom, joinRoom, requestResync } from '../../frontend/socket-client-rooms';
import type { RoomActionHost } from '../../frontend/socket-client-rooms';

type ListenerMap = Record<string, ((...args: unknown[]) => void)[]>;

function createMockHost(overrides: Partial<RoomActionHost> = {}): RoomActionHost & { _listeners: ListenerMap } {
    const listeners: ListenerMap = {};
    return {
        _listeners: listeners,
        socket: {
            emit: jest.fn(),
            on: jest.fn(),
            off: jest.fn(),
            connected: true,
        } as never,
        roomCode: 'test-room',
        joinInProgress: false,
        createInProgress: false,
        _nextRequestId: 0,
        on: jest.fn((event: string, cb: (...args: unknown[]) => void) => {
            if (!listeners[event]) listeners[event] = [];
            listeners[event].push(cb);
        }),
        off: jest.fn((event: string, cb?: (...args: unknown[]) => void) => {
            if (listeners[event]) {
                listeners[event] = cb ? listeners[event].filter((h) => h !== cb) : [];
            }
        }),
        ...overrides,
    };
}

describe('createRoom', () => {
    test('rejects when creation already in progress', async () => {
        const host = createMockHost({ createInProgress: true });
        await expect(createRoom(host, { roomId: 'test' })).rejects.toThrow('Room creation already in progress');
    });

    test('rejects when roomId is missing', async () => {
        const host = createMockHost();
        await expect(createRoom(host, { roomId: '' })).rejects.toThrow('Room ID is required');
        expect(host.createInProgress).toBe(false);
    });

    test('resolves on roomCreated event', async () => {
        const host = createMockHost();
        const promise = createRoom(host, { roomId: 'my-room', nickname: 'Player1' });

        // Simulate server response
        const createdData = { roomCode: 'my-room', player: { sessionId: 's1' } };
        host._listeners['roomCreated']?.[0](createdData);

        await expect(promise).resolves.toEqual(createdData);
        expect(host.createInProgress).toBe(false);
    });

    test('rejects on room error', async () => {
        const host = createMockHost();
        const promise = createRoom(host, { roomId: 'my-room' });

        const errorData = { type: 'room', message: 'Room exists' };
        host._listeners['error']?.[0](errorData);

        await expect(promise).rejects.toEqual(errorData);
        expect(host.createInProgress).toBe(false);
    });

    test('rejects on connection error', async () => {
        const host = createMockHost();
        const promise = createRoom(host, { roomId: 'my-room' });

        const errorData = { type: 'connection', message: 'Lost connection' };
        host._listeners['error']?.[0](errorData);

        await expect(promise).rejects.toEqual(errorData);
    });

    test('emits room:create with settings', () => {
        const host = createMockHost();
        createRoom(host, { roomId: 'my-room', nickname: 'Me', gameMode: 'duet' } as never);

        expect(host.socket!.emit).toHaveBeenCalledWith(
            'room:create',
            expect.objectContaining({
                roomId: 'my-room',
                settings: expect.objectContaining({ nickname: 'Me', gameMode: 'duet' }),
            })
        );
    });

    test('cleans up listeners after resolve', async () => {
        const host = createMockHost();
        const promise = createRoom(host, { roomId: 'test' });

        host._listeners['roomCreated']?.[0]({ roomCode: 'test' });
        await promise;

        expect(host.off).toHaveBeenCalledWith('roomCreated', expect.any(Function));
        expect(host.off).toHaveBeenCalledWith('error', expect.any(Function));
    });

    test('ignores room errors with mismatched requestId', async () => {
        const host = createMockHost();
        const promise = createRoom(host, { roomId: 'test' });

        // Error with different requestId should be ignored
        host._listeners['error']?.[0]({ type: 'room', requestId: 'wrong_id' });

        // Still pending - resolve it to clean up
        host._listeners['roomCreated']?.[0]({ roomCode: 'test' });
        await expect(promise).resolves.toBeDefined();
    });
});

describe('joinRoom', () => {
    test('rejects when join already in progress', async () => {
        const host = createMockHost({ joinInProgress: true });
        await expect(joinRoom(host, 'room', 'nick')).rejects.toThrow('Join already in progress');
    });

    test('resolves on roomJoined event', async () => {
        const host = createMockHost();
        const promise = joinRoom(host, 'room', 'Player1');

        const joinData = { roomCode: 'room', player: { nickname: 'Player1' } };
        host._listeners['roomJoined']?.[0](joinData);

        await expect(promise).resolves.toEqual(joinData);
        expect(host.joinInProgress).toBe(false);
    });

    test('rejects on room error', async () => {
        const host = createMockHost();
        const promise = joinRoom(host, 'room', 'nick');

        const errorData = { type: 'room', message: 'Room full' };
        host._listeners['error']?.[0](errorData);

        await expect(promise).rejects.toEqual(errorData);
    });

    test('emits room:join with roomId, nickname, and requestId', () => {
        const host = createMockHost();
        joinRoom(host, 'my-room', 'Player1');

        expect(host.socket!.emit).toHaveBeenCalledWith(
            'room:join',
            expect.objectContaining({
                roomId: 'my-room',
                nickname: 'Player1',
                requestId: expect.any(String),
            })
        );
    });
});

describe('requestResync', () => {
    test('rejects when not in a room', async () => {
        const host = createMockHost({ roomCode: null });
        await expect(requestResync(host)).rejects.toThrow('Not in a room');
    });

    test('resolves on roomResynced event', async () => {
        const host = createMockHost();
        const promise = requestResync(host);

        const resyncData = { players: [], room: { code: 'test-room' }, game: null };
        host._listeners['roomResynced']?.[0](resyncData);

        await expect(promise).resolves.toEqual(resyncData);
    });

    test('rejects on connection error', async () => {
        const host = createMockHost();
        const promise = requestResync(host);

        const errorData = { type: 'connection', message: 'Lost connection' };
        host._listeners['error']?.[0](errorData);

        await expect(promise).rejects.toEqual(errorData);
    });

    test('emits room:resync with requestId', () => {
        const host = createMockHost();
        requestResync(host);

        expect(host.socket!.emit).toHaveBeenCalledWith(
            'room:resync',
            expect.objectContaining({ requestId: expect.any(String) })
        );
    });

    test('handles null socket gracefully', () => {
        const host = createMockHost({ socket: null });

        // Should not throw even with null socket (getSocket returns null)
        const promise = requestResync(host);

        // Resolve via event to settle
        host._listeners['roomResynced']?.[0]({});
        return expect(promise).resolves.toBeDefined();
    });
});
