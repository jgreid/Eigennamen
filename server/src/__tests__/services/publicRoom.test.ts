/**
 * toPublicRoom (R1): the peer-facing room projection must never carry the
 * host's bearer sessionId — peers identify the host by the same opaque
 * playerId the roster uses.
 */
import { toPublicRoom } from '../../services/room/publicRoom';
import { derivePlayerId } from '../../services/player/publicId';
import type { Room } from '../../types/room';

describe('toPublicRoom (R1)', () => {
    const room: Room = {
        id: 'uuid-1',
        code: 'abc123',
        roomId: 'ABC123',
        hostSessionId: 'host-session-secret',
        status: 'waiting',
        settings: { teamNames: { red: 'Red', blue: 'Blue' }, turnTimer: 0, allowSpectators: true, gameMode: 'match' },
        createdAt: 1,
        expiresAt: 2,
    };

    test('replaces hostSessionId with the derived hostPlayerId', () => {
        const pub = toPublicRoom(room);
        expect(pub.hostPlayerId).toBe(derivePlayerId('host-session-secret'));
        expect(pub).not.toHaveProperty('hostSessionId');
        expect(JSON.stringify(pub)).not.toContain('host-session-secret');
    });

    test('keeps every other room field intact', () => {
        const { hostSessionId: _h, ...rest } = room;
        expect(toPublicRoom(room)).toEqual({ ...rest, hostPlayerId: expect.any(String) });
    });

    test('does not mutate its input', () => {
        toPublicRoom(room);
        expect(room.hostSessionId).toBe('host-session-secret');
    });
});
