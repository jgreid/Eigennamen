import type { Team, Role, Player, RedisClient } from '../../types';

import { getRedis } from '../../config/redis';
import logger from '../../utils/logger';
import { withTimeout, TIMEOUTS } from '../../utils/timeout';
import { tryParseJSON } from '../../utils/parseJSON';
import { playerSchema } from './schemas';
import { updatePlayer } from '../playerService';
import { withLock } from '../../utils/distributedLock';

/**
 * Get all players on a specific team - O(1) lookup using team sets
 * Also cleans up expired player data keys
 * Uses pipeline for batch fetching player data
 */
export async function getTeamMembers(roomCode: string, team: Team): Promise<Player[]> {
    const redis: RedisClient = getRedis();
    const teamKey = `room:${roomCode}:team:${team}`;

    // Get session IDs from team set
    const sessionIds = await withTimeout(
        redis.sMembers(teamKey),
        TIMEOUTS.REDIS_OPERATION,
        `getTeamMembers-sMembers-${roomCode}-${team}`
    );

    if (sessionIds.length === 0) {
        return [];
    }

    // Batch fetch all player data
    const playerKeys = sessionIds.map((id) => `player:${id}`);
    const playerDataArray = await withTimeout(
        redis.mGet(playerKeys),
        TIMEOUTS.REDIS_OPERATION,
        `getTeamMembers-mGet-${roomCode}-${team}`
    );

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

        try {
            const cleanupOps: Promise<unknown>[] = [
                withTimeout(
                    redis.sRem(teamKey, ...orphanedIds),
                    TIMEOUTS.REDIS_OPERATION,
                    `getTeamMembers-sRem-${roomCode}-${team}`
                ),
            ];
            // Only delete player keys for truly expired sessions (no data in Redis)
            if (expiredIds.length > 0) {
                const playerKeysToDelete = expiredIds.map((id) => `player:${id}`);
                cleanupOps.push(
                    withTimeout(
                        redis.del(playerKeysToDelete),
                        TIMEOUTS.REDIS_OPERATION,
                        `getTeamMembers-del-${roomCode}-${team}`
                    )
                );
            }
            await Promise.all(cleanupOps);
            logger.debug(
                `Cleaned up ${orphanedIds.length} orphaned entries from ${teamKey} (${expiredIds.length} expired)`
            );

            // If team set is now empty, delete it
            const remainingCount = await withTimeout(
                redis.sCard(teamKey),
                TIMEOUTS.REDIS_OPERATION,
                `getTeamMembers-sCard-${roomCode}-${team}`
            );
            if (remainingCount === 0) {
                await withTimeout(
                    redis.del(teamKey),
                    TIMEOUTS.REDIS_OPERATION,
                    `getTeamMembers-delTeamKey-${roomCode}-${team}`
                );
                logger.debug(`Deleted empty team set ${teamKey}`);
            }
        } catch (cleanupError) {
            logger.warn(`Failed to clean up orphaned entries from ${teamKey}:`, (cleanupError as Error).message);
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
    const sessionIds = await withTimeout(
        redis.sMembers(`room:${roomCode}:players`),
        TIMEOUTS.REDIS_OPERATION,
        `getPlayersInRoom-sMembers-${roomCode}`
    );

    if (sessionIds.length === 0) {
        return [];
    }

    // Use MGET to fetch all players in a single Redis call (much faster than N individual GETs)
    const playerKeys = sessionIds.map((sessionId) => `player:${sessionId}`);
    const playerDataArray = await withTimeout(
        redis.mGet(playerKeys),
        TIMEOUTS.REDIS_OPERATION,
        `getPlayersInRoom-mGet-${roomCode}`
    );

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
        try {
            // Remove from players set
            await withTimeout(
                redis.sRem(`room:${roomCode}:players`, ...orphanedSessionIds),
                TIMEOUTS.REDIS_OPERATION,
                `getPlayersInRoom-sRem-players-${roomCode}`
            );

            // Also remove from team sets (both teams since we don't know which team they were on)
            // Performance fix: Batch DEL operations into single Redis calls
            const playerKeysToDelete = orphanedSessionIds.map((id) => `player:${id}`);
            const socketKeysToDelete = orphanedSessionIds.map((id) => `session:${id}:socket`);

            await Promise.all([
                withTimeout(
                    redis.sRem(`room:${roomCode}:team:red`, ...orphanedSessionIds),
                    TIMEOUTS.REDIS_OPERATION,
                    `getPlayersInRoom-sRem-red-${roomCode}`
                ),
                withTimeout(
                    redis.sRem(`room:${roomCode}:team:blue`, ...orphanedSessionIds),
                    TIMEOUTS.REDIS_OPERATION,
                    `getPlayersInRoom-sRem-blue-${roomCode}`
                ),
                withTimeout(
                    redis.del(playerKeysToDelete),
                    TIMEOUTS.REDIS_OPERATION,
                    `getPlayersInRoom-del-players-${roomCode}`
                ),
                withTimeout(
                    redis.del(socketKeysToDelete),
                    TIMEOUTS.REDIS_OPERATION,
                    `getPlayersInRoom-del-sockets-${roomCode}`
                ),
            ]);
            logger.info(`Cleaned up ${orphanedSessionIds.length} orphaned session IDs from room ${roomCode}`);
        } catch (cleanupError) {
            logger.warn(
                `Failed to clean up orphaned session IDs from room ${roomCode}:`,
                (cleanupError as Error).message
            );
        }
    }

    // Sort by join time, with sessionId as secondary key for stability
    // Handle null/undefined array elements defensively
    return players
        .filter((p): p is Player => p != null) // Remove any null/undefined entries
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
 * Acquires each player's mutation lock to prevent races with in-flight
 * setRole/setTeam operations that could restore a stale role after the reset.
 */
export async function resetRolesForNewGame(roomCode: string): Promise<Player[]> {
    const players = await getPlayersInRoom(roomCode);

    const results = await Promise.all(
        players.map((player) => {
            if (player.role && player.role !== 'spectator') {
                return withLock(
                    `player-mutation:${player.sessionId}`,
                    async () => {
                        return updatePlayer(player.sessionId, { role: 'spectator' as Role });
                    },
                    { lockTimeout: 3000, maxRetries: 5 }
                );
            }
            return Promise.resolve(player);
        })
    );

    return results;
}

/**
 * Rotate roles within each team for the next round of a match.
 * Per team: spymaster → clicker, clicker → spectator, one spectator → spymaster.
 * Preserves teams. Players without a team are left as-is.
 */
export async function rotateRolesForNextRound(roomCode: string): Promise<Player[]> {
    const players = await getPlayersInRoom(roomCode);

    // Group connected team members by team
    const teams: Record<string, Player[]> = { red: [], blue: [] };
    for (const p of players) {
        if (p.team && teams[p.team]) {
            teams[p.team].push(p);
        }
    }

    // Compute new role for each player
    const updates: { sessionId: string; role: Role }[] = [];

    for (const team of ['red', 'blue'] as const) {
        const members = teams[team];
        if (members.length === 0) continue;

        const spymaster = members.find((p) => p.role === 'spymaster');
        const clicker = members.find((p) => p.role === 'clicker');
        const spectators = members.filter((p) => p.role === 'spectator' || !p.role);

        // Pick the next spectator to promote to spymaster.
        // Use the first connected spectator, or fall back to the first spectator.
        const nextSpymaster = spectators.find((p) => p.connected) ?? spectators[0];

        // spymaster → clicker
        if (spymaster) {
            updates.push({ sessionId: spymaster.sessionId, role: 'clicker' });
        }
        // clicker → spectator
        if (clicker) {
            updates.push({ sessionId: clicker.sessionId, role: 'spectator' });
        }
        // spectator → spymaster
        if (nextSpymaster) {
            updates.push({ sessionId: nextSpymaster.sessionId, role: 'spymaster' });
        }
    }

    // Apply updates with locks
    if (updates.length > 0) {
        await Promise.all(
            updates.map(({ sessionId, role }) =>
                withLock(
                    `player-mutation:${sessionId}`,
                    async () => updatePlayer(sessionId, { role }),
                    { lockTimeout: 3000, maxRetries: 5 }
                )
            )
        );
    }

    // Return fresh player list after updates
    return getPlayersInRoom(roomCode);
}
