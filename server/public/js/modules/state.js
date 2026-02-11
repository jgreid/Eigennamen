// ========== STATE MODULE ==========
// All mutable shared state in a single object for ES module compatibility.
// Other modules import `state` and read/write properties on it.
// Game constants (never change)
export const BOARD_SIZE = 25;
export const FIRST_TEAM_CARDS = 9;
export const SECOND_TEAM_CARDS = 8;
export const NEUTRAL_CARDS = 7;
export const ASSASSIN_CARDS = 1;
export const DEFAULT_WORDS = [
    "AFRICA", "AGENT", "AIR", "ALIEN", "ALPS", "AMAZON", "AMBULANCE", "AMERICA",
    "ANGEL", "ANTARCTICA", "APPLE", "ARM", "ATLANTIS", "AUSTRALIA", "AZTEC",
    "BACK", "BALL", "BAND", "BANK", "BAR", "BARK", "BAT", "BATTERY", "BEACH",
    "BEAR", "BEAT", "BED", "BEIJING", "BELL", "BELT", "BERLIN", "BERMUDA",
    "BERRY", "BILL", "BLOCK", "BOARD", "BOLT", "BOMB", "BOND", "BOOM", "BOOT",
    "BOTTLE", "BOW", "BOX", "BRIDGE", "BRUSH", "BUCK", "BUFFALO", "BUG",
    "BUGLE", "BUTTON", "CALF", "CANADA", "CAP", "CAPITAL", "CAR", "CARD",
    "CARROT", "CASINO", "CAST", "CAT", "CELL", "CENTAUR", "CENTER", "CHAIR",
    "CHANGE", "CHARGE", "CHECK", "CHEST", "CHICK", "CHINA", "CHOCOLATE",
    "CHURCH", "CIRCLE", "CLIFF", "CLOAK", "CLUB", "CODE", "COLD", "COMIC",
    "COMPOUND", "CONCERT", "CONDUCTOR", "CONTRACT", "COOK", "COPPER", "COTTON",
    "COURT", "COVER", "CRANE", "CRASH", "CRICKET", "CROSS", "CROWN", "CYCLE",
    "CZECH", "DANCE", "DATE", "DAY", "DEATH", "DECK", "DEGREE", "DIAMOND",
    "DICE", "DINOSAUR", "DISEASE", "DOCTOR", "DOG", "DRAFT", "DRAGON", "DRESS",
    "DRILL", "DROP", "DUCK", "DWARF", "EAGLE", "EGYPT", "EMBASSY", "ENGINE",
    "ENGLAND", "EUROPE", "EYE", "FACE", "FAIR", "FALL", "FAN", "FENCE", "FIELD",
    "FIGHTER", "FIGURE", "FILE", "FILM", "FIRE", "FISH", "FLUTE", "FLY",
    "FOOT", "FORCE", "FOREST", "FORK", "FRANCE", "GAME", "GAS", "GENIUS",
    "GERMANY", "GHOST", "GIANT", "GLASS", "GLOVE", "GOLD", "GRACE", "GRASS",
    "GREECE", "GREEN", "GROUND", "HAM", "HAND", "HAWK", "HEAD", "HEART",
    "HELICOPTER", "HIMALAYAS", "HOLE", "HOLLYWOOD", "HONEY", "HOOD", "HOOK",
    "HORN", "HORSE", "HOSPITAL", "HOTEL", "ICE", "ICE CREAM", "INDIA", "IRON",
    "IVORY", "JACK", "JAM", "JET", "JUPITER", "KANGAROO", "KETCHUP", "KEY",
    "KID", "KING", "KIWI", "KNIFE", "KNIGHT", "LAB", "LAP", "LASER", "LAWYER",
    "LEAD", "LEMON", "LEPRECHAUN", "LIFE", "LIGHT", "LIMOUSINE", "LINE", "LINK",
    "LION", "LITTER", "LOCH NESS", "LOCK", "LOG", "LONDON", "LUCK", "MAIL",
    "MAMMOTH", "MAPLE", "MARBLE", "MARCH", "MASS", "MATCH", "MERCURY", "MEXICO",
    "MICROSCOPE", "MILLIONAIRE", "MINE", "MINT", "MISSILE", "MODEL", "MOLE",
    "MOON", "MOSCOW", "MOUNT", "MOUSE", "MOUTH", "MUG", "NAIL", "NEEDLE",
    "NET", "NEW YORK", "NIGHT", "NINJA", "NOTE", "NOVEL", "NURSE", "NUT",
    "OCTOPUS", "OIL", "OLIVE", "OLYMPUS", "OPERA", "ORANGE", "ORGAN", "PALM",
    "PAN", "PANDA", "PAPER", "PARACHUTE", "PARK", "PART", "PASS", "PASTE",
    "PENGUIN", "PHOENIX", "PIANO", "PIE", "PILOT", "PIN", "PIPE", "PIRATE",
    "PISTOL", "PIT", "PITCH", "PLANE", "PLASTIC", "PLATE", "PLATYPUS",
    "PLAY", "PLOT", "POINT", "POISON", "POLE", "POLICE", "POOL", "PORT",
    "POST", "POUND", "PRESS", "PRINCESS", "PUMPKIN", "PUPIL", "PYRAMID",
    "QUEEN", "RABBIT", "RACKET", "RAY", "REVOLUTION", "RING", "ROBIN", "ROBOT",
    "ROCK", "ROME", "ROOT", "ROSE", "ROULETTE", "ROUND", "ROW", "RULER",
    "SATELLITE", "SATURN", "SCALE", "SCHOOL", "SCIENTIST", "SCORPION", "SCREEN",
    "SCUBA DIVER", "SEAL", "SERVER", "SHADOW", "SHAKESPEARE", "SHARK", "SHIP",
    "SHOE", "SHOP", "SHOT", "SHOULDER", "SILK", "SINK", "SKYSCRAPER", "SLIP",
    "SLUG", "SMUGGLER", "SNOW", "SNOWMAN", "SOCK", "SOLDIER", "SOUL", "SOUND",
    "SPACE", "SPELL", "SPIDER", "SPIKE", "SPINE", "SPOT", "SPRING", "SPY",
    "SQUARE", "STADIUM", "STAFF", "STAR", "STATE", "STICK", "STOCK", "STRAW",
    "STREAM", "STRIKE", "STRING", "SUB", "SUIT", "SUPERHERO", "SWING", "SWITCH",
    "TABLE", "TABLET", "TAG", "TAIL", "TAP", "TEACHER", "TELESCOPE", "TEMPLE",
    "THIEF", "THUMB", "TICK", "TIE", "TIME", "TOKYO", "TOOTH", "TORCH", "TOWER",
    "TRACK", "TRAIN", "TRIANGLE", "TRIP", "TRUNK", "TUBE", "TURKEY", "UNDERTAKER",
    "UNICORN", "VACUUM", "VAN", "VET", "VOLCANO", "WALL", "WAR", "WASHER",
    "WASHINGTON", "WATCH", "WATER", "WAVE", "WEB", "WELL", "WHALE", "WHIP",
    "WIND", "WITCH", "WORM", "YARD"
];
export const COPY_BUTTON_TEXT = 'Copy';
// Role banner configuration - maps role/team to CSS class and label
export const ROLE_BANNER_CONFIG = {
    spymaster: { red: 'spymaster-red', blue: 'spymaster-blue', label: 'Spymaster' },
    clicker: { red: 'clicker-red', blue: 'clicker-blue', label: 'Clicker' },
    spectator: { red: 'spectator-red', blue: 'spectator-blue', label: 'Team' }
};
// The raw state object (wrapped with a debug proxy below)
const _rawState = {
    // Cached DOM elements
    cachedElements: {
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
        timerValue: null
    },
    // Screen reader
    srAnnouncementTimeout: null,
    // Board
    boardInitialized: false,
    // Multiplayer
    isMultiplayerMode: false,
    multiplayerPlayers: [],
    currentMpMode: 'join',
    multiplayerListenersSetup: false,
    currentRoomId: null,
    // History / Replay
    currentReplayData: null,
    currentReplayIndex: -1,
    replayPlaying: false,
    replayInterval: null,
    historyDelegationSetup: false,
    // Modal
    activeModal: null,
    previouslyFocusedElement: null,
    modalListenersActive: false,
    // Words
    activeWords: [...DEFAULT_WORDS],
    wordSource: 'default',
    wordListMode: 'combined',
    teamNames: {
        red: 'Red',
        blue: 'Blue'
    },
    // Roles
    isHost: false,
    spymasterTeam: null,
    clickerTeam: null,
    playerTeam: null,
    roleChange: { phase: 'idle' },
    // Game state
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
        customWords: false,
        currentClue: null,
        guessesUsed: 0,
        guessesAllowed: 0,
        status: 'waiting',
        duetTypes: [],
        timerTokens: 0,
        greenFound: 0,
        greenTotal: 0
    },
    // Timer state
    timerState: {
        active: false,
        endTime: null,
        duration: null,
        remainingSeconds: null,
        intervalId: null,
        serverRemainingSeconds: null,
        countdownStartTime: null
    },
    // Notifications
    notificationPrefs: {
        soundEnabled: false,
        tabNotificationEnabled: false
    },
    originalDocumentTitle: document.title,
    audioContext: null,
    // Debounce
    newGameDebounce: false,
    // Card reveal tracking
    lastRevealedIndex: -1,
    lastRevealedWasCorrect: false,
    pendingUIUpdate: false,
    isRevealingCard: false, // legacy boolean kept for backward compat
    revealingCards: new Set(), // Per-card reveal tracking (Set of indices)
    revealTimeouts: new Map(), // Per-card reveal timeout IDs
    // Copy button
    copyButtonTimeoutId: null,
    // i18n
    language: 'en',
    localizedDefaultWords: null,
    // Accessibility
    colorBlindMode: false,
    // Game mode
    gameMode: 'classic',
    // Spectator/room stats
    spectatorCount: 0,
    roomStats: null
};
const watchers = new Map();
// ========== STATE PROXY ==========
// When debug mode is enabled, wraps the state in a Proxy that automatically
// logs all mutations and invokes watchers. In production, this is a no-op —
// the raw state object is exported directly.
/**
 * Create a recursive Proxy that logs property mutations.
 * Sub-objects are wrapped lazily on access so the overhead is minimal.
 */
