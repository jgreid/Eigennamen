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
} as const;

type PrefixType = typeof PREFIXES[keyof typeof PREFIXES];

/**
 * Room-related keys
 */
const room = {
    /** Main room info: room:{code} */
    info: (code: string): string => `${PREFIXES.ROOM}:${code}`,

    /** Room settings: room:{code}:settings */
    settings: (code: string): string => `${PREFIXES.ROOM}:${code}:settings`,

    /** Room players set: room:{code}:players */
    players: (code: string): string => `${PREFIXES.ROOM}:${code}:players`,

    /** Team members set: room:{code}:team:{color} */
    team: (code: string, color: string): string => `${PREFIXES.ROOM}:${code}:team:${color}`,

    /** Room host: room:{code}:host */
    host: (code: string): string => `${PREFIXES.ROOM}:${code}:host`,

    /** Room spectators set: room:{code}:spectators */
    spectators: (code: string): string => `${PREFIXES.ROOM}:${code}:spectators`,

    /** All active rooms set */
    activeRooms: (): string => `${PREFIXES.ROOM}:active`,

    /** Room chat history: room:{code}:chat */
    chat: (code: string): string => `${PREFIXES.ROOM}:${code}:chat`,

    /** Parse room code from a room key */
    parseCode: (key: string): string | null => {
        const match = key.match(/^room:([^:]+)/);
        return match ? (match[1] ?? null) : null;
    }
};

/**
 * Game-related keys
 */
const game = {
    /** Game state: game:{code} */
    state: (code: string): string => `${PREFIXES.GAME}:${code}`,

    /** Game history/moves: game:{code}:history */
    history: (code: string): string => `${PREFIXES.GAME}:${code}:history`,

    /** Current clue: game:{code}:clue */
    clue: (code: string): string => `${PREFIXES.GAME}:${code}:clue`,

    /** Game cards: game:{code}:cards */
    cards: (code: string): string => `${PREFIXES.GAME}:${code}:cards`,

    /** Game types (spymaster view): game:{code}:types */
    types: (code: string): string => `${PREFIXES.GAME}:${code}:types`
};

/**
 * Player-related keys
 */
const player = {
    /** Player data: player:{sessionId} */
    data: (sessionId: string): string => `${PREFIXES.PLAYER}:${sessionId}`,

    /** Player room mapping: player:{sessionId}:room */
    room: (sessionId: string): string => `${PREFIXES.PLAYER}:${sessionId}:room`,

    /** Player reconnection token: player:{sessionId}:reconnect */
    reconnectToken: (sessionId: string): string => `${PREFIXES.PLAYER}:${sessionId}:reconnect`,

    /** Parse sessionId from a player key */
    parseSessionId: (key: string): string | null => {
        const match = key.match(/^player:([^:]+)/);
        return match ? (match[1] ?? null) : null;
    }
};

/**
 * Timer-related keys
 */
const timer = {
    /** Timer state: timer:{code} */
    state: (code: string): string => `${PREFIXES.TIMER}:${code}`,

    /** Timer pause state: timer:{code}:paused */
    paused: (code: string): string => `${PREFIXES.TIMER}:${code}:paused`
};

/**
 * Distributed lock keys
 */
const lock = {
    /** Host transfer lock: lock:host-transfer:{code} */
    hostTransfer: (code: string): string => `${PREFIXES.LOCK}:host-transfer:${code}`,

    /** Timer restart lock: lock:timer-restart:{code} */
    timerRestart: (code: string): string => `${PREFIXES.LOCK}:timer-restart:${code}`,

    /** Room creation lock: lock:room-create:{code} */
    roomCreate: (code: string): string => `${PREFIXES.LOCK}:room-create:${code}`,

    /** Game state lock: lock:game:{code} */
    gameState: (code: string): string => `${PREFIXES.LOCK}:game:${code}`,

    /** Generic lock with custom name */
    custom: (name: string): string => `${PREFIXES.LOCK}:${name}`
};

/**
 * Session validation keys
 */
const session = {
    /** Session validation attempts: session:{ip}:attempts */
    attempts: (ip: string): string => `${PREFIXES.SESSION}:${ip}:attempts`,

    /** Session validation window: session:{sessionId}:validated */
    validated: (sessionId: string): string => `${PREFIXES.SESSION}:${sessionId}:validated`
};

/**
 * Scheduled task keys
 */
const scheduled = {
    /** Player cleanup sorted set */
    playerCleanup: (): string => `${PREFIXES.SCHEDULED}:player:cleanup`,

    /** Room cleanup sorted set */
    roomCleanup: (): string => `${PREFIXES.SCHEDULED}:room:cleanup`
};

/**
 * Word list keys
 */
const wordlist = {
    /** Word list data: wordlist:{id} */
    data: (id: string): string => `${PREFIXES.WORDLIST}:${id}`,

    /** All word lists index */
    index: (): string => `${PREFIXES.WORDLIST}:index`
};

/**
 * Game history keys (for replay)
 */
const history = {
    /** Room game history list: history:{code}:games */
    roomGames: (code: string): string => `${PREFIXES.HISTORY}:${code}:games`,

    /** Specific game replay: history:game:{gameId} */
    gameReplay: (gameId: string): string => `${PREFIXES.HISTORY}:game:${gameId}`
};

/**
 * Rate limiting keys
 */
const rateLimit = {
    /** Rate limit counter: ratelimit:{event}:{identifier} */
    counter: (event: string, identifier: string): string => `${PREFIXES.RATE_LIMIT}:${event}:${identifier}`,

    /** IP-based rate limit: ratelimit:ip:{ip}:{event} */
    ip: (ip: string, event: string): string => `${PREFIXES.RATE_LIMIT}:ip:${ip}:${event}`,

    /** Session-based rate limit: ratelimit:session:{sessionId}:{event} */
    session: (sessionId: string, event: string): string => `${PREFIXES.RATE_LIMIT}:session:${sessionId}:${event}`
};

/**
 * Pattern generators for SCAN operations
 */
const patterns = {
    /** All room keys */
    allRooms: (): string => `${PREFIXES.ROOM}:*`,

    /** All players in a room */
    roomPlayers: (code: string): string => `${PREFIXES.ROOM}:${code}:*`,

    /** All player keys */
    allPlayers: (): string => `${PREFIXES.PLAYER}:*`,

    /** All game keys */
    allGames: (): string => `${PREFIXES.GAME}:*`,

    /** All timer keys */
    allTimers: (): string => `${PREFIXES.TIMER}:*`,

    /** All lock keys */
    allLocks: (): string => `${PREFIXES.LOCK}:*`
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

// ES6 exports for TypeScript imports
export {
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

export type { PrefixType };
