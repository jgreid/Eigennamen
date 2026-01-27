/**
 * Input Sanitization Utilities
 *
 * Provides defense-in-depth sanitization for user inputs.
 * Note: These are secondary defenses; primary validation should use Zod schemas.
 */

/**
 * Sanitize HTML special characters to prevent XSS
 * @param {string} input - The string to sanitize
 * @returns {string} - Sanitized string with HTML entities escaped
 */
function sanitizeHtml(input) {
    if (typeof input !== 'string') return '';

    return input
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;')
        .replace(/\//g, '&#x2F;');
}

/**
 * Strip HTML tags from input
 * @param {string} input - The string to strip
 * @returns {string} - String with HTML tags removed
 */
function stripHtml(input) {
    if (typeof input !== 'string') return '';
    return input.replace(/<[^>]*>/g, '');
}

/**
 * Sanitize object for logging (redact sensitive fields)
 * @param {object} obj - Object to sanitize
 * @returns {object} - Object with sensitive fields redacted
 */
function sanitizeForLog(obj) {
    if (!obj || typeof obj !== 'object') return obj;

    const sensitivePatterns = ['password', 'token', 'secret', 'key', 'auth', 'credential'];
    const sanitized = { ...obj };

    for (const key of Object.keys(sanitized)) {
        const lowerKey = key.toLowerCase();
        if (sensitivePatterns.some(pattern => lowerKey.includes(pattern))) {
            sanitized[key] = '[REDACTED]';
        } else if (typeof sanitized[key] === 'object' && sanitized[key] !== null) {
            sanitized[key] = sanitizeForLog(sanitized[key]);
        }
    }

    return sanitized;
}

/**
 * Remove control characters from string
 * @param {string} input - The string to clean
 * @returns {string} - String with control characters removed
 */
function removeControlChars(input) {
    if (typeof input !== 'string') return '';
    // Remove ASCII control characters (0x00-0x1F) except newline (0x0A) and carriage return (0x0D)
    return input.replace(/[\x00-\x09\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

/**
 * Normalize whitespace (collapse multiple spaces, trim)
 * @param {string} input - The string to normalize
 * @returns {string} - Normalized string
 */
function normalizeWhitespace(input) {
    if (typeof input !== 'string') return '';
    return input.replace(/\s+/g, ' ').trim();
}

/**
 * Full sanitization pipeline for user-provided text
 * @param {string} input - The string to sanitize
 * @param {object} options - Sanitization options
 * @param {boolean} options.stripHtml - Whether to strip HTML tags
 * @param {boolean} options.escapeHtml - Whether to escape HTML entities
 * @param {boolean} options.removeControl - Whether to remove control characters
 * @param {boolean} options.normalizeSpace - Whether to normalize whitespace
 * @returns {string} - Sanitized string
 */
function sanitizeInput(input, options = {}) {
    if (typeof input !== 'string') return '';

    let result = input;

    if (options.removeControl !== false) {
        result = removeControlChars(result);
    }

    if (options.stripHtml) {
        result = stripHtml(result);
    }

    if (options.escapeHtml) {
        result = sanitizeHtml(result);
    }

    if (options.normalizeSpace !== false) {
        result = normalizeWhitespace(result);
    }

    return result;
}

/**
 * Check if a nickname is reserved
 * @param {string} nickname - The nickname to check
 * @param {string[]} reservedNames - List of reserved names (lowercase)
 * @returns {boolean} - True if the nickname is reserved
 */
function isReservedName(nickname, reservedNames) {
    if (typeof nickname !== 'string') return false;
    const normalized = toEnglishLowerCase(nickname).trim();
    return reservedNames.some(reserved => normalized === reserved);
}

/**
 * Convert string to lowercase using English locale
 * Avoids Turkish/Azerbaijani locale issues where 'I' becomes 'ı' (dotless i)
 * @param {string} input - The string to convert
 * @returns {string} - Lowercase string
 */
function toEnglishLowerCase(input) {
    if (typeof input !== 'string') return '';
    return input.toLocaleLowerCase('en-US');
}

/**
 * Convert string to uppercase using English locale
 * Avoids Turkish/Azerbaijani locale issues where 'i' becomes 'İ' (dotted I)
 * @param {string} input - The string to convert
 * @returns {string} - Uppercase string
 */
function toEnglishUpperCase(input) {
    if (typeof input !== 'string') return '';
    return input.toLocaleUpperCase('en-US');
}

/**
 * Normalize Unicode string to NFC form and apply English case conversion
 * This ensures consistent comparison across different Unicode representations
 * (e.g., 'é' vs 'e' + combining accent)
 * @param {string} input - The string to normalize
 * @param {string} caseType - 'lower', 'upper', or 'none'
 * @returns {string} - Normalized string
 */
function normalizeUnicode(input, caseType = 'none') {
    if (typeof input !== 'string') return '';

    // Normalize to NFC (Canonical Decomposition, followed by Canonical Composition)
    let normalized = input.normalize('NFC');

    if (caseType === 'lower') {
        normalized = toEnglishLowerCase(normalized);
    } else if (caseType === 'upper') {
        normalized = toEnglishUpperCase(normalized);
    }

    return normalized;
}

/**
 * Compare two strings in a locale-safe manner
 * Uses English collation to ensure consistent comparison across locales
 * @param {string} a - First string
 * @param {string} b - Second string
 * @param {object} options - Comparison options
 * @param {boolean} options.caseInsensitive - Whether to ignore case (default: true)
 * @returns {number} - -1, 0, or 1 for sorting; 0 means equal
 */
function localeCompare(a, b, options = {}) {
    const { caseInsensitive = true } = options;

    if (typeof a !== 'string') a = '';
    if (typeof b !== 'string') b = '';

    // Normalize both strings first
    const normalizedA = a.normalize('NFC');
    const normalizedB = b.normalize('NFC');

    // Use English collator for consistent comparison across locales
    const collator = new Intl.Collator('en-US', {
        sensitivity: caseInsensitive ? 'base' : 'variant',
        usage: 'sort'
    });

    return collator.compare(normalizedA, normalizedB);
}

/**
 * Check if string A contains string B (locale-safe)
 * @param {string} haystack - String to search in
 * @param {string} needle - String to search for
 * @param {boolean} caseInsensitive - Whether to ignore case (default: true)
 * @returns {boolean} - True if haystack contains needle
 */
function localeIncludes(haystack, needle, caseInsensitive = true) {
    if (typeof haystack !== 'string' || typeof needle !== 'string') return false;

    // Normalize both strings
    let normalizedHaystack = haystack.normalize('NFC');
    let normalizedNeedle = needle.normalize('NFC');

    if (caseInsensitive) {
        normalizedHaystack = toEnglishLowerCase(normalizedHaystack);
        normalizedNeedle = toEnglishLowerCase(normalizedNeedle);
    }

    return normalizedHaystack.includes(normalizedNeedle);
}

module.exports = {
    sanitizeHtml,
    stripHtml,
    sanitizeForLog,
    removeControlChars,
    normalizeWhitespace,
    sanitizeInput,
    isReservedName,
    toEnglishLowerCase,
    toEnglishUpperCase,
    normalizeUnicode,
    localeCompare,
    localeIncludes
};
