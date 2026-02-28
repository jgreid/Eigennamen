// Socket.io configuration
export const SOCKET = {
    PING_TIMEOUT_MS: 60000,           // Ping timeout (60 seconds)
    PING_INTERVAL_MS: 25000,          // Ping interval (25 seconds)
    MAX_DISCONNECTION_DURATION_MS: 2 * 60 * 1000,  // 2 minutes for connection recovery
    SOCKET_COUNT_CACHE_MS: 5000,      // Cache socket count for 5 seconds
    SOCKET_COUNT_TIMEOUT_MS: 2000,    // Timeout for fetching socket count
    REDIS_KEEPALIVE_MS: 10000,        // Redis keepalive interval
    MAX_CONNECTIONS_PER_IP: 10,       // Max concurrent socket connections per IP
    MAX_HTTP_BUFFER_SIZE: 100 * 1024, // 100KB max message size
    DISCONNECT_TIMEOUT_MS: 30000,     // Timeout for disconnect handler to prevent hangs
    CONNECTIONS_CLEANUP_INTERVAL_MS: 5 * 60 * 1000, // Recount connections per IP every 5 minutes
    SHUTDOWN_DRAIN_MS: 2000,          // Grace period before force-disconnecting sockets on shutdown
    AUTH_FAILURE_MAX_PER_IP: 10,      // Max auth failures per IP within the window before blocking
    AUTH_FAILURE_WINDOW_MS: 60 * 1000, // 1 minute sliding window for auth failure tracking
    AUTH_FAILURE_BLOCK_MS: 5 * 60 * 1000 // Block IP for 5 minutes after exceeding auth failure limit
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
    ROOM_WARNING: 'room:warning',
    ROOM_ERROR: 'room:error',

    // Game events
    GAME_START: 'game:start',
    GAME_STARTED: 'game:started',
    GAME_REVEAL: 'game:reveal',
    GAME_CARD_REVEALED: 'game:cardRevealed',
    GAME_END_TURN: 'game:endTurn',
    GAME_TURN_ENDED: 'game:turnEnded',
    GAME_FORFEIT: 'game:forfeit',
    GAME_OVER: 'game:over',
    GAME_GET_HISTORY: 'game:getHistory',
    GAME_GET_REPLAY: 'game:getReplay',
    GAME_HISTORY_RESULT: 'game:historyResult',
    GAME_REPLAY_DATA: 'game:replayData',
    GAME_SPYMASTER_VIEW: 'game:spymasterView',
    GAME_NEXT_ROUND: 'game:nextRound',
    GAME_ROUND_ENDED: 'game:roundEnded',
    GAME_MATCH_OVER: 'game:matchOver',
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
    CHAT_ERROR: 'chat:error',
    CHAT_SPECTATOR: 'chat:spectator',
    CHAT_SPECTATOR_MESSAGE: 'chat:spectatorMessage',

    // Spectator events
    SPECTATOR_REQUEST_JOIN: 'spectator:requestJoin',
    SPECTATOR_JOIN_REQUEST: 'spectator:joinRequest',
    SPECTATOR_APPROVE_JOIN: 'spectator:approveJoin',
    SPECTATOR_JOIN_APPROVED: 'spectator:joinApproved',
    SPECTATOR_JOIN_DENIED: 'spectator:joinDenied'
} as const;

/** Union type of all valid socket event name strings */
export type SocketEventName = typeof SOCKET_EVENTS[keyof typeof SOCKET_EVENTS];
