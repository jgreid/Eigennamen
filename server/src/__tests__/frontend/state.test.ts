/**
 * Frontend State Module Tests
 *
 * Tests the ACTUAL state management functions from src/frontend/state.ts.
 * No re-implementations — imports the real code directly.
 *
 * Test environment: jsdom (provides window, document, localStorage).
 */

import {
    BOARD_SIZE,
    FIRST_TEAM_CARDS,
    SECOND_TEAM_CARDS,
    NEUTRAL_CARDS,
    ASSASSIN_CARDS,
    state,
    setState,
    logStateChange,
    getStateHistory,
    clearStateHistory,
    getStateSnapshot,
    initCachedElements
} from '../../frontend/state';

// The source module uses module-level state. We need a way to reset it between tests.
// Since `state` is an exported mutable object, we can reset its properties.
function resetState(): void {
    // Reset all properties to defaults
    state.boardInitialized = false;
    state.isMultiplayerMode = false;
    state.multiplayerPlayers = [];
    state.currentMpMode = 'join';
    state.multiplayerListenersSetup = false;
    state.currentRoomId = null;
    state.currentReplayData = null;
    state.currentReplayIndex = -1;
    state.replayPlaying = false;
    state.replayInterval = null;
    state.historyDelegationSetup = false;
    state.activeModal = null;
    state.previouslyFocusedElement = null;
    state.modalListenersActive = false;
    state.activeWords = [];
    state.wordSource = 'default';
    state.wordListMode = 'combined';
    state.teamNames = { red: 'Red', blue: 'Blue' };
    state.isHost = false;
    state.spymasterTeam = null;
    state.clickerTeam = null;
    state.playerTeam = null;
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
        customWords: false,
        currentClue: null,
        guessesUsed: 0,
    };
    state.timerState = {
        active: false,
        endTime: null,
        duration: null,
        remainingSeconds: null,
        intervalId: null,
        serverRemainingSeconds: null,
        countdownStartTime: null,
    };
    state.notificationPrefs = {
        soundEnabled: false,
        tabNotificationEnabled: false,
    };
    state.originalDocumentTitle = '';
    state.audioContext = null;
    state.newGameDebounce = false;
    state.lastRevealedIndex = -1;
    state.lastRevealedWasCorrect = false;
    state.pendingUIUpdate = false;
    state.isRevealingCard = false;
    state.copyButtonTimeoutId = null;
    state.language = 'en';
    state.localizedDefaultWords = null;
    state.colorBlindMode = false;
    state.gameMode = 'classic';
    state.cachedElements = {
        board: null,
        roleBanner: null,
        turnIndicator: null,
        endTurnBtn: null,
        spymasterBtn: null,
        clickerBtn: null,
        redTeamBtn: null,
        blueTeamBtn: null,
        spectateBtn: null,
        redRemaining: null,
        blueRemaining: null,
        redTeamName: null,
        blueTeamName: null,
        shareLink: null,
        srAnnouncements: null,
        timerDisplay: null,
        timerValue: null,
    };
}

