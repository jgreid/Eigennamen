import type { CardType } from '../../types';

import crypto from 'crypto';
import {
    BOARD_SIZE,
    FIRST_TEAM_CARDS,
    SECOND_TEAM_CARDS,
    NEUTRAL_CARDS,
    GAME_INTERNALS,
    DUET_BOARD_CONFIG
} from '../../config/constants';

/**
 * Seeded random number generator using Mulberry32 algorithm
 * Provides better distribution than Math.sin-based approach
 * Must stay in sync with client-side implementation in index.html
 */
export function seededRandom(seed: number): number {
    let t = (seed + 0x6D2B79F5) | 0;
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
            hash = ((hash << 5) - hash) + codePoint;
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
        return Math.random().toString(36).substring(2, 10) +
               Math.random().toString(36).substring(2, 6);
    }
}

/**
 * Generate Duet mode board with dual key cards
 * Side A (types[]): 9 green (as 'red'), 3 assassin, 13 bystander (as 'neutral')
 * Side B (duetTypes[]): 9 green (as 'blue'), 3 assassin, 13 bystander (as 'neutral')
 */
export function generateDuetBoard(seed: number): { types: CardType[]; duetTypes: CardType[] } {
    const { greenOverlap, greenOnlyA, greenOnlyB, assassinOverlap, assassinOnlyA, assassinOnlyB, bystanderBoth } = DUET_BOARD_CONFIG;

    const pairs: [CardType, CardType][] = [
        ...Array(greenOverlap).fill(null).map((): [CardType, CardType] => ['red', 'blue']),
        ...Array(greenOnlyA).fill(null).map((): [CardType, CardType] => ['red', 'neutral']),
        ...Array(greenOnlyB).fill(null).map((): [CardType, CardType] => ['neutral', 'blue']),
        ...Array(assassinOverlap).fill(null).map((): [CardType, CardType] => ['assassin', 'assassin']),
        ...Array(assassinOnlyA).fill(null).map((): [CardType, CardType] => ['assassin', 'neutral']),
        ...Array(assassinOnlyB).fill(null).map((): [CardType, CardType] => ['neutral', 'assassin']),
        ...Array(bystanderBoth).fill(null).map((): [CardType, CardType] => ['neutral', 'neutral'])
    ];

    const shuffledPairs = shuffleWithSeed(pairs, seed);

    const types: CardType[] = shuffledPairs.map(p => p[0]);
    const duetTypes: CardType[] = shuffledPairs.map(p => p[1]);

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
    const firstTeam: 'red' | 'blue' = seededRandom(numericSeed + GAME_INTERNALS.FIRST_TEAM_SEED_OFFSET) > 0.5 ? 'red' : 'blue';

    if (isDuet) {
        const duetBoard = generateDuetBoard(numericSeed + GAME_INTERNALS.TYPES_SHUFFLE_SEED_OFFSET);
        return {
            types: duetBoard.types,
            duetTypes: duetBoard.duetTypes,
            redTotal: DUET_BOARD_CONFIG.greenOverlap + DUET_BOARD_CONFIG.greenOnlyA,
            blueTotal: DUET_BOARD_CONFIG.greenOverlap + DUET_BOARD_CONFIG.greenOnlyB,
            firstTeam
        };
    }

    let types: CardType[];
    let redTotal: number;
    let blueTotal: number;

    if (firstTeam === 'red') {
        types = [
            ...Array(FIRST_TEAM_CARDS).fill('red') as CardType[],
            ...Array(SECOND_TEAM_CARDS).fill('blue') as CardType[]
        ];
        redTotal = FIRST_TEAM_CARDS;
        blueTotal = SECOND_TEAM_CARDS;
    } else {
        types = [
            ...Array(SECOND_TEAM_CARDS).fill('red') as CardType[],
            ...Array(FIRST_TEAM_CARDS).fill('blue') as CardType[]
        ];
        redTotal = SECOND_TEAM_CARDS;
        blueTotal = FIRST_TEAM_CARDS;
    }
    types = [...types, ...Array(NEUTRAL_CARDS).fill('neutral') as CardType[], 'assassin'];

    if (types.length !== BOARD_SIZE) {
        throw new Error(
            `Board generation error: card types count (${types.length}) does not match BOARD_SIZE (${BOARD_SIZE})`
        );
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

