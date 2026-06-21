/**
 * UUID utilities.
 *
 * The project generates identifiers with Node's built-in `crypto.randomUUID()`
 * (RFC 4122 v4) rather than the `uuid` package, which became ESM-only and could
 * not be required from this CommonJS build (or transformed by ts-jest). This
 * module provides the one piece of functionality `crypto` does not expose: UUID
 * string validation.
 */

/**
 * Matches RFC 4122 / RFC 9562 UUIDs (versions 1–8) plus the special nil and max
 * UUIDs. This mirrors the regex used by the `uuid` package's `validate()` so
 * session-ID validation behaviour is unchanged after dropping that dependency.
 */
const UUID_REGEX =
    /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/i;

/**
 * Returns true when `value` is a syntactically valid UUID string.
 * Drop-in replacement for `uuid`'s `validate()`.
 */
export function isValidUuid(value: unknown): boolean {
    return typeof value === 'string' && UUID_REGEX.test(value);
}
