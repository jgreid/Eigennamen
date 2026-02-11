/**
 * Frontend Utils Module Tests
 *
 * Tests for utility functions from server/public/js/modules/utils.js.
 * Since the source is a plain ES module not directly importable in Jest/ts-jest,
 * each function is re-implemented here (matching the source exactly) for testing.
 *
 * Test environment: jsdom (provides window, document, localStorage, btoa, atob).
 */

// ==================== Re-implemented functions ====================

// Mulberry32 PRNG - must match server/public/js/modules/utils.js
function seededRandom(seed: number): number {
    let t = (seed + 0x6D2B79F5) | 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return Math.abs(hash);
}

function shuffleWithSeed<T>(array: T[], seed: number): T[] {
    const shuffled = [...array];
    let currentSeed = seed;
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(seededRandom(currentSeed++) * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

function escapeWordDelimiter(word: string): string {
    return word.replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
}

function unescapeWordDelimiter(word: string): string {
    return word.replace(/\\\|/g, '|').replace(/\\\\/g, '\\');
}

function encodeWordsForURL(words: string[]): string {
    return btoa(words.map(escapeWordDelimiter).join('|'))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

function decodeWordsFromURL(encoded: string): string[] | null {
    try {
        const padded = encoded.replace(/-/g, '+').replace(/_/g, '/');
        const decoded = atob(padded);
        const parts: string[] = [];
        let current = '';
        let i = 0;
        while (i < decoded.length) {
            if (decoded[i] === '\\' && i + 1 < decoded.length) {
                current += decoded[i] + decoded[i + 1];
                i += 2;
            } else if (decoded[i] === '|') {
                parts.push(current);
                current = '';
                i++;
            } else {
                current += decoded[i];
                i++;
            }
        }
        parts.push(current);
        return parts.map(unescapeWordDelimiter).filter(w => w.length > 0);
    } catch {
        return null;
    }
}

function formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

function getCardFontClass(word: string): string {
    const len = word.length;
    if (len <= 8) return 'font-lg';
    if (len <= 11) return 'font-md';
    if (len <= 14) return 'font-sm';
    if (len <= 17) return 'font-xs';
    return 'font-min';
}

function safeGetItem(key: string, defaultValue: string | null = null): string | null {
    try {
        const value = localStorage.getItem(key);
        return value !== null ? value : defaultValue;
    } catch {
        return defaultValue;
    }
}

function safeSetItem(key: string, value: string): boolean {
    try {
        localStorage.setItem(key, value);
        return true;
    } catch {
        return false;
    }
}

function safeRemoveItem(key: string): boolean {
    try {
        localStorage.removeItem(key);
        return true;
    } catch {
        return false;
    }
}

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
        // All 100 values should be unique (collision is astronomically unlikely)
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
        const val = seededRandom(2147483647); // max 32-bit signed int
        expect(val).toBeGreaterThanOrEqual(0);
        expect(val).toBeLessThan(1);
    });

    it('produces approximately uniform distribution', () => {
        // Divide [0,1) into 10 bins and check each gets roughly 10% of samples
        const bins = new Array(10).fill(0);
        const sampleCount = 10000;
        for (let seed = 0; seed < sampleCount; seed++) {
            const val = seededRandom(seed);
            const bin = Math.floor(val * 10);
            bins[bin]++;
        }
        // Each bin should have roughly 1000 (10%) entries.
        // Allow +/- 300 to account for PRNG distribution characteristics
        for (const count of bins) {
            expect(count).toBeGreaterThan(700);
            expect(count).toBeLessThan(1300);
        }
    });

    it('sequential seeds do not produce correlated outputs', () => {
        // Ensure consecutive seeds don't produce monotonically increasing values
        let increasing = 0;
        let decreasing = 0;
        for (let seed = 0; seed < 100; seed++) {
            if (seededRandom(seed + 1) > seededRandom(seed)) {
                increasing++;
            } else {
                decreasing++;
            }
        }
        // Neither direction should dominate (expect roughly 50/50)
        expect(increasing).toBeGreaterThan(30);
        expect(decreasing).toBeGreaterThan(30);
    });
});

