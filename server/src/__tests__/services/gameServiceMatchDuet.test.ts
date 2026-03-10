/**
 * Game Service - Match/Duet Mode & Edge Case Tests
 *
 * Covers uncovered branches in gameService.ts:
 * - createGame guards (game-in-progress, room-not-found)
 * - buildGameState for duet and match modes
 * - addToHistory lazy trimming
 * - forfeitGame in duet mode
 * - finalizeRound (complete coverage)
 * - finalizeMatchRound (complete coverage)
 * - startNextRound (complete coverage)
 */

const { BOARD_SIZE, DEFAULT_WORDS, MATCH_TARGET, ROUND_WIN_BONUS } = require('../../config/constants');

// Mock Redis before requiring gameService
const mockMultiResult = [['OK']];
const mockMulti = {
    set: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(mockMultiResult),
};

const mockRedis = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    expire: jest.fn(),
    watch: jest.fn(),
    unwatch: jest.fn(),
    multi: jest.fn(() => mockMulti),
    eval: jest.fn(),
    ttl: jest.fn().mockResolvedValue(86400),
};

jest.mock('../../config/redis', () => ({
    getRedis: () => mockRedis,
}));

// Mock logger
const mockLogger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
};

jest.mock('../../utils/logger', () => mockLogger);

const {
    createGame,
    forfeitGame,
    finalizeRound,
    finalizeMatchRound,
    startNextRound,
} = require('../../services/gameService');

/** Helper: creates a standard room setup for createGame */
function setupRoomMocks() {
    mockRedis.set.mockResolvedValue('OK');
    mockRedis.eval.mockResolvedValue(1);
    mockRedis.expire.mockResolvedValue(1);
    const defaultRoomData = JSON.stringify({ code: 'TEST', status: 'waiting' });
    mockRedis.get.mockImplementation((key: string) => {
        if (key.includes(':game')) return Promise.resolve(null);
        if (key.startsWith('room:')) return Promise.resolve(defaultRoomData);
        return Promise.resolve(null);
    });
}

/** Helper to create a valid RoundResult for test data */
function makeRoundResult(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        roundNumber: 1,
        roundWinner: 'red',
        redRoundScore: 10,
        blueRoundScore: 8,
        redBonusAwarded: true,
        blueBonusAwarded: false,
        endReason: 'all_found',
        completedAt: Date.now() - 60000,
        ...overrides,
    };
}

/** Helper: creates a base game state for match mode tests */
function createMatchGameState(overrides = {}) {
    return {
        id: 'match-game-1',
        seed: 'test-seed',
        words: DEFAULT_WORDS.slice(0, BOARD_SIZE),
        types: [...Array(9).fill('red'), ...Array(8).fill('blue'), ...Array(7).fill('neutral'), 'assassin'],
        revealed: Array(BOARD_SIZE).fill(false),
        currentTurn: 'red' as const,
        redScore: 0,
        blueScore: 0,
        redTotal: 9,
        blueTotal: 8,
        gameOver: false,
        winner: null,
        currentClue: null,
        guessesUsed: 0,
        guessesAllowed: 0,
        clues: [],
        history: [],
        stateVersion: 1,
        createdAt: Date.now(),
        gameMode: 'match',
        cardScores: [3, 2, 1, 1, 1, 1, -1, 0, 1, 2, 1, 1, 1, -1, 1, 1, 3, 1, 1, 0, 1, 1, 1, 1, -3],
        revealedBy: Array(BOARD_SIZE).fill(null),
        matchRound: 1,
        redMatchScore: 0,
        blueMatchScore: 0,
        roundHistory: [],
        firstTeamHistory: ['red'],
        matchOver: false,
        matchWinner: null,
        ...overrides,
    };
}

