import { NICKNAME_MIN_LENGTH, NICKNAME_MAX_LENGTH, ROOM_CODE_MIN_LENGTH, ROOM_CODE_MAX_LENGTH, CHAT_MESSAGE_MAX_LENGTH, NICKNAME_REGEX as SHARED_NICKNAME_REGEX, ROOM_CODE_REGEX, RESERVED_NAMES as SHARED_RESERVED_NAMES, BOARD_SIZE as SHARED_BOARD_SIZE, FIRST_TEAM_CARDS as SHARED_FIRST_TEAM_CARDS, SECOND_TEAM_CARDS as SHARED_SECOND_TEAM_CARDS, NEUTRAL_CARDS as SHARED_NEUTRAL_CARDS, ASSASSIN_CARDS as SHARED_ASSASSIN_CARDS, TIMER_MIN_TURN_SECONDS, TIMER_MAX_TURN_SECONDS, TIMER_DEFAULT_TURN_SECONDS } from '../shared/index.js';
/**
 * Validation limits for user input — sourced from shared module
 */
export const VALIDATION = {
    NICKNAME_MIN_LENGTH,
    NICKNAME_MAX_LENGTH,
    ROOM_CODE_MIN_LENGTH,
    ROOM_CODE_MAX_LENGTH,
    ROOM_CODE_PATTERN: ROOM_CODE_REGEX,
    CHAT_MESSAGE_MAX_LENGTH
};
/**
 * Game-related constants — sourced from shared module
 */
export const BOARD_SIZE = SHARED_BOARD_SIZE;
export const FIRST_TEAM_CARDS = SHARED_FIRST_TEAM_CARDS;
export const SECOND_TEAM_CARDS = SHARED_SECOND_TEAM_CARDS;
export const NEUTRAL_CARDS = SHARED_NEUTRAL_CARDS;
export const ASSASSIN_CARDS = SHARED_ASSASSIN_CARDS;
export const GAME = {
    BOARD_SIZE,
    MIN_CUSTOM_WORDS: BOARD_SIZE,
    RED_CARDS_FIRST: FIRST_TEAM_CARDS,
    BLUE_CARDS_FIRST: SECOND_TEAM_CARDS,
    NEUTRAL_CARDS,
    ASSASSIN_CARDS
};
// Role banner configuration - maps role/team to CSS class and label
export const ROLE_BANNER_CONFIG = {
    spymaster: { red: 'spymaster-red', blue: 'spymaster-blue', label: 'Spymaster' },
    clicker: { red: 'clicker-red', blue: 'clicker-blue', label: 'Clicker' },
    spectator: { red: 'spectator-red', blue: 'spectator-blue', label: 'Team' }
};
export const DEFAULT_WORDS = [
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
 * Timer-related constants — bounds sourced from shared module
 */
export const TIMER = {
    // Warning threshold in seconds (shows warning styling)
    WARNING_THRESHOLD_SECONDS: 30,
    // Critical threshold in seconds (shows critical styling)
    CRITICAL_THRESHOLD_SECONDS: 10,
    // Default turn time in seconds
    DEFAULT_TURN_SECONDS: TIMER_DEFAULT_TURN_SECONDS,
    // Minimum and maximum turn time
    MIN_TURN_SECONDS: TIMER_MIN_TURN_SECONDS,
    MAX_TURN_SECONDS: TIMER_MAX_TURN_SECONDS
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
 * Reserved nicknames (case-insensitive) — sourced from shared module
 */
export const RESERVED_NAMES = SHARED_RESERVED_NAMES;
/**
 * Validate a nickname against constraints
 */
const NICKNAME_REGEX = SHARED_NICKNAME_REGEX;
export function validateNickname(nickname) {
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
 * Validate a room code against constraints
 */
export function validateRoomCode(roomCode) {
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
//# sourceMappingURL=constants.js.map