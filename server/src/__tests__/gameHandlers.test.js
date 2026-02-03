/**
 * Game Handlers Unit Tests
 */

// Mock rate limit handler FIRST to bypass rate limiting
jest.mock('../socket/rateLimitHandler', () => ({
    createRateLimitedHandler: jest.fn((socket, eventName, handler) => handler)
}));

// Mock dependencies
jest.mock('../services/gameService');
jest.mock('../services/playerService');
jest.mock('../services/roomService');
jest.mock('../services/eventLogService');
jest.mock('../utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));

const gameService = require('../services/gameService');
const playerService = require('../services/playerService');
const roomService = require('../services/roomService');
const eventLogService = require('../services/eventLogService');

// Mock socket/index to avoid circular dependency issues
jest.mock('../socket/index', () => ({
    startTurnTimer: jest.fn().mockResolvedValue({}),
    stopTurnTimer: jest.fn().mockResolvedValue()
}));

// Mock socketFunctionProvider to provide timer functions
jest.mock('../socket/socketFunctionProvider', () => ({
    getSocketFunctions: jest.fn(() => ({
        startTurnTimer: jest.fn().mockResolvedValue({}),
        stopTurnTimer: jest.fn().mockResolvedValue(),
        emitToRoom: jest.fn(),
        emitToPlayer: jest.fn(),
        getTimerStatus: jest.fn().mockResolvedValue(null),
        getIO: jest.fn()
    })),
    isRegistered: jest.fn(() => true)
}));

describe('Game Handlers', () => {
    let mockSocket;
    let mockIo;
    let gameHandlers;

    beforeEach(() => {
        jest.clearAllMocks();

        // Create mock socket
        mockSocket = {
            id: 'socket-123',
            sessionId: 'session-456',
            roomCode: 'TEST12',
            emit: jest.fn(),
            on: jest.fn(),
            join: jest.fn(),
            leave: jest.fn()
        };

        // Create mock io
        mockIo = {
            to: jest.fn().mockReturnThis(),
            emit: jest.fn()
        };

        // Default player mock with roomCode for context handler
        playerService.getPlayer.mockResolvedValue({
            sessionId: 'session-456',
            roomCode: 'TEST12',
            nickname: 'Player1',
            team: 'red',
            role: 'clicker',
            isHost: false
        });
        gameService.getGame.mockResolvedValue(null);

        // Reset eventLogService mock
        eventLogService.logEvent = jest.fn().mockResolvedValue();
        eventLogService.EVENT_TYPES = {
            GAME_STARTED: 'GAME_STARTED',
            CARD_REVEALED: 'CARD_REVEALED',
            CLUE_GIVEN: 'CLUE_GIVEN',
            TURN_ENDED: 'TURN_ENDED',
            GAME_OVER: 'GAME_OVER'
        };

        // Register handlers
        gameHandlers = require('../socket/handlers/gameHandlers');
        gameHandlers(mockIo, mockSocket);
    });

    describe('game:start handler', () => {
        test('registers handler', () => {
            const handlers = mockSocket.on.mock.calls;
            const startHandler = handlers.find(h => h[0] === 'game:start');
            expect(startHandler).toBeDefined();
        });

        test('validates host permission', async () => {
            playerService.getPlayer.mockResolvedValue({ sessionId: 'session-456', roomCode: 'TEST12', isHost: false });

            const handlers = mockSocket.on.mock.calls;
            const startHandler = handlers.find(h => h[0] === 'game:start');
            await startHandler[1]({});

            expect(mockSocket.emit).toHaveBeenCalledWith('game:error', expect.objectContaining({
                message: expect.stringContaining('host')
            }));
        });

        test('starts game successfully when host', async () => {
            playerService.getPlayer.mockResolvedValue({ sessionId: 'session-456', roomCode: 'TEST12', isHost: true, team: 'red' });
            gameService.getGame.mockResolvedValue(null);
            gameService.createGame.mockResolvedValue({
                id: 'game-1',
                currentTurn: 'red',
                redTotal: 9,
                blueTotal: 8
            });
            gameService.getGameStateForPlayer.mockReturnValue({ id: 'game-1' });
            playerService.getPlayersInRoom.mockResolvedValue([
                { sessionId: 'session-456', team: 'red', role: 'clicker' }
            ]);
            roomService.getRoom.mockResolvedValue({ settings: { turnTimer: 60 } });

            const handlers = mockSocket.on.mock.calls;
            const startHandler = handlers.find(h => h[0] === 'game:start');
            await startHandler[1]({});

            expect(gameService.createGame).toHaveBeenCalledWith('TEST12', expect.any(Object));
        });

        test('prevents starting when game in progress', async () => {
            playerService.getPlayer.mockResolvedValue({ sessionId: 'session-456', roomCode: 'TEST12', isHost: true });
            gameService.getGame.mockResolvedValue({ gameOver: false });

            const handlers = mockSocket.on.mock.calls;
            const startHandler = handlers.find(h => h[0] === 'game:start');
            await startHandler[1]({});

            expect(mockSocket.emit).toHaveBeenCalledWith('game:error', expect.objectContaining({
                code: expect.any(String)
            }));
        });
    });

    describe('game:reveal handler', () => {
        test('registers handler', () => {
            const handlers = mockSocket.on.mock.calls;
            const revealHandler = handlers.find(h => h[0] === 'game:reveal');
            expect(revealHandler).toBeDefined();
        });

        test('validates player is clicker', async () => {
            playerService.getPlayer.mockResolvedValue({ sessionId: 'session-456', roomCode: 'TEST12', role: 'spectator', team: 'red' });
            // PHASE 1 FIX: Need game to check if clicker is disconnected
            gameService.getGame.mockResolvedValue({ currentTurn: 'red' });
            // Mock team with connected clicker so spectator can't reveal
            playerService.getTeamMembers.mockResolvedValue([
                { sessionId: 'other-session', connected: true, team: 'red', role: 'clicker' }
            ]);

            const handlers = mockSocket.on.mock.calls;
            const revealHandler = handlers.find(h => h[0] === 'game:reveal');
            await revealHandler[1]({ index: 5 });

            expect(mockSocket.emit).toHaveBeenCalledWith('game:error', expect.objectContaining({
                message: expect.stringContaining('clicker')
            }));
        });

        test('validates player has team', async () => {
            playerService.getPlayer.mockResolvedValue({ sessionId: 'session-456', roomCode: 'TEST12', role: 'clicker', team: null });
            gameService.getGame.mockResolvedValue({ currentTurn: 'red' });

            const handlers = mockSocket.on.mock.calls;
            const revealHandler = handlers.find(h => h[0] === 'game:reveal');
            await revealHandler[1]({ index: 5 });

            expect(mockSocket.emit).toHaveBeenCalledWith('game:error', expect.objectContaining({
                message: expect.stringContaining('team')
            }));
        });

        test('validates it is player turn', async () => {
            playerService.getPlayer.mockResolvedValue({ sessionId: 'session-456', roomCode: 'TEST12', role: 'clicker', team: 'red' });
            gameService.getGame.mockResolvedValue({ currentTurn: 'blue' });

            const handlers = mockSocket.on.mock.calls;
            const revealHandler = handlers.find(h => h[0] === 'game:reveal');
            await revealHandler[1]({ index: 5 });

            expect(mockSocket.emit).toHaveBeenCalledWith('game:error', expect.objectContaining({
                message: expect.stringContaining('turn')
            }));
        });

        test('reveals card successfully', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-456',
                roomCode: 'TEST12',
                role: 'clicker',
                team: 'red',
                nickname: 'TestPlayer'
            });
            gameService.getGame.mockResolvedValue({ currentTurn: 'red' });
            // ISSUE #59 FIX: Mock team members for team validation
            playerService.getTeamMembers.mockResolvedValue([
                { sessionId: 'session-456', connected: true, team: 'red' }
            ]);
            gameService.revealCard.mockResolvedValue({
                index: 5,
                type: 'red',
                word: 'TEST',
                redScore: 1,
                blueScore: 0,
                currentTurn: 'red',
                guessesUsed: 1,
                guessesAllowed: 3,
                turnEnded: false,
                gameOver: false
            });

            const handlers = mockSocket.on.mock.calls;
            const revealHandler = handlers.find(h => h[0] === 'game:reveal');
            await revealHandler[1]({ index: 5 });

            // Bug #4 fix: revealCard now takes playerTeam as 4th parameter
            expect(gameService.revealCard).toHaveBeenCalledWith('TEST12', 5, 'TestPlayer', 'red');
            expect(mockIo.to).toHaveBeenCalledWith('room:TEST12');
            expect(mockIo.emit).toHaveBeenCalledWith('game:cardRevealed', expect.any(Object));
        });

        test('handles game over', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-456',
                roomCode: 'TEST12',
                role: 'clicker',
                team: 'red',
                nickname: 'TestPlayer'
            });
            gameService.getGame.mockResolvedValue({ currentTurn: 'red' });
            // ISSUE #59 FIX: Mock team members for team validation
            playerService.getTeamMembers.mockResolvedValue([
                { sessionId: 'session-456', connected: true, team: 'red' }
            ]);
            gameService.revealCard.mockResolvedValue({
                index: 5,
                type: 'assassin',
                gameOver: true,
                winner: 'blue',
                endReason: 'assassin',
                allTypes: ['red', 'blue', 'assassin']
            });

            const handlers = mockSocket.on.mock.calls;
            const revealHandler = handlers.find(h => h[0] === 'game:reveal');
            await revealHandler[1]({ index: 5 });

            // Check that game:over was emitted (among multiple emit calls)
            const emitCalls = mockIo.emit.mock.calls;
            const gameOverCall = emitCalls.find(call => call[0] === 'game:over');
            expect(gameOverCall).toBeDefined();
            expect(gameOverCall[1]).toMatchObject({
                winner: 'blue',
                reason: 'assassin'
            });
        });
    });

    describe('game:clue handler', () => {
        test('registers handler', () => {
            const handlers = mockSocket.on.mock.calls;
            const clueHandler = handlers.find(h => h[0] === 'game:clue');
            expect(clueHandler).toBeDefined();
        });

        test('validates player is spymaster', async () => {
            playerService.getPlayer.mockResolvedValue({ sessionId: 'session-456', roomCode: 'TEST12', role: 'clicker', team: 'red' });
            gameService.getGame.mockResolvedValue({ gameOver: false, currentTurn: 'red' });

            const handlers = mockSocket.on.mock.calls;
            const clueHandler = handlers.find(h => h[0] === 'game:clue');
            await clueHandler[1]({ word: 'animal', number: 2 });

            expect(mockSocket.emit).toHaveBeenCalledWith('game:error', expect.objectContaining({
                message: expect.stringContaining('spymaster')
            }));
        });

        test('gives clue successfully', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-456',
                roomCode: 'TEST12',
                role: 'spymaster',
                team: 'red',
                nickname: 'Spymaster1'
            });
            gameService.getGame.mockResolvedValue({ gameOver: false, currentTurn: 'red' });
            gameService.giveClue.mockResolvedValue({
                team: 'red',
                word: 'ANIMAL',
                number: 2,
                spymaster: 'Spymaster1',
                guessesAllowed: 3,
                timestamp: Date.now()
            });

            const handlers = mockSocket.on.mock.calls;
            const clueHandler = handlers.find(h => h[0] === 'game:clue');
            await clueHandler[1]({ word: 'animal', number: 2 });

            expect(gameService.giveClue).toHaveBeenCalledWith('TEST12', 'red', 'animal', 2, 'Spymaster1');
            expect(mockIo.emit).toHaveBeenCalledWith('game:clueGiven', expect.any(Object));
        });
    });

    describe('game:endTurn handler', () => {
        test('registers handler', () => {
            const handlers = mockSocket.on.mock.calls;
            const endTurnHandler = handlers.find(h => h[0] === 'game:endTurn');
            expect(endTurnHandler).toBeDefined();
        });

        test('validates player is clicker', async () => {
            playerService.getPlayer.mockResolvedValue({ sessionId: 'session-456', roomCode: 'TEST12', role: 'spectator', team: 'red' });
            gameService.getGame.mockResolvedValue({ currentTurn: 'red', currentClue: { word: 'test', number: 2 } });
            playerService.getTeamMembers.mockResolvedValue([
                { sessionId: 'session-456', role: 'spectator', connected: true },
                { sessionId: 'session-789', role: 'clicker', connected: true }
            ]);

            const handlers = mockSocket.on.mock.calls;
            const endTurnHandler = handlers.find(h => h[0] === 'game:endTurn');
            await endTurnHandler[1]();

            expect(mockSocket.emit).toHaveBeenCalledWith('game:error', expect.objectContaining({
                message: expect.stringContaining('clicker')
            }));
        });

        test('ends turn successfully', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-456',
                roomCode: 'TEST12',
                role: 'clicker',
                team: 'red',
                nickname: 'Clicker1'
            });
            gameService.getGame.mockResolvedValue({ currentTurn: 'red', currentClue: { word: 'test', number: 2 } });
            playerService.getTeamMembers.mockResolvedValue([
                { sessionId: 'session-456', role: 'clicker', connected: true }
            ]);
            gameService.endTurn.mockResolvedValue({
                currentTurn: 'blue',
                previousTurn: 'red'
            });
            roomService.getRoom.mockResolvedValue({ settings: { turnTimer: 60 } });

            const handlers = mockSocket.on.mock.calls;
            const endTurnHandler = handlers.find(h => h[0] === 'game:endTurn');
            await endTurnHandler[1]();

            expect(gameService.endTurn).toHaveBeenCalledWith('TEST12', 'Clicker1', expect.anything());
            expect(mockIo.emit).toHaveBeenCalledWith('game:turnEnded', expect.objectContaining({
                currentTurn: 'blue',
                previousTurn: 'red'
            }));
        });
    });

    describe('game:forfeit handler', () => {
        test('registers handler', () => {
            const handlers = mockSocket.on.mock.calls;
            const forfeitHandler = handlers.find(h => h[0] === 'game:forfeit');
            expect(forfeitHandler).toBeDefined();
        });

        test('validates player is host', async () => {
            playerService.getPlayer.mockResolvedValue({ sessionId: 'session-456', roomCode: 'TEST12', isHost: false });

            const handlers = mockSocket.on.mock.calls;
            const forfeitHandler = handlers.find(h => h[0] === 'game:forfeit');
            await forfeitHandler[1]();

            expect(mockSocket.emit).toHaveBeenCalledWith('game:error', expect.objectContaining({
                message: expect.stringContaining('host')
            }));
        });

        test('forfeits game successfully', async () => {
            playerService.getPlayer.mockResolvedValue({ sessionId: 'session-456', roomCode: 'TEST12', isHost: true });
            gameService.getGame.mockResolvedValue({ gameOver: false, currentTurn: 'red' });
            gameService.forfeitGame.mockResolvedValue({
                winner: 'blue',
                forfeitingTeam: 'red',
                allTypes: ['red', 'blue', 'neutral', 'assassin']
            });

            const handlers = mockSocket.on.mock.calls;
            const forfeitHandler = handlers.find(h => h[0] === 'game:forfeit');
            await forfeitHandler[1]();

            expect(gameService.forfeitGame).toHaveBeenCalledWith('TEST12');
            expect(mockIo.emit).toHaveBeenCalledWith('game:over', expect.objectContaining({
                winner: 'blue',
                forfeitingTeam: 'red',
                reason: 'forfeit'
            }));
        });
    });

    describe('game:history handler', () => {
        test('registers handler', () => {
            const handlers = mockSocket.on.mock.calls;
            const historyHandler = handlers.find(h => h[0] === 'game:history');
            expect(historyHandler).toBeDefined();
        });

        test('returns game history', async () => {
            const mockHistory = [
                { action: 'clue', word: 'TEST', number: 2 },
                { action: 'reveal', index: 5, type: 'red' }
            ];
            gameService.getGameHistory.mockResolvedValue(mockHistory);

            const handlers = mockSocket.on.mock.calls;
            const historyHandler = handlers.find(h => h[0] === 'game:history');
            await historyHandler[1]();

            expect(gameService.getGameHistory).toHaveBeenCalledWith('TEST12');
            expect(mockSocket.emit).toHaveBeenCalledWith('game:historyData', {
                history: mockHistory
            });
        });
    });

    describe('Error handling', () => {
        test('handles room not found', async () => {
            mockSocket.roomCode = null;
            playerService.getPlayer.mockResolvedValue(null);

            const handlers = mockSocket.on.mock.calls;
            const startHandler = handlers.find(h => h[0] === 'game:start');
            await startHandler[1]({});

            expect(mockSocket.emit).toHaveBeenCalledWith('game:error', expect.objectContaining({
                code: expect.any(String)
            }));
        });

        test('handles service errors gracefully', async () => {
            playerService.getPlayer.mockRejectedValue(new Error('Database error'));

            const handlers = mockSocket.on.mock.calls;
            const startHandler = handlers.find(h => h[0] === 'game:start');
            await startHandler[1]({});

            expect(mockSocket.emit).toHaveBeenCalledWith('game:error', expect.objectContaining({
                message: 'An unexpected error occurred'
            }));
        });
    });
});
