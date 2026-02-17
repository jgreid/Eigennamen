/**
 * Frontend Utils Module Tests
 *
 * Tests the ACTUAL utility functions from src/frontend/utils.ts.
 * No re-implementations — imports the real code directly.
 *
 * Test environment: jsdom (provides window, document, localStorage, btoa, atob).
 */

import {
    seededRandom,
    hashString,
    shuffleWithSeed,
    escapeWordDelimiter,
    unescapeWordDelimiter,
    encodeWordsForURL,
    decodeWordsFromURL,
    formatDuration,
    getCardFontClass,
    safeGetItem,
    safeSetItem,
    safeRemoveItem,
    escapeHTML
} from '../../frontend/utils';

// ==================== Tests ====================

describe('seededRandom (Mulberry32 PRNG)', () => {
    it('returns a value between 0 (inclusive) and 1 (exclusive)', () => {
        for (let seed = 0; seed < 1000; seed++) {
            const val = seededRandom(seed);
            expect(val).toBeGreaterThanOrEqual(0);
            expect(val).toBeLessThan(1);
        }
    });

    it('is deterministic - same seed produces same output', () => {
        expect(seededRandom(42)).toBe(seededRandom(42));
        expect(seededRandom(0)).toBe(seededRandom(0));
        expect(seededRandom(999999)).toBe(seededRandom(999999));
    });

    it('different seeds produce different outputs', () => {
        const results = new Set<number>();
        for (let seed = 0; seed < 100; seed++) {
            results.add(seededRandom(seed));
        }
        expect(results.size).toBe(100);
    });

    it('matches known reference values (hardcoded for regression)', () => {
        expect(seededRandom(0)).toBeCloseTo(0.26642920868471265, 15);
        expect(seededRandom(1)).toBeCloseTo(0.6270739405881613, 15);
        expect(seededRandom(42)).toBeCloseTo(0.6011037519201636, 15);
        expect(seededRandom(12345)).toBeCloseTo(0.9797282677609473, 15);
        expect(seededRandom(999999)).toBeCloseTo(0.03664584248326719, 15);
    });

    it('handles negative seeds', () => {
        const val = seededRandom(-1);
        expect(val).toBeGreaterThanOrEqual(0);
        expect(val).toBeLessThan(1);
        expect(val).toBeCloseTo(0.8964226141106337, 15);
    });

    it('handles very large seeds', () => {
        const val = seededRandom(2147483647);
        expect(val).toBeGreaterThanOrEqual(0);
        expect(val).toBeLessThan(1);
    });

    it('produces approximately uniform distribution', () => {
        const bins = new Array(10).fill(0);
        const sampleCount = 10000;
        for (let seed = 0; seed < sampleCount; seed++) {
            const val = seededRandom(seed);
            const bin = Math.floor(val * 10);
            bins[bin]++;
        }
        for (const count of bins) {
            expect(count).toBeGreaterThan(700);
            expect(count).toBeLessThan(1300);
        }
    });

    it('sequential seeds do not produce correlated outputs', () => {
        let increasing = 0;
        let decreasing = 0;
        for (let seed = 0; seed < 100; seed++) {
            if (seededRandom(seed + 1) > seededRandom(seed)) {
                increasing++;
            } else {
                decreasing++;
            }
        }
        expect(increasing).toBeGreaterThan(30);
        expect(decreasing).toBeGreaterThan(30);
    });
});

describe('hashString', () => {
    it('returns 0 for empty string', () => {
        expect(hashString('')).toBe(0);
    });

    it('returns a non-negative integer', () => {
        const testStrings = ['hello', 'world', 'EIGENNAMEN', 'test123', '!@#$%'];
        for (const str of testStrings) {
            const hash = hashString(str);
            expect(hash).toBeGreaterThanOrEqual(0);
            expect(Number.isInteger(hash)).toBe(true);
        }
    });

    it('same string produces same hash (deterministic)', () => {
        expect(hashString('hello')).toBe(hashString('hello'));
        expect(hashString('EIGENNAMEN')).toBe(hashString('EIGENNAMEN'));
    });

    it('different strings produce different hashes', () => {
        const strings = ['hello', 'world', 'EIGENNAMEN', 'abc', 'xyz', 'test', 'foo', 'bar'];
        const hashes = strings.map(hashString);
        const uniqueHashes = new Set(hashes);
        expect(uniqueHashes.size).toBe(strings.length);
    });

    it('is case-sensitive', () => {
        expect(hashString('Hello')).not.toBe(hashString('hello'));
    });

    it('handles unicode strings', () => {
        const hash = hashString('\u00e9\u00e0\u00fc');
        expect(hash).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(hash)).toBe(true);
    });

    it('handles very long strings', () => {
        const longStr = 'a'.repeat(10000);
        const hash = hashString(longStr);
        expect(hash).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(hash)).toBe(true);
    });
});

