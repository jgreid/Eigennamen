/**
 * Unit tests for contextHandler.js
 *
 * Tests the factory functions that combine rate limiting, input validation,
 * and player context building into unified handler wrappers.
 */

jest.mock('../socket/playerContext');
jest.mock('../socket/rateLimitHandler', () => ({
    // Bug #11 fix: Updated mock to simulate real rateLimitHandler behavior
    // Real rateLimitHandler catches errors from handler and emits error events + ACK
    createRateLimitedHandler: jest.fn()
}));
jest.mock('../middleware/validation', () => ({
    validateInput: jest.fn((schema, data) => data)
}));
jest.mock('../utils/logger', () => ({
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn()
}));
jest.mock('../errors/GameError', () => {
    const actual = jest.requireActual('../errors/GameError');
    return {
        ...actual,
        sanitizeErrorForClient: jest.fn(err => ({
            code: err.code || 'SERVER_ERROR',
            message: err.message || 'An unexpected error occurred'
        }))
    };
});

const { getPlayerContext, syncSocketRooms } = require('../socket/playerContext');
const { createRateLimitedHandler } = require('../socket/rateLimitHandler');
const { validateInput } = require('../middleware/validation');
const {
    createContextHandler,
    createRoomHandler,
    createHostHandler,
    createGameHandler
} = require('../socket/contextHandler');

