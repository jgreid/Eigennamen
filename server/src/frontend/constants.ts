// ========== SHARED FRONTEND CONSTANTS ==========
// Centralize hardcoded limits for consistency with server validation
// These values should match the server-side constants in server/src/config/constants.ts

/**
 * Validation result returned by all validate* functions
 */
export interface ValidationResult {
    valid: boolean;
    error: string | null;
}

/**
 * Validation limits for user input
 * Must match server VALIDATION constants
 */
export const VALIDATION = {
    // Nickname constraints
    NICKNAME_MIN_LENGTH: 1,
    NICKNAME_MAX_LENGTH: 30,

    // Room ID constraints
    ROOM_CODE_MIN_LENGTH: 3,
    ROOM_CODE_MAX_LENGTH: 20,
    ROOM_CODE_PATTERN: /^[\p{L}\p{N}\-_]+$/u,

    // Clue constraints
    CLUE_MIN_LENGTH: 1,
    CLUE_MAX_LENGTH: 50,

    // Chat message constraints
    CHAT_MESSAGE_MAX_LENGTH: 500,

    // Clue word regex - must match server's clueWordRegex in schemas.ts
    // Unicode letters with optional single spaces/hyphens/apostrophes between words (max 10 parts)
    CLUE_WORD_PATTERN: /^[\p{L}]+(?:[\s\-'][\p{L}]+){0,9}$/u
};

/**
 * Game-related constants
 * Canonical source for board layout values — replaces the scattered
 * BOARD_SIZE / FIRST_TEAM_CARDS / … exports that used to live in state.ts.
 */
export const BOARD_SIZE = 25;
export const FIRST_TEAM_CARDS = 9;
export const SECOND_TEAM_CARDS = 8;
export const NEUTRAL_CARDS = 7;
export const ASSASSIN_CARDS = 1;

export const GAME = {
    BOARD_SIZE,
    MIN_CUSTOM_WORDS: BOARD_SIZE,
    RED_CARDS_FIRST: FIRST_TEAM_CARDS,
    BLUE_CARDS_FIRST: SECOND_TEAM_CARDS,
    NEUTRAL_CARDS,
    ASSASSIN_CARDS
};

export const COPY_BUTTON_TEXT = 'Copy';

// Role banner configuration - maps role/team to CSS class and label
export const ROLE_BANNER_CONFIG: Record<string, { red: string; blue: string; label: string }> = {
    spymaster: { red: 'spymaster-red', blue: 'spymaster-blue', label: 'Spymaster' },
    clicker: { red: 'clicker-red', blue: 'clicker-blue', label: 'Clicker' },
    spectator: { red: 'spectator-red', blue: 'spectator-blue', label: 'Team' }
};

export const DEFAULT_WORDS: string[] = [
    'AFRICA', 'AGENT', 'AIR', 'ALIEN', 'ALPS', 'AMAZON', 'AMBULANCE', 'AMERICA',
    'ANGEL', 'ANTARCTICA', 'APPLE', 'ARM', 'ATLANTIS', 'AUSTRALIA', 'AZTEC',
    'BACK', 'BALL', 'BAND', 'BANK', 'BAR', 'BARK', 'BAT', 'BATTERY', 'BEACH',
    'BEAR', 'BEAT', 'BED', 'BEIJING', 'BELL', 'BELT', 'BERLIN', 'BERMUDA',
    'BERRY', 'BILL', 'BLOCK', 'BOARD', 'BOLT', 'BOMB', 'BOND', 'BOOM', 'BOOT',
    'BOTTLE', 'BOW', 'BOX', 'BRIDGE', 'BRUSH', 'BUCK', 'BUFFALO', 'BUG',
    'BUGLE', 'BUTTON', 'CALF', 'CANADA', 'CAP', 'CAPITAL', 'CAR', 'CARD',
    'CARROT', 'CASINO', 'CAST', 'CAT', 'CELL', 'CENTAUR', 'CENTER', 'CHAIR',
    'CHANGE', 'CHARGE', 'CHECK', 'CHEST', 'CHICK', 'CHINA', 'CHOCOLATE',
    'CHURCH', 'CIRCLE', 'CLIFF', 'CLOAK', 'CLUB', 'CODE', 'COLD', 'COMIC',
    'COMPOUND', 'CONCERT', 'CONDUCTOR', 'CONTRACT', 'COOK', 'COPPER', 'COTTON',
    'COURT', 'COVER', 'CRANE', 'CRASH', 'CRICKET', 'CROSS', 'CROWN', 'CYCLE',
    'CZECH', 'DANCE', 'DATE', 'DAY', 'DEATH', 'DECK', 'DEGREE', 'DIAMOND',
    'DICE', 'DINOSAUR', 'DISEASE', 'DOCTOR', 'DOG', 'DRAFT', 'DRAGON', 'DRESS',
    'DRILL', 'DROP', 'DUCK', 'DWARF', 'EAGLE', 'EGYPT', 'EMBASSY', 'ENGINE',
    'ENGLAND', 'EUROPE', 'EYE', 'FACE', 'FAIR', 'FALL', 'FAN', 'FENCE', 'FIELD',
    'FIGHTER', 'FIGURE', 'FILE', 'FILM', 'FIRE', 'FISH', 'FLUTE', 'FLY',
    'FOOT', 'FORCE', 'FOREST', 'FORK', 'FRANCE', 'GAME', 'GAS', 'GENIUS',
    'GERMANY', 'GHOST', 'GIANT', 'GLASS', 'GLOVE', 'GOLD', 'GRACE', 'GRASS',
    'GREECE', 'GREEN', 'GROUND', 'HAM', 'HAND', 'HAWK', 'HEAD', 'HEART',
    'HELICOPTER', 'HIMALAYAS', 'HOLE', 'HOLLYWOOD', 'HONEY', 'HOOD', 'HOOK',
    'HORN', 'HORSE', 'HOSPITAL', 'HOTEL', 'ICE', 'ICE CREAM', 'INDIA', 'IRON',
    'IVORY', 'JACK', 'JAM', 'JET', 'JUPITER', 'KANGAROO', 'KETCHUP', 'KEY',
    'KID', 'KING', 'KIWI', 'KNIFE', 'KNIGHT', 'LAB', 'LAP', 'LASER', 'LAWYER',
    'LEAD', 'LEMON', 'LEPRECHAUN', 'LIFE', 'LIGHT', 'LIMOUSINE', 'LINE', 'LINK',
    'LION', 'LITTER', 'LOCH NESS', 'LOCK', 'LOG', 'LONDON', 'LUCK', 'MAIL',
    'MAMMOTH', 'MAPLE', 'MARBLE', 'MARCH', 'MASS', 'MATCH', 'MERCURY', 'MEXICO',
    'MICROSCOPE', 'MILLIONAIRE', 'MINE', 'MINT', 'MISSILE', 'MODEL', 'MOLE',
    'MOON', 'MOSCOW', 'MOUNT', 'MOUSE', 'MOUTH', 'MUG', 'NAIL', 'NEEDLE',
    'NET', 'NEW YORK', 'NIGHT', 'NINJA', 'NOTE', 'NOVEL', 'NURSE', 'NUT',
    'OCTOPUS', 'OIL', 'OLIVE', 'OLYMPUS', 'OPERA', 'ORANGE', 'ORGAN', 'PALM',
    'PAN', 'PANDA', 'PAPER', 'PARACHUTE', 'PARK', 'PART', 'PASS', 'PASTE',
    'PENGUIN', 'PHOENIX', 'PIANO', 'PIE', 'PILOT', 'PIN', 'PIPE', 'PIRATE',
    'PISTOL', 'PIT', 'PITCH', 'PLANE', 'PLASTIC', 'PLATE', 'PLATYPUS',
    'PLAY', 'PLOT', 'POINT', 'POISON', 'POLE', 'POLICE', 'POOL', 'PORT',
    'POST', 'POUND', 'PRESS', 'PRINCESS', 'PUMPKIN', 'PUPIL', 'PYRAMID',
    'QUEEN', 'RABBIT', 'RACKET', 'RAY', 'REVOLUTION', 'RING', 'ROBIN', 'ROBOT',
    'ROCK', 'ROME', 'ROOT', 'ROSE', 'ROULETTE', 'ROUND', 'ROW', 'RULER',
    'SATELLITE', 'SATURN', 'SCALE', 'SCHOOL', 'SCIENTIST', 'SCORPION', 'SCREEN',
    'SCUBA DIVER', 'SEAL', 'SERVER', 'SHADOW', 'SHAKESPEARE', 'SHARK', 'SHIP',
    'SHOE', 'SHOP', 'SHOT', 'SHOULDER', 'SILK', 'SINK', 'SKYSCRAPER', 'SLIP',
    'SLUG', 'SMUGGLER', 'SNOW', 'SNOWMAN', 'SOCK', 'SOLDIER', 'SOUL', 'SOUND',
    'SPACE', 'SPELL', 'SPIDER', 'SPIKE', 'SPINE', 'SPOT', 'SPRING', 'SPY',
    'SQUARE', 'STADIUM', 'STAFF', 'STAR', 'STATE', 'STICK', 'STOCK', 'STRAW',
    'STREAM', 'STRIKE', 'STRING', 'SUB', 'SUIT', 'SUPERHERO', 'SWING', 'SWITCH',
    'TABLE', 'TABLET', 'TAG', 'TAIL', 'TAP', 'TEACHER', 'TELESCOPE', 'TEMPLE',
    'THIEF', 'THUMB', 'TICK', 'TIE', 'TIME', 'TOKYO', 'TOOTH', 'TORCH', 'TOWER',
    'TRACK', 'TRAIN', 'TRIANGLE', 'TRIP', 'TRUNK', 'TUBE', 'TURKEY', 'UNDERTAKER',
    'UNICORN', 'VACUUM', 'VAN', 'VET', 'VOLCANO', 'WALL', 'WAR', 'WASHER',
    'WASHINGTON', 'WATCH', 'WATER', 'WAVE', 'WEB', 'WELL', 'WHALE', 'WHIP',
    'WIND', 'WITCH', 'WORM', 'YARD'
];

/**
 * Timer-related constants
 */
export const TIMER = {
    // Warning threshold in seconds (shows warning styling)
    WARNING_THRESHOLD_SECONDS: 30,

    // Critical threshold in seconds (shows critical styling)
    CRITICAL_THRESHOLD_SECONDS: 10,

    // Default turn time in seconds
    DEFAULT_TURN_SECONDS: 120,

    // Minimum and maximum turn time
    MIN_TURN_SECONDS: 30,
    MAX_TURN_SECONDS: 600
};

/**
 * UI-related constants
 */
export const UI = {
    // Toast notification duration in milliseconds
    TOAST_DURATION_MS: 4000,

    // Modal focus delay in milliseconds
    MODAL_FOCUS_DELAY_MS: 50,

    // Animation durations
    TOAST_HIDE_ANIMATION_MS: 300,
    CARD_FLIP_ANIMATION_MS: 600,

    // Debounce delays
    INPUT_DEBOUNCE_MS: 300,
    RESIZE_DEBOUNCE_MS: 100,

    // Card reveal safety timeout (per-card, clears pending state if server doesn't respond)
    CARD_REVEAL_TIMEOUT_MS: 10000,

    // New game debounce to prevent rapid clicks
    NEW_GAME_DEBOUNCE_MS: 500,

    // New game button safety timeout (re-enables if server doesn't respond)
    NEW_GAME_SAFETY_TIMEOUT_MS: 10000,

    // Animation tracking clear delay (animation duration + small buffer)
    ANIMATION_CLEAR_MS: 800,

    // Screen reader announcement auto-clear delay
    SR_ANNOUNCEMENT_MS: 1000,

    // Reconnection overlay timeout before showing failure
    RECONNECTION_TIMEOUT_MS: 15000,

    // Copy feedback display duration
    COPY_FEEDBACK_MS: 2000,

    // Multiplayer join modal close delay
    MP_JOIN_CLOSE_DELAY_MS: 500
};

/**
 * Connection-related constants
 */
export const CONNECTION = {
    // Reconnection settings
    MAX_RECONNECT_ATTEMPTS: 5,
    RECONNECT_DELAY_MS: 1000,
    RECONNECT_DELAY_MAX_MS: 5000,

    // Timeout for server operations
    OPERATION_TIMEOUT_MS: 30000
};

/**
 * Reserved nicknames (case-insensitive) - must match server RESERVED_NAMES
 */
export const RESERVED_NAMES: string[] = [
    'admin', 'administrator', 'system', 'host', 'server',
    'mod', 'moderator', 'bot', 'codenames', 'game',
    'official', 'support', 'help', 'null', 'undefined'
];

/**
 * Validate a nickname against constraints
 * @param nickname - Nickname to validate
 * @returns Validation result with valid flag and optional error message
 */
// Nickname regex — matches server-side nicknameRegex in validators/schemas.ts
// Unicode letters/numbers, spaces, hyphens, underscores
const NICKNAME_REGEX = /^[\p{L}\p{N}\s\-_]+$/u;

export function validateNickname(nickname: string): ValidationResult {
    if (!nickname || typeof nickname !== 'string') {
        return { valid: false, error: 'Nickname is required' };
    }

    const trimmed = nickname.trim();

    if (trimmed.length < VALIDATION.NICKNAME_MIN_LENGTH) {
        return { valid: false, error: 'Nickname is required' };
    }

    if (trimmed.length > VALIDATION.NICKNAME_MAX_LENGTH) {
        return { valid: false, error: `Nickname must be ${VALIDATION.NICKNAME_MAX_LENGTH} characters or less` };
    }

    if (!NICKNAME_REGEX.test(trimmed)) {
        return { valid: false, error: 'Nickname contains invalid characters' };
    }

    if (RESERVED_NAMES.includes(trimmed.toLowerCase())) {
        return { valid: false, error: 'This nickname is reserved' };
    }

    return { valid: true, error: null };
}

/**
 * Validate a clue word against constraints (matches server's clueWordRegex)
 * @param word - Clue word to validate
 * @returns Validation result with valid flag and optional error message
 */
export function validateClueWord(word: string): ValidationResult {
    if (!word || typeof word !== 'string') {
        return { valid: false, error: 'Clue word is required' };
    }

    const trimmed = word.trim().replace(/\s+/g, ' ');

    if (trimmed.length < VALIDATION.CLUE_MIN_LENGTH) {
        return { valid: false, error: 'Clue word is required' };
    }

    if (trimmed.length > VALIDATION.CLUE_MAX_LENGTH) {
        return { valid: false, error: `Clue must be ${VALIDATION.CLUE_MAX_LENGTH} characters or less` };
    }

    if (!VALIDATION.CLUE_WORD_PATTERN.test(trimmed)) {
        return { valid: false, error: 'Clue must be words separated by spaces, hyphens, or apostrophes' };
    }

    return { valid: true, error: null };
}

/**
 * Validate a room code against constraints
 * @param roomCode - Room code to validate
 * @returns Validation result with valid flag and optional error message
 */
export function validateRoomCode(roomCode: string): ValidationResult {
    if (!roomCode || typeof roomCode !== 'string') {
        return { valid: false, error: 'Room ID is required' };
    }

    const trimmed = roomCode.trim();

    if (trimmed.length < VALIDATION.ROOM_CODE_MIN_LENGTH) {
        return { valid: false, error: `Room ID must be at least ${VALIDATION.ROOM_CODE_MIN_LENGTH} characters` };
    }

    if (trimmed.length > VALIDATION.ROOM_CODE_MAX_LENGTH) {
        return { valid: false, error: `Room ID must be ${VALIDATION.ROOM_CODE_MAX_LENGTH} characters or less` };
    }

    if (!VALIDATION.ROOM_CODE_PATTERN.test(trimmed)) {
        return { valid: false, error: 'Room ID can only contain letters, numbers, hyphens, and underscores' };
    }

    return { valid: true, error: null };
}
