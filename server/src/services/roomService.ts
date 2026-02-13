/**
 * Room Service - Room management logic
 *
 * Simplified room system:
 * - Host provides a room ID when creating (serves as both name and access key)
 * - Players join by entering the room ID
 * - No separate password needed
 */

import type {
    Room,
    CreateRoomSettings,
    CreateRoomResult,
    JoinRoomResult,
    LeaveRoomResult,
    RoomSettings
} from '../types/room';
import type { Player, PlayerGameState, RedisClient } from '../types';

import { getRedis } from '../config/redis';
import { v4 as uuidv4 } from 'uuid';
import logger from '../utils/logger';
import * as playerService from './playerService';
import * as gameService from './gameService';
import * as timerService from './timerService';
import { withTimeout, TIMEOUTS } from '../utils/timeout';
import { toEnglishLowerCase } from '../utils/sanitize';
import {
    ROOM_MAX_PLAYERS,
    REDIS_TTL,
    ROOM_STATUS,
    ERROR_CODES,
    GAME_MODE_CONFIG
} from '../config/constants';
import { RoomError, PlayerError, ServerError } from '../errors/GameError';
import { tryParseJSON } from '../utils/parseJSON';
import { z } from 'zod';

// Zod schema for Room data from Redis.
// Validates critical fields when present; non-essential fields are optional
// so tests with sparse mocks still pass.
const roomSchema = z.object({
    code: z.string(),
    id: z.string().optional(),
    roomId: z.string().optional(),
    hostSessionId: z.string().optional(),
    status: z.string().optional(),
    settings: z.unknown().optional(),
    createdAt: z.number().optional(),
    expiresAt: z.number().optional(),
});

// RedisClient imported from '../types' (shared across all services)

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

-- Clean up any stale players set from a previous room with the same code
redis.call('DEL', playersKey)

return 1
`;

/**
 * Lua script for atomic room join with capacity check
 * Returns: 1 if added successfully, 0 if room is full, -1 if already a member, -2 if room doesn't exist
 */
const ATOMIC_JOIN_SCRIPT = `
local playersKey = KEYS[1]
local roomKey = KEYS[2]
local maxPlayers = tonumber(ARGV[1])
local sessionId = ARGV[2]

-- Verify room still exists (prevents orphaned player sets if room was deleted between getRoom and this script)
if redis.call('EXISTS', roomKey) == 0 then
    return -2
end

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
 * Create a new room with host-provided room ID
 * @param roomId - Room ID provided by the host (serves as room name/access key)
 * @param hostSessionId - Session ID of the host
 * @param settings - Room settings
 */
