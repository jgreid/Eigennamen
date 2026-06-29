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
});
