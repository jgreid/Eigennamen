import type { RedisClient } from '../../types';

import crypto from 'crypto';
import { getRedis } from '../../config/redis';
import logger from '../../utils/logger';
import { withTimeout, TIMEOUTS } from '../../utils/timeout';
import { REDIS_TTL } from '../../config/constants';

/**
 * Per-session auth secret gating socket adoption of an existing session (N1).
 *
 * A client-supplied `sessionId` used to be the only credential the socket
 * handshake needed to adopt a session, and peers could obtain it from room
 * broadcasts. The secret below is minted server-side when a session first
 * binds to a room, delivered ONLY to that client (ROOM_CREATED / ROOM_JOINED /
 * ROOM_RECONNECTED payloads), and must accompany the sessionId in the
 * handshake before an existing player's session can be adopted. Peers never
 * see it, so knowing a sessionId (or sharing a NAT egress IP) is no longer
 * enough to hijack a seat.
 *
 * Distinct from the single-use room:reconnect token: that one is consumed per
 * reconnection and scoped to the disconnect window, while this secret is a
 * stable bearer credential for the session's lifetime.
 */

const SECRET_BYTES = 32;
const SECRET_HEX_LENGTH = SECRET_BYTES * 2;

/** Result of checking a handshake-supplied session token. */
export type SessionAuthResult = 'valid' | 'invalid' | 'missing';

function secretKey(sessionId: string): string {
    return `session:auth:${sessionId}`;
}

/**
 * Mint (or fetch the existing) auth secret for a session and refresh its TTL.
 * Idempotent per session: concurrent mints converge on one value via SET NX.
 * TTL tracks the player record's TTL so the secret outlives every state the
 * session can legitimately return to.
 */
export async function mintSessionAuthSecret(sessionId: string): Promise<string> {
    const redis: RedisClient = getRedis();
    const key = secretKey(sessionId);

    const existing = await withTimeout(
        redis.get(key),
        TIMEOUTS.REDIS_OPERATION,
        `mintSessionAuthSecret-get-${sessionId}`
    );
    if (existing) {
        await withTimeout(
            redis.expire(key, REDIS_TTL.PLAYER),
            TIMEOUTS.REDIS_OPERATION,
            `mintSessionAuthSecret-expire-${sessionId}`
        );
        return existing;
    }

    const fresh = crypto.randomBytes(SECRET_BYTES).toString('hex');
    const setResult = await withTimeout(
        redis.set(key, fresh, { NX: true, EX: REDIS_TTL.PLAYER }),
        TIMEOUTS.REDIS_OPERATION,
        `mintSessionAuthSecret-set-${sessionId}`
    );
    if (setResult === 'OK') {
        return fresh;
    }

    // Lost a mint race — read the winner's value.
    const winner = await withTimeout(
        redis.get(key),
        TIMEOUTS.REDIS_OPERATION,
        `mintSessionAuthSecret-reget-${sessionId}`
    );
    if (winner) {
        return winner;
    }
    throw new Error(`Failed to mint session auth secret for ${sessionId}`);
}

/**
 * Check a handshake-supplied session token against the stored secret.
 *
 * 'missing' means no secret exists for this session — a record created before
 * secrets were introduced. Callers treat that as a legacy allowance (the
 * pre-secret IP checks still apply); every new session minted since always
 * has one, so the grace window is bounded by the player-record TTL.
 */
export async function validateSessionAuthSecret(
    sessionId: string,
    providedToken: string | undefined
): Promise<SessionAuthResult> {
    const redis: RedisClient = getRedis();
    const stored = await withTimeout(
        redis.get(secretKey(sessionId)),
        TIMEOUTS.REDIS_OPERATION,
        `validateSessionAuthSecret-${sessionId}`
    );

    if (!stored) {
        return 'missing';
    }

    if (
        typeof providedToken !== 'string' ||
        providedToken.length !== SECRET_HEX_LENGTH ||
        stored.length !== providedToken.length
    ) {
        logger.warn('Session auth token missing or malformed for guarded session', {
            sessionId,
            hasToken: !!providedToken,
        });
        return 'invalid';
    }

    const valid = crypto.timingSafeEqual(Buffer.from(stored, 'utf8'), Buffer.from(providedToken, 'utf8'));
    if (!valid) {
        logger.warn('Session auth token mismatch', { sessionId });
    }
    return valid ? 'valid' : 'invalid';
}
