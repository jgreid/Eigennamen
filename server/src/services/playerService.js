/**
 * Player Service - Player management logic
 */

const { getRedis } = require('../config/redis');
const logger = require('../utils/logger');
const { REDIS_TTL, ERROR_CODES } = require('../config/constants');

/**
 * Create a new player (adds to room's player set)
 */
async function createPlayer(sessionId, roomCode, nickname, isHost = false) {
    const redis = getRedis();

    const player = {
        sessionId,
        roomCode,
        nickname,
        team: null,
        role: 'spectator',
        isHost,
        connected: true,
        connectedAt: Date.now(),
        lastSeen: Date.now()
    };

    // Save player data
    await redis.set(`player:${sessionId}`, JSON.stringify(player), { EX: REDIS_TTL.PLAYER });

    // Add to room's player list
    await redis.sAdd(`room:${roomCode}:players`, sessionId);

    logger.info(`Player ${nickname} (${sessionId}) created in room ${roomCode}`);

    return player;
}

/**
 * Create player data only (session already added to room set by Lua script)
 * Used when atomic join script has already added the session to the players set
 */
async function createPlayerData(sessionId, roomCode, nickname, isHost = false) {
    const redis = getRedis();

    const player = {
        sessionId,
        roomCode,
        nickname,
        team: null,
        role: 'spectator',
        isHost,
        connected: true,
        connectedAt: Date.now(),
        lastSeen: Date.now()
    };

    // Save player data only (session already in room's player set)
    await redis.set(`player:${sessionId}`, JSON.stringify(player), { EX: REDIS_TTL.PLAYER });

    logger.info(`Player ${nickname} (${sessionId}) data created in room ${roomCode}`);

    return player;
}

/**
 * Get player by session ID
 */
async function getPlayer(sessionId) {
    const redis = getRedis();
    const playerData = await redis.get(`player:${sessionId}`);
    if (!playerData) return null;
    try {
        return JSON.parse(playerData);
    } catch (e) {
        logger.error(`Failed to parse player data for ${sessionId}:`, e.message);
        return null;
    }
}

/**
 * Update player data
 */
async function updatePlayer(sessionId, updates) {
    const redis = getRedis();
    const player = await getPlayer(sessionId);

    if (!player) {
        throw { code: ERROR_CODES.SERVER_ERROR, message: 'Player not found' };
    }

    const updatedPlayer = {
        ...player,
        ...updates,
        lastSeen: Date.now()
    };

    await redis.set(`player:${sessionId}`, JSON.stringify(updatedPlayer), { EX: REDIS_TTL.PLAYER });

    return updatedPlayer;
}

/**
 * Lua script for atomic team change with role clearing
 * Prevents race condition where role changes between read and write
 */
const ATOMIC_SET_TEAM_SCRIPT = `
local playerKey = KEYS[1]
local newTeam = ARGV[1]
local ttl = tonumber(ARGV[2])

local playerData = redis.call('GET', playerKey)
if not playerData then
    return nil
end

local player = cjson.decode(playerData)
local oldTeam = player.team
local oldRole = player.role

player.team = newTeam
player.lastSeen = tonumber(ARGV[3])

-- Clear team-specific roles when switching teams
if oldTeam ~= newTeam and (oldRole == 'spymaster' or oldRole == 'clicker') then
    player.role = 'spectator'
end

redis.call('SET', playerKey, cjson.encode(player), 'EX', ttl)
return cjson.encode(player)
`;

/**
 * Set player's team (atomic operation)
 * Clears spymaster/clicker role when switching teams (those roles are team-specific)
 */
async function setTeam(sessionId, team) {
    const redis = getRedis();

    const result = await redis.eval(
        ATOMIC_SET_TEAM_SCRIPT,
        {
            keys: [`player:${sessionId}`],
            arguments: [team || '', REDIS_TTL.PLAYER.toString(), Date.now().toString()]
        }
    );

    if (!result) {
        throw { code: ERROR_CODES.SERVER_ERROR, message: 'Player not found' };
    }

    try {
        const player = JSON.parse(result);
        logger.debug(`Player ${sessionId} team set to ${team}`);
        return player;
    } catch (e) {
        logger.error(`Failed to parse player data after team change for ${sessionId}:`, e.message);
        throw { code: ERROR_CODES.SERVER_ERROR, message: 'Failed to update player team' };
    }
}

/**
 * Set player's role with atomic check to prevent race conditions
 * Enforces one spymaster and one clicker per team
 */
