/**
 * Game Handlers Branch Coverage Tests
 * Covers: spymaster reveal (line 207), spymaster endTurn (line 350),
 * game start turnTimer branch (lines 165-174)
 */

const SAFE_ERROR_CODES_MOCK = ['RATE_LIMITED', 'ROOM_NOT_FOUND', 'ROOM_FULL', 'NOT_HOST', 'NOT_YOUR_TURN', 'GAME_OVER', 'INVALID_INPUT', 'CARD_ALREADY_REVEALED', 'NOT_SPYMASTER', 'NOT_CLICKER', 'NOT_AUTHORIZED', 'SESSION_EXPIRED', 'PLAYER_NOT_FOUND', 'GAME_IN_PROGRESS', 'VALIDATION_ERROR', 'CANNOT_SWITCH_TEAM_DURING_TURN', 'CANNOT_CHANGE_ROLE_DURING_TURN', 'SPYMASTER_CANNOT_CHANGE_TEAM', 'GAME_NOT_STARTED'];
jest.mock('../socket/rateLimitHandler', () => ({
    createRateLimitedHandler: jest.fn((socket: any, eventName: string, handler: any) => {
        return async (data: any) => {
            try { return await handler(data); } catch (error: any) {
                const errorEvent = `${eventName.split(':')[0]}:error`;
                const code = error.code || 'SERVER_ERROR';
                const isSafe = SAFE_ERROR_CODES_MOCK.includes(code);
                socket.emit(errorEvent, { code, message: isSafe ? (error.message || 'An unexpected error occurred') : 'An unexpected error occurred' });
            }
        };
    })
}));

jest.mock('../services/gameService');
jest.mock('../services/playerService');
jest.mock('../services/roomService');
jest.mock('../services/gameHistoryService');
jest.mock('../services/eventLogService');
jest.mock('../utils/logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../socket/index', () => ({ startTurnTimer: jest.fn().mockResolvedValue({}), stopTurnTimer: jest.fn().mockResolvedValue() }));

const mockStartTurnTimer = jest.fn().mockResolvedValue({});
const mockStopTurnTimer = jest.fn().mockResolvedValue();
jest.mock('../socket/socketFunctionProvider', () => ({
    getSocketFunctions: jest.fn(() => ({
        startTurnTimer: mockStartTurnTimer,
        stopTurnTimer: mockStopTurnTimer,
        emitToRoom: jest.fn(),
        emitToPlayer: jest.fn(),
        getTimerStatus: jest.fn().mockResolvedValue(null),
        getIO: jest.fn(),
        createTimerExpireCallback: jest.fn(() => jest.fn())
    })),
    isRegistered: jest.fn(() => true)
}));

const gameService = require('../services/gameService');
const playerService = require('../services/playerService');
const roomService = require('../services/roomService');