describe('shuffleWithSeed', () => {
    it('same seed produces same shuffle (deterministic)', () => {
        const array = [1, 2, 3, 4, 5];
        expect(shuffleWithSeed(array, 42)).toEqual(shuffleWithSeed(array, 42));
    });

    it('different seeds produce different shuffles', () => {
        const array = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        expect(shuffleWithSeed(array, 42)).not.toEqual(shuffleWithSeed(array, 99));
    });

    it('output contains all original elements', () => {
        const array = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        const result = shuffleWithSeed(array, 42);
        expect(result).toHaveLength(array.length);
        expect(result.sort((a, b) => a - b)).toEqual(array);
    });

    it('does not modify the original array', () => {
        const array = [1, 2, 3, 4, 5];
        const copy = [...array];
        shuffleWithSeed(array, 42);
        expect(array).toEqual(copy);
    });

    it('handles single element array', () => {
        expect(shuffleWithSeed([1], 42)).toEqual([1]);
    });

    it('handles empty array', () => {
        expect(shuffleWithSeed([], 42)).toEqual([]);
    });

    it('works with string arrays', () => {
        const words = ['APPLE', 'BANANA', 'CHERRY', 'DATE', 'ELDERBERRY'];
        const result = shuffleWithSeed(words, 42);
        expect(result).toHaveLength(words.length);
        expect([...result].sort()).toEqual([...words].sort());
    });

    it('works with a 25-element board', () => {
        const board = Array.from({ length: 25 }, (_, i) => `WORD_${i}`);
        const result = shuffleWithSeed(board, 12345);
        expect(result).toHaveLength(25);
        expect([...result].sort()).toEqual([...board].sort());
        expect(result).not.toEqual(board);
    });
});

describe('encodeWordsForURL / decodeWordsFromURL', () => {
    it('round-trips a basic word list', () => {
        const words = ['APPLE', 'BANANA', 'CHERRY'];
        expect(decodeWordsFromURL(encodeWordsForURL(words))).toEqual(words);
    });

    it('round-trips words with spaces', () => {
        const words = ['NEW YORK', 'ICE CREAM', 'NORTH POLE'];
        expect(decodeWordsFromURL(encodeWordsForURL(words))).toEqual(words);
    });

    it('round-trips words containing pipe characters', () => {
        const words = ['A|B', 'C|D', 'E||F'];
        expect(decodeWordsFromURL(encodeWordsForURL(words))).toEqual(words);
    });

    it('round-trips words containing backslash characters', () => {
        const words = ['A\\B', 'C\\D', 'E\\\\F'];
        expect(decodeWordsFromURL(encodeWordsForURL(words))).toEqual(words);
    });

    it('handles empty arrays', () => {
        expect(decodeWordsFromURL(encodeWordsForURL([]))).toEqual([]);
    });

    it('returns null for invalid encoded strings', () => {
        expect(decodeWordsFromURL('!!!invalid!!!')).toBeNull();
    });

    it('produces URL-safe output (no +, /, or = characters)', () => {
        const words = ['APPLE', 'BANANA', 'CHERRY', 'DATE', 'ELDERBERRY',
            'FIG', 'GRAPE', 'HONEYDEW', 'KIWI', 'LEMON'];
        const encoded = encodeWordsForURL(words);
        expect(encoded).not.toContain('+');
        expect(encoded).not.toContain('/');
        expect(encoded).not.toContain('=');
    });

    it('round-trips a full 25-word board', () => {
        const words = Array.from({ length: 25 }, (_, i) => `WORD_${i}`);
        expect(decodeWordsFromURL(encodeWordsForURL(words))).toEqual(words);
    });

    it('round-trips words with special HTML characters', () => {
        const words = ['<script>alert(1)</script>', 'WORD&AMP', 'foo"bar'];
        expect(decodeWordsFromURL(encodeWordsForURL(words))).toEqual(words);
    });

    it('handles single word', () => {
        expect(decodeWordsFromURL(encodeWordsForURL(['SOLO']))).toEqual(['SOLO']);
    });
});

describe('escapeWordDelimiter / unescapeWordDelimiter', () => {
    it('escapes pipe characters', () => {
        expect(escapeWordDelimiter('A|B')).toBe('A\\|B');
    });

    it('escapes backslash characters', () => {
        expect(escapeWordDelimiter('A\\B')).toBe('A\\\\B');
    });

    it('does not modify strings without pipe or backslash', () => {
        expect(escapeWordDelimiter('HELLO WORLD')).toBe('HELLO WORLD');
    });

    it('round-trip preserves original string', () => {
        const testCases = [
            'simple', 'with|pipe', 'with\\backslash', 'with\\|both',
            '|||', '\\\\\\', '', 'normal word'
        ];
        for (const original of testCases) {
            expect(unescapeWordDelimiter(escapeWordDelimiter(original))).toBe(original);
        }
    });
});