describe('hashString', () => {
    it('returns 0 for empty string', () => {
        expect(hashString('')).toBe(0);
    });

    it('returns a non-negative integer', () => {
        const testStrings = ['hello', 'world', 'CODENAMES', 'test123', '!@#$%'];
        for (const str of testStrings) {
            const hash = hashString(str);
            expect(hash).toBeGreaterThanOrEqual(0);
            expect(Number.isInteger(hash)).toBe(true);
        }
    });

    it('same string produces same hash (deterministic)', () => {
        expect(hashString('hello')).toBe(hashString('hello'));
        expect(hashString('CODENAMES')).toBe(hashString('CODENAMES'));
        expect(hashString('')).toBe(hashString(''));
    });

    it('different strings produce different hashes', () => {
        const strings = ['hello', 'world', 'CODENAMES', 'abc', 'xyz', 'test', 'foo', 'bar'];
        const hashes = strings.map(hashString);
        const uniqueHashes = new Set(hashes);
        expect(uniqueHashes.size).toBe(strings.length);
    });

    it('matches known reference values', () => {
        expect(hashString('hello')).toBe(99162322);
        expect(hashString('world')).toBe(113318802);
        expect(hashString('CODENAMES')).toBe(1672865115);
        expect(hashString('abc')).toBe(96354);
    });

    it('handles single character strings', () => {
        const hash = hashString('a');
        expect(hash).toBeGreaterThan(0);
        expect(Number.isInteger(hash)).toBe(true);
    });

    it('is case-sensitive', () => {
        expect(hashString('Hello')).not.toBe(hashString('hello'));
        expect(hashString('ABC')).not.toBe(hashString('abc'));
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
        const result1 = shuffleWithSeed(array, 42);
        const result2 = shuffleWithSeed(array, 42);
        expect(result1).toEqual(result2);
    });

    it('different seeds produce different shuffles', () => {
        const array = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        const result1 = shuffleWithSeed(array, 42);
        const result2 = shuffleWithSeed(array, 99);
        expect(result1).not.toEqual(result2);
    });

    it('output contains all original elements (no duplicates, no missing)', () => {
        const array = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        const result = shuffleWithSeed(array, 42);
        expect(result).toHaveLength(array.length);
        expect(result.sort((a, b) => a - b)).toEqual(array);
    });

    it('does not modify the original array', () => {
        const array = [1, 2, 3, 4, 5];
        const originalCopy = [...array];
        shuffleWithSeed(array, 42);
        expect(array).toEqual(originalCopy);
    });

    it('matches known reference values', () => {
        expect(shuffleWithSeed([1, 2, 3, 4, 5], 42)).toEqual([2, 1, 3, 5, 4]);
        expect(shuffleWithSeed([1, 2, 3, 4, 5], 99)).toEqual([3, 5, 4, 1, 2]);
    });

    it('handles single element array', () => {
        const result = shuffleWithSeed([1], 42);
        expect(result).toEqual([1]);
    });

    it('handles empty array', () => {
        const result = shuffleWithSeed([], 42);
        expect(result).toEqual([]);
    });

    it('handles two element array', () => {
        const array = [1, 2];
        const result = shuffleWithSeed(array, 42);
        expect(result).toHaveLength(2);
        expect(result.sort((a, b) => a - b)).toEqual([1, 2]);
    });

    it('works with string arrays', () => {
        const words = ['APPLE', 'BANANA', 'CHERRY', 'DATE', 'ELDERBERRY'];
        const result = shuffleWithSeed(words, 42);
        expect(result).toHaveLength(words.length);
        expect([...result].sort()).toEqual([...words].sort());
    });

    it('works with a 25-element board (standard Codenames board size)', () => {
        const board = Array.from({ length: 25 }, (_, i) => `WORD_${i}`);
        const result = shuffleWithSeed(board, 12345);
        expect(result).toHaveLength(25);
        expect([...result].sort()).toEqual([...board].sort());
        // Verify it actually shuffled (not identity)
        expect(result).not.toEqual(board);
    });
});

