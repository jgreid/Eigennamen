// ========== STATE MODULE ==========
// Mutable shared state singleton.  Types live in stateTypes.ts, constants in
// constants.ts, and debug tools in debug.ts — this file is just the data.
import { DEFAULT_WORDS } from './constants.js';
import { createStateProxy, attachDebugToWindow, debugEnabled } from './debug.js';
export { BOARD_SIZE, FIRST_TEAM_CARDS, SECOND_TEAM_CARDS, NEUTRAL_CARDS, ASSASSIN_CARDS, DEFAULT_WORDS, COPY_BUTTON_TEXT, ROLE_BANNER_CONFIG } from './constants.js';
export { logStateChange, getStateHistory, clearStateHistory, watchState } from './debug.js';
// These re-exports need the state reference curried in (debug.ts can't import
// state.ts without a circular dependency, so it takes the state as a parameter).
import { setState as _setStateImpl, getStateSnapshot as _getSnapshotImpl, dumpState as _dumpStateImpl } from './debug.js';
export function setState(property, value, source = 'unknown') {
    _setStateImpl(_rawState, property, value, source);
}
export function getStateSnapshot() {
    return _getSnapshotImpl(_rawState);
}
export function dumpState() {
    _dumpStateImpl(_rawState);
}
// ========== RAW STATE ==========
const _rawState = {
    cachedElements: {
        board: null, roleBanner: null, turnIndicator: null, endTurnBtn: null,
        spymasterBtn: null, clickerBtn: null, redTeamBtn: null, blueTeamBtn: null,
        spectateBtn: null, redRemaining: null, blueRemaining: null,
        redTeamName: null, blueTeamName: null, shareLink: null,
        srAnnouncements: null, timerDisplay: null, timerValue: null
    },
    srAnnouncementTimeout: null,
    boardInitialized: false,
    isMultiplayerMode: false,
    multiplayerPlayers: [],
    currentMpMode: 'join',
    multiplayerListenersSetup: false,
    currentRoomId: null,
    currentReplayData: null,
    currentReplayIndex: -1,
    replayPlaying: false,
    replayInterval: null,
    historyDelegationSetup: false,
    activeModal: null,
    previouslyFocusedElement: null,
    modalListenersActive: false,
    activeWords: [...DEFAULT_WORDS],
    wordSource: 'default',
    wordListMode: 'combined',
    teamNames: { red: 'Red', blue: 'Blue' },
    isHost: false,
    spymasterTeam: null,
    clickerTeam: null,
    playerTeam: null,
    roleChange: { phase: 'idle' },
    gameState: {
        words: [], types: [], revealed: [],
        currentTurn: 'red', redScore: 0, blueScore: 0,
        redTotal: 9, blueTotal: 8,
        gameOver: false, winner: null, seed: null,
        customWords: false, currentClue: null,
        guessesUsed: 0, guessesAllowed: 0, status: 'waiting',
        duetTypes: [], timerTokens: 0, greenFound: 0, greenTotal: 0
    },
    timerState: {
        active: false, endTime: null, duration: null,
        remainingSeconds: null, intervalId: null,
        serverRemainingSeconds: null, countdownStartTime: null
    },
    notificationPrefs: { soundEnabled: false, tabNotificationEnabled: false },
    originalDocumentTitle: document.title,
    audioContext: null,
    newGameDebounce: false,
    lastRevealedIndex: -1,
    lastRevealedWasCorrect: false,
    pendingUIUpdate: false,
    isRevealingCard: false,
    revealingCards: new Set(),
    revealTimeouts: new Map(),
    copyButtonTimeoutId: null,
    language: 'en',
    localizedDefaultWords: null,
    colorBlindMode: false,
    gameMode: 'classic',
    spectatorCount: 0,
    roomStats: null,
    resyncInProgress: false
};
// ========== EXPORTED STATE ==========
// Debug proxy wraps the state when localStorage.debug === 'eigennamen'.
// Otherwise the raw object is exported (zero overhead).
export const state = (() => {
    try {
        if (debugEnabled()) {
            return createStateProxy(_rawState);
        }
    }
    catch { /* SSR / test environments without localStorage */ }
    return _rawState;
})();
attachDebugToWindow(_rawState);
// ========== CACHED DOM ELEMENTS ==========
export function initCachedElements() {
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
//# sourceMappingURL=state.js.map