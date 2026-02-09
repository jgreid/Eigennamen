/**
 * Game Handlers Extended Branch Coverage Tests
 * Targets uncovered lines: 177, 246-247, 267-269, 286, 343
 *
 * Line 177: clientIP fallback to socket.handshake.address for audit
 * Lines 246-247: Duet-specific fields in reveal payload (timerTokens, greenFound)
 * Lines 267-269: Duet-specific fields in game over payload (allDuetTypes, greenFound, timerTokens)
 * Line 286: clientIpEnd fallback for game over audit
 * Line 343: teamMembers fallback to null when not array in endTurn
 */

const SAFE_ERROR_CODES_MOCK2 = ['RATE_LIMITED', 'ROOM_NOT_FOUND', 'ROOM_FULL', 'NOT_HOST', 'NOT_YOUR_TURN', 'GAME_OVER', 'INVALID_INPUT', 'CARD_ALREADY_REVEALED', 'NOT_SPYMASTER', 'NOT_CLICKER', 'NOT_AUTHORIZED', 'SESSION_EXPIRED', 'PLAYER_NOT_FOUND', 'GAME_IN_PROGRESS', 'VALIDATION_ERROR', 'CANNOT_SWITCH_TEAM_DURING_TURN', 'CANNOT_CHANGE_ROLE_DURING_TURN', 'SPYMASTER_CANNOT_CHANGE_TEAM', 'GAME_NOT_STARTED'];
jest.mock('../socket/rateLimitHandler', () => ({
    createRateLimitedHandler: jest.fn((socket: any, eventName: string, handler: any) => {
        return async (data: any) => {
            try { return await handler(data); } catch (error: any) {
                const errorEvent = `${eventName.split(':')[0]}:error`;
                const code = error.code || 'SERVER_ERROR';
                const isSafe = SAFE_ERROR_CODES_MOCK2.includes(code);
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
jest.mock('../utils/audit', () => ({
    auditGameStarted: jest.fn(),
    auditGameEnded: jest.fn()
}));

const mockStartTurnTimer2 = jest.fn().mockResolvedValue({});
const mockStopTurnTimer2 = jest.fn().mockResolvedValue(undefined);
jest.mock('../socket/socketFunctionProvider', () => ({
    getSocketFunctions: jest.fn(() => ({
        startTurnTimer: mockStartTurnTimer2,
        stopTurnTimer: mockStopTurnTimer2,
        emitToRoom: jest.fn(),
        emitToPlayer: jest.fn(),
        getTimerStatus: jest.fn().mockResolvedValue(null),
        getIO: jest.fn(),
        createTimerExpireCallback: jest.fn(() => jest.fn())
    })),
    isRegistered: jest.fn(() => true)
}));

jest.mock('../socket/safeEmit', () => ({
    safeEmitToRoom: jest.fn(),
    safeEmitToPlayers: jest.fn()
}));

const gameService = require('../services/gameService');
const playerService = require('../services/playerService');
const roomService = require('../services/roomService');
const gameHistoryService = require('../services/gameHistoryService');
const { auditGameStarted, auditGameEnded } = require('../utils/audit');
const { safeEmitToRoom, safeEmitToPlayers } = require('../socket/safeEmit');

describe('Game Handlers Extended Branch Coverage', () => {
    let mockSocket: any;
    let mockIo: any;

    beforeEach(() => {
        jest.clearAllMocks();
        mockSocket = {
            id: 'socket-ext-123',
            sessionId: 'session-ext-456',
            roomCode: 'EXTST1',
            clientIP: undefined, // Test fallback to handshake.address
            emit: jest.fn(),
            on: jest.fn(),
            join: jest.fn(),
            leave: jest.fn(),
            handshake: { address: '10.0.0.1' }
        };
        mockIo = { to: jest.fn().mockReturnThis(), emit: jest.fn() };

        playerService.getPlayer.mockResolvedValue({
            sessionId: 'session-ext-456', roomCode: 'EXTST1', nickname: 'Player1',
            team: 'red', role: 'clicker', isHost: true, connected: true
        });
        gameService.getGame.mockResolvedValue({ currentTurn: 'red', gameOver: false });

        const gameHandlers = require('../socket/handlers/gameHandlers');
        gameHandlers(mockIo, mockSocket);
    });

    describe('Line 177: clientIP fallback for game:start audit', () => {
        it('should use handshake.address when clientIP is undefined', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-ext-456', roomCode: 'EXTST1', isHost: true, team: 'red'
            });
            gameService.getGame.mockResolvedValue(null);
            gameService.createGame.mockResolvedValue({ id: 'game-1', currentTurn: 'red' });
            gameService.getGameStateForPlayer.mockReturnValue({ id: 'game-1' });
            playerService.resetRolesForNewGame.mockResolvedValue([
                { sessionId: 'session-ext-456', team: 'red', role: 'spectator' }
            ]);
            roomService.getRoom.mockResolvedValue({ settings: {} });

            const handlers = mockSocket.on.mock.calls;
            const startHandler = handlers.find((h: any) => h[0] === 'game:start');
            await startHandler[1]({});

            // Should use handshake.address since clientIP is undefined
            expect(auditGameStarted).toHaveBeenCalledWith(
                'EXTST1', 'session-ext-456', 1, '10.0.0.1'
            );
        });
    });

    describe('Lines 246-247: Duet-specific fields in reveal payload', () => {
        it('should include timerTokens and greenFound in reveal payload for Duet mode', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-ext-456', roomCode: 'EXTST1',
                role: 'clicker', team: 'red', nickname: 'Player1'
            });
            gameService.getGame.mockResolvedValue({
                currentTurn: 'red', gameOver: false, gameMode: 'duet'
            });
            playerService.getTeamMembers.mockResolvedValue([
                { sessionId: 'session-ext-456', connected: true, team: 'red', role: 'clicker' }
            ]);
            gameService.revealCard.mockResolvedValue({
                index: 3, type: 'red', word: 'WORD',
                redScore: 1, blueScore: 0, currentTurn: 'red',
                guessesUsed: 1, guessesAllowed: 3,
                turnEnded: false, gameOver: false, winner: null,
                timerTokens: 8, greenFound: 1
            });

            const handlers = mockSocket.on.mock.calls;
            const revealHandler = handlers.find((h: any) => h[0] === 'game:reveal');
            await revealHandler[1]({ index: 3 });

            expect(safeEmitToRoom).toHaveBeenCalledWith(
                mockIo, 'EXTST1', 'game:cardRevealed',
                expect.objectContaining({
                    timerTokens: 8,
                    greenFound: 1
                })
            );
        });
    });

    describe('Lines 267-269: Duet fields in game over payload', () => {
        it('should include allDuetTypes, greenFound, timerTokens in game over', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-ext-456', roomCode: 'EXTST1',
                role: 'clicker', team: 'red', nickname: 'Player1'
            });
            gameService.getGame
                .mockResolvedValueOnce({ currentTurn: 'red', gameOver: false, gameMode: 'duet' })
                .mockResolvedValueOnce({ currentTurn: 'red', gameOver: true, winner: null, gameMode: 'duet' });
            playerService.getTeamMembers.mockResolvedValue([
                { sessionId: 'session-ext-456', connected: true, team: 'red', role: 'clicker' }
            ]);
            gameService.revealCard.mockResolvedValue({
                index: 5, type: 'assassin', word: 'BOMB',
                redScore: 0, blueScore: 0, currentTurn: 'red',
                guessesUsed: 1, guessesAllowed: 3,
                turnEnded: true, gameOver: true, winner: null,
                endReason: 'assassin',
                allTypes: Array(25).fill('neutral'),
                allDuetTypes: Array(25).fill('neutral'),
                timerTokens: 7, greenFound: 2
            });
            roomService.getRoom.mockResolvedValue({ settings: { teamNames: { red: 'Red', blue: 'Blue' } } });
            gameHistoryService.saveGameResult.mockResolvedValue(undefined);

            const handlers = mockSocket.on.mock.calls;
            const revealHandler = handlers.find((h: any) => h[0] === 'game:reveal');
            await revealHandler[1]({ index: 5 });

            // Find the game:over emit call
            const gameOverCalls = safeEmitToRoom.mock.calls.filter(
                (c: any) => c[2] === 'game:over'
            );
            expect(gameOverCalls.length).toBe(1);
            expect(gameOverCalls[0][3]).toMatchObject({
                duetTypes: Array(25).fill('neutral'),
                greenFound: 2,
                timerTokens: 7
            });
        });
    });

    describe('Line 286: clientIpEnd fallback for game over audit', () => {
        it('should use handshake.address when clientIP not set for game over audit', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-ext-456', roomCode: 'EXTST1',
                role: 'clicker', team: 'red', nickname: 'Player1'
            });
            gameService.getGame
                .mockResolvedValueOnce({ currentTurn: 'red', gameOver: false })
                .mockResolvedValueOnce({ currentTurn: 'blue', gameOver: true, winner: 'blue' });
            playerService.getTeamMembers.mockResolvedValue([
                { sessionId: 'session-ext-456', connected: true, team: 'red', role: 'clicker' }
            ]);
            gameService.revealCard.mockResolvedValue({
                index: 0, type: 'assassin', word: 'BOMB',
                redScore: 0, blueScore: 0, currentTurn: 'blue',
                guessesUsed: 1, guessesAllowed: 2,
                turnEnded: true, gameOver: true, winner: 'blue',
                endReason: 'assassin', allTypes: Array(25).fill('neutral')
            });
            roomService.getRoom.mockResolvedValue({ settings: {} });
            gameHistoryService.saveGameResult.mockResolvedValue(undefined);

            const handlers = mockSocket.on.mock.calls;
            const revealHandler = handlers.find((h: any) => h[0] === 'game:reveal');
            await revealHandler[1]({ index: 0 });

            expect(auditGameEnded).toHaveBeenCalledWith(
                'EXTST1', 'session-ext-456', '10.0.0.1', 'blue', 'assassin', null
            );
        });
    });

    describe('Line 343: teamMembers null/non-array in endTurn', () => {
        it('should handle null teamMembers gracefully in endTurn', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-ext-456', roomCode: 'EXTST1',
                role: 'clicker', team: 'red', nickname: 'Player1'
            });
            gameService.getGame.mockResolvedValue({
                currentTurn: 'red', gameOver: false
            });
            playerService.getTeamMembers.mockResolvedValue(null);
            gameService.endTurn.mockResolvedValue({
                currentTurn: 'blue', previousTurn: 'red'
            });
            roomService.getRoom.mockResolvedValue({ settings: {} });

            const handlers = mockSocket.on.mock.calls;
            const endTurnHandler = handlers.find((h: any) => h[0] === 'game:endTurn');
            await endTurnHandler[1]();

            // With null teamMembers, clickerDisconnected=true, so non-spymaster can end turn
            expect(gameService.endTurn).toHaveBeenCalled();
        });
    });
});
