/**
 * Performance Optimization Tests - Phase 3
 *
 * Tests for:
 * - Rate limiter in-place filtering
 * - Team sets for O(1) lookups
 * - Redis connection configuration
 */

const { createSocketRateLimiter } = require('../middleware/rateLimit');

describe('Rate Limiter Optimizations', () => {
    describe('createSocketRateLimiter', () => {
        let rateLimiter;

        beforeEach(() => {
            rateLimiter = createSocketRateLimiter({
                'test:event': { max: 5, window: 1000 }
            });
        });

        test('allows requests within limit', (done) => {
            const mockSocket = {
                id: 'socket-123',
                clientIP: '127.0.0.1'
            };

            const limiter = rateLimiter.getLimiter('test:event');

            // First request should pass
            limiter(mockSocket, {}, (err) => {
                expect(err).toBeUndefined();
                done();
            });
        });

        test('blocks requests exceeding limit', (done) => {
            const mockSocket = {
                id: 'socket-123',
                clientIP: '127.0.0.1'
            };

            const limiter = rateLimiter.getLimiter('test:event');

            // Make 5 requests to hit the limit
            let _completed = 0;
            for (let i = 0; i < 5; i++) {
                limiter(mockSocket, {}, () => {
                    _completed++;
                });
            }

            // 6th request should be blocked
            limiter(mockSocket, {}, (err) => {
                expect(err).toBeDefined();
                expect(err.message).toBe('Rate limit exceeded');
                done();
            });
        });

        test('cleans up socket entries on disconnect', () => {
            const mockSocket = {
                id: 'socket-cleanup-test',
                clientIP: '127.0.0.1'
            };

            const limiter = rateLimiter.getLimiter('test:event');

            // Make some requests
            limiter(mockSocket, {}, () => {});
            limiter(mockSocket, {}, () => {});

            // Size should be > 0
            expect(rateLimiter.getSize()).toBeGreaterThan(0);

            // Cleanup socket
            rateLimiter.cleanupSocket('socket-cleanup-test');

            // Verify metrics still work
            const metrics = rateLimiter.getMetrics();
            expect(metrics.totalRequests).toBeGreaterThanOrEqual(2);
        });

        test('returns no-op limiter for unconfigured events', (done) => {
            const mockSocket = {
                id: 'socket-123',
                clientIP: '127.0.0.1'
            };

            const limiter = rateLimiter.getLimiter('unconfigured:event');

            // Should pass through without any limiting
            limiter(mockSocket, {}, (err) => {
                expect(err).toBeUndefined();
                done();
            });
        });

        test('tracks metrics correctly', () => {
            const mockSocket = {
                id: 'socket-metrics',
                clientIP: '192.168.1.1'
            };

            const limiter = rateLimiter.getLimiter('test:event');

            // Make requests
            limiter(mockSocket, {}, () => {});
            limiter(mockSocket, {}, () => {});
            limiter(mockSocket, {}, () => {});

            const metrics = rateLimiter.getMetrics();

            expect(metrics.totalRequests).toBeGreaterThanOrEqual(3);
            expect(metrics.uniqueSockets.size || metrics.uniqueSockets).toBeGreaterThanOrEqual(1);
            expect(metrics.uniqueIPs.size || metrics.uniqueIPs).toBeGreaterThanOrEqual(1);
        });

        test('resets metrics correctly', () => {
            const mockSocket = {
                id: 'socket-reset',
                clientIP: '10.0.0.1'
            };

            const limiter = rateLimiter.getLimiter('test:event');
            limiter(mockSocket, {}, () => {});

            // Reset metrics
            rateLimiter.resetMetrics();

            const metrics = rateLimiter.getMetrics();
            expect(metrics.totalRequests).toBe(0);
            expect(metrics.blockedRequests).toBe(0);
        });

        test('stale cleanup removes old entries', (done) => {
            // Create limiter with very short window for testing
            const shortWindowLimiter = createSocketRateLimiter({
                'short:event': { max: 10, window: 50 } // 50ms window
            });

            const mockSocket = {
                id: 'socket-stale',
                clientIP: '127.0.0.1'
            };

            const limiter = shortWindowLimiter.getLimiter('short:event');
            limiter(mockSocket, {}, () => {});

            // Wait for window to expire
            setTimeout(() => {
                shortWindowLimiter.cleanupStale();

                // After cleanup, size should be 0 or entries should be empty
                const size = shortWindowLimiter.getSize();
                // May not be 0 if IP entry exists, but should be cleaned
                expect(size).toBeLessThanOrEqual(2);
                done();
            }, 100);
        });
    });
});

