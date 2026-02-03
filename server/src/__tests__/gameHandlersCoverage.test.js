/**
 * Game Handlers Coverage Tests
 *
 * Covers uncovered lines in gameHandlers.js:
 * - Line 100: teamMembers null/invalid check
 * - Line 111: no connected team members
 * - Lines 172-173: save game to history after game over via reveal
 * - Line 216: no team validation in endTurn
 * - Line 240: no clue given check
 * - Line 270: forfeit when no active game
 * - Lines 321-323: game:getHistory handler
 * - Lines 332-339: game:getReplay handler
 */

// Mock Redis
const mockRedis = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    exists: jest.fn().mockResolvedValue(0),
    expire: jest.fn().mockResolvedValue(1),
    eval: jest.fn().mockResolvedValue(null),
    sAdd: jest.fn().mockResolvedValue(1),
    sRem: jest.fn().mockResolvedValue(1),
    sMembers: jest.fn().mockResolvedValue([])
};

jest.mock('../config/redis', () => ({
    getRedis: () => mockRedis,
    isUsingMemoryMode: () => true,
    isRedisHealthy: jest.fn().mockResolvedValue(true)
}));

jest.mock('../utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));

// Mock socket functions
const mockSocketFunctions = {
    stopTurnTimer: jest.fn().mockResolvedValue(),
    startTurnTimer: jest.fn().mockResolvedValue({ duration: 60 }),
    emitToRoom: jest.fn(),
    emitToPlayer: jest.fn()
};

jest.mock('../socket/socketFunctionProvider', () => ({
    getSocketFunctions: () => mockSocketFunctions
}));

// Mock services
const mockGameService = {
    createGame: jest.fn(),
    getGame: jest.fn(),
    getGameStateForPlayer: jest.fn(),
    revealCard: jest.fn(),
    giveClue: jest.fn(),
    endTurn: jest.fn(),
    forfeitGame: jest.fn(),
    getGameHistory: jest.fn()
};
jest.mock('../services/gameService', () => mockGameService);

const mockPlayerService = {
    getPlayersInRoom: jest.fn(),
    getTeamMembers: jest.fn()
};
jest.mock('../services/playerService', () => mockPlayerService);

const mockRoomService = {
    getRoom: jest.fn()
};
jest.mock('../services/roomService', () => mockRoomService);

const mockGameHistoryService = {
    getGameHistory: jest.fn(),
    getReplayEvents: jest.fn(),
    saveGameResult: jest.fn()
};
jest.mock('../services/gameHistoryService', () => mockGameHistoryService);

jest.mock('../utils/audit', () => ({
    auditGameStarted: jest.fn(),
    auditGameEnded: jest.fn()
}));

jest.mock('../utils/timeout', () => ({
    withTimeout: jest.fn((promise) => promise),
    TIMEOUTS: { GAME_ACTION: 5000 }
}));

// The context handler mocks need to extract the handler and call it
jest.mock('../socket/contextHandler', () => {
    // createHostHandler: (socket, eventName, schema, handler) => wrappedHandler
    // createRoomHandler: similar
    // createGameHandler: similar
    return {
        createHostHandler: jest.fn((socket, eventName, schema, handler) => {
            return async (data, callback) => {
                try {
                    const validated = schema ? data : data;
                    const ctx = socket._mockCtx || {};
                    await handler(ctx, validated);
                    if (callback) callback({ success: true });
                } catch (error) {
                    if (callback) callback({ error: { code: error.code || 'ERROR', message: error.message } });
                    throw error;
                }
            };
        }),
        createRoomHandler: jest.fn((socket, eventName, schema, handler) => {
            return async (data, callback) => {
                try {
                    const validated = schema ? data : data;
                    const ctx = socket._mockCtx || {};
                    await handler(ctx, validated);
                    if (callback) callback({ success: true });
                } catch (error) {
                    if (callback) callback({ error: { code: error.code || 'ERROR', message: error.message } });
                    throw error;
                }
            };
        }),
        createGameHandler: jest.fn((socket, eventName, schema, handler) => {
            return async (data, callback) => {
                try {
                    const validated = schema ? data : data;
                    const ctx = socket._mockCtx || {};
                    await handler(ctx, validated);
                    if (callback) callback({ success: true });
                } catch (error) {
                    if (callback) callback({ error: { code: error.code || 'ERROR', message: error.message } });
                    throw error;
                }
            };
        })
    };
});

// Mock errors
jest.mock('../errors/GameError', () => {
    class PlayerError extends Error {
        constructor(code, message) { super(message); this.code = code; }
        static notYourTurn(team) { return new PlayerError('NOT_YOUR_TURN', `Not ${team}'s turn`); }
        static notClicker() { return new PlayerError('NOT_CLICKER', 'Not clicker'); }
        static notSpymaster() { return new PlayerError('NOT_SPYMASTER', 'Not spymaster'); }
    }
    class GameStateError extends Error {
        constructor(code, message) { super(message); this.code = code; }
        static noActiveGame() { return new GameStateError('NO_ACTIVE_GAME', 'No active game'); }
    }
    class ValidationError extends Error {
        constructor(message) { super(message); this.code = 'VALIDATION_ERROR'; }
    }
    class RoomError extends Error {
        constructor(code, message) { super(message); this.code = code; }
        static gameInProgress(code) { return new RoomError('GAME_IN_PROGRESS', `Game in progress in ${code}`); }
    }
    return { PlayerError, GameStateError, ValidationError, RoomError };
});

jest.mock('../validators/schemas', () => ({
    gameRevealSchema: null,
    gameClueSchema: null,
    gameStartSchema: null,
    gameHistoryLimitSchema: null,
    gameReplaySchema: null
}));

// Now require the module under test
const gameHandlers = require('../socket/handlers/gameHandlers');
const { ERROR_CODES, SOCKET_EVENTS } = require('../config/constants');

describe('Game Handlers Coverage', () => {
    let socket;
    let io;
    let handlers;

    beforeEach(() => {
        jest.clearAllMocks();

        handlers = {};
        socket = {
            id: 'test-socket',
            sessionId: 'test-session',
            clientIP: '127.0.0.1',
            handshake: { address: '127.0.0.1' },
            on: jest.fn((event, handler) => {
                handlers[event] = handler;
            }),
            emit: jest.fn(),
            _mockCtx: {}
        };

        io = {
            to: jest.fn().mockReturnValue({ emit: jest.fn() })
        };

        // Register handlers
        gameHandlers(io, socket);
    });

    describe('game:reveal - teamMembers null check (line 100)', () => {
        test('throws when teamMembers returns null', async () => {
            socket._mockCtx = {
                roomCode: 'ROOM01',
                player: { team: 'red', role: 'clicker', sessionId: 'test', nickname: 'Test' },
                game: { currentTurn: 'red', gameOver: false }
            };

            mockPlayerService.getTeamMembers.mockResolvedValue(null);

            await expect(handlers[SOCKET_EVENTS.GAME_REVEAL]({ index: 0 }))
                .rejects.toThrow();
        });
    });

    describe('game:reveal - no connected team members (line 111)', () => {
        test('throws when no connected team members', async () => {
            socket._mockCtx = {
                roomCode: 'ROOM01',
                player: { team: 'red', role: 'clicker', sessionId: 'test', nickname: 'Test' },
                game: { currentTurn: 'red', gameOver: false }
            };

            mockPlayerService.getTeamMembers.mockResolvedValue([
                { role: 'clicker', connected: false },
                { role: 'spymaster', connected: false }
            ]);

            await expect(handlers[SOCKET_EVENTS.GAME_REVEAL]({ index: 0 }))
                .rejects.toThrow('No connected players');
        });
    });

    describe('game:reveal - game over saves history (lines 159-169)', () => {
        test('saves game result to history when game ends', async () => {
            socket._mockCtx = {
                roomCode: 'ROOM01',
                sessionId: 'test-session',
                player: { team: 'red', role: 'clicker', sessionId: 'test', nickname: 'Test' },
                game: { currentTurn: 'red', gameOver: false }
            };

            mockPlayerService.getTeamMembers.mockResolvedValue([
                { role: 'clicker', connected: true }
            ]);

            mockGameService.revealCard.mockResolvedValue({
                index: 0, type: 'red', word: 'APPLE',
                redScore: 9, blueScore: 8,
                currentTurn: 'red', guessesUsed: 1, guessesAllowed: 2,
                turnEnded: false, gameOver: true, winner: 'red',
                endReason: 'allCardsRevealed',
                allTypes: ['red', 'blue', 'neutral']
            });

            mockGameService.getGame.mockResolvedValue({
                words: ['APPLE'], currentTurn: 'red', gameOver: true, winner: 'red'
            });
            mockRoomService.getRoom.mockResolvedValue({
                code: 'ROOM01', settings: { teamNames: { red: 'Red', blue: 'Blue' } }
            });
            mockGameHistoryService.saveGameResult.mockResolvedValue();

            await handlers[SOCKET_EVENTS.GAME_REVEAL]({ index: 0 });

            expect(mockGameHistoryService.saveGameResult).toHaveBeenCalledWith(
                'ROOM01',
                expect.objectContaining({ winner: 'red', teamNames: { red: 'Red', blue: 'Blue' } })
            );
        });
    });

    describe('game:endTurn - no team (line 216)', () => {
        test('throws when player has no team', async () => {
            socket._mockCtx = {
                roomCode: 'ROOM01',
                player: { team: null, role: 'clicker', sessionId: 'test', nickname: 'Test' },
                game: { currentTurn: 'red', gameOver: false }
            };

            await expect(handlers[SOCKET_EVENTS.GAME_END_TURN]({}))
                .rejects.toThrow('must join a team');
        });
    });

    describe('game:endTurn - no clue given (line 240)', () => {
        test('throws when no clue has been given', async () => {
            socket._mockCtx = {
                roomCode: 'ROOM01',
                player: { team: 'red', role: 'clicker', sessionId: 'test', nickname: 'Test' },
                game: { currentTurn: 'red', gameOver: false, currentClue: null }
            };

            mockPlayerService.getTeamMembers.mockResolvedValue([
                { role: 'clicker', connected: true }
            ]);

            await expect(handlers[SOCKET_EVENTS.GAME_END_TURN]({}))
                .rejects.toThrow('clue has been given');
        });
    });

    describe('game:getHistory (lines 321-323)', () => {
        test('retrieves game history for room', async () => {
            socket._mockCtx = { roomCode: 'ROOM01' };

            const mockHistory = [{ gameId: '1', winner: 'red' }];
            mockGameHistoryService.getGameHistory.mockResolvedValue(mockHistory);

            await handlers[SOCKET_EVENTS.GAME_GET_HISTORY]({ limit: 10 });

            expect(mockGameHistoryService.getGameHistory).toHaveBeenCalledWith('ROOM01', 10);
            expect(socket.emit).toHaveBeenCalledWith(
                SOCKET_EVENTS.GAME_HISTORY_RESULT,
                { history: mockHistory }
            );
        });
    });

    describe('game:getReplay (lines 332-339)', () => {
        test('retrieves replay data for a game', async () => {
            socket._mockCtx = { roomCode: 'ROOM01' };

            const mockReplay = { gameId: 'game-1', events: [] };
            mockGameHistoryService.getReplayEvents.mockResolvedValue(mockReplay);

            await handlers[SOCKET_EVENTS.GAME_GET_REPLAY]({ gameId: 'game-1' });

            expect(mockGameHistoryService.getReplayEvents).toHaveBeenCalledWith('ROOM01', 'game-1');
            expect(socket.emit).toHaveBeenCalledWith(
                SOCKET_EVENTS.GAME_REPLAY_DATA,
                { replay: mockReplay }
            );
        });

        test('throws when replay data not found', async () => {
            socket._mockCtx = { roomCode: 'ROOM01' };
            mockGameHistoryService.getReplayEvents.mockResolvedValue(null);

            await expect(handlers[SOCKET_EVENTS.GAME_GET_REPLAY]({ gameId: 'nonexistent' }))
                .rejects.toThrow('Game not found');
        });
    });

    describe('game:forfeit - no active game (line 270)', () => {
        test('throws when no active game', async () => {
            socket._mockCtx = {
                roomCode: 'ROOM01',
                sessionId: 'test-session',
                game: null
            };

            await expect(handlers[SOCKET_EVENTS.GAME_FORFEIT]({}))
                .rejects.toThrow();
        });

        test('throws when game already over', async () => {
            socket._mockCtx = {
                roomCode: 'ROOM01',
                sessionId: 'test-session',
                game: { gameOver: true }
            };

            await expect(handlers[SOCKET_EVENTS.GAME_FORFEIT]({}))
                .rejects.toThrow();
        });
    });
});
