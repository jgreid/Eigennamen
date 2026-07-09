/**
 * Unit tests for two pure projection/selection helpers added in the third-pass
 * review (docs/CODEBASE_REVIEW_PLAN.md):
 *   - selectHostSuccessor (N3): never hand host to a bot; prefer connected humans.
 *   - toPublicPlayer (N2): strip server-internal PII (lastIP/userId) from
 *     peer-facing player payloads.
 * Both are imported directly from their sub-modules to avoid the heavy service
 * barrels.
 */
import { selectHostSuccessor } from '../../services/room/membership';
import { toPublicPlayer, toPublicPlayers, toSelfPlayer } from '../../services/player/queries';
import { derivePlayerId } from '../../services/player/publicId';
import type { Player } from '../../types';

function mkPlayer(over: Partial<Player>): Player {
    return {
        sessionId: over.sessionId ?? 'sess-x',
        roomCode: 'ROOM',
        nickname: over.nickname ?? 'p',
        team: over.team ?? null,
        role: over.role ?? 'clicker',
        isHost: over.isHost ?? false,
        connected: over.connected ?? true,
        lastSeen: over.lastSeen ?? 0,
        ...over,
    } as Player;
}

describe('selectHostSuccessor (N3)', () => {
    it('returns null for an empty pool', () => {
        expect(selectHostSuccessor([])).toBeNull();
    });

    it('prefers a connected human over a bot even when the bot appears first', () => {
        const bot = mkPlayer({ sessionId: 'bot-1', isBot: true, connected: true });
        const human = mkPlayer({ sessionId: 'human-1', isBot: false, connected: true });
        // Bot first (e.g. it joined earlier) — the human must still win.
        expect(selectHostSuccessor([bot, human])?.sessionId).toBe('human-1');
    });

    it('never hands host to a bot: only-bots pool falls back to a connected bot, not null-selects a human', () => {
        // With only bots present the room is normally torn down; a connected bot is
        // the last-resort so an in-progress transfer still names someone, but a human
        // is always preferred when one exists.
        const bot = mkPlayer({ sessionId: 'bot-1', isBot: true, connected: true });
        expect(selectHostSuccessor([bot])?.sessionId).toBe('bot-1');
    });

    it('prefers a connected human over a disconnected human', () => {
        const discon = mkPlayer({ sessionId: 'h-discon', isBot: false, connected: false });
        const conn = mkPlayer({ sessionId: 'h-conn', isBot: false, connected: true });
        expect(selectHostSuccessor([discon, conn])?.sessionId).toBe('h-conn');
    });

    it('falls back to a disconnected human before any bot', () => {
        const bot = mkPlayer({ sessionId: 'bot-1', isBot: true, connected: true });
        const discon = mkPlayer({ sessionId: 'h-discon', isBot: false, connected: false });
        expect(selectHostSuccessor([bot, discon])?.sessionId).toBe('h-discon');
    });
});

describe('toPublicPlayer (N1/N2)', () => {
    it('strips sessionId, lastIP and userId, adds the derived playerId, and keeps client-facing fields', () => {
        const p = mkPlayer({
            sessionId: 'sess-1',
            nickname: 'Ada',
            team: 'red',
            role: 'spymaster',
            isHost: true,
            lastIP: '203.0.113.7',
            userId: 'user-42',
        });
        const pub = toPublicPlayer(p);
        expect((pub as Record<string, unknown>).lastIP).toBeUndefined();
        expect((pub as Record<string, unknown>).userId).toBeUndefined();
        expect((pub as Record<string, unknown>).sessionId).toBeUndefined();
        expect(pub.playerId).toBe(derivePlayerId('sess-1'));
        expect(pub.nickname).toBe('Ada');
        expect(pub.team).toBe('red');
        expect(pub.role).toBe('spymaster');
        expect(pub.isHost).toBe(true);
    });

    it('maps a list, stripping the session credential and PII from every entry', () => {
        const players = [
            mkPlayer({ sessionId: 'a', lastIP: '1.1.1.1', userId: 'ua' }),
            mkPlayer({ sessionId: 'b', lastIP: '2.2.2.2' }),
        ];
        const pub = toPublicPlayers(players);
        expect(pub).toHaveLength(2);
        expect(pub.map((e) => e.playerId)).toEqual([derivePlayerId('a'), derivePlayerId('b')]);
        for (const entry of pub) {
            expect((entry as Record<string, unknown>).lastIP).toBeUndefined();
            expect((entry as Record<string, unknown>).userId).toBeUndefined();
            expect((entry as Record<string, unknown>).sessionId).toBeUndefined();
        }
    });

    it('toSelfPlayer additionally carries the player own sessionId for direct-to-self payloads', () => {
        const p = mkPlayer({ sessionId: 'sess-self', lastIP: '9.9.9.9', userId: 'u-9' });
        const self = toSelfPlayer(p);
        expect(self.sessionId).toBe('sess-self');
        expect(self.playerId).toBe(derivePlayerId('sess-self'));
        expect((self as Record<string, unknown>).lastIP).toBeUndefined();
        expect((self as Record<string, unknown>).userId).toBeUndefined();
    });
});
