/**
 * Extended Game Handlers Tests
 * Tests additional edge cases and code paths to improve coverage
 */

// Mock rate limit handler FIRST to bypass rate limiting
const SAFE_ERROR_CODES_MOCK = ['RATE_LIMITED', 'ROOM_NOT_FOUND', 'ROOM_FULL', 'NOT_HOST', 'NOT_YOUR_TURN', 'GAME_OVER', 'INVALID_INPUT', 'CARD_ALREADY_REVEALED', 'NOT_SPYMASTER', 'NOT_CLICKER', 'NOT_AUTHORIZED', 'SESSION_EXPIRED', 'PLAYER_NOT_FOUND', 'GAME_IN_PROGRESS', 'VALIDATION_ERROR', 'CANNOT_SWITCH_TEAM_DURING_TURN', 'CANNOT_CHANGE_ROLE_DURING_TURN', 'SPYMASTER_CANNOT_CHANGE_TEAM', 'GAME_NOT_STARTED'];
jest.mock('../socket/rateLimitHandler', () => ({
    createRateLimitedHandler: jest.fn((socket, eventName, handler) => { return async (data) => { try { return await handler(data); } catch (error) { const errorEvent = `${eventName.split(':')[0]}:error`; const code = error.code || 'SERVER_ERROR'; const isSafe = SAFE_ERROR_CODES_MOCK.includes(code); socket.emit(errorEvent, { code, message: isSafe ? (error.message || 'An unexpected error occurred') : 'An unexpected error occurred' }); } }; })
}));

