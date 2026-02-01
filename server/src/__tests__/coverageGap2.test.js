/**
 * Coverage Gap Tests - Round 2
 * Targets uncovered branches in GameError, playerService, adminRoutes, app.js, socket/index.js
 */

// ─── GameError tests ───────────────────────────────────────────────────────────

describe('GameError classes', () => {
    let _GameError, RoomError, _PlayerError, GameStateError, _ValidationError,
        _RateLimitError, ServerError, _WordListError, sanitizeErrorForClient;

    beforeEach(() => {
        jest.resetModules();
        ({
            GameError: _GameError, RoomError, PlayerError: _PlayerError, GameStateError, ValidationError: _ValidationError,
            RateLimitError: _RateLimitError, ServerError, WordListError: _WordListError, sanitizeErrorForClient
        } = require('../errors/GameError'));
    });

    test('RoomError.expired creates error with ROOM_EXPIRED code', () => {
        const err = RoomError.expired('ABC123');
        expect(err.code).toBe('ROOM_EXPIRED');
        expect(err.details).toEqual({ roomCode: 'ABC123' });
        expect(err.name).toBe('RoomError');
    });

    test('GameStateError.invalidState creates error with expected/actual state', () => {
        const err = GameStateError.invalidState('ABC', 'playing', 'waiting');
        expect(err.code).toBe('SERVER_ERROR');
        expect(err.message).toContain('expected playing');
        expect(err.message).toContain('got waiting');
        expect(err.details).toEqual({ roomCode: 'ABC', expectedState: 'playing', actualState: 'waiting' });
    });

    test('ServerError.redisError creates error with operation details', () => {
        const origErr = new Error('connection refused');
        const err = ServerError.redisError('SET', 'ABC123', origErr);
        expect(err.code).toBe('SERVER_ERROR');
        expect(err.message).toContain('SET');
        expect(err.details.roomCode).toBe('ABC123');
        expect(err.details.originalError).toBe('connection refused');
        expect(err.details.retryable).toBe(true);
    });

    test('ServerError.redisError handles null originalError', () => {
        const err = ServerError.redisError('GET', null, null);
        expect(err.details.originalError).toBeUndefined();
    });

    test('ServerError.lockAcquisitionFailed creates error with lock info', () => {
        const err = ServerError.lockAcquisitionFailed('host-transfer', 'ABC123');
        expect(err.code).toBe('SERVER_ERROR');
        expect(err.message).toContain('host-transfer');
        expect(err.details.roomCode).toBe('ABC123');
        expect(err.details.lockType).toBe('host-transfer');
        expect(err.details.retryable).toBe(true);
    });

    test('sanitizeErrorForClient returns generic message for unsafe codes', () => {
        const result = sanitizeErrorForClient({ code: 'SERVER_ERROR', message: 'secret info' });
        expect(result.message).toBe('An unexpected error occurred');
        expect(result.code).toBe('SERVER_ERROR');
    });

    test('sanitizeErrorForClient returns actual message for safe codes', () => {
        const result = sanitizeErrorForClient({ code: 'ROOM_NOT_FOUND', message: 'Room not found' });
        expect(result.message).toBe('Room not found');
    });

    test('sanitizeErrorForClient defaults code to SERVER_ERROR when missing', () => {
        const result = sanitizeErrorForClient({ message: 'oops' });
        expect(result.code).toBe('SERVER_ERROR');
    });

    test('sanitizeErrorForClient uses fallback message for safe code with no message', () => {
        const result = sanitizeErrorForClient({ code: 'ROOM_NOT_FOUND' });
        expect(result.message).toBe('An unexpected error occurred');
    });
});

// ─── playerService: validateReconnectToken ──────────────────────────────────────

