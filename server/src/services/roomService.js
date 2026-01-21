/**
 * Room Service - Room management logic
 */

const { getRedis } = require('../config/redis');
const { v4: uuidv4 } = require('uuid');
const { customAlphabet } = require('nanoid');
const bcrypt = require('bcryptjs');
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

// Password hashing cost factor (lower for game passwords, not protecting sensitive accounts)
const BCRYPT_SALT_ROUNDS = 8;

// Generate room codes (uppercase alphanumeric, no confusing chars)
const generateRoomCode = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', ROOM_CODE_LENGTH);

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
 * Create a new room
 * @param {string} hostSessionId - Session ID of the host
 * @param {object} settings - Room settings including optional password
 */
async function createRoom(hostSessionId, settings = {}) {
    const redis = getRedis();

    // Atomic room creation with unique code generation
    let code;
    let attempts = 0;
    const maxAttempts = 10;

    // Hash password if provided (ISSUE #39 FIX: wrap bcrypt in try-catch)
    let passwordHash = null;
    if (settings.password && settings.password.trim()) {
        try {
            passwordHash = await bcrypt.hash(settings.password.trim(), BCRYPT_SALT_ROUNDS);
        } catch (hashError) {
            logger.error('Failed to hash room password:', hashError.message);
            throw { code: ERROR_CODES.SERVER_ERROR, message: 'Failed to create password-protected room' };
        }
    }

    // Remove raw password from settings (don't store plaintext)
    const { password: _password, ...cleanSettings } = settings;

    while (attempts < maxAttempts) {
        code = generateRoomCode();

        const room = {
            id: uuidv4(),
            code,
            hostSessionId,
            status: ROOM_STATUS.WAITING,
            settings: {
                teamNames: { red: 'Red', blue: 'Blue' },
                turnTimer: null,
                allowSpectators: true,
                ...cleanSettings
            },
            passwordHash, // Store hash, not plaintext
            hasPassword: !!passwordHash, // Flag for UI
            createdAt: Date.now(),
            expiresAt: Date.now() + (REDIS_TTL.ROOM * 1000)
        };

        // Atomically try to create the room
        const created = await redis.eval(
            ATOMIC_CREATE_ROOM_SCRIPT,
            {
                keys: [`room:${code}`, `room:${code}:players`],
                arguments: [JSON.stringify(room), REDIS_TTL.ROOM.toString()]
            }
        );

        if (created === 1) {
            // Room created successfully, now create host player
            const player = await playerService.createPlayer(hostSessionId, code, 'Host', true);
            logger.info(`Room ${code} created by ${hostSessionId}${passwordHash ? ' (password protected)' : ''}`);

            // Return room without passwordHash for security
            const { passwordHash: _, ...safeRoom } = room;
            return { room: safeRoom, player };
        }

        // Room code collision, try again
        attempts++;
        logger.debug(`Room code collision for ${code}, attempt ${attempts}/${maxAttempts}`);
    }

    throw { code: ERROR_CODES.SERVER_ERROR, message: 'Failed to generate room code' };
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

    try {
        return JSON.parse(roomData);
    } catch (e) {
        logger.error(`Failed to parse room data for ${code}:`, e.message);
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
 * @param {string} code - Room code
 * @param {string} sessionId - Player's session ID
 * @param {string} nickname - Player's nickname
 * @param {string} password - Room password (if required)
 */
async function joinRoom(code, sessionId, nickname, password = null) {
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
        // Check password for new joins (not reconnections)
        if (room.passwordHash) {
            if (!password) {
                throw {
                    code: ERROR_CODES.ROOM_PASSWORD_REQUIRED,
                    message: 'This room requires a password'
                };
            }
            // ISSUE #39 FIX: wrap bcrypt.compare in try-catch
            let passwordValid = false;
            try {
                passwordValid = await bcrypt.compare(password, room.passwordHash);
            } catch (compareError) {
                logger.error('Failed to verify room password:', compareError.message);
                throw { code: ERROR_CODES.SERVER_ERROR, message: 'Password verification failed' };
            }
            if (!passwordValid) {
                throw {
                    code: ERROR_CODES.ROOM_PASSWORD_INVALID,
                    message: 'Incorrect room password'
                };
            }
        }
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
            // ISSUE #42 FIX: Use createPlayer with addToSet=false instead of deprecated createPlayerData
            // Use try-catch to rollback the set addition if player data creation fails
            try {
                player = await playerService.createPlayer(sessionId, code, nickname, false, false);
            } catch (error) {
                // Rollback: remove from players set
                logger.warn(`Player data creation failed for ${sessionId}, rolling back set addition`);
                await redis.sRem(`room:${code}:players`, sessionId);
                throw error;
            }
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

    // Return room without passwordHash for security
    const { passwordHash: _hash, ...safeRoom } = room;

    return {
        room: safeRoom,
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
 * @param {string} code - Room code
 * @param {string} sessionId - Session ID of the requester
 * @param {object} newSettings - New settings (may include password)
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

    // Handle password update separately
    if ('password' in newSettings) {
        if (newSettings.password === null || newSettings.password === '') {
            // Remove password
            room.passwordHash = null;
            room.hasPassword = false;
            logger.info(`Password removed from room ${code}`);
        } else if (newSettings.password && newSettings.password.trim()) {
            // Set new password (ISSUE #39 FIX: wrap bcrypt in try-catch)
            try {
                room.passwordHash = await bcrypt.hash(newSettings.password.trim(), BCRYPT_SALT_ROUNDS);
                room.hasPassword = true;
                logger.info(`Password updated for room ${code}`);
            } catch (hashError) {
                logger.error('Failed to hash room password:', hashError.message);
                throw { code: ERROR_CODES.SERVER_ERROR, message: 'Failed to set room password' };
            }
        }
        // Remove password from settings to avoid storing it
        const { password: _pass, ...cleanSettings } = newSettings;
        newSettings = cleanSettings;
    }

    room.settings = {
        ...room.settings,
        ...newSettings
    };

    await redis.set(`room:${code}`, JSON.stringify(room), { EX: REDIS_TTL.ROOM });

    // Return settings without passwordHash
    return { ...room.settings, hasPassword: room.hasPassword };
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
 * Uses parallel operations for better performance
 */
async function cleanupRoom(code) {
    const redis = getRedis();

    // Stop any active timer for this room (prevents memory leak)
    await timerService.stopTimer(code);

    // Get all players in room
    const sessionIds = await redis.sMembers(`room:${code}:players`);

    // Build list of all keys to delete (players + room keys)
    const keysToDelete = [
        ...sessionIds.map(sessionId => `player:${sessionId}`),
        `room:${code}`,
        `room:${code}:players`,
        `room:${code}:game`
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