// Mock dependencies
jest.mock('../services/gameService');
jest.mock('../services/playerService');
jest.mock('../services/roomService');
jest.mock('../services/gameHistoryService', () => ({
    saveGameResult: jest.fn().mockResolvedValue({ gameId: 'test-game-id' }),
    getGameHistory: jest.fn().mockResolvedValue([]),
    getGameById: jest.fn().mockResolvedValue(null),
    getReplayEvents: jest.fn().mockResolvedValue({ events: [] })
}));
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
            join: jest.fn(),
            leave: jest.fn(),
            handshake: {
                headers: { 'x-forwarded-for': '192.168.1.1' },
                address: '127.0.0.1'
            }
        };

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

        gameHandlers = require('../socket/handlers/gameHandlers').default;
        gameHandlers(mockIo, mockSocket);
    });

    describe('game:start edge cases', () => {
        test('handles emit error for individual players', async () => {
            playerService.getPlayer.mockResolvedValue({ sessionId: 'session-456', roomCode: 'TEST12', isHost: true, team: 'red' });
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
                message: expect.stringContaining('must be in a room')
            }));
        });

        test('uses socket handshake address when x-forwarded-for not present', async () => {
            mockSocket.handshake.headers = {};

            playerService.getPlayer.mockResolvedValue({ sessionId: 'session-456', roomCode: 'TEST12', isHost: true, team: 'red' });
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

    describe('game:reveal rule enforcement', () => {
        test('spymaster cannot reveal cards even when clicker is disconnected', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-456',
                roomCode: 'TEST12',
                role: 'spymaster',
                team: 'red',
                nickname: 'Spymaster1'
            });
            gameService.getGame.mockResolvedValue({ currentTurn: 'red' });
            // Clicker is disconnected
            playerService.getTeamMembers.mockResolvedValue([
                { sessionId: 'session-456', connected: true, team: 'red', role: 'spymaster' },
                { sessionId: 'session-789', connected: false, team: 'red', role: 'clicker' }
            ]);

            const handlers = mockSocket.on.mock.calls;
            const revealHandler = handlers.find(h => h[0] === 'game:reveal');
            await revealHandler[1]({ index: 5 });

            expect(mockSocket.emit).toHaveBeenCalledWith('game:error', expect.objectContaining({
                message: expect.stringContaining('Spymasters cannot reveal')
            }));
            expect(gameService.revealCard).not.toHaveBeenCalled();
        });

        test('non-clicker team member can reveal when clicker is disconnected', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-456',
                roomCode: 'TEST12',
                role: 'spectator',
                team: 'red',
                nickname: 'TeamMember1'
            });
            gameService.getGame.mockResolvedValue({ currentTurn: 'red' });
            // Clicker is disconnected
            playerService.getTeamMembers.mockResolvedValue([
                { sessionId: 'session-456', connected: true, team: 'red', role: 'spectator' },
                { sessionId: 'session-789', connected: false, team: 'red', role: 'clicker' }
            ]);
            gameService.revealCard.mockResolvedValue({
                index: 5, type: 'red', word: 'TEST',
                redScore: 1, blueScore: 0, currentTurn: 'red',
                turnEnded: false, gameOver: false,
                guessesUsed: 1, guessesAllowed: 3
            });
            gameService.getGameStateForPlayer.mockReturnValue({ id: 'game-1' });
            playerService.getPlayersInRoom.mockResolvedValue([
                { sessionId: 'session-456', team: 'red', role: 'spectator' }
            ]);
            roomService.getRoom.mockResolvedValue({ settings: {} });

            const handlers = mockSocket.on.mock.calls;
            const revealHandler = handlers.find(h => h[0] === 'game:reveal');
            await revealHandler[1]({ index: 5 });

            expect(gameService.revealCard).toHaveBeenCalledWith('TEST12', 5, 'TeamMember1', 'red');
        });

        test('non-clicker cannot reveal when clicker is connected', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-456',
                roomCode: 'TEST12',
                role: 'spectator',
                team: 'red',
                nickname: 'TeamMember1'
            });
            gameService.getGame.mockResolvedValue({ currentTurn: 'red' });
            // Clicker is connected
            playerService.getTeamMembers.mockResolvedValue([
                { sessionId: 'session-456', connected: true, team: 'red', role: 'spectator' },
                { sessionId: 'session-789', connected: true, team: 'red', role: 'clicker' }
            ]);

            const handlers = mockSocket.on.mock.calls;
            const revealHandler = handlers.find(h => h[0] === 'game:reveal');
            await revealHandler[1]({ index: 5 });

            expect(mockSocket.emit).toHaveBeenCalledWith('game:error', expect.objectContaining({
                message: expect.stringContaining('clicker')
            }));
            expect(gameService.revealCard).not.toHaveBeenCalled();
        });

        test('rejects reveal when getTeamMembers returns invalid data', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-456',
                roomCode: 'TEST12',
                role: 'clicker',
                team: 'red',
                nickname: 'Clicker1'
            });
            gameService.getGame.mockResolvedValue({ currentTurn: 'red' });
            playerService.getTeamMembers.mockResolvedValue(null);

            const handlers = mockSocket.on.mock.calls;
            const revealHandler = handlers.find(h => h[0] === 'game:reveal');
            await revealHandler[1]({ index: 5 });

            // SERVER_ERROR code is not in the safe error list, so message gets scrubbed
            expect(mockSocket.emit).toHaveBeenCalledWith('game:error', expect.objectContaining({
                code: 'SERVER_ERROR'
            }));
            expect(gameService.revealCard).not.toHaveBeenCalled();
        });
    });

    describe('game:reveal edge cases', () => {
        test('handles turn ending with timer restart', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-456',
                roomCode: 'TEST12',
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
                sessionId: 'session-456',
                roomCode: 'TEST12',
                role: 'clicker',
                team: 'red',
                nickname: 'Clicker1'
            });
            gameService.getGame.mockResolvedValue(null);

            const handlers = mockSocket.on.mock.calls;
            const revealHandler = handlers.find(h => h[0] === 'game:reveal');
            await revealHandler[1]({ index: 5 });

            expect(mockSocket.emit).toHaveBeenCalledWith('game:error', expect.objectContaining({
                message: expect.stringContaining('active game')
            }));
        });

        test('handles null player from getPlayer', async () => {
            playerService.getPlayer.mockResolvedValue(null);

            const handlers = mockSocket.on.mock.calls;
            const revealHandler = handlers.find(h => h[0] === 'game:reveal');
            await revealHandler[1]({ index: 5 });

            expect(mockSocket.emit).toHaveBeenCalledWith('game:error', expect.objectContaining({
                message: expect.stringContaining('must be in a room')
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
                message: expect.stringContaining('must be in a room')
            }));
        });

        test('handles no roomCode', async () => {
            mockSocket.roomCode = null;
            playerService.getPlayer.mockResolvedValue(null);

            const handlers = mockSocket.on.mock.calls;
            const clueHandler = handlers.find(h => h[0] === 'game:clue');
            await clueHandler[1]({ word: 'test', number: 2 });

            expect(mockSocket.emit).toHaveBeenCalledWith('game:error', expect.objectContaining({
                code: expect.any(String)
            }));
        });

        test('logs event for clue', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-456',
                roomCode: 'TEST12',
                role: 'spymaster',
                team: 'red',
                nickname: 'Spymaster1'
            });
            gameService.getGame.mockResolvedValue({
                gameOver: false,
                currentTurn: 'red'
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

            expect(gameService.giveClue).toHaveBeenCalled();
        });
    });

    describe('game:endTurn edge cases', () => {
        test('handles null player from getPlayer', async () => {
            playerService.getPlayer.mockResolvedValue(null);

            const handlers = mockSocket.on.mock.calls;
            const endTurnHandler = handlers.find(h => h[0] === 'game:endTurn');
            await endTurnHandler[1]();

            expect(mockSocket.emit).toHaveBeenCalledWith('game:error', expect.objectContaining({
                message: expect.stringContaining('must be in a room')
            }));
        });

        test('handles null game state', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-456',
                roomCode: 'TEST12',
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
                sessionId: 'session-456',
                roomCode: 'TEST12',
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
            roomService.getRoom.mockResolvedValue({ settings: { turnTimer: 90 } });

            const handlers = mockSocket.on.mock.calls;
            const endTurnHandler = handlers.find(h => h[0] === 'game:endTurn');
            await endTurnHandler[1]();

            expect(roomService.getRoom).toHaveBeenCalledWith('TEST12');
        });

        test('logs event for turn end', async () => {
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
            roomService.getRoom.mockResolvedValue({ settings: {} });

            const handlers = mockSocket.on.mock.calls;
            const endTurnHandler = handlers.find(h => h[0] === 'game:endTurn');
            await endTurnHandler[1]();

            expect(gameService.endTurn).toHaveBeenCalled();
        });
    });

    describe('game:forfeit edge cases', () => {
        test('handles null player from getPlayer', async () => {
            playerService.getPlayer.mockResolvedValue(null);

            const handlers = mockSocket.on.mock.calls;
            const forfeitHandler = handlers.find(h => h[0] === 'game:forfeit');
            await forfeitHandler[1]();

            expect(mockSocket.emit).toHaveBeenCalledWith('game:error', expect.objectContaining({
                message: expect.stringContaining('must be in a room')
            }));
        });

        test('logs event for forfeit', async () => {
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

            expect(gameService.forfeitGame).toHaveBeenCalled();
        });
    });

    describe('game:endTurn rule enforcement', () => {
        test('spymaster cannot end turn even when clicker is disconnected', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-456',
                roomCode: 'TEST12',
                role: 'spymaster',
                team: 'red',
                nickname: 'Spymaster1'
            });
            gameService.getGame.mockResolvedValue({ currentTurn: 'red', currentClue: { word: 'test', number: 2 } });
            playerService.getTeamMembers.mockResolvedValue([
                { sessionId: 'session-456', connected: true, team: 'red', role: 'spymaster' },
                { sessionId: 'session-789', connected: false, team: 'red', role: 'clicker' }
            ]);

            const handlers = mockSocket.on.mock.calls;
            const endTurnHandler = handlers.find(h => h[0] === 'game:endTurn');
            await endTurnHandler[1]();

            expect(mockSocket.emit).toHaveBeenCalledWith('game:error', expect.objectContaining({
                message: expect.stringContaining('Spymasters cannot end turns')
            }));
            expect(gameService.endTurn).not.toHaveBeenCalled();
        });

        test('rejects endTurn when player has no team', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-456',
                roomCode: 'TEST12',
                role: 'spectator',
                team: null,
                nickname: 'Spectator1'
            });
            gameService.getGame.mockResolvedValue({ currentTurn: 'red' });

            const handlers = mockSocket.on.mock.calls;
            const endTurnHandler = handlers.find(h => h[0] === 'game:endTurn');
            await endTurnHandler[1]();

            expect(mockSocket.emit).toHaveBeenCalledWith('game:error', expect.objectContaining({
                message: expect.stringContaining('join a team')
            }));
            expect(gameService.endTurn).not.toHaveBeenCalled();
        });
    });

    describe('game:forfeit rule enforcement', () => {
        test('rejects forfeit when no active game', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-456',
                roomCode: 'TEST12',
                isHost: true
            });
            gameService.getGame.mockResolvedValue({ gameOver: true });

            const handlers = mockSocket.on.mock.calls;
            const forfeitHandler = handlers.find(h => h[0] === 'game:forfeit');
            await forfeitHandler[1]();

            expect(mockSocket.emit).toHaveBeenCalledWith('game:error', expect.objectContaining({
                code: 'GAME_NOT_STARTED',
                message: 'No active game'
            }));
            expect(gameService.forfeitGame).not.toHaveBeenCalled();
        });
    });

    describe('game:reveal no connected team members', () => {
        test('rejects reveal when all team members are disconnected', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-456',
                roomCode: 'TEST12',
                role: 'clicker',
                team: 'red',
                nickname: 'Clicker1'
            });
            gameService.getGame.mockResolvedValue({ currentTurn: 'red' });
            // All team members disconnected (except the current player is marked connected
            // but the filter checks p.connected)
            playerService.getTeamMembers.mockResolvedValue([
                { sessionId: 'session-456', connected: false, team: 'red', role: 'clicker' }
            ]);

            const handlers = mockSocket.on.mock.calls;
            const revealHandler = handlers.find(h => h[0] === 'game:reveal');
            await revealHandler[1]({ index: 5 });

            expect(mockSocket.emit).toHaveBeenCalledWith('game:error', expect.objectContaining({
                code: 'SERVER_ERROR'
            }));
            expect(gameService.revealCard).not.toHaveBeenCalled();
        });
    });

    describe('game:getHistory and game:getReplay', () => {
        const gameHistoryService = require('../services/gameHistoryService');

        test('retrieves past game history with limit', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-456',
                roomCode: 'TEST12',
                nickname: 'Player1'
            });
            gameHistoryService.getGameHistory.mockResolvedValue([
                { gameId: 'g1', winner: 'red' },
                { gameId: 'g2', winner: 'blue' }
            ]);

            const handlers = mockSocket.on.mock.calls;
            const getHistoryHandler = handlers.find(h => h[0] === 'game:getHistory');
            await getHistoryHandler[1]({ limit: 10 });

            expect(gameHistoryService.getGameHistory).toHaveBeenCalledWith('TEST12', 10);
            expect(mockSocket.emit).toHaveBeenCalledWith('game:historyResult', expect.objectContaining({
                history: expect.arrayContaining([expect.objectContaining({ gameId: 'g1' })])
            }));
        });

        test('retrieves replay data for a specific game', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-456',
                roomCode: 'TEST12',
                nickname: 'Player1'
            });
            gameHistoryService.getReplayEvents.mockResolvedValue({
                gameId: 'g1',
                events: [{ type: 'reveal', index: 3 }]
            });

            const handlers = mockSocket.on.mock.calls;
            const getReplayHandler = handlers.find(h => h[0] === 'game:getReplay');
            await getReplayHandler[1]({ gameId: 'g1' });

            expect(gameHistoryService.getReplayEvents).toHaveBeenCalledWith('TEST12', 'g1');
            expect(mockSocket.emit).toHaveBeenCalledWith('game:replayData', expect.objectContaining({
                replay: expect.objectContaining({ gameId: 'g1' })
            }));
        });

        test('returns error when replay data not found', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-456',
                roomCode: 'TEST12',
                nickname: 'Player1'
            });
            gameHistoryService.getReplayEvents.mockResolvedValue(null);

            const handlers = mockSocket.on.mock.calls;
            const getReplayHandler = handlers.find(h => h[0] === 'game:getReplay');
            await getReplayHandler[1]({ gameId: 'nonexistent' });

            expect(mockSocket.emit).toHaveBeenCalledWith('game:error', expect.objectContaining({
                code: 'GAME_NOT_STARTED'
            }));
        });
    });

    describe('game:history edge cases', () => {
        test('handles error getting history', async () => {
            gameService.getGameHistory.mockRejectedValue(new Error('History error'));

            const handlers = mockSocket.on.mock.calls;
            const historyHandler = handlers.find(h => h[0] === 'game:history');
            await historyHandler[1]();

            expect(mockSocket.emit).toHaveBeenCalledWith('game:error', expect.objectContaining({
                message: 'An unexpected error occurred'
            }));
        });

        test('handles no roomCode', async () => {
            mockSocket.roomCode = null;
            playerService.getPlayer.mockResolvedValue(null);

            const handlers = mockSocket.on.mock.calls;
            const historyHandler = handlers.find(h => h[0] === 'game:history');
            await historyHandler[1]();

            expect(mockSocket.emit).toHaveBeenCalledWith('game:error', expect.objectContaining({
                code: expect.any(String)
            }));
        });
    });
});
