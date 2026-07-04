/**
 * Regression test for the Duet blue-side advisor "ownRemaining" bug (P1-11):
 * emitAdvisorSuggestions computed "own cards remaining" from game.types
 * unconditionally, but in Duet mode blue's own greens live only in
 * duetTypes — so a blue-side advisor always saw ownRemaining=0 and tripped
 * the late-stretch warning from turn one. This mocks strategies/advisor's
 * suggestGuesses directly (unlike botController.test.ts, which exercises the
 * real semantic backend) so the exact ownRemaining value botController
 * computes can be asserted without depending on real clue-scoring internals.
 */
jest.mock('../../socket/gameMutationNotifier', () => ({
    onGameMutation: jest.fn(() => () => {}),
    notifyGameMutation: jest.fn(),
}));
jest.mock('../../socket/handlers/gameActions', () => ({
    applyClue: jest.fn().mockResolvedValue({}),
    applyReveal: jest.fn().mockResolvedValue({}),
    applyEndTurn: jest.fn().mockResolvedValue({}),
}));
jest.mock('../../services/gameService', () => ({ getGame: jest.fn() }));
jest.mock('../../services/playerService', () => ({ getTeamMembers: jest.fn(), updatePlayer: jest.fn() }));
jest.mock('../../services/botService', () => ({ getBotConfig: jest.fn() }));
jest.mock('../../socket/safeEmit', () => ({ safeEmitToRoom: jest.fn(), safeEmitToPlayers: jest.fn() }));
jest.mock('../../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock('../../bots/strategies/advisor', () => ({ suggestGuesses: jest.fn().mockReturnValue([]) }));

const gameService = require('../../services/gameService');
const playerService = require('../../services/playerService');
const botService = require('../../services/botService');
const { suggestGuesses } = require('../../bots/strategies/advisor');
const { initBotController, stopBotController, tickRoom } = require('../../bots/botController');

const mockIo = {};

describe('botController Duet blue-side advisor ownRemaining (P1-11)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        stopBotController();
        initBotController(mockIo);
        playerService.updatePlayer.mockResolvedValue({});
        botService.getBotConfig.mockResolvedValue({
            strategyId: 'randomSpymaster',
            skillPreset: 'intermediate',
            seed: 1,
        });
        suggestGuesses.mockReturnValue([]);
    });
    afterEach(() => stopBotController());

    it('counts ownRemaining from duetTypes (not types) for a blue-side advisor', async () => {
        // types[] (red's perspective) has ZERO 'blue' entries — as it would in a
        // real Duet board, since blue's own greens are encoded as 'blue' only in
        // duetTypes[], not in types[]. duetTypes[] has 10 unrevealed 'blue' cards.
        const duetGame = {
            id: 'g-duet',
            seed: 'duet-seed',
            words: Array.from({ length: 10 }, (_, i) => `WORD${i}`),
            types: Array(10).fill('red'),
            duetTypes: Array(10).fill('blue'),
            revealed: Array(10).fill(false),
            currentTurn: 'blue',
            currentClue: { team: 'blue', word: 'ANIMAL', number: 2 },
            guessesUsed: 0,
            gameOver: false,
            paused: false,
            stateVersion: 7,
            gameMode: 'duet',
        };
        const blueTeamMembers = [
            { sessionId: 'human-1', nickname: 'Human', team: 'blue', role: 'clicker', isBot: false, connected: true },
            { sessionId: 'adv-1', nickname: 'AdviceBot', team: 'blue', role: 'advisor', isBot: true, connected: true },
        ];
        gameService.getGame.mockResolvedValue(duetGame);
        playerService.getTeamMembers.mockResolvedValue(blueTeamMembers);

        await tickRoom('ROOM_DUET');

        expect(suggestGuesses).toHaveBeenCalledTimes(1);
        const advisorCtxArg = suggestGuesses.mock.calls[0][5];
        // Bug would report 0 (counted from types[], which has no 'blue' entries).
        expect(advisorCtxArg).toEqual({ ownRemaining: 10 });
    });

    it('still counts from types[] (not duetTypes) for a red-side advisor in Duet', async () => {
        const duetGame = {
            id: 'g-duet-red',
            seed: 'duet-seed-2',
            words: Array.from({ length: 10 }, (_, i) => `WORD${i}`),
            types: Array(10).fill('red'),
            duetTypes: Array(10).fill('blue'),
            revealed: Array(10).fill(false),
            currentTurn: 'red',
            currentClue: { team: 'red', word: 'ANIMAL', number: 2 },
            guessesUsed: 0,
            gameOver: false,
            paused: false,
            stateVersion: 3,
            gameMode: 'duet',
        };
        const redTeamMembers = [
            { sessionId: 'human-2', nickname: 'Human', team: 'red', role: 'clicker', isBot: false, connected: true },
            { sessionId: 'adv-2', nickname: 'AdviceBot', team: 'red', role: 'advisor', isBot: true, connected: true },
        ];
        gameService.getGame.mockResolvedValue(duetGame);
        playerService.getTeamMembers.mockResolvedValue(redTeamMembers);

        await tickRoom('ROOM_DUET_RED');

        expect(suggestGuesses).toHaveBeenCalledTimes(1);
        const advisorCtxArg = suggestGuesses.mock.calls[0][5];
        expect(advisorCtxArg).toEqual({ ownRemaining: 10 });
    });

    it('counts ownRemaining from types[] for a classic-mode advisor (unaffected by the duet branch)', async () => {
        const classicGame = {
            id: 'g-classic',
            seed: 'classic-seed',
            words: Array.from({ length: 10 }, (_, i) => `WORD${i}`),
            types: [...Array(4).fill('blue'), ...Array(6).fill('red')],
            revealed: Array(10).fill(false),
            currentTurn: 'blue',
            currentClue: { team: 'blue', word: 'ANIMAL', number: 2 },
            guessesUsed: 0,
            gameOver: false,
            paused: false,
            stateVersion: 2,
            gameMode: 'classic',
        };
        const blueTeamMembers = [
            { sessionId: 'human-3', nickname: 'Human', team: 'blue', role: 'clicker', isBot: false, connected: true },
            { sessionId: 'adv-3', nickname: 'AdviceBot', team: 'blue', role: 'advisor', isBot: true, connected: true },
        ];
        gameService.getGame.mockResolvedValue(classicGame);
        playerService.getTeamMembers.mockResolvedValue(blueTeamMembers);

        await tickRoom('ROOM_CLASSIC');

        expect(suggestGuesses).toHaveBeenCalledTimes(1);
        const advisorCtxArg = suggestGuesses.mock.calls[0][5];
        expect(advisorCtxArg).toEqual({ ownRemaining: 4 });
    });
});
