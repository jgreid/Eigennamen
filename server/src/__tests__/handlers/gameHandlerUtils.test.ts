/**
 * Tests for gameHandlerUtils — specifically the toHistoryEntry mapper
 * and saveCompletedGameHistory orchestration.
 */

// Mock rate limit handler FIRST — variable names must start with `mock` for jest.mock() hoisting
const mockHelpers = require('../helpers/mocks');
const mockSafeErrorCodes = mockHelpers.SAFE_ERROR_CODES;
const mockCreateRateLimitHandler = mockHelpers.createMockRateLimitHandler;
jest.mock('../../socket/rateLimitHandler', () => ({
    createRateLimitedHandler: mockCreateRateLimitHandler(mockSafeErrorCodes),
}));

jest.mock('../../services/gameService');
jest.mock('../../services/roomService');
jest.mock('../../services/gameHistoryService', () => ({
    saveGameResult: jest.fn().mockResolvedValue({ id: 'test-game-id' }),
    getGameHistory: jest.fn().mockResolvedValue([]),
    getGameById: jest.fn().mockResolvedValue(null),
    getReplayEvents: jest.fn().mockResolvedValue({ events: [] }),
}));
jest.mock('../../utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
}));
jest.mock('../../socket/safeEmit', () => ({
    safeEmitToRoom: jest.fn(),
    safeEmitToPlayer: jest.fn(),
}));

const gameService = require('../../services/gameService');
const roomService = require('../../services/roomService');
const gameHistoryService = require('../../services/gameHistoryService');
const { safeEmitToRoom } = require('../../socket/safeEmit');

const { saveCompletedGameHistory, handleMatchRoundFinalization } = require('../../socket/handlers/gameHandlerUtils');

