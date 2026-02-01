/**
 * Coverage Gap Tests
 *
 * Targets specific uncovered branches across multiple modules:
 * - sanitize.js: normalizeUnicode, localeCompare, localeIncludes
 * - chatHandlers.js: spectatorOnly chat, null teammates fallback
 * - timerService.js: addTime validation, initializeTimerService, getExpireCallback
 * - gameService.js: createGame lock branches, revealCard Lua result validation
 */

// ─── sanitize.js ────────────────────────────────────────────────────────────

const { normalizeUnicode, localeCompare, localeIncludes } = require('../utils/sanitize');

describe('sanitize - normalizeUnicode', () => {
    test('returns empty string for non-string input', () => {
        expect(normalizeUnicode(123)).toBe('');
        expect(normalizeUnicode(null)).toBe('');
        expect(normalizeUnicode(undefined)).toBe('');
    });

    test('lowercases with caseType=lower', () => {
        expect(normalizeUnicode('HELLO', 'lower')).toBe('hello');
    });

    test('uppercases with caseType=upper', () => {
        expect(normalizeUnicode('hello', 'upper')).toBe('HELLO');
    });

    test('no case change with caseType=none', () => {
        expect(normalizeUnicode('Hello', 'none')).toBe('Hello');
    });

    test('normalizes unicode to NFC', () => {
        // e + combining accent vs precomposed
        const decomposed = 'e\u0301'; // é decomposed
        const result = normalizeUnicode(decomposed, 'none');
        expect(result).toBe('\u00e9'); // é precomposed
    });
});

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
jest.mock('../socket/rateLimitHandler', () => ({
    createRateLimitedHandler: jest.fn((socket, eventName, handler) => handler)
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

    test('spectatorOnly message sends to spectators only', async () => {
        playerService.getPlayersInRoom.mockResolvedValue([
            { sessionId: 'sess-1', role: 'spectator', connected: true },
            { sessionId: 'sess-2', role: 'spectator', connected: true },
            { sessionId: 'sess-3', role: 'clicker', connected: true }
        ]);

        const handler = getHandler('chat:message');
        await handler({ text: 'spectator chat', teamOnly: false, spectatorOnly: true });

        // Should emit to 2 spectators, not the clicker
        expect(mockIo.to).toHaveBeenCalledWith('player:sess-1');
        expect(mockIo.to).toHaveBeenCalledWith('player:sess-2');
        expect(mockIo.to).not.toHaveBeenCalledWith('player:sess-3');
        expect(mockIo.to).toHaveBeenCalledTimes(2);
    });

    test('spectatorOnly with null getPlayersInRoom throws error', async () => {
        playerService.getPlayersInRoom.mockResolvedValue(null);

        const handler = getHandler('chat:message');
        // The error is caught by contextHandler, which emits chat:error
        await handler({ text: 'spectator chat', teamOnly: false, spectatorOnly: true });

        expect(mockSocket.emit).toHaveBeenCalledWith('chat:error', expect.objectContaining({
            message: expect.any(String)
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

    test('initializeTimerService sets callback and returns true', () => {
        const cb = jest.fn();
        const result = timerService.initializeTimerService(cb);
        expect(result).toBe(true);
    });

    test('getExpireCallback returns the set callback', () => {
        const cb = jest.fn();
        timerService.initializeTimerService(cb);
        expect(timerService.getExpireCallback()).toBe(cb);
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