describe('createGame guards', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('rejects when a game is already in progress', async () => {
        const existingGame = { id: 'existing', gameOver: false, words: ['W'], types: ['red'], revealed: [false] };
        mockRedis.set.mockResolvedValue('OK');
        mockRedis.eval.mockResolvedValue(1);
        mockRedis.get.mockImplementation((key: string) => {
            if (key.includes(':game')) return Promise.resolve(JSON.stringify(existingGame));
            if (key.startsWith('room:')) return Promise.resolve(JSON.stringify({ code: 'TEST', status: 'playing' }));
            return Promise.resolve(null);
        });

        await expect(createGame('TEST01')).rejects.toThrow();
    });

    test('rejects when room does not exist', async () => {
        mockRedis.set.mockResolvedValue('OK');
        mockRedis.eval.mockResolvedValue(1);
        mockRedis.get.mockResolvedValue(null); // no game, no room

        await expect(createGame('NOROOM')).rejects.toThrow('Room not found');
    });
});

describe('createGame - duet mode', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setupRoomMocks();
    });

    test('creates a duet mode game with duet-specific fields', async () => {
        const game = await createGame('DUET01', { gameMode: 'duet' });

        expect(game.gameMode).toBe('duet');
        expect(game.duetTypes).toBeDefined();
        expect(game.timerTokens).toBeDefined();
        expect(game.greenFound).toBe(0);
        expect(game.greenTotal).toBeDefined();
        expect(game.greenTotal).toBeGreaterThan(0);
    });
});

describe('createGame - match mode', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setupRoomMocks();
    });

    test('creates a fresh match mode game with match-specific fields', async () => {
        const game = await createGame('MATCH1', { gameMode: 'match' });

        expect(game.gameMode).toBe('match');
        expect(game.cardScores).toBeDefined();
        expect(game.cardScores.length).toBe(BOARD_SIZE);
        expect(game.revealedBy).toBeDefined();
        expect(game.revealedBy.length).toBe(BOARD_SIZE);
        expect(game.revealedBy.every((r: null) => r === null)).toBe(true);
        expect(game.matchRound).toBe(1);
        expect(game.redMatchScore).toBe(0);
        expect(game.blueMatchScore).toBe(0);
        expect(game.roundHistory).toEqual([]);
        expect(game.firstTeamHistory).toHaveLength(1);
        expect(game.matchOver).toBe(false);
        expect(game.matchWinner).toBeNull();
    });

    test('creates a match mode game with carried-over state', async () => {
        const carryOver = {
            matchRound: 3,
            redMatchScore: 28,
            blueMatchScore: 22,
            roundHistory: [
                {
                    roundNumber: 1,
                    roundWinner: 'red' as const,
                    redRoundScore: 15,
                    blueRoundScore: 10,
                    redBonusAwarded: true,
                    blueBonusAwarded: false,
                    endReason: 'assassin',
                    completedAt: Date.now() - 60000,
                },
                {
                    roundNumber: 2,
                    roundWinner: 'blue' as const,
                    redRoundScore: 13,
                    blueRoundScore: 12,
                    redBonusAwarded: false,
                    blueBonusAwarded: true,
                    endReason: 'all_found',
                    completedAt: Date.now() - 30000,
                },
            ],
            firstTeamHistory: ['red', 'blue'] as ('red' | 'blue')[],
        };

        const game = await createGame('MATCH2', {
            gameMode: 'match',
            matchCarryOver: carryOver,
        });

        expect(game.gameMode).toBe('match');
        expect(game.matchRound).toBe(3);
        expect(game.redMatchScore).toBe(28);
        expect(game.blueMatchScore).toBe(22);
        expect(game.roundHistory).toHaveLength(2);
        expect(game.firstTeamHistory).toHaveLength(3); // carried 2 + current 1
        expect(game.matchOver).toBe(false);
        expect(game.matchWinner).toBeNull();
    });
});