describe('Game Handlers Branch Coverage', () => {
    let mockSocket: any;
    let mockIo: any;

    beforeEach(() => {
        jest.clearAllMocks();
        mockSocket = {
            id: 'socket-123',
            sessionId: 'session-456',
            roomCode: 'TEST12',
            clientIP: '127.0.0.1',
            emit: jest.fn(),
            on: jest.fn(),
            join: jest.fn(),
            leave: jest.fn(),
            handshake: { address: '127.0.0.1' }
        };
        mockIo = { to: jest.fn().mockReturnThis(), emit: jest.fn() };

        playerService.getPlayer.mockResolvedValue({
            sessionId: 'session-456', roomCode: 'TEST12', nickname: 'Player1',
            team: 'red', role: 'clicker', isHost: false
        });
        gameService.getGame.mockResolvedValue({ currentTurn: 'red', gameOver: false });

        const gameHandlers = require('../socket/handlers/gameHandlers');
        gameHandlers(mockIo, mockSocket);
    });

    describe('game:reveal - spymaster cannot reveal (line 207)', () => {
        it('should reject when player is spymaster', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-456', roomCode: 'TEST12', role: 'spymaster', team: 'red', nickname: 'Spy'
            });
            gameService.getGame.mockResolvedValue({ currentTurn: 'red', gameOver: false });
            playerService.getTeamMembers.mockResolvedValue([
                { sessionId: 'session-456', connected: true, team: 'red', role: 'spymaster' }
            ]);

            const handlers = mockSocket.on.mock.calls;
            const revealHandler = handlers.find((h: any) => h[0] === 'game:reveal');
            await revealHandler[1]({ index: 5 });

            expect(mockSocket.emit).toHaveBeenCalledWith('game:error', expect.objectContaining({
                message: expect.stringContaining('Spymasters cannot reveal')
            }));
        });
    });

    describe('game:endTurn - spymaster cannot end turn (line 350)', () => {
        it('should reject when player is spymaster', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-456', roomCode: 'TEST12', role: 'spymaster', team: 'red', nickname: 'Spy'
            });
            gameService.getGame.mockResolvedValue({ currentTurn: 'red', gameOver: false });
            playerService.getTeamMembers.mockResolvedValue([
                { sessionId: 'session-456', connected: true, team: 'red', role: 'spymaster' }
            ]);

            const handlers = mockSocket.on.mock.calls;
            const endTurnHandler = handlers.find((h: any) => h[0] === 'game:endTurn');
            await endTurnHandler[1]();

            expect(mockSocket.emit).toHaveBeenCalledWith('game:error', expect.objectContaining({
                message: expect.stringContaining('Spymasters cannot end turns')
            }));
        });
    });

    describe('game:start - turnTimer branch (lines 165-174)', () => {
        it('should NOT start timer when turnTimer is not configured', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-456', roomCode: 'TEST12', isHost: true, team: 'red'
            });
            gameService.getGame.mockResolvedValue(null);
            gameService.createGame.mockResolvedValue({ id: 'game-1', currentTurn: 'red' });
            gameService.getGameStateForPlayer.mockReturnValue({ id: 'game-1' });
            playerService.resetRolesForNewGame.mockResolvedValue([
                { sessionId: 'session-456', team: 'red', role: 'spectator' }
            ]);
            roomService.getRoom.mockResolvedValue({ settings: { turnTimer: null } });

            const handlers = mockSocket.on.mock.calls;
            const startHandler = handlers.find((h: any) => h[0] === 'game:start');
            await startHandler[1]({});

            expect(mockStartTurnTimer).not.toHaveBeenCalled();
        });

        it('should start timer when turnTimer is configured', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-456', roomCode: 'TEST12', isHost: true, team: 'red'
            });
            gameService.getGame.mockResolvedValue(null);
            gameService.createGame.mockResolvedValue({ id: 'game-1', currentTurn: 'red' });
            gameService.getGameStateForPlayer.mockReturnValue({ id: 'game-1' });
            playerService.resetRolesForNewGame.mockResolvedValue([
                { sessionId: 'session-456', team: 'red', role: 'spectator' },
                { sessionId: 'session-789', team: 'blue', role: 'spectator' }
            ]);
            roomService.getRoom.mockResolvedValue({ settings: { turnTimer: 120 } });

            const handlers = mockSocket.on.mock.calls;
            const startHandler = handlers.find((h: any) => h[0] === 'game:start');
            await startHandler[1]({});

            expect(mockStartTurnTimer).toHaveBeenCalledWith('TEST12', 120);
        });

        it('should broadcast player:updated for each player with role reset', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-456', roomCode: 'TEST12', isHost: true, team: 'red'
            });
            gameService.getGame.mockResolvedValue(null);
            gameService.createGame.mockResolvedValue({ id: 'game-1', currentTurn: 'red' });
            gameService.getGameStateForPlayer.mockReturnValue({ id: 'game-1' });
            const players = [
                { sessionId: 'session-456', team: 'red', role: 'spectator' },
                { sessionId: 'session-789', team: 'blue', role: 'spectator' }
            ];
            playerService.resetRolesForNewGame.mockResolvedValue(players);
            roomService.getRoom.mockResolvedValue({ settings: {} });

            const handlers = mockSocket.on.mock.calls;
            const startHandler = handlers.find((h: any) => h[0] === 'game:start');
            await startHandler[1]({});

            // Verify player:updated was emitted for each player
            const emitCalls = mockIo.emit.mock.calls.filter((c: any) => c[0] === 'player:updated');
            expect(emitCalls.length).toBe(2);
        });
    });
});