function createStateProxy(target, path = 'state') {
    const subProxies = new WeakMap();
    return new Proxy(target, {
        get(obj, prop) {
            const value = Reflect.get(obj, prop);
            // Wrap sub-objects so nested mutations are also tracked
            if (value !== null && typeof value === 'object' && typeof prop === 'string') {
                if (!subProxies.has(value)) {
                    subProxies.set(value, createStateProxy(value, `${path}.${prop}`));
                }
                return subProxies.get(value);
            }
            return value;
        },
        set(obj, prop, value) {
            const oldValue = Reflect.get(obj, prop);
            const result = Reflect.set(obj, prop, value);
            if (typeof prop === 'string' && oldValue !== value) {
                const fullPath = `${path}.${prop}`;
                // Invalidate sub-proxy cache when a sub-object is replaced
                if (oldValue !== null && typeof oldValue === 'object') {
                    subProxies.delete(oldValue);
                }
                logStateChange(fullPath, oldValue, value, 'proxy');
                // Invoke watchers registered via watchState()
                const watcherList = watchers.get(fullPath);
                if (watcherList) {
                    for (const cb of watcherList) {
                        try {
                            cb(oldValue, value);
                        }
                        catch { /* watcher errors are non-fatal */ }
                    }
                }
            }
            return result;
        }
    });
}
/**
 * Exported state object.
 * In debug mode this is a Proxy that logs mutations automatically.
 * Otherwise it's the plain object (zero overhead).
 */
