import fs from 'fs';
import path from 'path';

function loadLua(filename: string): string {
    return fs.readFileSync(path.join(__dirname, filename), 'utf8');
}

/** Atomic card reveal with game state updates */
export const REVEAL_CARD_SCRIPT: string = loadLua('revealCard.lua');

/** Atomic turn end with score updates */
export const END_TURN_SCRIPT: string = loadLua('endTurn.lua');

/** Atomic player field updates with TTL refresh */
export const UPDATE_PLAYER_SCRIPT: string = loadLua('updatePlayer.lua');

/** Atomic team change with empty-team validation */
export const SAFE_TEAM_SWITCH_SCRIPT: string = loadLua('safeTeamSwitch.lua');

/** Atomic role assignment with conflict checking */
export const SET_ROLE_SCRIPT: string = loadLua('setRole.lua');

/** Atomic host transfer with fallback */
export const HOST_TRANSFER_SCRIPT: string = loadLua('hostTransfer.lua');

/** Atomic room creation using SETNX. Returns: 1 if created, 0 if exists */
export const ATOMIC_CREATE_ROOM_SCRIPT: string = loadLua('atomicCreateRoom.lua');

/** Atomic room join with capacity check. Returns: 1=success, 0=full, -1=already member, -2=room deleted */
export const ATOMIC_JOIN_SCRIPT: string = loadLua('atomicJoin.lua');

/** Atomic TTL refresh of all room-related keys */
export const ATOMIC_REFRESH_TTL_SCRIPT: string = loadLua('atomicRefreshTtl.lua');

/** Atomic room status update (prevents TOCTOU race) */
export const ATOMIC_SET_ROOM_STATUS_SCRIPT: string = loadLua('atomicSetRoomStatus.lua');

/** Atomic player removal from room and team sets. Returns: player data JSON on success, nil if not found */
export const ATOMIC_REMOVE_PLAYER_SCRIPT: string = loadLua('atomicRemovePlayer.lua');

/** Atomic cleanup of a disconnected player. Returns: player data JSON, 'RECONNECTED' if connected, nil if not found */
export const ATOMIC_CLEANUP_DISCONNECTED_PLAYER_SCRIPT: string = loadLua('atomicCleanupDisconnectedPlayer.lua');

/** Atomic socket mapping + IP update. Returns: 1 on success, nil if player not found */
export const ATOMIC_SET_SOCKET_MAPPING_SCRIPT: string = loadLua('atomicSetSocketMapping.lua');

/** Atomic room settings update. Validates host, merges allowed keys */
export const ATOMIC_UPDATE_SETTINGS_SCRIPT: string = loadLua('atomicUpdateSettings.lua');

/** Atomic addTime operation for turn timers. Returns: new end time if successful, nil if timer doesn't exist or is expired */
export const ATOMIC_ADD_TIME_SCRIPT: string = loadLua('atomicAddTime.lua');

/** Atomic timer status check with expiration detection. Returns: JSON timer status, 'EXPIRED' if expired while paused, nil if no timer */
export const ATOMIC_TIMER_STATUS_SCRIPT: string = loadLua('atomicTimerStatus.lua');

/** Atomic pause timer: reads current state, calculates remaining time, and writes paused state in one operation */
export const ATOMIC_PAUSE_TIMER_SCRIPT: string = loadLua('atomicPauseTimer.lua');

/** Atomic timer resume: checks if paused timer expired, deletes if so. Returns: JSON with expired flag and remainingSeconds */
export const ATOMIC_RESUME_TIMER_SCRIPT: string = loadLua('atomicResumeTimer.lua');

/** Atomic reconnection token invalidation. Returns 1 if invalidated, 0 if no token existed */
export const INVALIDATE_TOKEN_SCRIPT: string = loadLua('invalidateToken.lua');

/** Atomic cleanup of orphaned reconnection tokens. Returns 1 if cleaned, 0 if player still exists */
export const CLEANUP_ORPHANED_TOKEN_SCRIPT: string = loadLua('cleanupOrphanedToken.lua');

/** Atomic game history save. Performs SET + ZADD + ZREMRANGEBYRANK + EXPIRE in a single atomic operation */
export const ATOMIC_SAVE_GAME_HISTORY_SCRIPT: string = loadLua('atomicSaveGameHistory.lua');

/** Atomic game state persist + room status update + players TTL refresh */
export const ATOMIC_PERSIST_GAME_STATE_SCRIPT: string = loadLua('atomicPersistGameState.lua');

/** Atomic reconnection token validation and consumption (GETDEL pattern) */
export const ATOMIC_VALIDATE_RECONNECT_TOKEN_SCRIPT: string = loadLua('atomicValidateReconnectToken.lua');

/** Atomic reconnection token generation (returns existing if race) */
export const ATOMIC_GENERATE_RECONNECT_TOKEN_SCRIPT: string = loadLua('atomicGenerateReconnectToken.lua');

/** Atomic rate limit increment with TTL (INCR + EXPIRE on first set). Returns: current count */
export const ATOMIC_RATE_LIMIT_SCRIPT: string = loadLua('atomicRateLimit.lua');

/** Safe orphan cleanup: re-verifies player key is nil before removing from sets (prevents TOCTOU race with reconnection) */
export const SAFE_CLEANUP_ORPHANS_SCRIPT: string = loadLua('safeCleanupOrphans.lua');

/** Safe lock release (only release if we own the lock) */
export const RELEASE_LOCK_SCRIPT: string = loadLua('releaseLock.lua');

/** Lock extension (only extend if we own the lock) */
export const EXTEND_LOCK_SCRIPT: string = loadLua('extendLock.lua');
