/**
 * Regression coverage for the RATE_LIMITS config map itself (not the generic
 * rate-limiter mechanics, which are covered in middleware/rateLimit.test.ts).
 *
 * game:abandon and game:clearHistory were previously missing from this map —
 * getLimiter() silently no-ops for any event name absent from it, so those
 * host-only, Redis-write-and-broadcast events had no throttling at all despite
 * game:forfeit-style siblings being rate-limited. See docs/HARDENING_PLAN.md P1-5.
 */
jest.mock('../../utils/logger', () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
}));

import { RATE_LIMITS } from '../../config/rateLimits';
import { createSocketRateLimiter } from '../../middleware/rateLimit';

describe('RATE_LIMITS config', () => {
    test.each(['game:abandon', 'game:clearHistory'])('%s has a rate limit entry', (eventName) => {
        expect(RATE_LIMITS[eventName]).toBeDefined();
        expect(RATE_LIMITS[eventName]?.max).toBeGreaterThan(0);
        expect(RATE_LIMITS[eventName]?.window).toBeGreaterThan(0);
    });

    test.each(['game:abandon', 'game:clearHistory'])(
        '%s is actually throttled by the real socket rate limiter, not a pass-through',
        (eventName) => {
            const rateLimiter = createSocketRateLimiter(RATE_LIMITS);
            const middleware = rateLimiter.getLimiter(eventName);
            const mockSocket = { id: `socket-${eventName}`, clientIP: '127.0.0.3' };
            const next = jest.fn();

            const limit = RATE_LIMITS[eventName] as { max: number };
            for (let i = 0; i < limit.max + 1; i++) {
                middleware(mockSocket, {}, next);
            }

            expect(next).toHaveBeenLastCalledWith(expect.any(Error));
        }
    );
});
