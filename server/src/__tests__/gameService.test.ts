/**
 * Unit Tests for Game Service
 */

const {
    seededRandom,
    hashString,
    shuffleWithSeed,
    generateSeed
} = require('../services/game/boardGenerator');
const { validateClueWord } = require('../services/game/clueValidator');

describe('seededRandom', () => {
    test('returns consistent values for the same seed', () => {
        const result1 = seededRandom(12345);
        const result2 = seededRandom(12345);
        expect(result1).toBe(result2);
    });

    test('returns values between 0 and 1', () => {
        for (let i = 0; i < 100; i++) {
            const result = seededRandom(i);
            expect(result).toBeGreaterThanOrEqual(0);
            expect(result).toBeLessThan(1);
        }
    });

    test('returns different values for different seeds', () => {
        const result1 = seededRandom(1);
        const result2 = seededRandom(2);
        expect(result1).not.toBe(result2);
    });

    test('produces deterministic sequence when incremented', () => {
        const sequence1 = [
            seededRandom(100),
            seededRandom(101),
            seededRandom(102)
        ];
        const sequence2 = [
            seededRandom(100),
            seededRandom(101),
            seededRandom(102)
        ];
        expect(sequence1).toEqual(sequence2);
    });
});

describe('hashString', () => {
    test('returns consistent hash for same string', () => {
        const hash1 = hashString('test');
        const hash2 = hashString('test');
        expect(hash1).toBe(hash2);
    });

    test('returns different hash for different strings', () => {
        const hash1 = hashString('test1');
        const hash2 = hashString('test2');
        expect(hash1).not.toBe(hash2);
    });

    test('returns non-negative integer', () => {
        const testStrings = ['', 'a', 'test', 'longer string', '🎮'];
        for (const str of testStrings) {
            const hash = hashString(str);
            expect(hash).toBeGreaterThanOrEqual(0);
            expect(Number.isInteger(hash)).toBe(true);
        }
    });

    test('handles empty string', () => {
        const hash = hashString('');
        expect(hash).toBe(0);
    });
});

describe('shuffleWithSeed', () => {
    test('returns array of same length', () => {
        const array = [1, 2, 3, 4, 5];
        const shuffled = shuffleWithSeed(array, 12345);
        expect(shuffled.length).toBe(array.length);
    });

    test('contains all original elements', () => {
        const array = [1, 2, 3, 4, 5];
        const shuffled = shuffleWithSeed(array, 12345);
        expect(shuffled.sort()).toEqual(array.sort());
    });

    test('produces consistent results with same seed', () => {
        const array = ['a', 'b', 'c', 'd', 'e'];
        const shuffled1 = shuffleWithSeed(array, 99999);
        const shuffled2 = shuffleWithSeed(array, 99999);
        expect(shuffled1).toEqual(shuffled2);
    });

    test('produces different results with different seeds', () => {
        const array = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        const shuffled1 = shuffleWithSeed(array, 1);
        const shuffled2 = shuffleWithSeed(array, 2);
        // Very unlikely to be equal with different seeds
        expect(shuffled1).not.toEqual(shuffled2);
    });

    test('does not mutate original array', () => {
        const original = [1, 2, 3, 4, 5];
        const copy = [...original];
        shuffleWithSeed(original, 12345);
        expect(original).toEqual(copy);
    });

    test('handles empty array', () => {
        const shuffled = shuffleWithSeed([], 12345);
        expect(shuffled).toEqual([]);
    });

    test('handles single element array', () => {
        const shuffled = shuffleWithSeed([1], 12345);
        expect(shuffled).toEqual([1]);
    });
});

describe('generateSeed', () => {
    test('returns a string', () => {
        const seed = generateSeed();
        expect(typeof seed).toBe('string');
    });

    test('returns string of expected length', () => {
        const seed = generateSeed();
        // Crypto-based seed is 12 hex chars (from 6 random bytes)
        expect(seed.length).toBe(12);
    });

    test('generates unique seeds', () => {
        const seeds = new Set();
        for (let i = 0; i < 100; i++) {
            seeds.add(generateSeed());
        }
        // Should have 100 unique seeds (collision extremely unlikely)
        expect(seeds.size).toBe(100);
    });

    test('contains only alphanumeric characters', () => {
        for (let i = 0; i < 50; i++) {
            const seed = generateSeed();
            expect(seed).toMatch(/^[a-z0-9]+$/);
        }
    });
});

