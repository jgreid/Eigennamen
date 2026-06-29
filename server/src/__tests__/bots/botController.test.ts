/**
 * Tests for the live botController: it drives the acting bot seat by calling the
 * shared gameActions. gameActions, services and the mutation notifier are mocked
 * so we assert dispatch behavior without real Redis/sockets.
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
jest.mock('../../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const gameService = require('../../services/gameService');
const playerService = require('../../services/playerService');
const botService = require('../../services/botService');
const gameActions = require('../../socket/handlers/gameActions');
const { initBotController, stopBotController, tickRoom } = require('../../bots/botController');

const mockIo = {};

const gameNoClue = {
    id: 'g',
    seed: 'abc',
    words: ['APPLE', 'RIVER', 'TIGER', 'MOUNTAIN'],
    types: ['red', 'red', 'blue', 'neutral'],
    revealed: [false, false, false, false],
    currentTurn: 'red',
    currentClue: null,
    gameOver: false,
    paused: false,
    stateVersion: 1,
    gameMode: 'classic',
};
const gameWithClue = { ...gameNoClue, currentClue: { team: 'red', word: 'X', number: 1 }, stateVersion: 2 };

const spymasterBot = {
    sessionId: 'bot-1',
    nickname: 'SpyBot',
    team: 'red',
    role: 'spymaster',
    isBot: true,
    connected: true,
};

describe('botController.tickRoom', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        stopBotController();
        initBotController(mockIo);
        playerService.updatePlayer.mockResolvedValue({});
    });
    afterEach(() => stopBotController());

    it('drives a bot spymaster to give a clue, then stops when no bot can act', async () => {
        // First read: spymaster's turn. Second read: a clue now exists (clicker's
        // turn) but there is no bot clicker, so the tick stops.
        gameService.getGame.mockResolvedValueOnce(gameNoClue).mockResolvedValue(gameWithClue);
        playerService.getTeamMembers.mockResolvedValue([spymasterBot]);
        botService.getBotConfig.mockResolvedValue({
            strategyId: 'randomSpymaster',
            skillPreset: 'intermediate',
            seed: 1,
        });

        await tickRoom('ROOM01');

        expect(gameActions.applyClue).toHaveBeenCalledTimes(1);
        const callArgs = gameActions.applyClue.mock.calls[0];
        expect(callArgs[1]).toBe('ROOM01');
        expect(callArgs[2]).toMatchObject({ sessionId: 'bot-1', team: 'red', role: 'spymaster' });
        expect(gameActions.applyReveal).not.toHaveBeenCalled();
        // Bot's lastSeen refreshed so it survives cleanup
        expect(playerService.updatePlayer).toHaveBeenCalledWith(
            'bot-1',
            expect.objectContaining({ lastSeen: expect.any(Number) })
        );
    });

    it('does nothing when the acting seat is a human', async () => {
        gameService.getGame.mockResolvedValue(gameNoClue);
        playerService.getTeamMembers.mockResolvedValue([{ ...spymasterBot, isBot: false }]);

        await tickRoom('ROOM01');

        expect(gameActions.applyClue).not.toHaveBeenCalled();
        expect(gameActions.applyReveal).not.toHaveBeenCalled();
        expect(gameActions.applyEndTurn).not.toHaveBeenCalled();
    });

    it('does nothing when the game is over', async () => {
        gameService.getGame.mockResolvedValue({ ...gameNoClue, gameOver: true });

        await tickRoom('ROOM01');

        expect(playerService.getTeamMembers).not.toHaveBeenCalled();
        expect(gameActions.applyClue).not.toHaveBeenCalled();
    });

    it('is a no-op before initialization', async () => {
        stopBotController();
        gameService.getGame.mockResolvedValue(gameNoClue);
        await tickRoom('ROOM01');
        expect(gameService.getGame).not.toHaveBeenCalled();
    });
});
