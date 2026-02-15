/**
 * Socket Client Events Tests
 *
 * Tests the event listener registration in socket-client-events.ts,
 * focusing on session sync behavior and client state management.
 */

import { registerAllEventListeners } from '../../frontend/socket-client-events';
import type { Player } from '../../frontend/socket-client-types';

/**
 * Create a fresh client state object and capture registered handlers.
 * Returns the handlers map so tests can invoke them directly.
 */
function setup() {
    const handlers: Record<string, (...args: any[]) => void> = {};
    const register = jest.fn((event: string, handler: (...args: any[]) => void) => {
        handlers[event] = handler;
    });
    const emit = jest.fn();
    const client = {
        roomCode: null as string | null,
        player: null as Player | null,
        sessionId: null as string | null,
        saveSession: jest.fn()
    };

    registerAllEventListeners(register, emit, client);

    return { handlers, register, emit, client };
}

describe('registerAllEventListeners', () => {
    describe('room:created', () => {
        test('syncs sessionId from server even when client already has one', () => {
            const { handlers, client } = setup();
            // Client already has a stale sessionId from a previous connection
            client.sessionId = 'old-stale-session';

            handlers['room:created']({
                room: { code: 'ABC' },
                player: { sessionId: 'new-server-session', nickname: 'Host' }
            });

            // Must overwrite the stale ID with the server-assigned one
            expect(client.sessionId).toBe('new-server-session');
            expect(client.roomCode).toBe('ABC');
            expect(client.saveSession).toHaveBeenCalled();
        });

        test('syncs sessionId from server when client has none', () => {
            const { handlers, client } = setup();
            expect(client.sessionId).toBeNull();

            handlers['room:created']({
                room: { code: 'XYZ' },
                player: { sessionId: 'fresh-session', nickname: 'Host' }
            });

            expect(client.sessionId).toBe('fresh-session');
        });

        test('does not clear sessionId when player has no sessionId field', () => {
            const { handlers, client } = setup();
            client.sessionId = 'existing-session';

            handlers['room:created']({
                room: { code: 'ABC' },
                player: { nickname: 'Host' }  // no sessionId
            });

            // Should keep existing sessionId (guard: `if (data.player?.sessionId)`)
            expect(client.sessionId).toBe('existing-session');
        });

        test('emits roomCreated with full data', () => {
            const { handlers, emit } = setup();
            const data = { room: { code: 'ABC' }, player: { sessionId: 's1' } };

            handlers['room:created'](data);

            expect(emit).toHaveBeenCalledWith('roomCreated', data);
        });
    });

    describe('room:joined', () => {
        test('syncs sessionId from server even when client already has one', () => {
            const { handlers, client } = setup();
            client.sessionId = 'old-session';

            handlers['room:joined']({
                room: { code: 'GAME' },
                you: { sessionId: 'server-assigned-session', nickname: 'Joiner' }
            });

            expect(client.sessionId).toBe('server-assigned-session');
            expect(client.player).toEqual({ sessionId: 'server-assigned-session', nickname: 'Joiner' });
            expect(client.roomCode).toBe('GAME');
            expect(client.saveSession).toHaveBeenCalled();
        });

        test('emits roomJoined with full data', () => {
            const { handlers, emit } = setup();
            const data = { room: { code: 'GAME' }, you: { sessionId: 's2' } };

            handlers['room:joined'](data);

            expect(emit).toHaveBeenCalledWith('roomJoined', data);
        });
    });

    describe('room:kicked', () => {
        test('clears roomCode and player on kick', () => {
            const { handlers, client, emit } = setup();
            client.roomCode = 'ABC';
            client.player = { sessionId: 's1', nickname: 'Me' } as Player;

            handlers['room:kicked']({ reason: 'bad behavior' });

            expect(client.roomCode).toBeNull();
            expect(client.player).toBeNull();
            expect(emit).toHaveBeenCalledWith('kicked', { reason: 'bad behavior' });
        });
    });

    describe('room:hostChanged', () => {
        test('sets isHost when current player becomes host', () => {
            const { handlers, client } = setup();
            client.player = { sessionId: 'me-123', nickname: 'Me', isHost: false } as Player;

            handlers['room:hostChanged']({ newHostSessionId: 'me-123' });

            expect(client.player!.isHost).toBe(true);
        });

        test('does not set isHost when another player becomes host', () => {
            const { handlers, client } = setup();
            client.player = { sessionId: 'me-123', nickname: 'Me', isHost: false } as Player;

            handlers['room:hostChanged']({ newHostSessionId: 'someone-else' });

            expect(client.player!.isHost).toBe(false);
        });
    });

    describe('player:updated', () => {
        test('merges changes when update matches current player', () => {
            const { handlers, client } = setup();
            client.player = { sessionId: 'p1', nickname: 'Old', team: 'red', role: 'guesser' } as Player;

            handlers['player:updated']({ sessionId: 'p1', changes: { team: 'blue' } });

            expect(client.player!.team).toBe('blue');
            expect(client.player!.nickname).toBe('Old'); // unchanged
        });

        test('ignores update for a different player', () => {
            const { handlers, client } = setup();
            client.player = { sessionId: 'p1', nickname: 'Me', team: 'red' } as Player;

            handlers['player:updated']({ sessionId: 'p2', changes: { team: 'blue' } });

            expect(client.player!.team).toBe('red'); // unchanged
        });
    });

    describe('room:resynced', () => {
        test('updates client state from resync data', () => {
            const { handlers, client } = setup();

            handlers['room:resynced']({
                room: { code: 'SYNC' },
                you: { sessionId: 'p1', nickname: 'Synced' }
            });

            expect(client.roomCode).toBe('SYNC');
            expect(client.player).toEqual({ sessionId: 'p1', nickname: 'Synced' });
        });
    });

    describe('error events', () => {
        test('room:error emits with type "room"', () => {
            const { handlers, emit } = setup();

            handlers['room:error']({ code: 'ROOM_NOT_FOUND', message: 'Not found' });

            expect(emit).toHaveBeenCalledWith('error', {
                type: 'room',
                code: 'ROOM_NOT_FOUND',
                message: 'Not found'
            });
        });

        test('game:error emits with type "game"', () => {
            const { handlers, emit } = setup();

            handlers['game:error']({ code: 'GAME_ERROR', message: 'Failed' });

            expect(emit).toHaveBeenCalledWith('error', {
                type: 'game',
                code: 'GAME_ERROR',
                message: 'Failed'
            });
        });

        test('player:error emits with type "player"', () => {
            const { handlers, emit } = setup();

            handlers['player:error']({ code: 'PLAYER_ERROR', message: 'Oops' });

            expect(emit).toHaveBeenCalledWith('error', {
                type: 'player',
                code: 'PLAYER_ERROR',
                message: 'Oops'
            });
        });
    });

    test('registers all expected socket events', () => {
        const { register } = setup();
        const registeredEvents = register.mock.calls.map((call: any[]) => call[0]);

        // Key events that must be registered
        const requiredEvents = [
            'room:created', 'room:joined', 'room:playerJoined', 'room:playerLeft',
            'room:kicked', 'room:error', 'room:resynced', 'room:reconnected',
            'room:hostChanged', 'room:settingsUpdated', 'room:statsUpdated',
            'player:updated', 'player:kicked', 'player:disconnected', 'player:error',
            'game:started', 'game:cardRevealed', 'game:turnEnded', 'game:over', 'game:error',
            'timer:started', 'timer:stopped', 'timer:tick', 'timer:expired',
            'chat:message', 'chat:spectatorMessage'
        ];

        for (const event of requiredEvents) {
            expect(registeredEvents).toContain(event);
        }
    });
});