describe('formatDuration', () => {
    it('formats 0ms as "0:00"', () => {
        expect(formatDuration(0)).toBe('0:00');
    });

    it('formats 60000ms (1 minute) as "1:00"', () => {
        expect(formatDuration(60000)).toBe('1:00');
    });

    it('formats 90000ms (1.5 minutes) as "1:30"', () => {
        expect(formatDuration(90000)).toBe('1:30');
    });

    it('pads single-digit seconds with leading zero', () => {
        expect(formatDuration(61000)).toBe('1:01');
        expect(formatDuration(5000)).toBe('0:05');
    });

    it('truncates sub-second values', () => {
        expect(formatDuration(1500)).toBe('0:01');
        expect(formatDuration(999)).toBe('0:00');
    });
});

describe('getCardFontClass', () => {
    it('returns "font-lg" for short words (<=8 chars)', () => {
        expect(getCardFontClass('HELLO')).toBe('font-lg');
        expect(getCardFontClass('SPY')).toBe('font-lg');
    });

    it('returns "font-md" for medium words (9-11 chars)', () => {
        expect(getCardFontClass('BASKETBALL')).toBe('font-md');
    });

    it('returns "font-sm" for long words (12-14 chars)', () => {
        expect(getCardFontClass('INTERNATIONAL')).toBe('font-sm');
    });

    it('returns "font-xs" for very long words (15-17 chars)', () => {
        expect(getCardFontClass('EXTRAORDINARILY')).toBe('font-xs');
    });

    it('returns "font-min" for extremely long words (>17 chars)', () => {
        expect(getCardFontClass('SUPERCALIFRAGILISTIC')).toBe('font-min');
    });

    it('handles boundary at 8 characters', () => {
        expect(getCardFontClass('12345678')).toBe('font-lg');
        expect(getCardFontClass('123456789')).toBe('font-md');
    });

    it('handles empty string', () => {
        expect(getCardFontClass('')).toBe('font-lg');
    });
});

describe('escapeHTML', () => {
    it('escapes < and > characters', () => {
        expect(escapeHTML('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    });

    it('escapes & character', () => {
        expect(escapeHTML('foo & bar')).toBe('foo &amp; bar');
    });

    it('passes through safe strings unchanged', () => {
        expect(escapeHTML('Hello World')).toBe('Hello World');
    });

    it('handles empty string', () => {
        expect(escapeHTML('')).toBe('');
    });
});

describe('safeGetItem', () => {
    beforeEach(() => localStorage.clear());

    it('returns stored value when key exists', () => {
        localStorage.setItem('testKey', 'testValue');
        expect(safeGetItem('testKey')).toBe('testValue');
    });

    it('returns null by default when key does not exist', () => {
        expect(safeGetItem('nonexistent')).toBeNull();
    });

    it('returns custom default when key does not exist', () => {
        expect(safeGetItem('nonexistent', 'fallback')).toBe('fallback');
    });

    it('returns empty string (not default) when value is empty string', () => {
        localStorage.setItem('emptyKey', '');
        expect(safeGetItem('emptyKey', 'fallback')).toBe('');
    });

    it('returns default when localStorage throws', () => {
        const original = Storage.prototype.getItem;
        Storage.prototype.getItem = () => { throw new Error('SecurityError'); };
        try {
            expect(safeGetItem('anyKey', 'safe-default')).toBe('safe-default');
        } finally {
            Storage.prototype.getItem = original;
        }
    });
});

describe('safeSetItem', () => {
    beforeEach(() => localStorage.clear());

    it('stores value and returns true on success', () => {
        expect(safeSetItem('key', 'value')).toBe(true);
        expect(localStorage.getItem('key')).toBe('value');
    });

    it('returns false when localStorage throws', () => {
        const original = Storage.prototype.setItem;
        Storage.prototype.setItem = () => { throw new Error('QuotaExceeded'); };
        try {
            expect(safeSetItem('key', 'value')).toBe(false);
        } finally {
            Storage.prototype.setItem = original;
        }
    });
});

describe('safeRemoveItem', () => {
    beforeEach(() => localStorage.clear());

    it('removes existing item and returns true', () => {
        localStorage.setItem('key', 'value');
        expect(safeRemoveItem('key')).toBe(true);
        expect(localStorage.getItem('key')).toBeNull();
    });

    it('returns false when localStorage throws', () => {
        const original = Storage.prototype.removeItem;
        Storage.prototype.removeItem = () => { throw new Error('SecurityError'); };
        try {
            expect(safeRemoveItem('key')).toBe(false);
        } finally {
            Storage.prototype.removeItem = original;
        }
    });
});

describe('localStorage wrappers integration', () => {
    beforeEach(() => localStorage.clear());

    it('set then get retrieves the value', () => {
        safeSetItem('color', 'blue');
        expect(safeGetItem('color')).toBe('blue');
    });

    it('set then remove then get returns default', () => {
        safeSetItem('color', 'blue');
        safeRemoveItem('color');
        expect(safeGetItem('color', 'none')).toBe('none');
    });
});
