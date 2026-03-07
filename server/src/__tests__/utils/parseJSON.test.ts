import { z } from 'zod';
import { parseJSON, tryParseJSON } from '../../utils/parseJSON';

// Suppress logger output in tests
jest.mock('../../utils/logger', () => ({
    __esModule: true,
    default: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const testSchema = z.object({
    name: z.string(),
    age: z.number(),
});

describe('parseJSON', () => {
    describe('valid input', () => {
        test('parses valid JSON matching schema', () => {
            const result = parseJSON('{"name":"Alice","age":30}', testSchema);
            expect(result).toEqual({ name: 'Alice', age: 30 });
        });

        test('strips extra fields with passthrough disabled', () => {
            const strictSchema = z.object({ id: z.string() });
            const result = parseJSON('{"id":"abc","extra":"ignored"}', strictSchema);
            expect(result).toEqual({ id: 'abc' });
        });
    });

    describe('malformed JSON', () => {
        test('throws on invalid JSON string', () => {
            expect(() => parseJSON('{invalid}', testSchema)).toThrow('Failed to parse JSON');
        });

        test('throws on empty string', () => {
            expect(() => parseJSON('', testSchema)).toThrow('Failed to parse JSON');
        });

        test('includes context in error message when provided', () => {
            expect(() => parseJSON('{bad}', testSchema, 'timer state for room ABC')).toThrow(
                'timer state for room ABC'
            );
        });
    });

    describe('schema validation failure', () => {
        test('throws when required field is missing', () => {
            expect(() => parseJSON('{"name":"Alice"}', testSchema)).toThrow('JSON validation failed');
        });

        test('throws when field has wrong type', () => {
            expect(() => parseJSON('{"name":"Alice","age":"thirty"}', testSchema)).toThrow('JSON validation failed');
        });

        test('includes field path in error message', () => {
            expect(() => parseJSON('{"name":123,"age":30}', testSchema)).toThrow('name');
        });

        test('includes context in validation error', () => {
            expect(() => parseJSON('{"name":123,"age":30}', testSchema, 'player data')).toThrow('player data');
        });
    });

    describe('edge cases', () => {
        test('handles null JSON value', () => {
            const nullableSchema = z.null();
            expect(parseJSON('null', nullableSchema)).toBeNull();
        });

        test('handles array JSON', () => {
            const arraySchema = z.array(z.number());
            expect(parseJSON('[1,2,3]', arraySchema)).toEqual([1, 2, 3]);
        });

        test('handles nested objects', () => {
            const nestedSchema = z.object({
                user: z.object({ name: z.string() }),
            });
            const result = parseJSON('{"user":{"name":"Bob"}}', nestedSchema);
            expect(result).toEqual({ user: { name: 'Bob' } });
        });
    });
});

describe('tryParseJSON', () => {
    test('returns parsed data on success', () => {
        const result = tryParseJSON('{"name":"Alice","age":30}', testSchema);
        expect(result).toEqual({ name: 'Alice', age: 30 });
    });

    test('returns null on malformed JSON', () => {
        expect(tryParseJSON('{invalid}', testSchema)).toBeNull();
    });

    test('returns null on schema validation failure', () => {
        expect(tryParseJSON('{"name":123}', testSchema)).toBeNull();
    });

    test('returns null on empty string', () => {
        expect(tryParseJSON('', testSchema)).toBeNull();
    });

    test('does not throw', () => {
        expect(() => tryParseJSON('{corrupt', testSchema, 'test context')).not.toThrow();
    });
});
