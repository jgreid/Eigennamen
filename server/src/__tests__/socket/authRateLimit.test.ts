import {
    recordAuthFailure,
    isAuthBlocked,
    clearAuthFailures,
    getAuthFailuresMap,
} from '../../socket/connectionTracker';

// Access the SOCKET config to verify defaults
import { SOCKET } from '../../config/constants';

describe('Socket Auth Rate Limiting', () => {
    beforeEach(() => {
        // Clear all auth failure entries between tests
        getAuthFailuresMap().clear();
    });

    describe('recordAuthFailure', () => {
        it('returns false for the first failure', () => {
            expect(recordAuthFailure('1.2.3.4')).toBe(false);
        });

        it('returns false when under the limit', () => {
            for (let i = 0; i < SOCKET.AUTH_FAILURE_MAX_PER_IP - 1; i++) {
                expect(recordAuthFailure('1.2.3.4')).toBe(false);
            }
        });

        it('returns true when the limit is reached', () => {
            for (let i = 0; i < SOCKET.AUTH_FAILURE_MAX_PER_IP - 1; i++) {
                recordAuthFailure('1.2.3.4');
            }
            // The Nth failure should trigger a block
            expect(recordAuthFailure('1.2.3.4')).toBe(true);
        });

        it('tracks IPs independently', () => {
            for (let i = 0; i < SOCKET.AUTH_FAILURE_MAX_PER_IP - 1; i++) {
                recordAuthFailure('1.2.3.4');
            }
            // Different IP should not be blocked
            expect(recordAuthFailure('5.6.7.8')).toBe(false);
        });

        it('resets the window after AUTH_FAILURE_WINDOW_MS', () => {
            const realNow = Date.now;
            let mockTime = 1000000;
            Date.now = () => mockTime;

            try {
                // Fill up failures
                for (let i = 0; i < SOCKET.AUTH_FAILURE_MAX_PER_IP - 1; i++) {
                    recordAuthFailure('1.2.3.4');
                }

                // Advance past the window
                mockTime += SOCKET.AUTH_FAILURE_WINDOW_MS + 1;

                // Should start a new window (count resets to 1)
                expect(recordAuthFailure('1.2.3.4')).toBe(false);
                expect(getAuthFailuresMap().get('1.2.3.4')!.count).toBe(1);
            } finally {
                Date.now = realNow;
            }
        });
    });

    describe('isAuthBlocked', () => {
        it('returns false for unknown IPs', () => {
            expect(isAuthBlocked('9.9.9.9')).toBe(false);
        });

        it('returns false when failures are under limit', () => {
            recordAuthFailure('1.2.3.4');
            expect(isAuthBlocked('1.2.3.4')).toBe(false);
        });

        it('returns true after limit is exceeded', () => {
            for (let i = 0; i < SOCKET.AUTH_FAILURE_MAX_PER_IP; i++) {
                recordAuthFailure('1.2.3.4');
            }
            expect(isAuthBlocked('1.2.3.4')).toBe(true);
        });

        it('returns false after block expires', () => {
            const realNow = Date.now;
            let mockTime = 1000000;
            Date.now = () => mockTime;

            try {
                for (let i = 0; i < SOCKET.AUTH_FAILURE_MAX_PER_IP; i++) {
                    recordAuthFailure('1.2.3.4');
                }
                expect(isAuthBlocked('1.2.3.4')).toBe(true);

                // Advance past the block duration
                mockTime += SOCKET.AUTH_FAILURE_BLOCK_MS + 1;
                expect(isAuthBlocked('1.2.3.4')).toBe(false);

                // Entry should be cleaned up
                expect(getAuthFailuresMap().has('1.2.3.4')).toBe(false);
            } finally {
                Date.now = realNow;
            }
        });
    });

    describe('clearAuthFailures', () => {
        it('clears failure tracking for an IP', () => {
            for (let i = 0; i < SOCKET.AUTH_FAILURE_MAX_PER_IP; i++) {
                recordAuthFailure('1.2.3.4');
            }
            expect(isAuthBlocked('1.2.3.4')).toBe(true);

            clearAuthFailures('1.2.3.4');
            expect(isAuthBlocked('1.2.3.4')).toBe(false);
            expect(getAuthFailuresMap().has('1.2.3.4')).toBe(false);
        });

        it('is a no-op for unknown IPs', () => {
            clearAuthFailures('unknown');
            expect(getAuthFailuresMap().has('unknown')).toBe(false);
        });
    });

    describe('configuration defaults', () => {
        it('has reasonable AUTH_FAILURE_MAX_PER_IP', () => {
            expect(SOCKET.AUTH_FAILURE_MAX_PER_IP).toBeGreaterThanOrEqual(5);
            expect(SOCKET.AUTH_FAILURE_MAX_PER_IP).toBeLessThanOrEqual(50);
        });

        it('has reasonable AUTH_FAILURE_WINDOW_MS', () => {
            expect(SOCKET.AUTH_FAILURE_WINDOW_MS).toBeGreaterThanOrEqual(30000);
            expect(SOCKET.AUTH_FAILURE_WINDOW_MS).toBeLessThanOrEqual(600000);
        });

        it('has reasonable AUTH_FAILURE_BLOCK_MS', () => {
            expect(SOCKET.AUTH_FAILURE_BLOCK_MS).toBeGreaterThanOrEqual(60000);
            expect(SOCKET.AUTH_FAILURE_BLOCK_MS).toBeLessThanOrEqual(3600000);
        });
    });
});
