import type { Player } from '../../types';
import type { GameSocket } from './types';

import * as playerService from '../../services/playerService';
import logger from '../../utils/logger';
import { isPlayerSpectator } from '../playerContext';
import { TIMEOUTS } from '../../utils/timeout';

/**
 * Lock entry for per-player mutex
 */
interface LockEntry {
    promise: Promise<void>;
    createdAt: number;
    settled: boolean;
}

const roomSyncLocks = new Map<string, LockEntry>();
const ROOM_SYNC_LOCKS_MAX_SIZE = 10_000;
const ROOM_SYNC_LOCK_MAX_AGE_MS = 60_000;

/**
 * Evict entries from the roomSyncLocks map when it exceeds the max size.
 * Only evicts settled entries to avoid deleting locks that are actively held.
 * Uses two passes: first evicts old settled entries, then any settled entries
 * if the map is still over capacity.
 */
function evictStaleLocks(): void {
    const now = Date.now();
    let evicted = 0;

    // First pass: evict settled entries older than max age
    for (const [key, entry] of roomSyncLocks) {
        if (entry.settled && now - entry.createdAt > ROOM_SYNC_LOCK_MAX_AGE_MS) {
            roomSyncLocks.delete(key);
            evicted++;
        }
    }

    // Second pass: if still over capacity, evict any settled entries regardless of age
    if (roomSyncLocks.size > ROOM_SYNC_LOCKS_MAX_SIZE) {
        for (const [key, entry] of roomSyncLocks) {
            if (roomSyncLocks.size <= ROOM_SYNC_LOCKS_MAX_SIZE) break;
            if (entry.settled) {
                roomSyncLocks.delete(key);
                evicted++;
            }
        }
    }

    logger.warn(`roomSyncLocks safety valve: evicted ${evicted} stale entries, ${roomSyncLocks.size} remaining`);

    // If still over capacity after evicting all settled entries, all remaining
    // entries are active locks. Log a warning but never evict active locks.
    if (roomSyncLocks.size > ROOM_SYNC_LOCKS_MAX_SIZE) {
        logger.warn(`roomSyncLocks: ${roomSyncLocks.size} active locks exceed capacity — all entries are unsettled`);
    }
}

/**
 * Bug #14 Fix: Helper to sync spectator room membership based on CURRENT player state.
 * Uses a per-player mutex to serialize room membership updates, preventing the race
 * where concurrent setTeam/setRole operations leave a player in multiple socket rooms.
 */
export async function syncSpectatorRoomMembership(
    socket: GameSocket,
    roomCode: string,
    sessionId: string
): Promise<void> {
    // Safety valve: evict stale entries if the map grows too large.
    if (roomSyncLocks.size > ROOM_SYNC_LOCKS_MAX_SIZE) {
        evictStaleLocks();
    }

    // Serialize room membership updates per player to prevent race conditions
    const lockKey = `${sessionId}:${roomCode}`;
    const existingEntry = roomSyncLocks.get(lockKey);
    const existingLock = existingEntry?.promise || Promise.resolve();

    const entry: LockEntry = { promise: Promise.resolve(), createdAt: Date.now(), settled: false };

    const newLock = existingLock
        .then(async () => {
            // Re-fetch current player state to ensure we have the latest team/role
            const currentPlayer: Player | null = await playerService.getPlayer(sessionId);
            if (!currentPlayer) return;

            const spectatorRoom = `spectators:${roomCode}`;

            // Player should be in spectators room if:
            // - They have no team, OR
            // - Their role is 'spectator'
            const shouldBeInSpectatorRoom = isPlayerSpectator(currentPlayer);

            if (shouldBeInSpectatorRoom) {
                socket.join(spectatorRoom);
            } else {
                socket.leave(spectatorRoom);
            }
        })
        .catch((err) => {
            logger.warn(
                `syncSpectatorRoomMembership failed for ${sessionId}:`,
                err instanceof Error ? err.message : String(err)
            );
        })
        .finally(() => {
            entry.settled = true;
            // Clean up lock after completion — only if this entry is still the current one
            if (roomSyncLocks.get(lockKey) === entry) {
                roomSyncLocks.delete(lockKey);
            }
        });

    entry.promise = newLock;
    roomSyncLocks.set(lockKey, entry);

    // Timeout prevents unbounded queueing if a prior lock operation hangs.
    // On timeout, the queued operation is abandoned but the lock chain is
    // cleaned up via .finally() above, so subsequent operations proceed.
    const MUTEX_TIMEOUT = TIMEOUTS.GAME_ACTION;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    await Promise.race([
        newLock.then(() => {
            // Clear the timeout when the lock resolves to prevent timer leak
            if (timeoutId !== undefined) clearTimeout(timeoutId);
        }),
        new Promise<void>((_, reject) => {
            timeoutId = setTimeout(() => reject(new Error(`Room sync mutex timeout for ${lockKey}`)), MUTEX_TIMEOUT);
        }),
    ]).catch((err) => {
        if (timeoutId !== undefined) clearTimeout(timeoutId);
        logger.warn(
            `syncSpectatorRoomMembership mutex timeout or error for ${sessionId}:`,
            err instanceof Error ? err.message : String(err)
        );
    });
}