describe('gameHandlerUtils', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('saveCompletedGameHistory', () => {
        const baseGame = {
            id: 'game-1',
            words: Array(25).fill('word'),
            types: Array(25).fill('neutral'),
            seed: 'test-seed',
            revealed: Array(25).fill(false),
            currentTurn: 'red',
            redScore: 3,
            blueScore: 2,
            redTotal: 9,
            blueTotal: 8,
            winner: 'red',
            gameOver: true,
            createdAt: 1000,
            clues: [],
            history: [],
            wordListId: 'default',
            stateVersion: 1,
        };

        const baseRoom = {
            code: 'ABCDEF',
            settings: { teamNames: { red: 'Foxes', blue: 'Hawks' } },
        };

        it('maps reveal history entries correctly', async () => {
            const revealEntry = {
                action: 'reveal',
                index: 5,
                word: 'CASTLE',
                type: 'red',
                team: 'red',
                player: 'player-1',
                guessNumber: 2,
                timestamp: 2000,
            };
            gameService.getGame.mockResolvedValue({ ...baseGame, history: [revealEntry] });
            roomService.getRoom.mockResolvedValue(baseRoom);

            await saveCompletedGameHistory('ABCDEF');

            expect(gameHistoryService.saveGameResult).toHaveBeenCalledWith(
                'ABCDEF',
                expect.objectContaining({
                    history: [
                        {
                            action: 'reveal',
                            index: 5,
                            word: 'CASTLE',
                            type: 'red',
                            team: 'red',
                            player: 'player-1',
                            guessNumber: 2,
                            timestamp: 2000,
                        },
                    ],
                })
            );
        });

        it('maps clue history entries correctly', async () => {
            const clueEntry = {
                action: 'clue',
                team: 'blue',
                word: 'OCEAN',
                number: 3,
                guessesAllowed: 4,
                spymaster: 'spy-1',
                timestamp: 3000,
            };
            gameService.getGame.mockResolvedValue({ ...baseGame, history: [clueEntry] });
            roomService.getRoom.mockResolvedValue(baseRoom);

            await saveCompletedGameHistory('ABCDEF');

            expect(gameHistoryService.saveGameResult).toHaveBeenCalledWith(
                'ABCDEF',
                expect.objectContaining({
                    history: [
                        {
                            action: 'clue',
                            team: 'blue',
                            word: 'OCEAN',
                            number: 3,
                            guessesAllowed: 4,
                            spymaster: 'spy-1',
                            timestamp: 3000,
                        },
                    ],
                })
            );
        });

        it('maps endTurn history entries correctly', async () => {
            const endTurnEntry = {
                action: 'endTurn',
                fromTeam: 'red',
                toTeam: 'blue',
                player: 'player-2',
                timestamp: 4000,
            };
            gameService.getGame.mockResolvedValue({ ...baseGame, history: [endTurnEntry] });
            roomService.getRoom.mockResolvedValue(baseRoom);

            await saveCompletedGameHistory('ABCDEF');

            expect(gameHistoryService.saveGameResult).toHaveBeenCalledWith(
                'ABCDEF',
                expect.objectContaining({
                    history: [
                        {
                            action: 'endTurn',
                            fromTeam: 'red',
                            toTeam: 'blue',
                            player: 'player-2',
                            timestamp: 4000,
                        },
                    ],
                })
            );
        });

        it('maps forfeit history entries with winner correctly', async () => {
            const forfeitEntry = {
                action: 'forfeit',
                forfeitingTeam: 'blue',
                winner: 'red',
                timestamp: 5000,
            };
            gameService.getGame.mockResolvedValue({ ...baseGame, history: [forfeitEntry] });
            roomService.getRoom.mockResolvedValue(baseRoom);

            await saveCompletedGameHistory('ABCDEF');

            expect(gameHistoryService.saveGameResult).toHaveBeenCalledWith(
                'ABCDEF',
                expect.objectContaining({
                    history: [
                        {
                            action: 'forfeit',
                            forfeitingTeam: 'blue',
                            winner: 'red',
                            timestamp: 5000,
                        },
                    ],
                })
            );
        });

        it('maps forfeit with null winner to undefined (duet mode)', async () => {
            const forfeitEntry = {
                action: 'forfeit',
                forfeitingTeam: 'red',
                winner: null,
                timestamp: 6000,
            };
            gameService.getGame.mockResolvedValue({ ...baseGame, history: [forfeitEntry] });
            roomService.getRoom.mockResolvedValue(baseRoom);

            await saveCompletedGameHistory('ABCDEF');

            const callArgs = gameHistoryService.saveGameResult.mock.calls[0][1];
            const mappedForfeit = callArgs.history[0];
            expect(mappedForfeit.action).toBe('forfeit');
            expect(mappedForfeit.forfeitingTeam).toBe('red');
            expect(mappedForfeit.winner).toBeUndefined();
        });

        it('maps a full game history with mixed entry types', async () => {
            const history = [
                {
                    action: 'clue',
                    team: 'red',
                    word: 'FIRE',
                    number: 2,
                    guessesAllowed: 3,
                    spymaster: 'spy-r',
                    timestamp: 1000,
                },
                {
                    action: 'reveal',
                    index: 3,
                    word: 'DRAGON',
                    type: 'red',
                    team: 'red',
                    player: 'p1',
                    guessNumber: 1,
                    timestamp: 1100,
                },
                {
                    action: 'reveal',
                    index: 7,
                    word: 'LAVA',
                    type: 'neutral',
                    team: 'red',
                    player: 'p1',
                    guessNumber: 2,
                    timestamp: 1200,
                },
                {
                    action: 'endTurn',
                    fromTeam: 'red',
                    toTeam: 'blue',
                    player: 'p1',
                    timestamp: 1300,
                },
                {
                    action: 'forfeit',
                    forfeitingTeam: 'blue',
                    winner: 'red',
                    timestamp: 1400,
                },
            ];
            gameService.getGame.mockResolvedValue({ ...baseGame, history });
            roomService.getRoom.mockResolvedValue(baseRoom);

            await saveCompletedGameHistory('ABCDEF');

            const callArgs = gameHistoryService.saveGameResult.mock.calls[0][1];
            expect(callArgs.history).toHaveLength(5);
            expect(callArgs.history[0].action).toBe('clue');
            expect(callArgs.history[1].action).toBe('reveal');
            expect(callArgs.history[2].action).toBe('reveal');
            expect(callArgs.history[3].action).toBe('endTurn');
            expect(callArgs.history[4].action).toBe('forfeit');
        });

        it('extracts GameDataInput fields correctly', async () => {
            gameService.getGame.mockResolvedValue(baseGame);
            roomService.getRoom.mockResolvedValue(baseRoom);

            await saveCompletedGameHistory('ABCDEF');

            expect(gameHistoryService.saveGameResult).toHaveBeenCalledWith(
                'ABCDEF',
                expect.objectContaining({
                    id: 'game-1',
                    words: baseGame.words,
                    types: baseGame.types,
                    seed: 'test-seed',
                    redScore: 3,
                    blueScore: 2,
                    redTotal: 9,
                    blueTotal: 8,
                    winner: 'red',
                    gameOver: true,
                    createdAt: 1000,
                    teamNames: { red: 'Foxes', blue: 'Hawks' },
                    wordListId: 'default',
                    stateVersion: 1,
                })
            );
        });

        it('uses default team names when room is null', async () => {
            gameService.getGame.mockResolvedValue(baseGame);
            roomService.getRoom.mockResolvedValue(null);

            await saveCompletedGameHistory('ABCDEF');

            const callArgs = gameHistoryService.saveGameResult.mock.calls[0][1];
            expect(callArgs.teamNames).toEqual({ red: 'Red', blue: 'Blue' });
        });

        it('converts game winner null to undefined', async () => {
            gameService.getGame.mockResolvedValue({ ...baseGame, winner: null });
            roomService.getRoom.mockResolvedValue(baseRoom);

            await saveCompletedGameHistory('ABCDEF');

            const callArgs = gameHistoryService.saveGameResult.mock.calls[0][1];
            expect(callArgs.winner).toBeUndefined();
        });

        it('does not call saveGameResult when game is null', async () => {
            gameService.getGame.mockResolvedValue(null);
            roomService.getRoom.mockResolvedValue(baseRoom);

            await saveCompletedGameHistory('ABCDEF');

            expect(gameHistoryService.saveGameResult).not.toHaveBeenCalled();
        });

        it('catches and logs errors without throwing', async () => {
            gameService.getGame.mockRejectedValue(new Error('Redis down'));

            await expect(saveCompletedGameHistory('ABCDEF')).resolves.toBeUndefined();
        });
    });

    describe('handleMatchRoundFinalization', () => {
        const mockIo = {};

        beforeEach(() => {
            jest.clearAllMocks();
        });

        it('no-ops when finalizeMatchRound returns null (non-match game)', async () => {
            gameService.finalizeMatchRound.mockResolvedValue(null);

            await handleMatchRoundFinalization(mockIo, 'ROOM01');

            expect(safeEmitToRoom).not.toHaveBeenCalled();
        });

        it('emits game:matchOver when match is complete', async () => {
            gameService.finalizeMatchRound.mockResolvedValue({
                matchOver: true,
                matchWinner: 'red',
                redMatchScore: 3,
                blueMatchScore: 1,
                roundHistory: [{ winner: 'red' }, { winner: 'blue' }, { winner: 'red' }],
                roundResult: { winner: 'red', redScore: 5, blueScore: 3 },
            });

            await handleMatchRoundFinalization(mockIo, 'ROOM01');

            expect(safeEmitToRoom).toHaveBeenCalledWith(mockIo, 'ROOM01', 'game:matchOver', {
                matchWinner: 'red',
                redMatchScore: 3,
                blueMatchScore: 1,
                roundHistory: [{ winner: 'red' }, { winner: 'blue' }, { winner: 'red' }],
                roundResult: { winner: 'red', redScore: 5, blueScore: 3 },
            });
        });

        it('emits game:roundEnded when match continues', async () => {
            gameService.finalizeMatchRound.mockResolvedValue({
                matchOver: false,
                redMatchScore: 1,
                blueMatchScore: 1,
                matchRound: 3,
                roundResult: { winner: 'blue', redScore: 4, blueScore: 6 },
            });

            await handleMatchRoundFinalization(mockIo, 'ROOM01');

            expect(safeEmitToRoom).toHaveBeenCalledWith(mockIo, 'ROOM01', 'game:roundEnded', {
                roundResult: { winner: 'blue', redScore: 4, blueScore: 6 },
                redMatchScore: 1,
                blueMatchScore: 1,
                matchRound: 3,
            });
        });
    });
});
