/**
 * Context Handler - Extended Branch Coverage Tests
 *
 * Targets uncovered branches in contextHandler.ts:
 * - Line 88: `const previousPlayer = ctx.player ? { ...ctx.player } : null;`
 *   -> test when ctx.player is null (the : null branch)
 * - Line 158: `const validated = schema ? validateInput(schema, data) as T : (data || {}) as T;`
 *   -> test createPreRoomHandler with null schema AND falsy data (the (data || {}) branch)
 *   -> test createPreRoomHandler with schema provided
 * - Line 84: `const validated = schema ? validateInput(schema, data) as T : (data || {}) as T;`
 *   -> test createContextHandler with null schema and falsy data
 */

jest.mock('../socket/playerContext');
jest.mock('../socket/rateLimitHandler', () => ({
    createRateLimitedHandler: jest.fn()
}));
jest.mock('../middleware/validation', () => ({
    validateInput: jest.fn((_schema: any, data: any) => data)
}));
jest.mock('../utils/logger', () => ({
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn()
}));

const { getPlayerContext, syncSocketRooms } = require('../socket/playerContext');
const { createRateLimitedHandler } = require('../socket/rateLimitHandler');
const { validateInput } = require('../middleware/validation');
const {
    createContextHandler,
    createRoomHandler,
    createPreRoomHandler
} = require('../socket/contextHandler');

