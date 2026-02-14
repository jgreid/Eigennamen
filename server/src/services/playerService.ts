/**
 * Player Service - Player management logic
 */

import type { Team, Role, Player, RedisClient } from '../types';

import fs from 'fs';
import path from 'path';
import { getRedis } from '../config/redis';
import logger from '../utils/logger';
import { withTimeout, TIMEOUTS } from '../utils/timeout';
import { REDIS_TTL, PLAYER_CLEANUP } from '../config/constants';
import { ServerError, ValidationError } from '../errors/GameError';
import { tryParseJSON, parseJSON } from '../utils/parseJSON';
import { ATOMIC_REMOVE_PLAYER_SCRIPT, ATOMIC_SET_SOCKET_MAPPING_SCRIPT } from '../scripts';
import { z } from 'zod';
import { invalidateRoomReconnectToken, cleanupOrphanedReconnectionTokens } from './player/reconnection';

// Zod schemas for Redis deserialization validation.
// Validates critical fields when present; non-essential fields are optional
// so tests with sparse mocks still pass. No .passthrough() — unknown keys are stripped.
const playerSchema = z.object({
    sessionId: z.string(),
    roomCode: z.string().optional(),
    nickname: z.string().optional(),
    team: z.string().nullable().optional(),
    role: z.string().optional(),
    isHost: z.boolean().optional(),
    connected: z.boolean().optional(),
    lastSeen: z.number().optional(),
    joinedAt: z.number().optional(),
    createdAt: z.number().optional(),
    connectedAt: z.number().optional(),
    disconnectedAt: z.number().optional(),
    lastIP: z.string().optional(),
    userId: z.string().optional(),
});

const luaResultSchema = z.object({
    success: z.boolean(),
    error: z.string().optional(),
    reason: z.string().optional(),
    player: z.unknown().optional(),
    existingNickname: z.string().optional(),
});

const cleanupEntrySchema = z.object({
    sessionId: z.string(),
    roomCode: z.string(),
});

const hostTransferResultSchema = z.object({
    success: z.boolean(),
    error: z.string().optional(),
    newHostSessionId: z.string().optional(),
    newHostNickname: z.string().optional(),
});

/**
 * Player update data
 */
export interface PlayerUpdateData {
    nickname?: string;
    team?: Team | null;
    role?: Role;
    isHost?: boolean;
    connected?: boolean;
    disconnectedAt?: number;
    lastSeen?: number;
    lastIP?: string;
}

/**
 * Host transfer result
 */
export interface HostTransferResult {
    success: boolean;
    oldHost?: Player;
    newHost?: Player;
    reason?: string;
}

// RedisClient imported from '../types' (shared across all services)

/**
 * Build a Player data object (pure function, no Redis calls).
 * Used by roomService for atomic join+create in Lua script.
 */
