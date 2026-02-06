/**
 * Player Service Tests
 *
 * Comprehensive tests for player management, team assignment,
 * role setting, reconnection tokens, and cleanup operations.
 */

const playerService = require('../services/playerService');

// Mock dependencies
jest.mock('../config/redis', () => ({
    getRedis: jest.fn()
}));

jest.mock('../utils/logger', () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
}));

jest.mock('../config/constants', () => ({
    REDIS_TTL: {
        PLAYER: 86400,
        SESSION_SOCKET: 300,
        DISCONNECTED_PLAYER: 600
    },
    ERROR_CODES: {
        SERVER_ERROR: 'SERVER_ERROR',
        INVALID_INPUT: 'INVALID_INPUT'
    },
    SESSION_SECURITY: {
        RECONNECTION_TOKEN_LENGTH: 32,
        RECONNECTION_TOKEN_TTL_SECONDS: 300
    },
    VALIDATION: {
        NICKNAME_MIN_LENGTH: 1,
        NICKNAME_MAX_LENGTH: 30
    },
    PLAYER_CLEANUP: {
        INTERVAL_MS: 60000,
        BATCH_SIZE: 50
    }
}));

const { getRedis } = require('../config/redis');
const logger = require('../utils/logger');

describe('Player Service', () => {
    let mockRedis;

    beforeEach(() => {
        jest.clearAllMocks();

        const mockMulti = {
            set: jest.fn().mockReturnThis(),
            exec: jest.fn().mockResolvedValue(['OK'])
        };

        mockRedis = {
            get: jest.fn(),
            set: jest.fn(),
            del: jest.fn(),
            sAdd: jest.fn(),
            sRem: jest.fn(),
            sMembers: jest.fn(),
            sCard: jest.fn(), // ISSUE #13 FIX: Added for empty team set cleanup
            mGet: jest.fn(),
            expire: jest.fn(),
            eval: jest.fn(),
            zAdd: jest.fn(),
            zRem: jest.fn(),
            zRangeByScore: jest.fn(),
            watch: jest.fn().mockResolvedValue('OK'),
            unwatch: jest.fn().mockResolvedValue('OK'),
            multi: jest.fn().mockReturnValue(mockMulti)
        };
        getRedis.mockReturnValue(mockRedis);
    });

    describe('createPlayer', () => {
        test('creates player with all default values', async () => {
            mockRedis.set.mockResolvedValue('OK');
            mockRedis.sAdd.mockResolvedValue(1);

            const player = await playerService.createPlayer('session-123', 'ABC123', 'TestPlayer', false);

            expect(player).toMatchObject({
                sessionId: 'session-123',
                roomCode: 'ABC123',
                nickname: 'TestPlayer',
                team: null,
                role: 'spectator',
                isHost: false,
                connected: true
            });
            expect(player.connectedAt).toBeDefined();
            expect(player.lastSeen).toBeDefined();
        });

        test('creates host player when isHost is true', async () => {
            mockRedis.set.mockResolvedValue('OK');
            mockRedis.sAdd.mockResolvedValue(1);

            const player = await playerService.createPlayer('session-123', 'ABC123', 'HostPlayer', true);

            expect(player.isHost).toBe(true);
        });

        test('adds player to room set by default', async () => {
            mockRedis.set.mockResolvedValue('OK');
            mockRedis.sAdd.mockResolvedValue(1);

            await playerService.createPlayer('session-123', 'ABC123', 'TestPlayer');

            expect(mockRedis.sAdd).toHaveBeenCalledWith('room:ABC123:players', 'session-123');
        });

        test('does not add player to room set when addToSet is false', async () => {
            mockRedis.set.mockResolvedValue('OK');

            await playerService.createPlayer('session-123', 'ABC123', 'TestPlayer', false, false);

            expect(mockRedis.sAdd).not.toHaveBeenCalled();
        });

        test('saves player with correct TTL', async () => {
            mockRedis.set.mockResolvedValue('OK');
            mockRedis.sAdd.mockResolvedValue(1);

            await playerService.createPlayer('session-123', 'ABC123', 'TestPlayer');

            expect(mockRedis.set).toHaveBeenCalledWith(
                'player:session-123',
                expect.any(String),
                { EX: 86400 }
            );
        });

        test('logs player creation', async () => {
            mockRedis.set.mockResolvedValue('OK');
            mockRedis.sAdd.mockResolvedValue(1);

            await playerService.createPlayer('session-123', 'ABC123', 'TestPlayer');

            expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('TestPlayer'));
        });
    });

    describe('createPlayer with addToSet=false', () => {
        test('creates player without adding to room set', async () => {
            mockRedis.set.mockResolvedValue('OK');

            await playerService.createPlayer('session-123', 'ABC123', 'TestPlayer', false, false);

            expect(mockRedis.sAdd).not.toHaveBeenCalled();
        });
    });

    describe('getPlayer', () => {
        test('returns player when found', async () => {
            const playerData = {
                sessionId: 'session-123',
                nickname: 'TestPlayer'
            };
            mockRedis.get.mockResolvedValue(JSON.stringify(playerData));

            const player = await playerService.getPlayer('session-123');

            expect(player).toEqual(playerData);
        });

        test('returns null when player not found', async () => {
            mockRedis.get.mockResolvedValue(null);

            const player = await playerService.getPlayer('nonexistent');

            expect(player).toBeNull();
        });

        test('returns null and logs error on invalid JSON', async () => {
            mockRedis.get.mockResolvedValue('invalid json');

            const player = await playerService.getPlayer('session-123');

            expect(player).toBeNull();
            expect(logger.error).toHaveBeenCalledWith(
                'Failed to parse player data for session-123:',
                expect.any(String)
            );
        });
    });

    describe('updatePlayer', () => {
        test('updates player with new values', async () => {
            const existingPlayer = {
                sessionId: 'session-123',
                nickname: 'OldName',
                team: null
            };
            mockRedis.get.mockResolvedValue(JSON.stringify(existingPlayer));
            mockRedis.set.mockResolvedValue('OK');

            const updated = await playerService.updatePlayer('session-123', { nickname: 'NewName' });

            expect(updated.nickname).toBe('NewName');
            expect(updated.lastSeen).toBeDefined();
        });

        test('throws error when player not found', async () => {
            mockRedis.get.mockResolvedValue(null);

            await expect(playerService.updatePlayer('nonexistent', {}))
                .rejects.toMatchObject({ code: 'SERVER_ERROR' });
        });

        test('preserves existing values not in updates', async () => {
            const existingPlayer = {
                sessionId: 'session-123',
                nickname: 'TestPlayer',
                team: 'red',
                role: 'clicker'
            };
            mockRedis.get.mockResolvedValue(JSON.stringify(existingPlayer));
            mockRedis.set.mockResolvedValue('OK');

            const updated = await playerService.updatePlayer('session-123', { connected: false });

            expect(updated.nickname).toBe('TestPlayer');
            expect(updated.team).toBe('red');
            expect(updated.role).toBe('clicker');
            expect(updated.connected).toBe(false);
        });
    });

    describe('setTeam', () => {
        test('sets team using Lua script', async () => {
            const existingPlayer = { sessionId: 'session-123', team: null, roomCode: 'ABC123' };
            const updatedPlayer = { sessionId: 'session-123', team: 'red', roomCode: 'ABC123' };
            mockRedis.get.mockResolvedValue(JSON.stringify(existingPlayer));
            mockRedis.eval.mockResolvedValue(JSON.stringify({ success: true, player: updatedPlayer }));

            const result = await playerService.setTeam('session-123', 'red');

            expect(result.team).toBe('red');
            expect(mockRedis.eval).toHaveBeenCalled();
        });

        test('removes from old team set when switching teams', async () => {
            const existingPlayer = { sessionId: 'session-123', team: 'red', roomCode: 'ABC123' };
            const updatedPlayer = { sessionId: 'session-123', team: 'blue', roomCode: 'ABC123' };
            mockRedis.get.mockResolvedValue(JSON.stringify(existingPlayer));
            mockRedis.eval.mockResolvedValue(JSON.stringify({ success: true, player: updatedPlayer }));

            await playerService.setTeam('session-123', 'blue');

            expect(mockRedis.eval).toHaveBeenCalled();
        });

        test('throws error when player not found', async () => {
            mockRedis.get.mockResolvedValue(null);

            await expect(playerService.setTeam('nonexistent', 'red'))
                .rejects.toMatchObject({ code: 'SERVER_ERROR' });
        });

        test('throws error when Lua script returns null', async () => {
            const existingPlayer = { sessionId: 'session-123', team: null, roomCode: 'ABC123' };
            mockRedis.get.mockResolvedValue(JSON.stringify(existingPlayer));
            mockRedis.eval.mockResolvedValue(null);

            await expect(playerService.setTeam('session-123', 'red'))
                .rejects.toMatchObject({ code: 'SERVER_ERROR' });
        });

        test('throws error on JSON parse failure', async () => {
            const existingPlayer = { sessionId: 'session-123', team: null, roomCode: 'ABC123' };
            mockRedis.get.mockResolvedValue(JSON.stringify(existingPlayer));
            mockRedis.eval.mockResolvedValue('invalid json');

            await expect(playerService.setTeam('session-123', 'red'))
                .rejects.toMatchObject({ code: 'SERVER_ERROR' });
        });

        test('handles null team with sentinel value', async () => {
            const existingPlayer = { sessionId: 'session-123', team: 'red', roomCode: 'ABC123' };
            const updatedPlayer = { sessionId: 'session-123', team: null, roomCode: 'ABC123' };
            mockRedis.get.mockResolvedValue(JSON.stringify(existingPlayer));
            mockRedis.eval.mockResolvedValue(JSON.stringify({ success: true, player: updatedPlayer }));

            await playerService.setTeam('session-123', null);

            expect(mockRedis.eval).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    arguments: expect.arrayContaining(['__NULL__'])
                })
            );
        });

        test('rejects team change when team would become empty', async () => {
            const existingPlayer = { sessionId: 'session-123', team: 'red', roomCode: 'ABC123' };
            mockRedis.get.mockResolvedValue(JSON.stringify(existingPlayer));
            mockRedis.eval.mockResolvedValue(JSON.stringify({
                success: false,
                reason: 'TEAM_WOULD_BE_EMPTY'
            }));

            await expect(playerService.setTeam('session-123', 'blue', true))
                .rejects.toMatchObject({ code: 'INVALID_INPUT' });
        });
    });

    describe('setRole', () => {
        test('sets role for player with team via atomic Lua script', async () => {
            // FIX: Updated to use Lua script instead of lock-based approach
            const player = { sessionId: 'session-123', team: 'red', roomCode: 'ABC123', role: 'spectator' };
            const updatedPlayer = { ...player, role: 'spymaster' };
            mockRedis.get.mockResolvedValue(JSON.stringify(player));
            // Lua script returns success with updated player
            mockRedis.eval.mockResolvedValue(JSON.stringify({
                success: true,
                player: updatedPlayer,
                oldRole: 'spectator'
            }));

            const result = await playerService.setRole('session-123', 'spymaster');

            expect(result.role).toBe('spymaster');
            // Verify Lua script was called with correct keys
            expect(mockRedis.eval).toHaveBeenCalledWith(
                expect.any(String), // The Lua script
                expect.objectContaining({
                    keys: ['player:session-123', 'room:ABC123:players']
                })
            );
        });

        test('throws error when player not found', async () => {
            mockRedis.get.mockResolvedValue(null);

            await expect(playerService.setRole('nonexistent', 'spymaster'))
                .rejects.toMatchObject({ code: 'SERVER_ERROR' });
        });

        test('throws error when setting spymaster without team', async () => {
            const player = { sessionId: 'session-123', team: null, roomCode: 'ABC123' };
            mockRedis.get.mockResolvedValue(JSON.stringify(player));
            mockRedis.eval.mockResolvedValue(JSON.stringify({
                success: false,
                reason: 'NO_TEAM'
            }));

            await expect(playerService.setRole('session-123', 'spymaster'))
                .rejects.toMatchObject({
                    code: 'INVALID_INPUT'
                });
        });

        test('throws error when setting clicker without team', async () => {
            const player = { sessionId: 'session-123', team: null, roomCode: 'ABC123' };
            mockRedis.get.mockResolvedValue(JSON.stringify(player));
            mockRedis.eval.mockResolvedValue(JSON.stringify({
                success: false,
                reason: 'NO_TEAM'
            }));

            await expect(playerService.setRole('session-123', 'clicker'))
                .rejects.toMatchObject({
                    code: 'INVALID_INPUT'
                });
        });

        test('throws error when role is already taken (via Lua script)', async () => {
            // FIX: Updated to use Lua script response format
            const player = { sessionId: 'session-123', team: 'red', roomCode: 'ABC123', role: 'spectator' };
            mockRedis.get.mockResolvedValue(JSON.stringify(player));
            // Lua script returns ROLE_TAKEN response
            mockRedis.eval.mockResolvedValue(JSON.stringify({
                success: false,
                reason: 'ROLE_TAKEN',
                existingNickname: 'ExistingPlayer'
            }));

            await expect(playerService.setRole('session-123', 'spymaster'))
                .rejects.toMatchObject({
                    code: 'INVALID_INPUT'
                });
        });

        test('throws error when team already has role (via Lua script)', async () => {
            // FIX: Updated to use Lua script response format
            const player1 = { sessionId: 'session-123', team: 'red', roomCode: 'ABC123', role: 'spectator' };

            mockRedis.get.mockResolvedValue(JSON.stringify(player1));
            // Lua script returns ROLE_TAKEN response
            mockRedis.eval.mockResolvedValue(JSON.stringify({
                success: false,
                reason: 'ROLE_TAKEN',
                existingNickname: 'OtherPlayer'
            }));

            await expect(playerService.setRole('session-123', 'spymaster'))
                .rejects.toMatchObject({
                    code: 'INVALID_INPUT'
                });
        });

        test('allows setting spectator role without team', async () => {
            const player = { sessionId: 'session-123', team: null, roomCode: 'ABC123', role: 'spectator' };
            mockRedis.get.mockResolvedValue(JSON.stringify(player));
            mockRedis.set.mockResolvedValue('OK');

            const result = await playerService.setRole('session-123', 'spectator');

            expect(result.role).toBe('spectator');
            // Should not acquire lock for spectator role
            expect(mockRedis.set).not.toHaveBeenCalledWith(
                expect.stringContaining('lock:spectator'),
                expect.any(String),
                expect.any(Object)
            );
        });

        test('successfully assigns role via atomic Lua script', async () => {
            // FIX: Updated to use Lua script response format
            const player = { sessionId: 'session-123', team: 'red', roomCode: 'ABC123', role: 'spectator' };
            const updatedPlayer = { ...player, role: 'spymaster' };
            mockRedis.get.mockResolvedValue(JSON.stringify(player));
            // Lua script returns success with updated player
            mockRedis.eval.mockResolvedValue(JSON.stringify({
                success: true,
                player: updatedPlayer,
                oldRole: 'spectator'
            }));

            const result = await playerService.setRole('session-123', 'spymaster');

            expect(result.role).toBe('spymaster');
            expect(mockRedis.eval).toHaveBeenCalled();
        });
    });

    describe('setNickname', () => {
        test('updates player nickname', async () => {
            const player = { sessionId: 'session-123', nickname: 'OldName' };
            mockRedis.get.mockResolvedValue(JSON.stringify(player));
            mockRedis.set.mockResolvedValue('OK');

            const result = await playerService.setNickname('session-123', 'NewName');

            expect(result.nickname).toBe('NewName');
        });
    });

    describe('getTeamMembers', () => {
        test('returns empty array when team is empty', async () => {
            mockRedis.sMembers.mockResolvedValue([]);

            const members = await playerService.getTeamMembers('ABC123', 'red');

            expect(members).toEqual([]);
        });

        test('returns players on team', async () => {
            const player1 = { sessionId: 's1', team: 'red', nickname: 'Player1' };
            const player2 = { sessionId: 's2', team: 'red', nickname: 'Player2' };
            mockRedis.sMembers.mockResolvedValue(['s1', 's2']);
            mockRedis.mGet.mockResolvedValue([JSON.stringify(player1), JSON.stringify(player2)]);

            const members = await playerService.getTeamMembers('ABC123', 'red');

            expect(members).toHaveLength(2);
            expect(members[0].nickname).toBe('Player1');
        });

        test('cleans up orphaned entries', async () => {
            const player1 = { sessionId: 's1', team: 'red', nickname: 'Player1' };
            mockRedis.sMembers.mockResolvedValue(['s1', 's2']);
            mockRedis.mGet.mockResolvedValue([JSON.stringify(player1), null]);
            mockRedis.sRem.mockResolvedValue(1);

            const members = await playerService.getTeamMembers('ABC123', 'red');

            expect(members).toHaveLength(1);
            expect(mockRedis.sRem).toHaveBeenCalledWith('room:ABC123:team:red', 's2');
        });

        test('handles player with changed team', async () => {
            const player1 = { sessionId: 's1', team: 'blue', nickname: 'Player1' }; // Wrong team
            mockRedis.sMembers.mockResolvedValue(['s1']);
            mockRedis.mGet.mockResolvedValue([JSON.stringify(player1)]);
            mockRedis.sRem.mockResolvedValue(1);

            const members = await playerService.getTeamMembers('ABC123', 'red');

            expect(members).toHaveLength(0);
            expect(mockRedis.sRem).toHaveBeenCalledWith('room:ABC123:team:red', 's1');
        });

        test('handles JSON parse errors', async () => {
            mockRedis.sMembers.mockResolvedValue(['s1', 's2']);
            mockRedis.mGet.mockResolvedValue(['invalid json', JSON.stringify({ sessionId: 's2', team: 'red' })]);
            mockRedis.sRem.mockResolvedValue(1);

            const members = await playerService.getTeamMembers('ABC123', 'red');

            expect(members).toHaveLength(1);
            expect(logger.error).toHaveBeenCalled();
        });
    });

    describe('getPlayersInRoom', () => {
        test('returns empty array when room has no players', async () => {
            mockRedis.sMembers.mockResolvedValue([]);

            const players = await playerService.getPlayersInRoom('ABC123');

            expect(players).toEqual([]);
        });

        test('returns players sorted by join time', async () => {
            const player1 = { sessionId: 's1', connectedAt: 2000, nickname: 'Later' };
            const player2 = { sessionId: 's2', connectedAt: 1000, nickname: 'Earlier' };
            mockRedis.sMembers.mockResolvedValue(['s1', 's2']);
            mockRedis.mGet.mockResolvedValue([JSON.stringify(player1), JSON.stringify(player2)]);

            const players = await playerService.getPlayersInRoom('ABC123');

            expect(players[0].nickname).toBe('Earlier');
            expect(players[1].nickname).toBe('Later');
        });

        test('cleans up orphaned session IDs', async () => {
            const player1 = { sessionId: 's1', connectedAt: 1000 };
            mockRedis.sMembers.mockResolvedValue(['s1', 's2']);
            mockRedis.mGet.mockResolvedValue([JSON.stringify(player1), null]);
            mockRedis.sRem.mockResolvedValue(1);

            await playerService.getPlayersInRoom('ABC123');

            expect(mockRedis.sRem).toHaveBeenCalledWith('room:ABC123:players', 's2');
            expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('orphaned'));
        });

        test('handles JSON parse errors', async () => {
            mockRedis.sMembers.mockResolvedValue(['s1', 's2']);
            mockRedis.mGet.mockResolvedValue(['invalid json', JSON.stringify({ sessionId: 's2', connectedAt: 1000 })]);
            mockRedis.sRem.mockResolvedValue(1);

            const players = await playerService.getPlayersInRoom('ABC123');

            expect(players).toHaveLength(1);
            expect(logger.error).toHaveBeenCalled();
        });

        test('logs slow queries', async () => {
            const player = { sessionId: 's1', connectedAt: 1000 };
            mockRedis.sMembers.mockImplementation(() =>
                new Promise(resolve => setTimeout(() => resolve(['s1']), 60))
            );
            mockRedis.mGet.mockResolvedValue([JSON.stringify(player)]);

            await playerService.getPlayersInRoom('ABC123');

            expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Slow getPlayersInRoom'));
        });
    });

    describe('removePlayer', () => {
        test('removes player from room and team sets', async () => {
            const player = { sessionId: 's1', roomCode: 'ABC123', team: 'red' };
            mockRedis.get.mockResolvedValue(JSON.stringify(player));
            mockRedis.sRem.mockResolvedValue(1);
            mockRedis.del.mockResolvedValue(1);

            await playerService.removePlayer('s1');

            expect(mockRedis.sRem).toHaveBeenCalledWith('room:ABC123:players', 's1');
            expect(mockRedis.sRem).toHaveBeenCalledWith('room:ABC123:team:red', 's1');
            expect(mockRedis.del).toHaveBeenCalledWith('player:s1');
        });

        test('handles player without team', async () => {
            const player = { sessionId: 's1', roomCode: 'ABC123', team: null };
            mockRedis.get.mockResolvedValue(JSON.stringify(player));
            mockRedis.sRem.mockResolvedValue(1);
            mockRedis.del.mockResolvedValue(1);

            await playerService.removePlayer('s1');

            expect(mockRedis.sRem).toHaveBeenCalledTimes(1); // Only room players
        });

        test('handles non-existent player gracefully', async () => {
            mockRedis.get.mockResolvedValue(null);

            await expect(playerService.removePlayer('nonexistent')).resolves.not.toThrow();
        });
    });

    describe('handleDisconnect', () => {
        test('marks player disconnected and schedules cleanup', async () => {
            const player = { sessionId: 's1', roomCode: 'ABC123', connected: true };
            mockRedis.get.mockResolvedValueOnce(JSON.stringify(player));
            mockRedis.get.mockResolvedValueOnce(JSON.stringify(player)); // For updatePlayer
            mockRedis.set.mockResolvedValue('OK');
            mockRedis.zAdd.mockResolvedValue(1);
            mockRedis.expire.mockResolvedValue(true);

            await playerService.handleDisconnect('s1');

            // Should schedule cleanup
            expect(mockRedis.zAdd).toHaveBeenCalledWith(
                'scheduled:player:cleanup',
                expect.objectContaining({ value: expect.stringContaining('s1') })
            );
            // Should set TTL on player key
            expect(mockRedis.expire).toHaveBeenCalledWith('player:s1', 600);
        });

        test('returns null for non-existent player', async () => {
            mockRedis.get.mockResolvedValue(null);

            const result = await playerService.handleDisconnect('nonexistent');

            expect(result).toBeNull();
        });
    });

    describe('validateReconnectionToken', () => {
        test('validates correct token', async () => {
            const tokenData = { sessionId: 's1', roomCode: 'ABC123' };
            mockRedis.get.mockResolvedValue(JSON.stringify(tokenData)); // token lookup
            mockRedis.del.mockResolvedValue(1);

            const result = await playerService.validateReconnectionToken('validtoken123', 's1');

            expect(result.valid).toBe(true);
            expect(mockRedis.del).toHaveBeenCalledWith('reconnect:token:validtoken123');
        });

        test('returns invalid for null token', async () => {
            const result = await playerService.validateReconnectionToken(null, 's1');

            expect(result.valid).toBe(false);
            expect(result.reason).toBe('INVALID_TOKEN_FORMAT');
        });

        test('returns invalid when token not found in Redis', async () => {
            mockRedis.get.mockResolvedValue(null);

            const result = await playerService.validateReconnectionToken('sometoken', 's1');

            expect(result.valid).toBe(false);
            expect(result.reason).toBe('TOKEN_EXPIRED_OR_INVALID');
        });

        test('returns invalid for session mismatch', async () => {
            const tokenData = { sessionId: 'other-session', roomCode: 'ABC123' };
            mockRedis.get.mockResolvedValue(JSON.stringify(tokenData));

            const result = await playerService.validateReconnectionToken('validtoken', 's1');

            expect(result.valid).toBe(false);
            expect(result.reason).toBe('SESSION_MISMATCH');
        });

        test('returns invalid for corrupted token data', async () => {
            mockRedis.get.mockResolvedValue('invalid-json');

            const result = await playerService.validateReconnectionToken('validtoken', 's1');

            expect(result.valid).toBe(false);
            expect(result.reason).toBe('TOKEN_CORRUPTED');
        });
    });

    describe('generateReconnectionToken', () => {
        test('generates token for existing player', async () => {
            const player = { sessionId: 's1', roomCode: 'ABC123', nickname: 'Test', team: 'red', role: 'clicker' };
            mockRedis.get.mockImplementation((key: string) => {
                if (key === 'player:s1') return Promise.resolve(JSON.stringify(player));
                return Promise.resolve(null);
            });
            // Lua script returns the new token (no existing token found)
            let capturedToken: string | null = null;
            mockRedis.eval.mockImplementation((_script: string, opts: { arguments: string[] }) => {
                capturedToken = opts.arguments[0];
                return Promise.resolve(capturedToken);
            });

            const token = await playerService.generateReconnectionToken('s1');

            expect(token).toMatch(/^[a-f0-9]{64}$/);
            expect(mockRedis.eval).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    keys: [`reconnect:session:s1`, expect.stringMatching(/^reconnect:token:[a-f0-9]{64}$/)],
                    arguments: [expect.stringMatching(/^[a-f0-9]{64}$/), expect.any(String), '300']
                })
            );
        });

        test('returns existing token if one exists', async () => {
            const player = { sessionId: 's1', roomCode: 'ABC123', nickname: 'Test', team: 'red', role: 'clicker' };
            const existingToken = 'a'.repeat(64);
            mockRedis.get.mockImplementation((key: string) => {
                if (key === 'player:s1') return Promise.resolve(JSON.stringify(player));
                return Promise.resolve(null);
            });
            // Lua script returns the existing token (found in Redis)
            mockRedis.eval.mockResolvedValue(existingToken);

            const token = await playerService.generateReconnectionToken('s1');

            expect(token).toBe(existingToken);
        });

        test('returns null for non-existent player', async () => {
            mockRedis.get.mockResolvedValue(null);

            const token = await playerService.generateReconnectionToken('nonexistent');

            expect(token).toBeNull();
        });
    });

    describe('validateReconnectionToken', () => {
        test('validates and consumes correct token', async () => {
            const tokenData = { sessionId: 's1', roomCode: 'ABC123' };
            mockRedis.get.mockResolvedValue(JSON.stringify(tokenData));
            mockRedis.del.mockResolvedValue(1);

            const result = await playerService.validateReconnectionToken('mytoken', 's1');

            expect(result.valid).toBe(true);
            expect(result.tokenData).toEqual(tokenData);
            expect(mockRedis.del).toHaveBeenCalledWith('reconnect:token:mytoken');
            expect(mockRedis.del).toHaveBeenCalledWith('reconnect:session:s1');
        });

        test('returns invalid for null token', async () => {
            const result = await playerService.validateReconnectionToken(null, 's1');

            expect(result.valid).toBe(false);
            expect(result.reason).toBe('INVALID_TOKEN_FORMAT');
        });

        test('returns invalid for non-string token', async () => {
            const result = await playerService.validateReconnectionToken(12345, 's1');

            expect(result.valid).toBe(false);
            expect(result.reason).toBe('INVALID_TOKEN_FORMAT');
        });

        test('returns invalid for expired/missing token', async () => {
            mockRedis.get.mockResolvedValue(null);

            const result = await playerService.validateReconnectionToken('expiredtoken', 's1');

            expect(result.valid).toBe(false);
            expect(result.reason).toBe('TOKEN_EXPIRED_OR_INVALID');
        });

        test('returns invalid for corrupted token data', async () => {
            mockRedis.get.mockResolvedValue('invalid json');

            const result = await playerService.validateReconnectionToken('mytoken', 's1');

            expect(result.valid).toBe(false);
            expect(result.reason).toBe('TOKEN_CORRUPTED');
        });

        test('returns invalid for session mismatch', async () => {
            const tokenData = { sessionId: 'different-session', roomCode: 'ABC123' };
            mockRedis.get.mockResolvedValue(JSON.stringify(tokenData));

            const result = await playerService.validateReconnectionToken('mytoken', 's1');

            expect(result.valid).toBe(false);
            expect(result.reason).toBe('SESSION_MISMATCH');
        });
    });

    describe('getExistingReconnectionToken', () => {
        test('returns existing token', async () => {
            mockRedis.get.mockResolvedValue('existingtoken123');

            const token = await playerService.getExistingReconnectionToken('s1');

            expect(token).toBe('existingtoken123');
            expect(mockRedis.get).toHaveBeenCalledWith('reconnect:session:s1');
        });

        test('returns null when no token exists', async () => {
            mockRedis.get.mockResolvedValue(null);

            const token = await playerService.getExistingReconnectionToken('s1');

            expect(token).toBeNull();
        });
    });

    describe('invalidateReconnectionToken', () => {
        test('invalidates existing token', async () => {
            mockRedis.get.mockResolvedValue('existingtoken');
            mockRedis.del.mockResolvedValue(1);

            await playerService.invalidateReconnectionToken('s1');

            expect(mockRedis.del).toHaveBeenCalledWith('reconnect:token:existingtoken');
            expect(mockRedis.del).toHaveBeenCalledWith('reconnect:session:s1');
        });

        test('does nothing when no token exists', async () => {
            mockRedis.get.mockResolvedValue(null);

            await playerService.invalidateReconnectionToken('s1');

            expect(mockRedis.del).not.toHaveBeenCalled();
        });
    });

    describe('setSocketMapping', () => {
        test('creates socket mapping for existing player', async () => {
            const player = { sessionId: 's1', nickname: 'Test' };
            mockRedis.get.mockResolvedValue(JSON.stringify(player));
            mockRedis.set.mockResolvedValue('OK');

            const result = await playerService.setSocketMapping('s1', 'socket-123', '192.168.1.1');

            expect(result).toBe(true);
            expect(mockRedis.set).toHaveBeenCalledWith(
                'session:s1:socket',
                'socket-123',
                { EX: 300 }
            );
        });

        test('updates player with lastIP', async () => {
            const player = { sessionId: 's1', nickname: 'Test' };
            mockRedis.get.mockResolvedValue(JSON.stringify(player));
            mockRedis.set.mockResolvedValue('OK');

            await playerService.setSocketMapping('s1', 'socket-123', '192.168.1.1');

            // updatePlayer now uses WATCH/MULTI, so the player set goes through multi().set()
            expect(mockRedis.watch).toHaveBeenCalledWith('player:s1');
            expect(mockRedis.multi).toHaveBeenCalled();
        });

        test('returns false for non-existent player', async () => {
            mockRedis.get.mockResolvedValue(null);

            const result = await playerService.setSocketMapping('nonexistent', 'socket-123');

            expect(result).toBe(false);
            expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('Skipping socket mapping'));
        });

        test('handles null clientIP', async () => {
            const player = { sessionId: 's1', nickname: 'Test' };
            mockRedis.get.mockResolvedValue(JSON.stringify(player));
            mockRedis.set.mockResolvedValue('OK');

            const result = await playerService.setSocketMapping('s1', 'socket-123', null);

            expect(result).toBe(true);
            // Should not call updatePlayer for IP
            expect(mockRedis.set).toHaveBeenCalledTimes(1); // Only socket mapping
        });
    });

    describe('getSocketId', () => {
        test('returns socket ID for session', async () => {
            mockRedis.get.mockResolvedValue('socket-123');

            const socketId = await playerService.getSocketId('s1');

            expect(socketId).toBe('socket-123');
            expect(mockRedis.get).toHaveBeenCalledWith('session:s1:socket');
        });

        test('returns null when no mapping exists', async () => {
            mockRedis.get.mockResolvedValue(null);

            const socketId = await playerService.getSocketId('s1');

            expect(socketId).toBeNull();
        });
    });

    describe('processScheduledCleanups', () => {
        test('processes due cleanups', async () => {
            const entry = JSON.stringify({ sessionId: 's1', roomCode: 'ABC123' });
            const player = { sessionId: 's1', connected: false, roomCode: 'ABC123' };

            mockRedis.zRangeByScore.mockResolvedValue([entry]);
            mockRedis.get.mockResolvedValue(JSON.stringify(player));
            mockRedis.sRem.mockResolvedValue(1);
            mockRedis.del.mockResolvedValue(1);
            mockRedis.zRem.mockResolvedValue(1);

            const count = await playerService.processScheduledCleanups();

            expect(count).toBe(1);
            expect(mockRedis.zRem).toHaveBeenCalledWith('scheduled:player:cleanup', entry);
        });

        test('skips reconnected players', async () => {
            const entry = JSON.stringify({ sessionId: 's1', roomCode: 'ABC123' });
            const player = { sessionId: 's1', connected: true, roomCode: 'ABC123' }; // Reconnected

            mockRedis.zRangeByScore.mockResolvedValue([entry]);
            mockRedis.get.mockResolvedValue(JSON.stringify(player));
            mockRedis.zRem.mockResolvedValue(1);

            const count = await playerService.processScheduledCleanups();

            expect(count).toBe(0);
            expect(mockRedis.del).not.toHaveBeenCalledWith('player:s1');
        });

        test('returns 0 when no cleanups due', async () => {
            mockRedis.zRangeByScore.mockResolvedValue([]);

            const count = await playerService.processScheduledCleanups();

            expect(count).toBe(0);
        });

        test('handles invalid cleanup entries', async () => {
            mockRedis.zRangeByScore.mockResolvedValue(['invalid json']);
            mockRedis.zRem.mockResolvedValue(1);

            const count = await playerService.processScheduledCleanups();

            expect(count).toBe(0);
            expect(logger.error).toHaveBeenCalledWith('Failed to parse cleanup entry:', expect.any(String));
            expect(mockRedis.zRem).toHaveBeenCalled();
        });

        test('handles errors gracefully', async () => {
            mockRedis.zRangeByScore.mockRejectedValue(new Error('Redis error'));

            const count = await playerService.processScheduledCleanups();

            expect(count).toBe(0);
            expect(logger.error).toHaveBeenCalledWith('Error processing scheduled cleanups:', 'Redis error');
        });
    });

    describe('startCleanupTask', () => {
        beforeEach(() => {
            jest.useFakeTimers();
        });

        afterEach(() => {
            playerService.stopCleanupTask();
            jest.useRealTimers();
        });

        test('starts cleanup interval', () => {
            playerService.startCleanupTask();

            expect(logger.info).toHaveBeenCalledWith('Player cleanup task started');
        });

        test('clears existing interval on restart', () => {
            playerService.startCleanupTask();
            playerService.startCleanupTask();

            expect(logger.info).toHaveBeenCalledTimes(2);
        });
    });

    describe('stopCleanupTask', () => {
        test('stops cleanup interval', () => {
            playerService.startCleanupTask();
            playerService.stopCleanupTask();

            expect(logger.info).toHaveBeenCalledWith('Player cleanup task stopped');
        });

        test('handles stop when not running', () => {
            playerService.stopCleanupTask();

            // Should not throw
        });
    });
});
