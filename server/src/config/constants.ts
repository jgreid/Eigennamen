/**
 * Game Constants
 *
 * Centralized configuration for all game settings, rate limits, and system parameters.
 * This file serves as the single source of truth for all configurable values.
 */

/**
 * Rate limit configuration
 */
export interface RateLimitConfig {
    window: number;
    max: number;
}

/**
 * Retry configuration
 */
export interface RetryConfig {
    maxRetries: number;
    baseDelayMs: number;
}

// Board configuration
export const BOARD_SIZE = 25;
export const FIRST_TEAM_CARDS = 9;
export const SECOND_TEAM_CARDS = 8;
export const NEUTRAL_CARDS = 7;
export const ASSASSIN_CARDS = 1;

// Room configuration
export const ROOM_CODE_LENGTH = 6;
export const ROOM_MAX_PLAYERS = 20;
export const ROOM_EXPIRY_HOURS = 24;

// Redis TTLs (in seconds)
export const REDIS_TTL = {
    ROOM: 24 * 60 * 60,      // 24 hours
    PLAYER: 24 * 60 * 60,    // 24 hours (same as room to prevent orphaned players)
    SESSION_SOCKET: 5 * 60,  // 5 minutes
    DISCONNECTED_PLAYER: 10 * 60,  // 10 minutes grace period for reconnection
    PAUSED_TIMER: 24 * 60 * 60,  // 24 hours for paused timers
    SESSION_VALIDATION_WINDOW: 60  // 1 minute window for session validation rate limiting
} as const;

// Session security configuration
export const SESSION_SECURITY = {
    MAX_SESSION_AGE_MS: 8 * 60 * 60 * 1000,      // 8 hours max session lifetime (reduced from 24h for security)
    MAX_VALIDATION_ATTEMPTS_PER_IP: 20,          // Max validation attempts per IP per minute
    IP_MISMATCH_ALLOWED: process.env.ALLOW_IP_MISMATCH === 'true',  // Deny reconnection from different IP by default; set ALLOW_IP_MISMATCH=true to allow
    SESSION_ID_MIN_LENGTH: 36,                   // UUID length
    RECONNECTION_TOKEN_TTL_SECONDS: 300,         // 5 minutes TTL for reconnection tokens (HARDENING: reduced from 15 min to limit session hijacking window)
    RECONNECTION_TOKEN_LENGTH: 32,               // Bytes for secure token
    ROTATE_SESSION_ON_RECONNECT: true            // Issue new session token after successful reconnection
} as const;

// Turn timer configuration
export const TIMER = {
    DEFAULT_TURN_SECONDS: 120,  // 2 minutes default
    MIN_TURN_SECONDS: 30,
    MAX_TURN_SECONDS: 300,
    WARNING_SECONDS: 30,        // Warn when this many seconds remain
    TIMER_TTL_BUFFER_SECONDS: 60     // Extra TTL buffer for timer keys
} as const;

// Socket.io configuration
export const SOCKET = {
    PING_TIMEOUT_MS: 60000,           // Ping timeout (60 seconds)
    PING_INTERVAL_MS: 25000,          // Ping interval (25 seconds)
    MAX_DISCONNECTION_DURATION_MS: 2 * 60 * 1000,  // 2 minutes for connection recovery
    SOCKET_COUNT_CACHE_MS: 5000,      // Cache socket count for 5 seconds
    SOCKET_COUNT_TIMEOUT_MS: 2000,    // Timeout for fetching socket count
    REDIS_KEEPALIVE_MS: 10000,        // Redis keepalive interval
    MAX_CONNECTIONS_PER_IP: 10,       // Max concurrent socket connections per IP
    MAX_HTTP_BUFFER_SIZE: 100 * 1024  // 100KB max message size
} as const;

