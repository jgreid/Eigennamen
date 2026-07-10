/**
 * Advisor suggestions vs. resync: a game:botSuggestion event arriving while a
 * resync is in progress must be HELD, not dropped. Suggestions are not part of
 * the room:resynced snapshot and the advisor de-dupes per game state, so a
 * dropped event is lost permanently — with a human clicker waiting on the
 * advice, nothing else re-triggers it (the e2e/bot-lifecycle deadlock).
 */

// Track registered handlers (same harness pattern as gameEventHandlersExtended).
const eventHandlers: Record<string, (...args: unknown[]) => void> = {};
(globalThis as Record<string, unknown>).EigennamenClient = {
    on: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
        eventHandlers[event] = handler;
    }),
    getRoomCode: jest.fn(() => 'ROOM1'),
    player: { sessionId: 's1', isHost: false },
};

const mockState: Record<string, unknown> = {};
jest.mock('../../frontend/state', () => ({ state: mockState }));

jest.mock('../../frontend/board', () => ({
    renderBoard: jest.fn(),
    renderBotSuggestions: jest.fn(),
    clearBotSuggestions: jest.fn(),
    flushPendingBotSuggestion: jest.fn(),
}));
jest.mock('../../frontend/ui', () => ({
    showToast: jest.fn(),
    announceToScreenReader: jest.fn(),
    closeModal: jest.fn(),
}));
jest.mock('../../frontend/i18n', () => ({ t: (k: string) => k }));
jest.mock('../../frontend/game', () => ({
    updateScoreboard: jest.fn(),
    updateTurnIndicator: jest.fn(),
    updateControls: jest.fn(),
}));
jest.mock('../../frontend/game/scoring', () => ({
    updateMatchScoreboard: jest.fn(),
    updateTurnIndicator: jest.fn(),
}));
jest.mock('../../frontend/game/reveal', () => ({
    showGameOverModal: jest.fn(),
    markCardRevealing: jest.fn(),
    finishCardReveal: jest.fn(),
}));
jest.mock('../../frontend/roles', () => ({ updateRoleBanner: jest.fn(), updateControls: jest.fn() }));
jest.mock('../../frontend/logger', () => ({
    logger: { warn: jest.fn(), error: jest.fn(), debug: jest.fn(), info: jest.fn() },
}));
jest.mock('../../frontend/clientAccessor', () => ({
    getClient: () => null,
    isClientConnected: jest.fn(() => true),
}));
jest.mock('../../frontend/multiplayerUI', () => ({
    updateForfeitButton: jest.fn(),
    updateDuetUI: jest.fn(),
    renderPauseState: jest.fn(),
}));
jest.mock('../../frontend/gameLog', () => ({ addLogEntry: jest.fn(), clearGameLog: jest.fn() }));
jest.mock('../../frontend/timer', () => ({ handleTimerStopped: jest.fn() }));
jest.mock('../../frontend/notifications', () => ({
    playNotificationSound: jest.fn(),
    setTabNotification: jest.fn(),
}));
jest.mock('../../frontend/recap', () => ({ updateRecapButton: jest.fn(), showRecap: jest.fn() }));
jest.mock('../../frontend/history-replay', () => ({ renderHistoryList: jest.fn(), showReplay: jest.fn() }));
jest.mock('../../frontend/stateMutations', () => ({
    resetGameState: jest.fn(),
    validateTurn: (v: unknown) => v,
    validateWinner: (v: unknown) => v,
    validateGameMode: (v: unknown) => v,
    validateArrayLength: (v: unknown) => v,
}));
jest.mock('../../frontend/store/batch', () => ({ batch: (fn: () => void) => fn() }));

import { registerGameHandlers } from '../../frontend/handlers/gameEventHandlers';
import { renderBotSuggestions } from '../../frontend/board';

const SUGGESTIONS = [{ index: 3, confidence: 0.8, reason: 'fits' }];
const payload = (team: string): Record<string, unknown> => ({
    team,
    suggestions: SUGGESTIONS,
    advisor: { nickname: 'Greedy Bot' },
});

describe('botSuggestion during resync is held, not dropped', () => {
    beforeAll(() => {
        registerGameHandlers();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        Object.assign(mockState, {
            resyncInProgress: false,
            isObserver: false,
            playerTeam: 'red',
            botSuggestions: [],
            botSuggestionAdvisor: null,
            pendingBotSuggestion: null,
        });
    });

    it('stashes a relevant suggestion while resyncInProgress', () => {
        mockState.resyncInProgress = true;
        eventHandlers['botSuggestion']?.(payload('red'));
        expect(mockState.pendingBotSuggestion).toEqual({ suggestions: SUGGESTIONS, advisor: 'Greedy Bot' });
        expect(mockState.botSuggestions).toEqual([]); // not applied yet
        expect(renderBotSuggestions).not.toHaveBeenCalled();
    });

    it('applies immediately when no resync is in progress', () => {
        eventHandlers['botSuggestion']?.(payload('red'));
        expect(mockState.botSuggestions).toEqual(SUGGESTIONS);
        expect(mockState.botSuggestionAdvisor).toBe('Greedy Bot');
        expect(mockState.pendingBotSuggestion).toBeNull();
        expect(renderBotSuggestions).toHaveBeenCalled();
    });

    it("never stashes the other team's suggestions, resync or not", () => {
        mockState.resyncInProgress = true;
        mockState.playerTeam = 'blue';
        eventHandlers['botSuggestion']?.(payload('red'));
        expect(mockState.pendingBotSuggestion).toBeNull();
    });
});
