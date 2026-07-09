/**
 * N1 regression: adopting an EXISTING player's session at the socket handshake
 * requires the per-session auth secret. A peer who has harvested a sessionId
 * (same NAT egress IP, or ALLOW_IP_MISMATCH deployments) must not be able to
 * resolve that session's player context without the secret.
 */
import type { Player } from '../../types';

jest.mock('../../services/playerService', () => ({
    getPlayer: jest.fn(),
}));
jest.mock('../../services/player/sessionAuth', () => ({
    validateSessionAuthSecret: jest.fn(),
}));
jest.mock('../../config/redis', () => ({
    getRedis: jest.fn().mockReturnValue({
        eval: jest.fn().mockResolvedValue(1), // rate-limit counter
        get: jest.fn().mockResolvedValue(null),
    }),
}));

import * as playerService from '../../services/playerService';
import { validateSessionAuthSecret } from '../../services/player/sessionAuth';
import { resolveSessionId } from '../../middleware/auth/sessionValidator';

const VICTIM_SESSION = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeffff0001';
const SHARED_IP = '203.0.113.9';

function victim(overrides: Partial<Player> = {}): Player {
    return {
        sessionId: VICTIM_SESSION,
        roomCode: 'ROOM01',
        nickname: 'Victim',
        team: 'red',
        role: 'spymaster',
        isHost: false,
        connected: true,
        lastSeen: Date.now(),
        createdAt: Date.now(),
        lastIP: SHARED_IP,
        ...overrides,
    };
}

const mockGetPlayer = playerService.getPlayer as jest.Mock;
const mockSecret = validateSessionAuthSecret as jest.Mock;

describe('resolveSessionId session adoption (N1)', () => {
    it('rejects adopting a CONNECTED session from the same IP without the secret', async () => {
        mockGetPlayer.mockResolvedValue(victim({ connected: true }));
        mockSecret.mockResolvedValue('invalid'); // secret exists, token absent/wrong

        const result = await resolveSessionId({ sessionId: VICTIM_SESSION }, SHARED_IP);

        expect(result.validatedSessionId).toBeNull();
    });

    it('rejects adopting a DISCONNECTED session from the same IP without the secret', async () => {
        mockGetPlayer.mockResolvedValue(victim({ connected: false }));
        mockSecret.mockResolvedValue('invalid');

        const result = await resolveSessionId({ sessionId: VICTIM_SESSION }, SHARED_IP);

        expect(result.validatedSessionId).toBeNull();
    });

    it('adopts the session when the correct secret accompanies it (page refresh)', async () => {
        mockGetPlayer.mockResolvedValue(victim({ connected: true }));
        mockSecret.mockResolvedValue('valid');

        const token = 'a'.repeat(64);
        const result = await resolveSessionId({ sessionId: VICTIM_SESSION, sessionToken: token }, SHARED_IP);

        expect(mockSecret).toHaveBeenCalledWith(VICTIM_SESSION, token);
        expect(result.validatedSessionId).toBe(VICTIM_SESSION);
    });

    it('adopts a disconnected session with the correct secret (reconnect after blip)', async () => {
        mockGetPlayer.mockResolvedValue(victim({ connected: false }));
        mockSecret.mockResolvedValue('valid');

        const result = await resolveSessionId({ sessionId: VICTIM_SESSION, sessionToken: 'a'.repeat(64) }, SHARED_IP);

        expect(result.validatedSessionId).toBe(VICTIM_SESSION);
    });

    it("grandfathers a legacy session with no stored secret ('missing') through the pre-secret checks", async () => {
        mockGetPlayer.mockResolvedValue(victim({ connected: true }));
        mockSecret.mockResolvedValue('missing');

        const result = await resolveSessionId({ sessionId: VICTIM_SESSION }, SHARED_IP);

        expect(result.validatedSessionId).toBe(VICTIM_SESSION);
    });

    it('still rejects a connected session from a DIFFERENT IP even with a valid secret path untested', async () => {
        mockGetPlayer.mockResolvedValue(victim({ connected: true }));
        mockSecret.mockResolvedValue('valid');

        const result = await resolveSessionId(
            { sessionId: VICTIM_SESSION, sessionToken: 'a'.repeat(64) },
            '198.51.100.77'
        );

        expect(result.validatedSessionId).toBeNull();
    });

    it('lets a brand-new sessionId through untouched (no player yet, nothing to adopt)', async () => {
        mockGetPlayer.mockResolvedValue(null);

        const result = await resolveSessionId({ sessionId: VICTIM_SESSION }, SHARED_IP);

        expect(result.validatedSessionId).toBe(VICTIM_SESSION);
        expect(mockSecret).not.toHaveBeenCalled();
    });
});
