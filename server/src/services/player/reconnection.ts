import type { RedisClient, Team, Role } from '../../types';

import crypto from 'crypto';
import { getRedis } from '../../config/redis';
import logger from '../../utils/logger';
import { withTimeout, TIMEOUTS } from '../../utils/timeout';
import { SESSION_SECURITY, PLAYER_CLEANUP } from '../../config/constants';
import { tryParseJSON } from '../../utils/parseJSON';
import {
    INVALIDATE_TOKEN_SCRIPT,
    CLEANUP_ORPHANED_TOKEN_SCRIPT,
    ATOMIC_VALIDATE_RECONNECT_TOKEN_SCRIPT,
    ATOMIC_GENERATE_RECONNECT_TOKEN_SCRIPT,
} from '../../scripts';
import { z } from 'zod';
import { getPlayer } from '../playerService';

/**
 * Token data stored for reconnection.
 *
 * NOTE: `team` and `role` are captured at disconnect time for audit/logging
 * purposes only.  On reconnection the authoritative player state is always
 * loaded fresh from Redis (see roomHandlers.ts ROOM_RECONNECT), so these
 * fields are never used to restore a player's role or team assignment.
 */
export interface ReconnectionTokenData {
    sessionId: string;
    roomCode: string;
    nickname: string;
    /** Snapshot at disconnect — informational only, not used for restoration */
    team: Team | null;
    /** Snapshot at disconnect — informational only, not used for restoration */
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

const reconnectionTokenSchema = z.object({
    sessionId: z.string(),
    roomCode: z.string(),
    nickname: z.string().optional(),
    team: z.string().nullable().optional(),
    role: z.string().optional(),
});

/**
 * Generate a secure reconnection token for a disconnecting player
 * Secure reconnection via short-lived tokens
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
        createdAt: Date.now(),
    };

    // Atomic Lua script: either return the existing token or set both mappings
    // in a single operation, eliminating the TOCTOU race where a token could
    // expire between the NX check and the subsequent GET.
    const sessionKey = `reconnect:session:${sessionId}`;
    const tokenKey = `reconnect:token:${token}`;

    const result = await withTimeout(
        redis.eval(ATOMIC_GENERATE_RECONNECT_TOKEN_SCRIPT, {
            keys: [sessionKey, tokenKey],
            arguments: [token, JSON.stringify(tokenData), String(ttl)],
        }),
        TIMEOUTS.REDIS_OPERATION,
        `reconnection-token-${sessionId}`
    );

    const returnedToken = result as string;
    if (returnedToken !== token) {
        logger.info(`Returning existing reconnection token for session ${sessionId} (race resolved)`);
    } else {
        logger.debug(`Generated reconnection token for session ${sessionId}, TTL: ${ttl}s`);
    }

    return returnedToken;
}

/**
 * Validate and consume a reconnection token atomically.
 * Uses a Lua script to GET + validate + DEL in one operation,
 * preventing two concurrent reconnections from both succeeding.
 */
export async function validateRoomReconnectToken(token: string, sessionId: string): Promise<TokenValidationResult> {
    const redis: RedisClient = getRedis();

    if (!token || typeof token !== 'string') {
        return { valid: false, reason: 'INVALID_TOKEN_FORMAT' };
    }

    const tokenKey = `reconnect:token:${token}`;
    const sessionKey = `reconnect:session:${sessionId}`;

    // Atomic: GET token data, validate sessionId, DEL both keys
    const result = await withTimeout(
        redis.eval(ATOMIC_VALIDATE_RECONNECT_TOKEN_SCRIPT, {
            keys: [tokenKey, sessionKey],
            arguments: [sessionId],
        }),
        TIMEOUTS.REDIS_OPERATION,
        `validateReconnectToken-lua-${sessionId}`
    );

    const resultStr = result as string | null;

    if (!resultStr || resultStr === 'NOT_FOUND') {
        logger.warn('Reconnection token not found or expired', { sessionId });
        return { valid: false, reason: 'TOKEN_EXPIRED_OR_INVALID' };
    }

    if (resultStr === 'SESSION_MISMATCH') {
        logger.warn('Reconnection token session mismatch', { sessionId });
        return { valid: false, reason: 'SESSION_MISMATCH' };
    }

    const tokenData = tryParseJSON(
        resultStr,
        reconnectionTokenSchema,
        `reconnection token for ${sessionId}`
    ) as ReconnectionTokenData | null;
    if (!tokenData) {
        return { valid: false, reason: 'TOKEN_CORRUPTED' };
    }

    logger.info(`Reconnection token validated and consumed for session ${sessionId}`);

    return { valid: true, tokenData };
}

/**
 * Get existing reconnection token for a session (if any)
 * Used to avoid generating multiple tokens for the same session
 */
export async function getExistingReconnectionToken(sessionId: string): Promise<string | null> {
    const redis: RedisClient = getRedis();
    return withTimeout(
        redis.get(`reconnect:session:${sessionId}`),
        TIMEOUTS.REDIS_OPERATION,
        `getExistingReconnectionToken-${sessionId}`
    );
}

/**
 * Invalidate any existing reconnection token for a session
 * Called when player successfully reconnects or explicitly leaves.
 * Uses a Lua script for atomicity — prevents orphaned tokens from
 * concurrent invalidation + reconnection races.
 */
export async function invalidateRoomReconnectToken(sessionId: string): Promise<void> {
    const redis: RedisClient = getRedis();

    const result = await withTimeout(
        redis.eval(INVALIDATE_TOKEN_SCRIPT, {
            keys: [`reconnect:session:${sessionId}`],
            arguments: [],
        }),
        TIMEOUTS.REDIS_OPERATION,
        `invalidateReconnectToken-lua-${sessionId}`
    );

    if (result === 1) {
        logger.debug(`Invalidated reconnection token for session ${sessionId}`);
    }
}

/**
 * Clean up orphaned reconnection tokens.
 * Reconnection tokens reference a session ID. If the session no longer
 * exists in Redis (player was cleaned up), the token is orphaned and
 * should be deleted to prevent unbounded key growth.
 *
 * Uses SCAN to iterate and a Lua script for atomic per-token cleanup
 * (prevents race conditions with concurrent reconnection attempts).
 */
export async function cleanupOrphanedReconnectionTokens(): Promise<number> {
    const redis: RedisClient = getRedis();
    let cleaned = 0;

    // Scan for reconnect:session:* keys and process in parallel batches
    // instead of sequentially, leveraging node-redis automatic pipelining.
    try {
        if (redis.scanIterator) {
            const batch: { key: string; sessionId: string }[] = [];
            const BATCH_PROCESS_SIZE = 20;
            let scanned = 0;

            for await (const key of redis.scanIterator({ MATCH: 'reconnect:session:*', COUNT: 100 })) {
                const sessionId = key.replace('reconnect:session:', '');
                batch.push({ key, sessionId });
                scanned++;

                // Limit total scanned to avoid long-running operations
                if (scanned >= PLAYER_CLEANUP.BATCH_SIZE) {
                    cleaned += await processBatchCleanup(redis, batch);
                    batch.length = 0;
                    break;
                }

                // Process in parallel batches
                if (batch.length >= BATCH_PROCESS_SIZE) {
                    cleaned += await processBatchCleanup(redis, batch);
                    batch.length = 0;
                }
            }

            // Process remaining items
            if (batch.length > 0) {
                cleaned += await processBatchCleanup(redis, batch);
            }
        }
    } catch (error) {
        // Non-critical - scan may not be available
        logger.warn('Reconnection token cleanup skipped:', (error as Error).message);
    }

    if (cleaned > 0) {
        logger.info(`Cleaned up ${cleaned} orphaned reconnection token(s)`);
    }
    return cleaned;
}

/**
 * Process a batch of orphaned token cleanups in parallel.
 * Each cleanup uses an atomic Lua script, but we fire them concurrently
 * so node-redis can pipeline the requests in a single round-trip.
 */
async function processBatchCleanup(redis: RedisClient, batch: { key: string; sessionId: string }[]): Promise<number> {
    const results = await Promise.all(
        batch.map(({ key, sessionId }) =>
            withTimeout(
                redis.eval(CLEANUP_ORPHANED_TOKEN_SCRIPT, {
                    keys: [key, `player:${sessionId}`],
                    arguments: [],
                }),
                TIMEOUTS.REDIS_OPERATION,
                `cleanupOrphanedToken-lua-${sessionId}`
            ).catch((err) => {
                logger.warn(`Failed to cleanup orphaned token for ${sessionId}:`, (err as Error).message);
                return 0;
            })
        )
    );
    return results.filter((r) => r === 1).length;
}

/**
 * Validate reconnection token for socket auth
 * Uses the same token storage as generateReconnectionToken() for consistency
 * Require valid token for reconnection to prevent session hijacking
 */
export async function validateSocketAuthToken(sessionId: string, token?: string): Promise<boolean> {
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
    const storedToken = await withTimeout(
        redis.get(`reconnect:session:${sessionId}`),
        TIMEOUTS.REDIS_OPERATION,
        `validateSocketAuthToken-get-${sessionId}`
    );

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
    const isValid = crypto.timingSafeEqual(Buffer.from(storedToken, 'utf8'), Buffer.from(token, 'utf8'));

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
