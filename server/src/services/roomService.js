/**
 * Room Service - Room management logic
 *
 * Simplified room system:
 * - Host provides a room ID when creating (serves as both name and access key)
 * - Players join by entering the room ID
 * - No separate password needed
 */

const { getRedis } = require('../config/redis');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');
const playerService = require('./playerService');
const gameService = require('./gameService');
const timerService = require('./timerService');
const { withTimeout, TIMEOUTS } = require('../utils/timeout');
const { toEnglishLowerCase } = require('../utils/sanitize');
const {
    ROOM_MAX_PLAYERS,
    REDIS_TTL,
    ROOM_STATUS,
    ERROR_CODES
} = require('../config/constants');
const { RoomError, PlayerError, ServerError } = require('../errors/GameError');

/**
 * Lua script for atomic room creation
 * Uses SETNX (SET if Not eXists) to prevent race conditions
 * Returns: 1 if created successfully, 0 if room already exists
 */
const ATOMIC_CREATE_ROOM_SCRIPT = `
local roomKey = KEYS[1]
local playersKey = KEYS[2]
local roomData = ARGV[1]
local ttl = tonumber(ARGV[2])

-- Atomically try to create the room (only if it doesn't exist)
local created = redis.call('SETNX', roomKey, roomData)
if created == 0 then
    return 0
end

-- Set TTL on the room
redis.call('EXPIRE', roomKey, ttl)

-- Initialize empty players set with same TTL
redis.call('DEL', playersKey)
redis.call('EXPIRE', playersKey, ttl)

return 1
`;

/**
 * Create a new room with host-provided room ID
 * @param {string} roomId - Room ID provided by the host (serves as room name/access key)
 * @param {string} hostSessionId - Session ID of the host
 * @param {object} settings - Room settings
 */
async function createRoom(roomId, hostSessionId, settings = {}) {
    const redis = getRedis();

    // Normalize room ID (case-insensitive)
    const normalizedRoomId = toEnglishLowerCase(roomId);

    // Extract nickname from settings
    const { nickname: hostNickname, ...cleanSettings } = settings;

    const room = {
        id: uuidv4(),
        code: normalizedRoomId,  // Use normalized room ID as the code
        roomId: roomId,          // Keep original for display
        hostSessionId,
        status: ROOM_STATUS.WAITING,
        settings: {
            teamNames: { red: 'Red', blue: 'Blue' },
            turnTimer: null,
            allowSpectators: true,
            ...cleanSettings
        },
        createdAt: Date.now(),
        expiresAt: Date.now() + (REDIS_TTL.ROOM * 1000)
    };

    // Atomically try to create the room
    // BUG FIX: Wrap redis.eval with timeout to prevent hanging operations
    const created = await withTimeout(
        redis.eval(
            ATOMIC_CREATE_ROOM_SCRIPT,
            {
                keys: [`room:${normalizedRoomId}`, `room:${normalizedRoomId}:players`],
                arguments: [JSON.stringify(room), REDIS_TTL.ROOM.toString()]
            }
        ),
        TIMEOUTS.REDIS_OPERATION,
        `createRoom-lua-${normalizedRoomId}`
    );

    if (created === 0) {
        // Room already exists
        throw new RoomError(
            ERROR_CODES.ROOM_ALREADY_EXISTS,
            `Room "${roomId}" already exists. Choose a different room ID or join the existing room.`,
            { roomId }
        );
    }

    // Create host player with provided nickname or default to 'Host'
    const player = await playerService.createPlayer(hostSessionId, normalizedRoomId, hostNickname || 'Host', true);
    logger.info(`Room "${roomId}" created by ${hostSessionId}`);

    return { room, player };
}

/**
 * Get room by room ID (case-insensitive)
 */
async function getRoom(roomId) {
    const redis = getRedis();
    // Normalize room ID for case-insensitive lookup
    const normalizedId = toEnglishLowerCase(roomId);
    const roomData = await redis.get(`room:${normalizedId}`);

    if (!roomData) {
        return null;
    }

    try {
        return JSON.parse(roomData);
    } catch (e) {
        logger.error(`Failed to parse room data for ${roomId}:`, e.message);
        return null;
    }
}

/**
 * Lua script for atomic room join with capacity check
 * Returns: 1 if added successfully, 0 if room is full, -1 if already a member
 */
const ATOMIC_JOIN_SCRIPT = `
local playersKey = KEYS[1]
local maxPlayers = tonumber(ARGV[1])
local sessionId = ARGV[2]

-- Check if already a member
if redis.call('SISMEMBER', playersKey, sessionId) == 1 then
    return -1
end

-- Check capacity and add atomically
local currentCount = redis.call('SCARD', playersKey)
if currentCount >= maxPlayers then
    return 0
end

redis.call('SADD', playersKey, sessionId)
return 1
`;

