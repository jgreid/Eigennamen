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
jest.mock('../../socket/safeEmit', () => ({ safeEmitToRoom: jest.fn(), safeEmitToPlayers: jest.fn() }));
jest.mock('../../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const gameService = require('../../services/gameService');
const playerService = require('../../services/playerService');
const botService = require('../../services/botService');
const gameActions = require('../../socket/handlers/gameActions');
const { safeEmitToRoom, safeEmitToPlayers } = require('../../socket/safeEmit');
const logger = require('../../utils/logger');
const { initBotController, stopBotController, tickRoom, reconcileClueMemory } = require('../../bots/botController');

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

    it('degrades to a default config (and still acts) when getBotConfig returns null, instead of stalling (B4)', async () => {
        // A seated bot whose config key was lost/corrupted. The old code broke the
        // tick cleanly here — no move, no re-arm — freezing the game on the bot's
        // turn. It must now fall back to a default config and still act.
        gameService.getGame.mockResolvedValueOnce(gameNoClue).mockResolvedValue(gameWithClue);
        playerService.getTeamMembers.mockResolvedValue([spymasterBot]);
        botService.getBotConfig.mockResolvedValue(null);

        await tickRoom('ROOM01');

        // The bot still gives a clue — the turn is not silently stalled.
        expect(gameActions.applyClue).toHaveBeenCalledTimes(1);
        expect(gameActions.applyClue.mock.calls[0][2]).toMatchObject({ sessionId: 'bot-1', role: 'spymaster' });
        // And the degradation is logged for operators.
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('no resolvable config'));
    });

    it('emits advisor suggestions to the acting team only, never room-wide', async () => {
        // A live clue, a HUMAN clicker, and an advisor BOT on the team: the advisor
        // should surface ranked suggestions (game:botSuggestion) to red's own
        // members only — never via a room-wide broadcast the opposing team or
        // spectators would also receive. See docs/HARDENING_PLAN.md P0-5.
        const advisorGame = {
            ...gameNoClue,
            words: ['BEAR', 'RIVER', 'TIGER', 'MOUNTAIN'],
            currentClue: { team: 'red', word: 'ANIMAL', number: 2 },
            guessesUsed: 0,
            stateVersion: 3,
        };
        const redTeamMembers = [
            { sessionId: 'human-1', nickname: 'Human', team: 'red', role: 'clicker', isBot: false, connected: true },
            { sessionId: 'adv-1', nickname: 'AdviceBot', team: 'red', role: 'advisor', isBot: true, connected: true },
        ];
        gameService.getGame.mockResolvedValue(advisorGame);
        playerService.getTeamMembers.mockResolvedValue(redTeamMembers);

        await tickRoom('ROOM01');

        expect(gameActions.applyReveal).not.toHaveBeenCalled();
        expect(gameActions.applyEndTurn).not.toHaveBeenCalled();
        expect(safeEmitToRoom).not.toHaveBeenCalledWith(
            expect.anything(),
            expect.anything(),
            'game:botSuggestion',
            expect.anything()
        );
        expect(safeEmitToPlayers).toHaveBeenCalledWith(
            mockIo,
            redTeamMembers,
            'game:botSuggestion',
            expect.objectContaining({
                team: 'red',
                advisor: expect.objectContaining({ sessionId: 'adv-1' }),
                suggestions: expect.arrayContaining([expect.objectContaining({ index: 0 })]), // BEAR fits ANIMAL
            })
        );
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

    it('stops re-arming after the failure cap, forces the stuck turn to end, and warns the room', async () => {
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

        // Ticking is mutation-driven and it's the stuck bot's own turn, so nothing
        // else would ever unstick the game — giving up must force the turn to end
        // (docs/HARDENING_PLAN.md P1-6) rather than leaving it silently frozen.
        expect(gameActions.applyEndTurn).toHaveBeenCalledTimes(1);
        expect(gameActions.applyEndTurn).toHaveBeenCalledWith(
            mockIo,
            'ROOM01',
            expect.objectContaining({ team: 'red' })
        );
        expect(safeEmitToRoom).toHaveBeenCalledWith(
            mockIo,
            'ROOM01',
            'room:warning',
            expect.objectContaining({ code: 'BOT_STALLED', team: 'red' })
        );
    });

    it('resets the failure streak on the next successful action after a prior (non-fatal) failure', async () => {
        // Locks in the assumption the give-up logic depends on: a success must
        // fully clear backoff state, not just avoid re-arming this one time.
        gameService.getGame
            .mockResolvedValueOnce(gameNoClue) // attempt 1: fails
            .mockResolvedValueOnce(gameNoClue) // retry: succeeds
            .mockResolvedValue(gameWithClue); // then clicker's turn, no bot clicker -> clean stop
        gameActions.applyClue.mockRejectedValueOnce(new Error('transient')).mockResolvedValue({});

        await tickRoom('ROOM01');
        await jest.advanceTimersByTimeAsync(300); // first backed-off retry succeeds

        expect(gameActions.applyClue).toHaveBeenCalledTimes(2);

        // If the streak weren't cleared on success, a single subsequent failure would
        // immediately be treated as one attempt closer to the already-exhausted cap
        // instead of a fresh budget.
        gameActions.applyClue.mockReset().mockRejectedValue(new Error('persistent failure'));
        gameService.getGame.mockReset().mockResolvedValue(gameNoClue);

        await tickRoom('ROOM01');
        for (let i = 0; i < 8; i++) {
            await jest.advanceTimersByTimeAsync(2200);
        }
        // A full fresh set of retries (not just 1 more before giving up) proves the
        // streak restarted from zero rather than continuing from the earlier failure.
        expect(gameActions.applyClue).toHaveBeenCalledTimes(7);
    });
});

