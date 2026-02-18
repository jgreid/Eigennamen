/**
 * Input Sanitization Utilities
 *
 * Provides defense-in-depth sanitization for user inputs.
 * Note: These are secondary defenses; primary validation should use Zod schemas.
 */

/**
 * Sanitize HTML special characters to prevent XSS
 * @param input - The string to sanitize
 * @returns Sanitized string with HTML entities escaped
 */
function sanitizeHtml(input: unknown): string {
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
 * @param obj - Object to sanitize
 * @returns Object with sensitive fields redacted
 */
function sanitizeForLog<T>(obj: T): T {
    if (!obj || typeof obj !== 'object') return obj;

    // Handle arrays — recurse into each element
    if (Array.isArray(obj)) {
        return obj.map(item => sanitizeForLog(item)) as unknown as T;
    }

    const sensitivePatterns = ['password', 'token', 'secret', 'key', 'auth', 'credential'];
    const sanitized = { ...obj } as Record<string, unknown>;

    for (const key of Object.keys(sanitized)) {
        const lowerKey = key.toLowerCase();
        if (sensitivePatterns.some(pattern => lowerKey.includes(pattern))) {
            sanitized[key] = '[REDACTED]';
        } else if (typeof sanitized[key] === 'object' && sanitized[key] !== null) {
            sanitized[key] = sanitizeForLog(sanitized[key]);
        }
    }

    return sanitized as T;
}

/**
 * Remove control characters from string
 * @param input - The string to clean
 * @returns String with control characters removed
 */
function removeControlChars(input: unknown): string {
    if (typeof input !== 'string') return '';
    // Remove ASCII control characters (0x00-0x1F) except newline (0x0A) and carriage return (0x0D)
    return input.replace(/[\x00-\x09\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

/**
 * Check if a nickname is reserved
 * @param nickname - The nickname to check
 * @param reservedNames - List of reserved names (lowercase)
 * @returns True if the nickname is reserved
 */
function isReservedName(nickname: unknown, reservedNames: string[]): boolean {
    if (typeof nickname !== 'string') return false;
    const normalized = toEnglishLowerCase(nickname).trim();
    return reservedNames.some(reserved => normalized === reserved);
}

/**
 * Convert string to lowercase using English locale
 * Avoids Turkish/Azerbaijani locale issues where 'I' becomes 'i' (dotless i)
 * @param input - The string to convert
 * @returns Lowercase string
 */
function toEnglishLowerCase(input: unknown): string {
    if (typeof input !== 'string') return '';
    return input.toLocaleLowerCase('en-US');
}

/**
 * Convert string to uppercase using English locale
 * Avoids Turkish/Azerbaijani locale issues where 'i' becomes 'I' (dotted I)
 * @param input - The string to convert
 * @returns Uppercase string
 */
function toEnglishUpperCase(input: unknown): string {
    if (typeof input !== 'string') return '';
    return input.toLocaleUpperCase('en-US');
}

/**
 * Normalize a room code: trim whitespace and lowercase using English locale.
 * Single source of truth for room code normalization across the codebase.
 * @param roomCode - The room code to normalize
 * @returns Normalized room code
 */
function normalizeRoomCode(roomCode: string): string {
    return toEnglishLowerCase(roomCode.trim());
}

// ES6 exports
export {
    sanitizeHtml,
    sanitizeForLog,
    removeControlChars,
    isReservedName,
    toEnglishLowerCase,
    toEnglishUpperCase,
    normalizeRoomCode
};
