/**
 * Frontend Socket Client Storage Tests
 *
 * Tests safe browser storage wrappers (safeSetStorage, safeGetStorage, safeRemoveStorage)
 * from src/frontend/socket-client-storage.ts.
 * Verifies QuotaExceededError handling, general error handling, and normal operation.
 * Test environment: jsdom
 */

jest.mock('../../frontend/logger', () => ({
    logger: { warn: jest.fn(), error: jest.fn(), debug: jest.fn(), info: jest.fn() },
}));

import { safeSetStorage, safeGetStorage, safeRemoveStorage } from '../../frontend/socket-client-storage';
import { logger } from '../../frontend/logger';

let mockStorage: Storage;

beforeEach(() => {
    jest.clearAllMocks();
    // Create a real-ish storage mock backed by a plain object
    const store: Record<string, string> = {};
    mockStorage = {
        getItem: jest.fn((key: string) => store[key] ?? null),
        setItem: jest.fn((key: string, value: string) => {
            store[key] = value;
        }),
        removeItem: jest.fn((key: string) => {
            delete store[key];
        }),
        clear: jest.fn(),
        get length() {
            return Object.keys(store).length;
        },
        key: jest.fn(),
    };
});

// ========== safeSetStorage ==========

describe('safeSetStorage', () => {
    test('stores value and returns true on success', () => {
        const result = safeSetStorage(mockStorage, 'token', 'abc123');
        expect(result).toBe(true);
        expect(mockStorage.setItem).toHaveBeenCalledWith('token', 'abc123');
    });

    test('returns false and logs warning on QuotaExceededError', () => {
        const quotaError = new DOMException('quota exceeded', 'QuotaExceededError');
        (mockStorage.setItem as jest.Mock).mockImplementation(() => {
            throw quotaError;
        });

        const result = safeSetStorage(mockStorage, 'bigData', 'x'.repeat(1000));
        expect(result).toBe(false);
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Storage quota exceeded for bigData'));
    });

    test('returns false and logs error on non-quota DOMException', () => {
        const securityError = new DOMException('blocked', 'SecurityError');
        (mockStorage.setItem as jest.Mock).mockImplementation(() => {
            throw securityError;
        });

        const result = safeSetStorage(mockStorage, 'key', 'val');
        expect(result).toBe(false);
        expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Storage error for key:'), securityError);
    });

    test('returns false and logs error on generic error', () => {
        const genericError = new Error('storage broken');
        (mockStorage.setItem as jest.Mock).mockImplementation(() => {
            throw genericError;
        });

        const result = safeSetStorage(mockStorage, 'key', 'val');
        expect(result).toBe(false);
        expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Storage error for key:'), genericError);
    });
});

// ========== safeGetStorage ==========

describe('safeGetStorage', () => {
    test('returns stored value', () => {
        mockStorage.setItem('session', 'xyz');
        const result = safeGetStorage(mockStorage, 'session');
        expect(result).toBe('xyz');
    });

    test('returns null for missing key', () => {
        const result = safeGetStorage(mockStorage, 'nonexistent');
        expect(result).toBeNull();
    });

    test('returns null and logs warning on error', () => {
        (mockStorage.getItem as jest.Mock).mockImplementation(() => {
            throw new Error('access denied');
        });

        const result = safeGetStorage(mockStorage, 'blocked');
        expect(result).toBeNull();
        expect(logger.warn).toHaveBeenCalledWith(
            expect.stringContaining('Storage access error for blocked:'),
            expect.any(Error)
        );
    });
});

// ========== safeRemoveStorage ==========

describe('safeRemoveStorage', () => {
    test('removes item from storage', () => {
        mockStorage.setItem('token', 'abc');
        safeRemoveStorage(mockStorage, 'token');
        expect(mockStorage.removeItem).toHaveBeenCalledWith('token');
    });

    test('does not throw on error, logs warning instead', () => {
        (mockStorage.removeItem as jest.Mock).mockImplementation(() => {
            throw new Error('removal failed');
        });

        expect(() => safeRemoveStorage(mockStorage, 'key')).not.toThrow();
        expect(logger.warn).toHaveBeenCalledWith(
            expect.stringContaining('Storage removal error for key:'),
            expect.any(Error)
        );
    });
});
