/**
 * Game Event Handlers Extended Tests
 *
 * Tests game:roundEnded, game:matchOver, and spymaster view events.
 */

// Track registered handlers
const eventHandlers: Record<string, (...args: unknown[]) => void> = {};
(globalThis as Record<string, unknown>).EigennamenClient = {
    on: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
        eventHandlers[event] = handler;
    }),
    getRoomCode: jest.fn(() => 'ROOM1'),
    player: { sessionId: 's1', isHost: true },
};

jest.mock('../../frontend/state', () => ({
    state: {
        gameMode: 'match',
        isHost: true,
        isMultiplayerMode: true,
        multiplayerPlayers: [],
        currentRoomId: 'ROOM1',
        playerTeam: 'red',
        spymasterTeam: null,
        clickerTeam: null,
        teamNames: { red: 'Red', blue: 'Blue' },
        isRevealingCard: false,
        revealingCards: new Set<number>(),
        revealTimeouts: new Map<number, ReturnType<typeof setTimeout>>(),
        revealTimestamps: new Map<number, number>(),
        roleChange: { phase: 'idle' as const },
        gameState: {
            words: [],
            types: [],
            revealed: [],
            currentTurn: 'red',
            redScore: 0,
            blueScore: 0,
            redTotal: 9,
            blueTotal: 8,
            gameOver: false,
            winner: null,
            seed: null,
            currentClue: null,
            guessesUsed: 0,
            guessesAllowed: 0,
            status: 'playing',
            redMatchScore: 0,
            blueMatchScore: 0,
            matchRound: 1,
            roundHistory: [],
            matchOver: false,
            matchWinner: null,
            cardScores: [],
            gameMode: 'match',
        },
        timerState: {
            active: false,
            endTime: null,
            duration: null,
            remainingSeconds: null,
            intervalId: null,
        },
        spectatorCount: 0,
        roomStats: null,
        cachedElements: {},
    },
}));

jest.mock('../../frontend/ui', () => ({
    showToast: jest.fn(),
    announceToScreenReader: jest.fn(),
}));

jest.mock('../../frontend/board', () => ({
    renderBoard: jest.fn(),
}));

jest.mock('../../frontend/game/scoring', () => ({
    updateScoreboard: jest.fn(),
    updateTurnIndicator: jest.fn(),
    updateMatchScoreboard: jest.fn(),
}));

jest.mock('../../frontend/game/reveal', () => ({
    handleCardRevealedEvent: jest.fn(),
}));

jest.mock('../../frontend/notifications', () => ({
    playNotificationSound: jest.fn(),
}));

jest.mock('../../frontend/i18n', () => ({
    t: (key: string, params?: Record<string, unknown>) => {
        if (key === 'game.roundComplete') return `Round ${params?.round} won by ${params?.team}`;
        if (key === 'game.matchOverWinner') return `Match won by ${params?.team}`;
        return key;
    },
}));

jest.mock('../../frontend/roles', () => ({
    updateRoleBanner: jest.fn(),
    updateControls: jest.fn(),
}));

jest.mock('../../frontend/logger', () => ({
    logger: { warn: jest.fn(), error: jest.fn(), debug: jest.fn(), info: jest.fn() },
}));

jest.mock('../../frontend/clientAccessor', () => ({
    getClient: () => null,
    isClientConnected: jest.fn(() => true),
}));

jest.mock('../../frontend/multiplayerUI', () => ({
    updateMpIndicator: jest.fn(),
    updateRoomStats: jest.fn(),
    updateSpectatorCount: jest.fn(),
    updateForfeitUI: jest.fn(),
}));

import { registerGameHandlers } from '../../frontend/handlers/gameEventHandlers';
import { state } from '../../frontend/state';
import { showToast, announceToScreenReader } from '../../frontend/ui';
import { updateMatchScoreboard } from '../../frontend/game/scoring';
import { playNotificationSound } from '../../frontend/notifications';

beforeEach(() => {
    jest.clearAllMocks();
    Object.keys(eventHandlers).forEach((k) => delete eventHandlers[k]);
    state.gameState.redMatchScore = 0;
    state.gameState.blueMatchScore = 0;
    state.gameState.matchRound = 1;
    state.gameState.roundHistory = [];
    state.gameState.matchOver = false;
    state.gameState.matchWinner = null;

    registerGameHandlers();
});

describe('game:roundEnded handler', () => {
    test('updates match scores and round history', () => {
        const roundResult = {
            roundNumber: 1,
            roundWinner: 'red',
            redBonusAwarded: false,
            blueBonusAwarded: false,
        };

        eventHandlers['game:roundEnded']({
            roundResult,
            redMatchScore: 10,
            blueMatchScore: 5,
            matchRound: 2,
        });

        expect(state.gameState.redMatchScore).toBe(10);
        expect(state.gameState.blueMatchScore).toBe(5);
        expect(state.gameState.matchRound).toBe(2);
        expect(state.gameState.roundHistory).toHaveLength(1);
        expect(state.gameState.roundHistory[0]).toBe(roundResult);
    });

    test('calls updateMatchScoreboard and shows round summary toast', () => {
        eventHandlers['game:roundEnded']({
            roundResult: {
                roundNumber: 2,
                roundWinner: 'blue',
                redBonusAwarded: false,
                blueBonusAwarded: true,
            },
            redMatchScore: 8,
            blueMatchScore: 15,
            matchRound: 3,
        });

        expect(updateMatchScoreboard).toHaveBeenCalled();
        expect(showToast).toHaveBeenCalledWith(expect.stringContaining('Round 2'), 'info', 8000);
    });

    test('ignores event with no roundResult', () => {
        eventHandlers['game:roundEnded']({});

        expect(state.gameState.roundHistory).toHaveLength(0);
        expect(updateMatchScoreboard).not.toHaveBeenCalled();
    });
});

describe('game:matchOver handler', () => {
    test('sets match over state and winner', () => {
        eventHandlers['game:matchOver']({
            roundResult: {
                roundNumber: 3,
                roundWinner: 'red',
                redBonusAwarded: true,
                blueBonusAwarded: false,
            },
            redMatchScore: 25,
            blueMatchScore: 18,
            matchWinner: 'red',
        });

        expect(state.gameState.matchOver).toBe(true);
        expect(state.gameState.matchWinner).toBe('red');
        expect(state.gameState.redMatchScore).toBe(25);
        expect(state.gameState.blueMatchScore).toBe(18);
        expect(state.gameState.roundHistory).toHaveLength(1);
    });

    test('shows match over toast and plays notification', () => {
        eventHandlers['game:matchOver']({
            roundResult: {
                roundNumber: 3,
                roundWinner: 'blue',
                redBonusAwarded: false,
                blueBonusAwarded: false,
            },
            redMatchScore: 15,
            blueMatchScore: 20,
            matchWinner: 'blue',
        });

        expect(showToast).toHaveBeenCalledWith(expect.stringContaining('Match won by Blue'), 'success', 12000);
        expect(announceToScreenReader).toHaveBeenCalled();
        expect(playNotificationSound).toHaveBeenCalledWith('gameOver');
    });

    test('ignores event with no roundResult', () => {
        eventHandlers['game:matchOver']({});

        expect(state.gameState.matchOver).toBeFalsy();
    });
});