// Rate limits for socket events
// Keys match the rate limit identifiers used in handlers (not necessarily the event names)
export const RATE_LIMITS: Record<string, RateLimitConfig> = {
    // Room events
    'room:create': { window: 60000, max: 5 },     // 5 per minute
    'room:join': { window: 60000, max: 10 },      // 10 per minute
    'room:join:failed': { window: 60000, max: 5 },  // 5 failed attempts per minute (prevents room enumeration)
    'room:leave': { window: 60000, max: 10 },     // 10 per minute
    'room:settings': { window: 5000, max: 5 },    // 5 per 5 seconds
    'room:resync': { window: 5000, max: 3 },      // 3 per 5 seconds
    'room:reconnect': { window: 10000, max: 5 },  // 5 per 10 seconds
    'room:getReconnectionToken': { window: 10000, max: 5 },  // 5 per 10 seconds
    // Game events
    'game:start': { window: 5000, max: 2 },       // 2 per 5 seconds
    'game:reveal': { window: 1000, max: 5 },      // 5 per second
    'game:clue': { window: 5000, max: 2 },        // 2 per 5 seconds
    'game:endTurn': { window: 2000, max: 3 },     // 3 per 2 seconds
    'game:forfeit': { window: 10000, max: 2 },    // 2 per 10 seconds
    'game:history': { window: 5000, max: 5 },     // 5 per 5 seconds
    'game:getHistory': { window: 5000, max: 5 },  // 5 per 5 seconds
    'game:getReplay': { window: 5000, max: 5 },   // 5 per 5 seconds
    // Player events (ISSUE #27 FIX: keys now match event names for consistency)
    'player:setTeam': { window: 2000, max: 5 },      // 5 per 2 seconds
    'player:setRole': { window: 2000, max: 5 },      // 5 per 2 seconds
    'player:setNickname': { window: 5000, max: 3 },  // 3 per 5 seconds
    'player:kick': { window: 5000, max: 3 },         // 3 per 5 seconds (host only)
    // Chat events
    'chat:message': { window: 5000, max: 10 },    // 10 per 5 seconds
    'chat:spectator': { window: 5000, max: 10 },  // 10 per 5 seconds (spectator-only chat)
    // Timer events
    'timer:status': { window: 1000, max: 10 },    // 10 per second
    'timer:pause': { window: 2000, max: 3 },      // 3 per 2 seconds (host only)
    'timer:resume': { window: 2000, max: 3 },     // 3 per 2 seconds (host only)
    'timer:addTime': { window: 2000, max: 5 },    // 5 per 2 seconds (host only)
    'timer:stop': { window: 5000, max: 2 }        // 2 per 5 seconds (host only)
};

// HTTP API rate limits
export const API_RATE_LIMITS = {
    GENERAL: { window: 60000, max: 100 },        // 100 per minute
    WORD_LIST_CREATE: { window: 60000, max: 10 }, // 10 per minute
    ADMIN: { window: 60000, max: 30 }            // 30 per minute for admin endpoints
} as const;

// Game history configuration
export const GAME_HISTORY = {
    MAX_ENTRIES: 200,  // Maximum history entries per game
    MAX_CLUES: 100     // Maximum clues stored per game (prevents unbounded growth)
} as const;

// Validation constraints
export const VALIDATION = {
    NICKNAME_MIN_LENGTH: 1,
    NICKNAME_MAX_LENGTH: 30,
    TEAM_NAME_MAX_LENGTH: 32,
    CLUE_MAX_LENGTH: 50,
    CLUE_NUMBER_MIN: 0,
    CLUE_NUMBER_MAX: 25,
    CHAT_MESSAGE_MAX_LENGTH: 500,
    WORD_MIN_LENGTH: 2,
    WORD_MAX_LENGTH: 30,
    WORD_LIST_MIN_SIZE: 25,  // BOARD_SIZE
    WORD_LIST_MAX_SIZE: 500
} as const;

// Lock timeouts (in seconds)
export const LOCKS = {
    SPYMASTER_ROLE: 5,        // Lock for spymaster role assignment
    HOST_TRANSFER: 3,         // Lock for host transfer (reduced from 10s - DB ops are fast)
    TIMER_RESTART: 5,         // Lock for timer restart
    CARD_REVEAL: 15,          // Lock for card reveal operation (longer due to retry logic)
    GAME_CREATE: 10,          // Lock for game creation
} as const;

