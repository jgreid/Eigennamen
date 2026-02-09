/**
 * Room Config Branch Coverage Tests
 * Targets uncovered lines: 19-22
 *
 * Lines 19-22: The memory mode TTL branches
 * When REDIS_URL=memory, TTLs are shortened (4h vs 24h)
 * When REDIS_URL is something else (or unset), normal TTLs (24h)
 */

describe('Room Config Branch Coverage', () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
        jest.resetModules();
        process.env = { ...originalEnv };
    });

    afterAll(() => {
        process.env = originalEnv;
    });

    describe('Memory mode TTL detection (lines 19-22)', () => {
        it('should use short TTLs when REDIS_URL is "memory"', () => {
            process.env.REDIS_URL = 'memory';
            jest.resetModules();
            const config = require('../config/roomConfig');

            expect(config.ROOM_EXPIRY_HOURS).toBe(4);
            expect(config.REDIS_TTL.ROOM).toBe(4 * 60 * 60); // 4 hours in seconds
            expect(config.TTL.PAUSED_TIMER).toBe(4 * 60 * 60);
        });

        it('should use short TTLs when REDIS_URL is "memory://"', () => {
            process.env.REDIS_URL = 'memory://';
            jest.resetModules();
            const config = require('../config/roomConfig');

            expect(config.ROOM_EXPIRY_HOURS).toBe(4);
            expect(config.REDIS_TTL.ROOM).toBe(4 * 60 * 60);
        });

        it('should use long TTLs when REDIS_URL is a real Redis URL', () => {
            process.env.REDIS_URL = 'redis://localhost:6379';
            jest.resetModules();
            const config = require('../config/roomConfig');

            expect(config.ROOM_EXPIRY_HOURS).toBe(24);
            expect(config.REDIS_TTL.ROOM).toBe(24 * 60 * 60); // 24 hours in seconds
            expect(config.TTL.PAUSED_TIMER).toBe(24 * 60 * 60);
        });

        it('should use long TTLs when REDIS_URL is not set', () => {
            delete process.env.REDIS_URL;
            jest.resetModules();
            const config = require('../config/roomConfig');

            expect(config.ROOM_EXPIRY_HOURS).toBe(24);
            expect(config.REDIS_TTL.ROOM).toBe(24 * 60 * 60);
        });
    });
});
