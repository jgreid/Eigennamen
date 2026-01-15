/**
 * Room Service - Room management logic
 */

const { getRedis } = require('../config/redis');
const { v4: uuidv4 } = require('uuid');
const { customAlphabet } = require('nanoid');
const logger = require('../utils/logger');
const playerService = require('./playerService');
const gameService = require('./gameService');
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

    // Save room
    await redis.set(`room:${code}`, JSON.stringify(room), { EX: REDIS_TTL.ROOM });

    // Initialize empty player list
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
 * Join an existing room
 */
async function joinRoom(code, sessionId, nickname) {
    const redis = getRedis();

    // Get room
    const room = await getRoom(code);
    if (!room) {
        throw { code: ERROR_CODES.ROOM_NOT_FOUND, message: 'Room not found' };
    }

    // Check if room is full
    const players = await playerService.getPlayersInRoom(code);
    if (players.length >= ROOM_MAX_PLAYERS) {
        throw { code: ERROR_CODES.ROOM_FULL, message: 'Room is full' };
    }

    // Check if player is already in room (reconnecting)
    let player = await playerService.getPlayer(sessionId);
    if (player && player.roomCode === code) {
        // Update player's connected status
        player = await playerService.updatePlayer(sessionId, { connected: true, lastSeen: Date.now() });
    } else {
        // Create new player
        player = await playerService.createPlayer(sessionId, code, nickname, false);
    }

    // Get current game if any
    const game = await gameService.getGame(code);
    const gameState = game ? gameService.getGameStateForPlayer(game, player) : null;

    // Refresh room TTL
    await redis.expire(`room:${code}`, REDIS_TTL.ROOM);

    return {
        room,
        players: await playerService.getPlayersInRoom(code),
        game: gameState,
        player
    };
}

/**
 * Leave a room
 */
async function leaveRoom(code, sessionId) {
    const redis = getRedis();
    const room = await getRoom(code);

    if (!room) {
        return { newHostId: null };
    }

    // Remove player
    await playerService.removePlayer(sessionId);

    // Get remaining players
    const players = await playerService.getPlayersInRoom(code);

    let newHostId = null;

    // If leaving player was host, transfer host
    if (room.hostSessionId === sessionId && players.length > 0) {
        newHostId = players[0].sessionId;
        room.hostSessionId = newHostId;
        await redis.set(`room:${code}`, JSON.stringify(room), { EX: REDIS_TTL.ROOM });
        await playerService.updatePlayer(newHostId, { isHost: true });
    }

    // If no players left, mark room for cleanup
    if (players.length === 0) {
        await redis.expire(`room:${code}`, 60); // Delete in 1 minute
    }

    return { newHostId };
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

module.exports = {
    createRoom,
    getRoom,
    joinRoom,
    leaveRoom,
    updateSettings,
    roomExists
};
