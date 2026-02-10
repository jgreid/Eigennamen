/**
 * Player Service - Player management logic
 */

import type { Team, Role, Player } from '../types';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getRedis } = require('../config/redis');
const logger = require('../utils/logger');
const { withTimeout, TIMEOUTS } = require('../utils/timeout');
const { REDIS_TTL, SESSION_SECURITY, PLAYER_CLEANUP } = require('../config/constants');
const { ServerError, ValidationError } = require('../errors/GameError');

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
 * Token data stored for reconnection
 */
export interface ReconnectionTokenData {
    sessionId: string;
    roomCode: string;
    nickname: string;
    team: Team | null;
    role: Role;
    createdAt: number;
}

/**
 * Token validation result
 */
export interface TokenValidationResult {
    valid: boolean;
    reason?: string;
    tokenData?: ReconnectionTokenData;
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

/**
 * Spectator info
 */
export interface SpectatorInfo {
    sessionId: string;
    nickname: string;
    team: Team | null;
}

/**
 * Spectators response
 */
export interface SpectatorsResponse {
    count: number;
    spectators: SpectatorInfo[];
}

/**
 * Team statistics
 */
export interface TeamStats {
    total: number;
    spymaster: string | null;
    clicker: string | null;
}

/**
 * Room statistics
 */
export interface RoomStats {
    totalPlayers: number;
    spectatorCount: number;
    teams: {
        red: TeamStats;
        blue: TeamStats;
    };
}

/**
 * Redis client type (simplified for migration)
 */
interface RedisClient {
    get(key: string): Promise<string | null>;
    set(key: string, value: string, options?: { EX?: number; NX?: boolean }): Promise<string | null>;
    del(keys: string | string[]): Promise<number>;
    sAdd(key: string, member: string): Promise<number>;
    sRem(key: string, ...members: string[]): Promise<number>;
    sMembers(key: string): Promise<string[]>;
    sCard(key: string): Promise<number>;
    mGet(keys: string[]): Promise<(string | null)[]>;
    expire(key: string, seconds: number): Promise<number>;
    watch(key: string): Promise<string>;
    unwatch(): Promise<string>;
    multi(): RedisTransaction;
    eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
    zAdd(key: string, member: { score: number; value: string }): Promise<number>;
    zRem(key: string, member: string): Promise<number>;
    zRangeByScore(key: string, min: number, max: number, options?: { LIMIT?: { offset: number; count: number } }): Promise<string[]>;
}

interface RedisTransaction {
    set(key: string, value: string, options?: { EX?: number }): RedisTransaction;
    exec(): Promise<unknown[] | null>;
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
    try {
        return JSON.parse(playerData) as Player;
    } catch (e) {
        logger.error(`Failed to parse player data for ${sessionId}:`, (e as Error).message);
        return null;
    }
}

/**
 * Update player data atomically using WATCH/MULTI to prevent lost updates
 * from concurrent read-modify-write operations (e.g., simultaneous disconnect + nickname change).
 */
export async function updatePlayer(
    sessionId: string,
    updates: PlayerUpdateData
): Promise<Player> {
    const redis: RedisClient = getRedis();
    const playerKey = `player:${sessionId}`;
    const maxRetries = 3;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        await redis.watch(playerKey);

        const playerData = await redis.get(playerKey);
        if (!playerData) {
            await redis.unwatch();
            throw new ServerError('Player not found');
        }

        let player: Player;
        try {
            player = JSON.parse(playerData) as Player;
        } catch {
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
        logger.debug(`updatePlayer transaction conflict for ${sessionId}, attempt ${attempt + 1}`);
    }

    // All atomic retries exhausted — throw rather than falling back to a non-atomic
    // write that could silently overwrite concurrent updates
    logger.error(`updatePlayer failed atomically after ${maxRetries} retries for ${sessionId}`);
    throw ServerError.concurrentModification(null, `updatePlayer(${sessionId})`);
}

/**
 * Lua script for atomic team switch with empty-team validation AND team set maintenance
 * ISSUE #1 & #59 FIX: Team set operations now inside Lua script for atomicity
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
        const parsed = JSON.parse(result) as { success: boolean; reason?: string; player?: Player };

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
 * FIX: Prevents race condition where two players could both become spymaster/clicker
 * Atomically checks if role is available and assigns it in a single operation
 * Returns: {success: true, player: {...}} on success
 *          {success: false, reason: 'ROLE_TAKEN', existingNickname: '...'} if role already assigned
 *          {success: false, reason: 'NO_TEAM'} if player has no team
 *          nil if player not found
 */
const ATOMIC_SET_ROLE_SCRIPT: string = fs.readFileSync(path.join(__dirname, '../scripts/setRole.lua'), 'utf8');

/**
 * Set player's role with atomic check to prevent race conditions
 * FIX: Uses Lua script for truly atomic role assignment
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
        const parsed = JSON.parse(result) as { success: boolean; reason?: string; existingNickname?: string; player?: Player };

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
 * SECURITY FIX: Defense-in-depth validation for nickname
 */
export function setNickname(sessionId: string, nickname: string): Promise<Player> {
    // Zod schema already validates and trims the nickname at the handler level
    const trimmed = (nickname || '').trim();
    return updatePlayer(sessionId, { nickname: trimmed });
}

/**
 * Get all players on a specific team - O(1) lookup using team sets
 * ISSUE #12 FIX: Also cleans up expired player data keys
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
            try {
                const player = JSON.parse(playerData) as Player;
                // Verify player is still on this team (consistency check)
                if (player.team === team) {
                    players.push(player);
                } else {
                    // Player changed teams but set wasn't updated - clean up
                    orphanedIds.push(currentSessionId);
                }
            } catch (e) {
                logger.error(`Failed to parse player data for ${currentSessionId}:`, (e as Error).message);
                orphanedIds.push(currentSessionId);
            }
        } else if (currentSessionId) {
            // Player data expired - clean up
            orphanedIds.push(currentSessionId);
        }
    }

    // ISSUE #12 FIX: Clean up orphaned entries and their lingering data
    if (orphanedIds.length > 0) {
        // Performance fix: Batch DEL operations into single Redis call
        const playerKeysToDelete = orphanedIds.map(id => `player:${id}`);
        await Promise.all([
            redis.sRem(teamKey, ...orphanedIds),
            redis.del(playerKeysToDelete)
        ]);
        logger.debug(`Cleaned up ${orphanedIds.length} orphaned entries from ${teamKey}`);

        // ISSUE #13 FIX: If team set is now empty, delete it
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
 * ISSUE #12 FIX: Now cleans up all orphaned data including player keys and team sets
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
            try {
                const player = JSON.parse(playerData) as Player;
                players.push(player);
            } catch (e) {
                logger.error(`Failed to parse player data for ${currentSessionId}:`, (e as Error).message);
                orphanedSessionIds.push(currentSessionId);
            }
        } else if (currentSessionId) {
            // Player data expired but session ID still in set - mark for cleanup
            orphanedSessionIds.push(currentSessionId);
        }
    }

    // ISSUE #12 FIX: Clean up all orphaned data atomically
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
    // BUG FIX: Handle null/undefined array elements defensively
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
 * Also removes from team set if player was on a team
 */
export async function removePlayer(sessionId: string): Promise<void> {
    const redis: RedisClient = getRedis();
    const player = await getPlayer(sessionId);

    if (player) {
        // Remove from room's player set
        await redis.sRem(`room:${player.roomCode}:players`, sessionId);

        // Remove from team set if player was on a team
        if (player.team) {
            await redis.sRem(`room:${player.roomCode}:team:${player.team}`, sessionId);
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
 * ISSUE #57 FIX: Schedule player cleanup after grace period
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

    // ISSUE #57 FIX: Schedule removal after grace period using sorted set
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
 * Validate reconnection token for socket auth
 * Uses the same token storage as generateReconnectionToken() for consistency
 * ISSUE #17 FIX: Require valid token for reconnection to prevent session hijacking
 */
export async function validateReconnectToken(sessionId: string, token?: string): Promise<boolean> {
    const redis: RedisClient = getRedis();

    // If no token provided, check if player is still connected (fresh connection)
    if (!token) {
        const player = await getPlayer(sessionId);
        // Allow if player exists and is still connected (not disconnected yet)
        if (player && player.connected) {
            return true;
        }
        // Player is disconnected - require token
        logger.warn('Reconnection attempted without token', { sessionId });
        return false;
    }

    // Use same key as generateReconnectionToken stores session->token mapping
    const storedToken = await redis.get(`reconnect:session:${sessionId}`);

    if (!storedToken) {
        // No stored token - either expired or never set
        logger.debug('No reconnection token found', { sessionId });
        return false;
    }

    // FIX: Validate lengths match before constant-time comparison
    // timingSafeEqual throws if buffer lengths differ, which would crash the server
    if (storedToken.length !== token.length) {
        logger.warn('Reconnection token length mismatch', { sessionId });
        return false;
    }

    // Constant-time comparison to prevent timing attacks
    const isValid = crypto.timingSafeEqual(
        Buffer.from(storedToken, 'utf8'),
        Buffer.from(token, 'utf8')
    );

    if (isValid) {
        // CRITICAL FIX: Don't consume token here - let room:reconnect consume it
        // This fixes the race condition where socket auth validation consumed the
        // token before room:reconnect could use it for full state recovery.
        // Token will be consumed when room:reconnect successfully completes.
        logger.info('Reconnection token verified (not consumed)', { sessionId });
    } else {
        logger.warn('Invalid reconnection token', { sessionId });
    }

    return isValid;
}

/**
 * Process scheduled player cleanups
 * ISSUE #57 FIX: Run this periodically to clean up disconnected players
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
                const { sessionId, roomCode } = JSON.parse(entry) as { sessionId: string; roomCode: string };

                // Check if player reconnected
                const player = await getPlayer(sessionId);
                if (player && !player.connected) {
                    // Player still disconnected - remove them
                    await removePlayer(sessionId);
                    cleanedUp++;
                    logger.info(`Cleaned up disconnected player ${sessionId} from room ${roomCode}`);
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
 * Only creates mapping if player exists to prevent orphaned mappings
 */
export async function setSocketMapping(
    sessionId: string,
    socketId: string,
    clientIP: string | null = null
): Promise<boolean> {
    const redis: RedisClient = getRedis();

    // First verify player exists to prevent orphaned socket mappings
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
 * ISSUE #57 FIX: Process scheduled cleanups every 60 seconds
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
 * Generate a secure reconnection token for a disconnecting player
 * ISSUE #17 FIX: Secure reconnection via short-lived tokens
 */
export async function generateReconnectionToken(sessionId: string): Promise<string | null> {
    const redis: RedisClient = getRedis();
    const player = await getPlayer(sessionId);

    if (!player) {
        return null;
    }

    const ttl: number = SESSION_SECURITY.RECONNECTION_TOKEN_TTL_SECONDS || 300;

    // Generate a cryptographically secure random token
    const tokenBytes: number = SESSION_SECURITY.RECONNECTION_TOKEN_LENGTH || 32;
    const token: string = crypto.randomBytes(tokenBytes).toString('hex');

    // Store token with session data for validation
    const tokenData: ReconnectionTokenData = {
        sessionId,
        roomCode: player.roomCode,
        nickname: player.nickname,
        team: player.team,
        role: player.role,
        createdAt: Date.now()
    };

    // Atomic Lua script: either return the existing token or set both mappings
    // in a single operation, eliminating the TOCTOU race where a token could
    // expire between the NX check and the subsequent GET.
    const sessionKey = `reconnect:session:${sessionId}`;
    const tokenKey = `reconnect:token:${token}`;

    const luaScript = `
        local sessionKey = KEYS[1]
        local tokenKey = KEYS[2]
        local newToken = ARGV[1]
        local tokenData = ARGV[2]
        local ttl = tonumber(ARGV[3])

        -- Try to get existing token for this session
        local existing = redis.call('GET', sessionKey)
        if existing then
            return existing
        end

        -- No existing token — set both mappings atomically
        redis.call('SET', sessionKey, newToken, 'EX', ttl)
        redis.call('SET', tokenKey, tokenData, 'EX', ttl)
        return newToken
    `;

    const result = await redis.eval(luaScript, {
        keys: [sessionKey, tokenKey],
        arguments: [token, JSON.stringify(tokenData), String(ttl)]
    });

    const returnedToken = result as string;
    if (returnedToken !== token) {
        logger.debug(`Returning existing reconnection token for session ${sessionId} (race resolved)`);
    } else {
        logger.debug(`Generated reconnection token for session ${sessionId}, TTL: ${ttl}s`);
    }

    return returnedToken;
}

/**
 * Validate and consume a reconnection token
 * ISSUE #17 FIX: Secure reconnection via short-lived tokens
 */
export async function validateReconnectionToken(
    token: string,
    sessionId: string
): Promise<TokenValidationResult> {
    const redis: RedisClient = getRedis();

    if (!token || typeof token !== 'string') {
        return { valid: false, reason: 'INVALID_TOKEN_FORMAT' };
    }

    // Look up the token
    const tokenDataStr = await redis.get(`reconnect:token:${token}`);

    if (!tokenDataStr) {
        logger.warn('Reconnection token not found or expired', { sessionId });
        return { valid: false, reason: 'TOKEN_EXPIRED_OR_INVALID' };
    }

    let tokenData: ReconnectionTokenData;
    try {
        tokenData = JSON.parse(tokenDataStr) as ReconnectionTokenData;
    } catch (e) {
        logger.error('Failed to parse reconnection token data', { sessionId, error: (e as Error).message });
        return { valid: false, reason: 'TOKEN_CORRUPTED' };
    }

    // Verify the token belongs to this session
    // Note: This is not a timing attack vector since the token itself is the secret.
    // The sessionId check prevents cross-session token reuse after successful token lookup.
    if (tokenData.sessionId !== sessionId) {
        logger.warn('Reconnection token session mismatch', {
            expectedSession: tokenData.sessionId,
            providedSession: sessionId
        });
        return { valid: false, reason: 'SESSION_MISMATCH' };
    }

    // Token is valid - consume it (one-time use)
    await redis.del(`reconnect:token:${token}`);
    await redis.del(`reconnect:session:${sessionId}`);

    logger.info(`Reconnection token validated and consumed for session ${sessionId}`);

    return { valid: true, tokenData };
}

/**
 * Get existing reconnection token for a session (if any)
 * Used to avoid generating multiple tokens for the same session
 */
export function getExistingReconnectionToken(sessionId: string): Promise<string | null> {
    const redis: RedisClient = getRedis();
    return redis.get(`reconnect:session:${sessionId}`);
}

/**
 * Invalidate any existing reconnection token for a session
 * Called when player successfully reconnects or explicitly leaves
 */
export async function invalidateReconnectionToken(sessionId: string): Promise<void> {
    const redis: RedisClient = getRedis();

    const existingToken = await redis.get(`reconnect:session:${sessionId}`);
    if (existingToken) {
        await redis.del(`reconnect:token:${existingToken}`);
        await redis.del(`reconnect:session:${sessionId}`);
        logger.debug(`Invalidated reconnection token for session ${sessionId}`);
    }
}

/**
 * Clean up orphaned reconnection tokens.
 * Reconnection tokens reference a session ID. If the session no longer
 * exists in Redis (player was cleaned up), the token is orphaned and
 * should be deleted to prevent unbounded key growth.
 *
 * Uses SCAN to avoid blocking Redis on large datasets.
 */
export async function cleanupOrphanedReconnectionTokens(): Promise<number> {
    const redis: RedisClient = getRedis();
    let cleaned = 0;

    // Scan for reconnect:session:* keys
    try {
        // Use scan if available (ioredis/node-redis v4+), else skip
        const redisAny = redis as unknown as Record<string, unknown>;
        if (typeof redisAny.scanIterator === 'function') {
            const scanFn = redisAny.scanIterator as (options: { MATCH: string; COUNT: number }) => AsyncIterable<string>;
            for await (const key of scanFn({ MATCH: 'reconnect:session:*', COUNT: 100 })) {
                const sessionId = key.replace('reconnect:session:', '');
                // Check if the player session still exists
                const playerKey = `player:${sessionId}`;
                const exists = await redis.get(playerKey);
                if (!exists) {
                    // Orphaned - clean up both token and session mapping
                    const tokenId = await redis.get(key);
                    if (tokenId) {
                        await redis.del(`reconnect:token:${tokenId}`);
                    }
                    await redis.del(key);
                    cleaned++;
                }
                // Limit batch size to avoid long-running operations
                if (cleaned >= PLAYER_CLEANUP.BATCH_SIZE) break;
            }
        }
    } catch (error) {
        // Non-critical - memory storage may not support scan
        logger.debug('Reconnection token cleanup skipped:', (error as Error).message);
    }

    if (cleaned > 0) {
        logger.info(`Cleaned up ${cleaned} orphaned reconnection token(s)`);
    }
    return cleaned;
}

/**
 * Lua script for atomic host transfer
 * SECURITY FIX: Atomically transfers host status to prevent race conditions
 * that could result in no host or multiple hosts
 * Returns: success with new host data, or failure reason
 */
const ATOMIC_HOST_TRANSFER_SCRIPT: string = fs.readFileSync(path.join(__dirname, '../scripts/hostTransfer.lua'), 'utf8');

/**
 * Atomically transfer host status from one player to another
 * SECURITY FIX: Prevents race conditions during host transfer
 */
export async function atomicHostTransfer(
    oldHostSessionId: string,
    newHostSessionId: string,
    roomCode: string
): Promise<HostTransferResult> {
    const redis: RedisClient = getRedis();

    try {
        // BUG FIX: Wrap redis.eval with timeout to prevent hanging operations
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

        const parsed = JSON.parse(result) as HostTransferResult;

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
 * Get spectator count and list for a room (US-16.1)
 * Spectators are players with role='spectator'
 */
export async function getSpectators(roomCode: string): Promise<SpectatorsResponse> {
    const players = await getPlayersInRoom(roomCode);
    const spectators = players.filter(p => p.role === 'spectator' && p.connected);
    return {
        count: spectators.length,
        spectators: spectators.map(s => ({
            sessionId: s.sessionId,
            nickname: s.nickname,
            team: s.team // team affiliation (can be null)
        }))
    };
}

/**
 * Get spectator count only (lightweight version) (US-16.1)
 */
export async function getSpectatorCount(
    roomCode: string,
    existingPlayers?: Player[]
): Promise<number> {
    const players = existingPlayers || await getPlayersInRoom(roomCode);
    return players.filter(p => p.role === 'spectator' && p.connected).length;
}

/**
 * Get room player statistics (US-16.1)
 * Returns counts by role and team for UI display
 */
export async function getRoomStats(
    roomCode: string,
    existingPlayers?: Player[]
): Promise<RoomStats> {
    const players = existingPlayers || await getPlayersInRoom(roomCode);
    const connected = players.filter(p => p.connected);

    const stats: RoomStats = {
        totalPlayers: connected.length,
        spectatorCount: 0,
        teams: {
            red: { total: 0, spymaster: null, clicker: null },
            blue: { total: 0, spymaster: null, clicker: null }
        }
    };

    for (const player of connected) {
        if (player.role === 'spectator') {
            stats.spectatorCount++;
        }

        if (player.team === 'red' || player.team === 'blue') {
            stats.teams[player.team].total++;
            if (player.role === 'spymaster') {
                stats.teams[player.team].spymaster = player.nickname;
            } else if (player.role === 'clicker') {
                stats.teams[player.team].clicker = player.nickname;
            }
        }
    }

    return stats;
}

/**
 * Reset all players' roles to 'spectator' for a new game while preserving teams.
 * This ensures spymaster/clicker roles are re-chosen each game.
 */
export async function resetRolesForNewGame(roomCode: string): Promise<Player[]> {
    const players = await getPlayersInRoom(roomCode);
    const updated: Player[] = [];

    for (const player of players) {
        if (player.role && player.role !== 'spectator') {
            const updatedPlayer = await updatePlayer(player.sessionId, { role: 'spectator' as Role });
            updated.push(updatedPlayer);
        } else {
            updated.push(player);
        }
    }

    return updated;
}

// CommonJS exports for compatibility
module.exports = {
    createPlayer,
    getPlayer,
    updatePlayer,
    setTeam,
    setRole,
    setNickname,
    getTeamMembers,
    getPlayersInRoom,
    removePlayer,
    handleDisconnect,
    setSocketMapping,
    getSocketId,
    // ISSUE #57 FIX: Export cleanup functions
    processScheduledCleanups,
    startCleanupTask,
    stopCleanupTask,
    // ISSUE #17 FIX: Reconnection token functions
    // validateReconnectToken - simple tokens for automatic socket auth reconnection
    validateReconnectToken,
    // Complex token functions for explicit room:reconnect flow
    generateReconnectionToken,
    validateReconnectionToken,
    getExistingReconnectionToken,
    invalidateReconnectionToken,
    cleanupOrphanedReconnectionTokens,
    // US-16.1: Spectator mode enhancements
    getSpectators,
    getSpectatorCount,
    getRoomStats,
    // SECURITY FIX: Atomic host transfer
    atomicHostTransfer,
    // Reset roles for new game
    resetRolesForNewGame
};
