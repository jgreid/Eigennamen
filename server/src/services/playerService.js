/**
 * Player Service - Player management logic
 */

const crypto = require('crypto');
const { getRedis } = require('../config/redis');
const logger = require('../utils/logger');
const { REDIS_TTL, ERROR_CODES, SESSION_SECURITY } = require('../config/constants');
const { ServerError, ValidationError } = require('../errors/GameError');

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
        throw new ServerError('Player not found');
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
 * Lua script for atomic team switch with empty-team validation AND team set maintenance
 * ISSUE #1 & #59 FIX: Team set operations now inside Lua script for atomicity
 * Prevents team from becoming empty during active game
 * Checks all team members' connected status atomically before allowing switch
 * Returns: {success: true, player: {...}} on success
 *          {success: false, reason: 'TEAM_WOULD_BE_EMPTY'} if team would become empty
 *          nil if player not found
 */
const ATOMIC_SAFE_TEAM_SWITCH_SCRIPT = `
local playerKey = KEYS[1]
local teamSetKey = KEYS[2]
local roomCode = KEYS[3]
local newTeam = ARGV[1]
local sessionId = ARGV[2]
local ttl = tonumber(ARGV[3])
local now = tonumber(ARGV[4])
local checkEmpty = ARGV[5] == 'true'

-- Get current player data
local playerData = redis.call('GET', playerKey)
if not playerData then
    return nil
end

local player = cjson.decode(playerData)
local oldTeam = player.team
local oldRole = player.role

-- Determine actual new team value
local actualNewTeam = nil
if newTeam ~= '__NULL__' then
    actualNewTeam = newTeam
end

-- If we need to check for empty team (during active game with team change)
if checkEmpty and oldTeam and oldTeam ~= cjson.null and oldTeam ~= actualNewTeam then
    -- Get all session IDs on the old team
    local teamMembers = redis.call('SMEMBERS', teamSetKey)
    local otherConnectedCount = 0

    for _, memberId in ipairs(teamMembers) do
        if memberId ~= sessionId then
            local memberData = redis.call('GET', 'player:' .. memberId)
            if memberData then
                local member = cjson.decode(memberData)
                if member.connected then
                    otherConnectedCount = otherConnectedCount + 1
                end
            end
        end
    end

    -- If no other connected members would remain, reject the switch
    if otherConnectedCount == 0 then
        return cjson.encode({success = false, reason = 'TEAM_WOULD_BE_EMPTY'})
    end
end

-- Proceed with team change
if actualNewTeam then
    player.team = actualNewTeam
else
    player.team = cjson.null
end
player.lastSeen = now

-- Clear team-specific roles when switching teams
if oldTeam ~= actualNewTeam and (oldRole == 'spymaster' or oldRole == 'clicker') then
    player.role = 'spectator'
end

redis.call('SET', playerKey, cjson.encode(player), 'EX', ttl)

-- ISSUE #1 FIX: Atomic team set maintenance
-- Remove from old team set if was on a team
if oldTeam and oldTeam ~= cjson.null then
    local oldTeamKey = 'room:' .. roomCode .. ':team:' .. oldTeam
    redis.call('SREM', oldTeamKey, sessionId)
    -- ISSUE #13 FIX: Clean up empty team sets
    if redis.call('SCARD', oldTeamKey) == 0 then
        redis.call('DEL', oldTeamKey)
    end
end

-- Add to new team set if joining a team
if actualNewTeam then
    local newTeamKey = 'room:' .. roomCode .. ':team:' .. actualNewTeam
    redis.call('SADD', newTeamKey, sessionId)
    redis.call('EXPIRE', newTeamKey, ttl)
end

return cjson.encode({success = true, player = player})
`;

/**
 * Lua script for atomic team change with role clearing AND team set maintenance
 * ISSUE #1 FIX: Team set operations are now inside the Lua script for atomicity
 * Prevents race condition where role changes between read and write
 * Uses special '__NULL__' sentinel to properly handle null team values
 */
