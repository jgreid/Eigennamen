/**
 * Player Queries - Read-only operations for player data
 *
 * Handles batch lookups, team membership queries, and role resets.
 * Imported by playerService.ts and re-exported for backward compatibility.
 */

import type { Team, Role, Player, RedisClient } from '../../types';

import { getRedis } from '../../config/redis';
import logger from '../../utils/logger';
import { tryParseJSON } from '../../utils/parseJSON';
import { playerSchema } from './schemas';
import { updatePlayer } from '../playerService';

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

    // Clean up orphaned entries from the team set.
    // IMPORTANT: Only delete player:{id} keys for players whose data has expired
    // (null from Redis). Players who changed teams still have valid session data
    // — only remove them from this team set, don't destroy their player record.
    if (orphanedIds.length > 0) {
        // Separate truly expired players (no data in Redis) from team-mismatch players
        const expiredIds: string[] = [];
        for (let i = 0; i < sessionIds.length; i++) {
            const currentSessionId = sessionIds[i];
            if (currentSessionId && orphanedIds.includes(currentSessionId) && !playerDataArray[i]) {
                expiredIds.push(currentSessionId);
            }
        }

        const cleanupOps: Promise<unknown>[] = [
            redis.sRem(teamKey, ...orphanedIds)
        ];
        // Only delete player keys for truly expired sessions (no data in Redis)
        if (expiredIds.length > 0) {
            const playerKeysToDelete = expiredIds.map(id => `player:${id}`);
            cleanupOps.push(redis.del(playerKeysToDelete));
        }
        await Promise.all(cleanupOps);
        logger.debug(`Cleaned up ${orphanedIds.length} orphaned entries from ${teamKey} (${expiredIds.length} expired)`);

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
