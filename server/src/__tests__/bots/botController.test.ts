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
jest.mock('../../services/playerService', () => ({
    getTeamMembers: jest.fn(),
    updatePlayer: jest.fn(),
    getPlayersInRoom: jest.fn(),
    getPlayer: jest.fn(),
    // Real one-way derivation — advisor payloads carry playerId, never sessionId (N1).
    derivePlayerId: jest.requireActual('../../services/player/publicId').derivePlayerId,
}));
jest.mock('../../services/botService', () => ({ getBotConfig: jest.fn() }));
jest.mock('../../socket/safeEmit', () => ({ safeEmitToRoom: jest.fn(), safeEmitToPlayers: jest.fn() }));
jest.mock('../../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
// Mock the advisor scorer so tests can force an empty/non-empty suggestion set
// deterministically (N24 needs the empty-result path). Default: non-empty.
jest.mock('../../bots/strategies/advisor', () => ({
    suggestGuesses: jest.fn(() => [{ index: 0, confidence: 0.9, reason: 'fits' }]),
}));

const gameService = require('../../services/gameService');
const playerService = require('../../services/playerService');
const botService = require('../../services/botService');
const gameActions = require('../../socket/handlers/gameActions');
const { safeEmitToRoom, safeEmitToPlayers } = require('../../socket/safeEmit');
const { suggestGuesses } = require('../../bots/strategies/advisor');
const logger = require('../../utils/logger');
const {
    initBotController,
    stopBotController,
    tickRoom,
    reconcileClueMemory,
    botMayStillAct,
} = require('../../bots/botController');

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
        // E3: the controller resolves a room's botfulness once via getPlayersInRoom.
        // Default to a botful room so the acting-seat logic below runs as before;
        // the bot-less-skip path is covered by its own test.
        playerService.getPlayersInRoom.mockResolvedValue([spymasterBot]);
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
        suggestGuesses.mockReturnValue([{ index: 0, confidence: 0.9, reason: 'fits ANIMAL' }]);

        await tickRoom('ROOM01');

        expect(gameActions.applyReveal).not.toHaveBeenCalled();
        expect(gameActions.applyEndTurn).not.toHaveBeenCalled();
        expect(safeEmitToRoom).not.toHaveBeenCalledWith(
            expect.anything(),
            expect.anything(),
            'game:botSuggestion',
            expect.anything()
        );
        const { derivePlayerId } = jest.requireActual('../../services/player/publicId');
        expect(safeEmitToPlayers).toHaveBeenCalledWith(
            mockIo,
            redTeamMembers,
            'game:botSuggestion',
            expect.objectContaining({
                team: 'red',
                advisor: expect.objectContaining({ playerId: derivePlayerId('adv-1') }),
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

    it('resolves a bot-less room once, then skips it with zero further reads (E3)', async () => {
        playerService.getPlayersInRoom.mockResolvedValue([]); // no bots at all
        gameService.getGame.mockResolvedValue(gameNoClue);

        await tickRoom('ROOM_EMPTY');
        await tickRoom('ROOM_EMPTY');

        // Botfulness resolved exactly once; the game blob and team roster are
        // never read for a bot-less room, on this tick or the next.
        expect(playerService.getPlayersInRoom).toHaveBeenCalledTimes(1);
        expect(gameService.getGame).not.toHaveBeenCalled();
        expect(playerService.getTeamMembers).not.toHaveBeenCalled();
        expect(gameActions.applyClue).not.toHaveBeenCalled();
    });

    it('still drives a bot when the cache is cold, e.g. after a restart (E3)', async () => {
        // The room never went through addBot in this process (cache empty), yet a
        // botful room must be discovered lazily and driven — never default-denied.
        playerService.getPlayersInRoom.mockResolvedValue([spymasterBot]);
        gameService.getGame.mockResolvedValueOnce(gameNoClue).mockResolvedValue(gameWithClue);
        playerService.getTeamMembers.mockResolvedValue([spymasterBot]);
        botService.getBotConfig.mockResolvedValue({
            strategyId: 'randomSpymaster',
            skillPreset: 'intermediate',
            seed: 1,
        });

        await tickRoom('ROOM_COLD');

        expect(gameActions.applyClue).toHaveBeenCalledTimes(1);
    });

    it('does not clobber a concurrent bot:add that lands during the roster read (E3 race)', async () => {
        const { isKnownBotless, noteRoomHasBot } = require('../../bots/botRoomCache');
        // Simulate the TOCTOU: while tickRoom awaits the roster read for an unknown
        // room, a concurrent bot:add marks the room botful (noteRoomHasBot). The
        // read still reflects the pre-add state (no bots). Without the post-await
        // re-check, the stale `false` would be recorded, marking the room bot-less
        // forever and freezing the just-added bot.
        playerService.getPlayersInRoom.mockImplementation(async () => {
            noteRoomHasBot('ROOM_RACE'); // the racing addBot wins the cache
            return []; // ...but this read predates the join
        });
        gameService.getGame.mockResolvedValueOnce(gameNoClue).mockResolvedValue(gameWithClue);
        playerService.getTeamMembers.mockResolvedValue([spymasterBot]);
        botService.getBotConfig.mockResolvedValue({
            strategyId: 'randomSpymaster',
            skillPreset: 'intermediate',
            seed: 1,
        });

        await tickRoom('ROOM_RACE');

        // The bot:add write survives — the room is NOT marked bot-less, and the
        // freshly-added bot still gets to act on this very tick.
        expect(isKnownBotless('ROOM_RACE')).toBe(false);
        expect(gameActions.applyClue).toHaveBeenCalledTimes(1);
    });

    it('is a no-op before initialization', async () => {
        stopBotController();
        gameService.getGame.mockResolvedValue(gameNoClue);
        await tickRoom('ROOM01');
        expect(gameService.getGame).not.toHaveBeenCalled();
    });

    it('does not re-score an advisor room with nothing to say on repeated identical mutations (N24)', async () => {
        // A live clue with a HUMAN clicker + an advisor BOT, but the advisor has
        // no suggestion for this state (empty result). The de-dupe key must be
        // stored BEFORE the empty-result return, so a second tick on the SAME
        // state doesn't repeat getBotConfig (a Redis read) or the full scoring.
        const advisorGame = {
            ...gameNoClue,
            currentClue: { team: 'red', word: 'ANIMAL', number: 2 },
            guessesUsed: 0,
            stateVersion: 5,
        };
        const redTeamMembers = [
            { sessionId: 'human-1', nickname: 'Human', team: 'red', role: 'clicker', isBot: false, connected: true },
            { sessionId: 'adv-1', nickname: 'AdviceBot', team: 'red', role: 'advisor', isBot: true, connected: true },
        ];
        gameService.getGame.mockResolvedValue(advisorGame);
        playerService.getTeamMembers.mockResolvedValue(redTeamMembers);
        playerService.getPlayersInRoom.mockResolvedValue(redTeamMembers);
        botService.getBotConfig.mockResolvedValue({ strategyId: '', skillPreset: 'intermediate', seed: 7 });
        suggestGuesses.mockReturnValue([]); // advisor has nothing to say

        await tickRoom('ROOM01');
        await tickRoom('ROOM01'); // identical state

        // Scoring + the advisor config read happened exactly once across both ticks.
        expect(suggestGuesses).toHaveBeenCalledTimes(1);
        expect(botService.getBotConfig).toHaveBeenCalledTimes(1);
        // No suggestion emitted (nothing to say), on either tick.
        expect(safeEmitToPlayers).not.toHaveBeenCalledWith(
            expect.anything(),
            expect.anything(),
            'game:botSuggestion',
            expect.anything()
        );
    });
});

describe('botMayStillAct (N21 game-boundary guard)', () => {
    const seat = {
        sessionId: 'bot-1',
        nickname: 'SpyBot',
        team: 'red',
        role: 'spymaster',
        isBot: true,
        connected: true,
    };
    const liveGame = { id: 'game-1', gameOver: false, paused: false, currentTurn: 'red', currentClue: null };

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('returns true when the bot still holds the seat and it is the same live game', async () => {
        playerService.getPlayer.mockResolvedValue(seat);
        gameService.getGame.mockResolvedValue(liveGame);
        expect(await botMayStillAct('ROOM01', seat, 'spymaster', 'red', 'game-1')).toBe(true);
    });

    it('returns false when a DIFFERENT game started during the pause (id mismatch)', async () => {
        // A forfeit + next-round replaced the game: startNextRound mints a fresh id.
        playerService.getPlayer.mockResolvedValue(seat);
        gameService.getGame.mockResolvedValue({ ...liveGame, id: 'game-2', currentTurn: 'red' });
        expect(await botMayStillAct('ROOM01', seat, 'spymaster', 'red', 'game-1')).toBe(false);
    });

    it('returns false when the bot no longer holds the seat (removed/kicked)', async () => {
        playerService.getPlayer.mockResolvedValue(null);
        gameService.getGame.mockResolvedValue(liveGame);
        expect(await botMayStillAct('ROOM01', seat, 'spymaster', 'red', 'game-1')).toBe(false);
    });

    it('returns false when the seat was reseated to a human', async () => {
        playerService.getPlayer.mockResolvedValue({ ...seat, isBot: false });
        gameService.getGame.mockResolvedValue(liveGame);
        expect(await botMayStillAct('ROOM01', seat, 'spymaster', 'red', 'game-1')).toBe(false);
    });

    it('returns false when the game is over or paused', async () => {
        playerService.getPlayer.mockResolvedValue(seat);
        gameService.getGame.mockResolvedValue({ ...liveGame, gameOver: true });
        expect(await botMayStillAct('ROOM01', seat, 'spymaster', 'red', 'game-1')).toBe(false);

        gameService.getGame.mockResolvedValue({ ...liveGame, paused: true });
        expect(await botMayStillAct('ROOM01', seat, 'spymaster', 'red', 'game-1')).toBe(false);
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
        playerService.getPlayersInRoom.mockResolvedValue([spymasterBot]);
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

    it('does NOT force-end the turn (or warn) when a human took the stuck seat before give-up (N22)', async () => {
        // Reproduce the give-up edge: the bot fails its whole re-arm budget, but
        // during the ~7s streak the host removed the stuck bot and a HUMAN took
        // the seat. Force-ending then would end the human's healthy turn with a
        // room-visible BOT_STALLED warning. The seat re-verify must no-op instead.
        gameService.getGame.mockResolvedValue(gameNoClue); // always the spymaster's turn
        gameActions.applyClue.mockRejectedValue(new Error('persistent failure'));

        const humanSpymaster = { ...spymasterBot, isBot: false, nickname: 'RealSpy' };
        // Each of the 7 tick attempts resolves the seat once (sees the bot); the
        // final give-up call (the 8th getTeamMembers) sees a human in the seat.
        let seatReads = 0;
        playerService.getTeamMembers.mockImplementation(async () => {
            seatReads++;
            return seatReads <= 7 ? [spymasterBot] : [humanSpymaster];
        });

        await tickRoom('ROOM01');
        for (let i = 0; i < 8; i++) {
            await jest.advanceTimersByTimeAsync(2200);
        }

        // The bot exhausted its budget (7 attempts), then hit give-up…
        expect(gameActions.applyClue).toHaveBeenCalledTimes(7);
        // …but since a human now holds the seat, the turn is NOT force-ended and
        // no BOT_STALLED warning is broadcast.
        expect(gameActions.applyEndTurn).not.toHaveBeenCalled();
        expect(safeEmitToRoom).not.toHaveBeenCalledWith(
            mockIo,
            'ROOM01',
            'room:warning',
            expect.objectContaining({ code: 'BOT_STALLED' })
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