export function buildPlayerData(
    sessionId: string,
    roomCode: string,
    nickname: string,
    isHost: boolean
): Player {
    return {
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
}

/**
 * Create a new player
 */
export async function createPlayer(
    sessionId: string,
    roomCode: string,
    nickname: string,
    isHost: boolean = false,
    addToSet: boolean = true
): Promise<Player> {
    const redis: RedisClient = getRedis();

    const player: Player = {
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
        const playersKey = `room:${roomCode}:players`;
        await redis.sAdd(playersKey, sessionId);
        // Ensure the players set has a TTL matching the room
        await redis.expire(playersKey, REDIS_TTL.ROOM);
    }

    logger.info(`Player ${nickname} (${sessionId}) created in room ${roomCode}${addToSet ? '' : ' (data only)'}`);

    return player;
}


/**
 * Get player by session ID
 */
export async function getPlayer(sessionId: string): Promise<Player | null> {
    const redis: RedisClient = getRedis();
    const playerData = await redis.get(`player:${sessionId}`);
    if (!playerData) return null;
    return tryParseJSON(playerData, playerSchema, `player ${sessionId}`) as Player | null;
}

/**
 * Lua script for atomic player update
 * Replaces WATCH/MULTI read-modify-write with a single atomic Lua operation.
 * Prevents lost updates from concurrent modifications.
 * Takes: KEYS[1] = player key, ARGV[1] = JSON updates, ARGV[2] = TTL, ARGV[3] = timestamp
 * Returns: JSON string of updated player on success, nil if player not found
 */
const ATOMIC_UPDATE_PLAYER_SCRIPT: string = fs.readFileSync(path.join(__dirname, '../scripts/updatePlayer.lua'), 'utf8');

/**
 * Update player data atomically using Lua script to prevent lost updates
 * from concurrent read-modify-write operations (e.g., simultaneous disconnect + nickname change).
 *
 * Uses Lua script for true single-operation atomicity (no WATCH/MULTI retry loop).
 * Falls back to WATCH/MULTI if the Lua call fails (e.g., Redis scripting disabled).
 */
export async function updatePlayer(
    sessionId: string,
    updates: PlayerUpdateData
): Promise<Player> {
    const redis: RedisClient = getRedis();
    const playerKey = `player:${sessionId}`;

    // Try Lua script first for true atomicity
    try {
        const result = await withTimeout(
            redis.eval(
                ATOMIC_UPDATE_PLAYER_SCRIPT,
                {
                    keys: [playerKey],
                    arguments: [
                        JSON.stringify(updates),
                        REDIS_TTL.PLAYER.toString(),
                        Date.now().toString()
                    ]
                }
            ),
            TIMEOUTS.REDIS_OPERATION,
            `updatePlayer-lua-${sessionId}`
        ) as string | null;

        if (!result) {
            throw new ServerError('Player not found');
        }

        const updatedPlayer = tryParseJSON(result, playerSchema, `updatePlayer lua for ${sessionId}`) as Player | null;
        if (!updatedPlayer) {
            throw new ServerError('Corrupted player data from Lua script');
        }

        return updatedPlayer;
    } catch (luaError) {
        // Propagate known application errors (player not found, corrupted data)
        if (luaError instanceof ServerError) {
            throw luaError;
        }
        logger.warn(`Lua updatePlayer failed for ${sessionId}, falling back to WATCH/MULTI: ${(luaError as Error).message}`);
    }

    // Fallback: WATCH/MULTI with retries (original implementation)
    const maxRetries = 3;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        // Add exponential backoff between retries to reduce contention
        if (attempt > 0) {
            const backoffMs = Math.min(50 * Math.pow(2, attempt - 1), 200);
            await new Promise(resolve => setTimeout(resolve, backoffMs));
        }

        await redis.watch(playerKey);

        const playerData = await redis.get(playerKey);
        if (!playerData) {
            await redis.unwatch();
            throw new ServerError('Player not found');
        }

        const player = tryParseJSON(playerData, playerSchema, `player ${sessionId}`) as Player | null;
        if (!player) {
            await redis.unwatch();
            throw new ServerError('Corrupted player data');
        }

        const updatedPlayer: Player = {
            ...player,
            ...updates,
            lastSeen: Date.now()
        };

        const txResult = await redis.multi()
            .set(playerKey, JSON.stringify(updatedPlayer), { EX: REDIS_TTL.PLAYER })
            .exec();

        if (txResult !== null) {
            return updatedPlayer;
        }

        // Transaction aborted due to concurrent modification, retry
        logger.debug(`updatePlayer WATCH/MULTI conflict for ${sessionId}, attempt ${attempt + 1}`);
    }

    // All atomic retries exhausted — throw rather than falling back to a non-atomic
    // write that could silently overwrite concurrent updates
    logger.error(`updatePlayer failed atomically after ${maxRetries} retries for ${sessionId}`);
    throw ServerError.concurrentModification(null, `updatePlayer(${sessionId})`);
}

/**
 * Lua script for atomic team switch with empty-team validation AND team set maintenance
 * Team set operations now inside Lua script for atomicity
 * Prevents team from becoming empty during active game
 * Checks all team members' connected status atomically before allowing switch
 * Returns: {success: true, player: {...}} on success
 *          {success: false, reason: 'TEAM_WOULD_BE_EMPTY'} if team would become empty
 *          nil if player not found
 */
const ATOMIC_SAFE_TEAM_SWITCH_SCRIPT: string = fs.readFileSync(path.join(__dirname, '../scripts/safeTeamSwitch.lua'), 'utf8');

