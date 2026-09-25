import type { Room } from '../../types/room';
import { derivePlayerId } from '../player/publicId';

/**
 * Peer-facing projection of a {@link Room}.
 *
 * The stored room record carries `hostSessionId`, and a sessionId is a bearer
 * credential (N1): the socket handshake adopts whatever session id a client
 * presents, and `GET /api/replays` authorizes on an `X-Session-Id` header
 * alone. Emitting the raw record on room:joined / room:resynced /
 * room:reconnected therefore handed every peer the host's credential. Peers
 * only ever need to know WHO the host is, so they get the same opaque
 * `playerId` the roster uses (R1).
 */
export type PublicRoom = Omit<Room, 'hostSessionId'> & { hostPlayerId: string };

export function toPublicRoom(room: Room): PublicRoom {
    const { hostSessionId, ...pub } = room;
    return { ...pub, hostPlayerId: derivePlayerId(hostSessionId) };
}