const ATOMIC_SET_TEAM_SCRIPT = `
local playerKey = KEYS[1]
local roomCode = KEYS[2]
local newTeam = ARGV[1]
local ttl = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local sessionId = ARGV[4]

local playerData = redis.call('GET', playerKey)
if not playerData then
    return nil
end

local player = cjson.decode(playerData)
local oldTeam = player.team
local oldRole = player.role

-- Handle null team: convert sentinel value to actual nil for proper JSON encoding
local actualNewTeam = nil
if newTeam ~= '__NULL__' then
    actualNewTeam = newTeam
    player.team = newTeam
else
    player.team = cjson.null
end
player.lastSeen = now

-- Clear team-specific roles when switching teams
if oldTeam ~= actualNewTeam and (oldRole == 'spymaster' or oldRole == 'clicker') then
    player.role = 'spectator'
end

redis.call('SET', playerKey, cjson.encode(player), 'EX', ttl)

-- ISSUE #1 FIX: Atomic team set maintenance
-- Remove from old team set if was on a team
if oldTeam and oldTeam ~= cjson.null then
    local oldTeamKey = 'room:' .. roomCode .. ':team:' .. oldTeam
    redis.call('SREM', oldTeamKey, sessionId)
    -- ISSUE #13 FIX: Clean up empty team sets
    if redis.call('SCARD', oldTeamKey) == 0 then
        redis.call('DEL', oldTeamKey)
    end
end

-- Add to new team set if joining a team
if actualNewTeam then
    local newTeamKey = 'room:' .. roomCode .. ':team:' .. actualNewTeam
    redis.call('SADD', newTeamKey, sessionId)
    redis.call('EXPIRE', newTeamKey, ttl)
end

return cjson.encode({player = player, oldTeam = oldTeam})
`;

/**
 * Set player's team (atomic operation)
 * ISSUE #1 FIX: Team set operations now happen atomically inside Lua script
 * Clears spymaster/clicker role when switching teams (those roles are team-specific)
 * Also maintains team sets for O(1) team member lookups
 */
async function setTeam(sessionId, team) {
    const redis = getRedis();

    // Get player first to get room code
    const existingPlayer = await getPlayer(sessionId);
    if (!existingPlayer) {
        throw new ServerError('Player not found');
    }

    const roomCode = existingPlayer.roomCode;

    // Use sentinel value for null to properly handle in Lua script
    const teamValue = team === null || team === undefined ? '__NULL__' : team;

    // ISSUE #1 FIX: All operations now happen atomically in Lua script
    const result = await redis.eval(
        ATOMIC_SET_TEAM_SCRIPT,
        {
            keys: [`player:${sessionId}`, roomCode],
            arguments: [teamValue, REDIS_TTL.PLAYER.toString(), Date.now().toString(), sessionId]
        }
    );

    if (!result) {
        throw new ServerError('Player not found');
    }

    try {
        const parsed = JSON.parse(result);
        const player = parsed.player;

        logger.debug(`Player ${sessionId} team set to ${team}`);
        return player;
    } catch (e) {
        logger.error('Failed to parse player data after team change', { sessionId, error: e.message });
        throw new ServerError('Failed to update player team');
    }
}

/**
 * Safely set player's team with atomic empty-team check
 * ISSUE #1 & #59 FIX: Team set operations now happen atomically inside Lua script
 * Prevents team from becoming empty during active game
 * @param {string} sessionId - Player's session ID
 * @param {string} team - New team (or null to leave team)
 * @param {boolean} checkEmpty - Whether to check if team would become empty
 * @returns {Object} Updated player object
 * @throws {ValidationError} If team would become empty
 */
