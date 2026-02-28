import type { Team, Role, Player, RedisClient } from '../types';

import { getRedis } from '../config/redis';
import logger from '../utils/logger';
import { withTimeout, TIMEOUTS } from '../utils/timeout';
import { REDIS_TTL } from '../config/constants';
import { ServerError } from '../errors/GameError';
import { tryParseJSON, parseJSON } from '../utils/parseJSON';
import { executeWithFallback } from '../utils/executeWithFallback';
import {
    UPDATE_PLAYER_SCRIPT,
    HOST_TRANSFER_SCRIPT,
    ATOMIC_REMOVE_PLAYER_SCRIPT,
    ATOMIC_SET_SOCKET_MAPPING_SCRIPT
} from '../scripts';
import { playerSchema, hostTransferResultSchema } from './player/schemas';
import { invalidateRoomReconnectToken } from './player/reconnection';

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
    const now = Date.now();
    return {
        sessionId,
        roomCode,
        nickname,
        team: null,
        role: 'spectator',
        isHost,
        connected: true,
        createdAt: now,
        connectedAt: now,
        lastSeen: now
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

    const now = Date.now();
    const player: Player = {
        sessionId,
        roomCode,
        nickname,
        team: null,
        role: 'spectator',
        isHost,
        connected: true,
        createdAt: now,
        connectedAt: now,
        lastSeen: now
    };

    // Save player data
    await withTimeout(
        redis.set(`player:${sessionId}`, JSON.stringify(player), { EX: REDIS_TTL.PLAYER }),
        TIMEOUTS.REDIS_OPERATION,
        `createPlayer-set-${sessionId}`
    );

    // Add to room's player list if requested
    if (addToSet) {
        const playersKey = `room:${roomCode}:players`;
        await withTimeout(
            redis.sAdd(playersKey, sessionId),
            TIMEOUTS.REDIS_OPERATION,
            `createPlayer-sAdd-${sessionId}`
        );
        // Ensure the players set has a TTL matching the room
        await withTimeout(
            redis.expire(playersKey, REDIS_TTL.ROOM),
            TIMEOUTS.REDIS_OPERATION,
            `createPlayer-expire-${sessionId}`
        );
    }

    logger.info(`Player ${nickname} (${sessionId}) created in room ${roomCode}${addToSet ? '' : ' (data only)'}`);

    return player;
}


/**
 * Get player by session ID
 */
export async function getPlayer(sessionId: string): Promise<Player | null> {
    const redis: RedisClient = getRedis();
    const playerData = await withTimeout(
        redis.get(`player:${sessionId}`),
        TIMEOUTS.REDIS_OPERATION,
        `getPlayer-${sessionId}`
    );
    if (!playerData) return null;
    const player = tryParseJSON(playerData, playerSchema, `player ${sessionId}`) as Player | null;
    if (!player) {
        logger.error(`Corrupted player data for session ${sessionId}, cleaning up`);
        await redis.del(`player:${sessionId}`);
        throw new ServerError('Corrupted player data');
    }
    return player;
}

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
                UPDATE_PLAYER_SCRIPT,
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

        await withTimeout(
            redis.watch(playerKey),
            TIMEOUTS.REDIS_OPERATION,
            `updatePlayer-watch-${sessionId}`
        );

        const playerData = await withTimeout(
            redis.get(playerKey),
            TIMEOUTS.REDIS_OPERATION,
            `updatePlayer-get-${sessionId}`
        );
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
        logger.info(`updatePlayer WATCH/MULTI conflict for ${sessionId}, attempt ${attempt + 1}`);
    }

    // All WATCH/MULTI retries exhausted — throw rather than falling back to a non-atomic
    // write that could silently overwrite concurrent updates
    logger.error(`updatePlayer WATCH/MULTI failed after ${maxRetries} retries for ${sessionId}`);
    throw ServerError.concurrentModification(null, `updatePlayer(${sessionId})`);
}

/**
 * Remove player from room
 * Uses Lua script for atomic removal from all sets + data key deletion.
 * Falls back to sequential operations if Lua fails.
 * Also cleans up reconnection tokens to prevent orphaned tokens.
 */