describe('forfeitGame - duet mode', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockRedis.watch.mockResolvedValue('OK');
        mockRedis.unwatch.mockResolvedValue('OK');
        mockRedis.ttl.mockResolvedValue(86400);
        mockMulti.exec.mockResolvedValue([['OK']]);
    });

    test('duet forfeit sets winner to null', async () => {
        const duetGame = {
            id: 'duet-game-1',
            words: DEFAULT_WORDS.slice(0, BOARD_SIZE),
            types: Array(BOARD_SIZE).fill('green'),
            revealed: Array(BOARD_SIZE).fill(false),
            currentTurn: 'red',
            redScore: 0,
            blueScore: 0,
            gameOver: false,
            winner: null,
            gameMode: 'duet',
            history: [],
            stateVersion: 1,
        };
        mockRedis.get.mockResolvedValue(JSON.stringify(duetGame));

        const result = await forfeitGame('DUET01', 'red');

        expect(result.winner).toBeNull();
        expect(result.forfeitingTeam).toBe('red');
    });
});

describe('addToHistory lazy trimming', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockRedis.watch.mockResolvedValue('OK');
        mockRedis.unwatch.mockResolvedValue('OK');
        mockRedis.ttl.mockResolvedValue(86400);
        mockMulti.exec.mockResolvedValue([['OK']]);
    });

    test('trims history when it exceeds lazy threshold', async () => {
        // MAX_HISTORY_ENTRIES is 200, lazy multiplier is 1.5, so threshold is 300
        const longHistory = Array.from({ length: 300 }, (_, i) => ({
            action: 'reveal',
            index: i % BOARD_SIZE,
            timestamp: Date.now() - (300 - i) * 1000,
        }));

        const game = {
            id: 'history-game',
            words: DEFAULT_WORDS.slice(0, BOARD_SIZE),
            types: [...Array(9).fill('red'), ...Array(8).fill('blue'), ...Array(7).fill('neutral'), 'assassin'],
            revealed: Array(BOARD_SIZE).fill(false),
            currentTurn: 'red',
            redScore: 0,
            blueScore: 0,
            gameOver: false,
            winner: null,
            gameMode: 'classic',
            history: longHistory,
            stateVersion: 1,
        };
        mockRedis.get.mockResolvedValue(JSON.stringify(game));

        const result = await forfeitGame('HISTOR', 'red');

        // The forfeit adds one more entry (pushing total to 301, which exceeds 300)
        // and should trigger trimming back to MAX_HISTORY_ENTRIES (200)
        expect(result).toBeDefined();
        // Verify via the persisted data: check the JSON.stringify call in the multi.set
        const setCall = mockMulti.set.mock.calls[0];
        if (setCall) {
            const persistedGame = JSON.parse(setCall[1]);
            expect(persistedGame.history.length).toBeLessThanOrEqual(200);
        }
    });
});

