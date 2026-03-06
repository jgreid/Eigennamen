/**
 * Property-based tests for board generation PRNG distribution.
 *
 * Validates that across many seeds:
 * - Card type counts are correct (9+8+7+1 = 25)
 * - First team selection is roughly 50/50
 * - Word selection samples without repeats
 * - Card scores stay within configured value bounds
 * - Shuffle produces uniform-ish distribution (chi-squared test)
 */

import {
    hashString,
    seededRandom,
    generateSeed,
    generateBoardLayout,
    selectBoardWords,
    generateCardScores,
    shuffleWithSeed,
} from '../../services/game/boardGenerator';

import {
    BOARD_SIZE,
    FIRST_TEAM_CARDS,
    SECOND_TEAM_CARDS,
    NEUTRAL_CARDS,
    BOARD_VALUE_MIN,
    BOARD_VALUE_MAX,
    DEFAULT_WORDS,
} from '../../config/constants';

const SAMPLE_SIZE = 1000;

/** Generate an array of deterministic numeric seeds for testing */
function generateTestSeeds(count: number): number[] {
    return Array.from({ length: count }, (_, i) => hashString(`test-seed-${i}`));
}

describe('PRNG Distribution — seededRandom', () => {
    const seeds = generateTestSeeds(10000);

    test('outputs are in [0, 1)', () => {
        for (const seed of seeds) {
            const val = seededRandom(seed);
            expect(val).toBeGreaterThanOrEqual(0);
            expect(val).toBeLessThan(1);
        }
    });

    test('distribution is roughly uniform across 10 buckets', () => {
        const buckets = new Array(10).fill(0);
        for (const seed of seeds) {
            const val = seededRandom(seed);
            const bucket = Math.min(Math.floor(val * 10), 9);
            buckets[bucket]++;
        }
        const expected = seeds.length / 10;
        // Each bucket should have roughly 10% of values (allow 30% deviation)
        for (const count of buckets) {
            expect(count).toBeGreaterThan(expected * 0.7);
            expect(count).toBeLessThan(expected * 1.3);
        }
    });

    test('same seed produces same output (determinism)', () => {
        for (const seed of seeds.slice(0, 100)) {
            expect(seededRandom(seed)).toBe(seededRandom(seed));
        }
    });

    test('different seeds produce different outputs', () => {
        const values = new Set(seeds.slice(0, 100).map(seededRandom));
        // With 100 different seeds, we should get at least 95 unique values
        expect(values.size).toBeGreaterThan(95);
    });
});

describe('PRNG Distribution — hashString', () => {
    test('different strings produce different hashes', () => {
        const hashes = new Set<number>();
        for (let i = 0; i < 1000; i++) {
            hashes.add(hashString(`unique-string-${i}`));
        }
        // With 1000 strings and ~4B hash space, collisions should be extremely rare
        expect(hashes.size).toBeGreaterThan(990);
    });

    test('handles Unicode and emoji correctly', () => {
        const h1 = hashString('hello');
        const h2 = hashString('héllo');
        const h3 = hashString('hello 🎮');
        expect(h1).not.toBe(h2);
        expect(h1).not.toBe(h3);
        expect(h2).not.toBe(h3);
    });

    test('empty string returns 0', () => {
        expect(hashString('')).toBe(0);
    });
});

describe('PRNG Distribution — generateSeed', () => {
    test('generates unique seeds', () => {
        const seeds = new Set<string>();
        for (let i = 0; i < 100; i++) {
            seeds.add(generateSeed());
        }
        expect(seeds.size).toBe(100);
    });

    test('seeds are 12-character hex strings', () => {
        for (let i = 0; i < 20; i++) {
            const seed = generateSeed();
            expect(seed).toMatch(/^[0-9a-f]{12}$/);
        }
    });
});

