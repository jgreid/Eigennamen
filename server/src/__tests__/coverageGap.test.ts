/**
 * Coverage Gap Tests
 *
 * Targets specific uncovered branches across multiple modules:
 * - sanitize.js: normalizeUnicode, localeCompare, localeIncludes
 * - chatHandlers.js: spectatorOnly chat, null teammates fallback
 * - timerService.js: addTime validation, getExpireCallback
 * - gameService.js: createGame lock branches, revealCard Lua result validation
 */

// ─── sanitize.js ────────────────────────────────────────────────────────────

const { localeCompare, localeIncludes } = require('../utils/sanitize');

describe('sanitize - localeCompare', () => {
    test('case insensitive by default', () => {
        expect(localeCompare('abc', 'ABC')).toBe(0);
    });

    test('case sensitive when caseInsensitive=false', () => {
        const result = localeCompare('a', 'A', { caseInsensitive: false });
        expect(result).not.toBe(0);
    });

    test('handles non-string inputs', () => {
        expect(localeCompare(null, 'a')).toBeLessThan(0);
        expect(localeCompare('a', null)).toBeGreaterThan(0);
        expect(localeCompare(null, null)).toBe(0);
        expect(localeCompare(123, 'a')).toBeLessThan(0);
    });
});

describe('sanitize - localeIncludes', () => {
    test('case insensitive by default', () => {
        expect(localeIncludes('Hello World', 'hello')).toBe(true);
    });

    test('case sensitive when caseInsensitive=false', () => {
        expect(localeIncludes('Hello World', 'hello', false)).toBe(false);
        expect(localeIncludes('Hello World', 'Hello', false)).toBe(true);
    });

    test('returns false for non-string inputs', () => {
        expect(localeIncludes(null, 'a')).toBe(false);
        expect(localeIncludes('a', 123)).toBe(false);
    });
});

// ─── chatHandlers.js ────────────────────────────────────────────────────────

// Mock Redis before requiring services
const mockRedisInstance = {
    set: jest.fn().mockResolvedValue('OK'),
    get: jest.fn().mockResolvedValue(null),
    del: jest.fn().mockResolvedValue(1),
    keys: jest.fn().mockResolvedValue([]),
    exists: jest.fn().mockResolvedValue(0),
    eval: jest.fn().mockResolvedValue(null),
    ttl: jest.fn().mockResolvedValue(86400),
    multi: jest.fn().mockReturnValue({
        set: jest.fn().mockReturnThis(),
        del: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([])
    }),
    _storage: {}
};

jest.mock('../config/redis', () => ({
    getRedis: () => mockRedisInstance,
    getPubSubClients: () => ({
        pubClient: { publish: jest.fn().mockResolvedValue(1) },
        subClient: { subscribe: jest.fn().mockResolvedValue(), unsubscribe: jest.fn().mockResolvedValue() }
    })
}));

// Mock rate limit handler FIRST
const SAFE_ERROR_CODES_MOCK = ['RATE_LIMITED', 'ROOM_NOT_FOUND', 'ROOM_FULL', 'NOT_HOST', 'NOT_YOUR_TURN', 'GAME_OVER', 'INVALID_INPUT', 'CARD_ALREADY_REVEALED', 'NOT_SPYMASTER', 'NOT_CLICKER', 'NOT_AUTHORIZED', 'SESSION_EXPIRED', 'PLAYER_NOT_FOUND', 'GAME_IN_PROGRESS', 'VALIDATION_ERROR', 'CANNOT_SWITCH_TEAM_DURING_TURN', 'CANNOT_CHANGE_ROLE_DURING_TURN', 'SPYMASTER_CANNOT_CHANGE_TEAM', 'GAME_NOT_STARTED'];
jest.mock('../socket/rateLimitHandler', () => ({
    createRateLimitedHandler: jest.fn((socket, eventName, handler) => { return async (data) => { try { return await handler(data); } catch (error) { const errorEvent = `${eventName.split(':')[0]}:error`; const code = error.code || 'SERVER_ERROR'; const isSafe = SAFE_ERROR_CODES_MOCK.includes(code); socket.emit(errorEvent, { code, message: isSafe ? (error.message || 'An unexpected error occurred') : 'An unexpected error occurred' }); } }; })
}));

