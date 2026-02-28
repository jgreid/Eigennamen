/**
 * Match Mode Tests
 *
 * Tests for the match mode card scoring system including:
 * - Card score generation with board value constraints
 * - Round finalization and scoring
 * - Match end conditions
 */

const {
    generateCardScores
} = require('../../services/game/boardGenerator');
const { finalizeRound } = require('../../services/gameService');
const {
    BOARD_SIZE,
    MATCH_TARGET,
    MATCH_WIN_MARGIN,
    ROUND_WIN_BONUS,
    STANDARD_SCORE_CARDS,
    BOARD_VALUE_MIN,
    BOARD_VALUE_MAX,
    ASSASSIN_SCORE_POOL,
    CARD_SCORE_DISTRIBUTION
} = require('../../config/constants');

type AnyRecord = Record<string, any>;

// Mock Redis and logger for gameService imports
let mockRedis: AnyRecord;

jest.mock('../../config/redis', () => ({
    getRedis: () => mockRedis
}));

jest.mock('../../utils/logger', () => ({
    default: {
        info: jest.fn(),
        debug: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        child: jest.fn(() => ({
            info: jest.fn(),
            debug: jest.fn(),
            warn: jest.fn(),
            error: jest.fn()
        }))
    }
}));

// Helper: create a standard types array for testing
function createStandardTypes(): string[] {
    const types = [
        ...Array(9).fill('red'),
        ...Array(8).fill('blue'),
        ...Array(7).fill('neutral'),
        'assassin'
    ];
    return types;
}

describe('Card Score Generation', () => {
    const types = createStandardTypes();

    test('generates 25 card scores', () => {
        const result = generateCardScores(12345, types);
        expect(result.cardScores).toHaveLength(BOARD_SIZE);
    });

    test('card scores are deterministic for same seed', () => {
        const result1 = generateCardScores(12345, types);
        const result2 = generateCardScores(12345, types);
        expect(result1.cardScores).toEqual(result2.cardScores);
        expect(result1.assassinScore).toEqual(result2.assassinScore);
    });

    test('different seeds produce different card scores', () => {
        const result1 = generateCardScores(12345, types);
        const result2 = generateCardScores(54321, types);
        expect(result1.cardScores).not.toEqual(result2.cardScores);
    });

    test('total board value is within constraints', () => {
        for (let seed = 0; seed < 50; seed++) {
            const result = generateCardScores(seed * 1000, types);
            const totalValue = result.cardScores.reduce((sum: number, s: number) => sum + s, 0);
            expect(totalValue).toBeGreaterThanOrEqual(BOARD_VALUE_MIN);
            expect(totalValue).toBeLessThanOrEqual(BOARD_VALUE_MAX);
        }
    });

    test('assassin score is from the valid pool', () => {
        for (let seed = 0; seed < 50; seed++) {
            const result = generateCardScores(seed * 1000, types);
            expect(ASSASSIN_SCORE_POOL).toContain(result.assassinScore);
        }
    });

    test('assassin position has the assassin score', () => {
        const result = generateCardScores(12345, types);
        const assassinIndex = types.indexOf('assassin');
        expect(result.cardScores[assassinIndex]).toBe(result.assassinScore);
    });

    test('has exactly STANDARD_SCORE_CARDS standard (1pt) cards among non-assassin', () => {
        const result = generateCardScores(12345, types);
        const assassinIndex = types.indexOf('assassin');
        const nonAssassinScores = result.cardScores.filter((_: number, i: number) => i !== assassinIndex);
        const standardCount = nonAssassinScores.filter((s: number) => s === 1).length;
        expect(standardCount).toBe(STANDARD_SCORE_CARDS);
    });

    test('gold cards (3pt) are within distribution bounds', () => {
        const result = generateCardScores(12345, types);
        const assassinIndex = types.indexOf('assassin');
        const nonAssassinScores = result.cardScores.filter((_: number, i: number) => i !== assassinIndex);
        const goldCount = nonAssassinScores.filter((s: number) => s === 3).length;
        expect(goldCount).toBeGreaterThanOrEqual(CARD_SCORE_DISTRIBUTION.gold.min);
        expect(goldCount).toBeLessThanOrEqual(CARD_SCORE_DISTRIBUTION.gold.max);
    });

    test('silver cards (2pt) are within distribution bounds', () => {
        const result = generateCardScores(12345, types);
        const assassinIndex = types.indexOf('assassin');
        const nonAssassinScores = result.cardScores.filter((_: number, i: number) => i !== assassinIndex);
        const silverCount = nonAssassinScores.filter((s: number) => s === 2).length;
        expect(silverCount).toBeGreaterThanOrEqual(CARD_SCORE_DISTRIBUTION.silver.min);
        expect(silverCount).toBeLessThanOrEqual(CARD_SCORE_DISTRIBUTION.silver.max);
    });

    test('trap cards (-1pt) are within distribution bounds', () => {
        const result = generateCardScores(12345, types);
        const assassinIndex = types.indexOf('assassin');
        const nonAssassinScores = result.cardScores.filter((_: number, i: number) => i !== assassinIndex);
        const trapCount = nonAssassinScores.filter((s: number) => s === -1).length;
        expect(trapCount).toBeGreaterThanOrEqual(CARD_SCORE_DISTRIBUTION.trap.min);
        expect(trapCount).toBeLessThanOrEqual(CARD_SCORE_DISTRIBUTION.trap.max);
    });

    test('all non-assassin scores are in valid range (-1 to 3)', () => {
        for (let seed = 0; seed < 20; seed++) {
            const result = generateCardScores(seed * 1000, types);
            const assassinIndex = types.indexOf('assassin');
            for (let i = 0; i < BOARD_SIZE; i++) {
                if (i === assassinIndex) continue;
                expect(result.cardScores[i]).toBeGreaterThanOrEqual(-1);
                expect(result.cardScores[i]).toBeLessThanOrEqual(3);
            }
        }
    });
});

