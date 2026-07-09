/**
 * N1 regression: the per-session auth secret that gates socket adoption.
 */
jest.mock('../../config/redis', () => ({
    getRedis: jest.fn(),
}));

import { getRedis } from '../../config/redis';
import { mintSessionAuthSecret, validateSessionAuthSecret } from '../../services/player/sessionAuth';

interface MockRedis {
    get: jest.Mock;
    set: jest.Mock;
    expire: jest.Mock;
}

function mockRedis(): MockRedis {
    const redis: MockRedis = {
        get: jest.fn().mockResolvedValue(null),
        set: jest.fn().mockResolvedValue('OK'),
        expire: jest.fn().mockResolvedValue(1),
    };
    (getRedis as jest.Mock).mockReturnValue(redis);
    return redis;
}

const SESSION = 'aaaaaaaa-bbbb-cccc-dddd-eeeeffff0001';

describe('mintSessionAuthSecret', () => {
    it('mints a 64-hex secret under session:auth:<sessionId> with NX + TTL', async () => {
        const redis = mockRedis();

        const secret = await mintSessionAuthSecret(SESSION);

        expect(secret).toMatch(/^[0-9a-f]{64}$/);
        expect(redis.set).toHaveBeenCalledWith(
            `session:auth:${SESSION}`,
            secret,
            expect.objectContaining({ NX: true, EX: expect.any(Number) })
        );
    });

    it('returns the existing secret (and refreshes its TTL) instead of rotating it', async () => {
        const redis = mockRedis();
        redis.get.mockResolvedValue('e'.repeat(64));

        const secret = await mintSessionAuthSecret(SESSION);

        expect(secret).toBe('e'.repeat(64));
        expect(redis.set).not.toHaveBeenCalled();
        expect(redis.expire).toHaveBeenCalledWith(`session:auth:${SESSION}`, expect.any(Number));
    });

    it('converges on the winner when it loses a concurrent mint race', async () => {
        const redis = mockRedis();
        redis.get.mockResolvedValueOnce(null).mockResolvedValueOnce('f'.repeat(64));
        redis.set.mockResolvedValue(null); // NX lost

        const secret = await mintSessionAuthSecret(SESSION);
        expect(secret).toBe('f'.repeat(64));
    });
});

describe('validateSessionAuthSecret', () => {
    it("returns 'missing' when no secret exists (legacy pre-secret session)", async () => {
        mockRedis();
        await expect(validateSessionAuthSecret(SESSION, 'a'.repeat(64))).resolves.toBe('missing');
    });

    it("returns 'valid' for the exact stored secret", async () => {
        const redis = mockRedis();
        redis.get.mockResolvedValue('a'.repeat(64));
        await expect(validateSessionAuthSecret(SESSION, 'a'.repeat(64))).resolves.toBe('valid');
    });

    it("returns 'invalid' for a wrong, absent, or malformed token when a secret exists", async () => {
        const redis = mockRedis();
        redis.get.mockResolvedValue('a'.repeat(64));

        await expect(validateSessionAuthSecret(SESSION, 'b'.repeat(64))).resolves.toBe('invalid');
        await expect(validateSessionAuthSecret(SESSION, undefined)).resolves.toBe('invalid');
        await expect(validateSessionAuthSecret(SESSION, 'short')).resolves.toBe('invalid');
    });
});
