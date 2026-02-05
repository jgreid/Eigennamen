/**
 * JSON Serializer Utility
 *
 * Centralizes JSON parsing/stringifying with consistent error handling.
 * Replaces scattered JSON.parse/JSON.stringify calls throughout the codebase.
 *
 * Benefits:
 * - Consistent error handling
 * - Automatic logging of parse failures
 * - Type-safe parsing with defaults
 * - Performance tracking for large objects
 */

const logger = require('./logger');

/**
 * Safely parse JSON with error handling
 * @param {string} jsonString - JSON string to parse
 * @param {*} defaultValue - Default value if parsing fails (default: null)
 * @param {string} context - Context for error logging
 * @returns {*} Parsed object or default value
 */
function safeParse(jsonString, defaultValue = null, context = 'unknown') {
    if (jsonString === null || jsonString === undefined) {
        return defaultValue;
    }

    if (typeof jsonString !== 'string') {
        // Already an object, return as-is
        return jsonString;
    }

    try {
        return JSON.parse(jsonString);
    } catch (error) {
        logger.warn('JSON parse failed', {
            context,
            error: error.message,
            preview: jsonString.substring(0, 100)
        });
        return defaultValue;
    }
}

/**
 * Parse JSON or throw with context
 * @param {string} jsonString - JSON string to parse
 * @param {string} context - Context for error message
 * @returns {*} Parsed object
 * @throws {Error} If parsing fails
 */
function parseOrThrow(jsonString, context = 'unknown') {
    if (jsonString === null || jsonString === undefined) {
        throw new Error(`Cannot parse null/undefined JSON in ${context}`);
    }

    try {
        return JSON.parse(jsonString);
    } catch (error) {
        logger.error('JSON parse error', {
            context,
            error: error.message,
            preview: typeof jsonString === 'string' ? jsonString.substring(0, 100) : String(jsonString)
        });
        throw new Error(`JSON parse failed in ${context}: ${error.message}`);
    }
}

/**
 * Safely stringify with error handling
 * @param {*} obj - Object to stringify
 * @param {string} defaultValue - Default value if stringifying fails
 * @param {string} context - Context for error logging
 * @returns {string} JSON string or default value
 */
function safeStringify(obj, defaultValue = '{}', context = 'unknown') {
    if (obj === null || obj === undefined) {
        return defaultValue;
    }

    try {
        return JSON.stringify(obj);
    } catch (error) {
        logger.warn('JSON stringify failed', {
            context,
            error: error.message,
            type: typeof obj
        });
        return defaultValue;
    }
}

/**
 * Stringify or throw with context
 * @param {*} obj - Object to stringify
 * @param {string} context - Context for error message
 * @returns {string} JSON string
 * @throws {Error} If stringifying fails
 */
function stringifyOrThrow(obj, context = 'unknown') {
    try {
        return JSON.stringify(obj);
    } catch (error) {
        logger.error('JSON stringify error', {
            context,
            error: error.message,
            type: typeof obj
        });
        throw new Error(`JSON stringify failed in ${context}: ${error.message}`);
    }
}

/**
 * Parse multiple JSON strings (for Redis mGet results)
 * @param {(string|null)[]} jsonStrings - Array of JSON strings
 * @param {string} context - Context for error logging
 * @returns {(*|null)[]} Array of parsed objects (null for failed parses)
 */
function parseMany(jsonStrings, context = 'unknown') {
    if (!Array.isArray(jsonStrings)) {
        return [];
    }

    return jsonStrings.map((str, index) => {
        if (str === null || str === undefined) {
            return null;
        }
        return safeParse(str, null, `${context}[${index}]`);
    });
}

/**
 * Parse and validate against expected structure
 * @param {string} jsonString - JSON string to parse
 * @param {string[]} requiredFields - Required fields to validate
 * @param {string} context - Context for error logging
 * @returns {{valid: boolean, data: *|null, missing: string[]}}
 */
function parseAndValidate(jsonString, requiredFields = [], context = 'unknown') {
    const data = safeParse(jsonString, null, context);

    if (data === null) {
        return { valid: false, data: null, missing: requiredFields };
    }

    const missing = requiredFields.filter(field => !(field in data));

    if (missing.length > 0) {
        logger.warn('Parsed JSON missing required fields', {
            context,
            missing,
            hasFields: Object.keys(data)
        });
        return { valid: false, data, missing };
    }

    return { valid: true, data, missing: [] };
}

/**
 * Deep clone an object via JSON serialization
 * @param {*} obj - Object to clone
 * @param {string} context - Context for error logging
 * @returns {*|null} Cloned object or null if failed
 */
function deepClone(obj, context = 'unknown') {
    if (obj === null || obj === undefined) {
        return obj;
    }

    try {
        return JSON.parse(JSON.stringify(obj));
    } catch (error) {
        logger.warn('Deep clone failed', {
            context,
            error: error.message
        });
        return null;
    }
}

/**
 * Parse with type checking
 * @param {string} jsonString - JSON string to parse
 * @param {string} expectedType - Expected type ('object', 'array', 'string', 'number')
 * @param {*} defaultValue - Default value if parsing fails or type mismatch
 * @param {string} context - Context for error logging
 * @returns {*} Parsed value of expected type or default
 */
function parseTyped(jsonString, expectedType, defaultValue, context = 'unknown') {
    const parsed = safeParse(jsonString, null, context);

    if (parsed === null) {
        return defaultValue;
    }

    const actualType = Array.isArray(parsed) ? 'array' : typeof parsed;

    if (actualType !== expectedType) {
        logger.warn('Parsed JSON type mismatch', {
            context,
            expected: expectedType,
            actual: actualType
        });
        return defaultValue;
    }

    return parsed;
}

/**
 * Create a cached parser for repeated parsing of similar structures
 * Useful for parsing many records with the same schema
 * @param {string[]} requiredFields - Required fields to validate
 * @param {string} context - Context for error logging
 * @returns {function(string): *|null} Parser function
 */
function createParser(requiredFields = [], context = 'unknown') {
    return (jsonString) => {
        const result = parseAndValidate(jsonString, requiredFields, context);
        return result.valid ? result.data : null;
    };
}

/**
 * Merge parsed objects with defaults
 * @param {string} jsonString - JSON string to parse
 * @param {Object} defaults - Default values
 * @param {string} context - Context for error logging
 * @returns {Object} Merged object
 */
function parseWithDefaults(jsonString, defaults = {}, context = 'unknown') {
    const parsed = safeParse(jsonString, {}, context);

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return { ...defaults };
    }

    return { ...defaults, ...parsed };
}

module.exports = {
    safeParse,
    parseOrThrow,
    safeStringify,
    stringifyOrThrow,
    parseMany,
    parseAndValidate,
    deepClone,
    parseTyped,
    createParser,
    parseWithDefaults
};
