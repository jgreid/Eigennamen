import type { CardType } from '../../types';

import crypto from 'crypto';
import { GameStateError } from '../../errors/GameError';
import {
    BOARD_SIZE,
    FIRST_TEAM_CARDS,
    SECOND_TEAM_CARDS,
    NEUTRAL_CARDS,
    GAME_INTERNALS,
    DUET_BOARD_CONFIG,
    STANDARD_SCORE_CARDS,
    CARD_SCORE_DISTRIBUTION,
    BOARD_VALUE_MIN,
    BOARD_VALUE_MAX,
    ASSASSIN_SCORE_POOL,
} from '../../config/constants';

/**
 * Seeded random number generator using Mulberry32 algorithm
 * Provides better distribution than Math.sin-based approach
 * Must stay in sync with client-side implementation in index.html
 */
export function seededRandom(seed: number): number {
    let t = (seed + 0x6d2b79f5) | 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * Hash string to number
 * Uses codePointAt to properly handle Unicode characters including emoji
 */
export function hashString(str: string): number {
    let hash = 0;
    for (const char of str) {
        const codePoint = char.codePointAt(0);
        if (codePoint !== undefined) {
            hash = (hash << 5) - hash + codePoint;
            hash = hash & hash;
        }
    }
    return Math.abs(hash);
}

/**
 * Shuffle array with seed
 */
export function shuffleWithSeed<T>(array: T[], seed: number): T[] {
    const shuffled = [...array];
    let currentSeed = seed;
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(seededRandom(currentSeed++) * (i + 1));
        const temp = shuffled[i];
        const swapItem = shuffled[j];
        if (temp !== undefined && swapItem !== undefined) {
            shuffled[i] = swapItem;
            shuffled[j] = temp;
        }
    }
    return shuffled;
}

/**
 * Generate a random game seed using crypto for better randomness
 */
export function generateSeed(): string {
    try {
        return crypto.randomBytes(6).toString('hex');
    } catch {
        // Fallback: use crypto.randomUUID() which is available in Node 19+.
        // This avoids Math.random() which is not cryptographically secure.
        return crypto.randomUUID().replace(/-/g, '').substring(0, 12);
    }
}

/**
 * Generate Duet mode board with dual key cards
 * Side A (types[]): 9 green (as 'red'), 3 assassin, 13 bystander (as 'neutral')
 * Side B (duetTypes[]): 9 green (as 'blue'), 3 assassin, 13 bystander (as 'neutral')
 */
export function generateDuetBoard(seed: number): { types: CardType[]; duetTypes: CardType[] } {
    const { greenOverlap, greenOnlyA, greenOnlyB, assassinOverlap, assassinOnlyA, assassinOnlyB, bystanderBoth } =
        DUET_BOARD_CONFIG;

    const pairs: [CardType, CardType][] = [
        ...Array(greenOverlap)
            .fill(null)
            .map((): [CardType, CardType] => ['red', 'blue']),
        ...Array(greenOnlyA)
            .fill(null)
            .map((): [CardType, CardType] => ['red', 'neutral']),
        ...Array(greenOnlyB)
            .fill(null)
            .map((): [CardType, CardType] => ['neutral', 'blue']),
        ...Array(assassinOverlap)
            .fill(null)
            .map((): [CardType, CardType] => ['assassin', 'assassin']),
        ...Array(assassinOnlyA)
            .fill(null)
            .map((): [CardType, CardType] => ['assassin', 'neutral']),
        ...Array(assassinOnlyB)
            .fill(null)
            .map((): [CardType, CardType] => ['neutral', 'assassin']),
        ...Array(bystanderBoth)
            .fill(null)
            .map((): [CardType, CardType] => ['neutral', 'neutral']),
    ];

    const shuffledPairs = shuffleWithSeed(pairs, seed);

    const types: CardType[] = shuffledPairs.map((p) => p[0]);
    const duetTypes: CardType[] = shuffledPairs.map((p) => p[1]);

    return { types, duetTypes };
}

export interface BoardLayout {
    types: CardType[];
    duetTypes?: CardType[];
    redTotal: number;
    blueTotal: number;
    firstTeam: 'red' | 'blue';
}

/**
 * Generate a complete board layout given a seed and game mode
 */
export function generateBoardLayout(numericSeed: number, isDuet: boolean): BoardLayout {
    const firstTeam: 'red' | 'blue' =
        seededRandom(numericSeed + GAME_INTERNALS.FIRST_TEAM_SEED_OFFSET) > 0.5 ? 'red' : 'blue';

    if (isDuet) {
        const duetBoard = generateDuetBoard(numericSeed + GAME_INTERNALS.TYPES_SHUFFLE_SEED_OFFSET);
        return {
            types: duetBoard.types,
            duetTypes: duetBoard.duetTypes,
            redTotal: DUET_BOARD_CONFIG.greenOverlap + DUET_BOARD_CONFIG.greenOnlyA,
            blueTotal: DUET_BOARD_CONFIG.greenOverlap + DUET_BOARD_CONFIG.greenOnlyB,
            firstTeam,
        };
    }

    let types: CardType[];
    let redTotal: number;
    let blueTotal: number;

    if (firstTeam === 'red') {
        types = [
            ...(Array(FIRST_TEAM_CARDS).fill('red') as CardType[]),
            ...(Array(SECOND_TEAM_CARDS).fill('blue') as CardType[]),
        ];
        redTotal = FIRST_TEAM_CARDS;
        blueTotal = SECOND_TEAM_CARDS;
    } else {
        types = [
            ...(Array(SECOND_TEAM_CARDS).fill('red') as CardType[]),
            ...(Array(FIRST_TEAM_CARDS).fill('blue') as CardType[]),
        ];
        redTotal = SECOND_TEAM_CARDS;
        blueTotal = FIRST_TEAM_CARDS;
    }
    types = [...types, ...(Array(NEUTRAL_CARDS).fill('neutral') as CardType[]), 'assassin'];

    if (types.length !== BOARD_SIZE) {
        throw GameStateError.corrupted('board-generation', {
            reason: `card types count (${types.length}) does not match BOARD_SIZE (${BOARD_SIZE})`,
        });
    }

    types = shuffleWithSeed(types, numericSeed + GAME_INTERNALS.TYPES_SHUFFLE_SEED_OFFSET);

    return { types, redTotal, blueTotal, firstTeam };
}

