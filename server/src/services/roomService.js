/**
 * Room Service - Room management logic
 */

const { getRedis } = require('../config/redis');
const { v4: uuidv4 } = require('uuid');
const { customAlphabet } = require('nanoid');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const logger = require('../utils/logger');
const playerService = require('./playerService');
const gameService = require('./gameService');
const timerService = require('./timerService');
const {
    ROOM_CODE_LENGTH,
    ROOM_MAX_PLAYERS,
    REDIS_TTL,
    ROOM_STATUS,
    ERROR_CODES,
    PASSWORD_SECURITY
} = require('../config/constants');
const { RoomError, PlayerError, ServerError } = require('../errors/GameError');

// Password hashing cost factor - from centralized config
const BCRYPT_SALT_ROUNDS = PASSWORD_SECURITY.BCRYPT_SALT_ROUNDS;

// Generate room codes (uppercase alphanumeric, no confusing chars)
const generateRoomCode = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', ROOM_CODE_LENGTH);

/**
 * Generate a deterministic lookup key from password
 * Uses SHA-256 for fast lookups (bcrypt is for actual auth)
 */
/**
 * Generate a deterministic lookup key from password
 * Uses SHA-256 for fast lookups (bcrypt is for actual auth)
 * Note: Case-sensitive to match bcrypt validation behavior
 */
