/**
 * Extended Game Handlers Tests
 * Tests additional edge cases and code paths to improve coverage
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
jest.mock('../utils/audit', () => ({
    auditGameStarted: jest.fn(),
    auditGameEnded: jest.fn()
}));
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

describe('Extended Game Handlers Tests', () => {
    let mockSocket;
    let mockIo;
    let gameHandlers;

    beforeEach(() => {
        jest.clearAllMocks();

        mockSocket = {
            id: 'socket-123',
            sessionId: 'session-456',
            roomCode: 'TEST12',
            emit: jest.fn(),
            on: jest.fn(),
            handshake: {
                headers: { 'x-forwarded-for': '192.168.1.1' },
                address: '127.0.0.1'
            }
        };

        mockIo = {
            to: jest.fn().mockReturnThis(),
            emit: jest.fn()
        };

        eventLogService.logEvent = jest.fn().mockResolvedValue();
        eventLogService.EVENT_TYPES = {
            GAME_STARTED: 'GAME_STARTED',
            CARD_REVEALED: 'CARD_REVEALED',
            CLUE_GIVEN: 'CLUE_GIVEN',
            TURN_ENDED: 'TURN_ENDED',
            GAME_OVER: 'GAME_OVER'
        };

        gameHandlers = require('../socket/handlers/gameHandlers');
        gameHandlers(mockIo, mockSocket);
    });

    describe('game:start edge cases', () => {
        test('handles emit error for individual players', async () => {
            playerService.getPlayer.mockResolvedValue({ isHost: true, team: 'red' });
            gameService.getGame.mockResolvedValue(null);
            gameService.createGame.mockResolvedValue({
                id: 'game-1',
                currentTurn: 'red',
                redTotal: 9,
                blueTotal: 8
            });
            gameService.getGameStateForPlayer.mockImplementation(() => {
                throw new Error('Emit error');
            });
            playerService.getPlayersInRoom.mockResolvedValue([
                { sessionId: 'session-456', team: 'red', role: 'clicker' }
            ]);
            roomService.getRoom.mockResolvedValue({ settings: { turnTimer: null } });

            const handlers = mockSocket.on.mock.calls;
            const startHandler = handlers.find(h => h[0] === 'game:start');
            await startHandler[1]({});

            // Should continue despite emit error for individual player
            expect(gameService.createGame).toHaveBeenCalled();
        });

        // Note: Game start with options tests are covered in the main gameHandlers tests

        test('handles null player from getPlayer', async () => {
            playerService.getPlayer.mockResolvedValue(null);

            const handlers = mockSocket.on.mock.calls;
            const startHandler = handlers.find(h => h[0] === 'game:start');
            await startHandler[1]({});

            expect(mockSocket.emit).toHaveBeenCalledWith('game:error', expect.objectContaining({
                message: expect.stringContaining('host')
            }));
        });

        test('uses socket handshake address when x-forwarded-for not present', async () => {
            mockSocket.handshake.headers = {};

            playerService.getPlayer.mockResolvedValue({ isHost: true, team: 'red' });
            gameService.getGame.mockResolvedValue(null);
            gameService.createGame.mockResolvedValue({
                id: 'game-1',
                currentTurn: 'red',
                redTotal: 9,
                blueTotal: 8
            });
            gameService.getGameStateForPlayer.mockReturnValue({ id: 'game-1' });
            playerService.getPlayersInRoom.mockResolvedValue([]);
            roomService.getRoom.mockResolvedValue({ settings: {} });

            const handlers = mockSocket.on.mock.calls;
            const startHandler = handlers.find(h => h[0] === 'game:start');
            await startHandler[1]({});

            expect(gameService.createGame).toHaveBeenCalled();
        });
    });

    describe('game:reveal edge cases', () => {
        // Note: Non-clicker reveal validation tests are covered in integration tests
        // Complex mocking required for team member state verification

        test('handles turn ending with timer restart', async () => {
            playerService.getPlayer.mockResolvedValue({
                role: 'clicker',
                team: 'red',
                nickname: 'Clicker1'
            });
            gameService.getGame.mockResolvedValue({ currentTurn: 'red' });
            playerService.getTeamMembers.mockResolvedValue([
                { sessionId: 'session-456', connected: true, team: 'red' }
            ]);
            gameService.revealCard.mockResolvedValue({
                index: 5,
                type: 'blue',
                word: 'TEST',
                turnEnded: true,
                gameOver: false
            });
            roomService.getRoom.mockResolvedValue({ settings: { turnTimer: 60 } });

            const handlers = mockSocket.on.mock.calls;
            const revealHandler = handlers.find(h => h[0] === 'game:reveal');
            await revealHandler[1]({ index: 5 });

            expect(roomService.getRoom).toHaveBeenCalled();
        });

        test('handles null game state', async () => {
            playerService.getPlayer.mockResolvedValue({
                role: 'clicker',
                team: 'red',
                nickname: 'Clicker1'
            });
            gameService.getGame.mockResolvedValue(null);

            const handlers = mockSocket.on.mock.calls;
            const revealHandler = handlers.find(h => h[0] === 'game:reveal');
            await revealHandler[1]({ index: 5 });

            expect(mockSocket.emit).toHaveBeenCalledWith('game:error', expect.objectContaining({
                message: expect.stringContaining('No active game')
            }));
        });

        test('handles null player from getPlayer', async () => {
            playerService.getPlayer.mockResolvedValue(null);

            const handlers = mockSocket.on.mock.calls;
            const revealHandler = handlers.find(h => h[0] === 'game:reveal');
            await revealHandler[1]({ index: 5 });

            expect(mockSocket.emit).toHaveBeenCalledWith('game:error', expect.objectContaining({
                message: expect.stringContaining('not found')
            }));
        });
    });

    describe('game:clue edge cases', () => {
        test('handles null player from getPlayer', async () => {
            playerService.getPlayer.mockResolvedValue(null);

            const handlers = mockSocket.on.mock.calls;
            const clueHandler = handlers.find(h => h[0] === 'game:clue');
            await clueHandler[1]({ word: 'test', number: 2 });

            expect(mockSocket.emit).toHaveBeenCalledWith('game:error', expect.objectContaining({
                message: expect.stringContaining('spymaster')
            }));
        });

        test('handles no roomCode', async () => {
            mockSocket.roomCode = null;

            const handlers = mockSocket.on.mock.calls;
            const clueHandler = handlers.find(h => h[0] === 'game:clue');
            await clueHandler[1]({ word: 'test', number: 2 });

            expect(mockSocket.emit).toHaveBeenCalledWith('game:error', expect.objectContaining({
                code: expect.any(String)
            }));
        });

        test('logs event for clue', async () => {
            playerService.getPlayer.mockResolvedValue({
                role: 'spymaster',
                team: 'red',
                nickname: 'Spymaster1'
            });
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

            expect(eventLogService.logEvent).toHaveBeenCalledWith(
                'TEST12',
                'CLUE_GIVEN',
                expect.objectContaining({
                    team: 'red',
                    word: 'ANIMAL',
                    number: 2
                })
            );
        });
    });

    describe('game:endTurn edge cases', () => {
        test('handles null player from getPlayer', async () => {
            playerService.getPlayer.mockResolvedValue(null);

            const handlers = mockSocket.on.mock.calls;
            const endTurnHandler = handlers.find(h => h[0] === 'game:endTurn');
            await endTurnHandler[1]();

            expect(mockSocket.emit).toHaveBeenCalledWith('game:error', expect.objectContaining({
                message: expect.stringContaining('clicker')
            }));
        });

        test('handles null game state', async () => {
            playerService.getPlayer.mockResolvedValue({
                role: 'clicker',
                team: 'red',
                nickname: 'Clicker1'
            });
            gameService.getGame.mockResolvedValue(null);

            const handlers = mockSocket.on.mock.calls;
            const endTurnHandler = handlers.find(h => h[0] === 'game:endTurn');
            await endTurnHandler[1]();

            expect(mockSocket.emit).toHaveBeenCalledWith('game:error', expect.objectContaining({
                message: expect.stringContaining('No active game')
            }));
        });

        test('validates team turn match', async () => {
            playerService.getPlayer.mockResolvedValue({
                role: 'clicker',
                team: 'red',
                nickname: 'Clicker1'
            });
            gameService.getGame.mockResolvedValue({ currentTurn: 'blue' });

            const handlers = mockSocket.on.mock.calls;
            const endTurnHandler = handlers.find(h => h[0] === 'game:endTurn');
            await endTurnHandler[1]();

            expect(mockSocket.emit).toHaveBeenCalledWith('game:error', expect.objectContaining({
                message: expect.stringContaining('turn')
            }));
        });

        test('restarts timer when configured', async () => {
            playerService.getPlayer.mockResolvedValue({
                role: 'clicker',
                team: 'red',
                nickname: 'Clicker1'
            });
            gameService.getGame.mockResolvedValue({ currentTurn: 'red' });
            gameService.endTurn.mockResolvedValue({
                currentTurn: 'blue',
                previousTurn: 'red'
            });
            roomService.getRoom.mockResolvedValue({ settings: { turnTimer: 90 } });

            const handlers = mockSocket.on.mock.calls;
            const endTurnHandler = handlers.find(h => h[0] === 'game:endTurn');
            await endTurnHandler[1]();

            expect(roomService.getRoom).toHaveBeenCalledWith('TEST12');
        });

        test('logs event for turn end', async () => {
            playerService.getPlayer.mockResolvedValue({
                role: 'clicker',
                team: 'red',
                nickname: 'Clicker1'
            });
            gameService.getGame.mockResolvedValue({ currentTurn: 'red' });
            gameService.endTurn.mockResolvedValue({
                currentTurn: 'blue',
                previousTurn: 'red'
            });
            roomService.getRoom.mockResolvedValue({ settings: {} });

            const handlers = mockSocket.on.mock.calls;
            const endTurnHandler = handlers.find(h => h[0] === 'game:endTurn');
            await endTurnHandler[1]();

            expect(eventLogService.logEvent).toHaveBeenCalledWith(
                'TEST12',
                'TURN_ENDED',
                expect.objectContaining({
                    currentTurn: 'blue',
                    previousTurn: 'red',
                    reason: 'manual'
                })
            );
        });
    });

    describe('game:forfeit edge cases', () => {
        test('handles null player from getPlayer', async () => {
            playerService.getPlayer.mockResolvedValue(null);

            const handlers = mockSocket.on.mock.calls;
            const forfeitHandler = handlers.find(h => h[0] === 'game:forfeit');
            await forfeitHandler[1]();

            expect(mockSocket.emit).toHaveBeenCalledWith('game:error', expect.objectContaining({
                message: expect.stringContaining('host')
            }));
        });

        test('logs event for forfeit', async () => {
            playerService.getPlayer.mockResolvedValue({ isHost: true });
            gameService.forfeitGame.mockResolvedValue({
                winner: 'blue',
                forfeitingTeam: 'red',
                allTypes: ['red', 'blue', 'neutral', 'assassin']
            });

            const handlers = mockSocket.on.mock.calls;
            const forfeitHandler = handlers.find(h => h[0] === 'game:forfeit');
            await forfeitHandler[1]();

            expect(eventLogService.logEvent).toHaveBeenCalledWith(
                'TEST12',
                'GAME_OVER',
                expect.objectContaining({
                    winner: 'blue',
                    forfeitingTeam: 'red',
                    reason: 'forfeit'
                })
            );
        });
    });

    describe('game:history edge cases', () => {
        test('handles error getting history', async () => {
            gameService.getGameHistory.mockRejectedValue(new Error('History error'));

            const handlers = mockSocket.on.mock.calls;
            const historyHandler = handlers.find(h => h[0] === 'game:history');
            await historyHandler[1]();

            expect(mockSocket.emit).toHaveBeenCalledWith('game:error', expect.objectContaining({
                message: 'History error'
            }));
        });

        test('handles no roomCode', async () => {
            mockSocket.roomCode = null;

            const handlers = mockSocket.on.mock.calls;
            const historyHandler = handlers.find(h => h[0] === 'game:history');
            await historyHandler[1]();

            expect(mockSocket.emit).toHaveBeenCalledWith('game:error', expect.objectContaining({
                code: expect.any(String)
            }));
        });
    });
});
