/**
 * Player Service - Player management logic
 */

const crypto = require('crypto');
const { getRedis } = require('../config/redis');
const logger = require('../utils/logger');
const { REDIS_TTL, ERROR_CODES } = require('../config/constants');

/**
 * Create a new player
 * @param {string} sessionId - Player's session ID
 * @param {string} roomCode - Room code
 * @param {string} nickname - Player's nickname
 * @param {boolean} isHost - Whether this player is the host
 * @param {boolean} addToSet - Whether to add to room's player set (false if already added by Lua script)
 */
async function createPlayer(sessionId, roomCode, nickname, isHost = false, addToSet = true) {
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

    // Add to room's player list if requested
    if (addToSet) {
        await redis.sAdd(`room:${roomCode}:players`, sessionId);
    }

    logger.info(`Player ${nickname} (${sessionId}) created in room ${roomCode}${addToSet ? '' : ' (data only)'}`);

    return player;
}

/**
 * Create player data only (session already added to room set by Lua script)
 * Used when atomic join script has already added the session to the players set
 * @deprecated Use createPlayer with addToSet=false instead
 */
async function createPlayerData(sessionId, roomCode, nickname, isHost = false) {
    return createPlayer(sessionId, roomCode, nickname, isHost, false);
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
 * Uses special '__NULL__' sentinel to properly handle null team values
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

-- Handle null team: convert sentinel value to actual nil for proper JSON encoding
if newTeam == '__NULL__' then
    player.team = cjson.null
else
    player.team = newTeam
end
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
 * Also maintains team sets for O(1) team member lookups
 */
async function setTeam(sessionId, team) {
    const redis = getRedis();

    // Get player first to get room code and old team for team set maintenance
    const existingPlayer = await getPlayer(sessionId);
    if (!existingPlayer) {
        throw { code: ERROR_CODES.SERVER_ERROR, message: 'Player not found' };
    }

    const oldTeam = existingPlayer.team;
    const roomCode = existingPlayer.roomCode;

    // Use sentinel value for null to properly handle in Lua script
    const teamValue = team === null || team === undefined ? '__NULL__' : team;

    const result = await redis.eval(
        ATOMIC_SET_TEAM_SCRIPT,
        {
            keys: [`player:${sessionId}`],
            arguments: [teamValue, REDIS_TTL.PLAYER.toString(), Date.now().toString()]
        }
    );

    if (!result) {
        throw { code: ERROR_CODES.SERVER_ERROR, message: 'Player not found' };
    }

    try {
        const player = JSON.parse(result);

        // Maintain team sets for O(1) lookups (outside Lua script for simplicity)
        // Remove from old team set if was on a team
        if (oldTeam) {
            await redis.sRem(`room:${roomCode}:team:${oldTeam}`, sessionId);
        }

        // Add to new team set if joining a team
        if (team) {
            await redis.sAdd(`room:${roomCode}:team:${team}`, sessionId);
            await redis.expire(`room:${roomCode}:team:${team}`, REDIS_TTL.PLAYER);
        }

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

    // ISSUE #31 FIX: Require team assignment before becoming spymaster or clicker
    if ((role === 'spymaster' || role === 'clicker') && !player.team) {
        throw {
            code: ERROR_CODES.INVALID_INPUT,
            message: 'Must join a team before becoming ' + role
        };
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
 * Get all players on a specific team - O(1) lookup using team sets
 * Uses pipeline for batch fetching player data
 * @param {string} roomCode - Room code
 * @param {string} team - Team name ('red' or 'blue')
 * @returns {Array} Array of player objects on the team
 */
async function getTeamMembers(roomCode, team) {
    const redis = getRedis();
    const teamKey = `room:${roomCode}:team:${team}`;

    // Get session IDs from team set
    const sessionIds = await redis.sMembers(teamKey);

    if (sessionIds.length === 0) {
        return [];
    }

    // Batch fetch all player data
    const playerKeys = sessionIds.map(id => `player:${id}`);
    const playerDataArray = await redis.mGet(playerKeys);

    const players = [];
    const orphanedIds = [];

    for (let i = 0; i < sessionIds.length; i++) {
        const playerData = playerDataArray[i];
        if (playerData) {
            try {
                const player = JSON.parse(playerData);
                // Verify player is still on this team (consistency check)
                if (player.team === team) {
                    players.push(player);
                } else {
                    // Player changed teams but set wasn't updated - clean up
                    orphanedIds.push(sessionIds[i]);
                }
            } catch (e) {
                logger.error(`Failed to parse player data for ${sessionIds[i]}:`, e.message);
                orphanedIds.push(sessionIds[i]);
            }
        } else {
            // Player data expired - clean up
            orphanedIds.push(sessionIds[i]);
        }
    }

    // Clean up orphaned entries
    if (orphanedIds.length > 0) {
        await redis.sRem(teamKey, ...orphanedIds);
        logger.debug(`Cleaned up ${orphanedIds.length} orphaned entries from ${teamKey}`);
    }

    return players;
}

/**
 * Get all players in a room
 * Also cleans up orphaned session IDs (where player data has expired)
 * Uses MGET batching for better performance (single Redis round-trip instead of N)
 */
async function getPlayersInRoom(roomCode) {
    const startTime = Date.now();
    const redis = getRedis();
    const sessionIds = await redis.sMembers(`room:${roomCode}:players`);

    if (sessionIds.length === 0) {
        return [];
    }

    // Use MGET to fetch all players in a single Redis call (much faster than N individual GETs)
    const playerKeys = sessionIds.map(sessionId => `player:${sessionId}`);
    const playerDataArray = await redis.mGet(playerKeys);

    // Log slow queries for debugging
    const elapsed = Date.now() - startTime;
    if (elapsed > 50) {
        logger.warn(`Slow getPlayersInRoom for ${roomCode}: ${elapsed}ms (${sessionIds.length} players)`);
    }

    const players = [];
    const orphanedSessionIds = [];

    for (let i = 0; i < sessionIds.length; i++) {
        const playerData = playerDataArray[i];
        if (playerData) {
            try {
                const player = JSON.parse(playerData);
                players.push(player);
            } catch (e) {
                logger.error(`Failed to parse player data for ${sessionIds[i]}:`, e.message);
                orphanedSessionIds.push(sessionIds[i]);
            }
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
 * Also removes from team set if player was on a team
 */
async function removePlayer(sessionId) {
    const redis = getRedis();
    const player = await getPlayer(sessionId);

    if (player) {
        // Remove from room's player set
        await redis.sRem(`room:${player.roomCode}:players`, sessionId);

        // Remove from team set if player was on a team
        if (player.team) {
            await redis.sRem(`room:${player.roomCode}:team:${player.team}`, sessionId);
        }

        // Delete player data
        await redis.del(`player:${sessionId}`);
        logger.info(`Player ${sessionId} removed from room ${player.roomCode}`);
    }
}

/**
 * Handle player disconnection
 * ISSUE #57 FIX: Schedule player cleanup after grace period
 * ISSUE #17 FIX: Generate reconnection token to prevent session hijacking
 * @returns {string|null} Reconnection token (client should store and provide on reconnect)
 */
async function handleDisconnect(sessionId) {
    const redis = getRedis();
    const player = await getPlayer(sessionId);

    if (!player) {
        return null;
    }

    // ISSUE #17 FIX: Generate secure reconnection token
    const reconnectToken = crypto.randomBytes(32).toString('hex');
    await redis.set(
        `reconnect:${sessionId}`,
        reconnectToken,
        { EX: REDIS_TTL.DISCONNECTED_PLAYER }
    );

    // Mark as disconnected but don't remove yet (allow reconnection)
    await updatePlayer(sessionId, { connected: false, disconnectedAt: Date.now() });

    logger.info(`Player ${sessionId} disconnected from room ${player.roomCode}`);

    // ISSUE #57 FIX: Schedule removal after grace period using sorted set
    const cleanupTime = Date.now() + (REDIS_TTL.DISCONNECTED_PLAYER * 1000);
    await redis.zAdd('scheduled:player:cleanup', {
        score: cleanupTime,
        value: JSON.stringify({ sessionId, roomCode: player.roomCode })
    });

    // Also set a shorter TTL on the player key as backup
    await redis.expire(`player:${sessionId}`, REDIS_TTL.DISCONNECTED_PLAYER);

    logger.debug(`Scheduled cleanup for player ${sessionId} at ${new Date(cleanupTime).toISOString()}`);

    return reconnectToken;
}

/**
 * Validate reconnection token
 * ISSUE #17 FIX: Require valid token for reconnection to prevent session hijacking
 * @param {string} sessionId - Session ID
 * @param {string} token - Reconnection token provided by client
 * @returns {boolean} True if token is valid
 */
async function validateReconnectToken(sessionId, token) {
    const redis = getRedis();

    // If no token provided, check if player is still connected (fresh connection)
    if (!token) {
        const player = await getPlayer(sessionId);
        // Allow if player exists and is still connected (not disconnected yet)
        if (player && player.connected) {
            return true;
        }
        // Player is disconnected - require token
        logger.warn('Reconnection attempted without token', { sessionId });
        return false;
    }

    const storedToken = await redis.get(`reconnect:${sessionId}`);

    if (!storedToken) {
        // No stored token - either expired or never set
        logger.debug('No reconnection token found', { sessionId });
        return false;
    }

    // Constant-time comparison to prevent timing attacks
    const isValid = crypto.timingSafeEqual(
        Buffer.from(storedToken, 'utf8'),
        Buffer.from(token, 'utf8')
    );

    if (isValid) {
        // Token used successfully - delete it (one-time use)
        await redis.del(`reconnect:${sessionId}`);
        logger.info('Reconnection token validated', { sessionId });
    } else {
        logger.warn('Invalid reconnection token', { sessionId });
    }

    return isValid;
}

/**
 * Process scheduled player cleanups
 * ISSUE #57 FIX: Run this periodically to clean up disconnected players
 * @param {number} limit - Maximum number of players to clean up
 * @returns {number} Number of players cleaned up
 */
async function processScheduledCleanups(limit = 50) {
    const redis = getRedis();
    const now = Date.now();

    try {
        // Get players due for cleanup
        const toCleanup = await redis.zRangeByScore(
            'scheduled:player:cleanup',
            0,
            now,
            { LIMIT: { offset: 0, count: limit } }
        );

        if (toCleanup.length === 0) {
            return 0;
        }

        let cleanedUp = 0;
        for (const entry of toCleanup) {
            try {
                const { sessionId, roomCode } = JSON.parse(entry);

                // Check if player reconnected
                const player = await getPlayer(sessionId);
                if (player && !player.connected) {
                    // Player still disconnected - remove them
                    await removePlayer(sessionId);
                    cleanedUp++;
                    logger.info(`Cleaned up disconnected player ${sessionId} from room ${roomCode}`);
                }

                // Remove from cleanup schedule
                await redis.zRem('scheduled:player:cleanup', entry);
            } catch (parseError) {
                logger.error('Failed to parse cleanup entry:', parseError.message);
                // Remove invalid entry
                await redis.zRem('scheduled:player:cleanup', entry);
            }
        }

        if (cleanedUp > 0) {
            logger.info(`Processed ${cleanedUp} scheduled player cleanups`);
        }

        return cleanedUp;
    } catch (error) {
        logger.error('Error processing scheduled cleanups:', error.message);
        return 0;
    }
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

// Cleanup interval reference
let cleanupInterval = null;

/**
 * Start periodic player cleanup task
 * ISSUE #57 FIX: Process scheduled cleanups every 60 seconds
 */
function startCleanupTask() {
    if (cleanupInterval) {
        clearInterval(cleanupInterval);
    }

    cleanupInterval = setInterval(async () => {
        try {
            await processScheduledCleanups(50);
        } catch (error) {
            logger.error('Error in cleanup task:', error.message);
        }
    }, 60000); // Run every 60 seconds

    logger.info('Player cleanup task started');
}

/**
 * Stop the cleanup task (for graceful shutdown)
 */
function stopCleanupTask() {
    if (cleanupInterval) {
        clearInterval(cleanupInterval);
        cleanupInterval = null;
        logger.info('Player cleanup task stopped');
    }
}

module.exports = {
    createPlayer,
    createPlayerData,
    getPlayer,
    updatePlayer,
    setTeam,
    setRole,
    setNickname,
    getTeamMembers,
    getPlayersInRoom,
    removePlayer,
    handleDisconnect,
    setSocketMapping,
    getSocketId,
    // ISSUE #57 FIX: Export cleanup functions
    processScheduledCleanups,
    startCleanupTask,
    stopCleanupTask,
    // ISSUE #17 FIX: Export reconnection token validation
    validateReconnectToken
};
