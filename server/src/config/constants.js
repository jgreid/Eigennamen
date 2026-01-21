/**
 * Game Constants
 *
 * Centralized configuration for all game settings, rate limits, and system parameters.
 * This file serves as the single source of truth for all configurable values.
 */

module.exports = {
    // Board configuration
    BOARD_SIZE: 25,
    FIRST_TEAM_CARDS: 9,
    SECOND_TEAM_CARDS: 8,
    NEUTRAL_CARDS: 7,
    ASSASSIN_CARDS: 1,

    // Room configuration
    ROOM_CODE_LENGTH: 6,
    ROOM_MAX_PLAYERS: 20,
    ROOM_EXPIRY_HOURS: 24,

    // Redis TTLs (in seconds)
    REDIS_TTL: {
        ROOM: 24 * 60 * 60,      // 24 hours
        PLAYER: 24 * 60 * 60,    // 24 hours (same as room to prevent orphaned players)
        SESSION_SOCKET: 5 * 60,  // 5 minutes
        DISCONNECTED_PLAYER: 10 * 60,  // 10 minutes grace period for reconnection
        PAUSED_TIMER: 24 * 60 * 60,  // 24 hours for paused timers
        SESSION_VALIDATION_WINDOW: 60  // 1 minute window for session validation rate limiting
    },

    // Session security configuration
    SESSION_SECURITY: {
        MAX_SESSION_AGE_MS: 24 * 60 * 60 * 1000,     // 24 hours max session lifetime
        MAX_VALIDATION_ATTEMPTS_PER_IP: 20,          // Max validation attempts per IP per minute
        IP_MISMATCH_ALLOWED: true,                   // Allow reconnection from different IP (logged for monitoring)
        SESSION_ID_MIN_LENGTH: 36                    // UUID length
    },

    // Password security configuration
    PASSWORD_SECURITY: {
        BCRYPT_SALT_ROUNDS: 10,              // Increased from 8 for better security
        MIN_PASSWORD_LENGTH: 1,              // Minimum password length
        MAX_PASSWORD_LENGTH: 50,             // Maximum password length
        REQUIRE_REAUTH_ON_CHANGE: true       // Require re-auth when room password changes (security fix)
    },

    // Turn timer configuration
    TIMER: {
        DEFAULT_TURN_SECONDS: 120,  // 2 minutes default
        MIN_TURN_SECONDS: 30,
        MAX_TURN_SECONDS: 300,
        WARNING_SECONDS: 30,        // Warn when this many seconds remain
        // Timer service internals
        ORPHAN_CHECK_INTERVAL_MS: 30000,  // How often to check for orphaned timers
        ORPHAN_CHECK_TIMEOUT_MS: 5000,    // Max time for orphan check
        MAX_ORPHAN_KEYS: 100,             // Max keys to process per orphan check
        TIMER_TTL_BUFFER_SECONDS: 60      // Extra TTL buffer for timer keys
    },

    // Rate limits for socket events
    // Keys match the rate limit identifiers used in handlers (not necessarily the event names)
    RATE_LIMITS: {
        // Room events
        'room:create': { window: 60000, max: 5 },     // 5 per minute
        'room:join': { window: 60000, max: 10 },      // 10 per minute
        'room:leave': { window: 60000, max: 10 },     // 10 per minute
        'room:settings': { window: 5000, max: 5 },    // 5 per 5 seconds
        // Game events
        'game:start': { window: 5000, max: 2 },       // 2 per 5 seconds
        'game:reveal': { window: 1000, max: 5 },      // 5 per second
        'game:clue': { window: 5000, max: 2 },        // 2 per 5 seconds
        'game:endTurn': { window: 2000, max: 3 },     // 3 per 2 seconds
        'game:forfeit': { window: 10000, max: 2 },    // 2 per 10 seconds
        'game:history': { window: 5000, max: 5 },     // 5 per 5 seconds
        // Player events (keys match handler rate limit identifiers)
        'player:team': { window: 2000, max: 5 },      // 5 per 2 seconds
        'player:role': { window: 2000, max: 5 },      // 5 per 2 seconds
        'player:nickname': { window: 5000, max: 3 },  // 3 per 5 seconds
        // Chat events
        'chat:message': { window: 5000, max: 10 },    // 10 per 5 seconds
        // Timer events
        'timer:status': { window: 1000, max: 10 }     // 10 per second
    },

    // HTTP API rate limits
    API_RATE_LIMITS: {
        GENERAL: { window: 60000, max: 100 },        // 100 per minute
        WORD_LIST_CREATE: { window: 60000, max: 10 } // 10 per minute
    },

    // Game history configuration
    GAME_HISTORY: {
        MAX_ENTRIES: 200  // Maximum history entries per game
    },

    // Validation constraints
    VALIDATION: {
        NICKNAME_MIN_LENGTH: 1,
        NICKNAME_MAX_LENGTH: 30,
        TEAM_NAME_MAX_LENGTH: 20,
        CLUE_MAX_LENGTH: 50,
        CLUE_NUMBER_MIN: 0,
        CLUE_NUMBER_MAX: 25,
        CHAT_MESSAGE_MAX_LENGTH: 500,
        WORD_MIN_LENGTH: 2,
        WORD_MAX_LENGTH: 30,
        WORD_LIST_MIN_SIZE: 25,  // BOARD_SIZE
        WORD_LIST_MAX_SIZE: 500
    },

    // Lock timeouts (in seconds)
    LOCKS: {
        SPYMASTER_ROLE: 5,        // Lock for spymaster role assignment
        HOST_TRANSFER: 3,         // Lock for host transfer (reduced from 10s - DB ops are fast)
        TIMER_RESTART: 5          // Lock for timer restart
    },

    // Retry configuration
    RETRIES: {
        OPTIMISTIC_LOCK: 3,       // Retries for optimistic locking operations
        PUB_SUB_CONNECT: 3,       // Retries for pub/sub connection
        PUSH_RETRY_DELAYS: [2000, 4000, 8000, 16000]  // Exponential backoff
    },

    // Game teams and roles
    TEAMS: ['red', 'blue'],
    ROLES: ['spymaster', 'clicker', 'spectator'],
    CARD_TYPES: ['red', 'blue', 'neutral', 'assassin'],

    // Room statuses
    ROOM_STATUS: {
        WAITING: 'waiting',
        PLAYING: 'playing',
        FINISHED: 'finished'
    },

    // Socket event names (centralized to prevent typos and enable IDE autocomplete)
    SOCKET_EVENTS: {
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
        GAME_SPYMASTER_VIEW: 'game:spymasterView',
        GAME_ERROR: 'game:error',

        // Player events
        PLAYER_SET_TEAM: 'player:setTeam',
        PLAYER_SET_ROLE: 'player:setRole',
        PLAYER_SET_NICKNAME: 'player:setNickname',
        PLAYER_UPDATED: 'player:updated',
        PLAYER_DISCONNECTED: 'player:disconnected',
        PLAYER_ERROR: 'player:error',

        // Timer events
        TIMER_START: 'timer:start',
        TIMER_TICK: 'timer:tick',
        TIMER_EXPIRED: 'timer:expired',
        TIMER_PAUSE: 'timer:pause',
        TIMER_RESUME: 'timer:resume',
        TIMER_STATUS: 'timer:status',

        // Chat events
        CHAT_MESSAGE: 'chat:message',
        CHAT_SEND: 'chat:send',
        CHAT_ERROR: 'chat:error'
    },

    // TTL constants (in seconds) - centralized for consistency
    TTL: {
        PLAYER_CONNECTED: 24 * 60 * 60,        // 24 hours
        PLAYER_DISCONNECTED: 10 * 60,          // 10 minutes grace period for reconnection
        GAME_STATE: 24 * 60 * 60,              // 24 hours
        EVENT_LOG: 5 * 60,                     // 5 minutes
        DISTRIBUTED_LOCK: 5,                   // 5 seconds
        SESSION_VALIDATION_WINDOW: 60,         // 1 minute
        PAUSED_TIMER: 24 * 60 * 60             // 24 hours for paused timers
    },

    // Retry configuration (centralized for all retry operations)
    RETRY_CONFIG: {
        OPTIMISTIC_LOCK: { maxRetries: 3, baseDelayMs: 100 },
        REDIS_OPERATION: { maxRetries: 3, baseDelayMs: 50 },
        DISTRIBUTED_LOCK: { maxRetries: 50, baseDelayMs: 100 },
        PUB_SUB_CONNECT: { maxRetries: 3, baseDelayMs: 1000 },
        NETWORK_REQUEST: { maxRetries: 4, baseDelayMs: 2000 }
    },

    // Error codes
    ERROR_CODES: {
        ROOM_NOT_FOUND: 'ROOM_NOT_FOUND',
        ROOM_FULL: 'ROOM_FULL',
        ROOM_EXPIRED: 'ROOM_EXPIRED',
        ROOM_PASSWORD_REQUIRED: 'ROOM_PASSWORD_REQUIRED',
        ROOM_PASSWORD_INVALID: 'ROOM_PASSWORD_INVALID',
        ROOM_PASSWORD_CHANGED: 'ROOM_PASSWORD_CHANGED',
        GAME_IN_PROGRESS: 'GAME_IN_PROGRESS',
        NOT_HOST: 'NOT_HOST',
        NOT_SPYMASTER: 'NOT_SPYMASTER',
        NOT_CLICKER: 'NOT_CLICKER',
        NOT_YOUR_TURN: 'NOT_YOUR_TURN',
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
        CANNOT_SWITCH_TEAM_DURING_TURN: 'CANNOT_SWITCH_TEAM_DURING_TURN'
    },

    // Reserved nicknames (case-insensitive)
    RESERVED_NAMES: [
        'admin', 'administrator', 'system', 'host', 'server',
        'mod', 'moderator', 'bot', 'codenames', 'game',
        'official', 'support', 'help', 'null', 'undefined'
    ],

    // Default word list (same as client)
    DEFAULT_WORDS: [
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
    ]
};
