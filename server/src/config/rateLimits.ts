/**
 * Rate Limit Configuration
 *
 * Rate limits for socket events and HTTP API endpoints.
 */

/**
 * Rate limit configuration
 */
export interface RateLimitConfig {
    window: number;
    max: number;
}

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
    'room:getReconnectionToken': { window: 10000, max: 2 },  // 2 per 10 seconds (reduced from 5 to limit CPU exhaustion from crypto ops)
    // Game events
    'game:start': { window: 5000, max: 2 },       // 2 per 5 seconds
    'game:reveal': { window: 1000, max: 5 },      // 5 per second
    'game:endTurn': { window: 2000, max: 3 },     // 3 per 2 seconds
    'game:forfeit': { window: 10000, max: 2 },    // 2 per 10 seconds
    'game:history': { window: 5000, max: 5 },     // 5 per 5 seconds
    'game:getHistory': { window: 5000, max: 5 },  // 5 per 5 seconds
    'game:getReplay': { window: 5000, max: 5 },   // 5 per 5 seconds
    // Player events (keys match event names for consistency)
    'player:setTeam': { window: 2000, max: 5 },      // 5 per 2 seconds
    'player:setRole': { window: 2000, max: 5 },      // 5 per 2 seconds
    'player:setNickname': { window: 5000, max: 3 },  // 3 per 5 seconds
    'player:kick': { window: 5000, max: 3 },         // 3 per 5 seconds (host only)
    // Chat events
    'chat:message': { window: 5000, max: 10 },    // 10 per 5 seconds
    'chat:spectator': { window: 5000, max: 10 },  // 10 per 5 seconds (spectator-only chat)
    // Spectator events
    'spectator:requestJoin': { window: 10000, max: 3 },   // 3 per 10 seconds
    'spectator:approveJoin': { window: 5000, max: 5 },    // 5 per 5 seconds (host only)
    'spectator:denyJoin': { window: 5000, max: 5 },       // 5 per 5 seconds (host only)
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
    ROOM_EXISTS: { window: 60000, max: 30 },     // 30 per minute (prevents room enumeration)
    ADMIN: { window: 60000, max: 10 }            // 10 per minute for admin endpoints (limits brute force)
} as const;