describe('playerService.validateReconnectToken', () => {
    let playerService;
    let mockRedis;

    beforeEach(() => {
        jest.resetModules();

        mockRedis = {
            get: jest.fn(),
            set: jest.fn(),
            del: jest.fn(),
            sAdd: jest.fn(),
            sRem: jest.fn(),
            sMembers: jest.fn(),
            sCard: jest.fn(),
            mGet: jest.fn(),
            expire: jest.fn(),
            eval: jest.fn(),
            zAdd: jest.fn(),
            zRem: jest.fn(),
            zRangeByScore: jest.fn(),
        };

        jest.mock('../config/redis', () => ({
            getRedis: jest.fn(() => mockRedis),
        }));

        jest.mock('../utils/logger', () => ({
            debug: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
        }));

        jest.mock('../utils/timeout', () => ({
            withTimeout: jest.fn((promise) => promise),
            TIMEOUTS: { REDIS_OPERATION: 5000 },
        }));

        jest.mock('../config/constants', () => ({
            REDIS_TTL: { PLAYER: 86400, SESSION_SOCKET: 300, DISCONNECTED_PLAYER: 600 },
            ERROR_CODES: { SERVER_ERROR: 'SERVER_ERROR', INVALID_INPUT: 'INVALID_INPUT' },
            SESSION_SECURITY: { RECONNECTION_TOKEN_LENGTH: 32, RECONNECTION_TOKEN_TTL_SECONDS: 300 },
            VALIDATION: { NICKNAME_MIN_LENGTH: 1, NICKNAME_MAX_LENGTH: 30 },
            PLAYER_CLEANUP: { INTERVAL_MS: 60000, BATCH_SIZE: 50 },
        }));

        playerService = require('../services/playerService');
    });

    test('no token + connected player returns true', async () => {
        mockRedis.get.mockResolvedValue(JSON.stringify({
            sessionId: 'sess1', connected: true, roomCode: 'ABC',
            nickname: 'P1', team: null, role: 'spectator', isHost: false,
        }));

        const result = await playerService.validateReconnectToken('sess1', null);
        expect(result).toBe(true);
    });

    test('no token + disconnected player returns false', async () => {
        mockRedis.get.mockResolvedValue(JSON.stringify({
            sessionId: 'sess1', connected: false, roomCode: 'ABC',
            nickname: 'P1', team: null, role: 'spectator', isHost: false,
        }));

        const result = await playerService.validateReconnectToken('sess1', null);
        expect(result).toBe(false);
    });

    test('no token + no player returns false', async () => {
        mockRedis.get.mockResolvedValue(null);

        const result = await playerService.validateReconnectToken('sess1', null);
        expect(result).toBe(false);
    });

    test('token provided but no stored token returns false', async () => {
        // First call: getPlayer, second call: get reconnect token
        mockRedis.get.mockResolvedValue(null);

        const result = await playerService.validateReconnectToken('sess1', 'sometoken');
        expect(result).toBe(false);
    });

    test('token length mismatch returns false', async () => {
        mockRedis.get.mockResolvedValue('shorttoken');

        const result = await playerService.validateReconnectToken('sess1', 'muchlongertoken12345');
        expect(result).toBe(false);
    });

    test('valid matching token returns true', async () => {
        const token = 'abcdef1234567890abcdef1234567890';
        mockRedis.get.mockResolvedValue(token);

        const result = await playerService.validateReconnectToken('sess1', token);
        expect(result).toBe(true);
    });

    test('invalid token (same length) returns false', async () => {
        const stored = 'abcdef1234567890abcdef1234567890';
        const provided = 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
        mockRedis.get.mockResolvedValue(stored);

        const result = await playerService.validateReconnectToken('sess1', provided);
        expect(result).toBe(false);
    });
});

// ─── playerService: atomicHostTransfer ──────────────────────────────────────────

describe('playerService.atomicHostTransfer', () => {
    let playerService;
    let mockRedis;

    beforeEach(() => {
        jest.resetModules();

        mockRedis = {
            get: jest.fn(),
            set: jest.fn(),
            del: jest.fn(),
            sAdd: jest.fn(),
            sRem: jest.fn(),
            sMembers: jest.fn(),
            sCard: jest.fn(),
            mGet: jest.fn(),
            expire: jest.fn(),
            eval: jest.fn(),
            zAdd: jest.fn(),
            zRem: jest.fn(),
            zRangeByScore: jest.fn(),
        };

        jest.mock('../config/redis', () => ({
            getRedis: jest.fn(() => mockRedis),
        }));

        jest.mock('../utils/logger', () => ({
            debug: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
        }));

        jest.mock('../utils/timeout', () => ({
            withTimeout: jest.fn((promise) => promise),
            TIMEOUTS: { REDIS_OPERATION: 5000 },
        }));

        jest.mock('../config/constants', () => ({
            REDIS_TTL: { PLAYER: 86400, SESSION_SOCKET: 300, DISCONNECTED_PLAYER: 600 },
            ERROR_CODES: { SERVER_ERROR: 'SERVER_ERROR', INVALID_INPUT: 'INVALID_INPUT' },
            SESSION_SECURITY: { RECONNECTION_TOKEN_LENGTH: 32, RECONNECTION_TOKEN_TTL_SECONDS: 300 },
            VALIDATION: { NICKNAME_MIN_LENGTH: 1, NICKNAME_MAX_LENGTH: 30 },
            PLAYER_CLEANUP: { INTERVAL_MS: 60000, BATCH_SIZE: 50 },
        }));

        playerService = require('../services/playerService');
    });

    test('null result returns SCRIPT_FAILED', async () => {
        mockRedis.eval.mockResolvedValue(null);

        const result = await playerService.atomicHostTransfer('old', 'new', 'ABC');
        expect(result).toEqual({ success: false, reason: 'SCRIPT_FAILED' });
    });

    test('successful transfer returns parsed result', async () => {
        mockRedis.eval.mockResolvedValue(JSON.stringify({
            success: true,
            oldHost: { sessionId: 'old', isHost: false },
            newHost: { sessionId: 'new', isHost: true },
        }));

        const result = await playerService.atomicHostTransfer('old', 'new', 'ABC');
        expect(result.success).toBe(true);
    });

    test('failed transfer returns parsed result with reason', async () => {
        mockRedis.eval.mockResolvedValue(JSON.stringify({
            success: false,
            reason: 'OLD_HOST_NOT_FOUND',
        }));

        const result = await playerService.atomicHostTransfer('old', 'new', 'ABC');
        expect(result.success).toBe(false);
        expect(result.reason).toBe('OLD_HOST_NOT_FOUND');
    });

    test('script error returns SCRIPT_ERROR', async () => {
        mockRedis.eval.mockRejectedValue(new Error('Redis down'));

        const result = await playerService.atomicHostTransfer('old', 'new', 'ABC');
        expect(result).toEqual({ success: false, reason: 'SCRIPT_ERROR' });
    });
});

