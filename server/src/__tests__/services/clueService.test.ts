/**
 * Tests for gameService.submitClue — the server entry point for the
 * game:clue feature. Redis (and the Lua script) are mocked; these verify the
 * service-level validation, board-word legality, and Lua error mapping.
 */
const { ERROR_CODES } = require('../../config/constants');

const mockMulti = {
    set: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue([['OK']]),
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

const mockLogger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
jest.mock('../../utils/logger', () => mockLogger);

const { submitClue } = require('../../services/gameService');

function baseGame(overrides: Record<string, unknown> = {}): string {
    return JSON.stringify({
        id: 'game-1',
        seed: 'abcdef',
        words: ['APPLE', 'RIVER', 'TIGER'],
        types: ['red', 'blue', 'neutral'],
        revealed: [false, false, false],
        currentTurn: 'red',
        redScore: 0,
        blueScore: 0,
        redTotal: 1,
        blueTotal: 1,
        gameOver: false,
        currentClue: null,
        guessesUsed: 0,
        guessesAllowed: 0,
        clues: [],
        history: [],
        stateVersion: 1,
        ...overrides,
    });
}

describe('gameService.submitClue', () => {
    beforeEach(() => {
        mockRedis.set.mockReset().mockResolvedValue('OK'); // lock acquires
        mockRedis.get.mockReset().mockResolvedValue(baseGame());
        mockRedis.del.mockReset().mockResolvedValue(1);
        mockRedis.eval.mockReset();
        mockRedis.ttl.mockResolvedValue(86400);
    });

    it('records a legal clue and returns the result', async () => {
        mockRedis.eval.mockResolvedValue(
            JSON.stringify({ success: true, word: 'FRUIT', number: 2, team: 'red', guessesAllowed: 3 })
        );

        const result = await submitClue('TEST01', 'red', 'FRUIT', 2, 'Spy');

        expect(result).toMatchObject({ word: 'FRUIT', number: 2, team: 'red', guessesAllowed: 3 });
        expect(mockRedis.eval).toHaveBeenCalled();
    });

    it('rejects a clue that matches a word on the board (before hitting Lua)', async () => {
        await expect(submitClue('TEST01', 'red', 'APPLE', 1, 'Spy')).rejects.toMatchObject({
            code: ERROR_CODES.INVALID_INPUT,
        });
    });

    it('rejects a clue that derives from a board word', async () => {
        await expect(submitClue('TEST01', 'red', 'RIVERSIDE', 1, 'Spy')).rejects.toMatchObject({
            code: ERROR_CODES.INVALID_INPUT,
        });
    });

    it('rejects when it is not the calling team’s turn', async () => {
        await expect(submitClue('TEST01', 'blue', 'FRUIT', 2, 'Spy')).rejects.toMatchObject({
            code: ERROR_CODES.NOT_YOUR_TURN,
        });
    });

    it('rejects when the game is over', async () => {
        mockRedis.get.mockResolvedValue(baseGame({ gameOver: true }));
        await expect(submitClue('TEST01', 'red', 'FRUIT', 2, 'Spy')).rejects.toMatchObject({
            code: ERROR_CODES.GAME_OVER,
        });
    });

    it('rejects when there is no active game', async () => {
        mockRedis.get.mockResolvedValue(null);
        await expect(submitClue('TEST01', 'red', 'FRUIT', 2, 'Spy')).rejects.toMatchObject({
            code: ERROR_CODES.GAME_NOT_STARTED,
        });
    });

    it('maps a CLUE_ALREADY_GIVEN Lua error to a validation error', async () => {
        mockRedis.eval.mockResolvedValue(JSON.stringify({ error: 'CLUE_ALREADY_GIVEN' }));
        await expect(submitClue('TEST01', 'red', 'FRUIT', 2, 'Spy')).rejects.toMatchObject({
            code: ERROR_CODES.INVALID_INPUT,
        });
    });

    // Bots call submitClue directly, bypassing gameClueSchema's Zod validation
    // entirely — these lock in that the service layer re-enforces the same
    // shape bounds itself (docs/HARDENING_PLAN.md P1-8), never reaching Redis.
    describe('bot-path shape validation (no Zod in front of this call)', () => {
        it('rejects an over-length clue word before ever reading game state', async () => {
            const tooLong = 'A'.repeat(41);
            await expect(submitClue('TEST01', 'red', tooLong, 2, 'Spy')).rejects.toMatchObject({
                code: ERROR_CODES.INVALID_INPUT,
            });
            // Proves the shape check runs before the game-state read (and thus
            // before submitClue.lua) — not just before the eventual response.
            // mockRedis.eval IS still called once, for withLock's own lock-release
            // script, which is unrelated to submitClue's own Lua op.
            expect(mockRedis.get).not.toHaveBeenCalled();
        });

        it('rejects a multi-word clue', async () => {
            await expect(submitClue('TEST01', 'red', 'TWO WORDS', 2, 'Spy')).rejects.toMatchObject({
                code: ERROR_CODES.INVALID_INPUT,
            });
            expect(mockRedis.get).not.toHaveBeenCalled();
        });

        it('rejects an empty clue word', async () => {
            await expect(submitClue('TEST01', 'red', '', 2, 'Spy')).rejects.toMatchObject({
                code: ERROR_CODES.INVALID_INPUT,
            });
            expect(mockRedis.get).not.toHaveBeenCalled();
        });

        it('rejects a clue number above CLUE_NUMBER_MAX', async () => {
            await expect(submitClue('TEST01', 'red', 'FRUIT', 10, 'Spy')).rejects.toMatchObject({
                code: ERROR_CODES.INVALID_INPUT,
            });
            expect(mockRedis.get).not.toHaveBeenCalled();
        });

        it('rejects a clue number below the unlimited sentinel', async () => {
            await expect(submitClue('TEST01', 'red', 'FRUIT', -2, 'Spy')).rejects.toMatchObject({
                code: ERROR_CODES.INVALID_INPUT,
            });
            expect(mockRedis.get).not.toHaveBeenCalled();
        });

        it('rejects a non-integer clue number', async () => {
            await expect(submitClue('TEST01', 'red', 'FRUIT', 1.5, 'Spy')).rejects.toMatchObject({
                code: ERROR_CODES.INVALID_INPUT,
            });
            expect(mockRedis.get).not.toHaveBeenCalled();
        });

        it('accepts a clue at exactly the boundary values (CLUE_NUMBER_MAX, max word length)', async () => {
            mockRedis.eval.mockResolvedValue(
                JSON.stringify({ success: true, word: 'A'.repeat(40), number: 9, team: 'red', guessesAllowed: 10 })
            );
            await expect(submitClue('TEST01', 'red', 'A'.repeat(40), 9, 'Spy')).resolves.toMatchObject({
                number: 9,
            });
        });
    });
});