describe('State initialization - Default values', () => {
    beforeEach(() => {
        resetState();
        clearStateHistory();
        localStorage.clear();
    });

    it('BOARD_SIZE is 25', () => {
        expect(BOARD_SIZE).toBe(25);
    });

    it('FIRST_TEAM_CARDS is 9', () => {
        expect(FIRST_TEAM_CARDS).toBe(9);
    });

    it('SECOND_TEAM_CARDS is 8', () => {
        expect(SECOND_TEAM_CARDS).toBe(8);
    });

    it('NEUTRAL_CARDS is 7', () => {
        expect(NEUTRAL_CARDS).toBe(7);
    });

    it('ASSASSIN_CARDS is 1', () => {
        expect(ASSASSIN_CARDS).toBe(1);
    });

    it('card counts add up to BOARD_SIZE', () => {
        expect(FIRST_TEAM_CARDS + SECOND_TEAM_CARDS + NEUTRAL_CARDS + ASSASSIN_CARDS).toBe(BOARD_SIZE);
    });

    it('state.gameState.currentTurn defaults to "red"', () => {
        expect(state.gameState.currentTurn).toBe('red');
    });

    it('state.isMultiplayerMode defaults to false', () => {
        expect(state.isMultiplayerMode).toBe(false);
    });

    it('state.isHost defaults to false', () => {
        expect(state.isHost).toBe(false);
    });

    it('state.gameState.gameOver defaults to false', () => {
        expect(state.gameState.gameOver).toBe(false);
    });

    it('state.gameState.winner defaults to null', () => {
        expect(state.gameState.winner).toBeNull();
    });

    it('state.gameState.seed defaults to null', () => {
        expect(state.gameState.seed).toBeNull();
    });

    it('state.gameState.redScore defaults to 0', () => {
        expect(state.gameState.redScore).toBe(0);
    });

    it('state.gameState.blueScore defaults to 0', () => {
        expect(state.gameState.blueScore).toBe(0);
    });

    it('state.gameState.redTotal defaults to 9', () => {
        expect(state.gameState.redTotal).toBe(9);
    });

    it('state.gameState.blueTotal defaults to 8', () => {
        expect(state.gameState.blueTotal).toBe(8);
    });

    it('state.gameState.words defaults to empty array', () => {
        expect(state.gameState.words).toEqual([]);
    });

    it('state.gameState.types defaults to empty array', () => {
        expect(state.gameState.types).toEqual([]);
    });

    it('state.gameState.revealed defaults to empty array', () => {
        expect(state.gameState.revealed).toEqual([]);
    });

    it('state.cachedElements properties are all null initially', () => {
        const elements = state.cachedElements;
        expect(elements.board).toBeNull();
        expect(elements.roleBanner).toBeNull();
        expect(elements.turnIndicator).toBeNull();
        expect(elements.endTurnBtn).toBeNull();
        expect(elements.spymasterBtn).toBeNull();
        expect(elements.clickerBtn).toBeNull();
        expect(elements.redTeamBtn).toBeNull();
        expect(elements.blueTeamBtn).toBeNull();
        expect(elements.spectateBtn).toBeNull();
        expect(elements.redRemaining).toBeNull();
        expect(elements.blueRemaining).toBeNull();
        expect(elements.redTeamName).toBeNull();
        expect(elements.blueTeamName).toBeNull();
        expect(elements.shareLink).toBeNull();
        expect(elements.srAnnouncements).toBeNull();
        expect(elements.timerDisplay).toBeNull();
        expect(elements.timerValue).toBeNull();
    });

    it('state.teamNames defaults to { red: "Red", blue: "Blue" }', () => {
        expect(state.teamNames).toEqual({ red: 'Red', blue: 'Blue' });
    });

    it('state.timerState.active defaults to false', () => {
        expect(state.timerState.active).toBe(false);
    });

    it('state.notificationPrefs defaults to sound and tab notifications disabled', () => {
        expect(state.notificationPrefs.soundEnabled).toBe(false);
        expect(state.notificationPrefs.tabNotificationEnabled).toBe(false);
    });

    it('state.language defaults to "en"', () => {
        expect(state.language).toBe('en');
    });

    it('state.colorBlindMode defaults to false', () => {
        expect(state.colorBlindMode).toBe(false);
    });

    it('state.gameMode defaults to "classic"', () => {
        expect(state.gameMode).toBe('classic');
    });

    it('state.currentMpMode defaults to "join"', () => {
        expect(state.currentMpMode).toBe('join');
    });

    it('state.boardInitialized defaults to false', () => {
        expect(state.boardInitialized).toBe(false);
    });

    it('state.spymasterTeam defaults to null', () => {
        expect(state.spymasterTeam).toBeNull();
    });

    it('state.clickerTeam defaults to null', () => {
        expect(state.clickerTeam).toBeNull();
    });

    it('state.playerTeam defaults to null', () => {
        expect(state.playerTeam).toBeNull();
    });

    it('state.currentRoomId defaults to null', () => {
        expect(state.currentRoomId).toBeNull();
    });

    it('state.wordSource defaults to "default"', () => {
        expect(state.wordSource).toBe('default');
    });
});

