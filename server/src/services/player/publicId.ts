import { createHash } from 'crypto';

/**
 * Length of a public player id in hex characters (64 bits of a SHA-256).
 * Long enough that collisions within a room are not a practical concern,
 * short enough to stay a compact DOM/data key on the client.
 */
export const PUBLIC_PLAYER_ID_LENGTH = 16;

/** Matches a well-formed public player id (lowercase hex, fixed length). */
export const PUBLIC_PLAYER_ID_REGEX = new RegExp(`^[0-9a-f]{${PUBLIC_PLAYER_ID_LENGTH}}$`);

/**
 * Derive the opaque, client-facing player id for a session.
 *
 * A `sessionId` is a bearer credential (the socket handshake adopts whatever
 * session id the client presents), so it must never be broadcast to room
 * peers (N1). Peers instead see this one-way SHA-256 derivation: stable for
 * the lifetime of the session, deterministic across events and processes
 * (nothing extra stored in Redis, no Lua changes), and not invertible back
 * to the ~122-bit-random UUID it was derived from. The server resolves a
 * client-supplied playerId back to a session by deriving ids for the room's
 * roster and matching — see findPlayerByPublicId.
 */
export function derivePlayerId(sessionId: string): string {
    return createHash('sha256').update(sessionId).digest('hex').slice(0, PUBLIC_PLAYER_ID_LENGTH);
}