// Retry configuration
export const RETRIES = {
    OPTIMISTIC_LOCK: 3,       // Retries for optimistic locking operations
    PUSH_RETRY_DELAYS: [2000, 4000, 8000, 16000]  // Exponential backoff
} as const;

// Game modes
export const GAME_MODES = ['classic', 'blitz', 'duet'] as const;
export type GameMode = typeof GAME_MODES[number];

// Game mode configurations
export const GAME_MODE_CONFIG = {
    classic: {
        label: 'Classic',
        description: 'Standard Codenames rules',
        forcedTurnTimer: null,   // Timer is optional, set by host
        minTurnTimer: 30,
        maxTurnTimer: 300,
        cooperative: false
    },
    blitz: {
        label: 'Blitz',
        description: 'Fast-paced 30-second turns',
        forcedTurnTimer: 30,     // Always 30 seconds, cannot be changed
        minTurnTimer: 30,
        maxTurnTimer: 30,
        cooperative: false
    },
    duet: {
        label: 'Duet',
        description: 'Cooperative 2-player mode',
        forcedTurnTimer: null,
        minTurnTimer: 30,
        maxTurnTimer: 300,
        cooperative: true
    }
} as const;

// Duet mode board configuration
// Each side sees 9 green + 3 assassin + 13 bystander
// Overlaps: 3 green/green, 1 assassin/assassin
// Total unique greens: 15
export const DUET_BOARD_CONFIG = {
    greenOverlap: 3,       // Cards green from both perspectives
    greenOnlyA: 6,         // Green for A, bystander for B
    greenOnlyB: 6,         // Bystander for A, green for B
    assassinOverlap: 1,    // Assassin from both perspectives
    assassinOnlyA: 2,      // Assassin for A, bystander for B
    assassinOnlyB: 2,      // Bystander for A, assassin for B
    bystanderBoth: 5,      // Bystander from both perspectives
    timerTokens: 9,        // Starting timer tokens
    greenTotal: 15         // Unique greens to find for win
} as const;

// Game teams and roles
export const TEAMS = ['red', 'blue'] as const;
export const ROLES = ['spymaster', 'clicker', 'spectator'] as const;
export const CARD_TYPES = ['red', 'blue', 'neutral', 'assassin'] as const;

// Room statuses
export const ROOM_STATUS = {
    WAITING: 'waiting',
    PLAYING: 'playing',
    FINISHED: 'finished'
} as const;