/**
 * Join an existing room
 * Uses Lua script for atomic capacity check and add to prevent race conditions
 * @param {string} roomId - Room ID (case-insensitive)
 * @param {string} sessionId - Player's session ID
 * @param {string} nickname - Player's nickname
 */
async function joinRoom(roomId, sessionId, nickname) {
    const redis = getRedis();

    // Normalize room ID (case-insensitive)
    const normalizedRoomId = toEnglishLowerCase(roomId);

    // Get room
    const room = await getRoom(normalizedRoomId);
    if (!room) {
        throw RoomError.notFound(roomId);
    }

    // Check if player is already in room (reconnecting)
    let player = await playerService.getPlayer(sessionId);
    let isReconnecting = false;

    if (player && player.roomCode === normalizedRoomId) {
        // Reconnection - update player status
        player = await playerService.updatePlayer(sessionId, { connected: true, lastSeen: Date.now() });
        isReconnecting = true;
        logger.info(`Player ${sessionId} reconnected to room "${roomId}"`);
    } else {
        // New join - use Lua script for atomic capacity check and add
        // BUG FIX: Wrap redis.eval with timeout to prevent hanging operations
        const result = await withTimeout(
            redis.eval(
                ATOMIC_JOIN_SCRIPT,
                {
                    keys: [`room:${normalizedRoomId}:players`],
                    arguments: [ROOM_MAX_PLAYERS.toString(), sessionId]
                }
            ),
            TIMEOUTS.REDIS_OPERATION,
            `joinRoom-lua-${normalizedRoomId}`
        );

        if (result === 0) {
            throw RoomError.full(roomId);
        }

        if (result === -1) {
            // Already a member but player data might be missing - treat as reconnection
            player = await playerService.createPlayer(sessionId, normalizedRoomId, nickname, false);
            isReconnecting = true;
        } else if (result === 1) {
            // Successfully added to set, now create player data
            try {
                player = await playerService.createPlayer(sessionId, normalizedRoomId, nickname, false, false);
            } catch (error) {
                // Rollback: remove from players set
                logger.warn(`Player data creation failed for ${sessionId}, rolling back set addition`);
                await redis.sRem(`room:${normalizedRoomId}:players`, sessionId);
                throw error;
            }
        } else {
            // Unexpected result - log and throw error
            logger.error('Unexpected result from room join script', { result, roomId });
            throw new ServerError('Failed to join room due to unexpected error');
        }

        logger.info(`Player ${nickname} (${sessionId}) joined room "${roomId}"`);
    }

    // Get current game if any
    const game = await gameService.getGame(normalizedRoomId);
    const gameState = game ? gameService.getGameStateForPlayer(game, player) : null;

    // Refresh all room-related TTLs
    await refreshRoomTTL(normalizedRoomId);

    return {
        room,
        players: await playerService.getPlayersInRoom(normalizedRoomId),
        game: gameState,
        player,
        isReconnecting
    };
}

/**
 * Leave a room
 */
async function leaveRoom(code, sessionId) {
    const redis = getRedis();
    code = toEnglishLowerCase(code);
    const room = await getRoom(code);

    if (!room) {
        return { newHostId: null, roomDeleted: false };
    }

    // Remove player
    await playerService.removePlayer(sessionId);

    // Get remaining players
    const players = await playerService.getPlayersInRoom(code);

    let newHostId = null;
    let roomDeleted = false;

    // FIX H4: Use atomic host transfer instead of two separate operations
    // Previously had a race condition window between room update and player update
    if (room.hostSessionId === sessionId && players.length > 0) {
        newHostId = players[0].sessionId;
        const transferResult = await playerService.atomicHostTransfer(sessionId, newHostId, code);
        if (!transferResult.success) {
            logger.warn(`Non-atomic host transfer fallback for room ${code}: ${transferResult.reason}`);
            // Fallback to non-atomic if Lua script fails (e.g., memory mode)
            room.hostSessionId = newHostId;
            await redis.set(`room:${code}`, JSON.stringify(room), { EX: REDIS_TTL.ROOM });
            await playerService.updatePlayer(newHostId, { isHost: true });
        }
    }

    // If no players left, clean up room completely
    if (players.length === 0) {
        await cleanupRoom(code);
        roomDeleted = true;
    }

    return { newHostId, roomDeleted };
}

/**
 * Update room settings (host only)
 * @param {string} code - Room code
 * @param {string} sessionId - Session ID of the requester
 * @param {object} newSettings - New settings
 */