describe('contextHandler - extended branch coverage', () => {
    let mockSocket: any;

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

        // Mock createRateLimitedHandler to execute the handler directly
        (createRateLimitedHandler as jest.Mock).mockImplementation(
            (_socket: any, _eventName: string, handler: Function) => {
                return async (data: any) => {
                    return await handler(data);
                };
            }
        );
        (syncSocketRooms as jest.Mock).mockImplementation(() => {});
    });

    describe('line 88: previousPlayer null branch', () => {
        it('sets previousPlayer to null when ctx.player is null', async () => {
            // Context where player is null (e.g., player not found but room not required)
            const ctx = {
                sessionId: 'session-1',
                roomCode: 'ROOM01',
                player: null,
                game: null,
                isInRoom: false,
                isHost: false,
                team: null,
                role: null
            };
            (getPlayerContext as jest.Mock).mockResolvedValue(ctx);

            const updatedPlayer = { sessionId: 'session-1', team: 'red', roomCode: 'ROOM01' };
            const handler = jest.fn().mockResolvedValue({ player: updatedPlayer });

            const wrappedFn = createContextHandler(
                mockSocket, 'player:setTeam', null,
                { requireRoom: false }, handler
            );
            await wrappedFn({});

            expect(handler).toHaveBeenCalledWith(ctx, {});
            // syncSocketRooms should be called with null as previousPlayer
            expect(syncSocketRooms).toHaveBeenCalledWith(
                mockSocket,
                updatedPlayer,
                null
            );
        });

        it('sets previousPlayer as spread copy when ctx.player is non-null', async () => {
            const playerObj = { sessionId: 'session-1', team: 'red', role: 'spectator', roomCode: 'ROOM01' };
            const ctx = {
                sessionId: 'session-1',
                roomCode: 'ROOM01',
                player: playerObj,
                game: null,
                isInRoom: true,
                isHost: false,
                team: 'red',
                role: 'spectator'
            };
            (getPlayerContext as jest.Mock).mockResolvedValue(ctx);

            const updatedPlayer = { sessionId: 'session-1', team: 'blue', role: 'spectator', roomCode: 'ROOM01' };
            const handler = jest.fn().mockResolvedValue({ player: updatedPlayer });

            const wrappedFn = createContextHandler(
                mockSocket, 'player:setTeam', null,
                { requireRoom: true }, handler
            );
            await wrappedFn({});

            // previousPlayer should be a copy with original values
            const previousArg = (syncSocketRooms as jest.Mock).mock.calls[0][2];
            expect(previousArg).toEqual(playerObj);
            expect(previousArg).not.toBe(playerObj); // Should be a copy
        });

        it('does not call syncSocketRooms when result has no player', async () => {
            const ctx = {
                sessionId: 'session-1',
                roomCode: 'ROOM01',
                player: null,
                game: null,
                isInRoom: false
            };
            (getPlayerContext as jest.Mock).mockResolvedValue(ctx);

            const handler = jest.fn().mockResolvedValue(undefined);

            const wrappedFn = createContextHandler(
                mockSocket, 'room:leave', null,
                { requireRoom: false }, handler
            );
            await wrappedFn({});

            expect(syncSocketRooms).not.toHaveBeenCalled();
        });

        it('does not call syncSocketRooms when result is empty object', async () => {
            const ctx = {
                sessionId: 'session-1',
                roomCode: 'ROOM01',
                player: null,
                game: null,
                isInRoom: false
            };
            (getPlayerContext as jest.Mock).mockResolvedValue(ctx);

            const handler = jest.fn().mockResolvedValue({});

            const wrappedFn = createContextHandler(
                mockSocket, 'room:leave', null,
                { requireRoom: false }, handler
            );
            await wrappedFn({});

            // result.player is undefined, so syncSocketRooms should not be called
            expect(syncSocketRooms).not.toHaveBeenCalled();
        });
    });

    describe('line 84: schema null with falsy data', () => {
        it('uses empty object when schema is null and data is null', async () => {
            const ctx = {
                sessionId: 'session-1',
                roomCode: 'ROOM01',
                player: { sessionId: 'session-1' },
                game: null,
                isInRoom: true
            };
            (getPlayerContext as jest.Mock).mockResolvedValue(ctx);

            const handler = jest.fn().mockResolvedValue(undefined);

            const wrappedFn = createContextHandler(
                mockSocket, 'test:event', null,
                { requireRoom: true }, handler
            );
            await wrappedFn(null);

            // When schema is null and data is null, (data || {}) should pass {}
            expect(handler).toHaveBeenCalledWith(ctx, {});
            expect(validateInput).not.toHaveBeenCalled();
        });

        it('uses empty object when schema is null and data is undefined', async () => {
            const ctx = {
                sessionId: 'session-1',
                roomCode: 'ROOM01',
                player: { sessionId: 'session-1' },
                game: null,
                isInRoom: true
            };
            (getPlayerContext as jest.Mock).mockResolvedValue(ctx);

            const handler = jest.fn().mockResolvedValue(undefined);

            const wrappedFn = createContextHandler(
                mockSocket, 'test:event', null,
                { requireRoom: true }, handler
            );
            await wrappedFn(undefined);

            expect(handler).toHaveBeenCalledWith(ctx, {});
        });

        it('uses empty object when schema is null and data is empty string', async () => {
            const ctx = {
                sessionId: 'session-1',
                roomCode: 'ROOM01',
                player: { sessionId: 'session-1' },
                game: null,
                isInRoom: true
            };
            (getPlayerContext as jest.Mock).mockResolvedValue(ctx);

            const handler = jest.fn().mockResolvedValue(undefined);

            const wrappedFn = createContextHandler(
                mockSocket, 'test:event', null,
                { requireRoom: true }, handler
            );
            await wrappedFn('');

            // empty string is falsy, so (data || {}) returns {}
            expect(handler).toHaveBeenCalledWith(ctx, {});
        });

        it('passes through truthy data when schema is null', async () => {
            const ctx = {
                sessionId: 'session-1',
                roomCode: 'ROOM01',
                player: { sessionId: 'session-1' },
                game: null,
                isInRoom: true
            };
            (getPlayerContext as jest.Mock).mockResolvedValue(ctx);

            const handler = jest.fn().mockResolvedValue(undefined);

            const wrappedFn = createContextHandler(
                mockSocket, 'test:event', null,
                { requireRoom: true }, handler
            );
            await wrappedFn({ key: 'value' });

            expect(handler).toHaveBeenCalledWith(ctx, { key: 'value' });
        });

        it('uses validateInput when schema is provided', async () => {
            const ctx = {
                sessionId: 'session-1',
                roomCode: 'ROOM01',
                player: { sessionId: 'session-1' },
                game: null,
                isInRoom: true
            };
            (getPlayerContext as jest.Mock).mockResolvedValue(ctx);
            (validateInput as jest.Mock).mockReturnValue({ team: 'red' });

            const schema = { parse: jest.fn() };
            const handler = jest.fn().mockResolvedValue(undefined);

            const wrappedFn = createContextHandler(
                mockSocket, 'test:event', schema,
                { requireRoom: true }, handler
            );
            await wrappedFn({ team: 'red' });

            expect(validateInput).toHaveBeenCalledWith(schema, { team: 'red' });
            expect(handler).toHaveBeenCalledWith(ctx, { team: 'red' });
        });
    });

    describe('line 158: createPreRoomHandler branches', () => {
        it('uses empty object when schema is null and data is null', async () => {
            const handler = jest.fn().mockResolvedValue(undefined);

            const wrappedFn = createPreRoomHandler(
                mockSocket, 'room:create', null, handler
            );
            await wrappedFn(null);

            // data is null, schema is null, so (data || {}) => {}
            expect(handler).toHaveBeenCalledWith({});
            expect(validateInput).not.toHaveBeenCalled();
        });

        it('uses empty object when schema is null and data is undefined', async () => {
            const handler = jest.fn().mockResolvedValue(undefined);

            const wrappedFn = createPreRoomHandler(
                mockSocket, 'room:create', null, handler
            );
            await wrappedFn(undefined);

            expect(handler).toHaveBeenCalledWith({});
        });

        it('uses empty object when schema is null and data is 0', async () => {
            const handler = jest.fn().mockResolvedValue(undefined);

            const wrappedFn = createPreRoomHandler(
                mockSocket, 'room:create', null, handler
            );
            await wrappedFn(0);

            // 0 is falsy, so (data || {}) => {}
            expect(handler).toHaveBeenCalledWith({});
        });

        it('passes through truthy data when schema is null', async () => {
            const handler = jest.fn().mockResolvedValue(undefined);

            const wrappedFn = createPreRoomHandler(
                mockSocket, 'room:join', null, handler
            );
            await wrappedFn({ roomCode: 'ABC123' });

            expect(handler).toHaveBeenCalledWith({ roomCode: 'ABC123' });
        });

        it('uses validateInput when schema is provided', async () => {
            (validateInput as jest.Mock).mockReturnValue({ roomCode: 'VALID' });

            const schema = { parse: jest.fn() };
            const handler = jest.fn().mockResolvedValue(undefined);

            const wrappedFn = createPreRoomHandler(
                mockSocket, 'room:create', schema, handler
            );
            await wrappedFn({ roomCode: 'input' });

            expect(validateInput).toHaveBeenCalledWith(schema, { roomCode: 'input' });
            expect(handler).toHaveBeenCalledWith({ roomCode: 'VALID' });
        });

        it('propagates errors from handler', async () => {
            const handler = jest.fn().mockRejectedValue(new Error('Handler error'));

            const wrappedFn = createPreRoomHandler(
                mockSocket, 'room:create', null, handler
            );

            await expect(wrappedFn({ roomCode: 'ABC' })).rejects.toThrow('Handler error');
        });

        it('propagates validation errors', async () => {
            const valError = { code: 'INVALID_INPUT', message: 'bad data' };
            (validateInput as jest.Mock).mockImplementation(() => { throw valError; });

            const schema = { parse: jest.fn() };
            const handler = jest.fn();

            const wrappedFn = createPreRoomHandler(
                mockSocket, 'room:create', schema, handler
            );

            await expect(wrappedFn({ bad: 'data' })).rejects.toEqual(valError);
            expect(handler).not.toHaveBeenCalled();
        });
    });

    describe('createRoomHandler passes correct context options', () => {
        it('always passes requireRoom: true', async () => {
            const ctx = {
                sessionId: 'session-1',
                roomCode: 'ROOM01',
                player: { sessionId: 'session-1' },
                game: null,
                isInRoom: true
            };
            (getPlayerContext as jest.Mock).mockResolvedValue(ctx);

            const handler = jest.fn().mockResolvedValue(undefined);
            const wrappedFn = createRoomHandler(mockSocket, 'room:leave', null, handler);
            await wrappedFn({});

            expect(getPlayerContext).toHaveBeenCalledWith(mockSocket, { requireRoom: true });
        });
    });
});
