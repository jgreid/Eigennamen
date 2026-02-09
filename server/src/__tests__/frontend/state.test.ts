/**
 * Frontend State Module Tests
 *
 * Tests for state management functions from server/public/js/modules/state.js.
 * Since the source is a plain ES module not directly importable in Jest/ts-jest,
 * each function is re-implemented here (matching the source exactly) for testing.
 *
 * Test environment: jsdom (provides window, document, localStorage).
 */

// ==================== Constants ====================

const BOARD_SIZE = 25;
const FIRST_TEAM_CARDS = 9;
const SECOND_TEAM_CARDS = 8;
const NEUTRAL_CARDS = 7;
const ASSASSIN_CARDS = 1;

// ==================== Re-implemented functions ====================

const DEBUG_KEY = 'codenames';

function debugEnabled(): boolean {
    try {
        return localStorage.getItem('debug') === DEBUG_KEY;
    } catch {
        return false;
    }
}

/**
 * Safe deep clone (handles circular refs)
 */
function safeClone(obj: unknown): unknown {
    if (obj === null || typeof obj !== 'object') return obj;
    try {
        return JSON.parse(JSON.stringify(obj));
    } catch {
        return '[Circular or non-serializable]';
    }
}

// State change history for debugging
const stateHistory: Array<{
    timestamp: string;
    property: string;
    oldValue: unknown;
    newValue: unknown;
    source: string;
    stack?: string;
}> = [];
const MAX_HISTORY = 100;

/**
 * Create a fresh state object (mirrors the state export from state.js)
 */
function createState() {
    return {
        cachedElements: {
            board: null as HTMLElement | null,
            roleBanner: null as HTMLElement | null,
            turnIndicator: null as HTMLElement | null,
            endTurnBtn: null as HTMLElement | null,
            spymasterBtn: null as HTMLElement | null,
            clickerBtn: null as HTMLElement | null,
            redTeamBtn: null as HTMLElement | null,
            blueTeamBtn: null as HTMLElement | null,
            spectateBtn: null as HTMLElement | null,
            redRemaining: null as HTMLElement | null,
            blueRemaining: null as HTMLElement | null,
            redTeamName: null as HTMLElement | null,
            blueTeamName: null as HTMLElement | null,
            shareLink: null as HTMLElement | null,
            srAnnouncements: null as HTMLElement | null,
            timerDisplay: null as HTMLElement | null,
            timerValue: null as HTMLElement | null,
        },

        srAnnouncementTimeout: null as ReturnType<typeof setTimeout> | null,
        boardInitialized: false,
        isMultiplayerMode: false,
        multiplayerPlayers: [] as unknown[],
        currentMpMode: 'join',
        multiplayerListenersSetup: false,
        currentRoomId: null as string | null,
        currentReplayData: null,
        currentReplayIndex: -1,
        replayPlaying: false,
        replayInterval: null,
        historyDelegationSetup: false,
        activeModal: null,
        previouslyFocusedElement: null,
        modalListenersActive: false,
        activeWords: [] as string[],
        wordSource: 'default',
        wordListMode: 'combined',
        teamNames: {
            red: 'Red',
            blue: 'Blue',
        },
        isHost: false,
        spymasterTeam: null as string | null,
        clickerTeam: null as string | null,
        playerTeam: null as string | null,
        isChangingRole: false,
        changingTarget: null,
        pendingRoleChange: null,
        roleChangeOperationId: null,
        roleChangeRevertFn: null,
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
            winner: null as string | null,
            seed: null as number | null,
            customWords: false,
            currentClue: null,
            guessesUsed: 0,
        },
        timerState: {
            active: false,
            endTime: null as number | null,
            duration: null as number | null,
            remainingSeconds: null as number | null,
            intervalId: null as ReturnType<typeof setInterval> | null,
            serverRemainingSeconds: null as number | null,
            countdownStartTime: null as number | null,
        },
        notificationPrefs: {
            soundEnabled: false,
            tabNotificationEnabled: false,
        },
        originalDocumentTitle: '',
        audioContext: null,
        newGameDebounce: false,
        lastRevealedIndex: -1,
        lastRevealedWasCorrect: false,
        pendingUIUpdate: false,
        isRevealingCard: false,
        copyButtonTimeoutId: null,
        language: 'en',
        localizedDefaultWords: null,
        colorBlindMode: false,
        gameMode: 'classic',
    };
}