async function updateSettings(code, sessionId, newSettings) {
    const redis = getRedis();
    const room = await getRoom(code);

    if (!room) {
        throw RoomError.notFound(code);
    }

    if (room.hostSessionId !== sessionId) {
        throw PlayerError.notHost();
    }

    // Whitelist allowed settings keys to prevent arbitrary key injection
    const allowedKeys = ['teamNames', 'turnTimer', 'allowSpectators'];
    const sanitizedSettings = {};
    for (const key of allowedKeys) {
        if (key in newSettings) {
            sanitizedSettings[key] = newSettings[key];
        }
    }

    room.settings = {
        ...room.settings,
        ...sanitizedSettings
    };

    await redis.set(`room:${code}`, JSON.stringify(room), { EX: REDIS_TTL.ROOM });

    return {
        ...room.settings
    };
}

/**
 * Check if room exists
 */
async function roomExists(code) {
    const redis = getRedis();
    const normalizedCode = toEnglishLowerCase(code);
    return await redis.exists(`room:${normalizedCode}`) === 1;
}

/**
 * Lua script for atomic TTL refresh of all room-related keys
 * ISSUE #8 FIX: Prevents TTL race condition by refreshing all keys atomically
 */
const ATOMIC_REFRESH_TTL_SCRIPT = `
local roomKey = KEYS[1]
local playersKey = KEYS[2]
local gameKey = KEYS[3]
local redTeamKey = KEYS[4]
local blueTeamKey = KEYS[5]
local ttl = tonumber(ARGV[1])

-- Refresh room TTL (only if key exists)
if redis.call('EXISTS', roomKey) == 1 then
    redis.call('EXPIRE', roomKey, ttl)
end

-- Refresh players list TTL (only if key exists)
if redis.call('EXISTS', playersKey) == 1 then
    redis.call('EXPIRE', playersKey, ttl)
end

-- Refresh game TTL (only if key exists)
if redis.call('EXISTS', gameKey) == 1 then
    redis.call('EXPIRE', gameKey, ttl)
end

-- Refresh team sets TTL (only if key exists)
if redis.call('EXISTS', redTeamKey) == 1 then
    redis.call('EXPIRE', redTeamKey, ttl)
end
if redis.call('EXISTS', blueTeamKey) == 1 then
    redis.call('EXPIRE', blueTeamKey, ttl)
end

return 1
`;

/**
 * Refresh TTL for all room-related keys atomically
 * ISSUE #8 FIX: Uses Lua script to prevent TTL race condition
 */
async function refreshRoomTTL(code) {
    const redis = getRedis();

    // BUG FIX: Wrap redis.eval with timeout to prevent hanging operations
    await withTimeout(
        redis.eval(
            ATOMIC_REFRESH_TTL_SCRIPT,
            {
                keys: [
                    `room:${code}`,
                    `room:${code}:players`,
                    `room:${code}:game`,
                    `room:${code}:team:red`,
                    `room:${code}:team:blue`
                ],
                arguments: [REDIS_TTL.ROOM.toString()]
            }
        ),
        TIMEOUTS.REDIS_OPERATION,
        `refreshRoomTTL-lua-${code}`
    );
}

/**
 * Clean up all data associated with a room
 * ISSUE #4 FIX: Now includes team sets in cleanup
 * Uses parallel operations for better performance
 */
async function cleanupRoom(code) {
    const redis = getRedis();

    // Stop any active timer for this room (prevents memory leak)
    await timerService.stopTimer(code);

    const room = await getRoom(code);

    // Get all players in room
    const sessionIds = await redis.sMembers(`room:${code}:players`);

    // Get reconnection tokens for all players before deleting
    const reconnectTokens = await Promise.all(
        sessionIds.map(sessionId => redis.get(`reconnect:session:${sessionId}`))
    );

    // ISSUE #4 FIX: Build list of all keys to delete including team sets
    const keysToDelete = [
        ...sessionIds.map(sessionId => `player:${sessionId}`),
        ...sessionIds.map(sessionId => `session:${sessionId}:socket`), // Also clean socket mappings
        ...sessionIds.map(sessionId => `reconnect:session:${sessionId}`), // Clean reconnection session keys
        ...reconnectTokens.filter(Boolean).map(token => `reconnect:token:${token}`), // Clean reconnection token keys
        `room:${code}`,
        `room:${code}:players`,
        `room:${code}:game`,
        `room:${code}:team:red`,   // ISSUE #4 FIX: Include team sets
        `room:${code}:team:blue`   // ISSUE #4 FIX: Include team sets
    ];

    // Delete all keys in parallel using DEL with multiple keys (single Redis call)
    if (keysToDelete.length > 0) {
        await redis.del(keysToDelete);
    }

    logger.info(`Room ${code} and all associated data cleaned up`);
}

/**
 * Delete a room immediately (admin function)
 */
async function deleteRoom(code) {
    await cleanupRoom(code);
}

module.exports = {
    createRoom,
    getRoom,
    joinRoom,
    leaveRoom,
    updateSettings,
    roomExists,
    refreshRoomTTL,
    cleanupRoom,
    deleteRoom
};
