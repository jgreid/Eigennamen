import type {
    Room,
    CreateRoomSettings,
    CreateRoomResult,
    RoomSettings
} from '../types/room';
import type { Player, RedisClient } from '../types';

import { getRedis } from '../config/redis';
import { v4 as uuidv4 } from 'uuid';
import logger from '../utils/logger';
import * as playerService from './playerService';
import * as timerService from './timerService';
import { withTimeout, TIMEOUTS } from '../utils/timeout';
import { normalizeRoomCode } from '../utils/sanitize';
import {
    REDIS_TTL,
    ROOM_STATUS,
    ERROR_CODES,
    GAME_MODE_CONFIG
} from '../config/constants';
import { RoomError, PlayerError, ServerError, GameStateError } from '../errors/GameError';
import { tryParseJSON } from '../utils/parseJSON';
import { incrementCounter, METRIC_NAMES } from '../utils/metrics';
import { ATOMIC_CREATE_ROOM_SCRIPT, ATOMIC_REFRESH_TTL_SCRIPT, ATOMIC_UPDATE_SETTINGS_SCRIPT } from '../scripts';
import { z } from 'zod';

// Zod schema for Room data from Redis.
// Critical fields (code, hostSessionId, status) are required so that
// corrupt data is rejected rather than silently passed downstream.
const roomSchema = z.object({
    code: z.string(),
    id: z.string().optional(),
    roomId: z.string().optional(),
    hostSessionId: z.string(),
    status: z.string(),
    settings: z.unknown().optional(),
    createdAt: z.number().optional(),
    expiresAt: z.number().optional(),
});

// RedisClient imported from '../types' (shared across all services)

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
    const normalizedRoomId = normalizeRoomCode(roomId);

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
    // Wrap redis.eval with timeout to prevent hanging operations
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
            `Game already exists; join or create a new Room ID to play.`,
            { roomId }
        );
    }

    // Verify room was actually persisted — diagnostic check for silent Redis failures.
    // The Lua SETNX returning 1 guarantees the write, so this is a safety net.
    // Non-fatal: log error for operators but don't block room creation.
    try {
        const verifyExists = await withTimeout(
            redis.exists(`room:${normalizedRoomId}`),
            TIMEOUTS.REDIS_OPERATION,
            `createRoom-verify-${normalizedRoomId}`
        );
        if (verifyExists !== 1) {
            logger.error('createRoom: room key missing immediately after Lua SETNX returned 1', {
                roomId: normalizedRoomId,
                luaResult: created,
                hostSessionId
            });
        }
    } catch (verifyError) {
        logger.warn('createRoom: post-creation verification failed', {
            roomId: normalizedRoomId,
            error: (verifyError as Error).message
        });
    }

    logger.info('Room created successfully', { roomId: normalizedRoomId });

    // Create host player with provided nickname or default to 'Player'
    // Note: 'Host' was a reserved name causing validation failures when no nickname provided
    // Wrap player creation in try-catch to rollback room creation on failure
    let player: Player;
    try {
        player = await playerService.createPlayer(hostSessionId, normalizedRoomId, hostNickname || 'Player', true);
    } catch (playerError) {
        // Rollback: delete the room we just created
        logger.warn(`Player creation failed for room "${roomId}", rolling back room creation`);
        await withTimeout(
            redis.del([`room:${normalizedRoomId}`, `room:${normalizedRoomId}:players`]),
            TIMEOUTS.REDIS_OPERATION,
            `createRoom-rollback-${normalizedRoomId}`
        );
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
    const normalizedId = normalizeRoomCode(roomId);
    const roomData = await withTimeout(
        redis.get(`room:${normalizedId}`),
        TIMEOUTS.REDIS_OPERATION,
        `getRoom-${normalizedId}`
    );

    if (!roomData) {
        return null;
    }

    const room = tryParseJSON(roomData, roomSchema, `room ${normalizedId}`) as Room | null;

    if (!room) {
        // Room key exists but data failed validation — throw so callers
        // can distinguish "not found" (null) from "corrupted" (error).
        logger.error('Room data exists in Redis but failed to parse', {
            roomId: normalizedId,
            rawDataLength: roomData.length,
            rawDataPreview: roomData.substring(0, 200)
        });
        throw GameStateError.corrupted(normalizedId, { operation: 'getRoom' });
    }

    return room;
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

    // Whitelist allowed settings keys to prevent arbitrary key injection
    const allowedKeys: (keyof RoomSettings)[] = ['teamNames', 'turnTimer', 'allowSpectators', 'gameMode'];
    const sanitizedSettings: Partial<RoomSettings> = {};
    for (const key of allowedKeys) {
        if (key in newSettings) {
            (sanitizedSettings as Record<string, unknown>)[key] = newSettings[key];
        }
    }

    const resultStr = await withTimeout(
        redis.eval(ATOMIC_UPDATE_SETTINGS_SCRIPT, {
            keys: [`room:${code}`],
            arguments: [
                sessionId,
                JSON.stringify(sanitizedSettings),
                GAME_MODE_CONFIG.blitz.forcedTurnTimer.toString(),
                REDIS_TTL.ROOM.toString()
            ]
        }),
        TIMEOUTS.REDIS_OPERATION,
        'updateSettings-lua'
    ) as string | null;

    if (!resultStr) {
        throw new ServerError('Failed to update room settings');
    }

    const luaSettingsResultSchema = z.object({
        error: z.string().optional(),
        success: z.boolean().optional(),
        settings: z.unknown().optional(),
    });
    const result = tryParseJSON(resultStr, luaSettingsResultSchema, `updateSettings for room ${code}`) as { error?: string; success?: boolean; settings?: RoomSettings } | null;

    if (!result) {
        throw new ServerError('Failed to parse room settings update result');
    }

    if (result.error === 'ROOM_NOT_FOUND') {
        throw RoomError.notFound(code);
    }
    if (result.error === 'NOT_HOST') {
        throw PlayerError.notHost();
    }
    if (result.error) {
        throw new ServerError(result.error);
    }

    // Refresh TTL on all room-related keys to keep active rooms alive
    await refreshRoomTTL(code);

    return result.settings as RoomSettings;
}

