/**
 * Selectors unit tests
 */

jest.mock('../../../frontend/state', () => ({
    state: {
        spymasterTeam: null,
        clickerTeam: null,
        playerTeam: null,
        isHost: false,
        isMultiplayerMode: false,
        gameMode: 'classic',
        teamNames: { red: 'Red', blue: 'Blue' },
        multiplayerPlayers: [] as any[],
        gameState: {
            words: [] as string[],
            types: [] as string[],
            revealed: [] as boolean[],
            currentTurn: 'red',
            redScore: 0,
            blueScore: 0,
            redTotal: 9,
            blueTotal: 8,
            gameOver: false,
            winner: null,
        }
    }
}));

import { state } from '../../../frontend/state';
import {
    isSpymaster, isClicker, hasTeam, hasRole,
    isPlayerTurn, isTeamOnTurn,
    showSpymasterView, gameInProgress,
    redRemaining, blueRemaining,
    currentTeamName, teamName,
    isCurrentTeamClickerUnavailable, isClickerFallback, canActAsClicker,
    isDuetMode, playerCount,
} from '../../../frontend/store/selectors';

function resetState(): void {
    state.spymasterTeam = null;
    state.clickerTeam = null;
    state.playerTeam = null;
    state.isHost = false;
    state.isMultiplayerMode = false;
    state.gameMode = 'classic';
    state.teamNames = { red: 'Red', blue: 'Blue' };
    state.multiplayerPlayers = [];
    state.gameState.words = [];
    state.gameState.types = [];
    state.gameState.revealed = [];
    state.gameState.currentTurn = 'red';
    state.gameState.redScore = 0;
    state.gameState.blueScore = 0;
    state.gameState.redTotal = 9;
    state.gameState.blueTotal = 8;
    state.gameState.gameOver = false;
    state.gameState.winner = null;
}

beforeEach(resetState);

// ---- Role selectors ----

describe('isSpymaster', () => {
    test('returns false when spymasterTeam is null', () => {
        expect(isSpymaster()).toBe(false);
    });

    test('returns true when spymasterTeam is set', () => {
        state.spymasterTeam = 'red';
        expect(isSpymaster()).toBe(true);
    });
});

describe('isClicker', () => {
    test('returns false when clickerTeam is null', () => {
        expect(isClicker()).toBe(false);
    });

    test('returns true when clickerTeam is set', () => {
        state.clickerTeam = 'blue';
        expect(isClicker()).toBe(true);
    });
});

describe('hasTeam', () => {
    test('returns false when no team', () => {
        expect(hasTeam()).toBe(false);
    });

    test('returns true when on a team', () => {
        state.playerTeam = 'red';
        expect(hasTeam()).toBe(true);
    });
});

describe('hasRole', () => {
    test('returns false when no role', () => {
        expect(hasRole()).toBe(false);
    });

    test('returns true for spymaster', () => {
        state.spymasterTeam = 'red';
        expect(hasRole()).toBe(true);
    });

    test('returns true for clicker', () => {
        state.clickerTeam = 'blue';
        expect(hasRole()).toBe(true);
    });
});

// ---- Turn selectors ----

describe('isPlayerTurn', () => {
    test('returns false when not a clicker', () => {
        state.gameState.currentTurn = 'red';
        expect(isPlayerTurn()).toBe(false);
    });

    test('returns false when clicker but not on turn', () => {
        state.clickerTeam = 'blue';
        state.gameState.currentTurn = 'red';
        expect(isPlayerTurn()).toBe(false);
    });

    test('returns true when clicker on turn', () => {
        state.clickerTeam = 'red';
        state.gameState.currentTurn = 'red';
        expect(isPlayerTurn()).toBe(true);
    });

    test('returns false when game is over', () => {
        state.clickerTeam = 'red';
        state.gameState.currentTurn = 'red';
        state.gameState.gameOver = true;
        expect(isPlayerTurn()).toBe(false);
    });
});

describe('isTeamOnTurn', () => {
    test('returns false when not on turn', () => {
        state.playerTeam = 'blue';
        state.gameState.currentTurn = 'red';
        expect(isTeamOnTurn()).toBe(false);
    });

    test('returns true when team is on turn', () => {
        state.playerTeam = 'red';
        state.gameState.currentTurn = 'red';
        expect(isTeamOnTurn()).toBe(true);
    });
});

// ---- Board/view selectors ----

describe('showSpymasterView', () => {
    test('returns false when neither spymaster nor game over', () => {
        expect(showSpymasterView()).toBe(false);
    });

    test('returns true when spymaster', () => {
        state.spymasterTeam = 'red';
        expect(showSpymasterView()).toBe(true);
    });

    test('returns true when game is over', () => {
        state.gameState.gameOver = true;
        expect(showSpymasterView()).toBe(true);
    });
});