describe('setState(property, value, source)', () => {
    beforeEach(() => {
        resetState();
        clearStateHistory();
        localStorage.clear();
    });

    it('sets top-level properties', () => {
        setState('isHost', true, 'test');
        expect(state.isHost).toBe(true);
    });

    it('sets string top-level properties', () => {
        setState('language', 'fr', 'test');
        expect(state.language).toBe('fr');
    });

    it('sets boolean top-level properties to false', () => {
        state.isHost = true;
        setState('isHost', false, 'test');
        expect(state.isHost).toBe(false);
    });

    it('sets nested properties using dot notation', () => {
        setState('gameState.currentTurn', 'blue', 'test');
        expect(state.gameState.currentTurn).toBe('blue');
    });

    it('sets deeply nested properties (gameState.redScore)', () => {
        setState('gameState.redScore', 5, 'test');
        expect(state.gameState.redScore).toBe(5);
    });

    it('sets deeply nested properties (gameState.gameOver)', () => {
        setState('gameState.gameOver', true, 'test');
        expect(state.gameState.gameOver).toBe(true);
    });

    it('sets nested timerState properties', () => {
        setState('timerState.active', true, 'test');
        expect(state.timerState.active).toBe(true);
    });

    it('sets nested teamNames properties', () => {
        setState('teamNames.red', 'Crimson', 'test');
        expect(state.teamNames.red).toBe('Crimson');
    });

    it('sets nested notificationPrefs properties', () => {
        setState('notificationPrefs.soundEnabled', true, 'test');
        expect(state.notificationPrefs.soundEnabled).toBe(true);
    });

    it('sets cachedElements properties', () => {
        const el = document.createElement('div');
        setState('cachedElements.board', el, 'test');
        expect(state.cachedElements.board).toBe(el);
    });

    it('handles invalid property paths gracefully (no crash)', () => {
        expect(() => {
            setState('nonExistent.deeply.nested.property', 'value', 'test');
        }).not.toThrow();
    });

    it('handles setting null values', () => {
        setState('gameState.winner', 'red', 'test');
        expect(state.gameState.winner).toBe('red');
        setState('gameState.winner', null, 'test');
        expect(state.gameState.winner).toBeNull();
    });

    it('handles setting array values', () => {
        const words = ['APPLE', 'BANANA', 'CHERRY'];
        setState('gameState.words', words, 'test');
        expect(state.gameState.words).toEqual(words);
    });

    it('handles setting object values', () => {
        const newTeamNames = { red: 'Crimson', blue: 'Azure' };
        setState('teamNames', newTeamNames, 'test');
        expect(state.teamNames).toEqual(newTeamNames);
    });

    it('uses "unknown" as default source when not provided', () => {
        localStorage.setItem('debug', 'eigennamen');
        setState('isHost', true);
        const history = getStateHistory('isHost');
        expect(history.length).toBe(1);
        expect(history[0].source).toBe('unknown');
    });

    it('handles setting numeric values to 0', () => {
        setState('gameState.redScore', 5, 'test');
        setState('gameState.redScore', 0, 'test');
        expect(state.gameState.redScore).toBe(0);
    });
});