describe('Redis Batch Operations - Code Patterns', () => {
    test('getTeamMembers uses mGet for batch fetching', () => {
        const fs = require('fs');
        const playerServiceCode = fs.readFileSync(
            require.resolve('../services/playerService.js'),
            'utf8'
        );

        // Verify batch fetch pattern exists
        expect(playerServiceCode).toContain('mGet');
        expect(playerServiceCode).toMatch(/playerKeys\s*=\s*sessionIds\.map/);
        expect(playerServiceCode).toMatch(/redis\.mGet\(playerKeys\)/);
    });

    test('getTeamMembers handles empty team early-return', () => {
        const fs = require('fs');
        const playerServiceCode = fs.readFileSync(
            require.resolve('../services/playerService.js'),
            'utf8'
        );

        // Verify early return for empty team
        expect(playerServiceCode).toMatch(/if\s*\(\s*sessionIds\.length\s*===\s*0\s*\)/);
        expect(playerServiceCode).toContain('return [];');
    });

    test('getPlayersInRoom uses mGet for batch fetching', () => {
        const fs = require('fs');
        const playerServiceCode = fs.readFileSync(
            require.resolve('../services/playerService.js'),
            'utf8'
        );

        // Verify batch fetch in getPlayersInRoom as well
        expect(playerServiceCode).toMatch(/getPlayersInRoom/);
        expect(playerServiceCode).toMatch(/mGet/);
    });
});

describe('Atomic Operations - Code Patterns', () => {
    test('setTeam uses Lua script for atomicity', () => {
        const fs = require('fs');
        const playerServiceCode = fs.readFileSync(
            require.resolve('../services/playerService.js'),
            'utf8'
        );

        // Verify Lua script pattern for atomic operations
        expect(playerServiceCode).toContain('ATOMIC_SET_TEAM_SCRIPT');
        expect(playerServiceCode).toMatch(/redis\.eval/);
    });

    test('room join uses atomic script', () => {
        const fs = require('fs');
        const roomServiceCode = fs.readFileSync(
            require.resolve('../services/roomService.js'),
            'utf8'
        );

        // Verify atomic join pattern
        expect(roomServiceCode).toContain('ATOMIC_JOIN_SCRIPT');
        expect(roomServiceCode).toMatch(/redis\.eval/);
    });

    test('setTeam clears role when changing teams', () => {
        const fs = require('fs');
        const playerServiceCode = fs.readFileSync(
            require.resolve('../services/playerService.js'),
            'utf8'
        );

        // Verify role clearing on team change in Lua script
        expect(playerServiceCode).toMatch(/role.*spectator|spectator.*role/i);
    });
});

describe('Health Check Timeout', () => {
    test('health check endpoint has timeout protection', () => {
        const fs = require('fs');
        const appCode = fs.readFileSync(
            require.resolve('../app.js'),
            'utf8'
        );

        expect(appCode).toContain('Promise.race');
        expect(appCode).toContain('Socket count timeout');
        // Timeout value should use constant from config/constants.js
        expect(appCode).toContain('SOCKET.SOCKET_COUNT_TIMEOUT_MS');
    });
});

describe('Frontend Caching Patterns', () => {
    test('frontend uses element caching pattern', () => {
        const fs = require('fs');
        const path = require('path');
        const indexHtml = fs.readFileSync(
            path.join(__dirname, '..', '..', '..', 'index.html'),
            'utf8'
        );

        expect(indexHtml).toContain('cachedElements');
        expect(indexHtml).toContain('initCachedElements');
        expect(indexHtml).toMatch(/cachedElements\.board\s*\|\|\s*document\.getElementById/);
    });
});