export async function removePlayer(sessionId: string): Promise<void> {
    const redis: RedisClient = getRedis();

    await executeWithFallback<void>({
        operationName: `removePlayer(${sessionId})`,

        // Lua path: atomic read + remove from sets + delete
        lua: async () => {
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

            if (!result) return; // Player doesn't exist

            // Non-critical: clean up reconnection tokens (outside atomic boundary)
            try {
                await invalidateRoomReconnectToken(sessionId);
            } catch (tokenError) {
                logger.warn(`Failed to clean up reconnection token for ${sessionId}:`, (tokenError as Error).message);
            }

            const player = tryParseJSON(result, playerSchema, `removePlayer lua for ${sessionId}`) as Player | null;
            logger.info(`Player ${sessionId} removed from room ${player?.roomCode ?? 'unknown'}`);
        },

        // Sequential fallback
        fallback: async () => {
            const player = await getPlayer(sessionId);
            if (!player) return;

            await withTimeout(
                redis.sRem(`room:${player.roomCode}:players`, sessionId),
                TIMEOUTS.REDIS_OPERATION,
                `removePlayer-sRem-players-${sessionId}`
            );

            if (player.team) {
                await withTimeout(
                    redis.sRem(`room:${player.roomCode}:team:${player.team}`, sessionId),
                    TIMEOUTS.REDIS_OPERATION,
                    `removePlayer-sRem-team-${sessionId}`
                );
            }

            try {
                await invalidateRoomReconnectToken(sessionId);
            } catch (tokenError) {
                logger.warn(`Failed to clean up reconnection token for ${sessionId}:`, (tokenError as Error).message);
            }

            await withTimeout(
                redis.del(`player:${sessionId}`),
                TIMEOUTS.REDIS_OPERATION,
                `removePlayer-del-${sessionId}`
            );
            logger.info(`Player ${sessionId} removed from room ${player.roomCode}`);
        }
    });
}

// Disconnection and cleanup functions extracted to player/cleanup.ts
// Re-exported below for backward compatibility

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

    return executeWithFallback<boolean>({
        operationName: `setSocketMapping(${sessionId})`,

        // Lua path: atomic player check + socket mapping + IP update
        lua: async () => {
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
        },

        // Sequential fallback
        fallback: async () => {
            const player = await getPlayer(sessionId);
            if (!player) {
                logger.debug(`Skipping socket mapping for non-existent player ${sessionId}`);
                return false;
            }

            await withTimeout(
                redis.set(`session:${sessionId}:socket`, socketId, { EX: REDIS_TTL.SESSION_SOCKET }),
                TIMEOUTS.REDIS_OPERATION,
                `setSocketMapping-set-${sessionId}`
            );

            if (clientIP) {
                await updatePlayer(sessionId, { lastIP: clientIP });
            }

            return true;
        }
    });
}

/**
 * Get socket ID for a session
 */
export async function getSocketId(sessionId: string): Promise<string | null> {
    const redis: RedisClient = getRedis();
    return withTimeout(
        redis.get(`session:${sessionId}:socket`),
        TIMEOUTS.REDIS_OPERATION,
        `getSocketId-${sessionId}`
    );
}

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
                HOST_TRANSFER_SCRIPT,
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


// Cleanup functions (extracted to player/cleanup.ts)
// Wrapped as functions (not `export { ... } from ...`) to keep writable
// module properties, preserving test mockability via direct assignment.
import {
    registerRoomCleanup as _registerRoomCleanup,
    handleDisconnect as _handleDisconnect,
    processScheduledCleanups as _processScheduledCleanups,
    startCleanupTask as _startCleanupTask,
    stopCleanupTask as _stopCleanupTask,
} from './player/cleanup';
export const registerRoomCleanup = _registerRoomCleanup;
export const handleDisconnect = _handleDisconnect;
export const processScheduledCleanups = _processScheduledCleanups;
export const startCleanupTask = _startCleanupTask;
export const stopCleanupTask = _stopCleanupTask;

// Query functions (extracted to player/queries.ts)
// getPlayersInRoom uses writable re-export (mocked in tests via direct assignment)
import {
    getTeamMembers as _getTeamMembers,
    getPlayersInRoom as _getPlayersInRoom,
    resetRolesForNewGame as _resetRolesForNewGame,
} from './player/queries';
export const getTeamMembers = _getTeamMembers;
export const getPlayersInRoom = _getPlayersInRoom;
export const resetRolesForNewGame = _resetRolesForNewGame;

// Mutation functions (extracted to player/mutations.ts)
import {
    setTeam as _setTeam,
    setRole as _setRole,
    setNickname as _setNickname,
} from './player/mutations';
export const setTeam = _setTeam;
export const setRole = _setRole;
export const setNickname = _setNickname;

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