// Socket event names (centralized to prevent typos and enable IDE autocomplete)
export const SOCKET_EVENTS = {
    // Room events
    ROOM_CREATE: 'room:create',
    ROOM_CREATED: 'room:created',
    ROOM_JOIN: 'room:join',
    ROOM_JOINED: 'room:joined',
    ROOM_LEAVE: 'room:leave',
    ROOM_LEFT: 'room:left',
    ROOM_PLAYER_LEFT: 'room:playerLeft',
    ROOM_SETTINGS: 'room:settings',
    ROOM_SETTINGS_UPDATED: 'room:settingsUpdated',
    ROOM_SYNC: 'room:sync',
    ROOM_RESYNCED: 'room:resynced',
    ROOM_RESYNC: 'room:resync',
    ROOM_GET_RECONNECTION_TOKEN: 'room:getReconnectionToken',
    ROOM_RECONNECT: 'room:reconnect',
    ROOM_RECONNECTED: 'room:reconnected',
    ROOM_RECONNECTION_TOKEN: 'room:reconnectionToken',
    ROOM_PLAYER_JOINED: 'room:playerJoined',
    ROOM_PLAYER_RECONNECTED: 'room:playerReconnected',
    ROOM_KICKED: 'room:kicked',
    ROOM_STATS_UPDATED: 'room:statsUpdated',
    ROOM_HOST_CHANGED: 'room:hostChanged',
    ROOM_ERROR: 'room:error',

    // Game events
    GAME_START: 'game:start',
    GAME_STARTED: 'game:started',
    GAME_REVEAL: 'game:reveal',
    GAME_CARD_REVEALED: 'game:cardRevealed',
    GAME_CLUE: 'game:clue',
    GAME_CLUE_GIVEN: 'game:clueGiven',
    GAME_END_TURN: 'game:endTurn',
    GAME_TURN_ENDED: 'game:turnEnded',
    GAME_FORFEIT: 'game:forfeit',
    GAME_OVER: 'game:over',
    GAME_HISTORY: 'game:history',
    GAME_HISTORY_DATA: 'game:historyData',
    GAME_GET_HISTORY: 'game:getHistory',
    GAME_GET_REPLAY: 'game:getReplay',
    GAME_HISTORY_RESULT: 'game:historyResult',
    GAME_REPLAY_DATA: 'game:replayData',
    GAME_SPYMASTER_VIEW: 'game:spymasterView',
    GAME_ERROR: 'game:error',

    // Player events
    PLAYER_SET_TEAM: 'player:setTeam',
    PLAYER_SET_ROLE: 'player:setRole',
    PLAYER_SET_NICKNAME: 'player:setNickname',
    PLAYER_KICK: 'player:kick',
    PLAYER_KICKED: 'player:kicked',
    PLAYER_UPDATED: 'player:updated',
    PLAYER_DISCONNECTED: 'player:disconnected',
    PLAYER_ERROR: 'player:error',

    // Timer events
    TIMER_START: 'timer:start',
    TIMER_TICK: 'timer:tick',
    TIMER_EXPIRED: 'timer:expired',
    TIMER_PAUSE: 'timer:pause',
    TIMER_RESUME: 'timer:resume',
    TIMER_STOP: 'timer:stop',
    TIMER_ADD_TIME: 'timer:addTime',
    TIMER_STOPPED: 'timer:stopped',
    TIMER_PAUSED: 'timer:paused',
    TIMER_RESUMED: 'timer:resumed',
    TIMER_TIME_ADDED: 'timer:timeAdded',
    TIMER_STARTED: 'timer:started',
    TIMER_STATUS: 'timer:status',
    TIMER_ERROR: 'timer:error',

    // Chat events
    CHAT_MESSAGE: 'chat:message',
    CHAT_SEND: 'chat:send',
    CHAT_ERROR: 'chat:error',
    CHAT_SPECTATOR: 'chat:spectator',
    CHAT_SPECTATOR_MESSAGE: 'chat:spectatorMessage'
} as const;

// TTL constants (in seconds) - centralized for consistency
export const TTL = {
    PLAYER_CONNECTED: 24 * 60 * 60,        // 24 hours
    PLAYER_DISCONNECTED: 10 * 60,          // 10 minutes grace period for reconnection
    GAME_STATE: 24 * 60 * 60,              // 24 hours
    EVENT_LOG: 5 * 60,                     // 5 minutes
    DISTRIBUTED_LOCK: 5,                   // 5 seconds
    SESSION_VALIDATION_WINDOW: 60,         // 1 minute
    PAUSED_TIMER: 24 * 60 * 60             // 24 hours for paused timers
} as const;

// Retry configuration (centralized for all retry operations)
export const RETRY_CONFIG: Record<string, RetryConfig | { delayMs: number }> = {
    OPTIMISTIC_LOCK: { maxRetries: 3, baseDelayMs: 100 },
    REDIS_OPERATION: { maxRetries: 3, baseDelayMs: 50 },
    DISTRIBUTED_LOCK: { maxRetries: 50, baseDelayMs: 100 },
    NETWORK_REQUEST: { maxRetries: 4, baseDelayMs: 2000 },
    RACE_CONDITION: { delayMs: 100 }  // Delay between race condition retries
};

// Game service internal constants
export const GAME_INTERNALS = {
    FIRST_TEAM_SEED_OFFSET: 1000,      // Seed offset for first team shuffle
    TYPES_SHUFFLE_SEED_OFFSET: 500,    // Seed offset for card types shuffle
    LAZY_HISTORY_MULTIPLIER: 1.5       // Multiplier for lazy history threshold
} as const;

