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
 * Validation result interface
 */
interface ValidationResult<T> {
    valid: boolean;
    data: T | null;
    missing: string[];
}

/**
 * Safely parse JSON with error handling
 * @param jsonString - JSON string to parse
 * @param defaultValue - Default value if parsing fails (default: null)
 * @param context - Context for error logging
 * @returns Parsed object or default value
 */
function safeParse<T = unknown>(jsonString: string | null | undefined, defaultValue: T | null = null, context: string = 'unknown'): T | null {
    if (jsonString === null || jsonString === undefined) {
        return defaultValue;
    }

    if (typeof jsonString !== 'string') {
        // Already an object, return as-is
        return jsonString as T;
    }

    try {
        return JSON.parse(jsonString) as T;
    } catch (error) {
        logger.warn('JSON parse failed', {
            context,
            error: (error as Error).message,
            preview: jsonString.substring(0, 100)
        });
        return defaultValue;
    }
}

/**
 * Parse JSON or throw with context
 * @param jsonString - JSON string to parse
 * @param context - Context for error message
 * @returns Parsed object
 * @throws If parsing fails
 */
function parseOrThrow<T = unknown>(jsonString: string | null | undefined, context: string = 'unknown'): T {
    if (jsonString === null || jsonString === undefined) {
        throw new Error(`Cannot parse null/undefined JSON in ${context}`);
    }

    try {
        return JSON.parse(jsonString) as T;
    } catch (error) {
        logger.error('JSON parse error', {
            context,
            error: (error as Error).message,
            preview: typeof jsonString === 'string' ? jsonString.substring(0, 100) : String(jsonString)
        });
        throw new Error(`JSON parse failed in ${context}: ${(error as Error).message}`);
    }
}

/**
 * Safely stringify with error handling
 * @param obj - Object to stringify
 * @param defaultValue - Default value if stringifying fails
 * @param context - Context for error logging
 * @returns JSON string or default value
 */
function safeStringify(obj: unknown, defaultValue: string = '{}', context: string = 'unknown'): string {
    if (obj === null || obj === undefined) {
        return defaultValue;
    }

    try {
        return JSON.stringify(obj);
    } catch (error) {
        logger.warn('JSON stringify failed', {
            context,
            error: (error as Error).message,
            type: typeof obj
        });
        return defaultValue;
    }
}

/**
 * Stringify or throw with context
 * @param obj - Object to stringify
 * @param context - Context for error message
 * @returns JSON string
 * @throws If stringifying fails
 */
function stringifyOrThrow(obj: unknown, context: string = 'unknown'): string {
    try {
        return JSON.stringify(obj);
    } catch (error) {
        logger.error('JSON stringify error', {
            context,
            error: (error as Error).message,
            type: typeof obj
        });
        throw new Error(`JSON stringify failed in ${context}: ${(error as Error).message}`);
    }
}

/**
 * Parse multiple JSON strings (for Redis mGet results)
 * @param jsonStrings - Array of JSON strings
 * @param context - Context for error logging
 * @returns Array of parsed objects (null for failed parses)
 */
function parseMany<T = unknown>(jsonStrings: (string | null)[], context: string = 'unknown'): (T | null)[] {
    if (!Array.isArray(jsonStrings)) {
        return [];
    }

    return jsonStrings.map((str, index) => {
        if (str === null || str === undefined) {
            return null;
        }
        return safeParse<T>(str, null, `${context}[${index}]`);
    });
}

/**
 * Parse and validate against expected structure
 * @param jsonString - JSON string to parse
 * @param requiredFields - Required fields to validate
 * @param context - Context for error logging
 * @returns Validation result with data and missing fields
 */
function parseAndValidate<T extends Record<string, unknown> = Record<string, unknown>>(
    jsonString: string | null | undefined,
    requiredFields: string[] = [],
    context: string = 'unknown'
): ValidationResult<T> {
    const data = safeParse<T>(jsonString, null, context);

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
 * @param obj - Object to clone
 * @param context - Context for error logging
 * @returns Cloned object or null if failed
 */
function deepClone<T>(obj: T, context: string = 'unknown'): T | null {
    if (obj === null || obj === undefined) {
        return obj;
    }

    try {
        return JSON.parse(JSON.stringify(obj)) as T;
    } catch (error) {
        logger.warn('Deep clone failed', {
            context,
            error: (error as Error).message
        });
        return null;
    }
}

/**
 * Expected type for parseTyped
 */
type ExpectedType = 'object' | 'array' | 'string' | 'number';

/**
 * Parse with type checking
 * @param jsonString - JSON string to parse
 * @param expectedType - Expected type ('object', 'array', 'string', 'number')
 * @param defaultValue - Default value if parsing fails or type mismatch
 * @param context - Context for error logging
 * @returns Parsed value of expected type or default
 */
function parseTyped<T>(
    jsonString: string | null | undefined,
    expectedType: ExpectedType,
    defaultValue: T,
    context: string = 'unknown'
): T {
    const parsed = safeParse<T>(jsonString, null, context);

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
 * Parser function type
 */
type ParserFunction<T> = (jsonString: string) => T | null;

/**
 * Create a cached parser for repeated parsing of similar structures
 * Useful for parsing many records with the same schema
 * @param requiredFields - Required fields to validate
 * @param context - Context for error logging
 * @returns Parser function
 */
function createParser<T extends Record<string, unknown> = Record<string, unknown>>(
    requiredFields: string[] = [],
    context: string = 'unknown'
): ParserFunction<T> {
    return (jsonString: string): T | null => {
        const result = parseAndValidate<T>(jsonString, requiredFields, context);
        return result.valid ? result.data : null;
    };
}

/**
 * Merge parsed objects with defaults
 * @param jsonString - JSON string to parse
 * @param defaults - Default values
 * @param context - Context for error logging
 * @returns Merged object
 */
function parseWithDefaults<T extends Record<string, unknown>>(
    jsonString: string | null | undefined,
    defaults: T,
    context: string = 'unknown'
): T {
    const parsed = safeParse<Record<string, unknown>>(jsonString, {}, context);

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return { ...defaults };
    }

    return { ...defaults, ...parsed } as T;
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

// ES6 exports for TypeScript imports
export {
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

export type { ValidationResult, ExpectedType, ParserFunction };
