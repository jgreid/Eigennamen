/**
 * Serializer Branch Coverage Tests
 */

jest.mock('../utils/logger', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn()
}));

describe('Serializer Branch Coverage', () => {
    let parseOrThrow: any;
    let parseAndValidate: any;
    let createParser: any;
    let safeParse: any;
    let safeStringify: any;

    beforeEach(() => {
        jest.clearAllMocks();
        const mod = require('../utils/serializer');
        parseOrThrow = mod.parseOrThrow;
        parseAndValidate = mod.parseAndValidate;
        createParser = mod.createParser;
        safeParse = mod.safeParse;
        safeStringify = mod.safeStringify;
    });

    it('should throw with preview of invalid JSON', () => {
        expect(() => parseOrThrow('not valid json', 'test')).toThrow('JSON parse failed in test');
    });

    it('should throw with String() preview for non-string invalid JSON (line 72)', () => {
        // Passing an object triggers: typeof jsonString !== 'string' → String(jsonString)
        expect(() => parseOrThrow({}, 'test')).toThrow('JSON parse failed in test');
    });

    it('should throw for null input', () => {
        expect(() => parseOrThrow(null, 'test')).toThrow('Cannot parse null/undefined');
    });

    it('should throw for undefined input', () => {
        expect(() => parseOrThrow(undefined, 'test')).toThrow('Cannot parse null/undefined');
    });

    it('should validate with default empty requiredFields', () => {
        const result = parseAndValidate('{"key": "value"}');
        expect(result.valid).toBe(true);
    });

    it('should return invalid when parse fails', () => {
        const result = parseAndValidate('invalid json');
        expect(result.valid).toBe(false);
    });

    it('should detect missing required fields', () => {
        const result = parseAndValidate('{"a": 1}', ['a', 'b']);
        expect(result.valid).toBe(false);
        expect(result.missing).toEqual(['b']);
    });

    it('should create parser with default required fields', () => {
        const parser = createParser();
        expect(parser('{"x": 1}')).toEqual({ x: 1 });
    });

    it('should return null for invalid JSON via parser', () => {
        const parser = createParser(['id'], 'test');
        expect(parser('not json')).toBeNull();
    });

    it('should return null when required fields missing', () => {
        const parser = createParser(['id', 'name'], 'test');
        expect(parser('{"id": 1}')).toBeNull();
    });

    it('should return default for null in safeStringify', () => {
        expect(safeStringify(null)).toBe('{}');
        expect(safeStringify(undefined)).toBe('{}');
        expect(safeStringify(null, '[]')).toBe('[]');
    });

    it('should return default for null in safeParse', () => {
        expect(safeParse(null, 'fallback')).toBe('fallback');
        expect(safeParse('bad json', null)).toBeNull();
    });
});
