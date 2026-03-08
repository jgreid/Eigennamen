/**
 * Frontend Handler Registration Tests
 *
 * Tests the event handler modules extracted from multiplayerListeners.ts.
 * Each handler module registers callbacks on the global EigennamenClient.
 */

// Mock all imported modules before any imports
jest.mock('../../frontend/state', () => ({
    state: {
        gameMode: 'match',
        isHost: false,
        isMultiplayerMode: true,
        multiplayerPlayers: [],
        multiplayerListenersSetup: false,
        currentRoomId: null,
        playerTeam: null,
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
            status: 'waiting',
            duetTypes: [],
            timerTokens: 0,
            greenFound: 0,
            greenTotal: 0,
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
    },
}));

jest.mock('../../frontend/ui', () => ({
    showToast: jest.fn(),
    announceToScreenReader: jest.fn(),
}));

jest.mock('../../frontend/board', () => ({
    renderBoard: jest.fn(),
}));

jest.mock('../../frontend/game', () => ({
    revealCardFromServer: jest.fn(),
    showGameOver: jest.fn(),
    closeGameOver: jest.fn(),
    updateTurnIndicator: jest.fn(),
}));

jest.mock('../../frontend/roles', () => ({
    updateRoleBanner: jest.fn(),
    updateControls: jest.fn(),
    clearRoleChange: jest.fn(),
    revertAndClearRoleChange: jest.fn(),
}));

jest.mock('../../frontend/notifications', () => ({
    playNotificationSound: jest.fn(),
    setTabNotification: jest.fn(),
    checkAndNotifyTurn: jest.fn(),
}));

jest.mock('../../frontend/multiplayerUI', () => ({
    updateDuetUI: jest.fn(),
    updateDuetInfoBar: jest.fn(),
    updateForfeitButton: jest.fn(),
    updateMpIndicator: jest.fn(),
    updateRoomSettingsNavVisibility: jest.fn(),
    showReconnectionOverlay: jest.fn(),
    hideReconnectionOverlay: jest.fn(),
    syncGameModeUI: jest.fn(),
    syncTurnTimerUI: jest.fn(),
    handleSpectatorChatMessage: jest.fn(),
    updateSpectatorCount: jest.fn(),
    updateRoomStats: jest.fn(),
}));

jest.mock('../../frontend/multiplayerSync', () => ({
    syncGameStateFromServer: jest.fn(),
    syncLocalPlayerState: jest.fn(),
    leaveMultiplayerMode: jest.fn(),
    detectOfflineChanges: jest.fn(() => []),
    domListenerCleanup: [],
}));

jest.mock('../../frontend/timer', () => ({
    handleTimerStarted: jest.fn(),
    handleTimerStopped: jest.fn(),
    handleTimerStatus: jest.fn(),
}));

jest.mock('../../frontend/chat', () => ({
    handleChatMessage: jest.fn(),
}));

jest.mock('../../frontend/logger', () => ({
    logger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
    },
}));

// Mock history module for dynamic import tests
const mockRenderGameHistory = jest.fn();
const mockRenderReplayData = jest.fn();
const mockOnHistoryCleared = jest.fn();
jest.mock('../../frontend/history', () => ({
    renderGameHistory: mockRenderGameHistory,
    renderReplayData: mockRenderReplayData,
    onHistoryCleared: mockOnHistoryCleared,
}));

// Set up global EigennamenClient mock
type EventHandler = (...args: any[]) => void;
const handlers: Record<string, EventHandler> = {};
const mockEigennamenClient = {
    on: jest.fn((event: string, handler: EventHandler) => {
        handlers[event] = handler;
    }),
    player: {
        sessionId: 'me-123',
        nickname: 'TestPlayer',
        isHost: false,
        team: 'red',
        role: 'clicker',
        connected: true,
    },
    getRoomCode: jest.fn(() => 'TESTROOM'),
    requestResync: jest.fn(() => Promise.resolve()),
    setRole: jest.fn(),
    updateSettings: jest.fn(),
};
(global as any).EigennamenClient = mockEigennamenClient;

import { state } from '../../frontend/state';
import { showToast, announceToScreenReader } from '../../frontend/ui';
import { renderBoard } from '../../frontend/board';
import { revealCardFromServer, showGameOver, updateTurnIndicator } from '../../frontend/game';
import { updateRoleBanner, updateControls, revertAndClearRoleChange } from '../../frontend/roles';
import { playNotificationSound, setTabNotification, checkAndNotifyTurn } from '../../frontend/notifications';
import {
    updateDuetUI,
    updateDuetInfoBar,
    updateForfeitButton,
    updateMpIndicator,
    showReconnectionOverlay,
    hideReconnectionOverlay,
    syncGameModeUI,
    updateSpectatorCount,
    updateRoomStats,
} from '../../frontend/multiplayerUI';
import {
    syncGameStateFromServer,
    syncLocalPlayerState,
    leaveMultiplayerMode,
    detectOfflineChanges,
} from '../../frontend/multiplayerSync';
import { handleTimerStarted, handleTimerStopped, handleTimerStatus } from '../../frontend/timer';
import { handleChatMessage } from '../../frontend/chat';