// Player service internal constants
export const PLAYER_CLEANUP = {
    INTERVAL_MS: 60000,         // Run cleanup every 60 seconds
    BATCH_SIZE: 50              // Process up to 50 cleanups per run
} as const;

// Error codes
export const ERROR_CODES = {
    ROOM_NOT_FOUND: 'ROOM_NOT_FOUND',
    ROOM_FULL: 'ROOM_FULL',
    ROOM_EXPIRED: 'ROOM_EXPIRED',
    ROOM_ALREADY_EXISTS: 'ROOM_ALREADY_EXISTS',
    GAME_IN_PROGRESS: 'GAME_IN_PROGRESS',
    NOT_HOST: 'NOT_HOST',
    NOT_SPYMASTER: 'NOT_SPYMASTER',
    NOT_CLICKER: 'NOT_CLICKER',
    NOT_YOUR_TURN: 'NOT_YOUR_TURN',
    NO_CLUE: 'NO_CLUE',  // Bug #9 fix: Error when trying to reveal without a clue
    CARD_ALREADY_REVEALED: 'CARD_ALREADY_REVEALED',
    GAME_OVER: 'GAME_OVER',
    INVALID_INPUT: 'INVALID_INPUT',
    RATE_LIMITED: 'RATE_LIMITED',
    SERVER_ERROR: 'SERVER_ERROR',
    WORD_LIST_NOT_FOUND: 'WORD_LIST_NOT_FOUND',
    NOT_AUTHORIZED: 'NOT_AUTHORIZED',
    SESSION_EXPIRED: 'SESSION_EXPIRED',
    SESSION_NOT_FOUND: 'SESSION_NOT_FOUND',
    SESSION_VALIDATION_RATE_LIMITED: 'SESSION_VALIDATION_RATE_LIMITED',
    RESERVED_NAME: 'RESERVED_NAME',
    CANNOT_SWITCH_TEAM_DURING_TURN: 'CANNOT_SWITCH_TEAM_DURING_TURN',
    CANNOT_CHANGE_ROLE_DURING_TURN: 'CANNOT_CHANGE_ROLE_DURING_TURN',
    SPYMASTER_CANNOT_CHANGE_TEAM: 'SPYMASTER_CANNOT_CHANGE_TEAM',
    PLAYER_NOT_FOUND: 'PLAYER_NOT_FOUND',
    GAME_NOT_STARTED: 'GAME_NOT_STARTED'
} as const;

// Reserved nicknames (case-insensitive)
export const RESERVED_NAMES = [
    'admin', 'administrator', 'system', 'host', 'server',
    'mod', 'moderator', 'bot', 'codenames', 'game',
    'official', 'support', 'help', 'null', 'undefined'
] as const;

// Default word list (same as client)
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
] as const;

// CommonJS export for backward compatibility
module.exports = {
    BOARD_SIZE,
    FIRST_TEAM_CARDS,
    SECOND_TEAM_CARDS,
    NEUTRAL_CARDS,
    ASSASSIN_CARDS,
    ROOM_CODE_LENGTH,
    ROOM_MAX_PLAYERS,
    ROOM_EXPIRY_HOURS,
    REDIS_TTL,
    SESSION_SECURITY,
    TIMER,
    SOCKET,
    RATE_LIMITS,
    API_RATE_LIMITS,
    GAME_HISTORY,
    VALIDATION,
    LOCKS,
    RETRIES,
    GAME_MODES,
    GAME_MODE_CONFIG,
    DUET_BOARD_CONFIG,
    TEAMS,
    ROLES,
    CARD_TYPES,
    ROOM_STATUS,
    SOCKET_EVENTS,
    TTL,
    RETRY_CONFIG,
    GAME_INTERNALS,
    PLAYER_CLEANUP,
    ERROR_CODES,
    RESERVED_NAMES,
    DEFAULT_WORDS
};