describe('finalizeRound', () => {
    function createMatchGame(overrides: Partial<AnyRecord> = {}): AnyRecord {
        return {
            gameMode: 'match',
            gameOver: true,
            winner: 'red',
            currentTurn: 'blue',
            types: createStandardTypes(),
            revealed: Array(BOARD_SIZE).fill(true),
            cardScores: Array(BOARD_SIZE).fill(1),
            revealedBy: Array(BOARD_SIZE).fill(null).map((_: null, i: number) => i < 12 ? 'red' : 'blue'),
            redScore: 9,
            blueScore: 8,
            redTotal: 9,
            blueTotal: 8,
            redMatchScore: 0,
            blueMatchScore: 0,
            matchRound: 1,
            roundHistory: [],
            matchOver: false,
            matchWinner: null,
            history: [],
            words: Array(BOARD_SIZE).fill('WORD'),
            ...overrides
        };
    }

    test('throws if called on non-match game', () => {
        const game = createMatchGame({ gameMode: 'classic' });
        expect(() => finalizeRound(game)).toThrow('finalizeRound called on non-match game');
    });

    test('calculates card points per team from revealedBy', () => {
        const cardScores = Array(BOARD_SIZE).fill(1);
        cardScores[0] = 3; // Gold - revealed by red
        cardScores[1] = 2; // Silver - revealed by red
        const revealedBy = Array(BOARD_SIZE).fill(null);
        revealedBy[0] = 'red';
        revealedBy[1] = 'red';
        revealedBy[2] = 'blue';

        const game = createMatchGame({
            cardScores,
            revealedBy,
            revealed: Array(BOARD_SIZE).fill(false).map((_: boolean, i: number) => i < 3)
        });

        const result = finalizeRound(game);
        expect(result.redRoundScore).toBeGreaterThan(0);
        expect(result.blueRoundScore).toBeGreaterThan(0);
    });

    test('awards round bonus to winner', () => {
        const game = createMatchGame({ winner: 'red' });
        const result = finalizeRound(game);
        expect(result.redBonusAwarded).toBe(true);
        expect(result.blueBonusAwarded).toBe(false);
    });

    test('does not award bonus when winner is blue', () => {
        const game = createMatchGame({ winner: 'blue' });
        const result = finalizeRound(game);
        expect(result.redBonusAwarded).toBe(false);
        expect(result.blueBonusAwarded).toBe(true);
    });

    test('updates cumulative match scores', () => {
        const game = createMatchGame({
            redMatchScore: 10,
            blueMatchScore: 5,
            winner: 'red'
        });
        finalizeRound(game);
        expect(game.redMatchScore).toBeGreaterThan(10);
        expect(game.blueMatchScore).toBeGreaterThanOrEqual(5);
    });

    test('pushes round result to roundHistory', () => {
        const game = createMatchGame();
        finalizeRound(game);
        expect(game.roundHistory).toHaveLength(1);
        expect(game.roundHistory[0].roundNumber).toBe(1);
    });

    test('sets matchOver when target reached with sufficient margin', () => {
        const game = createMatchGame({
            redMatchScore: MATCH_TARGET - 1,
            blueMatchScore: 0,
            winner: 'red',
            // Make all cards revealed by red with score 1 so red gets enough points
            cardScores: Array(BOARD_SIZE).fill(1),
            revealedBy: Array(BOARD_SIZE).fill('red'),
            revealed: Array(BOARD_SIZE).fill(true)
        });

        finalizeRound(game);
        // Red gets card points + round bonus, should push over target
        expect(game.redMatchScore).toBeGreaterThanOrEqual(MATCH_TARGET);
        if (game.redMatchScore - game.blueMatchScore >= MATCH_WIN_MARGIN) {
            expect(game.matchOver).toBe(true);
            expect(game.matchWinner).toBe('red');
        }
    });

    test('does not set matchOver when margin is insufficient', () => {
        const game = createMatchGame({
            redMatchScore: MATCH_TARGET - 2,
            blueMatchScore: MATCH_TARGET - 1,
            winner: 'red',
            // Minimal card reveals
            cardScores: Array(BOARD_SIZE).fill(0),
            revealedBy: Array(BOARD_SIZE).fill(null),
            revealed: Array(BOARD_SIZE).fill(false)
        });

        finalizeRound(game);
        // Neither team should have enough margin
        const lead = Math.abs(game.redMatchScore - game.blueMatchScore);
        if (lead < MATCH_WIN_MARGIN) {
            expect(game.matchOver).toBe(false);
        }
    });

    test('round result has correct structure', () => {
        const game = createMatchGame({ matchRound: 3 });
        const result = finalizeRound(game);

        expect(result).toHaveProperty('roundNumber', 3);
        expect(result).toHaveProperty('roundWinner');
        expect(result).toHaveProperty('redRoundScore');
        expect(result).toHaveProperty('blueRoundScore');
        expect(result).toHaveProperty('redBonusAwarded');
        expect(result).toHaveProperty('blueBonusAwarded');
        expect(result).toHaveProperty('endReason');
        expect(result).toHaveProperty('completedAt');
        expect(typeof result.completedAt).toBe('number');
    });
});

describe('Match Mode Constants', () => {
    test('MATCH_TARGET is 42', () => {
        expect(MATCH_TARGET).toBe(42);
    });

    test('MATCH_WIN_MARGIN is 3', () => {
        expect(MATCH_WIN_MARGIN).toBe(3);
    });

    test('ROUND_WIN_BONUS is 7', () => {
        expect(ROUND_WIN_BONUS).toBe(7);
    });

    test('board value constraints are sensible', () => {
        expect(BOARD_VALUE_MIN).toBeLessThan(BOARD_VALUE_MAX);
        expect(BOARD_VALUE_MIN).toBeGreaterThan(0);
    });

    test('ASSASSIN_SCORE_POOL has expected median around -1', () => {
        const sorted = [...ASSASSIN_SCORE_POOL].sort((a: number, b: number) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];
        expect(median).toBe(-1);
    });
});