describe('Board Layout Distribution', () => {
    const seeds = generateTestSeeds(SAMPLE_SIZE);

    test('every board has exactly the right card type counts', () => {
        for (const seed of seeds) {
            const layout = generateBoardLayout(seed, false);

            const redCount = layout.types.filter((t) => t === 'red').length;
            const blueCount = layout.types.filter((t) => t === 'blue').length;
            const neutralCount = layout.types.filter((t) => t === 'neutral').length;
            const assassinCount = layout.types.filter((t) => t === 'assassin').length;

            expect(layout.types.length).toBe(BOARD_SIZE);
            expect(assassinCount).toBe(1);
            expect(neutralCount).toBe(NEUTRAL_CARDS);

            // The starting team gets 9, the other gets 8
            if (layout.firstTeam === 'red') {
                expect(redCount).toBe(FIRST_TEAM_CARDS);
                expect(blueCount).toBe(SECOND_TEAM_CARDS);
            } else {
                expect(redCount).toBe(SECOND_TEAM_CARDS);
                expect(blueCount).toBe(FIRST_TEAM_CARDS);
            }
        }
    });

    test('first team selection is roughly 50/50', () => {
        let redFirst = 0;
        for (const seed of seeds) {
            const layout = generateBoardLayout(seed, false);
            if (layout.firstTeam === 'red') redFirst++;
        }
        const ratio = redFirst / SAMPLE_SIZE;
        // Should be between 40% and 60%
        expect(ratio).toBeGreaterThan(0.4);
        expect(ratio).toBeLessThan(0.6);
    });

    test('assassin position is uniformly distributed', () => {
        const positionCounts = new Array(BOARD_SIZE).fill(0);
        for (const seed of seeds) {
            const layout = generateBoardLayout(seed, false);
            const assassinIdx = layout.types.indexOf('assassin');
            positionCounts[assassinIdx]++;
        }
        const expected = SAMPLE_SIZE / BOARD_SIZE;
        // No position should have more than 3x the expected count
        for (const count of positionCounts) {
            expect(count).toBeLessThan(expected * 3);
        }
        // Every position should have the assassin at least once
        const coveredPositions = positionCounts.filter((c) => c > 0).length;
        expect(coveredPositions).toBe(BOARD_SIZE);
    });
});

describe('Word Selection Distribution', () => {
    const seeds = generateTestSeeds(SAMPLE_SIZE);
    const words = DEFAULT_WORDS;

    test('selects exactly BOARD_SIZE words per game', () => {
        for (const seed of seeds) {
            const selected = selectBoardWords(words, seed);
            expect(selected.length).toBe(BOARD_SIZE);
        }
    });

    test('no duplicate words within a single board', () => {
        for (const seed of seeds) {
            const selected = selectBoardWords(words, seed);
            expect(new Set(selected).size).toBe(BOARD_SIZE);
        }
    });

    test('word selection covers the full word list over many games', () => {
        const seen = new Set<string>();
        for (const seed of seeds) {
            const selected = selectBoardWords(words, seed);
            for (const word of selected) {
                seen.add(word);
            }
        }
        // With 1000 games of 25 words from ~400 words, we should see nearly all of them
        expect(seen.size).toBeGreaterThan(words.length * 0.9);
    });
});