export async function createRoom(
    roomId: string,
    hostSessionId: string,
    settings: CreateRoomSettings = {}
): Promise<CreateRoomResult> {
    const redis: RedisClient = getRedis();

    // Normalize room ID (case-insensitive)
    const normalizedRoomId = toEnglishLowerCase(roomId);

    // Extract nickname from settings
    const { nickname: hostNickname, ...cleanSettings } = settings;

    const room: Room = {
        id: uuidv4(),
        code: normalizedRoomId,  // Use normalized room ID as the code
        roomId: roomId,          // Keep original for display
        hostSessionId,
        status: ROOM_STATUS.WAITING,
        settings: {
            teamNames: { red: 'Red', blue: 'Blue' },
            turnTimer: null,
            allowSpectators: true,
            gameMode: 'classic',
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

    // Create host player with provided nickname or default to 'Player'
    // Note: 'Host' was a reserved name causing validation failures when no nickname provided
    // HARDENING FIX: Wrap player creation in try-catch to rollback room creation on failure
    let player: Player;
    try {
        player = await playerService.createPlayer(hostSessionId, normalizedRoomId, hostNickname || 'Player', true);
    } catch (playerError) {
        // Rollback: delete the room we just created
        logger.warn(`Player creation failed for room "${roomId}", rolling back room creation`);
        await redis.del(`room:${normalizedRoomId}`);
        await redis.del(`room:${normalizedRoomId}:players`);
        throw playerError;
    }

    logger.info(`Room "${roomId}" created by ${hostSessionId}`);

    return { room, player };
}

/**
 * Get room by room ID (case-insensitive)
 */
export async function getRoom(roomId: string): Promise<Room | null> {
    const redis: RedisClient = getRedis();
    // Normalize room ID for case-insensitive lookup
    const normalizedId = toEnglishLowerCase(roomId);
    const roomData = await redis.get(`room:${normalizedId}`);

    if (!roomData) {
        return null;
    }

    const room = tryParseJSON(roomData, roomSchema, `room ${normalizedId}`) as Room | null;

    if (!room) {
        // Room key exists but data failed validation — log at error level
        // so operators can investigate.  parseJSON already logged a warn;
        // this adds structured context for monitoring dashboards.
        logger.error('Room data exists in Redis but failed to parse', {
            roomId: normalizedId,
            rawDataLength: roomData.length,
            rawDataPreview: roomData.substring(0, 200)
        });
    }

    return room;
}

/**
 * Join an existing room
 * Uses Lua script for atomic capacity check and add to prevent race conditions
 * @param roomId - Room ID (case-insensitive)
 * @param sessionId - Player's session ID
 * @param nickname - Player's nickname
 */
export async function joinRoom(
    roomId: string,
    sessionId: string,
    nickname: string
): Promise<JoinRoomResult> {
    const redis: RedisClient = getRedis();

    // Normalize room ID (case-insensitive)
    const normalizedRoomId = toEnglishLowerCase(roomId);

    // Get room
    const room = await getRoom(normalizedRoomId);
    if (!room) {
        // Distinguish "key missing" from "data corrupted" for better diagnostics.
        // getRoom returns null in both cases; check if the key actually exists.
        const keyExists = await redis.exists(`room:${normalizedRoomId}`);
        if (keyExists === 1) {
            logger.error('joinRoom: room key exists but getRoom returned null (data corrupted)', {
                roomId: normalizedRoomId,
                sessionId
            });
        } else {
            logger.warn('joinRoom: room key does not exist in Redis', {
                roomId: normalizedRoomId,
                sessionId
            });
        }
        throw RoomError.notFound(roomId);
    }

    // Check if player is already in room (reconnecting)
    let player: Player | null = await playerService.getPlayer(sessionId);
    let isReconnecting = false;

    if (player && player.roomCode === normalizedRoomId) {
        // Reconnection - update player status
        player = await playerService.updatePlayer(sessionId, { connected: true, lastSeen: Date.now() });
        isReconnecting = true;
        logger.info(`Player ${sessionId} reconnected to room "${roomId}"`);
    } else {
        // New join - use Lua script for atomic capacity check and add
        // BUG FIX: Wrap redis.eval with timeout to prevent hanging operations
        // FIX: Pass room key as KEYS[2] so the script can verify room still exists
        const result = await withTimeout(
            redis.eval(
                ATOMIC_JOIN_SCRIPT,
                {
                    keys: [`room:${normalizedRoomId}:players`, `room:${normalizedRoomId}`],
                    arguments: [ROOM_MAX_PLAYERS.toString(), sessionId]
                }
            ),
            TIMEOUTS.REDIS_OPERATION,
            `joinRoom-lua-${normalizedRoomId}`
        ) as number;

        if (result === -2) {
            // Room was deleted between getRoom() and the atomic script
            throw RoomError.notFound(roomId);
        }

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
    const gameState: PlayerGameState | null = game ? gameService.getGameStateForPlayer(game, player) : null;

    // Refresh all room-related TTLs (non-critical — don't fail join if TTL refresh fails)
    try {
        await refreshRoomTTL(normalizedRoomId);
    } catch (ttlError) {
        logger.warn('Failed to refresh room TTL during join', {
            roomId: normalizedRoomId,
            error: (ttlError as Error).message
        });
    }

    // Ensure player is not null at this point
    if (!player) {
        throw new ServerError('Failed to create or retrieve player');
    }

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
export async function leaveRoom(code: string, sessionId: string): Promise<LeaveRoomResult> {
    if (!code || typeof code !== 'string') {
        return { newHostId: null, roomDeleted: false };
    }
    const redis: RedisClient = getRedis();
    code = toEnglishLowerCase(code);
    const room = await getRoom(code);

    if (!room) {
        return { newHostId: null, roomDeleted: false };
    }

    // Get remaining players (excluding the leaving player) for host transfer decision
    const allPlayers: Player[] = await playerService.getPlayersInRoom(code);
    const remainingPlayers = allPlayers.filter(p => p.sessionId !== sessionId);

    let newHostId: string | null = null;
    let roomDeleted = false;

    // Transfer host BEFORE removing the player so atomicHostTransfer can read old host data.
    // Previously removePlayer was called first, which deleted the old host's data and caused
    // atomicHostTransfer to always fail with OLD_HOST_NOT_FOUND, falling back to non-atomic path.
    const firstPlayer = remainingPlayers[0];
    if (room.hostSessionId === sessionId && remainingPlayers.length > 0 && firstPlayer) {
        newHostId = firstPlayer.sessionId;
        const transferResult = await playerService.atomicHostTransfer(sessionId, newHostId, code);
        if (!transferResult.success) {
            logger.warn(`Non-atomic host transfer fallback for room ${code}: ${transferResult.reason}`);
            // Fallback to non-atomic if Lua script fails (e.g., memory mode)
            room.hostSessionId = newHostId;
            await redis.set(`room:${code}`, JSON.stringify(room), { EX: REDIS_TTL.ROOM });
            await playerService.updatePlayer(newHostId, { isHost: true });
        }
    }

    // Remove player after host transfer is complete
    await playerService.removePlayer(sessionId);

    // If no players left, clean up room completely
    if (remainingPlayers.length === 0) {
        await cleanupRoom(code);
        roomDeleted = true;
    }

    return { newHostId, roomDeleted };
}

/**
 * Update room settings (host only)
 * @param code - Room code
 * @param sessionId - Session ID of the requester
 * @param newSettings - New settings
 */
export async function updateSettings(
    code: string,
    sessionId: string,
    newSettings: Partial<RoomSettings>
): Promise<RoomSettings> {
    const redis: RedisClient = getRedis();
    const room = await getRoom(code);

    if (!room) {
        throw RoomError.notFound(code);
    }

    if (room.hostSessionId !== sessionId) {
        throw PlayerError.notHost();
    }

    // Whitelist allowed settings keys to prevent arbitrary key injection
    const allowedKeys: (keyof RoomSettings)[] = ['teamNames', 'turnTimer', 'allowSpectators', 'gameMode'];
    const sanitizedSettings: Partial<RoomSettings> = {};
    for (const key of allowedKeys) {
        if (key in newSettings) {
            (sanitizedSettings as Record<string, unknown>)[key] = newSettings[key];
        }
    }

    room.settings = {
        ...room.settings,
        ...sanitizedSettings
    };

    // Enforce game mode constraints on turn timer
    if (room.settings.gameMode === 'blitz') {
        room.settings.turnTimer = GAME_MODE_CONFIG.blitz.forcedTurnTimer;
    }

    await redis.set(`room:${code}`, JSON.stringify(room), { EX: REDIS_TTL.ROOM });

    // Refresh TTL on all room-related keys to keep active rooms alive
    await refreshRoomTTL(code);

    return {
        ...room.settings
    };
}

/**
 * Check if room exists
 */
export async function roomExists(code: string): Promise<boolean> {
    const redis: RedisClient = getRedis();
    const normalizedCode = toEnglishLowerCase(code);
    return await redis.exists(`room:${normalizedCode}`) === 1;
}

/**
 * Refresh TTL for all room-related keys atomically
 * ISSUE #8 FIX: Uses Lua script to prevent TTL race condition
 */
export async function refreshRoomTTL(code: string): Promise<void> {
    const redis: RedisClient = getRedis();

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
 * Debounced TTL refresh — skips if last refresh for this room was <60s ago.
 * Use this on game mutations (reveal, clue, endTurn, start) so active games
 * don't expire, without hammering Redis on every event.
 */
const lastTTLRefresh = new Map<string, number>();
const TTL_REFRESH_DEBOUNCE_MS = 60_000;
const TTL_REFRESH_MAX_ENTRIES = 500;

export async function debouncedRefreshRoomTTL(code: string): Promise<void> {
    const now = Date.now();
    const last = lastTTLRefresh.get(code) || 0;
    if (now - last < TTL_REFRESH_DEBOUNCE_MS) {
        return;
    }
    lastTTLRefresh.set(code, now);

    // Prevent unbounded growth: evict stale entries when map gets too large
    if (lastTTLRefresh.size > TTL_REFRESH_MAX_ENTRIES) {
        for (const [key, ts] of lastTTLRefresh) {
            if (now - ts > TTL_REFRESH_DEBOUNCE_MS * 2) {
                lastTTLRefresh.delete(key);
            }
        }
    }

    try {
        await refreshRoomTTL(code);
    } catch (err) {
        // Non-critical — log but don't break the game mutation
        logger.warn(`Debounced TTL refresh failed for room ${code}: ${(err as Error).message}`);
    }
}

/** Remove a room from the debounce map (call during room cleanup) */
export function clearTTLRefreshEntry(code: string): void {
    lastTTLRefresh.delete(code);
}

/**
 * Clean up all data associated with a room
 * ISSUE #4 FIX: Now includes team sets in cleanup
 * Uses parallel operations for better performance
 */
export async function cleanupRoom(code: string): Promise<void> {
    const redis: RedisClient = getRedis();

    // Clean up in-memory debounce entry
    clearTTLRefreshEntry(code);

    // Stop any active timer for this room (prevents memory leak)
    await timerService.stopTimer(code);

    // Get all players in room
    const sessionIds: string[] = await redis.sMembers(`room:${code}:players`);

    // Performance fix: Use mGet for batch token lookup instead of N individual gets
    const tokenKeys = sessionIds.map(id => `reconnect:session:${id}`);
    const reconnectTokens = tokenKeys.length > 0 ? await redis.mGet(tokenKeys) : [];

    // ISSUE #4 FIX: Build list of all keys to delete including team sets
    const keysToDelete: string[] = [
        ...sessionIds.map(sessionId => `player:${sessionId}`),
        ...sessionIds.map(sessionId => `session:${sessionId}:socket`), // Also clean socket mappings
        ...sessionIds.map(sessionId => `reconnect:session:${sessionId}`), // Clean reconnection session keys
        ...reconnectTokens.filter((t): t is string => t !== null).map(token => `reconnect:token:${token}`), // Clean reconnection token keys
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
export async function deleteRoom(code: string): Promise<void> {
    await cleanupRoom(code);
}