describe('contextHandler', () => {
    let mockSocket;

    beforeEach(() => {
        jest.clearAllMocks();
        mockSocket = {
            id: 'socket-1',
            sessionId: 'session-1',
            roomCode: 'ROOM01',
            emit: jest.fn(),
            join: jest.fn(),
            leave: jest.fn()
        };
        // Bug #11 fix: Mock rateLimitHandler to simulate real behavior
        // Real rateLimitHandler catches errors from handler and emits error events + ACK
        const SAFE_CODES = ['RATE_LIMITED', 'ROOM_NOT_FOUND', 'ROOM_FULL', 'NOT_HOST', 'NOT_YOUR_TURN', 'GAME_OVER', 'INVALID_INPUT', 'CARD_ALREADY_REVEALED', 'NOT_SPYMASTER', 'NOT_CLICKER', 'NOT_AUTHORIZED', 'SESSION_EXPIRED', 'PLAYER_NOT_FOUND', 'GAME_IN_PROGRESS', 'NO_CLUE', 'CANNOT_SWITCH_TEAM_DURING_TURN', 'CANNOT_CHANGE_ROLE_DURING_TURN', 'SPYMASTER_CANNOT_CHANGE_TEAM', 'GAME_NOT_STARTED'];
        createRateLimitedHandler.mockImplementation((socket, eventName, handler) => {
            return async (data) => {
                try {
                    return await handler(data);
                } catch (error) {
                    const errorEvent = `${eventName.split(':')[0]}:error`;
                    const code = error.code || 'SERVER_ERROR';
                    const isSafe = SAFE_CODES.includes(code);
                    socket.emit(errorEvent, {
                        code,
                        message: isSafe ? (error.message || 'An unexpected error occurred') : 'An unexpected error occurred'
                    });
                    // In real code, this would also call ackCallback({ error: true })
                }
            };
        });
        syncSocketRooms.mockImplementation(() => {});
    });

    describe('createContextHandler', () => {
        it('validates input with schema, builds context, and calls handler', async () => {
            const schema = { parse: jest.fn() };
            const ctx = {
                sessionId: 'session-1',
                roomCode: 'ROOM01',
                player: { sessionId: 'session-1', team: 'red', role: 'clicker' },
                game: null,
                isInRoom: true
            };
            getPlayerContext.mockResolvedValue(ctx);
            validateInput.mockReturnValue({ team: 'blue' });

            const handler = jest.fn().mockResolvedValue({ player: { team: 'blue', roomCode: 'ROOM01' } });
            const wrappedFn = createContextHandler(
                mockSocket, 'player:setTeam', schema,
                { requireRoom: true }, handler
            );

            await wrappedFn({ team: 'blue' });

            expect(validateInput).toHaveBeenCalledWith(schema, { team: 'blue' });
            expect(getPlayerContext).toHaveBeenCalledWith(mockSocket, { requireRoom: true });
            expect(handler).toHaveBeenCalledWith(ctx, { team: 'blue' });
        });

        it('calls syncSocketRooms when handler returns player', async () => {
            const previousPlayer = { sessionId: 'session-1', team: 'red', role: 'spectator', roomCode: 'ROOM01' };
            const ctx = {
                sessionId: 'session-1',
                roomCode: 'ROOM01',
                player: previousPlayer,
                game: null,
                isInRoom: true
            };
            getPlayerContext.mockResolvedValue(ctx);

            const updatedPlayer = { sessionId: 'session-1', team: 'blue', role: 'spectator', roomCode: 'ROOM01' };
            const handler = jest.fn().mockResolvedValue({ player: updatedPlayer });

            const wrappedFn = createContextHandler(
                mockSocket, 'player:setTeam', null,
                { requireRoom: true }, handler
            );
            await wrappedFn({});

            expect(syncSocketRooms).toHaveBeenCalledWith(
                mockSocket,
                updatedPlayer,
                previousPlayer
            );
        });

        it('does not call syncSocketRooms when handler returns no player', async () => {
            const ctx = {
                sessionId: 'session-1',
                roomCode: 'ROOM01',
                player: { sessionId: 'session-1' },
                game: null,
                isInRoom: true
            };
            getPlayerContext.mockResolvedValue(ctx);
            const handler = jest.fn().mockResolvedValue(undefined);

            const wrappedFn = createContextHandler(
                mockSocket, 'room:leave', null,
                { requireRoom: true }, handler
            );
            await wrappedFn({});

            expect(syncSocketRooms).not.toHaveBeenCalled();
        });

        it('emits prefixed error event on handler failure', async () => {
            getPlayerContext.mockResolvedValue({
                sessionId: 'session-1', roomCode: 'ROOM01',
                player: { sessionId: 'session-1' }, game: null, isInRoom: true
            });
            const error = new Error('Something broke');
            error.code = 'SERVER_ERROR';
            const handler = jest.fn().mockRejectedValue(error);

            const wrappedFn = createContextHandler(
                mockSocket, 'game:reveal', null,
                { requireRoom: true }, handler
            );
            await wrappedFn({});

            // Bug #11 fix: Error event is now emitted by rateLimitHandler mock
            // Error event should use the prefix of the event name
            // SERVER_ERROR is not in SAFE_ERROR_CODES, so message is sanitized
            expect(mockSocket.emit).toHaveBeenCalledWith('game:error', expect.objectContaining({
                code: 'SERVER_ERROR',
                message: 'An unexpected error occurred'
            }));
        });

        it('emits error on context validation failure', async () => {
            const ctxError = new Error('You must be in a room');
            ctxError.code = 'ROOM_NOT_FOUND';
            getPlayerContext.mockRejectedValue(ctxError);

            const handler = jest.fn();
            const wrappedFn = createContextHandler(
                mockSocket, 'player:setTeam', null,
                { requireRoom: true }, handler
            );
            await wrappedFn({});

            expect(handler).not.toHaveBeenCalled();
            // Bug #11 fix: Error event is now emitted by rateLimitHandler mock
            expect(mockSocket.emit).toHaveBeenCalledWith('player:error', expect.objectContaining({
                code: 'ROOM_NOT_FOUND',
                message: 'You must be in a room'
            }));
        });

        it('emits error on schema validation failure', async () => {
            const valError = { code: 'INVALID_INPUT', message: 'bad data' };
            validateInput.mockImplementation(() => { throw valError; });

            const handler = jest.fn();
            const wrappedFn = createContextHandler(
                mockSocket, 'player:setTeam', {},
                { requireRoom: true }, handler
            );
            await wrappedFn({ team: 'invalid' });

            expect(handler).not.toHaveBeenCalled();
            expect(mockSocket.emit).toHaveBeenCalledWith('player:error', expect.any(Object));
        });

        it('skips schema validation when schema is null', async () => {
            getPlayerContext.mockResolvedValue({
                sessionId: 'session-1', roomCode: 'ROOM01',
                player: { sessionId: 'session-1' }, game: null, isInRoom: true
            });
            const handler = jest.fn().mockResolvedValue(undefined);

            const wrappedFn = createContextHandler(
                mockSocket, 'room:leave', null,
                { requireRoom: true }, handler
            );
            await wrappedFn({ arbitrary: 'data' });

            expect(validateInput).not.toHaveBeenCalled();
            // Raw data passed through as-is
            expect(handler).toHaveBeenCalledWith(expect.any(Object), { arbitrary: 'data' });
        });

        it('passes previousPlayer as snapshot (spread copy) to syncSocketRooms', async () => {
            const playerObj = { sessionId: 's1', team: 'red', role: 'spectator', roomCode: 'ROOM01' };
            getPlayerContext.mockResolvedValue({
                sessionId: 's1', roomCode: 'ROOM01',
                player: playerObj, game: null, isInRoom: true
            });

            const handler = jest.fn().mockImplementation(async (ctx) => {
                // Mutate the original player in handler (simulating what might happen)
                ctx.player.team = 'blue';
                return { player: { ...ctx.player } };
            });

            const wrappedFn = createContextHandler(
                mockSocket, 'player:setTeam', null,
                { requireRoom: true }, handler
            );
            await wrappedFn({});

            // previousPlayer should be the snapshot taken BEFORE handler ran
            const [, , previousArg] = syncSocketRooms.mock.calls[0];
            expect(previousArg.team).toBe('red');
        });
    });

    describe('createRoomHandler', () => {
        it('passes requireRoom: true to context options', async () => {
            getPlayerContext.mockResolvedValue({
                sessionId: 'session-1', roomCode: 'ROOM01',
                player: { sessionId: 'session-1' }, game: null, isInRoom: true
            });
            const handler = jest.fn().mockResolvedValue(undefined);

            const wrappedFn = createRoomHandler(mockSocket, 'room:leave', null, handler);
            await wrappedFn({});

            expect(getPlayerContext).toHaveBeenCalledWith(mockSocket, { requireRoom: true });
        });
    });

    describe('createHostHandler', () => {
        it('passes requireRoom and requireHost to context options', async () => {
            getPlayerContext.mockResolvedValue({
                sessionId: 'session-1', roomCode: 'ROOM01',
                player: { sessionId: 'session-1', isHost: true },
                game: null, isInRoom: true, isHost: true
            });
            const handler = jest.fn().mockResolvedValue(undefined);

            const wrappedFn = createHostHandler(mockSocket, 'room:settings', null, handler);
            await wrappedFn({});

            expect(getPlayerContext).toHaveBeenCalledWith(mockSocket, {
                requireRoom: true,
                requireHost: true
            });
        });
    });

    describe('createGameHandler', () => {
        it('passes requireRoom and requireGame to context options', async () => {
            getPlayerContext.mockResolvedValue({
                sessionId: 'session-1', roomCode: 'ROOM01',
                player: { sessionId: 'session-1' },
                game: { gameOver: false }, isInRoom: true
            });
            const handler = jest.fn().mockResolvedValue(undefined);

            const wrappedFn = createGameHandler(mockSocket, 'game:reveal', null, handler);
            await wrappedFn({});

            expect(getPlayerContext).toHaveBeenCalledWith(mockSocket, {
                requireRoom: true,
                requireGame: true
            });
        });
    });

    describe('error event prefixing', () => {
        const cases = [
            ['player:setTeam', 'player:error'],
            ['room:leave', 'room:error'],
            ['game:reveal', 'game:error'],
            ['chat:message', 'chat:error'],
            ['timer:pause', 'timer:error'],
        ];

        it.each(cases)('%s emits %s on error', async (eventName, expectedErrorEvent) => {
            getPlayerContext.mockRejectedValue(new Error('fail'));

            const wrappedFn = createContextHandler(
                mockSocket, eventName, null,
                { requireRoom: true }, jest.fn()
            );
            await wrappedFn({});

            expect(mockSocket.emit).toHaveBeenCalledWith(expectedErrorEvent, expect.any(Object));
        });
    });
});