function generatePasswordLookupKey(password) {
    return crypto.createHash('sha256').update(password.trim()).digest('hex');
}

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
            logger.error('Failed to hash room password', { error: hashError.message });
            throw new ServerError('Failed to create password-protected room');
        }
    }

    // Remove raw password and nickname from settings (don't store in room settings)
    const { password: _password, nickname: hostNickname, ...cleanSettings } = settings;

    while (attempts < maxAttempts) {
        code = generateRoomCode();

        // Generate lookup key for password-based room discovery
        const passwordLookupKey = settings.password && settings.password.trim()
            ? generatePasswordLookupKey(settings.password)
            : null;

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
            passwordVersion: passwordHash ? 1 : 0, // Track password changes for reconnection validation
            passwordChangedAt: passwordHash ? Date.now() : null,
            passwordLookupKey, // Store lookup key for cleanup
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
            // Room created successfully

            // If password protected, store lookup key for password-based room discovery
            if (settings.password && settings.password.trim()) {
                const lookupKey = generatePasswordLookupKey(settings.password);
                await redis.set(`password-lookup:${lookupKey}`, code, { EX: REDIS_TTL.ROOM });
                logger.debug(`Password lookup key stored for room ${code}`);
            }

            // Create host player with provided nickname or default to 'Host'
            const player = await playerService.createPlayer(hostSessionId, code, hostNickname || 'Host', true);
            logger.info(`Room ${code} created by ${hostSessionId}${passwordHash ? ' (password protected)' : ''}`);

            // Return room without passwordHash for security
            const { passwordHash: _, passwordLookupKey: _lookupKey, ...safeRoom } = room;
            return { room: safeRoom, player };
        }

        // Room code collision, try again
        attempts++;
        logger.debug(`Room code collision for ${code}, attempt ${attempts}/${maxAttempts}`);
    }

    throw new ServerError('Failed to generate room code');
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
        throw RoomError.notFound(code);
    }

    // Check if player is already in room (reconnecting)
    let player = await playerService.getPlayer(sessionId);
    let isReconnecting = false;

    if (player && player.roomCode === code) {
        // Reconnection - check if password has changed since player joined
        if (room.passwordHash && PASSWORD_SECURITY.REQUIRE_REAUTH_ON_CHANGE) {
            const playerPasswordVersion = player.passwordVersion || 0;
            const roomPasswordVersion = room.passwordVersion || 0;

            if (playerPasswordVersion < roomPasswordVersion) {
                // Password changed since player joined - require re-authentication
                if (!password) {
                    throw new RoomError(
                        ERROR_CODES.ROOM_PASSWORD_CHANGED,
                        'Room password has changed - please re-enter the password',
                        { roomCode: code }
                    );
                }
                // Verify the new password
                let passwordValid = false;
                try {
                    passwordValid = await bcrypt.compare(password, room.passwordHash);
                } catch (compareError) {
                    logger.error('Failed to verify room password on reconnection', { error: compareError.message });
                    throw new ServerError('Password verification failed');
                }
                if (!passwordValid) {
                    throw new RoomError(
                        ERROR_CODES.ROOM_PASSWORD_INVALID,
                        'Incorrect room password',
                        { roomCode: code }
                    );
                }
                // Update player's password version
                player = await playerService.updatePlayer(sessionId, {
                    connected: true,
                    lastSeen: Date.now(),
                    passwordVersion: roomPasswordVersion
                });
                logger.info(`Player ${sessionId} re-authenticated after password change in room ${code}`);
                isReconnecting = true;
            } else {
                // Password version matches - normal reconnection
                player = await playerService.updatePlayer(sessionId, { connected: true, lastSeen: Date.now() });
                isReconnecting = true;
            }
        } else {
            // No password or re-auth not required - normal reconnection
            player = await playerService.updatePlayer(sessionId, { connected: true, lastSeen: Date.now() });
            isReconnecting = true;
        }
    } else {
        // New join - check password
        if (room.passwordHash) {
            if (!password) {
                throw new RoomError(
                    ERROR_CODES.ROOM_PASSWORD_REQUIRED,
                    'This room requires a password',
                    { roomCode: code }
                );
            }
            // ISSUE #39 FIX: wrap bcrypt.compare in try-catch
            let passwordValid = false;
            try {
                passwordValid = await bcrypt.compare(password, room.passwordHash);
            } catch (compareError) {
                logger.error('Failed to verify room password', { error: compareError.message });
                throw new ServerError('Password verification failed');
            }
            if (!passwordValid) {
                throw new RoomError(
                    ERROR_CODES.ROOM_PASSWORD_INVALID,
                    'Incorrect room password',
                    { roomCode: code }
                );
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
            throw RoomError.full(code);
        }

        if (result === -1) {
            // Already a member but player data might be missing - treat as reconnection
            player = await playerService.createPlayer(sessionId, code, nickname, false);
            // Store password version if room has password
            if (room.passwordVersion) {
                player = await playerService.updatePlayer(sessionId, { passwordVersion: room.passwordVersion });
            }
            isReconnecting = true;
        } else if (result === 1) {
            // Successfully added to set, now create player data
            // ISSUE #42 FIX: Use createPlayer with addToSet=false instead of deprecated createPlayerData
            // Use try-catch to rollback the set addition if player data creation fails
            try {
                player = await playerService.createPlayer(sessionId, code, nickname, false, false);
                // Store password version if room has password (for reconnection validation)
                if (room.passwordVersion) {
                    player = await playerService.updatePlayer(sessionId, { passwordVersion: room.passwordVersion });
                }
            } catch (error) {
                // Rollback: remove from players set
                logger.warn(`Player data creation failed for ${sessionId}, rolling back set addition`);
                await redis.sRem(`room:${code}:players`, sessionId);
                throw error;
            }
        } else {
            // Unexpected result (null, undefined, or other) - log and throw error
            logger.error('Unexpected result from room join script', { result, roomCode: code });
            throw new ServerError('Failed to join room due to unexpected error');
        }
    }

    // Get current game if any
    const game = await gameService.getGame(code);
    const gameState = game ? gameService.getGameStateForPlayer(game, player) : null;

    // Refresh all room-related TTLs
    await refreshRoomTTL(code);

    // Return room without passwordHash and passwordLookupKey for security
    const { passwordHash: _hash, passwordLookupKey: _lookupKey2, ...safeRoom } = room;

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
        throw RoomError.notFound(code);
    }

    if (room.hostSessionId !== sessionId) {
        throw PlayerError.notHost();
    }

    // Handle password update separately
    if ('password' in newSettings) {
        const currentPasswordVersion = room.passwordVersion || 0;
        const oldLookupKey = room.passwordLookupKey;

        if (newSettings.password === null || newSettings.password === '') {
            // Remove password - delete old lookup key
            if (oldLookupKey) {
                await redis.del(`password-lookup:${oldLookupKey}`);
                logger.debug(`Deleted password lookup key for room ${code}`);
            }
            room.passwordHash = null;
            room.hasPassword = false;
            room.passwordVersion = 0;
            room.passwordChangedAt = null;
            room.passwordLookupKey = null;
            logger.info(`Password removed from room ${code}`, {
                roomCode: code,
                changedBy: sessionId,
                previousVersion: currentPasswordVersion
            });
        } else if (newSettings.password && newSettings.password.trim()) {
            // Set new password (ISSUE #39 FIX: wrap bcrypt in try-catch)
            try {
                // Delete old lookup key if exists
                if (oldLookupKey) {
                    await redis.del(`password-lookup:${oldLookupKey}`);
                    logger.debug(`Deleted old password lookup key for room ${code}`);
                }

                room.passwordHash = await bcrypt.hash(newSettings.password.trim(), BCRYPT_SALT_ROUNDS);
                room.hasPassword = true;
                room.passwordVersion = currentPasswordVersion + 1;
                room.passwordChangedAt = Date.now();

                // Create new lookup key
                const newLookupKey = generatePasswordLookupKey(newSettings.password);
                room.passwordLookupKey = newLookupKey;
                await redis.set(`password-lookup:${newLookupKey}`, code, { EX: REDIS_TTL.ROOM });
                logger.debug(`Created new password lookup key for room ${code}`);

                logger.info(`Password updated for room ${code}`, {
                    roomCode: code,
                    changedBy: sessionId,
                    passwordVersion: room.passwordVersion
                });
            } catch (hashError) {
                logger.error('Failed to hash room password', { error: hashError.message });
                throw new ServerError('Failed to set room password');
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

    // Return settings without passwordHash (include password version for client awareness)
    return {
        ...room.settings,
        hasPassword: room.hasPassword,
        passwordVersion: room.passwordVersion || 0
    };
}

/**
 * Check if room exists
 */
async function roomExists(code) {
    const redis = getRedis();
    return await redis.exists(`room:${code}`) === 1;
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

    await redis.eval(
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

    // Get room data to find password lookup key
    const room = await getRoom(code);

    // Get all players in room
    const sessionIds = await redis.sMembers(`room:${code}:players`);

    // ISSUE #4 FIX: Build list of all keys to delete including team sets
    const keysToDelete = [
        ...sessionIds.map(sessionId => `player:${sessionId}`),
        ...sessionIds.map(sessionId => `session:${sessionId}:socket`), // Also clean socket mappings
        `room:${code}`,
        `room:${code}:players`,
        `room:${code}:game`,
        `room:${code}:team:red`,   // ISSUE #4 FIX: Include team sets
        `room:${code}:team:blue`   // ISSUE #4 FIX: Include team sets
    ];

    // Add password lookup key if exists
    if (room?.passwordLookupKey) {
        keysToDelete.push(`password-lookup:${room.passwordLookupKey}`);
    }

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

/**
 * Find a room by password
 * Uses a SHA-256 lookup key for fast discovery
 * @param {string} password - The room password
 * @returns {Promise<{code: string, hasPassword: boolean}|null>} Room info or null if not found
 */
async function findRoomByPassword(password) {
    if (!password || !password.trim()) {
        return null;
    }

    const redis = getRedis();
    const lookupKey = generatePasswordLookupKey(password);
    const roomCode = await redis.get(`password-lookup:${lookupKey}`);

    if (!roomCode) {
        return null;
    }

    // Verify room still exists
    const room = await getRoom(roomCode);
    if (!room) {
        // Room expired, clean up stale lookup key
        await redis.del(`password-lookup:${lookupKey}`);
        return null;
    }

    return {
        code: roomCode,
        hasPassword: room.hasPassword
    };
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
    deleteRoom,
    findRoomByPassword
};