/**
 * Set player's team (atomic operation with optional empty-team check)
 *
 * Uses a single Lua script that handles both simple team changes and
 * safe team switches (preventing a team from becoming empty during active games).
 */
export async function setTeam(
    sessionId: string,
    team: Team | null,
    checkEmpty: boolean = false
): Promise<Player> {
    const redis: RedisClient = getRedis();

    // Get player to determine room code and old team for the Lua script
    const existingPlayer = await getPlayer(sessionId);
    if (!existingPlayer) {
        throw new ServerError('Player not found');
    }

    const oldTeam = existingPlayer.team;
    const roomCode = existingPlayer.roomCode;

    if (!roomCode) {
        throw new ServerError('Player is not associated with a room');
    }

    const teamValue = team === null || team === undefined ? '__NULL__' : team;
    const teamSetKey = oldTeam ? `room:${roomCode}:team:${oldTeam}` : 'nonexistent:key';

    const result = await withTimeout(
        redis.eval(
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
        ),
        TIMEOUTS.REDIS_OPERATION,
        `setTeam-lua-${sessionId}`
    ) as string | null;

    if (!result) {
        throw new ServerError('Player not found');
    }

    try {
        const parsed = parseJSON(result, luaResultSchema, `setTeam lua for ${sessionId}`) as { success: boolean; reason?: string; player?: Player };

        if (parsed.success === false) {
            if (parsed.reason === 'TEAM_WOULD_BE_EMPTY') {
                throw new ValidationError(`Cannot leave team ${oldTeam} - your team cannot be empty during an active game`);
            }
            // Defense-in-depth: Invalid team caught by Lua validation
            if (parsed.reason === 'INVALID_TEAM') {
                throw new ValidationError('Invalid team specified');
            }
            throw new ServerError('Failed to update player team');
        }

        logger.debug(`Player ${sessionId} team set to ${team}`);
        return parsed.player as Player;
    } catch (e) {
        if (e instanceof ValidationError) {
            throw e;
        }
        logger.error('Failed to parse player data after team change', { sessionId, error: (e as Error).message });
        throw new ServerError('Failed to update player team');
    }
}

/**
 * Lua script for atomic role assignment
 * Prevents race condition where two players could both become spymaster/clicker
 * Atomically checks if role is available and assigns it in a single operation
 * Returns: {success: true, player: {...}} on success
 *          {success: false, reason: 'ROLE_TAKEN', existingNickname: '...'} if role already assigned
 *          {success: false, reason: 'NO_TEAM'} if player has no team
 *          nil if player not found
 */
const ATOMIC_SET_ROLE_SCRIPT: string = fs.readFileSync(path.join(__dirname, '../scripts/setRole.lua'), 'utf8');

/**
 * Set player's role with atomic check to prevent race conditions
 * Uses Lua script for truly atomic role assignment
 * Enforces one spymaster and one clicker per team
 */
export async function setRole(sessionId: string, role: Role): Promise<Player> {
    const redis: RedisClient = getRedis();

    const player = await getPlayer(sessionId);
    if (!player) {
        throw new ServerError('Player not found');
    }

    if (!player.roomCode) {
        throw new ServerError('Player is not associated with a room');
    }

    // For spectator role, no need for atomic check - just update
    if (role === 'spectator') {
        return updatePlayer(sessionId, { role });
    }

    // Atomic Lua script handles team requirement and role-taken checks
    const result = await withTimeout(
        redis.eval(
            ATOMIC_SET_ROLE_SCRIPT,
            {
                keys: [`player:${sessionId}`, `room:${player.roomCode}:players`],
                arguments: [
                    role,
                    sessionId,
                    REDIS_TTL.PLAYER.toString(),
                    Date.now().toString()
                ]
            }
        ),
        TIMEOUTS.REDIS_OPERATION,
        `setRole-lua-${sessionId}`
    ) as string | null;

    if (!result) {
        throw new ServerError('Player not found');
    }

    try {
        const parsed = parseJSON(result, luaResultSchema, `setRole lua for ${sessionId}`) as { success: boolean; reason?: string; existingNickname?: string; player?: Player };

        if (parsed.success === false) {
            if (parsed.reason === 'ROLE_TAKEN') {
                throw new ValidationError(`${player.team} team already has a ${role} (${parsed.existingNickname})`);
            }
            if (parsed.reason === 'NO_TEAM') {
                throw new ValidationError('Must join a team before becoming ' + role);
            }
            // Defense-in-depth: Invalid role caught by Lua validation
            if (parsed.reason === 'INVALID_ROLE') {
                throw new ValidationError('Invalid role specified');
            }
            throw new ServerError('Failed to update player role');
        }

        logger.debug(`Player ${sessionId} role set to ${role}`);
        return parsed.player as Player;
    } catch (e) {
        if (e instanceof ValidationError) {
            throw e;
        }
        logger.error('Failed to parse player data after role change', { sessionId, error: (e as Error).message });
        throw new ServerError('Failed to update player role');
    }
}

