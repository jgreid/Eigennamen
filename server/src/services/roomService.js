/**
 * Room Service - Room management logic
 */

const { getRedis } = require('../config/redis');
const { v4: uuidv4 } = require('uuid');
const { customAlphabet } = require('nanoid');
const logger = require('../utils/logger');
const playerService = require('./playerService');
const gameService = require('./gameService');
const timerService = require('./timerService');
const {
    ROOM_CODE_LENGTH,
    ROOM_MAX_PLAYERS,
    REDIS_TTL,
    ROOM_STATUS,
    ERROR_CODES
} = require('../config/constants');

// Generate room codes (uppercase alphanumeric, no confusing chars)
const generateRoomCode = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', ROOM_CODE_LENGTH);

/**
 * Create a new room
 */
async function createRoom(hostSessionId, settings = {}) {
    const redis = getRedis();

    // Generate unique room code
    let code;
    let attempts = 0;
    do {
        code = generateRoomCode();
        const exists = await redis.exists(`room:${code}`);
        if (!exists) break;
        attempts++;
    } while (attempts < 10);

    if (attempts >= 10) {
        throw { code: ERROR_CODES.SERVER_ERROR, message: 'Failed to generate room code' };
    }

    const room = {
        id: uuidv4(),
        code,
        hostSessionId,
        status: ROOM_STATUS.WAITING,
        settings: {
            teamNames: { red: 'Red', blue: 'Blue' },
            turnTimer: null,
            allowSpectators: true,
            ...settings
        },
        createdAt: Date.now(),
        expiresAt: Date.now() + (REDIS_TTL.ROOM * 1000)
    };

    // Save room with TTL
    await redis.set(`room:${code}`, JSON.stringify(room), { EX: REDIS_TTL.ROOM });

    // Initialize empty player list with same TTL
    await redis.del(`room:${code}:players`);

    // Create host player
    const player = await playerService.createPlayer(hostSessionId, code, 'Host', true);

    logger.info(`Room ${code} created by ${hostSessionId}`);

    return { room, player };
}

/**
 * Get room by code
 */
async function getRoom(code) {
    const redis = getRedis();
    const roomData = await redis.get(`room:${code}`);

    if (!roomData) {
        return null;
    }

    return JSON.parse(roomData);
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
 */
async function joinRoom(code, sessionId, nickname) {
    const redis = getRedis();

    // Get room
    const room = await getRoom(code);
    if (!room) {
        throw { code: ERROR_CODES.ROOM_NOT_FOUND, message: 'Room not found' };
    }

    // Check if player is already in room (reconnecting)
    let player = await playerService.getPlayer(sessionId);
    let isReconnecting = false;

    if (player && player.roomCode === code) {
        // Update player's connected status (reconnection)
        player = await playerService.updatePlayer(sessionId, { connected: true, lastSeen: Date.now() });
        isReconnecting = true;
    } else {
        // Use Lua script for atomic capacity check and add
        const result = await redis.eval(
            ATOMIC_JOIN_SCRIPT,
            {
                keys: [`room:${code}:players`],
                arguments: [ROOM_MAX_PLAYERS.toString(), sessionId]
            }
        );

        if (result === 0) {
            throw { code: ERROR_CODES.ROOM_FULL, message: 'Room is full' };
        }

        if (result === -1) {
            // Already a member but player data might be missing - treat as reconnection
            player = await playerService.createPlayer(sessionId, code, nickname, false);
            isReconnecting = true;
        } else if (result === 1) {
            // Successfully added to set, now create player data
            player = await playerService.createPlayerData(sessionId, code, nickname, false);
        } else {
            // Unexpected result (null, undefined, or other) - log and throw error
            logger.error(`Unexpected result from room join script: ${result} for room ${code}`);
            throw { code: ERROR_CODES.SERVER_ERROR, message: 'Failed to join room due to unexpected error' };
        }
    }

    // Get current game if any
    const game = await gameService.getGame(code);
    const gameState = game ? gameService.getGameStateForPlayer(game, player) : null;

    // Refresh all room-related TTLs
    await refreshRoomTTL(code);

    return {
        room,
        players: await playerService.getPlayersInRoom(code),
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

    // If leaving player was host, transfer host
    if (room.hostSessionId === sessionId && players.length > 0) {
        newHostId = players[0].sessionId;
        room.hostSessionId = newHostId;
        await redis.set(`room:${code}`, JSON.stringify(room), { EX: REDIS_TTL.ROOM });
        await playerService.updatePlayer(newHostId, { isHost: true });
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
 */
async function updateSettings(code, sessionId, newSettings) {
    const redis = getRedis();
    const room = await getRoom(code);

    if (!room) {
        throw { code: ERROR_CODES.ROOM_NOT_FOUND, message: 'Room not found' };
    }

    if (room.hostSessionId !== sessionId) {
        throw { code: ERROR_CODES.NOT_HOST, message: 'Only the host can update settings' };
    }

    room.settings = {
        ...room.settings,
        ...newSettings
    };

    await redis.set(`room:${code}`, JSON.stringify(room), { EX: REDIS_TTL.ROOM });

    return room.settings;
}

/**
 * Check if room exists
 */
async function roomExists(code) {
    const redis = getRedis();
    return await redis.exists(`room:${code}`) === 1;
}

/**
 * Refresh TTL for all room-related keys
 */
async function refreshRoomTTL(code) {
    const redis = getRedis();

    // Refresh room TTL
    await redis.expire(`room:${code}`, REDIS_TTL.ROOM);

    // Refresh players list TTL
    await redis.expire(`room:${code}:players`, REDIS_TTL.ROOM);

    // Refresh game TTL if exists
    const gameExists = await redis.exists(`room:${code}:game`);
    if (gameExists) {
        await redis.expire(`room:${code}:game`, REDIS_TTL.ROOM);
    }
}

/**
 * Clean up all data associated with a room
 */
async function cleanupRoom(code) {
    const redis = getRedis();

    // Stop any active timer for this room (prevents memory leak)
    await timerService.stopTimer(code);

    // Get all players in room and remove them
    const sessionIds = await redis.sMembers(`room:${code}:players`);
    for (const sessionId of sessionIds) {
        await redis.del(`player:${sessionId}`);
    }

    // Delete all room-related keys
    await redis.del(`room:${code}`);
    await redis.del(`room:${code}:players`);
    await redis.del(`room:${code}:game`);

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
