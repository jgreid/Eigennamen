/**
 * N1 regression: peer-facing player projections must never carry a sessionId.
 *
 * The client-supplied sessionId is the socket handshake's bearer credential,
 * so broadcasting it let any room peer adopt any other player's session.
 * Peers identify players only by the opaque derived playerId.
 */
import type { Player } from '../../types';

import { createHash } from 'crypto';
import { derivePlayerId, PUBLIC_PLAYER_ID_LENGTH, PUBLIC_PLAYER_ID_REGEX } from '../../services/player/publicId';
import { toPublicPlayer, toPublicPlayers, toSelfPlayer, findPlayerByPublicId } from '../../services/player/queries';

jest.mock('../../config/redis', () => ({
    getRedis: jest.fn(),
}));

import { getRedis } from '../../config/redis';

function makePlayer(overrides: Partial<Player> = {}): Player {
    return {
        sessionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeffff0001',
        roomCode: 'ROOM01',
        nickname: 'Alice',
        team: 'red',
        role: 'clicker',
        isHost: false,
        connected: true,
        lastSeen: 1,
        lastIP: '203.0.113.9',
        userId: 'user-1',
        ...overrides,
    };
}

describe('derivePlayerId', () => {
    it('is deterministic and matches the documented derivation (sha256 prefix)', () => {
        const sid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeffff0001';
        const expected = createHash('sha256').update(sid).digest('hex').slice(0, PUBLIC_PLAYER_ID_LENGTH);
        expect(derivePlayerId(sid)).toBe(expected);
        expect(derivePlayerId(sid)).toBe(derivePlayerId(sid));
    });

    it('produces well-formed ids that never echo the sessionId', () => {
        const sid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeffff0001';
        const id = derivePlayerId(sid);
        expect(id).toMatch(PUBLIC_PLAYER_ID_REGEX);
        expect(id).toHaveLength(PUBLIC_PLAYER_ID_LENGTH);
        expect(sid).not.toContain(id);
    });

    it('differs across sessions', () => {
        expect(derivePlayerId('session-a')).not.toBe(derivePlayerId('session-b'));
    });
});

describe('toPublicPlayer (peer projection)', () => {
    it('strips sessionId, lastIP, and userId and adds the derived playerId', () => {
        const player = makePlayer();
        const pub = toPublicPlayer(player);

        expect(pub).not.toHaveProperty('sessionId');
        expect(pub).not.toHaveProperty('lastIP');
        expect(pub).not.toHaveProperty('userId');
        expect(pub.playerId).toBe(derivePlayerId(player.sessionId));
        expect(pub.nickname).toBe('Alice');
        expect(pub.team).toBe('red');
    });

    it('toPublicPlayers maps every roster entry', () => {
        const players = [makePlayer(), makePlayer({ sessionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeffff0002' })];
        const pubs = toPublicPlayers(players);
        expect(pubs).toHaveLength(2);
        for (const pub of pubs) {
            expect(pub).not.toHaveProperty('sessionId');
            expect(pub.playerId).toMatch(PUBLIC_PLAYER_ID_REGEX);
        }
        expect(pubs[0]!.playerId).not.toBe(pubs[1]!.playerId);
    });
});

describe('toSelfPlayer (direct-to-self projection)', () => {
    it('keeps the recipient own sessionId alongside the playerId, still without PII', () => {
        const player = makePlayer();
        const self = toSelfPlayer(player);

        expect(self.sessionId).toBe(player.sessionId);
        expect(self.playerId).toBe(derivePlayerId(player.sessionId));
        expect(self).not.toHaveProperty('lastIP');
        expect(self).not.toHaveProperty('userId');
    });
});

describe('findPlayerByPublicId', () => {
    function mockRoom(players: Player[]): void {
        const bySession = new Map(players.map((p) => [`player:${p.sessionId}`, JSON.stringify(p)]));
        (getRedis as jest.Mock).mockReturnValue({
            sMembers: jest.fn().mockResolvedValue(players.map((p) => p.sessionId)),
            mGet: jest
                .fn()
                .mockImplementation((keys: string[]) => Promise.resolve(keys.map((k) => bySession.get(k) ?? null))),
            sRem: jest.fn().mockResolvedValue(0),
            sCard: jest.fn().mockResolvedValue(players.length),
            del: jest.fn().mockResolvedValue(0),
            eval: jest.fn().mockResolvedValue(0),
        });
    }

    it('resolves a playerId back to the room member it was derived from', async () => {
        const a = makePlayer();
        const b = makePlayer({ sessionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeffff0002', nickname: 'Bob' });
        mockRoom([a, b]);

        const found = await findPlayerByPublicId('ROOM01', derivePlayerId(b.sessionId));
        expect(found?.sessionId).toBe(b.sessionId);
        expect(found?.nickname).toBe('Bob');
    });

    it('returns null for a playerId matching nobody in the room', async () => {
        mockRoom([makePlayer()]);
        const found = await findPlayerByPublicId('ROOM01', 'deadbeefdeadbeef');
        expect(found).toBeNull();
    });
});