async function safeSetTeam(sessionId, team, checkEmpty = false) {
    const redis = getRedis();

    // Get player first to get room code and old team
    const existingPlayer = await getPlayer(sessionId);
    if (!existingPlayer) {
        throw new ServerError('Player not found');
    }

    const oldTeam = existingPlayer.team;
    const roomCode = existingPlayer.roomCode;

    // Use sentinel value for null
    const teamValue = team === null || team === undefined ? '__NULL__' : team;

    // Build team set key for the OLD team (the one we're checking for emptiness)
    const teamSetKey = oldTeam ? `room:${roomCode}:team:${oldTeam}` : 'nonexistent:key';

    // ISSUE #1 FIX: All operations now happen atomically in Lua script
    const result = await redis.eval(
        ATOMIC_SAFE_TEAM_SWITCH_SCRIPT,
        {
            keys: [`player:${sessionId}`, teamSetKey, roomCode],
            arguments: [
                teamValue,
                sessionId,
                REDIS_TTL.PLAYER.toString(),
                Date.now().toString(),
                checkEmpty.toString()
            ]
        }
    );

    if (!result) {
        throw new ServerError('Player not found');
    }

    try {
        const parsed = JSON.parse(result);

        // Check if the operation was rejected due to empty team
        if (parsed.success === false) {
            if (parsed.reason === 'TEAM_WOULD_BE_EMPTY') {
                throw new ValidationError(`Cannot leave team ${oldTeam} - your team cannot be empty during an active game`);
            }
            throw new ServerError('Failed to update player team');
        }

        const player = parsed.player;

        logger.debug(`Player ${sessionId} safely set team to ${team}`);
        return player;
    } catch (e) {
        if (e instanceof ValidationError) {
            throw e;
        }
        logger.error('Failed to parse player data after safe team change', { sessionId, error: e.message });
        throw new ServerError('Failed to update player team');
    }
}

/**
 * Set player's role with atomic check to prevent race conditions
 * Enforces one spymaster and one clicker per team
 */
