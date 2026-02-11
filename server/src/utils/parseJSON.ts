/**
 * Safe JSON Parsing Utility
 *
 * Replaces unsafe `JSON.parse(x) as T` patterns with runtime-validated parsing.
 * Uses Zod schemas to ensure deserialized data matches expected shapes,
 * preventing runtime errors from corrupted or stale Redis data.
 */

import type { ZodSchema, ZodError } from 'zod';

import logger from './logger';
/**
 * Parse a JSON string and validate against a Zod schema.
 * Throws if the JSON is malformed or fails validation.
 *
 * @param data - JSON string to parse
 * @param schema - Zod schema to validate against
 * @param context - Description for error logging (e.g., "timer state for room ABC")
 * @returns Validated and typed result
 * @throws Error if JSON is malformed or validation fails
 */
export function parseJSON<T>(data: string, schema: ZodSchema<T>, context?: string): T {
    let parsed: unknown;
    try {
        parsed = JSON.parse(data);
    } catch (e) {
        const msg = `Failed to parse JSON${context ? ` (${context})` : ''}: ${(e as Error).message}`;
        logger.warn(msg);
        throw new Error(msg);
    }

    const result = schema.safeParse(parsed);
    if (!result.success) {
        const issues = (result.error as ZodError).issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ');
        const msg = `JSON validation failed${context ? ` (${context})` : ''}: ${issues}`;
        logger.warn(msg);
        throw new Error(msg);
    }

    return result.data;
}

/**
 * Parse a JSON string and validate, returning null on failure instead of throwing.
 * Useful for non-critical paths where corrupted data should be skipped.
 *
 * @param data - JSON string to parse
 * @param schema - Zod schema to validate against
 * @param context - Description for error logging
 * @returns Validated result or null
 */
export function tryParseJSON<T>(data: string, schema: ZodSchema<T>, context?: string): T | null {
    try {
        return parseJSON(data, schema, context);
    } catch {
        return null;
    }
}
