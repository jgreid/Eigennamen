/**
 * Integration Tests: Password-Protected Room Data Structures
 *
 * Tests data structures and patterns for:
 * - Room creation with password
 * - Password validation patterns
 * - Reconnection state management
 * - Multi-player scenarios
 */

const { createMockRedis, createMockPlayer, createMockRoom, generateRoomCode } = require('../helpers/mocks');

describe('Password-Protected Room Data Structures', () => {
    let mockRedis;

    beforeEach(() => {
        mockRedis = createMockRedis();
        jest.clearAllMocks();
    });

    describe('Room Creation with Password', () => {
        it('should store room with password hash', async () => {
            const roomCode = generateRoomCode();
            const room = createMockRoom({
                code: roomCode,
                passwordHash: '$2b$10$hashedpassword...',
                passwordVersion: 1
            });

            await mockRedis.set(`room:${roomCode}`, JSON.stringify(room));

            const stored = await mockRedis.get(`room:${roomCode}`);
            const parsed = JSON.parse(stored);

            expect(parsed.code).toBe(roomCode);
            expect(parsed.passwordHash).toBeTruthy();
            expect(parsed.passwordVersion).toBe(1);
        });

        it('should store room without password when not provided', async () => {
            const roomCode = generateRoomCode();
            const room = createMockRoom({
                code: roomCode,
                passwordHash: null,
                passwordVersion: 0
            });

            await mockRedis.set(`room:${roomCode}`, JSON.stringify(room));

            const stored = await mockRedis.get(`room:${roomCode}`);
            const parsed = JSON.parse(stored);

            expect(parsed.passwordHash).toBeNull();
            expect(parsed.passwordVersion).toBe(0);
        });
    });

    describe('Password Validation Patterns', () => {
        it('should check if room has password', async () => {
            const roomCode = generateRoomCode();
            const room = createMockRoom({
                code: roomCode,
                passwordHash: '$2b$10$hashedpassword...'
            });

            await mockRedis.set(`room:${roomCode}`, JSON.stringify(room));

            const stored = await mockRedis.get(`room:${roomCode}`);
            const parsed = JSON.parse(stored);
            const hasPassword = parsed.passwordHash !== null;

            expect(hasPassword).toBe(true);
        });

        it('should track password version for session validation', async () => {
            const roomCode = generateRoomCode();
            const sessionPasswordVersion = 1;

            const room = createMockRoom({
                code: roomCode,
                passwordHash: '$2b$10$hashedpassword...',
                passwordVersion: 2 // Password was changed
            });

            await mockRedis.set(`room:${roomCode}`, JSON.stringify(room));

            const stored = await mockRedis.get(`room:${roomCode}`);
            const parsed = JSON.parse(stored);

            const sessionValid = sessionPasswordVersion === parsed.passwordVersion;
            expect(sessionValid).toBe(false);
        });
    });

    describe('Reconnection Scenarios', () => {
        it('should allow reconnection within grace period', async () => {
            const roomCode = generateRoomCode();
            const sessionId = 'player-session-123';

            const room = createMockRoom({ code: roomCode });
            const player = createMockPlayer({
                sessionId,
                roomCode,
                connected: false,
                disconnectedAt: Date.now() - 30000 // 30 seconds ago
            });

            await mockRedis.set(`room:${roomCode}`, JSON.stringify(room));
            await mockRedis.set(`player:${sessionId}`, JSON.stringify(player));

            // Check if within grace period (e.g., 5 minutes)
            const GRACE_PERIOD_MS = 5 * 60 * 1000;
            const stored = await mockRedis.get(`player:${sessionId}`);
            const parsed = JSON.parse(stored);

            const withinGracePeriod = Date.now() - parsed.disconnectedAt < GRACE_PERIOD_MS;
            expect(withinGracePeriod).toBe(true);
        });

        it('should mark player as connected on reconnection', async () => {
            const sessionId = 'player-session-123';

            const player = createMockPlayer({
                sessionId,
                connected: false,
                disconnectedAt: Date.now() - 30000
            });

            await mockRedis.set(`player:${sessionId}`, JSON.stringify(player));

            // Simulate reconnection
            const stored = await mockRedis.get(`player:${sessionId}`);
            const parsed = JSON.parse(stored);
            parsed.connected = true;
            parsed.lastSeen = Date.now();
            delete parsed.disconnectedAt;

            await mockRedis.set(`player:${sessionId}`, JSON.stringify(parsed));

            const updated = await mockRedis.get(`player:${sessionId}`);
            const updatedParsed = JSON.parse(updated);

            expect(updatedParsed.connected).toBe(true);
        });
    });

    describe('Password Change During Session', () => {
        it('should increment password version when password changes', async () => {
            const roomCode = generateRoomCode();

            const room = createMockRoom({
                code: roomCode,
                passwordHash: '$2b$10$originalpassword...',
                passwordVersion: 1
            });

            await mockRedis.set(`room:${roomCode}`, JSON.stringify(room));

            // Simulate password change
            const stored = await mockRedis.get(`room:${roomCode}`);
            const parsed = JSON.parse(stored);
            parsed.passwordHash = '$2b$10$newpassword...';
            parsed.passwordVersion++;

            await mockRedis.set(`room:${roomCode}`, JSON.stringify(parsed));

            const updated = await mockRedis.get(`room:${roomCode}`);
            const updatedParsed = JSON.parse(updated);

            expect(updatedParsed.passwordVersion).toBe(2);
        });

        it('should track authenticated password version for players', async () => {
            const roomCode = generateRoomCode();
            const sessionId = 'player-123';

            const player = createMockPlayer({
                sessionId,
                roomCode,
                authenticatedPasswordVersion: 1
            });

            const room = createMockRoom({
                code: roomCode,
                passwordVersion: 2 // Password was changed
            });

            await mockRedis.set(`player:${sessionId}`, JSON.stringify(player));
            await mockRedis.set(`room:${roomCode}`, JSON.stringify(room));

            const playerData = await mockRedis.get(`player:${sessionId}`);
            const roomData = await mockRedis.get(`room:${roomCode}`);

            const playerParsed = JSON.parse(playerData);
            const roomParsed = JSON.parse(roomData);

            const needsReauth = playerParsed.authenticatedPasswordVersion !== roomParsed.passwordVersion;
            expect(needsReauth).toBe(true);
        });
    });

    describe('Multi-Player Scenarios', () => {
        it('should handle multiple players in room', async () => {
            const roomCode = generateRoomCode();

            const room = createMockRoom({ code: roomCode });
            await mockRedis.set(`room:${roomCode}`, JSON.stringify(room));
            await mockRedis.sAdd(`room:${roomCode}:players`, ['host-123']);

            // Add multiple players
            const playerCount = 5;
            for (let i = 0; i < playerCount; i++) {
                const sessionId = `player-${i}`;
                const player = createMockPlayer({
                    sessionId,
                    roomCode,
                    nickname: `Player ${i}`,
                    connected: true
                });
                // eslint-disable-next-line no-await-in-loop -- Sequential setup required for deterministic test state
                await mockRedis.set(`player:${sessionId}`, JSON.stringify(player));
                // eslint-disable-next-line no-await-in-loop
                await mockRedis.sAdd(`room:${roomCode}:players`, [sessionId]);
            }

            const playersInRoom = await mockRedis.sMembers(`room:${roomCode}:players`);
            expect(playersInRoom.length).toBe(playerCount + 1); // +1 for host
        });

        it('should handle concurrent team switches', async () => {
            const roomCode = generateRoomCode();

            const players = [];
            for (let i = 0; i < 4; i++) {
                const player = createMockPlayer({
                    sessionId: `player-${i}`,
                    roomCode,
                    team: null,
                    role: 'spectator'
                });
                players.push(player);
                // eslint-disable-next-line no-await-in-loop -- Sequential setup required
                await mockRedis.set(`player:player-${i}`, JSON.stringify(player));
            }

            // Simulate concurrent team switches
            const switches = players.map(async (player, i) => {
                const team = i % 2 === 0 ? 'red' : 'blue';
                const stored = await mockRedis.get(`player:player-${i}`);
                const parsed = JSON.parse(stored);
                parsed.team = team;
                await mockRedis.set(`player:player-${i}`, JSON.stringify(parsed));
            });

            await Promise.all(switches);

            // Verify team assignments
            for (let i = 0; i < 4; i++) {
                // eslint-disable-next-line no-await-in-loop -- Sequential verification required
                const stored = await mockRedis.get(`player:player-${i}`);
                const parsed = JSON.parse(stored);
                expect(parsed.team).toBe(i % 2 === 0 ? 'red' : 'blue');
            }
        });
    });

    describe('Edge Cases', () => {
        it('should handle empty password as no password', async () => {
            const roomCode = generateRoomCode();

            const room = createMockRoom({
                code: roomCode,
                passwordHash: null // Empty string becomes null
            });

            await mockRedis.set(`room:${roomCode}`, JSON.stringify(room));

            const stored = await mockRedis.get(`room:${roomCode}`);
            const parsed = JSON.parse(stored);

            expect(parsed.passwordHash).toBeNull();
        });

        it('should handle room not found during reconnection', async () => {
            const sessionId = 'orphan-session-123';

            const player = await mockRedis.get(`player:${sessionId}`);
            expect(player).toBeNull();
        });

        it('should preserve player state across disconnect/reconnect', async () => {
            const roomCode = generateRoomCode();
            const sessionId = 'player-123';

            const room = createMockRoom({ code: roomCode });
            const player = createMockPlayer({
                sessionId,
                roomCode,
                team: 'red',
                role: 'spymaster',
                nickname: 'TestPlayer',
                connected: true
            });

            await mockRedis.set(`room:${roomCode}`, JSON.stringify(room));
            await mockRedis.set(`player:${sessionId}`, JSON.stringify(player));

            // Disconnect
            let stored = await mockRedis.get(`player:${sessionId}`);
            let parsed = JSON.parse(stored);
            parsed.connected = false;
            parsed.disconnectedAt = Date.now();
            await mockRedis.set(`player:${sessionId}`, JSON.stringify(parsed));

            // Reconnect
            stored = await mockRedis.get(`player:${sessionId}`);
            parsed = JSON.parse(stored);
            parsed.connected = true;
            parsed.lastSeen = Date.now();
            await mockRedis.set(`player:${sessionId}`, JSON.stringify(parsed));

            // Verify state preserved
            stored = await mockRedis.get(`player:${sessionId}`);
            const reconnected = JSON.parse(stored);

            expect(reconnected.team).toBe('red');
            expect(reconnected.role).toBe('spymaster');
            expect(reconnected.nickname).toBe('TestPlayer');
            expect(reconnected.connected).toBe(true);
        });
    });
});
