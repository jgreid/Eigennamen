/**
 * Unified Lua Script Result Parser
 *
 * Standardizes result handling across all Lua scripts, replacing ad-hoc
 * parsing scattered across services. Supports all three result patterns:
 *
 * 1. JSON objects with {error?, success?, ...} fields
 * 2. Numeric return codes (0, 1, -1, -2)
 * 3. Special string sentinels ('EXPIRED', 'RECONNECTED')
 *
 * Usage:
 *   const result = parseLuaResult(rawResult, { schema, sentinels, operationName });
 */

import type { ZodSchema } from 'zod';

import logger from './logger';
import { tryParseJSON } from './parseJSON';

/**
 * Parsed Lua script result — a discriminated union.
 */
export type LuaResult<T> =
    | { kind: 'success'; data: T }
    | { kind: 'null' }
    | { kind: 'sentinel'; value: string }
    | { kind: 'numeric'; value: number }
    | { kind: 'error'; code: string; detail?: string };

export interface LuaParseLuaResultOptions<T> {
    /** Zod schema for JSON result validation. If omitted, raw JSON.parse is used. */
    schema?: ZodSchema<T>;
    /** Recognized string sentinels (e.g., ['EXPIRED', 'RECONNECTED']) */
    sentinels?: readonly string[];
    /** Operation name for logging context */
    operationName: string;
}

/**
 * Parse a raw Redis eval result into a typed, discriminated union.
 *
 * Handles all Lua script return conventions in a single function:
 * - null/undefined → { kind: 'null' }
 * - number → { kind: 'numeric', value }
 * - sentinel string → { kind: 'sentinel', value }
 * - JSON with error field → { kind: 'error', code }
 * - JSON with success:false → { kind: 'error', code: reason }
 * - Valid JSON → { kind: 'success', data }
 */
export function parseLuaResult<T = Record<string, unknown>>(
    raw: unknown,
    options: LuaParseLuaResultOptions<T>
): LuaResult<T> {
    const { schema, sentinels = [], operationName } = options;

    // Null/undefined → resource not found
    if (raw === null || raw === undefined) {
        return { kind: 'null' };
    }

    // Numeric return codes
    if (typeof raw === 'number') {
        return { kind: 'numeric', value: raw };
    }

    // String results
    if (typeof raw === 'string') {
        // Check for known sentinels first
        if (sentinels.includes(raw)) {
            return { kind: 'sentinel', value: raw };
        }

        // Try JSON parse
        if (schema) {
            const parsed = tryParseJSON(raw, schema, operationName);
            if (!parsed) {
                logger.warn(`parseLuaResult: failed to validate ${operationName} result against schema`);
                return { kind: 'error', code: 'PARSE_FAILED', detail: 'Schema validation failed' };
            }

            // Check for error/success convention
            const obj = parsed as Record<string, unknown>;
            if (typeof obj.error === 'string') {
                return { kind: 'error', code: obj.error, detail: String(obj.error) };
            }
            if (obj.success === false && typeof obj.reason === 'string') {
                return { kind: 'error', code: obj.reason, detail: String(obj.reason) };
            }

            return { kind: 'success', data: parsed };
        }

        // No schema — try raw JSON parse for error detection
        try {
            const parsed = JSON.parse(raw);
            if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
                return { kind: 'sentinel', value: raw };
            }
            const obj = parsed as Record<string, unknown>;
            if (typeof obj.error === 'string') {
                return { kind: 'error', code: obj.error, detail: String(obj.error) };
            }
            if (obj.success === false && typeof obj.reason === 'string') {
                return { kind: 'error', code: obj.reason, detail: String(obj.reason) };
            }
            return { kind: 'success', data: obj as T };
        } catch {
            // Not JSON — treat as sentinel
            return { kind: 'sentinel', value: raw };
        }
    }

    logger.warn(`parseLuaResult: unexpected result type for ${operationName}: ${typeof raw}`);
    return { kind: 'error', code: 'UNEXPECTED_TYPE', detail: `Unexpected type: ${typeof raw}` };
}

/**
 * Convenience: assert a LuaResult is successful or throw.
 */
export function unwrapLuaResult<T>(result: LuaResult<T>, operationName: string): T {
    if (result.kind === 'success') {
        return result.data;
    }
    if (result.kind === 'error') {
        throw new Error(`Lua ${operationName} error: ${result.code}`);
    }
    if (result.kind === 'null') {
        throw new Error(`Lua ${operationName}: resource not found`);
    }
    throw new Error(`Lua ${operationName}: unexpected result kind '${result.kind}'`);
}
