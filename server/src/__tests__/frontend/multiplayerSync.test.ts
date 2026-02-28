/**
 * Frontend MultiplayerSync Module Tests
 *
 * Tests the ACTUAL sync/cleanup functions from src/frontend/multiplayerSync.ts.
 * All dependencies are mocked to isolate the module under test.
 *
 * Test environment: jsdom (provides window, document, URLSearchParams).
 */

// Mock all dependencies before importing the module under test
jest.mock('../../frontend/state', () => ({
    state: {
        isMultiplayerMode: false,
        multiplayerListenersSetup: false,
        currentRoomId: null,
        isHost: false,
        resyncInProgress: false,
        boardInitialized: false,
        multiplayerPlayers: [],
        roleChange: { phase: 'idle' },
        revealTimeouts: new Map(),
        revealingCards: new Set(),
        isRevealingCard: false,
        playerTeam: null,
        spymasterTeam: null,
        clickerTeam: null,
        gameState: {
            words: [], types: [], revealed: [],
            currentTurn: 'red', redScore: 0, blueScore: 0,
            redTotal: 9, blueTotal: 8,
            gameOver: false, winner: null, seed: null,
            currentClue: null, guessesUsed: 0, guessesAllowed: 0,
            status: 'waiting', duetTypes: [],
            timerTokens: 0, greenFound: 0, greenTotal: 0
        },
        gameMode: 'classic',
        teamNames: { red: 'Red', blue: 'Blue' },
        currentReplayData: null,
        currentReplayIndex: -1,
        replayPlaying: false,
        replayInterval: null,
        cachedElements: {
            board: null, roleBanner: null, turnIndicator: null,
            endTurnBtn: null, spymasterBtn: null, clickerBtn: null,
            redTeamBtn: null, blueTeamBtn: null, spectateBtn: null,
            redRemaining: null, blueRemaining: null,
            redTeamName: null, blueTeamName: null,
            srAnnouncements: null, timerDisplay: null, timerValue: null
        },
        clickerTeam: null
    }
}));
jest.mock('../../frontend/board', () => ({
    renderBoard: jest.fn(),
    detachResizeListener: jest.fn()
}));
jest.mock('../../frontend/game', () => ({
    updateScoreboard: jest.fn(),
    updateTurnIndicator: jest.fn()
}));
jest.mock('../../frontend/roles', () => ({
    updateRoleBanner: jest.fn(),
    updateControls: jest.fn(),
    clearRoleChange: jest.fn()
}));
jest.mock('../../frontend/timer', () => ({
    handleTimerStopped: jest.fn()
}));
jest.mock('../../frontend/notifications', () => ({
    setTabNotification: jest.fn()
}));
jest.mock('../../frontend/multiplayerUI', () => ({
    updateMpIndicator: jest.fn(),
    updateForfeitButton: jest.fn(),
    updateRoomSettingsNavVisibility: jest.fn(),
    hideReconnectionOverlay: jest.fn(),
    updateDuetUI: jest.fn()
}));
jest.mock('../../frontend/chat', () => ({
    updateChatForRole: jest.fn()
}));
jest.mock('../../frontend/stateMutations', () => ({
    setPlayerRole: jest.fn(),
    clearPlayerRole: jest.fn(),
    resetGameState: jest.fn(),
    validateTurn: jest.fn((v: string, fb: string) => (v === 'red' || v === 'blue') ? v : fb),
    validateWinner: jest.fn((v: string | null) => (v === 'red' || v === 'blue') ? v : null),
    validateGameMode: jest.fn((v: string) => (v === 'classic' || v === 'blitz' || v === 'duet') ? v : 'classic'),
    validateArrayLength: jest.fn((_name: string, arr: unknown[], len: number) => arr?.length === len)
}));
jest.mock('../../frontend/clientAccessor', () => ({
    getClient: jest.fn(() => null),
    isClientConnected: jest.fn(() => false)
}));
jest.mock('../../frontend/accessibility', () => ({
    removeKeyboardShortcuts: jest.fn()
}));
jest.mock('../../frontend/logger', () => ({
    logger: { warn: jest.fn(), error: jest.fn(), debug: jest.fn(), info: jest.fn() }
}));