/**
 * Set player's nickname
 * Defense-in-depth validation for nickname
 */
export function setNickname(sessionId: string, nickname: string): Promise<Player> {
    // Zod schema already validates and trims the nickname at the handler level;
    // defense-in-depth check here prevents empty nicknames if called from other paths.
    const trimmed = (nickname || '').trim();
    if (trimmed.length === 0) {
        throw new ValidationError('Nickname cannot be empty');
    }
    return updatePlayer(sessionId, { nickname: trimmed });
}

/**
 * Get all players on a specific team - O(1) lookup using team sets
 * Also cleans up expired player data keys
 * Uses pipeline for batch fetching player data
 */
export async function getTeamMembers(roomCode: string, team: Team): Promise<Player[]> {
    const redis: RedisClient = getRedis();
    const teamKey = `room:${roomCode}:team:${team}`;

    // Get session IDs from team set
    const sessionIds = await redis.sMembers(teamKey);

    if (sessionIds.length === 0) {
        return [];
    }

    // Batch fetch all player data
    const playerKeys = sessionIds.map(id => `player:${id}`);
    const playerDataArray = await redis.mGet(playerKeys);

    const players: Player[] = [];
    const orphanedIds: string[] = [];

    for (let i = 0; i < sessionIds.length; i++) {
        const playerData = playerDataArray[i];
        const currentSessionId = sessionIds[i];
        if (playerData && currentSessionId) {
            const player = tryParseJSON(playerData, playerSchema, `player ${currentSessionId}`) as Player | null;
            if (player) {
                // Verify player is still on this team (consistency check)
                if (player.team === team) {
                    players.push(player);
                } else {
                    // Player changed teams but set wasn't updated - clean up
                    orphanedIds.push(currentSessionId);
                }
            } else {
                orphanedIds.push(currentSessionId);
            }
        } else if (currentSessionId) {
            // Player data expired - clean up
            orphanedIds.push(currentSessionId);
        }
    }

    // Clean up orphaned entries and their lingering data
    if (orphanedIds.length > 0) {
        // Performance fix: Batch DEL operations into single Redis call
        const playerKeysToDelete = orphanedIds.map(id => `player:${id}`);
        await Promise.all([
            redis.sRem(teamKey, ...orphanedIds),
            redis.del(playerKeysToDelete)
        ]);
        logger.debug(`Cleaned up ${orphanedIds.length} orphaned entries from ${teamKey}`);

        // If team set is now empty, delete it
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
 * Now cleans up all orphaned data including player keys and team sets
 * Uses MGET batching for better performance (single Redis round-trip instead of N)
 */
export async function getPlayersInRoom(roomCode: string): Promise<Player[]> {
    const startTime = Date.now();
    const redis: RedisClient = getRedis();
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

    const players: Player[] = [];
    const orphanedSessionIds: string[] = [];

    for (let i = 0; i < sessionIds.length; i++) {
        const playerData = playerDataArray[i];
        const currentSessionId = sessionIds[i];
        if (playerData && currentSessionId) {
            const player = tryParseJSON(playerData, playerSchema, `player ${currentSessionId}`) as Player | null;
            if (player) {
                players.push(player);
            } else {
                orphanedSessionIds.push(currentSessionId);
            }
        } else if (currentSessionId) {
            // Player data expired but session ID still in set - mark for cleanup
            orphanedSessionIds.push(currentSessionId);
        }
    }

    // Clean up all orphaned data atomically
    if (orphanedSessionIds.length > 0) {
        // Remove from players set
        await redis.sRem(`room:${roomCode}:players`, ...orphanedSessionIds);

        // Also remove from team sets (both teams since we don't know which team they were on)
        // Performance fix: Batch DEL operations into single Redis calls
        const playerKeysToDelete = orphanedSessionIds.map(id => `player:${id}`);
        const socketKeysToDelete = orphanedSessionIds.map(id => `session:${id}:socket`);

        await Promise.all([
            redis.sRem(`room:${roomCode}:team:red`, ...orphanedSessionIds),
            redis.sRem(`room:${roomCode}:team:blue`, ...orphanedSessionIds),
            redis.del(playerKeysToDelete),
            redis.del(socketKeysToDelete)
        ]);
        logger.info(`Cleaned up ${orphanedSessionIds.length} orphaned session IDs from room ${roomCode}`);
    }

    // Sort by join time, with sessionId as secondary key for stability
    // Handle null/undefined array elements defensively
    return players
        .filter((p): p is Player => p != null)  // Remove any null/undefined entries
        .sort((a, b) => {
            const aTime = a.connectedAt ?? 0;
            const bTime = b.connectedAt ?? 0;
            const timeDiff = aTime - bTime;
            if (timeDiff !== 0) return timeDiff;
            return (a.sessionId || '').localeCompare(b.sessionId || '');
        });
}

/**
 * Remove player from room
 * Uses Lua script for atomic removal from all sets + data key deletion.
 * Falls back to sequential operations if Lua fails.
 * Also cleans up reconnection tokens to prevent orphaned tokens.
 */
export async function removePlayer(sessionId: string): Promise<void> {
    const redis: RedisClient = getRedis();

    // Try atomic Lua script (bundles read + remove from sets + delete)
    try {
        const result = await withTimeout(
            redis.eval(
                ATOMIC_REMOVE_PLAYER_SCRIPT,
                {
                    keys: [`player:${sessionId}`],
                    arguments: [sessionId]
                }
            ),
            TIMEOUTS.REDIS_OPERATION,
            `removePlayer-lua-${sessionId}`
        ) as string | null;

        if (!result) {
            // Player doesn't exist — nothing to remove
            return;
        }

        // Non-critical: clean up reconnection tokens (outside atomic boundary)
        try {
            await invalidateRoomReconnectToken(sessionId);
        } catch (tokenError) {
            logger.warn(`Failed to clean up reconnection token for ${sessionId}:`, (tokenError as Error).message);
        }

        const player = tryParseJSON(result, playerSchema, `removePlayer lua for ${sessionId}`) as Player | null;
        logger.info(`Player ${sessionId} removed from room ${player?.roomCode ?? 'unknown'}`);
        return;
    } catch (luaError) {
        logger.debug(`Lua removePlayer failed for ${sessionId}, using fallback: ${(luaError as Error).message}`);
    }

    // Fallback: sequential operations (original implementation)
    const player = await getPlayer(sessionId);

    if (player) {
        // Remove from room's player set
        await redis.sRem(`room:${player.roomCode}:players`, sessionId);

        // Remove from team set if player was on a team
        if (player.team) {
            await redis.sRem(`room:${player.roomCode}:team:${player.team}`, sessionId);
        }

        // Clean up reconnection tokens to prevent orphaned keys.
        try {
            await invalidateRoomReconnectToken(sessionId);
        } catch (tokenError) {
            logger.warn(`Failed to clean up reconnection token for ${sessionId}:`, (tokenError as Error).message);
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
 * should be called before this function in socket/index.ts
 * Schedule player cleanup after grace period
 */
export async function handleDisconnect(sessionId: string): Promise<Player | null> {
    const redis: RedisClient = getRedis();
    const player = await getPlayer(sessionId);

    if (!player) {
        return null;
    }

    // Mark as disconnected but don't remove yet (allow reconnection)
    await updatePlayer(sessionId, { connected: false, disconnectedAt: Date.now() });

    logger.info(`Player ${sessionId} disconnected from room ${player.roomCode}`);

    // Schedule removal after grace period using sorted set
    const cleanupTime = Date.now() + (REDIS_TTL.DISCONNECTED_PLAYER * 1000);
    await redis.zAdd('scheduled:player:cleanup', {
        score: cleanupTime,
        value: JSON.stringify({ sessionId, roomCode: player.roomCode })
    });

    // Also set a shorter TTL on the player key as backup
    await redis.expire(`player:${sessionId}`, REDIS_TTL.DISCONNECTED_PLAYER);

    logger.debug(`Scheduled cleanup for player ${sessionId} at ${new Date(cleanupTime).toISOString()}`);

    return player;
}

/**
 * Process scheduled player cleanups
 * Run this periodically to clean up disconnected players
 */
export async function processScheduledCleanups(limit: number = 50): Promise<number> {
    const redis: RedisClient = getRedis();
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
                const { sessionId, roomCode } = parseJSON(entry, cleanupEntrySchema, 'cleanup entry');

                // Check if player reconnected
                const player = await getPlayer(sessionId);
                if (player && !player.connected) {
                    // Player still disconnected - remove them
                    await removePlayer(sessionId);
                    cleanedUp++;
                    logger.info(`Cleaned up disconnected player ${sessionId} from room ${roomCode}`);

                    // Check if room is now empty and clean it up to prevent orphaned rooms.
                    // Orphaned rooms block new room creation with the same code (SETNX returns 0)
                    // and waste memory until their TTL expires.
                    if (roomCode) {
                        try {
                            const remainingCount = await redis.sCard(`room:${roomCode}:players`);
                            if (remainingCount === 0) {
                                const roomExists = await redis.exists(`room:${roomCode}`);
                                if (roomExists === 1) {
                                    const roomService = require('./roomService');
                                    await roomService.cleanupRoom(roomCode);
                                    logger.info(`Cleaned up orphaned room ${roomCode} (no players remaining)`);
                                }
                            }
                        } catch (roomCleanupError) {
                            logger.warn(`Failed to check/cleanup orphaned room ${roomCode}:`, (roomCleanupError as Error).message);
                        }
                    }
                }

                // Remove from cleanup schedule
                await redis.zRem('scheduled:player:cleanup', entry);
            } catch (parseError) {
                logger.error('Failed to parse cleanup entry:', (parseError as Error).message);
                // Remove invalid entry
                await redis.zRem('scheduled:player:cleanup', entry);
            }
        }

        if (cleanedUp > 0) {
            logger.info(`Processed ${cleanedUp} scheduled player cleanups`);
        }

        return cleanedUp;
    } catch (error) {
        logger.error('Error processing scheduled cleanups:', (error as Error).message);
        return 0;
    }
}

/**
 * Map socket ID to session ID for reconnection and track client IP
 * Uses Lua script to bundle player check + socket mapping + IP update
 * into a single atomic operation. Falls back to sequential operations if Lua fails.
 */
export async function setSocketMapping(
    sessionId: string,
    socketId: string,
    clientIP: string | null = null
): Promise<boolean> {
    const redis: RedisClient = getRedis();

    // Try atomic Lua script (bundles player check + socket mapping + IP update)
    try {
        const result = await withTimeout(
            redis.eval(
                ATOMIC_SET_SOCKET_MAPPING_SCRIPT,
                {
                    keys: [`player:${sessionId}`, `session:${sessionId}:socket`],
                    arguments: [
                        socketId,
                        REDIS_TTL.SESSION_SOCKET.toString(),
                        REDIS_TTL.PLAYER.toString(),
                        clientIP || '',
                        Date.now().toString()
                    ]
                }
            ),
            TIMEOUTS.REDIS_OPERATION,
            `setSocketMapping-lua-${sessionId}`
        );

        if (!result) {
            logger.debug(`Skipping socket mapping for non-existent player ${sessionId}`);
            return false;
        }

        return true;
    } catch (luaError) {
        logger.debug(`Lua setSocketMapping failed for ${sessionId}, using fallback: ${(luaError as Error).message}`);
    }

    // Fallback: sequential operations (original implementation)
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
export function getSocketId(sessionId: string): Promise<string | null> {
    const redis: RedisClient = getRedis();
    return redis.get(`session:${sessionId}:socket`);
}

// Cleanup interval reference
let cleanupInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start periodic player cleanup task
 * Process scheduled cleanups every 60 seconds
 */
export function startCleanupTask(): void {
    if (cleanupInterval) {
        clearInterval(cleanupInterval);
    }

    cleanupInterval = setInterval(async () => {
        try {
            await processScheduledCleanups(PLAYER_CLEANUP.BATCH_SIZE);
        } catch (error) {
            logger.error('Error in cleanup task:', (error as Error).message);
        }
        try {
            await cleanupOrphanedReconnectionTokens();
        } catch (error) {
            logger.error('Error in reconnection token cleanup:', (error as Error).message);
        }
    }, PLAYER_CLEANUP.INTERVAL_MS);

    logger.info('Player cleanup task started');
}

/**
 * Stop the cleanup task (for graceful shutdown)
 */
export function stopCleanupTask(): void {
    if (cleanupInterval) {
        clearInterval(cleanupInterval);
        cleanupInterval = null;
        logger.info('Player cleanup task stopped');
    }
}

/**
 * Lua script for atomic host transfer
 * Atomically transfers host status to prevent race conditions
 * that could result in no host or multiple hosts
 * Returns: success with new host data, or failure reason
 */
const ATOMIC_HOST_TRANSFER_SCRIPT: string = fs.readFileSync(path.join(__dirname, '../scripts/hostTransfer.lua'), 'utf8');

/**
 * Atomically transfer host status from one player to another
 * Prevents race conditions during host transfer
 */
export async function atomicHostTransfer(
    oldHostSessionId: string,
    newHostSessionId: string,
    roomCode: string
): Promise<HostTransferResult> {
    const redis: RedisClient = getRedis();

    try {
        // Wrap redis.eval with timeout to prevent hanging operations
        const result = await withTimeout(
            redis.eval(
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
            ),
            TIMEOUTS.REDIS_OPERATION,
            `atomicHostTransfer-lua-${roomCode}`
        ) as string | null;

        if (!result) {
            return { success: false, reason: 'SCRIPT_FAILED' };
        }

        const parsed = parseJSON(result, hostTransferResultSchema, `host transfer in ${roomCode}`) as HostTransferResult;

        if (parsed.success) {
            logger.info(`Host transferred from ${oldHostSessionId} to ${newHostSessionId} in room ${roomCode}`);
        } else {
            logger.warn(`Host transfer failed: ${parsed.reason}`, { oldHostSessionId, newHostSessionId, roomCode });
        }

        return parsed;
    } catch (error) {
        logger.error('Error in atomic host transfer:', { error: (error as Error).message, roomCode });
        return { success: false, reason: 'SCRIPT_ERROR' };
    }
}

/**
 * Reset all players' roles to 'spectator' for a new game while preserving teams.
 * This ensures spymaster/clicker roles are re-chosen each game.
 * Uses parallel updates instead of sequential for better performance.
 */
export async function resetRolesForNewGame(roomCode: string): Promise<Player[]> {
    const players = await getPlayersInRoom(roomCode);

    const results = await Promise.all(
        players.map(player => {
            if (player.role && player.role !== 'spectator') {
                return updatePlayer(player.sessionId, { role: 'spectator' as Role });
            }
            return Promise.resolve(player);
        })
    );

    return results;
}

// Re-export from sub-modules for backward compatibility
// Reconnection functions (extracted to player/reconnection.ts)
export {
    generateReconnectionToken,
    validateRoomReconnectToken,
    getExistingReconnectionToken,
    invalidateRoomReconnectToken,
    cleanupOrphanedReconnectionTokens,
    validateSocketAuthToken,
} from './player/reconnection';

export type {
    ReconnectionTokenData,
    TokenValidationResult,
} from './player/reconnection';

// Stats functions (extracted to player/stats.ts)
export {
    getSpectators,
    getSpectatorCount,
    getRoomStats,
} from './player/stats';

export type {
    SpectatorInfo,
    SpectatorsResponse,
    TeamStats,
    RoomStats,
} from './player/stats';