async function setRole(sessionId, role) {
    const redis = getRedis();

    // Validate role is a valid value
    const validRoles = ['spectator', 'spymaster', 'clicker'];
    if (!role || !validRoles.includes(role)) {
        throw new ValidationError(`Invalid role: must be one of ${validRoles.join(', ')}`);
    }

    const player = await getPlayer(sessionId);

    if (!player) {
        throw new ServerError('Player not found');
    }

    // ISSUE #31 FIX: Require team assignment before becoming spymaster or clicker
    if ((role === 'spymaster' || role === 'clicker') && !player.team) {
        throw new ValidationError('Must join a team before becoming ' + role);
    }

    // If becoming spymaster or clicker, use a lock to prevent race conditions
    if ((role === 'spymaster' || role === 'clicker') && player.team) {
        const lockKey = `lock:${role}:${player.roomCode}:${player.team}`;

        // Try to acquire lock (expires after 5 seconds)
        const lockAcquired = await redis.set(lockKey, sessionId, { NX: true, EX: 5 });

        if (!lockAcquired) {
            throw new ValidationError(`Another player is becoming ${role}, please try again`);
        }

        try {
            // Check if team already has this role
            const roomPlayers = await getPlayersInRoom(player.roomCode);
            const existingPlayer = roomPlayers.find(
                p => p.team === player.team && p.role === role && p.sessionId !== sessionId
            );

            if (existingPlayer) {
                throw new ValidationError(`${player.team} team already has a ${role}`);
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
 * ISSUE #12 FIX: Also cleans up expired player data keys
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

    // ISSUE #12 FIX: Clean up orphaned entries and their lingering data
    if (orphanedIds.length > 0) {
        const cleanupPromises = [redis.sRem(teamKey, ...orphanedIds)];

        // Also clean up any lingering player data keys
        for (const sessionId of orphanedIds) {
            cleanupPromises.push(redis.del(`player:${sessionId}`));
        }

        await Promise.all(cleanupPromises);
        logger.debug(`Cleaned up ${orphanedIds.length} orphaned entries from ${teamKey}`);

        // ISSUE #13 FIX: If team set is now empty, delete it
        const remainingCount = await redis.sCard(teamKey);
        if (remainingCount === 0) {
            await redis.del(teamKey);
            logger.debug(`Deleted empty team set ${teamKey}`);
        }
    }

    return players;
}

/**
 * Get all players in a room
 * ISSUE #12 FIX: Now cleans up all orphaned data including player keys and team sets
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

    // ISSUE #12 FIX: Clean up all orphaned data atomically
    if (orphanedSessionIds.length > 0) {
        // Remove from players set
        await redis.sRem(`room:${roomCode}:players`, ...orphanedSessionIds);

        // Also remove from team sets (both teams since we don't know which team they were on)
        const cleanupPromises = [
            redis.sRem(`room:${roomCode}:team:red`, ...orphanedSessionIds),
            redis.sRem(`room:${roomCode}:team:blue`, ...orphanedSessionIds)
        ];

        // Also clean up any lingering player data keys and socket mappings
        for (const sessionId of orphanedSessionIds) {
            cleanupPromises.push(redis.del(`player:${sessionId}`));
            cleanupPromises.push(redis.del(`session:${sessionId}:socket`));
        }

        await Promise.all(cleanupPromises);
        logger.info(`Cleaned up ${orphanedSessionIds.length} orphaned session IDs from room ${roomCode}`);
    }

    // Sort by join time, with sessionId as secondary key for stability
    // Use nullish coalescing to handle missing connectedAt values
    return players.sort((a, b) => {
        const aTime = a.connectedAt ?? 0;
        const bTime = b.connectedAt ?? 0;
        const timeDiff = aTime - bTime;
        if (timeDiff !== 0) return timeDiff;
        return (a.sessionId || '').localeCompare(b.sessionId || '');
    });
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
 * Updates player status and schedules cleanup after grace period
 * Note: Token generation is handled by generateReconnectionToken() which
 * should be called before this function in socket/index.js
 * ISSUE #57 FIX: Schedule player cleanup after grace period
 * @param {string} sessionId - Player's session ID
 */
async function handleDisconnect(sessionId) {
    const redis = getRedis();
    const player = await getPlayer(sessionId);

    if (!player) {
        return null;
    }

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
}

/**
 * Validate reconnection token for socket auth
 * Uses the same token storage as generateReconnectionToken() for consistency
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

    // Use same key as generateReconnectionToken stores session->token mapping
    const storedToken = await redis.get(`reconnect:session:${sessionId}`);

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
        // Token used successfully - delete both mappings (one-time use)
        await redis.del(`reconnect:session:${sessionId}`);
        await redis.del(`reconnect:token:${token}`);
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
    return redis.get(`session:${sessionId}:socket`);
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

/**
 * Generate a secure reconnection token for a disconnecting player
 * ISSUE #17 FIX: Secure reconnection via short-lived tokens
 * @param {string} sessionId - Player's session ID
 * @returns {Promise<string|null>} The generated token, or null if player not found
 */
async function generateReconnectionToken(sessionId) {
    const redis = getRedis();
    const player = await getPlayer(sessionId);

    if (!player) {
        return null;
    }

    // Generate a cryptographically secure random token
    const tokenBytes = SESSION_SECURITY.RECONNECTION_TOKEN_LENGTH || 32;
    const token = crypto.randomBytes(tokenBytes).toString('hex');

    // Store token with session data for validation
    const tokenData = {
        sessionId,
        roomCode: player.roomCode,
        nickname: player.nickname,
        team: player.team,
        role: player.role,
        createdAt: Date.now()
    };

    const ttl = SESSION_SECURITY.RECONNECTION_TOKEN_TTL_SECONDS || 300;

    // Store token -> session mapping for quick lookup
    await redis.set(
        `reconnect:token:${token}`,
        JSON.stringify(tokenData),
        { EX: ttl }
    );

    // Store session -> token mapping for cleanup on successful reconnect
    await redis.set(
        `reconnect:session:${sessionId}`,
        token,
        { EX: ttl }
    );

    logger.debug(`Generated reconnection token for session ${sessionId}, TTL: ${ttl}s`);

    return token;
}

/**
 * Validate and consume a reconnection token
 * ISSUE #17 FIX: Secure reconnection via short-lived tokens
 * @param {string} token - The reconnection token
 * @param {string} sessionId - The session ID attempting to reconnect
 * @returns {Promise<{valid: boolean, reason?: string, tokenData?: object}>}
 */
async function validateReconnectionToken(token, sessionId) {
    const redis = getRedis();

    if (!token || typeof token !== 'string') {
        return { valid: false, reason: 'INVALID_TOKEN_FORMAT' };
    }

    // Look up the token
    const tokenDataStr = await redis.get(`reconnect:token:${token}`);

    if (!tokenDataStr) {
        logger.warn('Reconnection token not found or expired', { sessionId });
        return { valid: false, reason: 'TOKEN_EXPIRED_OR_INVALID' };
    }

    let tokenData;
    try {
        tokenData = JSON.parse(tokenDataStr);
    } catch (e) {
        logger.error('Failed to parse reconnection token data', { sessionId, error: e.message });
        return { valid: false, reason: 'TOKEN_CORRUPTED' };
    }

    // Verify the token belongs to this session
    // Note: This is not a timing attack vector since the token itself is the secret.
    // The sessionId check prevents cross-session token reuse after successful token lookup.
    if (tokenData.sessionId !== sessionId) {
        logger.warn('Reconnection token session mismatch', {
            expectedSession: tokenData.sessionId,
            providedSession: sessionId
        });
        return { valid: false, reason: 'SESSION_MISMATCH' };
    }

    // Token is valid - consume it (one-time use)
    await redis.del(`reconnect:token:${token}`);
    await redis.del(`reconnect:session:${sessionId}`);

    logger.info(`Reconnection token validated and consumed for session ${sessionId}`);

    return { valid: true, tokenData };
}

/**
 * Get existing reconnection token for a session (if any)
 * Used to avoid generating multiple tokens for the same session
 * @param {string} sessionId - Player's session ID
 * @returns {Promise<string|null>} Existing token or null
 */
async function getExistingReconnectionToken(sessionId) {
    const redis = getRedis();
    return redis.get(`reconnect:session:${sessionId}`);
}

/**
 * Invalidate any existing reconnection token for a session
 * Called when player successfully reconnects or explicitly leaves
 * @param {string} sessionId - Player's session ID
 */
async function invalidateReconnectionToken(sessionId) {
    const redis = getRedis();

    const existingToken = await redis.get(`reconnect:session:${sessionId}`);
    if (existingToken) {
        await redis.del(`reconnect:token:${existingToken}`);
        await redis.del(`reconnect:session:${sessionId}`);
        logger.debug(`Invalidated reconnection token for session ${sessionId}`);
    }
}

/**
 * Lua script for atomic host transfer
 * SECURITY FIX: Atomically transfers host status to prevent race conditions
 * that could result in no host or multiple hosts
 * Returns: success with new host data, or failure reason
 */
const ATOMIC_HOST_TRANSFER_SCRIPT = `
local oldHostKey = KEYS[1]
local newHostKey = KEYS[2]
local roomKey = KEYS[3]
local newHostSessionId = ARGV[1]
local ttl = tonumber(ARGV[2])
local now = tonumber(ARGV[3])

-- Get old host data
local oldHostData = redis.call('GET', oldHostKey)
if not oldHostData then
    return cjson.encode({success = false, reason = 'OLD_HOST_NOT_FOUND'})
end

-- Get new host data
local newHostData = redis.call('GET', newHostKey)
if not newHostData then
    return cjson.encode({success = false, reason = 'NEW_HOST_NOT_FOUND'})
end

-- Get room data
local roomData = redis.call('GET', roomKey)
if not roomData then
    return cjson.encode({success = false, reason = 'ROOM_NOT_FOUND'})
end

-- Parse all data
local oldHost = cjson.decode(oldHostData)
local newHost = cjson.decode(newHostData)
local room = cjson.decode(roomData)

-- Atomically update all three records
oldHost.isHost = false
oldHost.lastSeen = now
newHost.isHost = true
newHost.lastSeen = now
room.hostSessionId = newHostSessionId

-- Write all updates
redis.call('SET', oldHostKey, cjson.encode(oldHost), 'EX', ttl)
redis.call('SET', newHostKey, cjson.encode(newHost), 'EX', ttl)
redis.call('SET', roomKey, cjson.encode(room), 'EX', ttl)

return cjson.encode({
    success = true,
    oldHost = oldHost,
    newHost = newHost
})
`;

/**
 * Atomically transfer host status from one player to another
 * SECURITY FIX: Prevents race conditions during host transfer
 * @param {string} oldHostSessionId - Current host's session ID
 * @param {string} newHostSessionId - New host's session ID
 * @param {string} roomCode - Room code
 * @returns {Promise<{success: boolean, oldHost?: object, newHost?: object, reason?: string}>}
 */
async function atomicHostTransfer(oldHostSessionId, newHostSessionId, roomCode) {
    const redis = getRedis();

    try {
        const result = await redis.eval(
            ATOMIC_HOST_TRANSFER_SCRIPT,
            {
                keys: [
                    `player:${oldHostSessionId}`,
                    `player:${newHostSessionId}`,
                    `room:${roomCode}`
                ],
                arguments: [
                    newHostSessionId,
                    REDIS_TTL.PLAYER.toString(),
                    Date.now().toString()
                ]
            }
        );

        if (!result) {
            return { success: false, reason: 'SCRIPT_FAILED' };
        }

        const parsed = JSON.parse(result);

        if (parsed.success) {
            logger.info(`Host transferred from ${oldHostSessionId} to ${newHostSessionId} in room ${roomCode}`);
        } else {
            logger.warn(`Host transfer failed: ${parsed.reason}`, { oldHostSessionId, newHostSessionId, roomCode });
        }

        return parsed;
    } catch (error) {
        logger.error('Error in atomic host transfer:', { error: error.message, roomCode });
        return { success: false, reason: 'SCRIPT_ERROR' };
    }
}

/**
 * Get spectator count and list for a room (US-16.1)
 * Spectators are players with role='spectator'
 * @param {string} roomCode - Room code
 * @returns {Object} { count: number, spectators: Array }
 */
async function getSpectators(roomCode) {
    const players = await getPlayersInRoom(roomCode);
    const spectators = players.filter(p => p.role === 'spectator' && p.connected);
    return {
        count: spectators.length,
        spectators: spectators.map(s => ({
            sessionId: s.sessionId,
            nickname: s.nickname,
            team: s.team // team affiliation (can be null)
        }))
    };
}

/**
 * Get spectator count only (lightweight version) (US-16.1)
 * @param {string} roomCode - Room code
 * @returns {number} Number of connected spectators
 */
async function getSpectatorCount(roomCode) {
    const players = await getPlayersInRoom(roomCode);
    return players.filter(p => p.role === 'spectator' && p.connected).length;
}

/**
 * Get room player statistics (US-16.1)
 * Returns counts by role and team for UI display
 * @param {string} roomCode - Room code
 * @returns {Object} Player statistics
 */
async function getRoomStats(roomCode) {
    const players = await getPlayersInRoom(roomCode);
    const connected = players.filter(p => p.connected);

    const stats = {
        totalPlayers: connected.length,
        spectatorCount: 0,
        teams: {
            red: { total: 0, spymaster: null, clicker: null },
            blue: { total: 0, spymaster: null, clicker: null }
        }
    };

    for (const player of connected) {
        if (player.role === 'spectator') {
            stats.spectatorCount++;
        }

        if (player.team === 'red' || player.team === 'blue') {
            stats.teams[player.team].total++;
            if (player.role === 'spymaster') {
                stats.teams[player.team].spymaster = player.nickname;
            } else if (player.role === 'clicker') {
                stats.teams[player.team].clicker = player.nickname;
            }
        }
    }

    return stats;
}

module.exports = {
    createPlayer,
    getPlayer,
    updatePlayer,
    setTeam,
    safeSetTeam,
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
    // ISSUE #17 FIX: Reconnection token functions
    // validateReconnectToken - simple tokens for automatic socket auth reconnection
    validateReconnectToken,
    // Complex token functions for explicit room:reconnect flow
    generateReconnectionToken,
    validateReconnectionToken,
    getExistingReconnectionToken,
    invalidateReconnectionToken,
    // US-16.1: Spectator mode enhancements
    getSpectators,
    getSpectatorCount,
    getRoomStats,
    // SECURITY FIX: Atomic host transfer
    atomicHostTransfer
};
