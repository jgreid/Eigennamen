/**
 * Player Service - Player management logic
 */

const { getRedis } = require('../config/redis');
const logger = require('../utils/logger');
const { REDIS_TTL, ERROR_CODES } = require('../config/constants');

/**
 * Create a new player
 */
async function createPlayer(sessionId, roomCode, nickname, isHost = false) {
    const redis = getRedis();

    const player = {
        sessionId,
        roomCode,
        nickname,
        team: null,
        role: 'guesser',
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
 * Get player by session ID
 */
async function getPlayer(sessionId) {
    const redis = getRedis();
    const playerData = await redis.get(`player:${sessionId}`);
    return playerData ? JSON.parse(playerData) : null;
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
 * Set player's team
 */
async function setTeam(sessionId, team) {
    return updatePlayer(sessionId, { team });
}

/**
 * Set player's role
 */
async function setRole(sessionId, role) {
    const player = await getPlayer(sessionId);

    if (!player) {
        throw { code: ERROR_CODES.SERVER_ERROR, message: 'Player not found' };
    }

    // If becoming spymaster, check if team already has one
    if (role === 'spymaster' && player.team) {
        const roomPlayers = await getPlayersInRoom(player.roomCode);
        const existingSpymaster = roomPlayers.find(
            p => p.team === player.team && p.role === 'spymaster' && p.sessionId !== sessionId
        );

        if (existingSpymaster) {
            throw {
                code: ERROR_CODES.INVALID_INPUT,
                message: `${player.team} team already has a spymaster`
            };
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
 */
async function getPlayersInRoom(roomCode) {
    const redis = getRedis();
    const sessionIds = await redis.sMembers(`room:${roomCode}:players`);

    const players = [];
    const orphanedSessionIds = [];

    for (const sessionId of sessionIds) {
        const player = await getPlayer(sessionId);
        if (player) {
            players.push(player);
        } else {
            // Player data expired but session ID still in set - mark for cleanup
            orphanedSessionIds.push(sessionId);
        }
    }

    // Clean up orphaned session IDs from the room's player set
    if (orphanedSessionIds.length > 0) {
        for (const sessionId of orphanedSessionIds) {
            await redis.sRem(`room:${roomCode}:players`, sessionId);
        }
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
 * Map socket ID to session ID for reconnection
 */
async function setSocketMapping(sessionId, socketId) {
    const redis = getRedis();
    await redis.set(`session:${sessionId}:socket`, socketId, { EX: REDIS_TTL.SESSION_SOCKET });
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