describe('logStateChange', () => {
    beforeEach(() => {
        resetState();
        clearStateHistory();
        localStorage.clear();
    });

    it('only logs when debug mode is enabled', () => {
        logStateChange('isHost', false, true, 'test');
        expect(getStateHistory().length).toBe(0);
    });

    it('stores history entries when debug mode is enabled', () => {
        localStorage.setItem('debug', 'eigennamen');
        logStateChange('isHost', false, true, 'test');
        expect(getStateHistory().length).toBe(1);
    });

    it('stores the correct property name', () => {
        localStorage.setItem('debug', 'eigennamen');
        logStateChange('gameState.currentTurn', 'red', 'blue', 'turnEnd');
        expect(getStateHistory()[0].property).toBe('gameState.currentTurn');
    });

    it('stores the correct old and new values', () => {
        localStorage.setItem('debug', 'eigennamen');
        logStateChange('gameState.redScore', 3, 5, 'cardReveal');
        const entry = getStateHistory()[0];
        expect(entry.oldValue).toBe(3);
        expect(entry.newValue).toBe(5);
    });

    it('stores the correct source', () => {
        localStorage.setItem('debug', 'eigennamen');
        logStateChange('isHost', false, true, 'roomCreated');
        expect(getStateHistory()[0].source).toBe('roomCreated');
    });

    it('stores a timestamp in ISO format', () => {
        localStorage.setItem('debug', 'eigennamen');
        logStateChange('isHost', false, true, 'test');
        const isoRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
        expect(getStateHistory()[0].timestamp).toMatch(isoRegex);
    });

    it('stores a stack trace string', () => {
        localStorage.setItem('debug', 'eigennamen');
        logStateChange('isHost', false, true, 'test');
        expect(typeof getStateHistory()[0].stack).toBe('string');
    });

    it('deep clones old and new values (modifying originals does not affect history)', () => {
        localStorage.setItem('debug', 'eigennamen');
        const obj = { a: 1, b: 2 };
        logStateChange('testProp', obj, { a: 3, b: 4 }, 'test');
        obj.a = 999;
        expect((getStateHistory()[0].oldValue as { a: number }).a).toBe(1);
    });

    it('caps history at 100 entries', () => {
        localStorage.setItem('debug', 'eigennamen');
        for (let i = 0; i < 110; i++) {
            logStateChange('counter', i, i + 1, 'loop');
        }
        expect(getStateHistory().length).toBe(100);
        expect(getStateHistory()[0].oldValue).toBe(10);
    });

    it('does not log when debug key has wrong value', () => {
        localStorage.setItem('debug', 'wrong-value');
        logStateChange('isHost', false, true, 'test');
        expect(getStateHistory().length).toBe(0);
    });
});

describe('setState integration with logStateChange', () => {
    beforeEach(() => {
        resetState();
        clearStateHistory();
        localStorage.clear();
    });

    it('records history when debug is enabled', () => {
        localStorage.setItem('debug', 'eigennamen');
        setState('isHost', true, 'roomCreated');
        const history = getStateHistory();
        expect(history.length).toBe(1);
        expect(history[0].property).toBe('isHost');
        expect(history[0].oldValue).toBe(false);
        expect(history[0].newValue).toBe(true);
        expect(history[0].source).toBe('roomCreated');
    });

    it('does not record history when debug is disabled', () => {
        setState('isHost', true, 'roomCreated');
        expect(getStateHistory().length).toBe(0);
    });

    it('records multiple state changes in order', () => {
        localStorage.setItem('debug', 'eigennamen');
        setState('isHost', true, 'first');
        setState('gameState.currentTurn', 'blue', 'second');
        setState('gameState.redScore', 3, 'third');
        const history = getStateHistory();
        expect(history.length).toBe(3);
        expect(history[0].property).toBe('isHost');
        expect(history[1].property).toBe('gameState.currentTurn');
        expect(history[2].property).toBe('gameState.redScore');
    });
});

describe('getStateSnapshot()', () => {
    beforeEach(() => {
        resetState();
        clearStateHistory();
        localStorage.clear();
    });

    it('returns a deep copy of the state', () => {
        const snapshot = getStateSnapshot() as typeof state;
        // Should have same values
        expect(snapshot.isHost).toBe(state.isHost);
        expect(snapshot.gameState.currentTurn).toBe(state.gameState.currentTurn);
        // But be a different reference
        expect(snapshot).not.toBe(state);
    });

    it('modifying snapshot does not affect original state', () => {
        const snapshot = getStateSnapshot() as typeof state;
        snapshot.isHost = true;
        snapshot.gameState.currentTurn = 'blue';
        snapshot.gameState.redScore = 99;
        expect(state.isHost).toBe(false);
        expect(state.gameState.currentTurn).toBe('red');
        expect(state.gameState.redScore).toBe(0);
    });

    it('reflects current state values', () => {
        setState('isHost', true, 'test');
        setState('gameState.currentTurn', 'blue', 'test');
        const snapshot = getStateSnapshot() as typeof state;
        expect(snapshot.isHost).toBe(true);
        expect(snapshot.gameState.currentTurn).toBe('blue');
    });
});