describe('validateClueWord', () => {
    const boardWords = ['APPLE', 'BANANA', 'CHERRY', 'DOG', 'ELEPHANT'];

    describe('valid clues', () => {
        test('accepts word not on board', () => {
            const result = validateClueWord('FRUIT', boardWords);
            expect(result.valid).toBe(true);
        });

        test('accepts completely unrelated word', () => {
            const result = validateClueWord('COMPUTER', boardWords);
            expect(result.valid).toBe(true);
        });

        test('is case insensitive', () => {
            const result = validateClueWord('fruit', boardWords);
            expect(result.valid).toBe(true);
        });

        test('rejects short words if contained in board words', () => {
            // "AN" is in "BANANA" - stricter validation blocks this exploit
            const result = validateClueWord('AN', boardWords);
            expect(result.valid).toBe(false);
        });

        test('allows single-char words even if contained in board words', () => {
            // Single character words like "A" or "I" are allowed as rare edge cases
            const result = validateClueWord('A', boardWords);
            expect(result.valid).toBe(true);
        });
    });

    describe('invalid clues', () => {
        test('rejects exact match', () => {
            const result = validateClueWord('APPLE', boardWords);
            expect(result.valid).toBe(false);
            expect(result.reason).toContain('APPLE');
        });

        test('rejects exact match case insensitive', () => {
            const result = validateClueWord('apple', boardWords);
            expect(result.valid).toBe(false);
        });

        test('rejects clue containing board word', () => {
            const result = validateClueWord('APPLESAUCE', boardWords);
            expect(result.valid).toBe(false);
            expect(result.reason).toContain('APPLE');
        });

        test('rejects clue contained in board word', () => {
            const result = validateClueWord('CHER', boardWords);
            expect(result.valid).toBe(false);
            expect(result.reason).toContain('CHERRY');
        });

        test('rejects with whitespace', () => {
            const result = validateClueWord('  APPLE  ', boardWords);
            expect(result.valid).toBe(false);
        });
    });

    describe('edge cases', () => {
        test('handles board with multi-word entries', () => {
            const boardWithSpaces = ['NEW YORK', 'ICE CREAM'];
            const result = validateClueWord('NEW', boardWithSpaces);
            // "NEW" (3 chars) is in "NEW YORK" so should be invalid
            expect(result.valid).toBe(false);
        });

        test('rejects empty clue', () => {
            const result = validateClueWord('', boardWords);
            expect(result.valid).toBe(false); // Empty clues are now explicitly rejected
        });
    });
});

describe('Game Board Generation', () => {
    const BOARD_SIZE = 25;
    const FIRST_TEAM_CARDS = 9;
    const SECOND_TEAM_CARDS = 8;
    const NEUTRAL_CARDS = 7;
    const ASSASSIN_CARDS = 1;

    test('board has correct total cards', () => {
        const total = FIRST_TEAM_CARDS + SECOND_TEAM_CARDS + NEUTRAL_CARDS + ASSASSIN_CARDS;
        expect(total).toBe(BOARD_SIZE);
    });

    test('card type distribution is correct', () => {
        // Simulate creating card types like the game does
        const seed = hashString('test-seed');
        const firstTeam = seededRandom(seed + 1000) > 0.5 ? 'red' : 'blue';

        let types = [];
        if (firstTeam === 'red') {
            types = [
                ...Array(FIRST_TEAM_CARDS).fill('red'),
                ...Array(SECOND_TEAM_CARDS).fill('blue')
            ];
        } else {
            types = [
                ...Array(SECOND_TEAM_CARDS).fill('red'),
                ...Array(FIRST_TEAM_CARDS).fill('blue')
            ];
        }
        types = [...types, ...Array(NEUTRAL_CARDS).fill('neutral'), 'assassin'];

        expect(types.length).toBe(BOARD_SIZE);
        expect(types.filter(t => t === 'neutral').length).toBe(NEUTRAL_CARDS);
        expect(types.filter(t => t === 'assassin').length).toBe(ASSASSIN_CARDS);

        const redCount = types.filter(t => t === 'red').length;
        const blueCount = types.filter(t => t === 'blue').length;

        // First team gets 9, second gets 8
        if (firstTeam === 'red') {
            expect(redCount).toBe(FIRST_TEAM_CARDS);
            expect(blueCount).toBe(SECOND_TEAM_CARDS);
        } else {
            expect(redCount).toBe(SECOND_TEAM_CARDS);
            expect(blueCount).toBe(FIRST_TEAM_CARDS);
        }
    });

    test('same seed produces same board', () => {
        const seed = 'reproducible-game';
        const numericSeed = hashString(seed);

        // First run
        const firstTeam1 = seededRandom(numericSeed + 1000) > 0.5 ? 'red' : 'blue';
        let types1 = [];
        if (firstTeam1 === 'red') {
            types1 = [...Array(9).fill('red'), ...Array(8).fill('blue')];
        } else {
            types1 = [...Array(8).fill('red'), ...Array(9).fill('blue')];
        }
        types1 = [...types1, ...Array(7).fill('neutral'), 'assassin'];
        types1 = shuffleWithSeed(types1, numericSeed + 500);

        // Second run
        const firstTeam2 = seededRandom(numericSeed + 1000) > 0.5 ? 'red' : 'blue';
        let types2 = [];
        if (firstTeam2 === 'red') {
            types2 = [...Array(9).fill('red'), ...Array(8).fill('blue')];
        } else {
            types2 = [...Array(8).fill('red'), ...Array(9).fill('blue')];
        }
        types2 = [...types2, ...Array(7).fill('neutral'), 'assassin'];
        types2 = shuffleWithSeed(types2, numericSeed + 500);

        expect(firstTeam1).toBe(firstTeam2);
        expect(types1).toEqual(types2);
    });
});