// ─── playerService: getSpectators & getRoomStats ────────────────────────────────

describe('playerService spectator and stats functions', () => {
    let playerService;
    let mockRedis;

    beforeEach(() => {
        jest.resetModules();

        mockRedis = {
            get: jest.fn(),
            set: jest.fn(),
            del: jest.fn(),
            sAdd: jest.fn(),
            sRem: jest.fn(),
            sMembers: jest.fn().mockResolvedValue([]),
            sCard: jest.fn(),
            mGet: jest.fn().mockResolvedValue([]),
            expire: jest.fn(),
            eval: jest.fn(),
            zAdd: jest.fn(),
            zRem: jest.fn(),
            zRangeByScore: jest.fn(),
        };

        jest.mock('../config/redis', () => ({
            getRedis: jest.fn(() => mockRedis),
        }));

        jest.mock('../utils/logger', () => ({
            debug: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
        }));

        jest.mock('../utils/timeout', () => ({
            withTimeout: jest.fn((promise) => promise),
            TIMEOUTS: { REDIS_OPERATION: 5000 },
        }));

        jest.mock('../config/constants', () => ({
            REDIS_TTL: { PLAYER: 86400, SESSION_SOCKET: 300, DISCONNECTED_PLAYER: 600 },
            ERROR_CODES: { SERVER_ERROR: 'SERVER_ERROR', INVALID_INPUT: 'INVALID_INPUT' },
            SESSION_SECURITY: { RECONNECTION_TOKEN_LENGTH: 32, RECONNECTION_TOKEN_TTL_SECONDS: 300 },
            VALIDATION: { NICKNAME_MIN_LENGTH: 1, NICKNAME_MAX_LENGTH: 30 },
            PLAYER_CLEANUP: { INTERVAL_MS: 60000, BATCH_SIZE: 50 },
        }));

        playerService = require('../services/playerService');
    });

    test('getSpectators returns connected spectators', async () => {
        mockRedis.sMembers.mockResolvedValue(['s1', 's2', 's3']);
        mockRedis.mGet.mockResolvedValue([
            JSON.stringify({ sessionId: 's1', nickname: 'A', team: 'red', role: 'spectator', connected: true, roomCode: 'R1', connectedAt: 1 }),
            JSON.stringify({ sessionId: 's2', nickname: 'B', team: null, role: 'clicker', connected: true, roomCode: 'R1', connectedAt: 2 }),
            JSON.stringify({ sessionId: 's3', nickname: 'C', team: null, role: 'spectator', connected: false, roomCode: 'R1', connectedAt: 3 }),
        ]);

        const result = await playerService.getSpectators('R1');
        expect(result.count).toBe(1);
        expect(result.spectators[0].nickname).toBe('A');
    });

    test('getSpectatorCount returns count', async () => {
        mockRedis.sMembers.mockResolvedValue(['s1']);
        mockRedis.mGet.mockResolvedValue([
            JSON.stringify({ sessionId: 's1', nickname: 'A', team: null, role: 'spectator', connected: true, roomCode: 'R1', connectedAt: 1 }),
        ]);

        const count = await playerService.getSpectatorCount('R1');
        expect(count).toBe(1);
    });

    test('getRoomStats returns correct breakdown', async () => {
        mockRedis.sMembers.mockResolvedValue(['s1', 's2', 's3']);
        mockRedis.mGet.mockResolvedValue([
            JSON.stringify({ sessionId: 's1', nickname: 'Spy', team: 'red', role: 'spymaster', connected: true, roomCode: 'R1', connectedAt: 1 }),
            JSON.stringify({ sessionId: 's2', nickname: 'Click', team: 'blue', role: 'clicker', connected: true, roomCode: 'R1', connectedAt: 2 }),
            JSON.stringify({ sessionId: 's3', nickname: 'Spec', team: null, role: 'spectator', connected: true, roomCode: 'R1', connectedAt: 3 }),
        ]);

        const stats = await playerService.getRoomStats('R1');
        expect(stats.totalPlayers).toBe(3);
        expect(stats.spectatorCount).toBe(1);
        expect(stats.teams.red.spymaster).toBe('Spy');
        expect(stats.teams.blue.clicker).toBe('Click');
        expect(stats.teams.red.total).toBe(1);
        expect(stats.teams.blue.total).toBe(1);
    });
});