jest.mock('../services/playerService');
// gameService is NOT mocked here because we need the real module for revealCard tests below.
// chatHandlers tests work without it because we mock playerContext directly.
jest.mock('../utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));

// Mock playerContext to provide controlled ctx
jest.mock('../socket/playerContext', () => ({
    getPlayerContext: jest.fn(),
    syncSocketRooms: jest.fn()
}));

const playerService = require('../services/playerService');
const { getPlayerContext } = require('../socket/playerContext');

describe('chatHandlers - spectatorOnly and null teammates', () => {
    let mockSocket;
    let mockIo;

    beforeEach(() => {
        jest.clearAllMocks();

        mockSocket = {
            id: 'socket-1',
            sessionId: 'sess-1',
            roomCode: 'ROOM01',
            emit: jest.fn(),
            on: jest.fn(),
            join: jest.fn(),
            leave: jest.fn()
        };

        mockIo = {
            to: jest.fn().mockReturnThis(),
            emit: jest.fn()
        };

        // Default context for spectator
        getPlayerContext.mockResolvedValue({
            player: {
                sessionId: 'sess-1',
                roomCode: 'ROOM01',
                nickname: 'Spectator1',
                team: null,
                role: 'spectator'
            },
            game: null,
            roomCode: 'ROOM01'
        });

        const chatHandlers = require('../socket/handlers/chatHandlers');
        chatHandlers(mockIo, mockSocket);
    });

    function getHandler(eventName) {
        const call = mockSocket.on.mock.calls.find(c => c[0] === eventName);
        return call ? call[1] : null;
    }

    test('spectatorOnly message sends to spectators socket room', async () => {
        const handler = getHandler('chat:message');
        await handler({ text: 'spectator chat', teamOnly: false, spectatorOnly: true });

        // Should emit to the spectators socket room (not individual player rooms)
        expect(mockIo.to).toHaveBeenCalledWith('spectators:ROOM01');
        expect(mockIo.to).toHaveBeenCalledTimes(1);
        expect(mockIo.emit).toHaveBeenCalledWith('chat:message', expect.objectContaining({
            text: 'spectator chat',
            spectatorOnly: true
        }));
    });

    test('teamOnly with null getTeamMembers falls back to socket.emit', async () => {
        getPlayerContext.mockResolvedValue({
            player: {
                sessionId: 'sess-1',
                roomCode: 'ROOM01',
                nickname: 'Player1',
                team: 'red',
                role: 'clicker'
            },
            game: null,
            roomCode: 'ROOM01'
        });

        playerService.getTeamMembers.mockResolvedValue(null);

        const handler = getHandler('chat:message');
        await handler({ text: 'team msg', teamOnly: true });

        // Should fallback to socket.emit
        expect(mockSocket.emit).toHaveBeenCalledWith('chat:message', expect.objectContaining({
            text: 'team msg'
        }));
    });
});

// ─── timerService.js ────────────────────────────────────────────────────────

// timerService is already mocked via redis mock from the module-level mock
// We need a separate describe that loads timerService with its own redis mock

describe('timerService - addTime validation and init', () => {
    let timerService;

    beforeAll(() => {
        // timerService already required redis mock from the top-level jest.mock
        timerService = require('../services/timerService');
    });

    test('addTime throws for empty string roomCode', async () => {
        await expect(timerService.addTime('', 30, jest.fn()))
            .rejects.toThrow('Invalid roomCode');
    });

    test('addTime throws for non-string roomCode', async () => {
        await expect(timerService.addTime(123, 30, jest.fn()))
            .rejects.toThrow('Invalid roomCode');
    });

    test('addTime throws for NaN secondsToAdd', async () => {
        await expect(timerService.addTime('ROOM1', NaN, jest.fn()))
            .rejects.toThrow('Invalid secondsToAdd');
    });

    test('addTime throws for negative secondsToAdd', async () => {
        await expect(timerService.addTime('ROOM1', -5, jest.fn()))
            .rejects.toThrow('Invalid secondsToAdd');
    });

    test('addTime throws for secondsToAdd exceeding MAX_TURN_SECONDS', async () => {
        await expect(timerService.addTime('ROOM1', 999999, jest.fn()))
            .rejects.toThrow('cannot exceed');
    });

});

// ─── gameService.js - revealCard Lua result validation ──────────────────────

describe('gameService - revealCard Lua result validation', () => {
    const gameService = require('../services/gameService');

    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('revealCardOptimized throws on null Lua result', async () => {
        mockRedisInstance.eval.mockResolvedValue(null);

        await expect(gameService.revealCardOptimized('ROOM1', 0, 'TestPlayer'))
            .rejects.toThrow(/Invalid Lua script result|empty or non-string/);
    });

    test('revealCardOptimized throws on non-string Lua result', async () => {
        mockRedisInstance.eval.mockResolvedValue(42);

        await expect(gameService.revealCardOptimized('ROOM1', 0, 'TestPlayer'))
            .rejects.toThrow(/Invalid Lua script result|empty or non-string/);
    });

    test('revealCardOptimized throws on unparseable Lua result', async () => {
        mockRedisInstance.eval.mockResolvedValue('not-json{{{');

        await expect(gameService.revealCardOptimized('ROOM1', 0, 'TestPlayer'))
            .rejects.toThrow(/parse/i);
    });

    test('revealCardOptimized throws on non-object Lua result', async () => {
        mockRedisInstance.eval.mockResolvedValue('"just a string"');

        await expect(gameService.revealCardOptimized('ROOM1', 0, 'TestPlayer'))
            .rejects.toThrow(/not an object/);
    });
});