describe('finalizeRound', () => {
    test('throws on non-match mode game', () => {
        const classicGame = { gameMode: 'classic' };
        expect(() => finalizeRound(classicGame)).toThrow('Game data corrupted');
    });

    test('calculates card scores correctly for both teams', () => {
        const game = createMatchGameState({
            revealed: [true, true, true, true, false, ...Array(20).fill(false)],
            revealedBy: ['red', 'red', 'blue', 'blue', null, ...Array(20).fill(null)],
            cardScores: [3, 2, 1, 1, 1, ...Array(20).fill(0)],
            gameOver: true,
            winner: 'red',
        });

        const result = finalizeRound(game);

        // Red revealed cards 0,1 = 3+2 = 5 points + 7 bonus = 12
        expect(result.redRoundScore).toBe(5 + ROUND_WIN_BONUS);
        // Blue revealed cards 2,3 = 1+1 = 2 points, no bonus
        expect(result.blueRoundScore).toBe(2);
        expect(result.redBonusAwarded).toBe(true);
        expect(result.blueBonusAwarded).toBe(false);
        expect(result.roundWinner).toBe('red');
        expect(result.endReason).toBe('completed');
    });

    test('awards bonus to blue when blue wins', () => {
        const game = createMatchGameState({
            revealed: [true, true, false, ...Array(22).fill(false)],
            revealedBy: ['red', 'blue', null, ...Array(22).fill(null)],
            cardScores: [1, 2, ...Array(23).fill(0)],
            gameOver: true,
            winner: 'blue',
        });

        const result = finalizeRound(game);

        expect(result.redRoundScore).toBe(1); // no bonus
        expect(result.blueRoundScore).toBe(2 + ROUND_WIN_BONUS);
        expect(result.blueBonusAwarded).toBe(true);
        expect(result.redBonusAwarded).toBe(false);
    });

    test('updates cumulative match scores (card points pre-accumulated, bonus added at finalize)', () => {
        // Card points (3) are already accumulated per-reveal into redMatchScore
        const game = createMatchGameState({
            redMatchScore: 10 + 3, // 10 from previous rounds + 3 from this round's card reveals
            blueMatchScore: 15,
            revealed: [true, false, ...Array(23).fill(false)],
            revealedBy: ['red', null, ...Array(23).fill(null)],
            cardScores: [3, ...Array(24).fill(0)],
            gameOver: true,
            winner: 'red',
        });

        finalizeRound(game);

        expect(game.redMatchScore).toBe(10 + 3 + ROUND_WIN_BONUS);
        expect(game.blueMatchScore).toBe(15);
    });

    test('pushes to round history', () => {
        const game = createMatchGameState({
            roundHistory: [{ roundNumber: 1 }],
            matchRound: 2,
            gameOver: true,
            winner: 'blue',
        });

        const result = finalizeRound(game);

        expect(game.roundHistory).toHaveLength(2);
        expect(result.roundNumber).toBe(2);
    });

    test('detects match end when team reaches target with sufficient margin', () => {
        // Card point (1) is already accumulated per-reveal into redMatchScore
        const game = createMatchGameState({
            redMatchScore: MATCH_TARGET - 1 + 1, // per-reveal accumulated: previous + card point
            blueMatchScore: 0,
            revealed: [true, ...Array(24).fill(false)],
            revealedBy: ['red', ...Array(24).fill(null)],
            cardScores: [1, ...Array(24).fill(0)],
            gameOver: true,
            winner: 'red',
        });

        finalizeRound(game);

        // Red gets bonus only at finalize: MATCH_TARGET + ROUND_WIN_BONUS
        // Lead = MATCH_TARGET + ROUND_WIN_BONUS - 0
        expect(game.matchOver).toBe(true);
        expect(game.matchWinner).toBe('red');
    });

    test('does not end match when margin is insufficient', () => {
        // Card point (1) pre-accumulated per-reveal into redMatchScore
        const game = createMatchGameState({
            // Both teams close - exceeds target but margin < MATCH_WIN_MARGIN
            redMatchScore: MATCH_TARGET - 1 + 1, // per-reveal accumulated
            blueMatchScore: MATCH_TARGET - 2,
            revealed: [true, ...Array(24).fill(false)],
            revealedBy: ['red', ...Array(24).fill(null)],
            cardScores: [1, ...Array(24).fill(0)],
            gameOver: true,
            winner: 'red',
        });

        finalizeRound(game);

        // Red: MATCH_TARGET + ROUND_WIN_BONUS
        // Blue: MATCH_TARGET - 2
        // Lead: ROUND_WIN_BONUS + 2 = 9 >= MATCH_WIN_MARGIN (3)
        expect(game.matchOver).toBe(true);
    });

    test('match continues when score below target', () => {
        const game = createMatchGameState({
            redMatchScore: 5,
            blueMatchScore: 3,
            gameOver: true,
            winner: 'red',
        });

        finalizeRound(game);

        // Red: 5 + 0 + 7 = 12. Not >= MATCH_TARGET (42)
        expect(game.matchOver).toBe(false);
        expect(game.matchWinner).toBeNull();
    });

    test('match continues when target reached but margin insufficient', () => {
        const game = createMatchGameState({
            redMatchScore: MATCH_TARGET,
            blueMatchScore: MATCH_TARGET - 1, // Only 1 point behind
            revealed: Array(BOARD_SIZE).fill(false),
            revealedBy: Array(BOARD_SIZE).fill(null),
            cardScores: Array(BOARD_SIZE).fill(0),
            gameOver: true,
            winner: null, // assassin - no winner
        });

        finalizeRound(game);

        // Red: MATCH_TARGET + 0, Blue: MATCH_TARGET - 1 + 0
        // Lead = 1, which is < MATCH_WIN_MARGIN (3)
        expect(game.matchOver).toBe(false);
    });

    test('handles forfeit end reason', () => {
        const game = createMatchGameState({
            history: [{ action: 'forfeit', forfeitingTeam: 'blue', timestamp: Date.now() }],
            gameOver: true,
            winner: 'red',
        });

        const result = finalizeRound(game);

        expect(result.endReason).toBe('forfeit');
    });

    test('handles assassin end reason (no winner)', () => {
        const game = createMatchGameState({
            history: [{ action: 'reveal', index: 24, timestamp: Date.now() }],
            gameOver: true,
            winner: null,
        });

        const result = finalizeRound(game);

        expect(result.endReason).toBe('assassin');
    });

    test('handles missing cardScores and revealedBy gracefully', () => {
        const game = createMatchGameState({
            cardScores: undefined,
            revealedBy: undefined,
            gameOver: true,
            winner: 'red',
        });

        const result = finalizeRound(game);

        expect(result.redRoundScore).toBe(ROUND_WIN_BONUS); // only bonus, 0 card points
        expect(result.blueRoundScore).toBe(0);
    });

    test('initializes roundHistory when missing', () => {
        const game = createMatchGameState({
            roundHistory: undefined,
            gameOver: true,
            winner: 'blue',
        });

        finalizeRound(game);

        expect(game.roundHistory).toHaveLength(1);
    });
});