import { state } from '../../frontend/state';
import { setPlayerRole, clearPlayerRole } from '../../frontend/stateMutations';
import { handleTimerStopped } from '../../frontend/timer';
import { clearRoleChange } from '../../frontend/roles';
import {
    detectOfflineChanges,
    resetMultiplayerState,
    syncLocalPlayerState,
    syncGameStateFromServer,
    leaveMultiplayerMode,
    cleanupMultiplayerListeners,
    getRoomCodeFromURL,
    clearRoomCodeFromURL,
    updateURLWithRoomCode,
    cleanupDOMListeners,
    domListenerCleanup,
    multiplayerEventNames
} from '../../frontend/multiplayerSync';
import type { ReconnectionData, ServerPlayerData } from '../../frontend/multiplayerTypes';

// Helper to reset mocked state between tests
function resetMockedState(): void {
    state.isMultiplayerMode = false;
    state.multiplayerListenersSetup = false;
    state.currentRoomId = null;
    state.isHost = false;
    state.resyncInProgress = false;
    state.boardInitialized = false;
    state.multiplayerPlayers = [];
    state.roleChange = { phase: 'idle' };
    state.revealTimeouts = new Map();
    state.revealingCards = new Set();
    state.isRevealingCard = false;
    state.playerTeam = null;
    state.spymasterTeam = null;
    state.clickerTeam = null;
    state.gameState = {
        words: [], types: [], revealed: [],
        currentTurn: 'red', redScore: 0, blueScore: 0,
        redTotal: 9, blueTotal: 8,
        gameOver: false, winner: null, seed: null,
        currentClue: null, guessesUsed: 0, guessesAllowed: 0,
        status: 'waiting', duetTypes: [],
        timerTokens: 0, greenFound: 0, greenTotal: 0
    } as typeof state.gameState;
    state.gameMode = 'classic';
    state.teamNames = { red: 'Red', blue: 'Blue' };
}

