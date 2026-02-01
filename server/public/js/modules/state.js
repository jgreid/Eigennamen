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

// The single shared state object
export const state = {
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
    isChangingRole: false,
    changingTarget: null,
    pendingRoleChange: null,

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
        guessesUsed: 0
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
    isRevealingCard: false,

    // Copy button
    copyButtonTimeoutId: null
};

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