/**
 * Check if room exists
 */
export async function roomExists(code: string): Promise<boolean> {
    const redis: RedisClient = getRedis();
    const normalizedCode = normalizeRoomCode(code);
    return await withTimeout(
        redis.exists(`room:${normalizedCode}`),
        TIMEOUTS.REDIS_OPERATION,
        `roomExists-${normalizedCode}`
    ) === 1;
}

/**
 * Refresh TTL for all room-related keys atomically
 * Uses Lua script to prevent TTL race condition
 */
export async function refreshRoomTTL(code: string): Promise<void> {
    const redis: RedisClient = getRedis();

    // Wrap redis.eval with timeout to prevent hanging operations
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
        // Only record timestamp after successful refresh so that a transient
        // Redis failure doesn't suppress retries for the debounce window
        lastTTLRefresh.set(code, now);
    } catch (err) {
        // Non-critical — log but don't break the game mutation.
        // Timestamp NOT set, so the next call will retry immediately.
        logger.warn(`Debounced TTL refresh failed for room ${code}: ${(err as Error).message}`);
        incrementCounter(METRIC_NAMES.ERRORS, 1, { type: 'ttl_refresh_failure' });
    }
}

/** Remove a room from the debounce map (call during room cleanup) */
export function clearTTLRefreshEntry(code: string): void {
    lastTTLRefresh.delete(code);
}

/**
 * Clean up all data associated with a room
 * Now includes team sets in cleanup
 * Uses parallel operations for better performance
 */
export async function cleanupRoom(code: string): Promise<void> {
    const redis: RedisClient = getRedis();

    // Clean up in-memory debounce entry
    clearTTLRefreshEntry(code);

    // Stop any active timer for this room (prevents memory leak)
    await timerService.stopTimer(code);

    // Get all players in room
    const sessionIds: string[] = await withTimeout(
        redis.sMembers(`room:${code}:players`),
        TIMEOUTS.REDIS_OPERATION,
        `cleanupRoom-sMembers-${code}`
    );

    // Performance fix: Use mGet for batch token lookup instead of N individual gets
    const tokenKeys = sessionIds.map(id => `reconnect:session:${id}`);
    const reconnectTokens = tokenKeys.length > 0
        ? await withTimeout(
            redis.mGet(tokenKeys),
            TIMEOUTS.REDIS_OPERATION,
            `cleanupRoom-mGet-tokens-${code}`
        )
        : [];

    // Build list of all keys to delete including team sets
    const keysToDelete: string[] = [
        ...sessionIds.map(sessionId => `player:${sessionId}`),
        ...sessionIds.map(sessionId => `session:${sessionId}:socket`), // Also clean socket mappings
        ...sessionIds.map(sessionId => `reconnect:session:${sessionId}`), // Clean reconnection session keys
        ...reconnectTokens.filter((t): t is string => t !== null).map(token => `reconnect:token:${token}`), // Clean reconnection token keys
        `room:${code}`,
        `room:${code}:players`,
        `room:${code}:game`,
        `room:${code}:team:red`,   // Include team sets
        `room:${code}:team:blue`   // Include team sets
    ];

    // Delete all keys in parallel using DEL with multiple keys (single Redis call)
    if (keysToDelete.length > 0) {
        await withTimeout(
            redis.del(keysToDelete),
            TIMEOUTS.REDIS_OPERATION,
            `cleanupRoom-del-${code}`
        );
    }

    logger.info(`Room ${code} and all associated data cleaned up`);
}

/**
 * Delete a room immediately (admin function)
 */
export async function deleteRoom(code: string): Promise<void> {
    await cleanupRoom(code);
}


// Membership functions (extracted to room/membership.ts)
import {
    joinRoom as _joinRoom,
    leaveRoom as _leaveRoom,
} from './room/membership';
export const joinRoom = _joinRoom;
export const leaveRoom = _leaveRoom;
