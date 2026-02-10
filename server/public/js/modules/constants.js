// ========== SHARED FRONTEND CONSTANTS ==========
// PHASE 2 FIX: Centralize hardcoded limits for consistency with server validation
// These values should match the server-side constants in server/src/config/constants.ts

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
 */
export const GAME = {
    BOARD_SIZE: 25,
    MIN_CUSTOM_WORDS: 25,

    // Team totals for standard game
    RED_CARDS_FIRST: 9,
    BLUE_CARDS_FIRST: 8,
    NEUTRAL_CARDS: 7,
    ASSASSIN_CARDS: 1
};

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
    RESIZE_DEBOUNCE_MS: 100
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
export const RESERVED_NAMES = [
    'admin', 'administrator', 'system', 'host', 'server',
    'mod', 'moderator', 'bot', 'codenames', 'game',
    'official', 'support', 'help', 'null', 'undefined'
];

/**
 * Validate a nickname against constraints
 * @param {string} nickname - Nickname to validate
 * @returns {Object} { valid: boolean, error: string|null }
 */
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

    if (RESERVED_NAMES.includes(trimmed.toLowerCase())) {
        return { valid: false, error: 'This nickname is reserved' };
    }

    return { valid: true, error: null };
}

/**
 * Validate a room code against constraints
 * @param {string} roomCode - Room code to validate
 * @returns {Object} { valid: boolean, error: string|null }
 */
/**
 * Validate a clue word against constraints (matches server's clueWordRegex)
 * @param {string} word - Clue word to validate
 * @returns {Object} { valid: boolean, error: string|null }
 */
export function validateClueWord(word) {
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