export const state = (() => {
    try {
        if (typeof localStorage !== 'undefined' && localStorage.getItem('debug') === 'codenames') {
            return createStateProxy(_rawState);
        }
    }
    catch { /* SSR / test environments without localStorage */ }
    return _rawState;
})();
// ========== DEBUGGING UTILITIES ==========
// Enable debug mode by setting localStorage.debug = 'codenames'
const DEBUG_KEY = 'codenames';
const debugEnabled = () => {
    try {
        return localStorage.getItem('debug') === DEBUG_KEY;
    }
    catch {
        return false;
    }
};
const stateHistory = [];
const MAX_HISTORY = 100;
/**
 * Log a state change with context
 * @param property - State property being changed
 * @param oldValue - Previous value
 * @param newValue - New value
 * @param source - What triggered the change
 */
export function logStateChange(property, oldValue, newValue, source = 'unknown') {
    if (!debugEnabled())
        return;
    const entry = {
        timestamp: new Date().toISOString(),
        property,
        oldValue: safeClone(oldValue),
        newValue: safeClone(newValue),
        source,
        stack: new Error().stack?.split('\n').slice(2, 5).join('\n')
    };
    stateHistory.push(entry);
    if (stateHistory.length > MAX_HISTORY) {
        stateHistory.shift();
    }
    console.log(`%c[State] ${property}`, 'color: #4a9eff; font-weight: bold', '\nFrom:', oldValue, '\nTo:', newValue, '\nSource:', source);
}
/**
 * Safe deep clone for logging (handles circular refs)
 */