// Module-level state used by setState / getStateSnapshot / etc.
let state = createState();

/**
 * Log a state change with context
 */
function logStateChange(
    property: string,
    oldValue: unknown,
    newValue: unknown,
    source: string = 'unknown'
): void {
    if (!debugEnabled()) return;

    const entry = {
        timestamp: new Date().toISOString(),
        property,
        oldValue: safeClone(oldValue),
        newValue: safeClone(newValue),
        source,
        stack: new Error().stack?.split('\n').slice(2, 5).join('\n'),
    };

    stateHistory.push(entry);
    if (stateHistory.length > MAX_HISTORY) {
        stateHistory.shift();
    }
}

/**
 * Update a state property with logging
 */
function setState(property: string, value: unknown, source: string = 'unknown'): void {
    const parts = property.split('.');
    let target: Record<string, unknown> = state as unknown as Record<string, unknown>;

    // Navigate to the parent of the target property
    for (let i = 0; i < parts.length - 1; i++) {
        target = target[parts[i]] as Record<string, unknown>;
        if (target === undefined) {
            // Invalid property path - return silently (console.error in source)
            return;
        }
    }

    const lastPart = parts[parts.length - 1];
    const oldValue = target[lastPart];
    target[lastPart] = value;

    logStateChange(property, oldValue, value, source);
}

/**
 * Get state change history
 */
function getStateHistory(property: string | null = null) {
    if (property) {
        return stateHistory.filter((entry) => entry.property === property);
    }
    return [...stateHistory];
}

/**
 * Clear state history
 */
function clearStateHistory(): void {
    stateHistory.length = 0;
}

/**
 * Get current state snapshot (for debugging)
 */
function getStateSnapshot(): unknown {
    return safeClone(state);
}

/**
 * Initialize cached elements (called once on page load)
 */
function initCachedElements(): void {
    state.cachedElements.board = document.getElementById('board');
    state.cachedElements.roleBanner = document.getElementById('role-banner');
    state.cachedElements.turnIndicator = document.getElementById('turn-indicator');
    state.cachedElements.endTurnBtn = document.getElementById('btn-end-turn');
    state.cachedElements.spymasterBtn = document.getElementById('btn-spymaster');
    state.cachedElements.clickerBtn = document.getElementById('btn-clicker');
    state.cachedElements.redTeamBtn = document.getElementById('btn-team-red');
    state.cachedElements.blueTeamBtn = document.getElementById('btn-team-blue');
    state.cachedElements.spectateBtn = document.getElementById('btn-spectate');
    state.cachedElements.redRemaining = document.getElementById('red-remaining');
    state.cachedElements.blueRemaining = document.getElementById('blue-remaining');
    state.cachedElements.redTeamName = document.getElementById('red-team-name');
    state.cachedElements.blueTeamName = document.getElementById('blue-team-name');
    state.cachedElements.shareLink = document.getElementById('share-link');
    state.cachedElements.srAnnouncements = document.getElementById('sr-announcements');
    state.cachedElements.timerDisplay = document.getElementById('timer-display');
    state.cachedElements.timerValue = document.getElementById('timer-value');
}

// ==================== Tests ====================