describe('encodeWordsForURL / decodeWordsFromURL', () => {
    it('round-trips a basic word list', () => {
        const words = ['APPLE', 'BANANA', 'CHERRY'];
        const encoded = encodeWordsForURL(words);
        const decoded = decodeWordsFromURL(encoded);
        expect(decoded).toEqual(words);
    });

    it('round-trips words with spaces', () => {
        const words = ['NEW YORK', 'ICE CREAM', 'NORTH POLE'];
        const encoded = encodeWordsForURL(words);
        const decoded = decodeWordsFromURL(encoded);
        expect(decoded).toEqual(words);
    });

    it('round-trips words containing pipe characters', () => {
        const words = ['A|B', 'C|D', 'E||F'];
        const encoded = encodeWordsForURL(words);
        const decoded = decodeWordsFromURL(encoded);
        expect(decoded).toEqual(words);
    });

    it('round-trips words containing backslash characters', () => {
        const words = ['A\\B', 'C\\D', 'E\\\\F'];
        const encoded = encodeWordsForURL(words);
        const decoded = decodeWordsFromURL(encoded);
        expect(decoded).toEqual(words);
    });

    it('round-trips words with both pipe and backslash', () => {
        const words = ['A\\|B', '\\|', 'C|\\D'];
        const encoded = encodeWordsForURL(words);
        const decoded = decodeWordsFromURL(encoded);
        expect(decoded).toEqual(words);
    });

    it('handles empty arrays', () => {
        const encoded = encodeWordsForURL([]);
        const decoded = decodeWordsFromURL(encoded);
        expect(decoded).toEqual([]);
    });

    it('returns null for invalid encoded strings (bad base64)', () => {
        const result = decodeWordsFromURL('!!!invalid!!!');
        expect(result).toBeNull();
    });

    it('returns null for strings with invalid characters', () => {
        const result = decodeWordsFromURL('\x00\x01\x02');
        expect(result).toBeNull();
    });

    it('produces URL-safe output (no +, /, or = characters)', () => {
        // Use a word list that would produce these characters in standard base64
        const words = ['APPLE', 'BANANA', 'CHERRY', 'DATE', 'ELDERBERRY',
            'FIG', 'GRAPE', 'HONEYDEW', 'KIWI', 'LEMON'];
        const encoded = encodeWordsForURL(words);
        expect(encoded).not.toContain('+');
        expect(encoded).not.toContain('/');
        expect(encoded).not.toContain('=');
    });

    it('round-trips a full 25-word board', () => {
        const words = Array.from({ length: 25 }, (_, i) => `WORD_${i}`);
        const encoded = encodeWordsForURL(words);
        const decoded = decodeWordsFromURL(encoded);
        expect(decoded).toEqual(words);
    });

    it('round-trips words with special HTML characters', () => {
        const words = ['<script>alert(1)</script>', 'WORD&AMP', 'foo"bar'];
        const encoded = encodeWordsForURL(words);
        const decoded = decodeWordsFromURL(encoded);
        expect(decoded).toEqual(words);
    });

    it('handles single word', () => {
        const words = ['SOLO'];
        const encoded = encodeWordsForURL(words);
        const decoded = decodeWordsFromURL(encoded);
        expect(decoded).toEqual(words);
    });

    it('handles words with mixed case', () => {
        const words = ['Hello', 'wOrLd', 'UPPER', 'lower'];
        const encoded = encodeWordsForURL(words);
        const decoded = decodeWordsFromURL(encoded);
        expect(decoded).toEqual(words);
    });
});

