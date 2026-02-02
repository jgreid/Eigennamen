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
 * Sanitize object for logging (redact sensitive fields)
 * @param {object} obj - Object to sanitize
 * @returns {object} - Object with sensitive fields redacted
 */
function sanitizeForLog(obj) {
    if (!obj || typeof obj !== 'object') return obj;

    // Handle arrays — recurse into each element
    if (Array.isArray(obj)) {
        return obj.map(item => sanitizeForLog(item));
    }

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
    sanitizeForLog,
    removeControlChars,
    isReservedName,
    toEnglishLowerCase,
    toEnglishUpperCase,
    localeCompare,
    localeIncludes
};
