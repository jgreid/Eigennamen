import { gameStateSchema } from '../../services/game/luaGameOps';
import type { GameState } from '../../types';

/**
 * Schema-drift guard for gameStateSchema (services/game/luaGameOps.ts).
 *
 * Zod strips unknown keys by default and the schema has no `.passthrough()`, so
 * any GameState field missing from the schema is silently erased on every read
 * and re-serialized away on every transaction write. That is exactly how the
 * `paused` flag was being dropped (A5), turning every TS-side pause guard into
 * dead code. This test makes that whole class of bug a compile/test failure:
 *
 *  - `Required<GameState>` forces the fixture to name EVERY field, so adding a
 *    new field to GameState won't type-check here until the fixture includes it.
 *  - The assertion then fails unless that field is also in the schema shape.
 */
describe('gameStateSchema drift guard', () => {
    // A fully-populated GameState — every field, required and optional.
    const fullGame: Required<GameState> = {
        id: 'game-1',
        seed: 'seed-1',
        wordListId: null,
        words: ['A', 'B', 'C'],
        wordPool: ['A', 'B', 'C', 'D'],
        types: ['red', 'blue', 'neutral'],
        revealed: [false, false, false],
        currentTurn: 'red',
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
        createdAt: 1_700_000_000_000,
        gameMode: 'classic',
        duetTypes: ['green', 'green', 'assassin'],
        timerTokens: 9,
        greenFound: 0,
        greenTotal: 15,
        cardScores: [1, 2, 3],
        revealedBy: [null, null, null],
        matchRound: 1,
        redMatchScore: 0,
        blueMatchScore: 0,
        roundStartRedMatchScore: 0,
        roundStartBlueMatchScore: 0,
        roundHistory: [],
        paused: true,
        matchOver: false,
        matchWinner: null,
        firstTeamHistory: ['red'],
    };

    test('the schema shape covers every GameState field (no silent stripping)', () => {
        const schemaKeys = new Set(Object.keys(gameStateSchema.shape));
        const missing = Object.keys(fullGame).filter((key) => !schemaKeys.has(key));
        expect(missing).toEqual([]);
    });

    test('a fully-populated game round-trips through the schema with paused preserved (A5)', () => {
        const parsed = gameStateSchema.parse(fullGame) as GameState;
        expect(parsed.paused).toBe(true);
        // Spot-check a few other fields survive too.
        expect(parsed.matchRound).toBe(1);
        expect(parsed.firstTeamHistory).toEqual(['red']);
    });
});