describe('escapeWordDelimiter / unescapeWordDelimiter', () => {
    it('escapes pipe characters', () => {
        expect(escapeWordDelimiter('A|B')).toBe('A\\|B');
    });

    it('escapes backslash characters', () => {
        expect(escapeWordDelimiter('A\\B')).toBe('A\\\\B');
    });

    it('escapes both pipe and backslash', () => {
        expect(escapeWordDelimiter('A\\|B')).toBe('A\\\\\\|B');
    });

    it('does not modify strings without pipe or backslash', () => {
        expect(escapeWordDelimiter('HELLO WORLD')).toBe('HELLO WORLD');
    });

    it('handles empty string', () => {
        expect(escapeWordDelimiter('')).toBe('');
    });

    it('handles string that is just a pipe', () => {
        expect(escapeWordDelimiter('|')).toBe('\\|');
    });

    it('handles string that is just a backslash', () => {
        expect(escapeWordDelimiter('\\')).toBe('\\\\');
    });

    it('handles multiple consecutive pipes', () => {
        expect(escapeWordDelimiter('||')).toBe('\\|\\|');
    });

    it('handles multiple consecutive backslashes', () => {
        expect(escapeWordDelimiter('\\\\')).toBe('\\\\\\\\');
    });

    it('unescapes pipe characters', () => {
        expect(unescapeWordDelimiter('A\\|B')).toBe('A|B');
    });

    it('unescapes backslash characters', () => {
        expect(unescapeWordDelimiter('A\\\\B')).toBe('A\\B');
    });

    it('unescapes both pipe and backslash', () => {
        expect(unescapeWordDelimiter('A\\\\\\|B')).toBe('A\\|B');
    });

    it('does not modify strings without escaped characters', () => {
        expect(unescapeWordDelimiter('HELLO WORLD')).toBe('HELLO WORLD');
    });

    it('round-trip preserves original string', () => {
        const testCases = [
            'simple',
            'with|pipe',
            'with\\backslash',
            'with\\|both',
            '|||',
            '\\\\\\',
            '',
            'normal word',
            'A\\|B\\|C\\\\D',
        ];
        for (const original of testCases) {
            const escaped = escapeWordDelimiter(original);
            const unescaped = unescapeWordDelimiter(escaped);
            expect(unescaped).toBe(original);
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

    it('formats seconds only (under 1 minute)', () => {
        expect(formatDuration(45000)).toBe('0:45');
    });

    it('pads single-digit seconds with leading zero', () => {
        expect(formatDuration(61000)).toBe('1:01');
        expect(formatDuration(5000)).toBe('0:05');
        expect(formatDuration(1000)).toBe('0:01');
    });

    it('formats multi-minute durations', () => {
        expect(formatDuration(125000)).toBe('2:05');
        expect(formatDuration(300000)).toBe('5:00');
        expect(formatDuration(600000)).toBe('10:00');
    });

    it('handles large durations (over 1 hour)', () => {
        expect(formatDuration(3600000)).toBe('60:00');
        expect(formatDuration(3661000)).toBe('61:01');
    });

    it('truncates sub-second values (floors to nearest second)', () => {
        expect(formatDuration(1500)).toBe('0:01');  // 1.5 seconds -> 1 second
        expect(formatDuration(999)).toBe('0:00');    // 999ms -> 0 seconds
        expect(formatDuration(59999)).toBe('0:59');  // just under 60 seconds
    });

    it('handles exact minute boundaries', () => {
        expect(formatDuration(120000)).toBe('2:00');
        expect(formatDuration(180000)).toBe('3:00');
    });
});

describe('getCardFontClass', () => {
    it('returns "font-lg" for short words (<=8 chars)', () => {
        expect(getCardFontClass('HELLO')).toBe('font-lg');
        expect(getCardFontClass('SPY')).toBe('font-lg');
        expect(getCardFontClass('A')).toBe('font-lg');
    });

    it('returns "font-md" for medium words (9-11 chars)', () => {
        expect(getCardFontClass('BASKETBALL')).toBe('font-md'); // 10 chars
        expect(getCardFontClass('HELICOPTER')).toBe('font-md'); // 10 chars
    });

    it('returns "font-sm" for long words (12-14 chars)', () => {
        expect(getCardFontClass('INTERNATIONAL')).toBe('font-sm'); // 13 chars
        expect(getCardFontClass('CONCENTRATION')).toBe('font-sm'); // 13 chars
    });

    it('returns "font-xs" for very long words (15-17 chars)', () => {
        expect(getCardFontClass('EXTRAORDINARILY')).toBe('font-xs'); // 15 chars
        expect(getCardFontClass('RESPONSIBILITIES')).toBe('font-xs'); // 16 chars
    });

    it('returns "font-min" for extremely long words (>17 chars)', () => {
        expect(getCardFontClass('SUPERCALIFRAGILISTIC')).toBe('font-min'); // 20 chars
        expect(getCardFontClass('INTERNATIONALIZATION')).toBe('font-min'); // 20 chars
    });

    it('handles boundary at 8 characters (font-lg to font-md)', () => {
        expect(getCardFontClass('12345678')).toBe('font-lg');   // exactly 8
        expect(getCardFontClass('123456789')).toBe('font-md');  // exactly 9
    });

    it('handles boundary at 11 characters (font-md to font-sm)', () => {
        expect(getCardFontClass('12345678901')).toBe('font-md');   // exactly 11
        expect(getCardFontClass('123456789012')).toBe('font-sm');  // exactly 12
    });

    it('handles boundary at 14 characters (font-sm to font-xs)', () => {
        expect(getCardFontClass('12345678901234')).toBe('font-sm');   // exactly 14
        expect(getCardFontClass('123456789012345')).toBe('font-xs');  // exactly 15
    });

    it('handles boundary at 17 characters (font-xs to font-min)', () => {
        expect(getCardFontClass('12345678901234567')).toBe('font-xs');    // exactly 17
        expect(getCardFontClass('123456789012345678')).toBe('font-min');  // exactly 18
    });

    it('handles empty string', () => {
        expect(getCardFontClass('')).toBe('font-lg');
    });

    it('handles single character', () => {
        expect(getCardFontClass('X')).toBe('font-lg');
    });
});

describe('safeGetItem', () => {
    beforeEach(() => {
        localStorage.clear();
    });

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

    it('returns stored value even when default is provided', () => {
        localStorage.setItem('testKey', 'actual');
        expect(safeGetItem('testKey', 'fallback')).toBe('actual');
    });

    it('returns empty string (not default) when value is empty string', () => {
        localStorage.setItem('emptyKey', '');
        expect(safeGetItem('emptyKey', 'fallback')).toBe('');
    });

    it('returns default when localStorage throws', () => {
        const originalGetItem = Storage.prototype.getItem;
        Storage.prototype.getItem = () => {
            throw new Error('SecurityError: localStorage is disabled');
        };
        try {
            expect(safeGetItem('anyKey', 'safe-default')).toBe('safe-default');
        } finally {
            Storage.prototype.getItem = originalGetItem;
        }
    });

    it('returns null when localStorage throws and no default provided', () => {
        const originalGetItem = Storage.prototype.getItem;
        Storage.prototype.getItem = () => {
            throw new Error('SecurityError');
        };
        try {
            expect(safeGetItem('anyKey')).toBeNull();
        } finally {
            Storage.prototype.getItem = originalGetItem;
        }
    });
});

describe('safeSetItem', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('stores value and returns true on success', () => {
        const result = safeSetItem('key', 'value');
        expect(result).toBe(true);
        expect(localStorage.getItem('key')).toBe('value');
    });

    it('overwrites existing value', () => {
        safeSetItem('key', 'first');
        safeSetItem('key', 'second');
        expect(localStorage.getItem('key')).toBe('second');
    });

    it('stores empty string', () => {
        const result = safeSetItem('key', '');
        expect(result).toBe(true);
        expect(localStorage.getItem('key')).toBe('');
    });

    it('returns false when localStorage throws', () => {
        const originalSetItem = Storage.prototype.setItem;
        Storage.prototype.setItem = () => {
            throw new Error('QuotaExceededError');
        };
        try {
            expect(safeSetItem('key', 'value')).toBe(false);
        } finally {
            Storage.prototype.setItem = originalSetItem;
        }
    });

    it('does not throw when localStorage throws', () => {
        const originalSetItem = Storage.prototype.setItem;
        Storage.prototype.setItem = () => {
            throw new Error('SecurityError');
        };
        try {
            expect(() => safeSetItem('key', 'value')).not.toThrow();
        } finally {
            Storage.prototype.setItem = originalSetItem;
        }
    });
});

describe('safeRemoveItem', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('removes existing item and returns true', () => {
        localStorage.setItem('key', 'value');
        const result = safeRemoveItem('key');
        expect(result).toBe(true);
        expect(localStorage.getItem('key')).toBeNull();
    });

    it('returns true even if key does not exist (no-op)', () => {
        const result = safeRemoveItem('nonexistent');
        expect(result).toBe(true);
    });

    it('returns false when localStorage throws', () => {
        const originalRemoveItem = Storage.prototype.removeItem;
        Storage.prototype.removeItem = () => {
            throw new Error('SecurityError');
        };
        try {
            expect(safeRemoveItem('key')).toBe(false);
        } finally {
            Storage.prototype.removeItem = originalRemoveItem;
        }
    });

    it('does not throw when localStorage throws', () => {
        const originalRemoveItem = Storage.prototype.removeItem;
        Storage.prototype.removeItem = () => {
            throw new Error('SecurityError');
        };
        try {
            expect(() => safeRemoveItem('key')).not.toThrow();
        } finally {
            Storage.prototype.removeItem = originalRemoveItem;
        }
    });
});

describe('localStorage wrappers integration', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('set then get retrieves the value', () => {
        safeSetItem('color', 'blue');
        expect(safeGetItem('color')).toBe('blue');
    });

    it('set then remove then get returns default', () => {
        safeSetItem('color', 'blue');
        safeRemoveItem('color');
        expect(safeGetItem('color', 'none')).toBe('none');
    });

    it('handles JSON data round-trip', () => {
        const data = { team: 'red', role: 'spymaster', score: 5 };
        safeSetItem('gameState', JSON.stringify(data));
        const retrieved = safeGetItem('gameState');
        expect(JSON.parse(retrieved!)).toEqual(data);
    });
});
