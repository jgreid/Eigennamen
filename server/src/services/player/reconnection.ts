/**
 * Player Reconnection Service - Token management for secure reconnection
 */

import type { RedisClient, Team, Role } from '../../types';

import crypto from 'crypto';
import { getRedis } from '../../config/redis';
import logger from '../../utils/logger';
import { withTimeout, TIMEOUTS } from '../../utils/timeout';
import { SESSION_SECURITY, PLAYER_CLEANUP } from '../../config/constants';
import { tryParseJSON } from '../../utils/parseJSON';
import { INVALIDATE_TOKEN_SCRIPT, CLEANUP_ORPHANED_TOKEN_SCRIPT } from '../../scripts';
import { z } from 'zod';
import { getPlayer } from '../playerService';

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

    const result = await withTimeout(
        redis.eval(luaScript, {
            keys: [sessionKey, tokenKey],
            arguments: [token, JSON.stringify(tokenData), String(ttl)]
        }),
        TIMEOUTS.REDIS_OPERATION,
        `reconnection-token-${sessionId}`
    );

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
 * Secure reconnection via short-lived tokens
 */
export async function validateRoomReconnectToken(
    token: string,
    sessionId: string
): Promise<TokenValidationResult> {
    const redis: RedisClient = getRedis();

    if (!token || typeof token !== 'string') {
        return { valid: false, reason: 'INVALID_TOKEN_FORMAT' };
    }

    // Look up the token
    const tokenDataStr = await withTimeout(
        redis.get(`reconnect:token:${token}`),
        TIMEOUTS.REDIS_OPERATION,
        `validateReconnectToken-get-${sessionId}`
    );

    if (!tokenDataStr) {
        logger.warn('Reconnection token not found or expired', { sessionId });
        return { valid: false, reason: 'TOKEN_EXPIRED_OR_INVALID' };
    }

    const tokenData = tryParseJSON(tokenDataStr, reconnectionTokenSchema, `reconnection token for ${sessionId}`) as ReconnectionTokenData | null;
    if (!tokenData) {
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

    // Token is valid - consume it (one-time use).
    // A fresh token is generated by the handler after successful reconnection
    // when SESSION_SECURITY.ROTATE_SESSION_ON_RECONNECT is true.
    await redis.del(`reconnect:token:${token}`);
    await redis.del(`reconnect:session:${sessionId}`);

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
            arguments: []
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

    // Scan for reconnect:session:* keys
    try {
        // Use scanIterator if available (node-redis v4+)
        if (redis.scanIterator) {
            for await (const key of redis.scanIterator({ MATCH: 'reconnect:session:*', COUNT: 100 })) {
                const sessionId = key.replace('reconnect:session:', '');
                const playerKey = `player:${sessionId}`;

                // Atomic check-and-delete: only cleans up if player doesn't exist
                const result = await withTimeout(
                    redis.eval(CLEANUP_ORPHANED_TOKEN_SCRIPT, {
                        keys: [key, playerKey],
                        arguments: []
                    }),
                    TIMEOUTS.REDIS_OPERATION,
                    `cleanupOrphanedToken-lua-${sessionId}`
                );

                if (result === 1) {
                    cleaned++;
                }
                // Limit batch size to avoid long-running operations
                if (cleaned >= PLAYER_CLEANUP.BATCH_SIZE) break;
            }
        }
    } catch (error) {
        // Non-critical - scan may not be available
        logger.debug('Reconnection token cleanup skipped:', (error as Error).message);
    }

    if (cleaned > 0) {
        logger.info(`Cleaned up ${cleaned} orphaned reconnection token(s)`);
    }
    return cleaned;
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
