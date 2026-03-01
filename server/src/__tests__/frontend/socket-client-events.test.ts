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
        saveSession: jest.fn(),
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
                player: { sessionId: 'new-server-session', nickname: 'Host' },
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
                player: { sessionId: 'fresh-session', nickname: 'Host' },
            });

            expect(client.sessionId).toBe('fresh-session');
        });

        test('does not clear sessionId when player has no sessionId field', () => {
            const { handlers, client } = setup();
            client.sessionId = 'existing-session';

            handlers['room:created']({
                room: { code: 'ABC' },
                player: { nickname: 'Host' }, // no sessionId
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
                you: { sessionId: 'server-assigned-session', nickname: 'Joiner' },
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
                you: { sessionId: 'p1', nickname: 'Synced' },
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
                message: 'Not found',
            });
        });

        test('game:error emits with type "game"', () => {
            const { handlers, emit } = setup();

            handlers['game:error']({ code: 'GAME_ERROR', message: 'Failed' });

            expect(emit).toHaveBeenCalledWith('error', {
                type: 'game',
                code: 'GAME_ERROR',
                message: 'Failed',
            });
        });

        test('player:error emits with type "player"', () => {
            const { handlers, emit } = setup();

            handlers['player:error']({ code: 'PLAYER_ERROR', message: 'Oops' });

            expect(emit).toHaveBeenCalledWith('error', {
                type: 'player',
                code: 'PLAYER_ERROR',
                message: 'Oops',
            });
        });
    });

    test('registers all expected socket events', () => {
        const { register } = setup();
        const registeredEvents = register.mock.calls.map((call: any[]) => call[0]);

        // Key events that must be registered
        const requiredEvents = [
            'room:created',
            'room:joined',
            'room:playerJoined',
            'room:playerLeft',
            'room:kicked',
            'room:error',
            'room:resynced',
            'room:reconnected',
            'room:hostChanged',
            'room:settingsUpdated',
            'room:statsUpdated',
            'player:updated',
            'player:kicked',
            'player:disconnected',
            'player:error',
            'game:started',
            'game:cardRevealed',
            'game:turnEnded',
            'game:over',
            'game:error',
            'timer:started',
            'timer:stopped',
            'timer:tick',
            'timer:expired',
            'chat:message',
            'chat:spectatorMessage',
        ];

        for (const event of requiredEvents) {
            expect(registeredEvents).toContain(event);
        }
    });

    // ========== SIMPLE PASSTHROUGH EVENT HANDLERS ==========

    describe('room:playerJoined', () => {
        test('emits playerJoined with data', () => {
            const { handlers, emit } = setup();
            const data = { sessionId: 'p1', nickname: 'NewPlayer' };

            handlers['room:playerJoined'](data);

            expect(emit).toHaveBeenCalledWith('playerJoined', data);
        });
    });

    describe('room:playerLeft', () => {
        test('emits playerLeft with data', () => {
            const { handlers, emit } = setup();
            const data = { sessionId: 'p2', nickname: 'Leaver' };

            handlers['room:playerLeft'](data);

            expect(emit).toHaveBeenCalledWith('playerLeft', data);
        });
    });

    describe('room:settingsUpdated', () => {
        test('emits settingsUpdated with data', () => {
            const { handlers, emit } = setup();
            const data = { timerEnabled: true, timerDuration: 60 };

            handlers['room:settingsUpdated'](data);

            expect(emit).toHaveBeenCalledWith('settingsUpdated', data);
        });
    });

    describe('room:statsUpdated', () => {
        test('emits statsUpdated with data', () => {
            const { handlers, emit } = setup();
            const data = { redScore: 3, blueScore: 5 };

            handlers['room:statsUpdated'](data);

            expect(emit).toHaveBeenCalledWith('statsUpdated', data);
        });
    });

    describe('player:kicked', () => {
        test('emits playerKicked with data', () => {
            const { handlers, emit } = setup();
            const data = { sessionId: 'p3', reason: 'inactivity' };

            handlers['player:kicked'](data);

            expect(emit).toHaveBeenCalledWith('playerKicked', data);
        });
    });

    describe('room:warning', () => {
        test('emits roomWarning with data', () => {
            const { handlers, emit } = setup();
            const data = { message: 'Stats may be stale' };

            handlers['room:warning'](data);

            expect(emit).toHaveBeenCalledWith('roomWarning', data);
        });
    });

    describe('room:reconnected', () => {
        test('updates roomCode, player, calls saveSession, and emits roomReconnected', () => {
            const { handlers, client, emit } = setup();
            client.roomCode = 'OLD';
            client.player = { sessionId: 'old-p', nickname: 'Old' } as Player;

            const data = {
                room: { code: 'RECON' },
                you: { sessionId: 'new-p', nickname: 'Reconnected' },
            };

            handlers['room:reconnected'](data);

            expect(client.roomCode).toBe('RECON');
            expect(client.player).toEqual({ sessionId: 'new-p', nickname: 'Reconnected' });
            expect(client.saveSession).toHaveBeenCalled();
            expect(emit).toHaveBeenCalledWith('roomReconnected', data);
        });

        test('keeps existing roomCode when room.code is missing', () => {
            const { handlers, client } = setup();
            client.roomCode = 'KEEP';

            handlers['room:reconnected']({ room: {}, you: { sessionId: 'p1' } });

            expect(client.roomCode).toBe('KEEP');
        });

        test('keeps existing player when you is missing', () => {
            const { handlers, client } = setup();
            client.player = { sessionId: 'keep-me', nickname: 'Kept' } as Player;

            handlers['room:reconnected']({ room: { code: 'R1' } });

            expect(client.player).toEqual({ sessionId: 'keep-me', nickname: 'Kept' });
        });
    });

    describe('player:disconnected', () => {
        test('emits playerDisconnected with data', () => {
            const { handlers, emit } = setup();
            const data = { sessionId: 'p4', nickname: 'DCPlayer' };

            handlers['player:disconnected'](data);

            expect(emit).toHaveBeenCalledWith('playerDisconnected', data);
        });
    });

    describe('player:reconnected', () => {
        test('emits playerReconnected with data', () => {
            const { handlers, emit } = setup();
            const data = { sessionId: 'p5', nickname: 'ReconPlayer' };

            handlers['player:reconnected'](data);

            expect(emit).toHaveBeenCalledWith('playerReconnected', data);
        });
    });

    describe('room:playerReconnected', () => {
        test('emits playerReconnected with data', () => {
            const { handlers, emit } = setup();
            const data = { sessionId: 'p6', nickname: 'TokenRecon' };

            handlers['room:playerReconnected'](data);

            expect(emit).toHaveBeenCalledWith('playerReconnected', data);
        });
    });

    // ========== GAME EVENT HANDLERS ==========

    describe('game:started', () => {
        test('emits gameStarted with data', () => {
            const { handlers, emit } = setup();
            const data = { board: [], currentTeam: 'red', seed: 12345 };

            handlers['game:started'](data);

            expect(emit).toHaveBeenCalledWith('gameStarted', data);
        });
    });

    describe('game:cardRevealed', () => {
        test('emits cardRevealed with data', () => {
            const { handlers, emit } = setup();
            const data = { index: 5, team: 'red', word: 'Apple' };

            handlers['game:cardRevealed'](data);

            expect(emit).toHaveBeenCalledWith('cardRevealed', data);
        });
    });

    describe('game:turnEnded', () => {
        test('emits turnEnded with data', () => {
            const { handlers, emit } = setup();
            const data = { currentTeam: 'blue', previousTeam: 'red' };

            handlers['game:turnEnded'](data);

            expect(emit).toHaveBeenCalledWith('turnEnded', data);
        });
    });

    describe('game:over', () => {
        test('emits gameOver with data', () => {
            const { handlers, emit } = setup();
            const data = { winner: 'red', reason: 'all_cards_revealed' };

            handlers['game:over'](data);

            expect(emit).toHaveBeenCalledWith('gameOver', data);
        });
    });

    describe('game:spymasterView', () => {
        test('emits spymasterView with data', () => {
            const { handlers, emit } = setup();
            const data = { board: [{ word: 'A', team: 'red' }] };

            handlers['game:spymasterView'](data);

            expect(emit).toHaveBeenCalledWith('spymasterView', data);
        });
    });

    describe('game:historyResult', () => {
        test('emits historyResult with data', () => {
            const { handlers, emit } = setup();
            const data = { gameId: 42, moves: [] };

            handlers['game:historyResult'](data);

            expect(emit).toHaveBeenCalledWith('historyResult', data);
        });
    });

    describe('game:replayData', () => {
        test('emits replayData with data', () => {
            const { handlers, emit } = setup();
            const data = { gameId: 7, replay: { moves: [], board: [] } };

            handlers['game:replayData'](data);

            expect(emit).toHaveBeenCalledWith('replayData', data);
        });
    });

    // ========== TIMER EVENT HANDLERS ==========

    describe('timer:started', () => {
        test('emits timerStarted with data', () => {
            const { handlers, emit } = setup();
            const data = { duration: 60, remainingSeconds: 60 };

            handlers['timer:started'](data);

            expect(emit).toHaveBeenCalledWith('timerStarted', data);
        });
    });

    describe('timer:stopped', () => {
        test('emits timerStopped with data', () => {
            const { handlers, emit } = setup();
            const data = { reason: 'turn_ended' };

            handlers['timer:stopped'](data);

            expect(emit).toHaveBeenCalledWith('timerStopped', data);
        });
    });

    describe('timer:tick', () => {
        test('emits timerTick with data', () => {
            const { handlers, emit } = setup();
            const data = { remainingSeconds: 45 };

            handlers['timer:tick'](data);

            expect(emit).toHaveBeenCalledWith('timerTick', data);
        });
    });

    describe('timer:expired', () => {
        test('emits timerExpired with data', () => {
            const { handlers, emit } = setup();
            const data = { team: 'red' };

            handlers['timer:expired'](data);

            expect(emit).toHaveBeenCalledWith('timerExpired', data);
        });
    });

    describe('timer:status', () => {
        test('emits timerStatus with data', () => {
            const { handlers, emit } = setup();
            const data = { active: true, remainingSeconds: 30 };

            handlers['timer:status'](data);

            expect(emit).toHaveBeenCalledWith('timerStatus', data);
        });
    });

    describe('timer:paused', () => {
        test('emits timerPaused with data', () => {
            const { handlers, emit } = setup();
            const data = { remainingSeconds: 20 };

            handlers['timer:paused'](data);

            expect(emit).toHaveBeenCalledWith('timerPaused', data);
        });
    });

    describe('timer:resumed', () => {
        test('emits timerResumed with data', () => {
            const { handlers, emit } = setup();
            const data = { remainingSeconds: 20, endTime: Date.now() + 20000 };

            handlers['timer:resumed'](data);

            expect(emit).toHaveBeenCalledWith('timerResumed', data);
        });
    });

    describe('timer:timeAdded', () => {
        test('emits timerTimeAdded with data', () => {
            const { handlers, emit } = setup();
            const data = { addedSeconds: 30, remainingSeconds: 50 };

            handlers['timer:timeAdded'](data);

            expect(emit).toHaveBeenCalledWith('timerTimeAdded', data);
        });
    });

    // ========== CHAT EVENT HANDLERS ==========

    describe('chat:message', () => {
        test('emits chatMessage with data', () => {
            const { handlers, emit } = setup();
            const data = { sender: 'Player1', message: 'Hello!', team: 'red' };

            handlers['chat:message'](data);

            expect(emit).toHaveBeenCalledWith('chatMessage', data);
        });
    });

    describe('chat:spectatorMessage', () => {
        test('emits spectatorChatMessage with data', () => {
            const { handlers, emit } = setup();
            const data = { sender: 'Spectator1', message: 'Nice move!' };

            handlers['chat:spectatorMessage'](data);

            expect(emit).toHaveBeenCalledWith('spectatorChatMessage', data);
        });
    });
});