describe('clue-debt tracker (reconcileClueMemory, Phase 4.3)', () => {
    beforeEach(() => {
        stopBotController(); // clears tracker state between tests
    });

    const base = {
        seed: 'game-1',
        gameMode: 'classic',
        words: ['APPLE', 'RIVER', 'TIGER', 'MOUNTAIN'],
        types: ['red', 'red', 'blue', 'neutral'],
    };

    it('finalizes a clue with promised-vs-taken and the bounce flag when the clue ends', () => {
        // FRUIT 2 arrives on a fresh board…
        reconcileClueMemory('R1', {
            ...base,
            revealed: [false, false, false, false],
            currentClue: { team: 'red', word: 'FRUIT', number: 2 },
        });
        // …one own card and one blue card were revealed under it, then it ended.
        const tracker = reconcileClueMemory('R1', {
            ...base,
            revealed: [true, false, true, false],
            currentClue: null,
        });
        expect(tracker.clues.red).toEqual([{ word: 'FRUIT', number: 2, taken: 1, bounced: true }]);
        expect(tracker.clues.blue).toEqual([]);
    });

    it('a clean under-delivery records debt without a bounce', () => {
        reconcileClueMemory('R2', {
            ...base,
            revealed: [false, false, false, false],
            currentClue: { team: 'red', word: 'FRUIT', number: 2 },
        });
        const tracker = reconcileClueMemory('R2', {
            ...base,
            revealed: [true, false, false, false],
            currentClue: { team: 'blue', word: 'WATER', number: 1 },
        });
        expect(tracker.clues.red).toEqual([{ word: 'FRUIT', number: 2, taken: 1, bounced: false }]);
    });

    it('evicts the oldest room beyond the tracking cap (leak guard)', () => {
        // Register a live clue for the first room, then flood the tracker
        // with more rooms than the cap. The first room's tracker must be
        // evicted: reconciling it again yields a FRESH tracker (no finalized
        // entry from the pre-eviction clue) instead of unbounded growth.
        reconcileClueMemory('EVICT0', {
            ...base,
            revealed: [false, false, false, false],
            currentClue: { team: 'red', word: 'FRUIT', number: 2 },
        });
        for (let i = 1; i <= 500; i++) {
            reconcileClueMemory(`EVICT${i}`, {
                ...base,
                revealed: [false, false, false, false],
                currentClue: null,
            });
        }
        const tracker = reconcileClueMemory('EVICT0', {
            ...base,
            revealed: [true, false, false, false],
            currentClue: null,
        });
        expect(tracker.live).toBeNull();
        expect(tracker.clues.red).toEqual([]);
    });

    it('resets on a new game and stays empty in duet', () => {
        reconcileClueMemory('R3', {
            ...base,
            revealed: [false, false, false, false],
            currentClue: { team: 'red', word: 'FRUIT', number: 2 },
        });
        // New game seed: the old live clue must not leak into the new game.
        const fresh = reconcileClueMemory('R3', {
            ...base,
            seed: 'game-2',
            revealed: [true, false, false, false],
            currentClue: null,
        });
        expect(fresh.clues.red).toEqual([]);

        const duet = reconcileClueMemory('R4', {
            ...base,
            gameMode: 'duet',
            revealed: [false, false, false, false],
            currentClue: { team: 'red', word: 'FRUIT', number: 2 },
        });
        expect(duet.live).toBeNull();
        expect(duet.clues.red).toEqual([]);
    });
});