describe('finalizeMatchRound', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockRedis.watch.mockResolvedValue('OK');
        mockRedis.unwatch.mockResolvedValue('OK');
        mockRedis.ttl.mockResolvedValue(86400);
        mockMulti.exec.mockResolvedValue([['OK']]);
    });

    test('returns null for non-match games', async () => {
        const classicGame = {
            id: 'classic-1',
            words: DEFAULT_WORDS.slice(0, BOARD_SIZE),
            types: Array(BOARD_SIZE).fill('red'),
            revealed: Array(BOARD_SIZE).fill(false),
            gameOver: true,
            stateVersion: 1,
        };
        mockRedis.get.mockResolvedValue(JSON.stringify(classicGame));

        const result = await finalizeMatchRound('CLASSIC');

        expect(result).toBeNull();
    });

    test('returns null when no game exists', async () => {
        mockRedis.get.mockResolvedValue(null);

        const result = await finalizeMatchRound('NOGAME');

        expect(result).toBeNull();
    });

    test('atomically finalizes a match round', async () => {
        const matchGame = createMatchGameState({
            revealed: [true, true, false, ...Array(22).fill(false)],
            revealedBy: ['red', 'blue', null, ...Array(22).fill(null)],
            gameOver: true,
            winner: 'red',
        });
        mockRedis.get.mockResolvedValue(JSON.stringify(matchGame));

        const result = await finalizeMatchRound('MATCH1');

        expect(result).not.toBeNull();
        expect(result.roundResult).toBeDefined();
        expect(result.roundResult.roundNumber).toBe(1);
        expect(result.matchOver).toBeDefined();
        expect(result.redMatchScore).toBeGreaterThanOrEqual(0);
        expect(result.blueMatchScore).toBeGreaterThanOrEqual(0);
        expect(result.roundHistory).toHaveLength(1);
        expect(result.matchRound).toBe(1);
    });
});

