/**
 * Redis Key Builder Utility
 *
 * Centralizes all Redis key construction to prevent typos and ensure consistency.
 * All Redis keys should be constructed using these functions.
 *
 * Key Prefixes:
 * - room:*     - Room data and metadata
 * - game:*     - Active game state
 * - player:*   - Player data
 * - timer:*    - Turn timer state
 * - lock:*     - Distributed locks
 * - session:*  - Session validation
 * - scheduled:* - Scheduled tasks
 * - wordlist:* - Custom word lists
 * - history:*  - Game history
 */

const PREFIXES = {
    ROOM: 'room',
    GAME: 'game',
    PLAYER: 'player',
    TIMER: 'timer',
    LOCK: 'lock',
    SESSION: 'session',
    SCHEDULED: 'scheduled',
    WORDLIST: 'wordlist',
    HISTORY: 'history',
    RATE_LIMIT: 'ratelimit'
};

/**
 * Room-related keys
 */
const room = {
    /** Main room info: room:{code} */
    info: (code) => `${PREFIXES.ROOM}:${code}`,

    /** Room settings: room:{code}:settings */
    settings: (code) => `${PREFIXES.ROOM}:${code}:settings`,

    /** Room players set: room:{code}:players */
    players: (code) => `${PREFIXES.ROOM}:${code}:players`,

    /** Team members set: room:{code}:team:{color} */
    team: (code, color) => `${PREFIXES.ROOM}:${code}:team:${color}`,

    /** Room host: room:{code}:host */
    host: (code) => `${PREFIXES.ROOM}:${code}:host`,

    /** Room spectators set: room:{code}:spectators */
    spectators: (code) => `${PREFIXES.ROOM}:${code}:spectators`,

    /** All active rooms set */
    activeRooms: () => `${PREFIXES.ROOM}:active`,

    /** Room chat history: room:{code}:chat */
    chat: (code) => `${PREFIXES.ROOM}:${code}:chat`,

    /** Parse room code from a room key */
    parseCode: (key) => {
        const match = key.match(/^room:([^:]+)/);
        return match ? match[1] : null;
    }
};

/**
 * Game-related keys
 */
const game = {
    /** Game state: game:{code} */
    state: (code) => `${PREFIXES.GAME}:${code}`,

    /** Game history/moves: game:{code}:history */
    history: (code) => `${PREFIXES.GAME}:${code}:history`,

    /** Current clue: game:{code}:clue */
    clue: (code) => `${PREFIXES.GAME}:${code}:clue`,

    /** Game cards: game:{code}:cards */
    cards: (code) => `${PREFIXES.GAME}:${code}:cards`,

    /** Game types (spymaster view): game:{code}:types */
    types: (code) => `${PREFIXES.GAME}:${code}:types`
};

/**
 * Player-related keys
 */
const player = {
    /** Player data: player:{sessionId} */
    data: (sessionId) => `${PREFIXES.PLAYER}:${sessionId}`,

    /** Player room mapping: player:{sessionId}:room */
    room: (sessionId) => `${PREFIXES.PLAYER}:${sessionId}:room`,

    /** Player reconnection token: player:{sessionId}:reconnect */
    reconnectToken: (sessionId) => `${PREFIXES.PLAYER}:${sessionId}:reconnect`,

    /** Parse sessionId from a player key */
    parseSessionId: (key) => {
        const match = key.match(/^player:([^:]+)/);
        return match ? match[1] : null;
    }
};

/**
 * Timer-related keys
 */
const timer = {
    /** Timer state: timer:{code} */
    state: (code) => `${PREFIXES.TIMER}:${code}`,

    /** Timer pause state: timer:{code}:paused */
    paused: (code) => `${PREFIXES.TIMER}:${code}:paused`
};

/**
 * Distributed lock keys
 */
const lock = {
    /** Host transfer lock: lock:host-transfer:{code} */
    hostTransfer: (code) => `${PREFIXES.LOCK}:host-transfer:${code}`,

    /** Timer restart lock: lock:timer-restart:{code} */
    timerRestart: (code) => `${PREFIXES.LOCK}:timer-restart:${code}`,

    /** Room creation lock: lock:room-create:{code} */
    roomCreate: (code) => `${PREFIXES.LOCK}:room-create:${code}`,

    /** Game state lock: lock:game:{code} */
    gameState: (code) => `${PREFIXES.LOCK}:game:${code}`,

    /** Generic lock with custom name */
    custom: (name) => `${PREFIXES.LOCK}:${name}`
};

/**
 * Session validation keys
 */
const session = {
    /** Session validation attempts: session:{ip}:attempts */
    attempts: (ip) => `${PREFIXES.SESSION}:${ip}:attempts`,

    /** Session validation window: session:{sessionId}:validated */
    validated: (sessionId) => `${PREFIXES.SESSION}:${sessionId}:validated`
};

/**
 * Scheduled task keys
 */
const scheduled = {
    /** Player cleanup sorted set */
    playerCleanup: () => `${PREFIXES.SCHEDULED}:player:cleanup`,

    /** Room cleanup sorted set */
    roomCleanup: () => `${PREFIXES.SCHEDULED}:room:cleanup`
};

/**
 * Word list keys
 */
const wordlist = {
    /** Word list data: wordlist:{id} */
    data: (id) => `${PREFIXES.WORDLIST}:${id}`,

    /** All word lists index */
    index: () => `${PREFIXES.WORDLIST}:index`
};

/**
 * Game history keys (for replay)
 */
const history = {
    /** Room game history list: history:{code}:games */
    roomGames: (code) => `${PREFIXES.HISTORY}:${code}:games`,

    /** Specific game replay: history:game:{gameId} */
    gameReplay: (gameId) => `${PREFIXES.HISTORY}:game:${gameId}`
};

/**
 * Rate limiting keys
 */
const rateLimit = {
    /** Rate limit counter: ratelimit:{event}:{identifier} */
    counter: (event, identifier) => `${PREFIXES.RATE_LIMIT}:${event}:${identifier}`,

    /** IP-based rate limit: ratelimit:ip:{ip}:{event} */
    ip: (ip, event) => `${PREFIXES.RATE_LIMIT}:ip:${ip}:${event}`,

    /** Session-based rate limit: ratelimit:session:{sessionId}:{event} */
    session: (sessionId, event) => `${PREFIXES.RATE_LIMIT}:session:${sessionId}:${event}`
};

/**
 * Pattern generators for SCAN operations
 */
const patterns = {
    /** All room keys */
    allRooms: () => `${PREFIXES.ROOM}:*`,

    /** All players in a room */
    roomPlayers: (code) => `${PREFIXES.ROOM}:${code}:*`,

    /** All player keys */
    allPlayers: () => `${PREFIXES.PLAYER}:*`,

    /** All game keys */
    allGames: () => `${PREFIXES.GAME}:*`,

    /** All timer keys */
    allTimers: () => `${PREFIXES.TIMER}:*`,

    /** All lock keys */
    allLocks: () => `${PREFIXES.LOCK}:*`
};

module.exports = {
    PREFIXES,
    room,
    game,
    player,
    timer,
    lock,
    session,
    scheduled,
    wordlist,
    history,
    rateLimit,
    patterns
};
