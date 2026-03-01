/**
 * Player actions unit tests
 */

jest.mock('../../../../frontend/state', () => ({
    state: {
        playerTeam: null,
        spymasterTeam: null,
        clickerTeam: null,
        isHost: false,
        multiplayerPlayers: [] as any[],
    },
}));

jest.mock('../../../../frontend/logger', () => ({
    logger: { warn: jest.fn(), error: jest.fn(), debug: jest.fn(), info: jest.fn() },
}));

import { state } from '../../../../frontend/state';
import { clearAllListeners } from '../../../../frontend/store/eventBus';
import {
    setPlayerRole,
    clearPlayerRole,
    syncLocalPlayerState,
    setHost,
    setPlayers,
    addPlayer,
    removePlayer,
    updatePlayer,
} from '../../../../frontend/store/actions/playerActions';

beforeEach(() => {
    state.playerTeam = null;
    state.spymasterTeam = null;
    state.clickerTeam = null;
    state.isHost = false;
    state.multiplayerPlayers = [];
    clearAllListeners();
    jest.clearAllMocks();
});

describe('setPlayerRole', () => {
    test('sets spymaster on red', () => {
        setPlayerRole('spymaster', 'red');
        expect(state.playerTeam).toBe('red');
        expect(state.spymasterTeam).toBe('red');
        expect(state.clickerTeam).toBeNull();
    });

    test('sets clicker on blue', () => {
        setPlayerRole('clicker', 'blue');
        expect(state.playerTeam).toBe('blue');
        expect(state.clickerTeam).toBe('blue');
        expect(state.spymasterTeam).toBeNull();
    });
});

describe('clearPlayerRole', () => {
    test('clears all role state', () => {
        state.playerTeam = 'red';
        state.spymasterTeam = 'red';

        clearPlayerRole();

        expect(state.playerTeam).toBeNull();
        expect(state.spymasterTeam).toBeNull();
        expect(state.clickerTeam).toBeNull();
    });
});

describe('syncLocalPlayerState', () => {
    test('syncs from server player data', () => {
        syncLocalPlayerState({
            sessionId: '123',
            nickname: 'test',
            team: 'blue',
            role: 'clicker',
            isHost: false,
            connected: true,
        } as any);

        expect(state.playerTeam).toBe('blue');
        expect(state.clickerTeam).toBe('blue');
    });

    test('handles null player', () => {
        expect(() => syncLocalPlayerState(null as any)).not.toThrow();
    });
});

describe('setHost', () => {
    test('sets host flag', () => {
        setHost(true);
        expect(state.isHost).toBe(true);
    });
});

describe('player list operations', () => {
    const player1 = {
        sessionId: 'a',
        nickname: 'Alice',
        team: 'red',
        role: 'clicker',
        isHost: true,
        connected: true,
    } as any;
    const player2 = {
        sessionId: 'b',
        nickname: 'Bob',
        team: 'blue',
        role: 'spymaster',
        isHost: false,
        connected: true,
    } as any;

    test('setPlayers replaces entire list', () => {
        setPlayers([player1, player2]);
        expect(state.multiplayerPlayers).toHaveLength(2);
    });

    test('addPlayer adds to list', () => {
        setPlayers([player1]);
        addPlayer(player2);
        expect(state.multiplayerPlayers).toHaveLength(2);
    });

    test('addPlayer prevents duplicates', () => {
        setPlayers([player1]);
        addPlayer(player1);
        expect(state.multiplayerPlayers).toHaveLength(1);
    });

    test('removePlayer removes by sessionId', () => {
        setPlayers([player1, player2]);
        removePlayer('a');
        expect(state.multiplayerPlayers).toHaveLength(1);
        expect(state.multiplayerPlayers[0].sessionId).toBe('b');
    });

    test('updatePlayer replaces matching player', () => {
        setPlayers([player1, player2]);
        const updated = { ...player1, nickname: 'Alice Updated' };
        updatePlayer(updated);
        expect(state.multiplayerPlayers[0].nickname).toBe('Alice Updated');
        expect(state.multiplayerPlayers[1].sessionId).toBe('b');
    });
});