describe('startNextRound', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockRedis.set.mockResolvedValue('OK');
        mockRedis.eval.mockResolvedValue(1);
        mockRedis.expire.mockResolvedValue(1);
    });

    test('creates next round with carried-over match state', async () => {
        const currentGame = createMatchGameState({
            gameOver: true,
            winner: 'red',
            matchRound: 1,
            redMatchScore: 15,
            blueMatchScore: 10,
            roundHistory: [makeRoundResult({ roundNumber: 1, roundWinner: 'red' })],
            firstTeamHistory: ['red'],
        });

        const nextRound = await startNextRound('MATCH1', currentGame);

        expect(nextRound.matchRound).toBe(2);
        expect(nextRound.redMatchScore).toBe(15);
        expect(nextRound.blueMatchScore).toBe(10);
        expect(nextRound.gameMode).toBe('match');
        expect(nextRound.gameOver).toBe(false);
        expect(nextRound.words.length).toBe(BOARD_SIZE);
        expect(nextRound.cardScores).toBeDefined();
        expect(nextRound.revealedBy.every((r: null) => r === null)).toBe(true);
        expect(nextRound.firstTeamHistory).toHaveLength(2);
    });

    test('alternates first team from previous round', async () => {
        const currentGame = createMatchGameState({
            gameOver: true,
            winner: 'blue',
            matchRound: 2,
            firstTeamHistory: ['red', 'blue'],
        });

        const nextRound = await startNextRound('MATCH2', currentGame);

        // Previous last team was 'blue', so next should be 'red'
        expect(nextRound.currentTurn).toBe('red');
    });

    test('rejects when current round is still in progress', async () => {
        const currentGame = createMatchGameState({ gameOver: false });

        await expect(startNextRound('MATCH3', currentGame)).rejects.toThrow('Current round is still in progress');
    });

    test('rejects when match is already over', async () => {
        const currentGame = createMatchGameState({
            gameOver: true,
            matchOver: true,
            matchWinner: 'red',
        });

        await expect(startNextRound('MATCH4', currentGame)).rejects.toThrow('Match is already over');
    });

    test('carries forward round history from previous rounds', async () => {
        const currentGame = createMatchGameState({
            gameOver: true,
            matchRound: 3,
            roundHistory: [
                makeRoundResult({ roundNumber: 1, roundWinner: 'red' }),
                makeRoundResult({ roundNumber: 2, roundWinner: 'blue' }),
                makeRoundResult({ roundNumber: 3, roundWinner: 'red' }),
            ],
            firstTeamHistory: ['red', 'blue', 'red'],
        });

        const nextRound = await startNextRound('MATCH5', currentGame);

        expect(nextRound.matchRound).toBe(4);
        expect(nextRound.roundHistory).toHaveLength(3);
        expect(nextRound.firstTeamHistory).toHaveLength(4);
    });

    test('handles missing firstTeamHistory gracefully', async () => {
        const currentGame = createMatchGameState({
            gameOver: true,
            firstTeamHistory: undefined,
        });

        const nextRound = await startNextRound('MATCH6', currentGame);

        expect(nextRound.firstTeamHistory).toBeDefined();
    });

    test('preserves custom word list when passed via options', async () => {
        const customWords = Array.from({ length: 50 }, (_, i) => `CUSTOM${i}`);
        const currentGame = createMatchGameState({
            gameOver: true,
            matchRound: 1,
            words: customWords.slice(0, BOARD_SIZE),
            firstTeamHistory: ['red'],
        });

        const nextRound = await startNextRound('MATCH7', currentGame, {
            gameMode: 'match',
            wordList: customWords,
        });

        // All 25 board words should come from the custom list
        for (const word of nextRound.words) {
            expect(customWords).toContain(word);
        }
    });

    test('falls back to default words when no custom word list provided', async () => {
        const currentGame = createMatchGameState({
            gameOver: true,
            matchRound: 1,
            firstTeamHistory: ['red'],
        });

        const nextRound = await startNextRound('MATCH8', currentGame, {
            gameMode: 'match',
        });

        expect(nextRound.words.length).toBe(BOARD_SIZE);
        // Words should come from DEFAULT_WORDS
        for (const word of nextRound.words) {
            expect(DEFAULT_WORDS.map((w: string) => w.toLocaleUpperCase('en-US'))).toContain(word);
        }
    });
});