describe('Card Score Distribution (Match Mode)', () => {
    const seeds = generateTestSeeds(SAMPLE_SIZE);

    test('every board has exactly BOARD_SIZE scores', () => {
        for (const seed of seeds) {
            const layout = generateBoardLayout(seed, false);
            const result = generateCardScores(seed, layout.types);
            expect(result.cardScores.length).toBe(BOARD_SIZE);
        }
    });

    test('total board value stays within configured bounds', () => {
        for (const seed of seeds) {
            const layout = generateBoardLayout(seed, false);
            const result = generateCardScores(seed, layout.types);
            const totalValue = result.cardScores.reduce((sum, s) => sum + s, 0);
            expect(totalValue).toBeGreaterThanOrEqual(BOARD_VALUE_MIN);
            expect(totalValue).toBeLessThanOrEqual(BOARD_VALUE_MAX);
        }
    });

    test('assassin score is placed at the correct position', () => {
        for (const seed of seeds.slice(0, 100)) {
            const layout = generateBoardLayout(seed, false);
            const assassinIdx = layout.types.indexOf('assassin');
            const result = generateCardScores(seed, layout.types);
            expect(result.cardScores[assassinIdx]).toBe(result.assassinScore);
        }
    });

    test('card score distribution includes variety of values', () => {
        const allScores = new Set<number>();
        for (const seed of seeds.slice(0, 100)) {
            const layout = generateBoardLayout(seed, false);
            const result = generateCardScores(seed, layout.types);
            for (const score of result.cardScores) {
                allScores.add(score);
            }
        }
        // Should see at least: -1, 0, 1, 2, 3 (the main score values)
        expect(allScores.has(0)).toBe(true);
        expect(allScores.has(1)).toBe(true);
        expect(allScores.has(2)).toBe(true);
        expect(allScores.has(3)).toBe(true);
        expect(allScores.has(-1)).toBe(true);
    });
});

describe('Shuffle Distribution', () => {
    test('shuffle is a permutation (no elements lost or duplicated)', () => {
        const arr = Array.from({ length: 25 }, (_, i) => i);
        for (let seed = 0; seed < 100; seed++) {
            const shuffled = shuffleWithSeed(arr, seed);
            expect(shuffled.length).toBe(arr.length);
            expect(new Set(shuffled).size).toBe(arr.length);
            expect([...shuffled].sort((a, b) => a - b)).toEqual(arr);
        }
    });

    test('shuffle positions are roughly uniform (chi-squared)', () => {
        const n = 10;
        const trials = 5000;
        // Count how many times each element appears in each position
        const counts: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));

        for (let seed = 0; seed < trials; seed++) {
            const arr = Array.from({ length: n }, (_, i) => i);
            const shuffled = shuffleWithSeed(arr, seed);
            for (let pos = 0; pos < n; pos++) {
                counts[shuffled[pos]][pos]++;
            }
        }

        const expected = trials / n;
        let chiSquared = 0;
        for (let elem = 0; elem < n; elem++) {
            for (let pos = 0; pos < n; pos++) {
                const diff = counts[elem][pos] - expected;
                chiSquared += (diff * diff) / expected;
            }
        }

        // Chi-squared critical value for (n-1)^2 = 81 degrees of freedom
        // at p=0.001 is ~127.3. We use a generous threshold.
        const degreesOfFreedom = (n - 1) * (n - 1);
        const criticalValue = degreesOfFreedom * 2; // Very generous threshold
        expect(chiSquared).toBeLessThan(criticalValue);
    });
});

describe('Duet Board Distribution', () => {
    const seeds = generateTestSeeds(200);

    test('duet boards have correct total card counts per side', () => {
        for (const seed of seeds) {
            const layout = generateBoardLayout(seed, true);
            expect(layout.types.length).toBe(BOARD_SIZE);
            expect(layout.duetTypes!.length).toBe(BOARD_SIZE);

            // Side A: 9 green (red), 3 assassin, 13 neutral
            const sideAGreen = layout.types.filter((t) => t === 'red').length;
            const sideAAssassin = layout.types.filter((t) => t === 'assassin').length;
            const sideANeutral = layout.types.filter((t) => t === 'neutral').length;
            expect(sideAGreen).toBe(9);
            expect(sideAAssassin).toBe(3);
            expect(sideANeutral).toBe(13);

            // Side B: 9 green (blue), 3 assassin, 13 neutral
            const sideBGreen = layout.duetTypes!.filter((t) => t === 'blue').length;
            const sideBAssassin = layout.duetTypes!.filter((t) => t === 'assassin').length;
            const sideBNeutral = layout.duetTypes!.filter((t) => t === 'neutral').length;
            expect(sideBGreen).toBe(9);
            expect(sideBAssassin).toBe(3);
            expect(sideBNeutral).toBe(13);
        }
    });
});
