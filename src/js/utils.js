/**
 * Utility Functions
 *
 * Pure utility functions for the Codenames game.
 * These have no side effects and don't depend on global state.
 *
 * @module utils
 */

/**
 * Escape HTML special characters to prevent XSS
 * @param {string} str - String to escape
 * @returns {string} Escaped string safe for innerHTML
 */
export function escapeHTML(str) {
  if (typeof str !== 'string') return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Seeded random number generator using Mulberry32 algorithm
 * Provides better distribution than Math.sin-based approach
 * Must stay in sync with server-side implementation in gameService.js
 *
 * @param {number} seed - Integer seed value
 * @returns {number} Pseudo-random number between 0 and 1
 */
export function seededRandom(seed) {
  let t = (seed + 0x6D2B79F5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * Hash a string to a numeric value
 * Uses a simple djb2-like algorithm
 *
 * @param {string} str - String to hash
 * @returns {number} Positive integer hash value
 */
export function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

/**
 * Fisher-Yates shuffle with seeded randomness
 * Produces deterministic results for the same seed
 *
 * @param {Array} array - Array to shuffle
 * @param {number} seed - Seed for random number generation
 * @returns {Array} New shuffled array (original unchanged)
 */
export function shuffleWithSeed(array, seed) {
  const shuffled = [...array];
  let currentSeed = seed;
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(seededRandom(currentSeed++) * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * Generate a random game seed using crypto API
 * @returns {string} Base36 encoded seed string
 */
export function generateGameSeed() {
  const array = new Uint32Array(2);
  crypto.getRandomValues(array);
  return array[0].toString(36) + array[1].toString(36).substring(0, 4);
}

/**
 * Escape word delimiter for URL encoding
 * Escapes backslash and pipe characters
 *
 * @param {string} word - Word to escape
 * @returns {string} Escaped word
 */
export function escapeWordDelimiter(word) {
  return word.replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
}

/**
 * Unescape word delimiter after URL decoding
 * Reverses escapeWordDelimiter
 *
 * @param {string} word - Word to unescape
 * @returns {string} Original word
 */
export function unescapeWordDelimiter(word) {
  return word.replace(/\\\|/g, '|').replace(/\\\\/g, '\\');
}

/**
 * Encode an array of words for URL parameter
 * Uses base64 encoding with URL-safe characters
 *
 * @param {string[]} words - Array of words to encode
 * @returns {string} URL-safe encoded string
 */
export function encodeWordsForURL(words) {
  return btoa(words.map(escapeWordDelimiter).join('|'))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Decode words from URL parameter
 * Reverses encodeWordsForURL
 *
 * @param {string} encoded - Encoded string from URL
 * @returns {string[]|null} Array of words, or null on error
 */
export function decodeWordsFromURL(encoded) {
  try {
    const padded = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = atob(padded);

    // Split on unescaped | only (not preceded by backslash)
    const parts = [];
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
  } catch (e) {
    return null;
  }
}

/**
 * Sanitize team name according to validation rules
 * Only allows alphanumeric, spaces, and hyphens (matches server validation)
 *
 * @param {string} name - Team name to sanitize
 * @param {string} defaultName - Default name if sanitization fails
 * @param {number} [maxLength=32] - Maximum allowed length
 * @returns {string} Sanitized team name
 */
export function sanitizeTeamName(name, defaultName, maxLength = 32) {
  if (!name) return defaultName;
  const sanitized = name.slice(0, maxLength).replace(/[^a-zA-Z0-9\s\-]/g, '');
  return sanitized.length > 0 ? sanitized : defaultName;
}

/**
 * Parse custom words from text input
 * Splits by newlines and filters empty lines
 *
 * @param {string} text - Raw text input
 * @returns {string[]} Array of words
 */
export function parseWords(text) {
  return text
    .split('\n')
    .map(w => w.trim().toUpperCase())
    .filter(w => w.length > 0);
}

/**
 * Get CSS class for card font size based on word length
 *
 * @param {string} word - Word to check
 * @param {Object} [thresholds] - Length thresholds
 * @param {number} [thresholds.small=10] - Threshold for small font
 * @param {number} [thresholds.tiny=14] - Threshold for tiny font
 * @returns {string} CSS class name
 */
export function getCardFontClass(word, thresholds = { small: 10, tiny: 14 }) {
  if (!word) return '';
  if (word.length > thresholds.tiny) return 'font-tiny';
  if (word.length > thresholds.small) return 'font-small';
  return '';
}

/**
 * Create a debounced version of a function
 *
 * @param {Function} fn - Function to debounce
 * @param {number} delay - Delay in milliseconds
 * @returns {Function} Debounced function
 */
export function debounce(fn, delay) {
  let timeoutId;
  return function (...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn.apply(this, args), delay);
  };
}

/**
 * Create a throttled version of a function
 *
 * @param {Function} fn - Function to throttle
 * @param {number} limit - Minimum time between calls in milliseconds
 * @returns {Function} Throttled function
 */
export function throttle(fn, limit) {
  let inThrottle;
  return function (...args) {
    if (!inThrottle) {
      fn.apply(this, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}

/**
 * Deep clone an object using structured clone
 * Falls back to JSON parse/stringify for older browsers
 *
 * @param {Object} obj - Object to clone
 * @returns {Object} Cloned object
 */
export function deepClone(obj) {
  if (typeof structuredClone === 'function') {
    return structuredClone(obj);
  }
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Check if two arrays are equal (shallow comparison)
 *
 * @param {Array} a - First array
 * @param {Array} b - Second array
 * @returns {boolean} True if arrays are equal
 */
export function arraysEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// Default export with all utilities
export default {
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
};