function safeClone(obj) {
    if (obj === null || typeof obj !== 'object')
        return obj;
    try {
        return JSON.parse(JSON.stringify(obj));
    }
    catch {
        return '[Circular or non-serializable]';
    }
}
/**
 * Update a state property with logging
 * @param property - Property path (e.g., 'gameState.currentTurn')
 * @param value - New value
 * @param source - What triggered the change
 */
export function setState(property, value, source = 'unknown') {
    const parts = property.split('.');
    let target = state;
    let oldValue;
    // Navigate to the parent of the target property
    for (let i = 0; i < parts.length - 1; i++) {
        target = target[parts[i]];
        if (target === undefined) {
            console.error(`[State] Invalid property path: ${property}`);
            return;
        }
    }
    const lastPart = parts[parts.length - 1];
    oldValue = target[lastPart];
    target[lastPart] = value;
    logStateChange(property, oldValue, value, source);
}
/**
 * Get state change history
 * @param property - Optional filter by property
 * @returns State change history
 */
export function getStateHistory(property = null) {
    if (property) {
        return stateHistory.filter(entry => entry.property === property);
    }
    return [...stateHistory];
}
/**
 * Clear state history
 */
export function clearStateHistory() {
    stateHistory.length = 0;
}
/**
 * Get current state snapshot (for debugging)
 */
export function getStateSnapshot() {
    return safeClone(_rawState);
}
/**
 * Dump state to console (for debugging)
 */
export function dumpState() {
    console.group('%c[State Dump]', 'color: #4a9eff; font-weight: bold');
    console.log('isMultiplayerMode:', state.isMultiplayerMode);
    console.log('currentRoomId:', state.currentRoomId);
    console.log('isHost:', state.isHost);
    console.log('playerTeam:', state.playerTeam);
    console.log('spymasterTeam:', state.spymasterTeam);
    console.log('clickerTeam:', state.clickerTeam);
    console.log('gameState:', safeClone(state.gameState));
    console.log('timerState:', safeClone(state.timerState));
    console.log('multiplayerPlayers:', state.multiplayerPlayers.length, 'players');
    console.groupEnd();
}
/**
 * Watch for changes to a state property (debugging)
 * @param property - Property to watch
 * @param callback - Called on change with (oldValue, newValue)
 */
export function watchState(property, callback) {
    if (!watchers.has(property)) {
        watchers.set(property, []);
    }
    watchers.get(property).push(callback);
    // Return unwatch function
    return () => {
        const list = watchers.get(property);
        const idx = list.indexOf(callback);
        if (idx >= 0)
            list.splice(idx, 1);
    };
}
// Expose debugging utilities globally for console access
if (typeof window !== 'undefined') {
    window.__codenamesDebug = {
        getState: getStateSnapshot,
        getHistory: getStateHistory,
        clearHistory: clearStateHistory,
        dumpState,
        watchState,
        enableDebug: () => {
            localStorage.setItem('debug', DEBUG_KEY);
            console.log('%c[Debug] Enabled', 'color: #00ff00');
        },
        disableDebug: () => {
            localStorage.removeItem('debug');
            console.log('%c[Debug] Disabled', 'color: #ff0000');
        }
    };
    if (debugEnabled()) {
        console.log('%c[Codenames Debug Mode Active]', 'color: #4a9eff; font-weight: bold', '\nUse window.__codenamesDebug for debugging utilities');
    }
}
// Initialize cached elements (called once on page load)
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