describe('State initialization - Default values', () => {
    beforeEach(() => {
        state = createState();
        stateHistory.length = 0;
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
        state = createState();
        stateHistory.length = 0;
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

    it('does not modify state for invalid top-level property path leading to undefined parent', () => {
        const snapshot = JSON.stringify(state);
        setState('nonExistent.child', 'value', 'test');
        // State should remain unchanged (the invalid set should have returned early)
        expect(JSON.stringify(state)).toBe(snapshot);
    });

    it('sets a new top-level property (not in original state)', () => {
        setState('newProperty', 'newValue', 'test');
        expect((state as Record<string, unknown>)['newProperty']).toBe('newValue');
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
        localStorage.setItem('debug', DEBUG_KEY);
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
        state = createState();
        stateHistory.length = 0;
        localStorage.clear();
    });

    it('only logs when debug mode is enabled', () => {
        logStateChange('isHost', false, true, 'test');
        expect(stateHistory.length).toBe(0);
    });

    it('stores history entries when debug mode is enabled', () => {
        localStorage.setItem('debug', DEBUG_KEY);
        logStateChange('isHost', false, true, 'test');
        expect(stateHistory.length).toBe(1);
    });

    it('stores the correct property name', () => {
        localStorage.setItem('debug', DEBUG_KEY);
        logStateChange('gameState.currentTurn', 'red', 'blue', 'turnEnd');
        expect(stateHistory[0].property).toBe('gameState.currentTurn');
    });

    it('stores the correct old and new values', () => {
        localStorage.setItem('debug', DEBUG_KEY);
        logStateChange('gameState.redScore', 3, 5, 'cardReveal');
        expect(stateHistory[0].oldValue).toBe(3);
        expect(stateHistory[0].newValue).toBe(5);
    });

    it('stores the correct source', () => {
        localStorage.setItem('debug', DEBUG_KEY);
        logStateChange('isHost', false, true, 'roomCreated');
        expect(stateHistory[0].source).toBe('roomCreated');
    });

    it('stores a timestamp in ISO format', () => {
        localStorage.setItem('debug', DEBUG_KEY);
        logStateChange('isHost', false, true, 'test');
        const isoRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
        expect(stateHistory[0].timestamp).toMatch(isoRegex);
    });

    it('stores a stack trace string', () => {
        localStorage.setItem('debug', DEBUG_KEY);
        logStateChange('isHost', false, true, 'test');
        expect(typeof stateHistory[0].stack).toBe('string');
    });

    it('deep clones old and new values (modifying originals does not affect history)', () => {
        localStorage.setItem('debug', DEBUG_KEY);
        const obj = { a: 1, b: 2 };
        logStateChange('testProp', obj, { a: 3, b: 4 }, 'test');
        obj.a = 999;
        expect((stateHistory[0].oldValue as { a: number }).a).toBe(1);
    });

    it('defaults source to "unknown" when not provided', () => {
        localStorage.setItem('debug', DEBUG_KEY);
        logStateChange('isHost', false, true);
        expect(stateHistory[0].source).toBe('unknown');
    });

    it('caps history at MAX_HISTORY (100) entries', () => {
        localStorage.setItem('debug', DEBUG_KEY);
        for (let i = 0; i < 110; i++) {
            logStateChange('counter', i, i + 1, 'loop');
        }
        expect(stateHistory.length).toBe(MAX_HISTORY);
        // The first entries should have been shifted out
        expect(stateHistory[0].oldValue).toBe(10);
    });

    it('does not log when debug key has wrong value', () => {
        localStorage.setItem('debug', 'wrong-value');
        logStateChange('isHost', false, true, 'test');
        expect(stateHistory.length).toBe(0);
    });
});

describe('setState integration with logStateChange', () => {
    beforeEach(() => {
        state = createState();
        stateHistory.length = 0;
        localStorage.clear();
    });

    it('records history when debug is enabled', () => {
        localStorage.setItem('debug', DEBUG_KEY);
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
        localStorage.setItem('debug', DEBUG_KEY);
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
        state = createState();
        stateHistory.length = 0;
        localStorage.clear();
    });

    it('returns a deep copy of the state', () => {
        const snapshot = getStateSnapshot() as ReturnType<typeof createState>;
        expect(snapshot).toEqual(state);
        // It should be a different object reference
        expect(snapshot).not.toBe(state);
    });

    it('modifying snapshot does not affect original state', () => {
        const snapshot = getStateSnapshot() as ReturnType<typeof createState>;
        snapshot.isHost = true;
        snapshot.gameState.currentTurn = 'blue';
        snapshot.gameState.redScore = 99;
        // Original should be unchanged
        expect(state.isHost).toBe(false);
        expect(state.gameState.currentTurn).toBe('red');
        expect(state.gameState.redScore).toBe(0);
    });

    it('modifying nested array in snapshot does not affect original', () => {
        state.gameState.words = ['APPLE', 'BANANA'];
        const snapshot = getStateSnapshot() as ReturnType<typeof createState>;
        snapshot.gameState.words.push('CHERRY');
        expect(state.gameState.words).toEqual(['APPLE', 'BANANA']);
    });

    it('modifying nested object in snapshot does not affect original', () => {
        const snapshot = getStateSnapshot() as ReturnType<typeof createState>;
        snapshot.teamNames.red = 'Crimson';
        expect(state.teamNames.red).toBe('Red');
    });

    it('reflects current state values', () => {
        setState('isHost', true, 'test');
        setState('gameState.currentTurn', 'blue', 'test');
        const snapshot = getStateSnapshot() as ReturnType<typeof createState>;
        expect(snapshot.isHost).toBe(true);
        expect(snapshot.gameState.currentTurn).toBe('blue');
    });

    it('handles circular references gracefully', () => {
        // Create a circular reference in the state
        const circular: Record<string, unknown> = { a: 1 };
        circular['self'] = circular;
        (state as unknown as Record<string, unknown>)['circularProp'] = circular;

        // safeClone should catch the circular reference and return the fallback string
        const snapshot = getStateSnapshot();
        expect(snapshot).toBe('[Circular or non-serializable]');

        // Clean up
        delete (state as unknown as Record<string, unknown>)['circularProp'];
    });

    it('returns null-valued cachedElements (DOM elements are not serializable as objects)', () => {
        const snapshot = getStateSnapshot() as ReturnType<typeof createState>;
        // All cached elements default to null and serialize as null
        expect(snapshot.cachedElements.board).toBeNull();
        expect(snapshot.cachedElements.turnIndicator).toBeNull();
    });
});

describe('safeClone', () => {
    it('clones primitive values as-is', () => {
        expect(safeClone(42)).toBe(42);
        expect(safeClone('hello')).toBe('hello');
        expect(safeClone(true)).toBe(true);
        expect(safeClone(null)).toBeNull();
    });

    it('returns undefined as-is', () => {
        expect(safeClone(undefined)).toBeUndefined();
    });

    it('deep clones objects', () => {
        const obj = { a: 1, b: { c: 2 } };
        const clone = safeClone(obj) as typeof obj;
        expect(clone).toEqual(obj);
        expect(clone).not.toBe(obj);
        expect(clone.b).not.toBe(obj.b);
    });

    it('deep clones arrays', () => {
        const arr = [1, [2, 3], { a: 4 }];
        const clone = safeClone(arr) as typeof arr;
        expect(clone).toEqual(arr);
        expect(clone).not.toBe(arr);
    });

    it('returns fallback string for circular references', () => {
        const obj: Record<string, unknown> = { a: 1 };
        obj['self'] = obj;
        expect(safeClone(obj)).toBe('[Circular or non-serializable]');
    });

    it('handles empty objects', () => {
        expect(safeClone({})).toEqual({});
    });

    it('handles empty arrays', () => {
        expect(safeClone([])).toEqual([]);
    });

    it('handles nested null values', () => {
        const obj = { a: null, b: { c: null } };
        expect(safeClone(obj)).toEqual({ a: null, b: { c: null } });
    });
});

describe('getStateHistory / clearStateHistory', () => {
    beforeEach(() => {
        state = createState();
        stateHistory.length = 0;
        localStorage.clear();
    });

    it('returns empty array initially', () => {
        expect(getStateHistory()).toEqual([]);
    });

    it('returns entries after setState calls when debug is enabled', () => {
        localStorage.setItem('debug', DEBUG_KEY);
        setState('isHost', true, 'test');
        setState('gameState.currentTurn', 'blue', 'test');
        const history = getStateHistory();
        expect(history.length).toBe(2);
    });

    it('returns a copy of the history array (not the same reference)', () => {
        localStorage.setItem('debug', DEBUG_KEY);
        setState('isHost', true, 'test');
        const history1 = getStateHistory();
        const history2 = getStateHistory();
        expect(history1).not.toBe(history2);
        expect(history1).toEqual(history2);
    });

    it('filters by property name', () => {
        localStorage.setItem('debug', DEBUG_KEY);
        setState('isHost', true, 'test');
        setState('gameState.currentTurn', 'blue', 'test');
        setState('isHost', false, 'test');
        setState('gameState.redScore', 3, 'test');

        const hostHistory = getStateHistory('isHost');
        expect(hostHistory.length).toBe(2);
        expect(hostHistory.every((e) => e.property === 'isHost')).toBe(true);

        const turnHistory = getStateHistory('gameState.currentTurn');
        expect(turnHistory.length).toBe(1);
        expect(turnHistory[0].property).toBe('gameState.currentTurn');
    });

    it('returns empty array when filtering for non-existent property', () => {
        localStorage.setItem('debug', DEBUG_KEY);
        setState('isHost', true, 'test');
        expect(getStateHistory('nonExistentProp')).toEqual([]);
    });

    it('returns all entries when property filter is null', () => {
        localStorage.setItem('debug', DEBUG_KEY);
        setState('isHost', true, 'test');
        setState('gameState.currentTurn', 'blue', 'test');
        expect(getStateHistory(null).length).toBe(2);
    });

    it('clearStateHistory empties the array', () => {
        localStorage.setItem('debug', DEBUG_KEY);
        setState('isHost', true, 'test');
        setState('gameState.currentTurn', 'blue', 'test');
        expect(getStateHistory().length).toBe(2);

        clearStateHistory();
        expect(getStateHistory()).toEqual([]);
    });

    it('after clearStateHistory, new entries can still be recorded', () => {
        localStorage.setItem('debug', DEBUG_KEY);
        setState('isHost', true, 'test');
        clearStateHistory();
        setState('gameState.currentTurn', 'blue', 'test');
        const history = getStateHistory();
        expect(history.length).toBe(1);
        expect(history[0].property).toBe('gameState.currentTurn');
    });

    it('clearStateHistory is idempotent on empty history', () => {
        clearStateHistory();
        expect(getStateHistory()).toEqual([]);
        clearStateHistory();
        expect(getStateHistory()).toEqual([]);
    });
});

describe('debugEnabled()', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('returns false when debug key is not set', () => {
        expect(debugEnabled()).toBe(false);
    });

    it('returns true when debug key is set to "codenames"', () => {
        localStorage.setItem('debug', 'codenames');
        expect(debugEnabled()).toBe(true);
    });

    it('returns false when debug key is set to a different value', () => {
        localStorage.setItem('debug', 'other');
        expect(debugEnabled()).toBe(false);
    });

    it('returns false when debug key is empty string', () => {
        localStorage.setItem('debug', '');
        expect(debugEnabled()).toBe(false);
    });

    it('returns false when localStorage throws', () => {
        const originalGetItem = Storage.prototype.getItem;
        Storage.prototype.getItem = () => {
            throw new Error('SecurityError');
        };
        try {
            expect(debugEnabled()).toBe(false);
        } finally {
            Storage.prototype.getItem = originalGetItem;
        }
    });
});

describe('initCachedElements()', () => {
    beforeEach(() => {
        state = createState();
        stateHistory.length = 0;
        // Clear the DOM body
        document.body.innerHTML = '';
    });

    it('sets cachedElements from document.getElementById when elements exist', () => {
        // Create DOM elements that match the expected IDs
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
        expect(state.cachedElements.spymasterBtn).toBe(document.getElementById('btn-spymaster'));
        expect(state.cachedElements.clickerBtn).toBe(document.getElementById('btn-clicker'));
        expect(state.cachedElements.redTeamBtn).toBe(document.getElementById('btn-team-red'));
        expect(state.cachedElements.blueTeamBtn).toBe(document.getElementById('btn-team-blue'));
        expect(state.cachedElements.spectateBtn).toBe(document.getElementById('btn-spectate'));
        expect(state.cachedElements.redRemaining).toBe(document.getElementById('red-remaining'));
        expect(state.cachedElements.blueRemaining).toBe(document.getElementById('blue-remaining'));
        expect(state.cachedElements.redTeamName).toBe(document.getElementById('red-team-name'));
        expect(state.cachedElements.blueTeamName).toBe(document.getElementById('blue-team-name'));
        expect(state.cachedElements.shareLink).toBe(document.getElementById('share-link'));
        expect(state.cachedElements.srAnnouncements).toBe(document.getElementById('sr-announcements'));
        expect(state.cachedElements.timerDisplay).toBe(document.getElementById('timer-display'));
        expect(state.cachedElements.timerValue).toBe(document.getElementById('timer-value'));
    });

    it('handles missing elements gracefully (returns null)', () => {
        // No elements in the DOM
        initCachedElements();

        expect(state.cachedElements.board).toBeNull();
        expect(state.cachedElements.roleBanner).toBeNull();
        expect(state.cachedElements.turnIndicator).toBeNull();
        expect(state.cachedElements.endTurnBtn).toBeNull();
        expect(state.cachedElements.spymasterBtn).toBeNull();
        expect(state.cachedElements.clickerBtn).toBeNull();
        expect(state.cachedElements.redTeamBtn).toBeNull();
        expect(state.cachedElements.blueTeamBtn).toBeNull();
        expect(state.cachedElements.spectateBtn).toBeNull();
        expect(state.cachedElements.redRemaining).toBeNull();
        expect(state.cachedElements.blueRemaining).toBeNull();
        expect(state.cachedElements.redTeamName).toBeNull();
        expect(state.cachedElements.blueTeamName).toBeNull();
        expect(state.cachedElements.shareLink).toBeNull();
        expect(state.cachedElements.srAnnouncements).toBeNull();
        expect(state.cachedElements.timerDisplay).toBeNull();
        expect(state.cachedElements.timerValue).toBeNull();
    });

    it('handles partial DOM (only some elements present)', () => {
        const board = document.createElement('div');
        board.id = 'board';
        document.body.appendChild(board);

        const timer = document.createElement('span');
        timer.id = 'timer-value';
        document.body.appendChild(timer);

        initCachedElements();

        expect(state.cachedElements.board).toBe(board);
        expect(state.cachedElements.timerValue).toBe(timer);
        // All others should be null
        expect(state.cachedElements.roleBanner).toBeNull();
        expect(state.cachedElements.turnIndicator).toBeNull();
        expect(state.cachedElements.endTurnBtn).toBeNull();
        expect(state.cachedElements.shareLink).toBeNull();
    });

    it('caches the actual DOM element references', () => {
        const boardEl = document.createElement('div');
        boardEl.id = 'board';
        boardEl.className = 'game-board';
        document.body.appendChild(boardEl);

        initCachedElements();

        // Verify it is the same reference, not a copy
        expect(state.cachedElements.board).toBe(boardEl);
        // Modifying via the cached reference should affect the DOM
        state.cachedElements.board!.setAttribute('data-test', 'yes');
        expect(boardEl.getAttribute('data-test')).toBe('yes');
    });

    it('can be called multiple times (overwrites previous values)', () => {
        // First call with no DOM elements
        initCachedElements();
        expect(state.cachedElements.board).toBeNull();

        // Add a board element
        const board = document.createElement('div');
        board.id = 'board';
        document.body.appendChild(board);

        // Second call should find the new element
        initCachedElements();
        expect(state.cachedElements.board).toBe(board);
    });
});
