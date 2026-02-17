/**
 * Player Room Sync - Per-player mutex for spectator room membership
 *
 * Prevents race conditions where concurrent setTeam + setRole operations
 * produce inconsistent socket room state (e.g., player in both room:X and
 * spectators:X). Uses a per-player lock to serialize room membership updates.
 */

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
    // Only evict entries whose promises have already settled to avoid
    // deleting locks that are still being awaited by concurrent callers.
    if (roomSyncLocks.size > ROOM_SYNC_LOCKS_MAX_SIZE) {
        const now = Date.now();
        let evicted = 0;
        for (const [key, entry] of roomSyncLocks) {
            if (entry.settled && now - entry.createdAt > ROOM_SYNC_LOCK_MAX_AGE_MS) {
                roomSyncLocks.delete(key);
                evicted++;
            }
        }
        logger.warn(`roomSyncLocks safety valve: evicted ${evicted} stale entries, ${roomSyncLocks.size} remaining`);
    }

    // Serialize room membership updates per player to prevent race conditions
    const lockKey = `${sessionId}:${roomCode}`;
    const existingEntry = roomSyncLocks.get(lockKey);
    const existingLock = existingEntry?.promise || Promise.resolve();

    const entry: LockEntry = { promise: null as unknown as Promise<void>, createdAt: Date.now(), settled: false };

    const newLock = existingLock.then(async () => {
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
    }).catch((err) => {
        logger.warn(`syncSpectatorRoomMembership failed for ${sessionId}:`, err instanceof Error ? err.message : String(err));
    }).finally(() => {
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
    await Promise.race([
        newLock,
        new Promise<void>((_, reject) =>
            setTimeout(() => reject(new Error(`Room sync mutex timeout for ${lockKey}`)), MUTEX_TIMEOUT)
        )
    ]).catch((err) => {
        logger.warn(`syncSpectatorRoomMembership mutex timeout or error for ${sessionId}:`, err instanceof Error ? err.message : String(err));
    });
}
