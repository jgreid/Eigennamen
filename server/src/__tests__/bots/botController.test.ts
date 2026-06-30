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
const logger = require('../../utils/logger');
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

describe('botController.tickRoom self-healing (re-arm)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();
        stopBotController();
        initBotController(mockIo);
        playerService.updatePlayer.mockResolvedValue({});
        botService.getBotConfig.mockResolvedValue({
            strategyId: 'randomSpymaster',
            skillPreset: 'intermediate',
            seed: 1,
        });
        playerService.getTeamMembers.mockResolvedValue([spymasterBot]);
    });
    afterEach(() => {
        stopBotController();
        jest.useRealTimers();
    });

    it('re-arms and retries when a bot action fails, recovering the cascade', async () => {
        // A failed clue must not strand the room: the only re-trigger is a game
        // mutation, and a human waiting on this clue cannot produce one.
        gameService.getGame
            .mockResolvedValueOnce(gameNoClue) // attempt 1: spymaster's turn (clue rejected)
            .mockResolvedValueOnce(gameNoClue) // retry: spymaster's turn (clue succeeds)
            .mockResolvedValue(gameWithClue); // then clicker's turn, no bot clicker -> clean stop
        gameActions.applyClue.mockRejectedValueOnce(new Error('reveal lock timeout')).mockResolvedValue({});

        await tickRoom('ROOM01');
        expect(gameActions.applyClue).toHaveBeenCalledTimes(1); // first attempt failed, tick ended

        // The backoff timer fires and the retry succeeds.
        await jest.advanceTimersByTimeAsync(300);
        expect(gameActions.applyClue).toHaveBeenCalledTimes(2);
    });

    it('stops re-arming after the failure cap instead of spinning forever', async () => {
        gameService.getGame.mockResolvedValue(gameNoClue); // always the bot spymaster's turn
        gameActions.applyClue.mockRejectedValue(new Error('persistent failure'));

        await tickRoom('ROOM01');
        // Drive every backed-off retry (delays escalate, capped at 2s each).
        for (let i = 0; i < 8; i++) {
            await jest.advanceTimersByTimeAsync(2200);
        }

        // 1 initial attempt + a bounded number of retries, then it gives up loudly.
        expect(gameActions.applyClue).toHaveBeenCalledTimes(7);
        expect(logger.error).toHaveBeenCalled();
    });
});