/**
 * Select board words from a word list using a seed
 */
export function selectBoardWords(words: string[], numericSeed: number): string[] {
    const shuffledWords = shuffleWithSeed(words, numericSeed);
    return shuffledWords.slice(0, BOARD_SIZE);
}

export interface CardScoreResult {
    /** Score for each card position (parallel to types[]) */
    cardScores: number[];
    /** The assassin's independently-rolled score */
    assassinScore: number;
}

/**
 * Generate card scores for match mode.
 *
 * Distribution:
 *   - Gold (3 pts): 2-4 cards
 *   - Silver (2 pts): 3-6 cards
 *   - Standard (1 pt): 8 cards (fixed)
 *   - Trap (-1 pt): 0-4 cards
 *   - Blank (0 pts): fills remainder to 24 non-assassin cards
 *   - Assassin: independently scored from {-2,-2,-1,-1,-1,0,0,1,2}
 *
 * Total board value (all 25 scores) is constrained to [BOARD_VALUE_MIN, BOARD_VALUE_MAX].
 * Uses rejection sampling with seeded PRNG for determinism.
 *
 * @param numericSeed - Base seed for PRNG
 * @param types - The board types array (needed to find assassin position)
 */
export function generateCardScores(numericSeed: number, types: CardType[]): CardScoreResult {
    const scoreSeed = numericSeed + GAME_INTERNALS.CARD_SCORES_SEED_OFFSET;
    let attempt = 0;
    const maxAttempts = 100;

    while (attempt < maxAttempts) {
        let seed = scoreSeed + attempt * 1000;

        // Roll distribution counts
        const { gold, silver, trap } = CARD_SCORE_DISTRIBUTION;
        const goldCount = gold.min + Math.floor(seededRandom(seed++) * (gold.max - gold.min + 1));
        const silverCount = silver.min + Math.floor(seededRandom(seed++) * (silver.max - silver.min + 1));
        const trapCount = trap.min + Math.floor(seededRandom(seed++) * (trap.max - trap.min + 1));
        const standardCount = STANDARD_SCORE_CARDS;
        const nonAssassinTotal = BOARD_SIZE - 1; // 24
        const blankCount = nonAssassinTotal - goldCount - silverCount - standardCount - trapCount;

        if (blankCount < 0) {
            attempt++;
            continue;
        }

        // Roll assassin score from weighted pool
        const assassinPoolIndex = Math.floor(seededRandom(seed++) * ASSASSIN_SCORE_POOL.length);
        const assassinScore: number = ASSASSIN_SCORE_POOL[assassinPoolIndex] as number;

        // Build non-assassin scores array
        const nonAssassinScores: number[] = [
            ...(Array(goldCount).fill(gold.score) as number[]),
            ...(Array(silverCount).fill(silver.score) as number[]),
            ...(Array(standardCount).fill(1) as number[]),
            ...(Array(trapCount).fill(trap.score) as number[]),
            ...(Array(blankCount).fill(0) as number[]),
        ];

        // Check board value constraint (all 25 cards including assassin)
        const totalValue = nonAssassinScores.reduce((sum, s) => sum + s, 0) + assassinScore;
        if (totalValue < BOARD_VALUE_MIN || totalValue > BOARD_VALUE_MAX) {
            attempt++;
            continue;
        }

        // Shuffle non-assassin scores
        const shuffledScores = shuffleWithSeed(nonAssassinScores, seed);

        // Insert assassin score at the correct position
        const assassinIndex = types.indexOf('assassin');
        const cardScores: number[] = [];
        let scoreIdx = 0;
        for (let i = 0; i < BOARD_SIZE; i++) {
            if (i === assassinIndex) {
                cardScores.push(assassinScore);
            } else {
                cardScores.push(shuffledScores[scoreIdx++] ?? 0);
            }
        }

        return { cardScores, assassinScore };
    }

    // Fallback: should be extremely rare. Use a balanced default distribution.
    const assassinIndex = types.indexOf('assassin');
    const fallbackScores: number[] = [];
    const fallbackNonAssassin = [
        ...(Array(3).fill(3) as number[]),
        ...(Array(5).fill(2) as number[]),
        ...(Array(8).fill(1) as number[]),
        ...(Array(2).fill(-1) as number[]),
        ...(Array(6).fill(0) as number[]),
    ];
    const shuffled = shuffleWithSeed(fallbackNonAssassin, scoreSeed + 99999);
    let si = 0;
    for (let i = 0; i < BOARD_SIZE; i++) {
        if (i === assassinIndex) {
            fallbackScores.push(-1);
        } else {
            fallbackScores.push(shuffled[si++] ?? 0);
        }
    }
    return { cardScores: fallbackScores, assassinScore: -1 };
}
