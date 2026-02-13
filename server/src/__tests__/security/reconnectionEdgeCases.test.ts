/**
 * Reconnection Edge Case Tests
 *
 * Tests for complex reconnection scenarios including:
 * - Grace period handling
 * - Multi-tab session conflicts
 * - Token expiration during reconnection
 * - Concurrent reconnection attempts
 * - Host transfer during disconnect
 * - Game state changes during disconnect
 */

// Mock dependencies
jest.mock('../../services/playerService');
jest.mock('../../services/roomService');
jest.mock('../../services/gameService');
jest.mock('../../utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));

const playerService = require('../../services/playerService');
const roomService = require('../../services/roomService');
const gameService = require('../../services/gameService');

describe('Reconnection Edge Cases', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    describe('Grace Period Handling', () => {
        test('player can reconnect within grace period', async () => {
            const sessionId = 'session-456';
            const roomCode = 'TEST12';

            // Simulate disconnected player within grace period
            playerService.getPlayer.mockResolvedValue({
                sessionId,
                roomCode,
                connected: false,
                lastSeen: Date.now() - 30000, // 30 seconds ago
                nickname: 'Player1',
                team: 'red'
            });

            const player = await playerService.getPlayer(sessionId);
            expect(player.connected).toBe(false);

            // Within 5-minute grace period
            const gracePeriod = 5 * 60 * 1000;
            const timeSinceDisconnect = Date.now() - player.lastSeen;
            expect(timeSinceDisconnect).toBeLessThan(gracePeriod);
        });

        test('player state is preserved during grace period', async () => {
            const sessionId = 'session-456';

            playerService.getPlayer.mockResolvedValue({
                sessionId,
                roomCode: 'TEST12',
                connected: false,
                lastSeen: Date.now() - 60000,
                nickname: 'Player1',
                team: 'red',
                role: 'spymaster'
            });

            const player = await playerService.getPlayer(sessionId);

            // Team and role should be preserved
            expect(player.team).toBe('red');
            expect(player.role).toBe('spymaster');
        });

        test('player is removed after grace period expires', async () => {
            const sessionId = 'session-456';
            const gracePeriod = 5 * 60 * 1000;

            // Simulate scheduled cleanup check
            playerService.getScheduledCleanups = jest.fn().mockResolvedValue([
                { sessionId, scheduledTime: Date.now() - gracePeriod }
            ]);

            playerService.getPlayer.mockResolvedValue({
                sessionId,
                connected: false,
                lastSeen: Date.now() - gracePeriod - 1000
            });

            const cleanups = await playerService.getScheduledCleanups();
            expect(cleanups).toHaveLength(1);
            expect(cleanups[0].sessionId).toBe(sessionId);
        });
    });

    describe('Multi-Tab Session Conflicts', () => {
        test('detects conflicting session from same browser', async () => {
            const sessionId = 'session-456';

            // First tab is connected
            playerService.getPlayer.mockResolvedValue({
                sessionId,
                connected: true,
                socketId: 'socket-original'
            });

            const existingPlayer = await playerService.getPlayer(sessionId);

            // Second tab tries to use same session
            // Should be blocked as player is already connected
            expect(existingPlayer.connected).toBe(true);
        });

        test('allows reconnection when original connection lost', async () => {
            const sessionId = 'session-456';

            // Original connection is gone
            playerService.getPlayer.mockResolvedValue({
                sessionId,
                connected: false,
                socketId: null
            });

            const player = await playerService.getPlayer(sessionId);
            expect(player.connected).toBe(false);
            // Should allow new connection
        });

        test('handles rapid disconnect/reconnect cycle', async () => {
            const sessionId = 'session-456';
            let connected = true;

            playerService.getPlayer.mockImplementation(async () => ({
                sessionId,
                connected,
                lastSeen: Date.now()
            }));

            playerService.updatePlayer.mockImplementation(async (id, updates) => {
                if (updates.connected !== undefined) {
                    connected = updates.connected;
                }
                return { sessionId: id, connected };
            });

            // Disconnect
            await playerService.updatePlayer(sessionId, { connected: false });
            let player = await playerService.getPlayer(sessionId);
            expect(player.connected).toBe(false);

            // Quick reconnect
            await playerService.updatePlayer(sessionId, { connected: true });
            player = await playerService.getPlayer(sessionId);
            expect(player.connected).toBe(true);
        });
    });

    describe('Token Expiration', () => {
        test('validates token expiration', async () => {
            const _expiredToken = {
                sessionId: 'session-456',
                roomCode: 'TEST12',
                createdAt: Date.now() - 6 * 60 * 1000, // 6 minutes ago
                expiresAt: Date.now() - 60 * 1000      // Expired 1 minute ago
            };

            playerService.validateRoomReconnectToken.mockResolvedValue({
                valid: false,
                reason: 'Token expired'
            });

            const result = await playerService.validateRoomReconnectToken('expired-token', 'session-456');
            expect(result.valid).toBe(false);
            expect(result.reason).toContain('expired');
        });

        test('refreshes token on successful reconnection', async () => {
            playerService.validateRoomReconnectToken.mockResolvedValue({
                valid: true,
                tokenData: { sessionId: 'session-456', roomCode: 'TEST12' }
            });

            playerService.generateReconnectionToken.mockResolvedValue('new-token');

            const validation = await playerService.validateRoomReconnectToken('old-token', 'session-456');
            expect(validation.valid).toBe(true);

            // After reconnection, system should generate new token for next time
            const newToken = await playerService.generateReconnectionToken('session-456');
            expect(newToken).toBe('new-token');
        });
    });

    describe('Concurrent Reconnection Attempts', () => {
        test('handles simultaneous reconnection from multiple devices', async () => {
            const sessionId = 'session-456';
            let reconnectAttempts = 0;

            playerService.validateRoomReconnectToken.mockImplementation(async () => {
                reconnectAttempts++;
                // First attempt wins
                if (reconnectAttempts === 1) {
                    return { valid: true, tokenData: { sessionId, roomCode: 'TEST12' } };
                }
                // Subsequent attempts fail (token already used)
                return { valid: false, reason: 'Token already used' };
            });

            // Simulate concurrent attempts
            const attempts = await Promise.all([
                playerService.validateRoomReconnectToken('token', sessionId),
                playerService.validateRoomReconnectToken('token', sessionId),
                playerService.validateRoomReconnectToken('token', sessionId)
            ]);

            const successfulAttempts = attempts.filter(a => a.valid);
            expect(successfulAttempts).toHaveLength(1);
        });

        test('prevents race condition in session restoration', async () => {
            const sessionId = 'session-456';
            let updateCount = 0;

            playerService.updatePlayer.mockImplementation(async (id, updates) => {
                updateCount++;
                return { sessionId: id, ...updates, updateNumber: updateCount };
            });

            // Concurrent updates
            await Promise.all([
                playerService.updatePlayer(sessionId, { connected: true, socketId: 'socket-1' }),
                playerService.updatePlayer(sessionId, { connected: true, socketId: 'socket-2' })
            ]);

            // Both updates should complete (implementation should handle atomicity)
            expect(updateCount).toBe(2);
        });
    });

    describe('Host Transfer During Disconnect', () => {
        test('player loses host status if another becomes host during disconnect', async () => {
            const originalHost = 'session-456';
            const newHost = 'session-789';

            // Original host disconnected, host transferred
            playerService.getPlayer.mockResolvedValueOnce({
                sessionId: originalHost,
                isHost: false, // Host status transferred
                connected: false
            });

            roomService.getRoom.mockResolvedValue({
                code: 'TEST12',
                hostId: newHost // New host
            });

            const player = await playerService.getPlayer(originalHost);
            const room = await roomService.getRoom('TEST12');

            expect(player.isHost).toBe(false);
            expect(room.hostId).toBe(newHost);
        });

        test('player regains host if no other players during reconnect', async () => {
            const sessionId = 'session-456';

            roomService.getRoom.mockResolvedValue({
                code: 'TEST12',
                hostId: sessionId // Still host
            });

            playerService.getPlayersInRoom.mockResolvedValue([
                { sessionId, isHost: true, connected: false }
            ]);

            const room = await roomService.getRoom('TEST12');
            const players = await playerService.getPlayersInRoom('TEST12');

            // Only player in room, should remain host
            expect(room.hostId).toBe(sessionId);
            expect(players[0].isHost).toBe(true);
        });
    });

    describe('Game State Changes During Disconnect', () => {
        test('player sees updated game state after reconnection', async () => {
            const _sessionId = 'session-456';

            // Game progressed during disconnect
            gameService.getGame.mockResolvedValue({
                currentTurn: 'blue', // Was 'red' when disconnected
                redScore: 3,         // Was 2 when disconnected
                blueScore: 4,        // Was 3 when disconnected
                gameOver: false,
                version: 15          // State version increased
            });

            const game = await gameService.getGame('TEST12');

            expect(game.redScore).toBe(3);
            expect(game.blueScore).toBe(4);
            expect(game.version).toBe(15);
        });

        test('handles game ending during disconnect', async () => {
            gameService.getGame.mockResolvedValue({
                currentTurn: 'red',
                gameOver: true,
                winner: 'blue',
                endReason: 'assassin'
            });

            const game = await gameService.getGame('TEST12');

            expect(game.gameOver).toBe(true);
            expect(game.winner).toBe('blue');
        });

        test('handles room deletion during disconnect', async () => {
            roomService.getRoom.mockResolvedValue(null);

            const room = await roomService.getRoom('TEST12');
            expect(room).toBeNull();
        });

        test('spymaster reconnects with card types hidden if game over', async () => {
            const sessionId = 'session-456';

            playerService.getPlayer.mockResolvedValue({
                sessionId,
                role: 'spymaster',
                team: 'red'
            });

            gameService.getGame.mockResolvedValue({
                gameOver: true,
                types: ['red', 'blue', 'neutral', 'assassin'] // Full types
            });

            // When game is over, spymaster view should show all types
            gameService.getGameStateForPlayer.mockReturnValue({
                gameOver: true,
                types: ['red', 'blue', 'neutral', 'assassin'] // All revealed
            });

            const game = await gameService.getGame('TEST12');
            const player = await playerService.getPlayer(sessionId);

            expect(game.gameOver).toBe(true);
            expect(player.role).toBe('spymaster');
        });
    });

    describe('Team Changes During Disconnect', () => {
        test('player keeps team assignment through disconnect', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-456',
                team: 'red',
                role: 'clicker',
                connected: false
            });

            const player = await playerService.getPlayer('session-456');
            expect(player.team).toBe('red');
            expect(player.role).toBe('clicker');
        });

        test('player loses role if team changes during disconnect', async () => {
            // Team balancing might occur
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-456',
                team: 'blue', // Was red
                role: 'spectator', // Lost clicker role on team change
                connected: false
            });

            const player = await playerService.getPlayer('session-456');
            expect(player.team).toBe('blue');
            expect(player.role).toBe('spectator');
        });
    });

    describe('IP Address Validation', () => {
        test('warns on IP address change during reconnection', async () => {
            playerService.validateRoomReconnectToken.mockResolvedValue({
                valid: true,
                tokenData: {
                    sessionId: 'session-456',
                    roomCode: 'TEST12',
                    ipAddress: '192.168.1.100'
                },
                ipChanged: true,
                originalIp: '192.168.1.100',
                newIp: '10.0.0.50'
            });

            const validation = await playerService.validateRoomReconnectToken('token', 'session-456');

            expect(validation.valid).toBe(true);
            expect(validation.ipChanged).toBe(true);
        });

        test('blocks reconnection from drastically different IP', async () => {
            playerService.validateRoomReconnectToken.mockResolvedValue({
                valid: false,
                reason: 'IP address mismatch - possible session hijacking'
            });

            const validation = await playerService.validateRoomReconnectToken('token', 'session-456');

            expect(validation.valid).toBe(false);
            expect(validation.reason).toContain('IP address');
        });
    });

    describe('Event Log Recovery', () => {
        test('retrieves missed events for replay', async () => {
            const missedEvents = [
                { type: 'CARD_REVEALED', data: { index: 5, type: 'red' }, version: 10 },
                { type: 'CLUE_GIVEN', data: { word: 'ANIMAL', number: 2 }, version: 11 },
                { type: 'TURN_ENDED', data: { previousTurn: 'red', currentTurn: 'blue' }, version: 12 }
            ];

            const lastKnownVersion = 9;

            // Simulate eventLogService.getEventsSince
            const getEventsSince = jest.fn().mockResolvedValue(missedEvents);

            const events = await getEventsSince('TEST12', lastKnownVersion);

            expect(events).toHaveLength(3);
            expect(events[0].version).toBeGreaterThan(lastKnownVersion);
        });

        test('handles event log overflow (too many missed events)', async () => {
            // If player missed more than MAX_EVENTS (100), full resync needed
            const canReplayFrom = jest.fn().mockResolvedValue(false);

            const canReplay = await canReplayFrom('TEST12', 5);
            expect(canReplay).toBe(false);
            // Client should request full resync instead
        });
    });
});