// ─── playerService: setTeam / setRole edge cases ────────────────────────────────

describe('playerService setTeam/setRole uncovered branches', () => {
    let playerService;
    let mockRedis;

    beforeEach(() => {
        jest.resetModules();

        mockRedis = {
            get: jest.fn(),
            set: jest.fn(),
            del: jest.fn(),
            sAdd: jest.fn(),
            sRem: jest.fn(),
            sMembers: jest.fn().mockResolvedValue([]),
            sCard: jest.fn(),
            mGet: jest.fn().mockResolvedValue([]),
            expire: jest.fn(),
            eval: jest.fn(),
            zAdd: jest.fn(),
            zRem: jest.fn(),
            zRangeByScore: jest.fn(),
        };

        jest.mock('../config/redis', () => ({
            getRedis: jest.fn(() => mockRedis),
        }));

        jest.mock('../utils/logger', () => ({
            debug: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
        }));

        jest.mock('../utils/timeout', () => ({
            withTimeout: jest.fn((promise) => promise),
            TIMEOUTS: { REDIS_OPERATION: 5000 },
        }));

        jest.mock('../config/constants', () => ({
            REDIS_TTL: { PLAYER: 86400, SESSION_SOCKET: 300, DISCONNECTED_PLAYER: 600 },
            ERROR_CODES: { SERVER_ERROR: 'SERVER_ERROR', INVALID_INPUT: 'INVALID_INPUT' },
            SESSION_SECURITY: { RECONNECTION_TOKEN_LENGTH: 32, RECONNECTION_TOKEN_TTL_SECONDS: 300 },
            VALIDATION: { NICKNAME_MIN_LENGTH: 1, NICKNAME_MAX_LENGTH: 30 },
            PLAYER_CLEANUP: { INTERVAL_MS: 60000, BATCH_SIZE: 50 },
        }));

        playerService = require('../services/playerService');
    });

    test('setTeam throws when player has no roomCode', async () => {
        mockRedis.get.mockResolvedValue(JSON.stringify({
            sessionId: 's1', roomCode: null, nickname: 'P', team: null, role: 'spectator',
        }));

        await expect(playerService.setTeam('s1', 'red')).rejects.toThrow('Player is not associated with a room');
    });

    test('setRole throws when player has no roomCode', async () => {
        mockRedis.get.mockResolvedValue(JSON.stringify({
            sessionId: 's1', roomCode: null, nickname: 'P', team: 'red', role: 'spectator',
        }));

        await expect(playerService.setRole('s1', 'spymaster')).rejects.toThrow('Player is not associated with a room');
    });

    test('setRole with NO_TEAM reason throws ValidationError', async () => {
        mockRedis.get.mockResolvedValue(JSON.stringify({
            sessionId: 's1', roomCode: 'ABC', nickname: 'P', team: null, role: 'spectator',
        }));
        mockRedis.eval.mockResolvedValue(JSON.stringify({ success: false, reason: 'NO_TEAM' }));

        await expect(playerService.setRole('s1', 'spymaster')).rejects.toThrow('Must join a team');
    });

    test('setRole with unknown failure throws ServerError', async () => {
        mockRedis.get.mockResolvedValue(JSON.stringify({
            sessionId: 's1', roomCode: 'ABC', nickname: 'P', team: 'red', role: 'spectator',
        }));
        mockRedis.eval.mockResolvedValue(JSON.stringify({ success: false, reason: 'UNKNOWN' }));

        await expect(playerService.setRole('s1', 'spymaster')).rejects.toThrow('Failed to update player role');
    });

    test('setRole handles JSON parse error', async () => {
        mockRedis.get.mockResolvedValue(JSON.stringify({
            sessionId: 's1', roomCode: 'ABC', nickname: 'P', team: 'red', role: 'spectator',
        }));
        mockRedis.eval.mockResolvedValue('not-json{{{');

        await expect(playerService.setRole('s1', 'spymaster')).rejects.toThrow('Failed to update player role');
    });
});
