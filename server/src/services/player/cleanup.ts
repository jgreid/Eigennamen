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
import { setGauge, METRIC_NAMES } from '../../utils/metrics';

// Backpressure: when the cleanup queue exceeds this threshold,
// additional sweep passes are run to prevent unbounded growth.
const CLEANUP_BACKPRESSURE_THRESHOLD = 200;
// Hard cap on total items processed per cycle to prevent event-loop starvation.
// At 100 items/batch, this allows up to 1000 items per cycle (10 batches).
const CLEANUP_MAX_ITEMS_PER_CYCLE = 1000;

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
    const cleanupTime = Date.now() + REDIS_TTL.DISCONNECTED_PLAYER * 1000;
    try {
        await withTimeout(
            redis.zAdd('scheduled:player:cleanup', {
                score: cleanupTime,
                value: JSON.stringify({ sessionId, roomCode: player.roomCode }),
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
        // Atomically dequeue entries due for cleanup using ZRANGEBYSCORE + ZREM.
        // This Lua script ensures that multiple instances don't process the same
        // entries — each entry is removed before being returned.
        const dequeueScript = `
            local entries = redis.call('ZRANGEBYSCORE', KEYS[1], 0, ARGV[1], 'LIMIT', 0, tonumber(ARGV[2]))
            if #entries == 0 then return {} end
            for _, entry in ipairs(entries) do
                redis.call('ZREM', KEYS[1], entry)
            end
            return entries
        `;
        const toCleanup = (await withTimeout(
            redis.eval(dequeueScript, {
                keys: ['scheduled:player:cleanup'],
                arguments: [now.toString(), limit.toString()],
            }),
            TIMEOUTS.REDIS_OPERATION,
            'processScheduledCleanups-dequeue'
        )) as string[];

        if (!toCleanup || toCleanup.length === 0) {
            return 0;
        }

        // Periodically trim ancient entries (>24h old) to prevent unbounded set growth
        try {
            const oneDayAgo = now - 24 * 60 * 60 * 1000;
            await redis.eval("return redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, ARGV[1])", {
                keys: ['scheduled:player:cleanup'],
                arguments: [oneDayAgo.toString()],
            });
        } catch {
            // Non-critical cleanup
        }

        let cleanedUp = 0;
        /* eslint-disable no-await-in-loop */
        for (const entry of toCleanup) {
            try {
                const { sessionId, roomCode } = parseJSON(entry, cleanupEntrySchema, 'cleanup entry');

                // Atomically check connected status AND remove in a single Lua script.
                // This prevents a TOCTOU race where a player reconnects between
                // reading their status and removing them.
                const result = (await withTimeout(
                    redis.eval(ATOMIC_CLEANUP_DISCONNECTED_PLAYER_SCRIPT, {
                        keys: [`player:${sessionId}`],
                        arguments: [sessionId],
                    }),
                    TIMEOUTS.REDIS_OPERATION,
                    `cleanupDisconnectedPlayer-lua-${sessionId}`
                )) as string | null;

                if (result === 'RECONNECTED') {
                    // Player reconnected - already dequeued from schedule by Lua above
                    logger.debug(`Skipping cleanup for reconnected player ${sessionId}`);
                    continue;
                }

                if (!result) {
                    // Player key already gone - already dequeued from schedule by Lua above
                    continue;
                }

                // Player was atomically removed by the Lua script
                cleanedUp++;
                logger.info(`Cleaned up disconnected player ${sessionId} from room ${roomCode}`);

                // Non-critical: clean up reconnection tokens
                try {
                    await invalidateRoomReconnectToken(sessionId);
                } catch (tokenError) {
                    logger.warn(
                        `Failed to clean up reconnection token for ${sessionId}:`,
                        (tokenError as Error).message
                    );
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
                        logger.warn(
                            `Failed to check/cleanup orphaned room ${roomCode}:`,
                            (roomCleanupError as Error).message
                        );
                    }
                }

                // Entry already removed from sorted set by dequeue Lua script above
            } catch (parseError) {
                // Entry already removed from sorted set, just log the error
                logger.error('Failed to parse cleanup entry:', (parseError as Error).message);
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

    let cleanupRunning = false;
    cleanupInterval = setInterval(async () => {
        if (cleanupRunning) return; // Prevent overlapping cleanup cycles
        cleanupRunning = true;
        try {
            const cleaned = await processScheduledCleanups(PLAYER_CLEANUP.BATCH_SIZE);

            // Backpressure: if we processed a full batch, the queue may be growing
            // faster than we can drain it. Check depth and run additional sweeps.
            if (cleaned >= PLAYER_CLEANUP.BATCH_SIZE) {
                const redis: RedisClient = getRedis();
                const queueDepth = await withTimeout(
                    redis.zCard('scheduled:player:cleanup'),
                    TIMEOUTS.REDIS_OPERATION,
                    'cleanupBackpressure-zCard'
                );

                setGauge(METRIC_NAMES.CLEANUP_QUEUE_DEPTH, queueDepth);

                if (queueDepth > CLEANUP_BACKPRESSURE_THRESHOLD) {
                    logger.warn(
                        `Cleanup queue depth (${queueDepth}) exceeds threshold (${CLEANUP_BACKPRESSURE_THRESHOLD}), running additional sweeps`
                    );

                    // Continue sweeping until queue is drained below threshold
                    // or we hit the per-cycle hard cap to prevent event-loop starvation.
                    let totalProcessed = cleaned;
                    /* eslint-disable no-await-in-loop */
                    while (totalProcessed < CLEANUP_MAX_ITEMS_PER_CYCLE) {
                        const additional = await processScheduledCleanups(PLAYER_CLEANUP.BATCH_SIZE);
                        totalProcessed += additional;
                        if (additional < PLAYER_CLEANUP.BATCH_SIZE) break;
                    }
                    /* eslint-enable no-await-in-loop */

                    const finalDepth = await withTimeout(
                        redis.zCard('scheduled:player:cleanup'),
                        TIMEOUTS.REDIS_OPERATION,
                        'cleanupBackpressure-zCard-final'
                    );
                    setGauge(METRIC_NAMES.CLEANUP_QUEUE_DEPTH, finalDepth);

                    if (finalDepth > CLEANUP_BACKPRESSURE_THRESHOLD) {
                        logger.warn(
                            `Cleanup queue still elevated after draining (${finalDepth} remaining, processed ${totalProcessed} this cycle)`
                        );
                    } else {
                        logger.info(
                            `Cleanup backpressure resolved: processed ${totalProcessed} items, ${finalDepth} remaining`
                        );
                    }
                }
            }
        } catch (error) {
            logger.error('Error in cleanup task:', (error as Error).message);
        }
        try {
            await cleanupOrphanedReconnectionTokens();
        } catch (error) {
            logger.error('Error in reconnection token cleanup:', (error as Error).message);
        } finally {
            cleanupRunning = false;
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
