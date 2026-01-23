/**
 * Unit tests for utility functions
 */

import { describe, it, expect } from 'vitest';
import {
  escapeHTML,
  seededRandom,
  hashString,
  shuffleWithSeed,
  generateGameSeed,
  escapeWordDelimiter,
  unescapeWordDelimiter,
  encodeWordsForURL,
  decodeWordsFromURL,
  sanitizeTeamName,
  parseWords,
  getCardFontClass,
  debounce,
  throttle,
  deepClone,
  arraysEqual,
} from '../utils.js';

describe('escapeHTML', () => {
  it('should escape special HTML characters', () => {
    expect(escapeHTML('<script>')).toBe('&lt;script&gt;');
    expect(escapeHTML('a & b')).toBe('a &amp; b');
    // Note: textContent-based escaping doesn't escape quotes (they're safe in text content)
    expect(escapeHTML('"quoted"')).toBe('"quoted"');
  });

  it('should handle empty strings', () => {
    expect(escapeHTML('')).toBe('');
  });

  it('should handle non-string input', () => {
    expect(escapeHTML(null)).toBe('');
    expect(escapeHTML(undefined)).toBe('');
  });

  it('should preserve normal text', () => {
    expect(escapeHTML('Hello World')).toBe('Hello World');
  });
});

describe('seededRandom', () => {
  it('should return values between 0 and 1', () => {
    for (let i = 0; i < 100; i++) {
      const val = seededRandom(i);
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThan(1);
    }
  });

  it('should be deterministic', () => {
    expect(seededRandom(12345)).toBe(seededRandom(12345));
    expect(seededRandom(42)).toBe(seededRandom(42));
  });

  it('should produce different values for different seeds', () => {
    expect(seededRandom(1)).not.toBe(seededRandom(2));
  });
});

describe('hashString', () => {
  it('should produce consistent hashes', () => {
    expect(hashString('hello')).toBe(hashString('hello'));
    expect(hashString('world')).toBe(hashString('world'));
  });

  it('should produce different hashes for different strings', () => {
    expect(hashString('hello')).not.toBe(hashString('world'));
  });

  it('should handle empty strings', () => {
    expect(hashString('')).toBe(0);
  });

  it('should return positive integers', () => {
    expect(hashString('test')).toBeGreaterThanOrEqual(0);
  });
});