describe('getStateHistory / clearStateHistory', () => {
    beforeEach(() => {
        resetState();
        clearStateHistory();
        localStorage.clear();
    });

    it('returns empty array initially', () => {
        expect(getStateHistory()).toEqual([]);
    });

    it('returns entries after setState calls when debug is enabled', () => {
        localStorage.setItem('debug', 'eigennamen');
        setState('isHost', true, 'test');
        setState('gameState.currentTurn', 'blue', 'test');
        const history = getStateHistory();
        expect(history.length).toBe(2);
    });

    it('returns a copy of the history array (not the same reference)', () => {
        localStorage.setItem('debug', 'eigennamen');
        setState('isHost', true, 'test');
        const history1 = getStateHistory();
        const history2 = getStateHistory();
        expect(history1).not.toBe(history2);
        expect(history1).toEqual(history2);
    });

    it('filters by property name', () => {
        localStorage.setItem('debug', 'eigennamen');
        setState('isHost', true, 'test');
        setState('gameState.currentTurn', 'blue', 'test');
        setState('isHost', false, 'test');

        const hostHistory = getStateHistory('isHost');
        expect(hostHistory.length).toBe(2);
        expect(hostHistory.every((e) => e.property === 'isHost')).toBe(true);
    });

    it('returns empty array when filtering for non-existent property', () => {
        localStorage.setItem('debug', 'eigennamen');
        setState('isHost', true, 'test');
        expect(getStateHistory('nonExistentProp')).toEqual([]);
    });

    it('clearStateHistory empties the array', () => {
        localStorage.setItem('debug', 'eigennamen');
        setState('isHost', true, 'test');
        expect(getStateHistory().length).toBe(1);
        clearStateHistory();
        expect(getStateHistory()).toEqual([]);
    });

    it('after clearStateHistory, new entries can still be recorded', () => {
        localStorage.setItem('debug', 'eigennamen');
        setState('isHost', true, 'test');
        clearStateHistory();
        setState('gameState.currentTurn', 'blue', 'test');
        const history = getStateHistory();
        expect(history.length).toBe(1);
        expect(history[0].property).toBe('gameState.currentTurn');
    });
});

describe('initCachedElements()', () => {
    beforeEach(() => {
        resetState();
        clearStateHistory();
        document.body.innerHTML = '';
    });

    it('sets cachedElements from document.getElementById when elements exist', () => {
        const ids = [
            'board', 'role-banner', 'turn-indicator', 'btn-end-turn',
            'btn-spymaster', 'btn-clicker', 'btn-team-red', 'btn-team-blue',
            'btn-spectate', 'red-remaining', 'blue-remaining', 'red-team-name',
            'blue-team-name', 'share-link', 'sr-announcements', 'timer-display',
            'timer-value',
        ];
        for (const id of ids) {
            const el = document.createElement('div');
            el.id = id;
            document.body.appendChild(el);
        }

        initCachedElements();

        expect(state.cachedElements.board).toBe(document.getElementById('board'));
        expect(state.cachedElements.roleBanner).toBe(document.getElementById('role-banner'));
        expect(state.cachedElements.turnIndicator).toBe(document.getElementById('turn-indicator'));
        expect(state.cachedElements.endTurnBtn).toBe(document.getElementById('btn-end-turn'));
    });

    it('handles missing elements gracefully (returns null)', () => {
        initCachedElements();
        expect(state.cachedElements.board).toBeNull();
        expect(state.cachedElements.roleBanner).toBeNull();
    });

    it('handles partial DOM (only some elements present)', () => {
        const board = document.createElement('div');
        board.id = 'board';
        document.body.appendChild(board);

        initCachedElements();

        expect(state.cachedElements.board).toBe(board);
        expect(state.cachedElements.roleBanner).toBeNull();
    });
});
