import type { Player, RedisClient } from '../../types';

import { getRedis } from '../../config/redis';
import logger from '../../utils/logger';
import { withTimeout, TIMEOUTS } from '../../utils/timeout';
import { REDIS_TTL, PLAYER_CLEANUP } from '../../config/constants';
import { parseJSON } from '../../utils/parseJSON';
import { ATOMIC_CLEANUP_DISCONNECTED_PLAYER_SCRIPT } from '../../scripts';
import { z } from 'zod';
import { getPlayer, updatePlayer } from '../playerService';
import { invalidateRoomReconnectToken, cleanupOrphanedReconnectionTokens } from './reconnection';

// Late-bound room cleanup callback to break circular dependency with roomService.
// Set via registerRoomCleanup() during server initialization.
let _roomCleanupFn: ((roomCode: string) => Promise<void>) | null = null;

/**
 * Register the room cleanup function (called during server init to break
 * the playerService <-> roomService circular dependency).
 */
export function registerRoomCleanup(fn: (roomCode: string) => Promise<void>): void {
    _roomCleanupFn = fn;
}

const cleanupEntrySchema = z.object({
    sessionId: z.string(),
    roomCode: z.string(),
});

/**
 * Handle player disconnection
 * Updates player status and schedules cleanup after grace period
 * Note: Token generation is handled by generateReconnectionToken() which
 * should be called before this function in socket/index.ts
 * Schedule player cleanup after grace period
 */
export async function handleDisconnect(sessionId: string): Promise<Player | null> {
    const redis: RedisClient = getRedis();
    let player: Player | null;
    try {
        player = await getPlayer(sessionId);
    } catch {
        // Corrupted player data — already cleaned up by getPlayer
        return null;
    }

    if (!player) {
        return null;
    }

    // Mark as disconnected but don't remove yet (allow reconnection)
    await updatePlayer(sessionId, { connected: false, disconnectedAt: Date.now() });

    logger.info(`Player ${sessionId} disconnected from room ${player.roomCode}`);

    // Schedule removal after grace period using sorted set
    const cleanupTime = Date.now() + (REDIS_TTL.DISCONNECTED_PLAYER * 1000);
    try {
        await withTimeout(
            redis.zAdd('scheduled:player:cleanup', {
                score: cleanupTime,
                value: JSON.stringify({ sessionId, roomCode: player.roomCode })
            }),
            TIMEOUTS.REDIS_OPERATION,
            `handleDisconnect-zAdd-${sessionId}`
        );
    } catch (scheduleError) {
        logger.error(`Failed to schedule cleanup for player ${sessionId}:`, (scheduleError as Error).message);
        // Don't throw — player is already marked disconnected; the TTL backup below
        // and periodic cleanup will still handle eventual removal.
    }

    // Also set a shorter TTL on the player key as backup
    try {
        await withTimeout(
            redis.expire(`player:${sessionId}`, REDIS_TTL.DISCONNECTED_PLAYER),
            TIMEOUTS.REDIS_OPERATION,
            `handleDisconnect-expire-${sessionId}`
        );
    } catch (expireError) {
        logger.warn(`Failed to set backup TTL for player ${sessionId}:`, (expireError as Error).message);
    }

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
        const toCleanup = await withTimeout(
            redis.zRangeByScore(
                'scheduled:player:cleanup',
                0,
                now,
                { LIMIT: { offset: 0, count: limit } }
            ),
            TIMEOUTS.REDIS_OPERATION,
            'processScheduledCleanups-zRangeByScore'
        );

        if (toCleanup.length === 0) {
            return 0;
        }

        let cleanedUp = 0;
        /* eslint-disable no-await-in-loop */
        for (const entry of toCleanup) {
            try {
                const { sessionId, roomCode } = parseJSON(entry, cleanupEntrySchema, 'cleanup entry');

                // Atomically check connected status AND remove in a single Lua script.
                // This prevents a TOCTOU race where a player reconnects between
                // reading their status and removing them.
                const result = await withTimeout(
                    redis.eval(
                        ATOMIC_CLEANUP_DISCONNECTED_PLAYER_SCRIPT,
                        {
                            keys: [`player:${sessionId}`],
                            arguments: [sessionId]
                        }
                    ),
                    TIMEOUTS.REDIS_OPERATION,
                    `cleanupDisconnectedPlayer-lua-${sessionId}`
                ) as string | null;

                if (result === 'RECONNECTED') {
                    // Player reconnected - skip removal, just clear schedule entry
                    logger.debug(`Skipping cleanup for reconnected player ${sessionId}`);
                    await withTimeout(
                        redis.zRem('scheduled:player:cleanup', entry),
                        TIMEOUTS.REDIS_OPERATION,
                        `processCleanups-zRem-reconnected-${sessionId}`
                    );
                    continue;
                }

                if (!result) {
                    // Player key already gone - just remove from schedule
                    await withTimeout(
                        redis.zRem('scheduled:player:cleanup', entry),
                        TIMEOUTS.REDIS_OPERATION,
                        `processCleanups-zRem-gone-${sessionId}`
                    );
                    continue;
                }

                // Player was atomically removed by the Lua script
                cleanedUp++;
                logger.info(`Cleaned up disconnected player ${sessionId} from room ${roomCode}`);

                // Non-critical: clean up reconnection tokens
                try {
                    await invalidateRoomReconnectToken(sessionId);
                } catch (tokenError) {
                    logger.warn(`Failed to clean up reconnection token for ${sessionId}:`, (tokenError as Error).message);
                }

                // Check if room is now empty and clean it up to prevent orphaned rooms.
                // Orphaned rooms block new room creation with the same code (SETNX returns 0)
                // and waste memory until their TTL expires.
                if (roomCode && _roomCleanupFn) {
                    try {
                        const remainingCount = await withTimeout(
                            redis.sCard(`room:${roomCode}:players`),
                            TIMEOUTS.REDIS_OPERATION,
                            `processCleanups-sCard-${roomCode}`
                        );
                        if (remainingCount === 0) {
                            const roomExists = await withTimeout(
                                redis.exists(`room:${roomCode}`),
                                TIMEOUTS.REDIS_OPERATION,
                                `processCleanups-exists-${roomCode}`
                            );
                            if (roomExists === 1) {
                                await _roomCleanupFn(roomCode);
                                logger.info(`Cleaned up orphaned room ${roomCode} (no players remaining)`);
                            }
                        }
                    } catch (roomCleanupError) {
                        logger.warn(`Failed to check/cleanup orphaned room ${roomCode}:`, (roomCleanupError as Error).message);
                    }
                }

                // Remove from cleanup schedule
                await withTimeout(
                    redis.zRem('scheduled:player:cleanup', entry),
                    TIMEOUTS.REDIS_OPERATION,
                    `processCleanups-zRem-done-${sessionId}`
                );
            } catch (parseError) {
                logger.error('Failed to parse cleanup entry:', (parseError as Error).message);
                // Remove invalid entry
                await withTimeout(
                    redis.zRem('scheduled:player:cleanup', entry),
                    TIMEOUTS.REDIS_OPERATION,
                    'processCleanups-zRem-invalid'
                );
            }
        }
        /* eslint-enable no-await-in-loop */

        if (cleanedUp > 0) {
            logger.info(`Processed ${cleanedUp} scheduled player cleanups`);
        }

        return cleanedUp;
    } catch (error) {
        logger.error('Error processing scheduled cleanups:', (error as Error).message);
        return 0;
    }
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