describe('gameInProgress', () => {
    test('returns false when no words', () => {
        expect(gameInProgress()).toBe(false);
    });

    test('returns false when game over', () => {
        state.gameState.words = ['a', 'b', 'c'];
        state.gameState.gameOver = true;
        expect(gameInProgress()).toBe(false);
    });

    test('returns true when words exist and not over', () => {
        state.gameState.words = ['a', 'b', 'c'];
        expect(gameInProgress()).toBe(true);
    });
});

// ---- Score selectors ----

describe('redRemaining / blueRemaining', () => {
    test('returns correct remaining counts', () => {
        state.gameState.redTotal = 9;
        state.gameState.redScore = 3;
        state.gameState.blueTotal = 8;
        state.gameState.blueScore = 5;

        expect(redRemaining()).toBe(6);
        expect(blueRemaining()).toBe(3);
    });

    test('returns 0 when all found', () => {
        state.gameState.redTotal = 9;
        state.gameState.redScore = 9;
        expect(redRemaining()).toBe(0);
    });
});

// ---- Team name selectors ----

describe('currentTeamName', () => {
    test('returns red team name when red turn', () => {
        state.gameState.currentTurn = 'red';
        state.teamNames.red = 'Crimson';
        expect(currentTeamName()).toBe('Crimson');
    });

    test('returns blue team name when blue turn', () => {
        state.gameState.currentTurn = 'blue';
        state.teamNames.blue = 'Azure';
        expect(currentTeamName()).toBe('Azure');
    });
});

describe('teamName', () => {
    test('returns red name for red', () => {
        state.teamNames.red = 'Crimson';
        expect(teamName('red')).toBe('Crimson');
    });

    test('returns blue name for blue', () => {
        state.teamNames.blue = 'Azure';
        expect(teamName('blue')).toBe('Azure');
    });
});

// ---- Clicker availability selectors ----

describe('isCurrentTeamClickerUnavailable', () => {
    test('returns true when no clicker assigned', () => {
        state.gameState.currentTurn = 'red';
        state.multiplayerPlayers = [
            { sessionId: '1', team: 'red', role: 'spymaster', connected: true } as any
        ];
        expect(isCurrentTeamClickerUnavailable()).toBe(true);
    });

    test('returns true when clicker is disconnected', () => {
        state.gameState.currentTurn = 'red';
        state.multiplayerPlayers = [
            { sessionId: '1', team: 'red', role: 'clicker', connected: false } as any
        ];
        expect(isCurrentTeamClickerUnavailable()).toBe(true);
    });

    test('returns false when clicker is connected', () => {
        state.gameState.currentTurn = 'red';
        state.multiplayerPlayers = [
            { sessionId: '1', team: 'red', role: 'clicker', connected: true } as any
        ];
        expect(isCurrentTeamClickerUnavailable()).toBe(false);
    });
});

describe('isClickerFallback', () => {
    test('returns false in standalone mode', () => {
        state.isMultiplayerMode = false;
        expect(isClickerFallback()).toBe(false);
    });

    test('returns false when player is the active clicker', () => {
        state.isMultiplayerMode = true;
        state.clickerTeam = 'red';
        state.gameState.currentTurn = 'red';
        expect(isClickerFallback()).toBe(false);
    });

    test('returns true when team on turn and clicker unavailable', () => {
        state.isMultiplayerMode = true;
        state.playerTeam = 'red';
        state.clickerTeam = null;
        state.gameState.currentTurn = 'red';
        state.multiplayerPlayers = [];
        expect(isClickerFallback()).toBe(true);
    });

    test('returns false when not on turn', () => {
        state.isMultiplayerMode = true;
        state.playerTeam = 'blue';
        state.gameState.currentTurn = 'red';
        expect(isClickerFallback()).toBe(false);
    });
});

describe('canActAsClicker', () => {
    test('returns false when game over', () => {
        state.clickerTeam = 'red';
        state.gameState.currentTurn = 'red';
        state.gameState.gameOver = true;
        expect(canActAsClicker()).toBe(false);
    });

    test('returns true when active clicker on turn', () => {
        state.clickerTeam = 'red';
        state.gameState.currentTurn = 'red';
        expect(canActAsClicker()).toBe(true);
    });

    test('returns true for clicker fallback', () => {
        state.isMultiplayerMode = true;
        state.playerTeam = 'red';
        state.clickerTeam = null;
        state.gameState.currentTurn = 'red';
        state.multiplayerPlayers = [];
        expect(canActAsClicker()).toBe(true);
    });
});

// ---- Game mode selectors ----

describe('isDuetMode', () => {
    test('returns false for classic', () => {
        state.gameMode = 'classic';
        expect(isDuetMode()).toBe(false);
    });

    test('returns true for duet', () => {
        state.gameMode = 'duet';
        expect(isDuetMode()).toBe(true);
    });
});

// ---- Multiplayer selectors ----

describe('playerCount', () => {
    test('returns 0 when empty', () => {
        expect(playerCount()).toBe(0);
    });

    test('returns correct count', () => {
        state.multiplayerPlayers = [
            { sessionId: '1' } as any,
            { sessionId: '2' } as any,
        ];
        expect(playerCount()).toBe(2);
    });
});