describe('shuffleWithSeed', () => {
  it('should return a shuffled array', () => {
    const arr = [1, 2, 3, 4, 5];
    const shuffled = shuffleWithSeed(arr, 12345);
    expect(shuffled).toHaveLength(5);
    expect(shuffled.sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('should be deterministic', () => {
    const arr = [1, 2, 3, 4, 5];
    expect(shuffleWithSeed(arr, 42)).toEqual(shuffleWithSeed(arr, 42));
  });

  it('should not modify original array', () => {
    const arr = [1, 2, 3, 4, 5];
    const original = [...arr];
    shuffleWithSeed(arr, 12345);
    expect(arr).toEqual(original);
  });

  it('should produce different results for different seeds', () => {
    const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(shuffleWithSeed(arr, 1)).not.toEqual(shuffleWithSeed(arr, 2));
  });
});

describe('generateGameSeed', () => {
  it('should generate a string', () => {
    expect(typeof generateGameSeed()).toBe('string');
  });

  it('should generate different seeds', () => {
    const seeds = new Set();
    for (let i = 0; i < 100; i++) {
      seeds.add(generateGameSeed());
    }
    // Should have mostly unique seeds
    expect(seeds.size).toBeGreaterThan(90);
  });
});

describe('word encoding', () => {
  describe('escapeWordDelimiter / unescapeWordDelimiter', () => {
    it('should escape and unescape pipe characters', () => {
      const original = 'word|with|pipes';
      const escaped = escapeWordDelimiter(original);
      // Escaped form uses backslash-pipe, so verify roundtrip works
      expect(unescapeWordDelimiter(escaped)).toBe(original);
      expect(escaped).not.toBe(original); // Should be different
    });

    it('should handle backslashes', () => {
      const original = 'back\\slash';
      const escaped = escapeWordDelimiter(original);
      expect(unescapeWordDelimiter(escaped)).toBe(original);
    });
  });

  describe('encodeWordsForURL / decodeWordsFromURL', () => {
    it('should encode and decode word lists', () => {
      const words = ['APPLE', 'BANANA', 'CHERRY'];
      const encoded = encodeWordsForURL(words);
      const decoded = decodeWordsFromURL(encoded);
      expect(decoded).toEqual(words);
    });

    it('should handle special characters', () => {
      const words = ['ICE CREAM', 'NEW YORK', 'LOCH NESS'];
      const encoded = encodeWordsForURL(words);
      const decoded = decodeWordsFromURL(encoded);
      expect(decoded).toEqual(words);
    });

    it('should return null for invalid encoding', () => {
      expect(decodeWordsFromURL('invalid!')).toBeNull();
    });
  });
});

describe('sanitizeTeamName', () => {
  it('should allow alphanumeric characters', () => {
    expect(sanitizeTeamName('Team123', 'Default')).toBe('Team123');
  });

  it('should allow spaces and hyphens', () => {
    expect(sanitizeTeamName('Red Team', 'Default')).toBe('Red Team');
    expect(sanitizeTeamName('Blue-Team', 'Default')).toBe('Blue-Team');
  });

  it('should remove special characters', () => {
    expect(sanitizeTeamName('Team<script>', 'Default')).toBe('Teamscript');
  });

  it('should return default for empty result', () => {
    expect(sanitizeTeamName('!!!', 'Default')).toBe('Default');
  });

  it('should respect max length', () => {
    const longName = 'A'.repeat(100);
    expect(sanitizeTeamName(longName, 'Default', 32)).toHaveLength(32);
  });

  it('should return default for null input', () => {
    expect(sanitizeTeamName(null, 'Default')).toBe('Default');
  });
});

describe('parseWords', () => {
  it('should split by newlines', () => {
    expect(parseWords('APPLE\nBANANA\nCHERRY')).toEqual(['APPLE', 'BANANA', 'CHERRY']);
  });

  it('should trim whitespace', () => {
    expect(parseWords('  APPLE  \n  BANANA  ')).toEqual(['APPLE', 'BANANA']);
  });

  it('should uppercase words', () => {
    expect(parseWords('apple\nBanana')).toEqual(['APPLE', 'BANANA']);
  });

  it('should filter empty lines', () => {
    expect(parseWords('APPLE\n\nBANANA\n\n')).toEqual(['APPLE', 'BANANA']);
  });
});

describe('getCardFontClass', () => {
  it('should return empty for short words', () => {
    expect(getCardFontClass('SHORT')).toBe('');
  });

  it('should return font-small for medium words', () => {
    expect(getCardFontClass('LONGERNAME')).toBe('');  // 10 chars, not > 10
    expect(getCardFontClass('LONGERNAMES')).toBe('font-small');  // 11 chars
  });

  it('should return font-tiny for long words', () => {
    expect(getCardFontClass('VERYLONGWORDHERE')).toBe('font-tiny');  // 16 chars
  });

  it('should handle empty input', () => {
    expect(getCardFontClass('')).toBe('');
    expect(getCardFontClass(null)).toBe('');
  });
});

describe('debounce', () => {
  it('should delay function execution', async () => {
    let count = 0;
    const fn = debounce(() => count++, 50);

    fn();
    fn();
    fn();

    expect(count).toBe(0);

    await new Promise(resolve => setTimeout(resolve, 100));
    expect(count).toBe(1);
  });
});

describe('deepClone', () => {
  it('should clone objects', () => {
    const obj = { a: 1, b: { c: 2 } };
    const clone = deepClone(obj);

    expect(clone).toEqual(obj);
    expect(clone).not.toBe(obj);
    expect(clone.b).not.toBe(obj.b);
  });

  it('should clone arrays', () => {
    const arr = [1, [2, 3], { a: 4 }];
    const clone = deepClone(arr);

    expect(clone).toEqual(arr);
    expect(clone).not.toBe(arr);
  });
});

describe('arraysEqual', () => {
  it('should return true for equal arrays', () => {
    expect(arraysEqual([1, 2, 3], [1, 2, 3])).toBe(true);
  });

  it('should return false for different arrays', () => {
    expect(arraysEqual([1, 2, 3], [1, 2, 4])).toBe(false);
  });

  it('should return false for different lengths', () => {
    expect(arraysEqual([1, 2], [1, 2, 3])).toBe(false);
  });

  it('should handle empty arrays', () => {
    expect(arraysEqual([], [])).toBe(true);
  });

  it('should return true for same reference', () => {
    const arr = [1, 2, 3];
    expect(arraysEqual(arr, arr)).toBe(true);
  });

  it('should handle null', () => {
    // null === null is true due to reference equality check
    expect(arraysEqual(null, null)).toBe(true);
    expect(arraysEqual([1], null)).toBe(false);
  });
});