describe('multiplayerSync', () => {
    beforeEach(() => {
        resetMockedState();
        jest.clearAllMocks();
        // Reset URL to a clean state
        window.history.replaceState({}, '', 'http://localhost/');
    });

    // ─── detectOfflineChanges ───────────────────────────────────────

    describe('detectOfflineChanges', () => {
        it('detects that a game was started while offline', () => {
            // Local state has no words (no game in progress)
            state.gameState.words = [];

            const data: ReconnectionData = {
                game: {
                    words: ['APPLE', 'BANANA', 'CHERRY'],
                    types: ['red', 'blue', 'neutral'],
                    revealed: [false, false, false]
                }
            };

            const changes = detectOfflineChanges(data);
            expect(changes).toContain('A game was started');
        });

        it('detects that the game ended while offline with a winner', () => {
            // Local state: game is in progress
            state.gameState.gameOver = false;
            state.teamNames = { red: 'Red', blue: 'Blue' };

            const data: ReconnectionData = {
                game: {
                    gameOver: true,
                    winner: 'red'
                }
            };

            const changes = detectOfflineChanges(data);
            expect(changes).toEqual(
                expect.arrayContaining([expect.stringContaining('Red won')])
            );
        });

        it('detects game ended without a specific winner', () => {
            state.gameState.gameOver = false;

            const data: ReconnectionData = {
                game: {
                    gameOver: true,
                    winner: null
                }
            };

            const changes = detectOfflineChanges(data);
            expect(changes).toContain('Game over');
        });

        it('detects that the turn changed while offline', () => {
            state.gameState.currentTurn = 'red';
            state.teamNames = { red: 'Red', blue: 'Blue' };

            const data: ReconnectionData = {
                game: {
                    currentTurn: 'blue',
                    gameOver: false
                }
            };

            const changes = detectOfflineChanges(data);
            expect(changes).toEqual(
                expect.arrayContaining([expect.stringContaining("Blue's turn")])
            );
        });

        it('does not report turn change when game is over', () => {
            state.gameState.currentTurn = 'red';

            const data: ReconnectionData = {
                game: {
                    currentTurn: 'blue',
                    gameOver: true
                }
            };

            const changes = detectOfflineChanges(data);
            // Should not contain a turn change message (game over takes precedence)
            const turnMessages = changes.filter(c => c.includes('turn'));
            expect(turnMessages).toHaveLength(0);
        });

        it('detects that players joined while offline', () => {
            state.multiplayerPlayers = [
                { sessionId: 'p1', nickname: 'Alice', team: null, role: null, isHost: true, connected: true }
            ] as ServerPlayerData[];

            const data: ReconnectionData = {
                players: [
                    { sessionId: 'p1', nickname: 'Alice', team: null, role: null, isHost: true, connected: true },
                    { sessionId: 'p2', nickname: 'Bob', team: null, role: null, isHost: false, connected: true },
                    { sessionId: 'p3', nickname: 'Carol', team: null, role: null, isHost: false, connected: true }
                ]
            };

            const changes = detectOfflineChanges(data);
            expect(changes).toContain('2 players joined');
        });

        it('detects that a single player joined (singular form)', () => {
            state.multiplayerPlayers = [
                { sessionId: 'p1', nickname: 'Alice', team: null, role: null, isHost: true, connected: true }
            ] as ServerPlayerData[];

            const data: ReconnectionData = {
                players: [
                    { sessionId: 'p1', nickname: 'Alice', team: null, role: null, isHost: true, connected: true },
                    { sessionId: 'p2', nickname: 'Bob', team: null, role: null, isHost: false, connected: true }
                ]
            };

            const changes = detectOfflineChanges(data);
            expect(changes).toContain('1 player joined');
        });

        it('detects that players left while offline', () => {
            state.multiplayerPlayers = [
                { sessionId: 'p1', nickname: 'Alice', team: null, role: null, isHost: true, connected: true },
                { sessionId: 'p2', nickname: 'Bob', team: null, role: null, isHost: false, connected: true },
                { sessionId: 'p3', nickname: 'Carol', team: null, role: null, isHost: false, connected: true }
            ] as ServerPlayerData[];

            const data: ReconnectionData = {
                players: [
                    { sessionId: 'p1', nickname: 'Alice', team: null, role: null, isHost: true, connected: true }
                ]
            };

            const changes = detectOfflineChanges(data);
            expect(changes).toContain('2 players left');
        });

        it('returns empty array when data is null/undefined', () => {
            const changes = detectOfflineChanges(null as unknown as ReconnectionData);
            expect(changes).toEqual([]);
        });

        it('returns empty array when nothing changed', () => {
            state.gameState.currentTurn = 'red';
            state.gameState.gameOver = false;
            state.gameState.words = ['APPLE'];
            state.multiplayerPlayers = [
                { sessionId: 'p1', nickname: 'Alice', team: null, role: null, isHost: true, connected: true }
            ] as ServerPlayerData[];

            const data: ReconnectionData = {
                game: {
                    currentTurn: 'red',
                    gameOver: false,
                    words: ['APPLE']
                },
                players: [
                    { sessionId: 'p1', nickname: 'Alice', team: null, role: null, isHost: true, connected: true }
                ]
            };

            const changes = detectOfflineChanges(data);
            expect(changes).toEqual([]);
        });

        it('returns empty array when data has no game or players', () => {
            const data: ReconnectionData = {};
            const changes = detectOfflineChanges(data);
            expect(changes).toEqual([]);
        });
    });

    // ─── resetMultiplayerState ──────────────────────────────────────

    describe('resetMultiplayerState', () => {
        it('clears reveal timeouts', () => {
            const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');
            const timeout1 = setTimeout(() => {}, 1000) as unknown as number;
            const timeout2 = setTimeout(() => {}, 2000) as unknown as number;
            state.revealTimeouts.set(0, timeout1);
            state.revealTimeouts.set(1, timeout2);

            resetMultiplayerState();

            expect(clearTimeoutSpy).toHaveBeenCalledWith(timeout1);
            expect(clearTimeoutSpy).toHaveBeenCalledWith(timeout2);
            expect(state.revealTimeouts.size).toBe(0);

            clearTimeoutSpy.mockRestore();
        });

        it('clears revealingCards set', () => {
            state.revealingCards.add(0);
            state.revealingCards.add(5);

            resetMultiplayerState();

            expect(state.revealingCards.size).toBe(0);
        });

        it('resets isRevealingCard flag', () => {
            state.isRevealingCard = true;

            resetMultiplayerState();

            expect(state.isRevealingCard).toBe(false);
        });

        it('resets isHost flag', () => {
            state.isHost = true;

            resetMultiplayerState();

            expect(state.isHost).toBe(false);
        });

        it('resets resyncInProgress flag', () => {
            state.resyncInProgress = true;

            resetMultiplayerState();

            expect(state.resyncInProgress).toBe(false);
        });

        it('resets boardInitialized flag', () => {
            state.boardInitialized = true;

            resetMultiplayerState();

            expect(state.boardInitialized).toBe(false);
        });

        it('clears multiplayer players list', () => {
            state.multiplayerPlayers = [
                { sessionId: 'p1', nickname: 'Alice', team: null, role: null, isHost: true, connected: true }
            ] as ServerPlayerData[];

            resetMultiplayerState();

            expect(state.multiplayerPlayers).toEqual([]);
        });

        it('calls clearPlayerRole', () => {
            resetMultiplayerState();
            expect(clearPlayerRole).toHaveBeenCalled();
        });

        it('calls clearRoleChange', () => {
            resetMultiplayerState();
            expect(clearRoleChange).toHaveBeenCalled();
        });

        it('calls handleTimerStopped to stop ghost ticks', () => {
            resetMultiplayerState();
            expect(handleTimerStopped).toHaveBeenCalled();
        });
    });

    // ─── syncLocalPlayerState ───────────────────────────────────────

    describe('syncLocalPlayerState', () => {
        it('calls setPlayerRole with the player role and team', () => {
            const player: ServerPlayerData = {
                sessionId: 'p1',
                nickname: 'Alice',
                team: 'red',
                role: 'spymaster',
                isHost: true,
                connected: true
            };

            syncLocalPlayerState(player);

            expect(setPlayerRole).toHaveBeenCalledWith('spymaster', 'red');
            const { updateChatForRole } = require('../../frontend/chat');
            expect(updateChatForRole).toHaveBeenCalled();
        });

        it('calls setPlayerRole with null team', () => {
            const player: ServerPlayerData = {
                sessionId: 'p1',
                nickname: 'Bob',
                team: null,
                role: 'guesser',
                isHost: false,
                connected: true
            };

            syncLocalPlayerState(player);

            expect(setPlayerRole).toHaveBeenCalledWith('guesser', null);
        });

        it('handles null player gracefully (no-op)', () => {
            syncLocalPlayerState(null as unknown as ServerPlayerData);

            expect(setPlayerRole).not.toHaveBeenCalled();
        });

        it('handles undefined player gracefully (no-op)', () => {
            syncLocalPlayerState(undefined as unknown as ServerPlayerData);

            expect(setPlayerRole).not.toHaveBeenCalled();
        });
    });

    // ─── URL manipulation ───────────────────────────────────────────

    describe('getRoomCodeFromURL', () => {
        it('returns room code from "room" query parameter', () => {
            window.history.replaceState({}, '', 'http://localhost/?room=ABCD');

            expect(getRoomCodeFromURL()).toBe('ABCD');
        });

        it('returns room code from "join" query parameter', () => {
            window.history.replaceState({}, '', 'http://localhost/?join=EFGH');

            expect(getRoomCodeFromURL()).toBe('EFGH');
        });

        it('prefers "room" over "join" when both are present', () => {
            window.history.replaceState({}, '', 'http://localhost/?room=FIRST&join=SECOND');

            expect(getRoomCodeFromURL()).toBe('FIRST');
        });

        it('returns null when no room-related query parameters exist', () => {
            window.history.replaceState({}, '', 'http://localhost/');

            expect(getRoomCodeFromURL()).toBeNull();
        });

        it('returns null when URL has unrelated query params', () => {
            window.history.replaceState({}, '', 'http://localhost/?game=123&mode=classic');

            expect(getRoomCodeFromURL()).toBeNull();
        });
    });

    describe('clearRoomCodeFromURL', () => {
        it('removes "room" query parameter from URL', () => {
            window.history.replaceState({}, '', 'http://localhost/?room=ABCD');

            clearRoomCodeFromURL();

            const params = new URLSearchParams(window.location.search);
            expect(params.has('room')).toBe(false);
        });

        it('removes "join" query parameter from URL', () => {
            window.history.replaceState({}, '', 'http://localhost/?join=EFGH');

            clearRoomCodeFromURL();

            const params = new URLSearchParams(window.location.search);
            expect(params.has('join')).toBe(false);
        });

        it('preserves other query parameters', () => {
            window.history.replaceState({}, '', 'http://localhost/?room=ABCD&other=value');

            clearRoomCodeFromURL();

            const params = new URLSearchParams(window.location.search);
            expect(params.has('room')).toBe(false);
            expect(params.get('other')).toBe('value');
        });

        it('is a no-op when there are no room params', () => {
            window.history.replaceState({}, '', 'http://localhost/?other=value');

            clearRoomCodeFromURL();

            const params = new URLSearchParams(window.location.search);
            expect(params.get('other')).toBe('value');
        });
    });

    describe('updateURLWithRoomCode', () => {
        it('adds room code to URL', () => {
            window.history.replaceState({}, '', 'http://localhost/');

            updateURLWithRoomCode('WXYZ');

            const params = new URLSearchParams(window.location.search);
            expect(params.get('room')).toBe('WXYZ');
        });

        it('replaces existing room code', () => {
            window.history.replaceState({}, '', 'http://localhost/?room=OLD');

            updateURLWithRoomCode('NEW');

            const params = new URLSearchParams(window.location.search);
            expect(params.get('room')).toBe('NEW');
        });

        it('removes standalone game parameters (game, r, t, w)', () => {
            window.history.replaceState({}, '', 'http://localhost/?game=abc&r=1&t=2&w=3');

            updateURLWithRoomCode('ROOM1');

            const params = new URLSearchParams(window.location.search);
            expect(params.get('room')).toBe('ROOM1');
            expect(params.has('game')).toBe(false);
            expect(params.has('r')).toBe(false);
            expect(params.has('t')).toBe(false);
            expect(params.has('w')).toBe(false);
        });

        it('is a no-op when roomCode is empty', () => {
            window.history.replaceState({}, '', 'http://localhost/?existing=keep');

            updateURLWithRoomCode('');

            const params = new URLSearchParams(window.location.search);
            expect(params.has('room')).toBe(false);
            expect(params.get('existing')).toBe('keep');
        });
    });

    // ─── cleanupMultiplayerListeners ─────────────────────────────────

    describe('cleanupMultiplayerListeners', () => {
        it('removes all multiplayer event listeners from client', () => {
            const offFn = jest.fn();
            const { getClient } = require('../../frontend/clientAccessor');
            (getClient as jest.Mock).mockReturnValue({ off: offFn });

            cleanupMultiplayerListeners();

            // Should call off() for each event name
            multiplayerEventNames.forEach(eventName => {
                expect(offFn).toHaveBeenCalledWith(eventName);
            });
            expect(state.multiplayerListenersSetup).toBe(false);
        });

        it('handles null client gracefully', () => {
            const { getClient } = require('../../frontend/clientAccessor');
            (getClient as jest.Mock).mockReturnValue(null);

            expect(() => cleanupMultiplayerListeners()).not.toThrow();
            expect(state.multiplayerListenersSetup).toBe(false);
        });
    });

    // ─── leaveMultiplayerMode ─────────────────────────────────────

    describe('leaveMultiplayerMode', () => {
        it('resets multiplayer mode and room state', () => {
            state.isMultiplayerMode = true;
            state.currentRoomId = 'ROOM1';

            const { getClient, isClientConnected } = require('../../frontend/clientAccessor');
            (isClientConnected as jest.Mock).mockReturnValue(false);
            (getClient as jest.Mock).mockReturnValue(null);

            leaveMultiplayerMode();

            expect(state.isMultiplayerMode).toBe(false);
            expect(state.currentRoomId).toBeNull();
        });

        it('calls leaveRoom when connected', () => {
            const leaveRoom = jest.fn();
            const { getClient, isClientConnected } = require('../../frontend/clientAccessor');
            (isClientConnected as jest.Mock).mockReturnValue(true);
            (getClient as jest.Mock).mockReturnValue({ leaveRoom, off: jest.fn() });

            leaveMultiplayerMode();

            expect(leaveRoom).toHaveBeenCalled();
        });

        it('resets replay state', () => {
            state.currentReplayData = { id: 'r1' } as any;
            state.currentReplayIndex = 5;
            state.replayPlaying = true;
            state.replayInterval = setInterval(() => {}, 1000) as any;

            const { isClientConnected, getClient } = require('../../frontend/clientAccessor');
            (isClientConnected as jest.Mock).mockReturnValue(false);
            (getClient as jest.Mock).mockReturnValue(null);

            leaveMultiplayerMode();

            expect(state.currentReplayData).toBeNull();
            expect(state.currentReplayIndex).toBe(-1);
            expect(state.replayPlaying).toBe(false);
            expect(state.replayInterval).toBeNull();
        });

        it('resets boardInitialized', () => {
            state.boardInitialized = true;

            const { isClientConnected, getClient } = require('../../frontend/clientAccessor');
            (isClientConnected as jest.Mock).mockReturnValue(false);
            (getClient as jest.Mock).mockReturnValue(null);

            leaveMultiplayerMode();

            expect(state.boardInitialized).toBe(false);
        });
    });

    // ─── syncGameStateFromServer ──────────────────────────────────

    describe('syncGameStateFromServer', () => {
        it('syncs words, types, and revealed arrays', () => {
            const serverGame = {
                words: ['A', 'B', 'C'],
                types: ['red', 'blue', 'neutral'],
                revealed: [false, true, false],
                currentTurn: 'blue'
            };

            syncGameStateFromServer(serverGame as any);

            expect(state.gameState.words).toEqual(['A', 'B', 'C']);
            expect(state.gameState.types).toEqual(['red', 'blue', 'neutral']);
            expect(state.gameState.revealed).toEqual([false, true, false]);
        });

        it('syncs scores when provided', () => {
            const serverGame = {
                words: ['A', 'B'],
                types: ['red', 'blue'],
                revealed: [false, false],
                redScore: 3,
                blueScore: 5,
                redTotal: 9,
                blueTotal: 8
            };

            syncGameStateFromServer(serverGame as any);

            expect(state.gameState.redScore).toBe(3);
            expect(state.gameState.blueScore).toBe(5);
            expect(state.gameState.redTotal).toBe(9);
            expect(state.gameState.blueTotal).toBe(8);
        });

        it('syncs game over state', () => {
            const serverGame = {
                words: ['A'],
                types: ['red'],
                revealed: [true],
                gameOver: true,
                winner: 'red'
            };

            syncGameStateFromServer(serverGame as any);

            expect(state.gameState.gameOver).toBe(true);
            expect(state.gameState.winner).toBe('red');
        });

        it('clears game over when not over', () => {
            state.gameState.gameOver = true;
            state.gameState.winner = 'red' as any;

            const serverGame = {
                words: ['A'],
                types: ['red'],
                revealed: [false]
            };

            syncGameStateFromServer(serverGame as any);

            expect(state.gameState.gameOver).toBe(false);
            expect(state.gameState.winner).toBeNull();
        });

        it('syncs seed', () => {
            syncGameStateFromServer({ words: ['A'], types: ['r'], revealed: [false], seed: 12345 } as any);
            expect(state.gameState.seed).toBe(12345);
        });

        it('syncs clue state', () => {
            syncGameStateFromServer({
                words: ['A'], types: ['r'], revealed: [false],
                currentClue: { word: 'fruit', number: 3 }
            } as any);
            expect(state.gameState.currentClue).toEqual({ word: 'fruit', number: 3 });
        });

        it('syncs guess tracking state', () => {
            syncGameStateFromServer({
                words: ['A'], types: ['r'], revealed: [false],
                guessesUsed: 2, guessesAllowed: 4
            } as any);
            expect(state.gameState.guessesUsed).toBe(2);
            expect(state.gameState.guessesAllowed).toBe(4);
        });

        it('syncs duet mode fields', () => {
            syncGameStateFromServer({
                words: ['A'], types: ['r'], revealed: [false],
                duetTypes: ['green', 'black', 'neutral'],
                timerTokens: 7,
                greenFound: 5,
                greenTotal: 15,
                gameMode: 'duet'
            } as any);

            expect(state.gameState.duetTypes).toEqual(['green', 'black', 'neutral']);
            expect(state.gameState.timerTokens).toBe(7);
            expect(state.gameState.greenFound).toBe(5);
            expect(state.gameState.greenTotal).toBe(15);
            expect(state.gameMode).toBe('duet');
        });

        it('rejects oversized words array', () => {
            const oversizedWords = Array(200).fill('WORD');
            const { logger } = require('../../frontend/logger');

            syncGameStateFromServer({
                words: oversizedWords,
                types: Array(200).fill('red'),
                revealed: Array(200).fill(false)
            } as any);

            expect(logger.error).toHaveBeenCalledWith(
                expect.stringContaining('rejected oversized words array')
            );
        });

        it('handles null serverGame gracefully', () => {
            expect(() => syncGameStateFromServer(null as any)).not.toThrow();
        });

        it('handles undefined serverGame gracefully', () => {
            expect(() => syncGameStateFromServer(undefined as any)).not.toThrow();
        });

        it('force re-renders board when words change', () => {
            state.gameState.words = ['OLD'];
            state.boardInitialized = true;

            syncGameStateFromServer({
                words: ['NEW'],
                types: ['red'],
                revealed: [false]
            } as any);

            expect(state.boardInitialized).toBe(false);
        });
    });

    // ─── cleanupDOMListeners ────────────────────────────────────────

    describe('cleanupDOMListeners', () => {
        it('removes all tracked DOM event listeners', () => {
            const el1 = document.createElement('div');
            const el2 = document.createElement('button');
            const handler1 = jest.fn();
            const handler2 = jest.fn();
            const removeSpy1 = jest.spyOn(el1, 'removeEventListener');
            const removeSpy2 = jest.spyOn(el2, 'removeEventListener');

            domListenerCleanup.push(
                { element: el1, event: 'click', handler: handler1 },
                { element: el2, event: 'keydown', handler: handler2, options: true }
            );

            cleanupDOMListeners();

            expect(removeSpy1).toHaveBeenCalledWith('click', handler1, undefined);
            expect(removeSpy2).toHaveBeenCalledWith('keydown', handler2, true);
        });

        it('clears the domListenerCleanup array after cleanup', () => {
            const el = document.createElement('div');
            domListenerCleanup.push({ element: el, event: 'click', handler: jest.fn() });

            cleanupDOMListeners();

            expect(domListenerCleanup).toHaveLength(0);
        });

        it('handles empty array gracefully', () => {
            // Ensure it is empty
            domListenerCleanup.length = 0;

            expect(() => cleanupDOMListeners()).not.toThrow();
            expect(domListenerCleanup).toHaveLength(0);
        });

        it('handles errors from removed elements without throwing', () => {
            // Create an element whose removeEventListener throws
            const el = document.createElement('div');
            jest.spyOn(el, 'removeEventListener').mockImplementation(() => {
                throw new Error('Element removed from DOM');
            });

            domListenerCleanup.push({ element: el, event: 'click', handler: jest.fn() });

            // Should not throw
            expect(() => cleanupDOMListeners()).not.toThrow();
            expect(domListenerCleanup).toHaveLength(0);
        });
    });

    // ─── multiplayerEventNames ──────────────────────────────────────

    describe('multiplayerEventNames', () => {
        it('is an array of strings', () => {
            expect(Array.isArray(multiplayerEventNames)).toBe(true);
            multiplayerEventNames.forEach(name => {
                expect(typeof name).toBe('string');
            });
        });

        it('contains core game events', () => {
            expect(multiplayerEventNames).toContain('gameStarted');
            expect(multiplayerEventNames).toContain('cardRevealed');
            expect(multiplayerEventNames).toContain('turnEnded');
            expect(multiplayerEventNames).toContain('gameOver');
        });

        it('contains player events', () => {
            expect(multiplayerEventNames).toContain('playerJoined');
            expect(multiplayerEventNames).toContain('playerLeft');
            expect(multiplayerEventNames).toContain('playerDisconnected');
            expect(multiplayerEventNames).toContain('playerReconnected');
            expect(multiplayerEventNames).toContain('playerUpdated');
        });

        it('contains timer events', () => {
            expect(multiplayerEventNames).toContain('timerStatus');
            expect(multiplayerEventNames).toContain('timerStarted');
            expect(multiplayerEventNames).toContain('timerStopped');
            expect(multiplayerEventNames).toContain('timerExpired');
        });

        it('contains connection-related events', () => {
            expect(multiplayerEventNames).toContain('disconnected');
            expect(multiplayerEventNames).toContain('roomResynced');
            expect(multiplayerEventNames).toContain('roomReconnected');
            expect(multiplayerEventNames).toContain('rejoining');
            expect(multiplayerEventNames).toContain('rejoined');
            expect(multiplayerEventNames).toContain('rejoinFailed');
        });

        it('contains room management events', () => {
            expect(multiplayerEventNames).toContain('kicked');
            expect(multiplayerEventNames).toContain('playerKicked');
            expect(multiplayerEventNames).toContain('settingsUpdated');
            expect(multiplayerEventNames).toContain('hostChanged');
            expect(multiplayerEventNames).toContain('roomWarning');
        });

        it('contains history and replay events', () => {
            expect(multiplayerEventNames).toContain('historyResult');
            expect(multiplayerEventNames).toContain('replayData');
        });

        it('contains stats and spectator events', () => {
            expect(multiplayerEventNames).toContain('statsUpdated');
            expect(multiplayerEventNames).toContain('spectatorChatMessage');
        });

        it('contains spymaster view event', () => {
            expect(multiplayerEventNames).toContain('spymasterView');
        });

        it('contains error event', () => {
            expect(multiplayerEventNames).toContain('error');
        });
    });
});