async function setRole(sessionId, role) {
    const redis = getRedis();
    const player = await getPlayer(sessionId);

    if (!player) {
        throw { code: ERROR_CODES.SERVER_ERROR, message: 'Player not found' };
    }

    // If becoming spymaster or clicker, use a lock to prevent race conditions
    if ((role === 'spymaster' || role === 'clicker') && player.team) {
        const lockKey = `lock:${role}:${player.roomCode}:${player.team}`;

        // Try to acquire lock (expires after 5 seconds)
        const lockAcquired = await redis.set(lockKey, sessionId, { NX: true, EX: 5 });

        if (!lockAcquired) {
            throw {
                code: ERROR_CODES.INVALID_INPUT,
                message: `Another player is becoming ${role}, please try again`
            };
        }

        try {
            // Check if team already has this role
            const roomPlayers = await getPlayersInRoom(player.roomCode);
            const existingPlayer = roomPlayers.find(
                p => p.team === player.team && p.role === role && p.sessionId !== sessionId
            );

            if (existingPlayer) {
                throw {
                    code: ERROR_CODES.INVALID_INPUT,
                    message: `${player.team} team already has a ${role}`
                };
            }

            // Update the role while holding the lock
            const updatedPlayer = await updatePlayer(sessionId, { role });
            return updatedPlayer;
        } finally {
            // Always release the lock
            await redis.del(lockKey);
        }
    }

    return updatePlayer(sessionId, { role });
}

/**
 * Set player's nickname
 */
async function setNickname(sessionId, nickname) {
    return updatePlayer(sessionId, { nickname });
}

/**
 * Get all players in a room
 * Also cleans up orphaned session IDs (where player data has expired)
 * Uses parallel fetching for better performance
 */
async function getPlayersInRoom(roomCode) {
    const redis = getRedis();
    const sessionIds = await redis.sMembers(`room:${roomCode}:players`);

    if (sessionIds.length === 0) {
        return [];
    }

    // Fetch all players in parallel for better performance
    const playerPromises = sessionIds.map(sessionId => getPlayer(sessionId));
    const playerResults = await Promise.all(playerPromises);

    const players = [];
    const orphanedSessionIds = [];

    for (let i = 0; i < sessionIds.length; i++) {
        if (playerResults[i]) {
            players.push(playerResults[i]);
        } else {
            // Player data expired but session ID still in set - mark for cleanup
            orphanedSessionIds.push(sessionIds[i]);
        }
    }

    // Clean up orphaned session IDs atomically
    if (orphanedSessionIds.length > 0) {
        await redis.sRem(`room:${roomCode}:players`, ...orphanedSessionIds);
        logger.info(`Cleaned up ${orphanedSessionIds.length} orphaned session IDs from room ${roomCode}`);
    }

    // Sort by join time
    return players.sort((a, b) => a.connectedAt - b.connectedAt);
}

/**
 * Remove player from room
 */
async function removePlayer(sessionId) {
    const redis = getRedis();
    const player = await getPlayer(sessionId);

    if (player) {
        await redis.sRem(`room:${player.roomCode}:players`, sessionId);
        await redis.del(`player:${sessionId}`);
        logger.info(`Player ${sessionId} removed from room ${player.roomCode}`);
    }
}

/**
 * Handle player disconnection
 */
async function handleDisconnect(sessionId) {
    const player = await getPlayer(sessionId);

    if (!player) {
        return;
    }

    // Mark as disconnected but don't remove yet (allow reconnection)
    await updatePlayer(sessionId, { connected: false });

    logger.info(`Player ${sessionId} disconnected from room ${player.roomCode}`);

    // Schedule removal if not reconnected within timeout
    // This would typically be done with a delayed job/worker
    // For now, the player TTL will handle cleanup
}

/**
 * Map socket ID to session ID for reconnection and track client IP
 * Only creates mapping if player exists to prevent orphaned mappings
 */
async function setSocketMapping(sessionId, socketId, clientIP = null) {
    const redis = getRedis();

    // First verify player exists to prevent orphaned socket mappings
    const player = await getPlayer(sessionId);
    if (!player) {
        logger.debug(`Skipping socket mapping for non-existent player ${sessionId}`);
        return false;
    }

    // Create socket mapping
    await redis.set(`session:${sessionId}:socket`, socketId, { EX: REDIS_TTL.SESSION_SOCKET });

    // Update last known IP for session security
    if (clientIP) {
        await updatePlayer(sessionId, { lastIP: clientIP });
    }

    return true;
}

/**
 * Get socket ID for a session
 */
async function getSocketId(sessionId) {
    const redis = getRedis();
    return await redis.get(`session:${sessionId}:socket`);
}

module.exports = {
    createPlayer,
    createPlayerData,
    getPlayer,
    updatePlayer,
    setTeam,
    setRole,
    setNickname,
    getPlayersInRoom,
    removePlayer,
    handleDisconnect,
    setSocketMapping,
    getSocketId
};