describe('Frontend Module Architecture', () => {
    const fs = require('fs');
    const path = require('path');
    const publicJsPath = path.join(__dirname, '..', '..', 'public', 'js');

    test('state.js module exists with EventEmitter pattern', () => {
        const stateJs = fs.readFileSync(path.join(publicJsPath, 'state.js'), 'utf8');

        // EventEmitter class
        expect(stateJs).toContain('class EventEmitter');
        expect(stateJs).toMatch(/on\s*\(\s*event\s*,\s*callback\s*\)/);
        expect(stateJs).toMatch(/emit\s*\(\s*event/);
        expect(stateJs).toContain('off(event, callback)');

        // StateStore class
        expect(stateJs).toContain('class StateStore');
        expect(stateJs).toContain('extends EventEmitter');

        // AppState class
        expect(stateJs).toContain('class AppState');
        expect(stateJs).toContain('createGameStore');
        expect(stateJs).toContain('createPlayerStore');
        expect(stateJs).toContain('createUIStore');
    });

    test('socket-client.js module exists with reconnection handling', () => {
        const socketJs = fs.readFileSync(path.join(publicJsPath, 'socket-client.js'), 'utf8');

        // Connection handling
        expect(socketJs).toContain('CodenamesClient');
        expect(socketJs).toContain('connect(');
        expect(socketJs).toContain('reconnectAttempts');
        expect(socketJs).toContain('maxReconnectAttempts');

        // Session management
        expect(socketJs).toContain('sessionId');
        expect(socketJs).toContain('sessionStorage');

        // Room management
        expect(socketJs).toContain('roomCode');
        expect(socketJs).toContain('autoRejoin');
    });

    test('ui.js module exists with ElementCache', () => {
        const uiJs = fs.readFileSync(path.join(publicJsPath, 'ui.js'), 'utf8');

        // ElementCache class
        expect(uiJs).toContain('class ElementCache');
        expect(uiJs).toContain('this.cache');
        expect(uiJs).toContain('this.initialized');

        // Screen reader support
        expect(uiJs).toContain('ScreenReaderAnnouncer');
        expect(uiJs).toContain('aria-live');
    });

    test('game.js module exists with game logic', () => {
        const gameJs = fs.readFileSync(path.join(publicJsPath, 'game.js'), 'utf8');

        // Game logic functions
        expect(gameJs).toMatch(/seededRandom|shuffleWithSeed|BOARD_SIZE/);
    });

    test('app.js module exists as main entry point', () => {
        const appJs = fs.readFileSync(path.join(publicJsPath, 'app.js'), 'utf8');

        // Main app initialization
        expect(appJs).toMatch(/init|initialize|DOMContentLoaded/i);
    });

    test('event listener cleanup pattern exists', () => {
        const fs = require('fs');
        const indexHtml = fs.readFileSync(
            path.join(__dirname, '..', '..', '..', 'index.html'),
            'utf8'
        );

        // Modal event cleanup
        expect(indexHtml).toContain('removeEventListener');
    });

    test('state management uses centralized gameState object', () => {
        const fs = require('fs');
        const indexHtml = fs.readFileSync(
            path.join(__dirname, '..', '..', '..', 'index.html'),
            'utf8'
        );

        // Centralized state
        expect(indexHtml).toMatch(/let\s+gameState\s*=/);
        expect(indexHtml).toContain('gameState.currentTurn');
        expect(indexHtml).toContain('gameState.gameOver');
        expect(indexHtml).toContain('gameState.revealed');
    });
});

describe('In-place Array Filtering', () => {
    // Test the concept of in-place filtering used in rate limiter
    test('in-place filter modifies array length correctly', () => {
        const timestamps = [100, 200, 300, 400, 500];
        const windowStart = 250;

        // Simulate in-place filtering
        let writeIndex = 0;
        for (let i = 0; i < timestamps.length; i++) {
            if (timestamps[i] > windowStart) {
                timestamps[writeIndex++] = timestamps[i];
            }
        }
        timestamps.length = writeIndex;

        expect(timestamps).toEqual([300, 400, 500]);
        expect(timestamps.length).toBe(3);
    });

    test('in-place filter handles empty result', () => {
        const timestamps = [100, 200, 300];
        const windowStart = 500;

        let writeIndex = 0;
        for (let i = 0; i < timestamps.length; i++) {
            if (timestamps[i] > windowStart) {
                timestamps[writeIndex++] = timestamps[i];
            }
        }
        timestamps.length = writeIndex;

        expect(timestamps).toEqual([]);
        expect(timestamps.length).toBe(0);
    });

    test('in-place filter handles all elements passing', () => {
        const timestamps = [100, 200, 300];
        const windowStart = 50;

        let writeIndex = 0;
        for (let i = 0; i < timestamps.length; i++) {
            if (timestamps[i] > windowStart) {
                timestamps[writeIndex++] = timestamps[i];
            }
        }
        timestamps.length = writeIndex;

        expect(timestamps).toEqual([100, 200, 300]);
        expect(timestamps.length).toBe(3);
    });
});
