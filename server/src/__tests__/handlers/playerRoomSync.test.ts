/**
 * Tests for playerRoomSync - spectator room membership synchronization
 *
 * Covers: basic sync, error handling
 */

jest.mock('../../services/playerService', () => ({
    getPlayer: jest.fn()
}));

jest.mock('../../utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));

jest.mock('../../utils/timeout', () => ({
    TIMEOUTS: { GAME_ACTION: 500 }
}));

jest.mock('../../socket/playerContext', () => ({
    isPlayerSpectator: jest.fn()
}));

const { syncSpectatorRoomMembership } = require('../../socket/handlers/playerRoomSync');
const playerService = require('../../services/playerService');
const { isPlayerSpectator } = require('../../socket/playerContext');

const mockSocket = {
    join: jest.fn(),
    leave: jest.fn()
};

describe('syncSpectatorRoomMembership', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        jest.clearAllMocks();
    });

    afterEach(() => {
        jest.runAllTimers();
        jest.useRealTimers();
    });

    test('joins spectator room when player is a spectator', async () => {
        playerService.getPlayer.mockResolvedValue({
            sessionId: 'p1', team: null, role: 'spectator', roomCode: 'ROOM1'
        });
        isPlayerSpectator.mockReturnValue(true);

        const p = syncSpectatorRoomMembership(mockSocket, 'ROOM1', 'p1');
        jest.runAllTimers();
        await p;

        expect(mockSocket.join).toHaveBeenCalledWith('spectators:ROOM1');
        expect(mockSocket.leave).not.toHaveBeenCalled();
    });

    test('leaves spectator room when player is not a spectator', async () => {
        playerService.getPlayer.mockResolvedValue({
            sessionId: 'p2', team: 'red', role: 'clicker', roomCode: 'ROOM1'
        });
        isPlayerSpectator.mockReturnValue(false);

        const p = syncSpectatorRoomMembership(mockSocket, 'ROOM1', 'p2');
        jest.runAllTimers();
        await p;

        expect(mockSocket.leave).toHaveBeenCalledWith('spectators:ROOM1');
        expect(mockSocket.join).not.toHaveBeenCalled();
    });

    test('does nothing if player not found', async () => {
        playerService.getPlayer.mockResolvedValue(null);

        const p = syncSpectatorRoomMembership(mockSocket, 'ROOM1', 'gone');
        jest.runAllTimers();
        await p;

        expect(mockSocket.join).not.toHaveBeenCalled();
        expect(mockSocket.leave).not.toHaveBeenCalled();
    });

    test('handles getPlayer error gracefully', async () => {
        playerService.getPlayer.mockRejectedValue(new Error('Redis down'));
        const logger = require('../../utils/logger');

        const p = syncSpectatorRoomMembership(mockSocket, 'ROOM1', 'p1');
        jest.runAllTimers();
        await p;

        expect(logger.warn).toHaveBeenCalledWith(
            expect.stringContaining('syncSpectatorRoomMembership'),
            expect.any(String)
        );
    });
});
