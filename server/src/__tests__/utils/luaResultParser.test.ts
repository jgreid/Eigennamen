/**
 * luaResultParser Tests
 *
 * Tests the unified Lua script result parser with discriminated union types.
 * Covers all result patterns: null, numeric, sentinel, JSON success, JSON error.
 */

jest.mock('../../utils/logger', () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
}));

import { z } from 'zod';
import { parseLuaResult, unwrapLuaResult } from '../../utils/luaResultParser';

const testSchema = z.object({
    name: z.string(),
    value: z.number(),
});

describe('parseLuaResult', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('null/undefined handling', () => {
        test('returns null kind for null', () => {
            const result = parseLuaResult(null, { operationName: 'test' });
            expect(result).toEqual({ kind: 'null' });
        });

        test('returns null kind for undefined', () => {
            const result = parseLuaResult(undefined, { operationName: 'test' });
            expect(result).toEqual({ kind: 'null' });
        });
    });

    describe('numeric handling', () => {
        test('returns numeric kind for integer', () => {
            const result = parseLuaResult(1, { operationName: 'test' });
            expect(result).toEqual({ kind: 'numeric', value: 1 });
        });

        test('returns numeric kind for zero', () => {
            const result = parseLuaResult(0, { operationName: 'test' });
            expect(result).toEqual({ kind: 'numeric', value: 0 });
        });

        test('returns numeric kind for negative', () => {
            const result = parseLuaResult(-2, { operationName: 'test' });
            expect(result).toEqual({ kind: 'numeric', value: -2 });
        });
    });

    describe('sentinel handling', () => {
        test('recognizes configured sentinels', () => {
            const result = parseLuaResult('EXPIRED', {
                operationName: 'test',
                sentinels: ['EXPIRED', 'RECONNECTED'],
            });
            expect(result).toEqual({ kind: 'sentinel', value: 'EXPIRED' });
        });

        test('does not match non-configured sentinels', () => {
            // Non-JSON string without sentinels list → treated as sentinel anyway (catch-all)
            const result = parseLuaResult('UNKNOWN', {
                operationName: 'test',
                sentinels: ['EXPIRED'],
            });
            // Falls through to JSON parse, fails, treated as sentinel
            expect(result).toEqual({ kind: 'sentinel', value: 'UNKNOWN' });
        });
    });

    describe('JSON error handling', () => {
        test('detects error field in JSON (no schema)', () => {
            const result = parseLuaResult(JSON.stringify({ error: 'ROOM_NOT_FOUND' }), {
                operationName: 'test',
            });
            expect(result).toEqual({
                kind: 'error',
                code: 'ROOM_NOT_FOUND',
                detail: 'ROOM_NOT_FOUND',
            });
        });

        test('detects success:false with reason (no schema)', () => {
            const result = parseLuaResult(JSON.stringify({ success: false, reason: 'OLD_HOST_NOT_FOUND' }), {
                operationName: 'test',
            });
            expect(result).toEqual({
                kind: 'error',
                code: 'OLD_HOST_NOT_FOUND',
                detail: 'OLD_HOST_NOT_FOUND',
            });
        });

        test('detects error field in JSON (with schema)', () => {
            // Schema that accepts the error shape
            const errorSchema = z.object({
                error: z.string().optional(),
                name: z.string().optional(),
                value: z.number().optional(),
            });

            const result = parseLuaResult(JSON.stringify({ error: 'CORRUPTED_DATA' }), {
                operationName: 'test',
                schema: errorSchema,
            });
            expect(result).toEqual({
                kind: 'error',
                code: 'CORRUPTED_DATA',
                detail: 'CORRUPTED_DATA',
            });
        });
    });

    describe('JSON success handling', () => {
        test('parses valid JSON with schema', () => {
            const result = parseLuaResult(JSON.stringify({ name: 'test', value: 42 }), {
                operationName: 'test',
                schema: testSchema,
            });
            expect(result).toEqual({
                kind: 'success',
                data: { name: 'test', value: 42 },
            });
        });

        test('parses valid JSON without schema', () => {
            const result = parseLuaResult(JSON.stringify({ foo: 'bar', count: 5 }), { operationName: 'test' });
            expect(result).toEqual({
                kind: 'success',
                data: { foo: 'bar', count: 5 },
            });
        });

        test('returns error kind when schema validation fails', () => {
            const result = parseLuaResult(JSON.stringify({ name: 123, value: 'not-a-number' }), {
                operationName: 'test',
                schema: testSchema,
            });
            expect(result.kind).toBe('error');
            expect(result.code).toBe('PARSE_FAILED');
        });
    });

    describe('unexpected types', () => {
        test('returns error for boolean', () => {
            const result = parseLuaResult(true, { operationName: 'test' });
            expect(result.kind).toBe('error');
            expect(result.code).toBe('UNEXPECTED_TYPE');
        });

        test('returns error for object (non-null)', () => {
            const result = parseLuaResult({ raw: 'obj' }, { operationName: 'test' });
            expect(result.kind).toBe('error');
            expect(result.code).toBe('UNEXPECTED_TYPE');
        });
    });

    describe('defaults', () => {
        test('defaults sentinels to empty array', () => {
            // Non-sentinel string that is valid JSON → success
            const result = parseLuaResult(JSON.stringify({ key: 'val' }), { operationName: 'test' });
            expect(result.kind).toBe('success');
        });
    });
});

describe('unwrapLuaResult', () => {
    test('returns data for success kind', () => {
        const data = { name: 'test', value: 42 };
        const result = unwrapLuaResult({ kind: 'success', data }, 'test');
        expect(result).toEqual(data);
    });

    test('throws for error kind', () => {
        expect(() => unwrapLuaResult({ kind: 'error', code: 'ROOM_NOT_FOUND' }, 'getRoom')).toThrow(
            'Lua getRoom error: ROOM_NOT_FOUND'
        );
    });

    test('throws for null kind', () => {
        expect(() => unwrapLuaResult({ kind: 'null' }, 'getPlayer')).toThrow('Lua getPlayer: resource not found');
    });

    test('throws for sentinel kind', () => {
        expect(() => unwrapLuaResult({ kind: 'sentinel', value: 'EXPIRED' }, 'resumeTimer')).toThrow(
            "Lua resumeTimer: unexpected result kind 'sentinel'"
        );
    });

    test('throws for numeric kind', () => {
        expect(() => unwrapLuaResult({ kind: 'numeric', value: -1 }, 'joinRoom')).toThrow(
            "Lua joinRoom: unexpected result kind 'numeric'"
        );
    });
});
