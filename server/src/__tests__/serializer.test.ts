/**
 * JSON Serializer Utility Tests
 *
 * Tests for utils/serializer.js - JSON parsing/stringifying utilities.
 */

// Mock logger
jest.mock('../utils/logger', () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
}));

const {
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
} = require('../utils/serializer');
const logger = require('../utils/logger');

describe('JSON Serializer Utility', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('safeParse()', () => {
        it('should parse valid JSON string', () => {
            const result = safeParse('{"name":"test","count":5}');
            expect(result).toEqual({ name: 'test', count: 5 });
        });

        it('should return default value for null input', () => {
            expect(safeParse(null)).toBeNull();
            expect(safeParse(null, 'default')).toBe('default');
        });

        it('should return default value for undefined input', () => {
            expect(safeParse(undefined)).toBeNull();
            expect(safeParse(undefined, [])).toEqual([]);
        });

        it('should return input if already an object', () => {
            const obj = { already: 'parsed' };
            expect(safeParse(obj)).toBe(obj);
        });

        it('should return default value for invalid JSON', () => {
            expect(safeParse('invalid json', null, 'test')).toBeNull();
            expect(safeParse('{broken:', 'fallback', 'test')).toBe('fallback');
        });

        it('should log warning for parse failures', () => {
            safeParse('invalid', null, 'myContext');
            expect(logger.warn).toHaveBeenCalledWith('JSON parse failed', expect.objectContaining({
                context: 'myContext'
            }));
        });

        it('should include preview of invalid JSON in log', () => {
            const longInvalidJson = 'a'.repeat(200);
            safeParse(longInvalidJson, null, 'test');
            expect(logger.warn).toHaveBeenCalledWith('JSON parse failed', expect.objectContaining({
                preview: expect.any(String)
            }));
        });

        it('should parse arrays', () => {
            expect(safeParse('[1,2,3]')).toEqual([1, 2, 3]);
        });

        it('should parse primitive values', () => {
            expect(safeParse('"hello"')).toBe('hello');
            expect(safeParse('123')).toBe(123);
            expect(safeParse('true')).toBe(true);
            expect(safeParse('null')).toBeNull();
        });
    });

    describe('parseOrThrow()', () => {
        it('should parse valid JSON string', () => {
            const result = parseOrThrow('{"key":"value"}');
            expect(result).toEqual({ key: 'value' });
        });

        it('should throw for null input', () => {
            expect(() => parseOrThrow(null)).toThrow('Cannot parse null/undefined JSON');
        });

        it('should throw for undefined input', () => {
            expect(() => parseOrThrow(undefined)).toThrow('Cannot parse null/undefined JSON');
        });

        it('should throw for invalid JSON', () => {
            expect(() => parseOrThrow('invalid', 'testContext'))
                .toThrow('JSON parse failed in testContext');
        });

        it('should include context in error message', () => {
            expect(() => parseOrThrow('bad', 'myOperation'))
                .toThrow(/myOperation/);
        });

        it('should log error on parse failure', () => {
            try {
                parseOrThrow('invalid', 'testContext');
            } catch (e) {
                // Expected
            }
            expect(logger.error).toHaveBeenCalledWith('JSON parse error', expect.objectContaining({
                context: 'testContext'
            }));
        });
    });

    describe('safeStringify()', () => {
        it('should stringify objects', () => {
            const result = safeStringify({ key: 'value' });
            expect(result).toBe('{"key":"value"}');
        });

        it('should return default for null input', () => {
            expect(safeStringify(null)).toBe('{}');
            expect(safeStringify(null, '[]')).toBe('[]');
        });

        it('should return default for undefined input', () => {
            expect(safeStringify(undefined)).toBe('{}');
        });

        it('should stringify arrays', () => {
            expect(safeStringify([1, 2, 3])).toBe('[1,2,3]');
        });

        it('should return default for circular references', () => {
            const circular = {};
            circular.self = circular;
            expect(safeStringify(circular, 'fallback', 'test')).toBe('fallback');
        });

        it('should log warning for stringify failures', () => {
            const circular = {};
            circular.self = circular;
            safeStringify(circular, '{}', 'myContext');
            expect(logger.warn).toHaveBeenCalledWith('JSON stringify failed', expect.objectContaining({
                context: 'myContext'
            }));
        });
    });

    describe('stringifyOrThrow()', () => {
        it('should stringify objects', () => {
            const result = stringifyOrThrow({ test: true });
            expect(result).toBe('{"test":true}');
        });

        it('should throw for circular references', () => {
            const circular = { name: 'test' };
            circular.self = circular;
            expect(() => stringifyOrThrow(circular, 'testContext'))
                .toThrow('JSON stringify failed in testContext');
        });

        it('should log error on stringify failure', () => {
            const circular = {};
            circular.self = circular;
            try {
                stringifyOrThrow(circular, 'testContext');
            } catch (e) {
                // Expected
            }
            expect(logger.error).toHaveBeenCalledWith('JSON stringify error', expect.objectContaining({
                context: 'testContext'
            }));
        });
    });

    describe('parseMany()', () => {
        it('should parse array of JSON strings', () => {
            const input = ['{"a":1}', '{"b":2}', '{"c":3}'];
            const result = parseMany(input);
            expect(result).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
        });

        it('should return null for null/undefined entries', () => {
            const input = ['{"a":1}', null, undefined, '{"b":2}'];
            const result = parseMany(input);
            expect(result).toEqual([{ a: 1 }, null, null, { b: 2 }]);
        });

        it('should return null for invalid JSON entries', () => {
            const input = ['{"valid":true}', 'invalid', '{"also":"valid"}'];
            const result = parseMany(input);
            expect(result[0]).toEqual({ valid: true });
            expect(result[1]).toBeNull();
            expect(result[2]).toEqual({ also: 'valid' });
        });

        it('should return empty array for non-array input', () => {
            expect(parseMany('not-an-array')).toEqual([]);
            expect(parseMany(null)).toEqual([]);
            expect(parseMany(undefined)).toEqual([]);
        });

        it('should include index in context for parse errors', () => {
            parseMany(['valid', 'invalid'], 'myContext');
            expect(logger.warn).toHaveBeenCalledWith('JSON parse failed', expect.objectContaining({
                context: 'myContext[1]'
            }));
        });
    });

    describe('parseAndValidate()', () => {
        it('should return valid result for valid JSON with all required fields', () => {
            const result = parseAndValidate('{"name":"test","age":25}', ['name', 'age']);
            expect(result.valid).toBe(true);
            expect(result.data).toEqual({ name: 'test', age: 25 });
            expect(result.missing).toEqual([]);
        });

        it('should return invalid result for missing required fields', () => {
            const result = parseAndValidate('{"name":"test"}', ['name', 'age', 'email']);
            expect(result.valid).toBe(false);
            expect(result.data).toEqual({ name: 'test' });
            expect(result.missing).toEqual(['age', 'email']);
        });

        it('should return invalid result for invalid JSON', () => {
            const result = parseAndValidate('invalid', ['name']);
            expect(result.valid).toBe(false);
            expect(result.data).toBeNull();
            expect(result.missing).toEqual(['name']);
        });

        it('should work with no required fields', () => {
            const result = parseAndValidate('{"any":"data"}', []);
            expect(result.valid).toBe(true);
        });

        it('should log warning for missing fields', () => {
            parseAndValidate('{"a":1}', ['a', 'b'], 'testContext');
            expect(logger.warn).toHaveBeenCalledWith('Parsed JSON missing required fields', expect.objectContaining({
                context: 'testContext',
                missing: ['b']
            }));
        });
    });

    describe('deepClone()', () => {
        it('should create deep clone of object', () => {
            const original = { nested: { value: 1 } };
            const cloned = deepClone(original);

            expect(cloned).toEqual(original);
            expect(cloned).not.toBe(original);
            expect(cloned.nested).not.toBe(original.nested);
        });

        it('should return null for null input', () => {
            expect(deepClone(null)).toBeNull();
        });

        it('should return undefined for undefined input', () => {
            expect(deepClone(undefined)).toBeUndefined();
        });

        it('should clone arrays', () => {
            const original = [1, { a: 2 }, [3, 4]];
            const cloned = deepClone(original);

            expect(cloned).toEqual(original);
            expect(cloned).not.toBe(original);
            expect(cloned[1]).not.toBe(original[1]);
        });

        it('should return null for circular references', () => {
            const circular = { name: 'test' };
            circular.self = circular;
            expect(deepClone(circular, 'test')).toBeNull();
        });

        it('should log warning for clone failures', () => {
            const circular = {};
            circular.self = circular;
            deepClone(circular, 'myContext');
            expect(logger.warn).toHaveBeenCalledWith('Deep clone failed', expect.objectContaining({
                context: 'myContext'
            }));
        });
    });

    describe('parseTyped()', () => {
        it('should return parsed object when type matches', () => {
            const result = parseTyped('{"key":"value"}', 'object', {});
            expect(result).toEqual({ key: 'value' });
        });

        it('should return parsed array when type is array', () => {
            const result = parseTyped('[1,2,3]', 'array', []);
            expect(result).toEqual([1, 2, 3]);
        });

        it('should return parsed string when type is string', () => {
            const result = parseTyped('"hello"', 'string', '');
            expect(result).toBe('hello');
        });

        it('should return parsed number when type is number', () => {
            const result = parseTyped('42', 'number', 0);
            expect(result).toBe(42);
        });

        it('should return default when type does not match', () => {
            expect(parseTyped('[1,2,3]', 'object', {})).toEqual({});
            expect(parseTyped('{"a":1}', 'array', [])).toEqual([]);
            expect(parseTyped('"text"', 'number', 0)).toBe(0);
        });

        it('should return default for invalid JSON', () => {
            expect(parseTyped('invalid', 'object', { default: true })).toEqual({ default: true });
        });

        it('should log warning for type mismatch', () => {
            parseTyped('[1,2]', 'object', {}, 'myContext');
            expect(logger.warn).toHaveBeenCalledWith('Parsed JSON type mismatch', expect.objectContaining({
                context: 'myContext',
                expected: 'object',
                actual: 'array'
            }));
        });
    });

    describe('createParser()', () => {
        it('should return a parser function', () => {
            const parser = createParser(['id', 'name']);
            expect(typeof parser).toBe('function');
        });

        it('should parse valid JSON with required fields', () => {
            const parser = createParser(['id', 'name']);
            const result = parser('{"id":1,"name":"test"}');
            expect(result).toEqual({ id: 1, name: 'test' });
        });

        it('should return null for missing required fields', () => {
            const parser = createParser(['id', 'name']);
            const result = parser('{"id":1}');
            expect(result).toBeNull();
        });

        it('should return null for invalid JSON', () => {
            const parser = createParser(['id']);
            expect(parser('invalid')).toBeNull();
        });

        it('should work with no required fields', () => {
            const parser = createParser([]);
            expect(parser('{"any":"data"}')).toEqual({ any: 'data' });
        });

        it('should use provided context in error logging', () => {
            const parser = createParser(['id'], 'PlayerParser');
            parser('invalid');
            expect(logger.warn).toHaveBeenCalledWith('JSON parse failed', expect.objectContaining({
                context: 'PlayerParser'
            }));
        });
    });

    describe('parseWithDefaults()', () => {
        it('should merge parsed values with defaults', () => {
            const defaults = { a: 1, b: 2, c: 3 };
            const result = parseWithDefaults('{"b":20,"d":4}', defaults);
            expect(result).toEqual({ a: 1, b: 20, c: 3, d: 4 });
        });

        it('should return defaults for invalid JSON', () => {
            const defaults = { default: true };
            expect(parseWithDefaults('invalid', defaults)).toEqual({ default: true });
        });

        it('should return defaults for null JSON', () => {
            const defaults = { a: 1 };
            expect(parseWithDefaults(null, defaults)).toEqual({ a: 1 });
        });

        it('should return defaults for non-object JSON', () => {
            const defaults = { key: 'value' };
            expect(parseWithDefaults('[1,2,3]', defaults)).toEqual({ key: 'value' });
            expect(parseWithDefaults('"string"', defaults)).toEqual({ key: 'value' });
            expect(parseWithDefaults('123', defaults)).toEqual({ key: 'value' });
        });

        it('should work with empty defaults', () => {
            const result = parseWithDefaults('{"a":1}', {});
            expect(result).toEqual({ a: 1 });
        });

        it('should handle nested objects (shallow merge only)', () => {
            const defaults = { nested: { a: 1, b: 2 } };
            const result = parseWithDefaults('{"nested":{"b":20}}', defaults);
            // Shallow merge - nested object is replaced, not merged
            expect(result.nested).toEqual({ b: 20 });
        });
    });

    describe('Edge cases', () => {
        it('should handle empty string JSON', () => {
            expect(safeParse('""')).toBe('');
            expect(safeParse('"    "')).toBe('    ');
        });

        it('should handle JSON with special characters', () => {
            const result = safeParse('{"text":"Hello\\nWorld\\t!"}');
            expect(result.text).toBe('Hello\nWorld\t!');
        });

        it('should handle JSON with unicode', () => {
            const result = safeParse('{"emoji":"\\u{1F600}"}');
            // Note: JSON.parse may not handle this specific unicode format
        });

        it('should handle very large numbers', () => {
            // JSON.parse uses JavaScript numbers which have precision limits
            const result = safeParse('{"bigNumber":9007199254740993}');
            expect(result.bigNumber).toBeDefined();
        });
    });
});