// Import handler registration functions
import { registerGameHandlers } from '../../frontend/handlers/gameEventHandlers';
import { registerPlayerHandlers } from '../../frontend/handlers/playerEventHandlers';
import { registerRoomHandlers } from '../../frontend/handlers/roomEventHandlers';
import { registerTimerHandlers } from '../../frontend/handlers/timerEventHandlers';
import { registerChatAndErrorHandlers } from '../../frontend/handlers/chatEventHandlers';
import { getErrorMessage } from '../../frontend/handlers/errorMessages';
import { setupMultiplayerListeners } from '../../frontend/multiplayerListeners';

describe('Frontend Handler Registration', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Reset handlers registry
        Object.keys(handlers).forEach((key) => delete handlers[key]);
        mockEigennamenClient.on.mockImplementation((event: string, handler: EventHandler) => {
            handlers[event] = handler;
        });

        // Reset state
        state.multiplayerPlayers = [];
        state.isHost = false;
        state.gameMode = 'match';
        state.isRevealingCard = false;
        state.revealingCards = new Set();
        state.revealTimeouts = new Map();
        state.revealTimestamps = new Map();
        state.roleChange = { phase: 'idle' };
        state.gameState = {
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
            status: 'waiting',
            duetTypes: [],
            timerTokens: 0,
            greenFound: 0,
            greenTotal: 0,
        };
    });

    describe('setupMultiplayerListeners', () => {
        test('registers handlers from all domain modules', () => {
            setupMultiplayerListeners();
            // Should have registered many events via EigennamenClient.on
            expect(mockEigennamenClient.on).toHaveBeenCalled();
            // Check a sample of events across domains
            const registeredEvents = mockEigennamenClient.on.mock.calls.map((c: any[]) => c[0]);
            expect(registeredEvents).toContain('gameStarted');
            expect(registeredEvents).toContain('playerJoined');
            expect(registeredEvents).toContain('hostChanged');
            expect(registeredEvents).toContain('timerStatus');
            expect(registeredEvents).toContain('chatMessage');
            expect(registeredEvents).toContain('error');
        });
    });

    describe('Game Event Handlers', () => {
        beforeEach(() => {
            registerGameHandlers();
        });

        test('registers all game events', () => {
            expect(handlers['gameStarted']).toBeDefined();
            expect(handlers['cardRevealed']).toBeDefined();
            expect(handlers['turnEnded']).toBeDefined();
            expect(handlers['gameOver']).toBeDefined();
            expect(handlers['spymasterView']).toBeDefined();
        });

        test('gameStarted syncs game state and shows toast', () => {
            const gameData = { words: ['CAT'], types: ['red'], revealed: [false] };
            handlers['gameStarted']({ game: gameData, gameMode: 'classic' });

            expect(syncGameStateFromServer).toHaveBeenCalledWith(gameData);
            expect(updateDuetUI).toHaveBeenCalledWith(gameData);
            expect(updateForfeitButton).toHaveBeenCalled();
            expect(showToast).toHaveBeenCalledWith(expect.stringContaining('New game started'), 'success', 5000);
        });

        test('gameStarted handles duet mode label', () => {
            handlers['gameStarted']({ game: { words: [] }, gameMode: 'duet' });
            expect(showToast).toHaveBeenCalledWith(expect.stringContaining('Duet'), 'success', 5000);
        });

        test('gameStarted clears new game button loading state', () => {
            const btn = document.createElement('button');
            btn.id = 'btn-new-game';
            btn.classList.add('btn-new-game');
            btn.disabled = true;
            btn.classList.add('loading');
            document.body.appendChild(btn);

            handlers['gameStarted']({ game: { words: [] }, gameMode: 'classic' });

            expect(btn.disabled).toBe(false);
            expect(btn.classList.contains('loading')).toBe(false);
            document.body.removeChild(btn);
        });

        test('gameStarted does nothing when game data is missing', () => {
            handlers['gameStarted']({});
            expect(syncGameStateFromServer).not.toHaveBeenCalled();
        });

        test('gameStarted clears stale reveal tracking from previous game', () => {
            // Simulate pending card reveals from previous game
            state.revealingCards.add(2);
            state.revealingCards.add(14);
            state.isRevealingCard = true;
            const timeoutId = setTimeout(() => {}, 10000);
            state.revealTimeouts.set(2, timeoutId);

            handlers['gameStarted']({ game: { words: ['DOG'] }, gameMode: 'classic' });

            expect(state.revealingCards.size).toBe(0);
            expect(state.isRevealingCard).toBe(false);
            expect(state.revealTimeouts.size).toBe(0);
        });

        test('cardRevealed clears revealing state for card', () => {
            state.revealingCards.add(5);
            state.isRevealingCard = true;

            handlers['cardRevealed']({ index: 5, word: 'CAT', type: 'red' });

            expect(state.revealingCards.has(5)).toBe(false);
            expect(state.isRevealingCard).toBe(false);
            expect(revealCardFromServer).toHaveBeenCalledWith(5, expect.objectContaining({ word: 'CAT' }));
            expect(playNotificationSound).toHaveBeenCalledWith('reveal');
        });

        test('cardRevealed announces to screen reader', () => {
            handlers['cardRevealed']({ index: 3, word: 'DOG', type: 'blue' });
            expect(announceToScreenReader).toHaveBeenCalledWith('Card revealed: DOG. blue card.');
        });

        test('cardRevealed updates Duet info bar when duet data present', () => {
            handlers['cardRevealed']({ index: 1, word: 'A', type: 'green', timerTokens: 5, greenFound: 3 });
            expect(updateDuetInfoBar).toHaveBeenCalledWith(3, 5);
        });

        test('cardRevealed clears timeout for revealed card', () => {
            const mockTimeout = setTimeout(() => {}, 10000);
            state.revealTimeouts.set(7, mockTimeout);

            handlers['cardRevealed']({ index: 7, word: 'TEST', type: 'red' });

            expect(state.revealTimeouts.has(7)).toBe(false);
        });

        test('turnEnded updates game state and checks notifications', () => {
            state.gameState.currentTurn = 'red';
            handlers['turnEnded']({ currentTurn: 'blue' });

            expect(state.gameState.currentTurn).toBe('blue');
            expect(state.gameState.currentClue).toBeNull();
            expect(state.gameState.guessesUsed).toBe(0);
            expect(updateTurnIndicator).toHaveBeenCalled();
            expect(updateRoleBanner).toHaveBeenCalled();
            expect(updateControls).toHaveBeenCalled();
            expect(renderBoard).toHaveBeenCalled();
            expect(checkAndNotifyTurn).toHaveBeenCalledWith('blue', 'red');
            expect(announceToScreenReader).toHaveBeenCalledWith(expect.stringContaining('Blue'));
        });

        test('turnEnded with no currentTurn does not modify state', () => {
            state.gameState.currentTurn = 'red';
            handlers['turnEnded']({});

            expect(state.gameState.currentTurn).toBe('red');
            expect(renderBoard).not.toHaveBeenCalled();
            expect(updateControls).not.toHaveBeenCalled();
        });

        test('turnEnded is skipped during resync', () => {
            state.resyncInProgress = true;
            state.gameState.currentTurn = 'red';
            handlers['turnEnded']({ currentTurn: 'blue' });

            expect(state.gameState.currentTurn).toBe('red');
            expect(renderBoard).not.toHaveBeenCalled();
            state.resyncInProgress = false;
        });

        test('turnEnded resets clue and guess state for new turn', () => {
            state.gameState.currentClue = { word: 'test', number: 3, team: 'red' };
            state.gameState.guessesUsed = 2;
            state.gameState.guessesAllowed = 4;
            handlers['turnEnded']({ currentTurn: 'blue' });

            expect(state.gameState.currentClue).toBeNull();
            expect(state.gameState.guessesUsed).toBe(0);
            expect(state.gameState.guessesAllowed).toBe(0);
        });

        test('gameOver syncs card types and shows game over screen', () => {
            handlers['gameOver']({ winner: 'red', types: ['red', 'blue', 'neutral'], reason: 'all_found' });

            expect(state.gameState.types).toEqual(['red', 'blue', 'neutral']);
            expect(state.gameState.gameOver).toBe(true);
            expect(state.gameState.winner).toBe('red');
            expect(showGameOver).toHaveBeenCalledWith('red', 'all_found');
            expect(setTabNotification).toHaveBeenCalledWith(false);
            expect(playNotificationSound).toHaveBeenCalledWith('gameOver');
        });

        test('gameOver in duet mode handles cooperative win', () => {
            state.gameMode = 'duet';
            handlers['gameOver']({ winner: null, reason: 'completed', types: [] });

            expect(showGameOver).toHaveBeenCalledWith('red', 'completed');
        });

        test('gameOver in duet mode handles cooperative loss', () => {
            state.gameMode = 'duet';
            handlers['gameOver']({ winner: null, reason: 'timer_expired', types: [] });

            expect(showGameOver).toHaveBeenCalledWith(null, 'timer_expired');
        });

        test('gameOver with null winner (abandoned) still sets gameOver state', () => {
            state.gameMode = 'classic';
            handlers['gameOver']({ winner: null, reason: 'abandoned', types: ['red', 'blue'] });

            expect(state.gameState.gameOver).toBe(true);
            expect(state.gameState.winner).toBeNull();
            expect(state.gameState.types).toEqual(['red', 'blue']);
            expect(showGameOver).toHaveBeenCalledWith(null, 'abandoned');
        });

        test('spymasterView renders board with types', () => {
            handlers['spymasterView']({ types: ['red', 'blue', 'neutral', 'assassin'] });

            expect(state.gameState.types).toEqual(['red', 'blue', 'neutral', 'assassin']);
            expect(renderBoard).toHaveBeenCalled();
        });

        test('spymasterView ignores invalid data', () => {
            const origTypes = state.gameState.types;
            handlers['spymasterView']({});
            expect(state.gameState.types).toBe(origTypes);
            expect(renderBoard).not.toHaveBeenCalled();
        });

        test('spymasterView applies cardScores for match mode', () => {
            const scores = [1, 2, 3, 0, -1];
            handlers['spymasterView']({ cardScores: scores });
            expect(state.gameState.cardScores).toEqual(scores);
            expect(renderBoard).toHaveBeenCalled();
        });

        test('spymasterView applies both types and cardScores together', () => {
            const types = ['red', 'blue', 'neutral', 'assassin', 'red'];
            const scores = [1, 2, 1, -3, 3];
            handlers['spymasterView']({ types, cardScores: scores });
            expect(state.gameState.types).toEqual(types);
            expect(state.gameState.cardScores).toEqual(scores);
            expect(renderBoard).toHaveBeenCalledTimes(1);
        });

        test('spymasterView does not overwrite cardScores when not provided', () => {
            state.gameState.cardScores = [1, 2, 3];
            handlers['spymasterView']({ types: ['red', 'blue', 'neutral'] });
            expect(state.gameState.cardScores).toEqual([1, 2, 3]);
        });
    });

    describe('Player Event Handlers', () => {
        beforeEach(() => {
            registerPlayerHandlers();
        });

        test('registers all player events', () => {
            expect(handlers['playerJoined']).toBeDefined();
            expect(handlers['playerLeft']).toBeDefined();
            expect(handlers['playerUpdated']).toBeDefined();
            expect(handlers['playerDisconnected']).toBeDefined();
            expect(handlers['playerReconnected']).toBeDefined();
        });

        test('playerJoined updates player list from full list', () => {
            const players = [{ sessionId: 'p1', nickname: 'P1' }];
            handlers['playerJoined']({ players, player: { sessionId: 'p1', nickname: 'P1' } });

            expect(state.multiplayerPlayers).toBe(players);
            expect(updateMpIndicator).toHaveBeenCalled();
            expect(showToast).toHaveBeenCalledWith('P1 joined', 'success');
            expect(playNotificationSound).toHaveBeenCalledWith('join');
        });

        test('playerJoined adds new player when full list not provided', () => {
            state.multiplayerPlayers = [{ sessionId: 'p1', nickname: 'P1' } as any];
            handlers['playerJoined']({ player: { sessionId: 'p2', nickname: 'P2' } });

            expect(state.multiplayerPlayers).toHaveLength(2);
        });

        test('playerJoined deduplicates existing players', () => {
            state.multiplayerPlayers = [{ sessionId: 'p1', nickname: 'P1' } as any];
            handlers['playerJoined']({ player: { sessionId: 'p1', nickname: 'P1' } });

            expect(state.multiplayerPlayers).toHaveLength(1);
        });

        test('playerLeft removes player by sessionId', () => {
            state.multiplayerPlayers = [
                { sessionId: 'p1', nickname: 'P1' } as any,
                { sessionId: 'p2', nickname: 'P2' } as any,
            ];
            handlers['playerLeft']({ sessionId: 'p1', nickname: 'P1' });

            expect(state.multiplayerPlayers).toHaveLength(1);
            expect(state.multiplayerPlayers[0].sessionId).toBe('p2');
            expect(showToast).toHaveBeenCalledWith('P1 left', 'info');
        });

        test('playerLeft uses full player list when provided', () => {
            const newList = [{ sessionId: 'p2', nickname: 'P2' }];
            handlers['playerLeft']({ players: newList, nickname: 'P1' });

            expect(state.multiplayerPlayers).toBe(newList);
        });

        test('playerUpdated updates player in list', () => {
            state.multiplayerPlayers = [{ sessionId: 'p1', nickname: 'P1', team: 'red', role: 'clicker' } as any];
            handlers['playerUpdated']({ sessionId: 'p1', changes: { team: 'blue' } });

            expect(state.multiplayerPlayers[0].team).toBe('blue');
            expect(updateMpIndicator).toHaveBeenCalled();
        });

        test('playerUpdated announces role change to screen reader', () => {
            state.multiplayerPlayers = [{ sessionId: 'p1', nickname: 'Alice', team: 'red', role: 'clicker' } as any];
            handlers['playerUpdated']({ sessionId: 'p1', changes: { role: 'spymaster' } });

            expect(announceToScreenReader).toHaveBeenCalledWith(expect.stringContaining('Alice'));
            expect(announceToScreenReader).toHaveBeenCalledWith(expect.stringContaining('spymaster'));
        });

        test('playerUpdated syncs local state when update is for current player (idle phase)', () => {
            // Set up current player
            mockEigennamenClient.player = {
                sessionId: 'me-123',
                nickname: 'Me',
                team: 'red',
                role: 'clicker',
                isHost: false,
                connected: true,
            } as any;
            state.multiplayerPlayers = [{ sessionId: 'me-123', nickname: 'Me', team: 'red', role: 'clicker' } as any];
            state.roleChange = { phase: 'idle' };

            handlers['playerUpdated']({ sessionId: 'me-123', changes: { team: 'blue' } });

            expect(syncLocalPlayerState).toHaveBeenCalled();
            expect(updateControls).toHaveBeenCalled();
            expect(updateRoleBanner).toHaveBeenCalled();
            expect(renderBoard).toHaveBeenCalled();
        });

        test('playerUpdated handles team_then_role phase: team confirmed, sends role', () => {
            jest.useFakeTimers();
            mockEigennamenClient.player = {
                sessionId: 'me-123',
                nickname: 'Me',
                team: 'red',
                role: 'clicker',
                isHost: false,
                connected: true,
            } as any;
            state.multiplayerPlayers = [{ sessionId: 'me-123', nickname: 'Me', team: 'red', role: 'clicker' } as any];
            state.roleChange = {
                phase: 'team_then_role',
                target: 'spymaster',
                pendingRole: 'spymaster',
                operationId: 'op-1',
            } as any;

            handlers['playerUpdated']({ sessionId: 'me-123', changes: { team: 'blue' } });

            // Should transition to changing_role and call setRole
            expect(mockEigennamenClient.setRole).toHaveBeenCalledWith('spymaster');
            expect(state.roleChange.phase).toBe('changing_role');
            jest.useRealTimers();
        });

        test('playerUpdated clears role change on confirming update', () => {
            mockEigennamenClient.player = {
                sessionId: 'me-123',
                nickname: 'Me',
                team: 'red',
                role: 'clicker',
                isHost: false,
                connected: true,
            } as any;
            state.multiplayerPlayers = [{ sessionId: 'me-123', nickname: 'Me', team: 'red', role: 'spymaster' } as any];
            state.roleChange = {
                phase: 'changing_role',
                target: 'spymaster',
                operationId: 'op-2',
            } as any;

            handlers['playerUpdated']({ sessionId: 'me-123', changes: { role: 'spymaster' } });

            // clearRoleChange should have been called (via the imported mock)
            const { clearRoleChange } = require('../../frontend/roles');
            expect(clearRoleChange).toHaveBeenCalled();
        });

        test('playerUpdated constructs player from changes when not in list (Bug #8)', () => {
            mockEigennamenClient.player = {
                sessionId: 'me-123',
                nickname: 'Me',
                team: null,
                role: null,
                isHost: false,
                connected: true,
            } as any;
            state.multiplayerPlayers = []; // player not in list
            state.roleChange = { phase: 'idle' };

            handlers['playerUpdated']({ sessionId: 'me-123', changes: { team: 'blue', role: 'clicker' } });

            // Player should have been added to the list
            expect(state.multiplayerPlayers.length).toBeGreaterThan(0);
            expect(syncLocalPlayerState).toHaveBeenCalled();
        });

        test('playerUpdated announces team change to screen reader', () => {
            state.multiplayerPlayers = [{ sessionId: 'p2', nickname: 'Bob', team: null } as any];
            handlers['playerUpdated']({ sessionId: 'p2', changes: { team: 'red' } });

            expect(announceToScreenReader).toHaveBeenCalledWith(expect.stringContaining('Bob'));
            expect(announceToScreenReader).toHaveBeenCalledWith(expect.stringContaining('Red'));
        });

        test('playerUpdated announces team removal (spectator) to screen reader', () => {
            state.multiplayerPlayers = [{ sessionId: 'p2', nickname: 'Bob', team: 'red' } as any];
            handlers['playerUpdated']({ sessionId: 'p2', changes: { team: null } });

            expect(announceToScreenReader).toHaveBeenCalledWith(expect.stringContaining('spectators'));
        });

        test('playerDisconnected marks player as disconnected', () => {
            state.multiplayerPlayers = [{ sessionId: 'p1', nickname: 'Alice', connected: true } as any];
            handlers['playerDisconnected']({ sessionId: 'p1', nickname: 'Alice' });

            expect(state.multiplayerPlayers[0].connected).toBe(false);
            expect(showToast).toHaveBeenCalledWith('Alice disconnected', 'warning');
            expect(updateControls).toHaveBeenCalled();
        });

        test('playerReconnected marks player as connected', () => {
            state.multiplayerPlayers = [{ sessionId: 'p1', nickname: 'Alice', connected: false } as any];
            handlers['playerReconnected']({ sessionId: 'p1', nickname: 'Alice' });

            expect(state.multiplayerPlayers[0].connected).toBe(true);
            expect(showToast).toHaveBeenCalledWith('Alice reconnected', 'success');
        });
    });

    describe('Room Event Handlers', () => {
        beforeEach(() => {
            registerRoomHandlers();
        });

        test('registers all room events', () => {
            expect(handlers['hostChanged']).toBeDefined();
            expect(handlers['roomWarning']).toBeDefined();
            expect(handlers['roomResynced']).toBeDefined();
            expect(handlers['disconnected']).toBeDefined();
            expect(handlers['rejoining']).toBeDefined();
            expect(handlers['rejoined']).toBeDefined();
            expect(handlers['roomReconnected']).toBeDefined();
            expect(handlers['rejoinFailed']).toBeDefined();
            expect(handlers['kicked']).toBeDefined();
            expect(handlers['playerKicked']).toBeDefined();
            expect(handlers['settingsUpdated']).toBeDefined();
            expect(handlers['statsUpdated']).toBeDefined();
        });

        test('hostChanged updates host status when becoming host', () => {
            mockEigennamenClient.player!.sessionId = 'me-123';
            handlers['hostChanged']({ newHostSessionId: 'me-123', newHostNickname: 'TestPlayer' });

            expect(state.isHost).toBe(true);
            expect(showToast).toHaveBeenCalledWith('You are now the host!', 'info');
        });

        test('hostChanged shows notification when someone else becomes host', () => {
            mockEigennamenClient.player!.sessionId = 'me-123';
            handlers['hostChanged']({ newHostSessionId: 'other-456', newHostNickname: 'OtherPlayer' });

            expect(state.isHost).toBe(false);
            expect(showToast).toHaveBeenCalledWith('OtherPlayer is now the host', 'info');
        });

        test('roomWarning triggers auto-resync on STATS_STALE', () => {
            handlers['roomWarning']({ code: 'STATS_STALE' });
            expect(mockEigennamenClient.requestResync).toHaveBeenCalled();
        });

        test('roomResynced syncs all state', () => {
            const gameData = { words: ['A'], types: ['red'] };
            const players = [{ sessionId: 'p1' }];
            handlers['roomResynced']({
                game: gameData,
                players,
                you: { sessionId: 'me', nickname: 'Me', team: 'red' },
                room: { code: 'ROOM' },
            });

            expect(syncLocalPlayerState).toHaveBeenCalled();
            expect(syncGameStateFromServer).toHaveBeenCalledWith(gameData);
            expect(state.multiplayerPlayers).toBe(players);
        });

        test('roomResynced clears stale reveal tracking', () => {
            // Simulate pending card reveals before resync
            state.revealingCards.add(3);
            state.revealingCards.add(7);
            state.isRevealingCard = true;
            const timeoutId = setTimeout(() => {}, 10000);
            state.revealTimeouts.set(3, timeoutId);

            handlers['roomResynced']({
                game: { words: ['A'] },
                players: [],
                you: { sessionId: 'me', nickname: 'Me' },
                room: { code: 'ROOM' },
            });

            expect(state.revealingCards.size).toBe(0);
            expect(state.isRevealingCard).toBe(false);
            expect(state.revealTimeouts.size).toBe(0);
        });

        test('disconnected shows toast and reconnection overlay', () => {
            state.isMultiplayerMode = true;
            handlers['disconnected']();

            expect(revertAndClearRoleChange).toHaveBeenCalled();
            expect(showToast).toHaveBeenCalledWith('Disconnected from server', 'warning');
            expect(showReconnectionOverlay).toHaveBeenCalled();
        });

        test('rejoining shows reconnection overlay', () => {
            handlers['rejoining']();
            expect(showReconnectionOverlay).toHaveBeenCalled();
        });

        test('rejoined hides overlay and shows reconnected toast', () => {
            (detectOfflineChanges as jest.Mock).mockReturnValue([]);
            handlers['rejoined']({ game: {}, players: [], room: { code: 'R' } });

            expect(hideReconnectionOverlay).toHaveBeenCalled();
            expect(showToast).toHaveBeenCalledWith('Reconnected!', 'success');
        });

        test('rejoined clears stale reveal tracking', () => {
            (detectOfflineChanges as jest.Mock).mockReturnValue([]);
            state.revealingCards.add(4);
            state.isRevealingCard = true;
            const timeoutId = setTimeout(() => {}, 10000);
            state.revealTimeouts.set(4, timeoutId);

            handlers['rejoined']({ game: {}, players: [], room: { code: 'R' } });

            expect(state.revealingCards.size).toBe(0);
            expect(state.isRevealingCard).toBe(false);
            expect(state.revealTimeouts.size).toBe(0);
        });

        test('rejoined shows changes when offline changes detected', () => {
            (detectOfflineChanges as jest.Mock).mockReturnValue(['Game ended', 'New turn']);
            handlers['rejoined']({ game: {}, players: [], room: { code: 'R' } });

            expect(showToast).toHaveBeenCalledWith(
                expect.stringContaining('Reconnected! Game ended. New turn'),
                'info',
                6000
            );
        });

        test('rejoinFailed resets multiplayer state on ROOM_NOT_FOUND', () => {
            handlers['rejoinFailed']({ error: { code: 'ROOM_NOT_FOUND', message: '' } });

            expect(hideReconnectionOverlay).toHaveBeenCalled();
            expect(showToast).toHaveBeenCalledWith('Previous game no longer exists', 'warning');
            expect(leaveMultiplayerMode).toHaveBeenCalled();
        });

        test('rejoinFailed shows generic message for other errors', () => {
            handlers['rejoinFailed']({});

            expect(showToast).toHaveBeenCalledWith('Could not rejoin previous game', 'warning');
            expect(leaveMultiplayerMode).toHaveBeenCalled();
        });

        test('rejoinFailed handles cleanup error gracefully', () => {
            (leaveMultiplayerMode as jest.Mock).mockImplementation(() => {
                throw new Error('cleanup failed');
            });
            state.isMultiplayerMode = true;

            handlers['rejoinFailed']({});

            // State should be reset even when leaveMultiplayerMode throws
            expect(state.isMultiplayerMode).toBe(false);
            expect(state.currentRoomId).toBeNull();
            expect(state.multiplayerListenersSetup).toBe(false);

            // Restore mock to default (no-op) so subsequent tests aren't affected
            (leaveMultiplayerMode as jest.Mock).mockImplementation(() => {});
        });

        test('kicked leaves multiplayer and shows reason', () => {
            handlers['kicked']({ reason: 'Kicked by host' });

            expect(leaveMultiplayerMode).toHaveBeenCalled();
            expect(showToast).toHaveBeenCalledWith('Kicked by host', 'error', 5000);
        });

        test('kicked shows default message when no reason', () => {
            handlers['kicked']({});

            expect(showToast).toHaveBeenCalledWith('You were kicked from the room', 'error', 5000);
        });

        test('playerKicked removes player from list', () => {
            state.multiplayerPlayers = [
                { sessionId: 'p1', nickname: 'Alice' } as any,
                { sessionId: 'p2', nickname: 'Bob' } as any,
            ];
            handlers['playerKicked']({ sessionId: 'p1', nickname: 'Alice' });

            expect(state.multiplayerPlayers).toHaveLength(1);
            expect(showToast).toHaveBeenCalledWith('Alice was kicked by the host', 'info');
        });

        test('settingsUpdated syncs game mode and shows toast', () => {
            handlers['settingsUpdated']({ settings: { gameMode: 'duet' } });

            expect(syncGameModeUI).toHaveBeenCalledWith('duet');
            expect(showToast).toHaveBeenCalledWith('Room settings updated', 'info');
        });

        test('settingsUpdated ignores missing settings', () => {
            handlers['settingsUpdated']({});
            expect(showToast).not.toHaveBeenCalled();
        });

        test('statsUpdated updates spectator count and room stats', () => {
            handlers['statsUpdated']({ stats: { spectatorCount: 3, redCount: 2, blueCount: 2 } });

            expect(updateSpectatorCount).toHaveBeenCalledWith(3);
            expect(updateRoomStats).toHaveBeenCalledWith({ spectatorCount: 3, redCount: 2, blueCount: 2 });
        });
    });

    describe('Timer Event Handlers', () => {
        beforeEach(() => {
            registerTimerHandlers();
        });

        test('registers all timer events', () => {
            expect(handlers['timerStatus']).toBeDefined();
            expect(handlers['timerStarted']).toBeDefined();
            expect(handlers['timerStopped']).toBeDefined();
            expect(handlers['timerExpired']).toBeDefined();
        });

        test('timerStatus delegates to handleTimerStatus', () => {
            const data = { remainingSeconds: 60 };
            handlers['timerStatus'](data);
            expect(handleTimerStatus).toHaveBeenCalledWith(data);
        });

        test('timerStarted delegates to handleTimerStarted', () => {
            const data = { duration: 120 };
            handlers['timerStarted'](data);
            expect(handleTimerStarted).toHaveBeenCalledWith(data);
        });

        test('timerStopped delegates to handleTimerStopped', () => {
            handlers['timerStopped']({});
            expect(handleTimerStopped).toHaveBeenCalled();
        });

        test('timerExpired stops timer and shows toast', () => {
            handlers['timerExpired']({});
            expect(handleTimerStopped).toHaveBeenCalled();
            expect(showToast).toHaveBeenCalledWith('Turn time expired!', 'warning');
        });
    });

    describe('Chat and Error Event Handlers', () => {
        beforeEach(() => {
            registerChatAndErrorHandlers();
        });

        test('registers all chat/error events', () => {
            expect(handlers['chatMessage']).toBeDefined();
            expect(handlers['spectatorChatMessage']).toBeDefined();
            expect(handlers['historyResult']).toBeDefined();
            expect(handlers['replayData']).toBeDefined();
            expect(handlers['historyCleared']).toBeDefined();
            expect(handlers['error']).toBeDefined();
        });

        test('chatMessage delegates to handleChatMessage', () => {
            const data = { message: 'Hello', sender: 'Alice' };
            handlers['chatMessage'](data);
            expect(handleChatMessage).toHaveBeenCalledWith(data);
        });

        test('spectatorChatMessage delegates to handleSpectatorChatMessage', () => {
            const { handleSpectatorChatMessage } = require('../../frontend/multiplayerUI');
            const data = { message: 'Hi spectators', sender: 'Bob' };
            handlers['spectatorChatMessage'](data);
            expect(handleSpectatorChatMessage).toHaveBeenCalledWith(data);
        });

        test('historyResult dynamically imports and calls renderGameHistory', async () => {
            handlers['historyResult']({ history: [{ id: 1 }] });
            // Allow the dynamic import promise chain to settle
            await new Promise((resolve) => setTimeout(resolve, 50));
            expect(mockRenderGameHistory).toHaveBeenCalledWith([{ id: 1 }]);
        });

        test('historyResult defaults to empty array when history missing', async () => {
            handlers['historyResult']({});
            await new Promise((resolve) => setTimeout(resolve, 50));
            expect(mockRenderGameHistory).toHaveBeenCalledWith([]);
        });

        test('historyResult ignores old "games" property (regression)', async () => {
            // The old bug: backend sends { history: [...] } but frontend read data.games
            // Verify that sending data with "games" but no "history" defaults to empty
            handlers['historyResult']({ games: [{ id: 'old-bug' }] } as any);
            await new Promise((resolve) => setTimeout(resolve, 50));
            expect(mockRenderGameHistory).toHaveBeenCalledWith([]);
        });

        test('historyResult with null history defaults to empty array', async () => {
            handlers['historyResult']({ history: null } as any);
            await new Promise((resolve) => setTimeout(resolve, 50));
            expect(mockRenderGameHistory).toHaveBeenCalledWith([]);
        });

        test('replayData dynamically imports and calls renderReplayData', async () => {
            const data = { replayId: '123', moves: [] };
            handlers['replayData'](data);
            await new Promise((resolve) => setTimeout(resolve, 50));
            expect(mockRenderReplayData).toHaveBeenCalledWith(data);
        });

        test('historyCleared dynamically imports and calls onHistoryCleared', async () => {
            handlers['historyCleared']({ deletedCount: 5 });
            await new Promise((resolve) => setTimeout(resolve, 50));
            expect(mockOnHistoryCleared).toHaveBeenCalled();
        });

        test('error handler clears .revealing class from cards in DOM', () => {
            const card = document.createElement('div');
            card.classList.add('card', 'revealing');
            document.body.appendChild(card);

            handlers['error']({ code: 'SERVER_ERROR', message: '' });

            expect(card.classList.contains('revealing')).toBe(false);
            document.body.removeChild(card);
        });

        test('error handler reverts role change and clears card state', () => {
            state.revealingCards.add(1);
            state.revealingCards.add(2);
            state.isRevealingCard = true;

            handlers['error']({ code: 'RATE_LIMITED', message: 'Rate limited' });

            expect(revertAndClearRoleChange).toHaveBeenCalled();
            expect(state.revealingCards.size).toBe(0);
            expect(state.isRevealingCard).toBe(false);
            expect(showToast).toHaveBeenCalledWith(
                'Too many requests \u2014 wait a few seconds and try again',
                'error'
            );
        });

        test('error handler shows user-friendly message for known codes', () => {
            handlers['error']({ code: 'NOT_YOUR_TURN', message: '' });
            expect(showToast).toHaveBeenCalledWith(
                "It's not your team's turn \u2014 wait for the other team to finish",
                'error'
            );
        });

        test('error handler falls back to original message for unknown codes', () => {
            handlers['error']({ code: 'UNKNOWN_CODE', message: 'Custom server error message' });
            expect(showToast).toHaveBeenCalledWith('Custom server error message', 'error');
        });
    });
});

describe('getErrorMessage (re-export)', () => {
    test('is exported from multiplayerListeners', () => {
        expect(typeof getErrorMessage).toBe('function');
    });
});
