/**
 * executeWithFallback Tests
 *
 * Tests the generic Lua-first / sequential fallback execution pattern.
 * Verifies that:
 * - Lua path succeeds without fallback
 * - Infrastructure errors trigger fallback
 * - Application errors bypass fallback and re-throw
 * - Fallback failures propagate correctly
 */

jest.mock('../../utils/logger', () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
}));

import { executeWithFallback } from '../../utils/executeWithFallback';

const logger = require('../../utils/logger');

describe('executeWithFallback', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('returns Lua result when Lua succeeds', async () => {
        const result = await executeWithFallback({
            lua: async () => 'lua-result',
            fallback: async () => 'fallback-result',
            operationName: 'testOp',
        });

        expect(result).toBe('lua-result');
        expect(logger.warn).not.toHaveBeenCalled();
    });

    test('calls fallback when Lua throws infrastructure error', async () => {
        const result = await executeWithFallback({
            lua: async () => {
                throw new Error('NOSCRIPT No matching script');
            },
            fallback: async () => 'fallback-result',
            operationName: 'testOp',
        });

        expect(result).toBe('fallback-result');
        expect(logger.warn).toHaveBeenCalledWith(
            expect.stringContaining('Lua testOp failed, falling back to sequential')
        );
    });

    test('does not call fallback for application errors', async () => {
        class PlayerNotFoundError extends Error {
            constructor() {
                super('Player not found');
            }
        }

        const fallback = jest.fn();

        await expect(
            executeWithFallback({
                lua: async () => {
                    throw new PlayerNotFoundError();
                },
                fallback,
                operationName: 'testOp',
                applicationErrors: [PlayerNotFoundError],
            })
        ).rejects.toThrow('Player not found');

        expect(fallback).not.toHaveBeenCalled();
        expect(logger.warn).not.toHaveBeenCalled();
    });

    test('supports multiple application error classes', async () => {
        class NotFoundError extends Error {
            constructor() {
                super('Not found');
            }
        }
        class CorruptedError extends Error {
            constructor() {
                super('Corrupted');
            }
        }

        const fallback = jest.fn();

        // First application error class
        await expect(
            executeWithFallback({
                lua: async () => {
                    throw new NotFoundError();
                },
                fallback,
                operationName: 'testOp',
                applicationErrors: [NotFoundError, CorruptedError],
            })
        ).rejects.toThrow('Not found');

        // Second application error class
        await expect(
            executeWithFallback({
                lua: async () => {
                    throw new CorruptedError();
                },
                fallback,
                operationName: 'testOp',
                applicationErrors: [NotFoundError, CorruptedError],
            })
        ).rejects.toThrow('Corrupted');

        expect(fallback).not.toHaveBeenCalled();
    });

    test('propagates fallback errors when both Lua and fallback fail', async () => {
        await expect(
            executeWithFallback({
                lua: async () => {
                    throw new Error('Lua failed');
                },
                fallback: async () => {
                    throw new Error('Fallback also failed');
                },
                operationName: 'testOp',
            })
        ).rejects.toThrow('Fallback also failed');

        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Lua testOp failed'));
    });

    test('works with void return type', async () => {
        const lua = jest.fn(async () => {});
        const fallback = jest.fn(async () => {});

        await executeWithFallback({
            lua,
            fallback,
            operationName: 'voidOp',
        });

        expect(lua).toHaveBeenCalled();
        expect(fallback).not.toHaveBeenCalled();
    });

    test('defaults applicationErrors to empty array', async () => {
        // Any error should trigger fallback when no applicationErrors specified
        const result = await executeWithFallback({
            lua: async () => {
                throw new TypeError('type error');
            },
            fallback: async () => 'recovered',
            operationName: 'testOp',
        });

        expect(result).toBe('recovered');
    });

    test('includes error message in log', async () => {
        await executeWithFallback({
            lua: async () => {
                throw new Error('ECONNRESET');
            },
            fallback: async () => 42,
            operationName: 'removePlayer(abc123)',
        });

        expect(logger.warn).toHaveBeenCalledWith(
            'Lua removePlayer(abc123) failed, falling back to sequential: ECONNRESET'
        );
    });
});
