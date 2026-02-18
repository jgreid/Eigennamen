/**
 * Tests for gameSchemas - wordList validation in gameStartSchema
 *
 * Covers the gameStartSchema.wordList refinement (lines 19-31 of gameSchemas.ts)
 * which validates word lists for control characters, minimum size, and uniqueness.
 */

const { gameStartSchema, gameHistoryLimitSchema, gameReplaySchema } = require('../../validators/gameSchemas');

describe('gameStartSchema', () => {
    const validWords = Array.from({ length: 25 }, (_, i) => `word${i}`);

    test('accepts valid word list with 25+ words', () => {
        const result = gameStartSchema.safeParse({ wordList: validWords });
        expect(result.success).toBe(true);
    });

    test('rejects word list with fewer than BOARD_SIZE words', () => {
        const result = gameStartSchema.safeParse({ wordList: ['one', 'two', 'three'] });
        expect(result.success).toBe(false);
    });

    test('rejects word list where unique count < BOARD_SIZE due to case-insensitive duplicates', () => {
        // 25 words but only a few unique ones (case-insensitive)
        const words = Array.from({ length: 25 }, (_, i) => (i % 3 === 0 ? 'Dog' : i % 3 === 1 ? 'Cat' : 'Bird'));
        const result = gameStartSchema.safeParse({ wordList: words });
        expect(result.success).toBe(false);
    });

    test('sanitizes control characters from words', () => {
        const wordsWithControl = validWords.map((w, i) =>
            i === 0 ? 'hello\x00world' : w
        );
        const result = gameStartSchema.safeParse({ wordList: wordsWithControl });
        expect(result.success).toBe(true);
        if (result.success) {
            // Control character should be stripped
            expect(result.data.wordList[0]).not.toContain('\x00');
        }
    });

    test('rejects words that become empty after sanitization', () => {
        const words = [...validWords];
        words[0] = '\x00\x01\x02'; // Only control chars — empty after sanitization
        const result = gameStartSchema.safeParse({ wordList: words });
        expect(result.success).toBe(false);
    });

    test('rejects word list exceeding 500 words', () => {
        const tooMany = Array.from({ length: 501 }, (_, i) => `word${i}`);
        const result = gameStartSchema.safeParse({ wordList: tooMany });
        expect(result.success).toBe(false);
    });

    test('accepts empty object (all fields optional)', () => {
        const result = gameStartSchema.safeParse({});
        expect(result.success).toBe(true);
    });

    test('accepts undefined input (defaults to empty object)', () => {
        const result = gameStartSchema.safeParse(undefined);
        expect(result.success).toBe(true);
    });
});

describe('gameHistoryLimitSchema', () => {
    test('accepts valid limit', () => {
        const result = gameHistoryLimitSchema.safeParse({ limit: 10 });
        expect(result.success).toBe(true);
    });

    test('rejects limit exceeding 50', () => {
        const result = gameHistoryLimitSchema.safeParse({ limit: 100 });
        expect(result.success).toBe(false);
    });

    test('rejects limit below 1', () => {
        const result = gameHistoryLimitSchema.safeParse({ limit: 0 });
        expect(result.success).toBe(false);
    });

    test('defaults limit to 10', () => {
        const result = gameHistoryLimitSchema.safeParse({});
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.limit).toBe(10);
        }
    });
});

describe('gameReplaySchema', () => {
    test('accepts valid game ID', () => {
        const result = gameReplaySchema.safeParse({ gameId: 'abc-123' });
        expect(result.success).toBe(true);
    });

    test('rejects empty game ID', () => {
        const result = gameReplaySchema.safeParse({ gameId: '' });
        expect(result.success).toBe(false);
    });

    test('sanitizes control characters in game ID', () => {
        const result = gameReplaySchema.safeParse({ gameId: 'game\x00id' });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.gameId).not.toContain('\x00');
        }
    });
});
