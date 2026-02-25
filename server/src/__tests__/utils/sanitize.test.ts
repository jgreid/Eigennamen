/**
 * Sanitize Utilities Tests
 *
 * Tests for input sanitization functions used for XSS prevention,
 * log redaction, control character removal, reserved name checking,
 */

const {
    sanitizeHtml,
    removeControlChars,
    isReservedName,
    toEnglishLowerCase,
    toEnglishUpperCase,
} = require('../../utils/sanitize');

describe('sanitizeHtml', () => {
    test('escapes HTML angle brackets', () => {
        expect(sanitizeHtml('<script>alert(1)</script>')).toBe(
            '&lt;script&gt;alert(1)&lt;&#x2F;script&gt;'
        );
    });

    test('escapes ampersands', () => {
        expect(sanitizeHtml('Tom & Jerry')).toBe('Tom &amp; Jerry');
    });

    test('escapes double and single quotes', () => {
        expect(sanitizeHtml('"hello" & \'world\'')).toBe(
            '&quot;hello&quot; &amp; &#x27;world&#x27;'
        );
    });

    test('escapes forward slashes', () => {
        expect(sanitizeHtml('path/to/file')).toBe('path&#x2F;to&#x2F;file');
    });

    test('returns empty string for non-string input', () => {
        expect(sanitizeHtml(null)).toBe('');
        expect(sanitizeHtml(undefined)).toBe('');
        expect(sanitizeHtml(42)).toBe('');
        expect(sanitizeHtml({})).toBe('');
    });

    test('handles empty string', () => {
        expect(sanitizeHtml('')).toBe('');
    });

    test('passes through safe text unchanged', () => {
        expect(sanitizeHtml('Hello World 123')).toBe('Hello World 123');
    });
});

describe('removeControlChars', () => {
    test('removes null bytes and low control characters', () => {
        expect(removeControlChars('hello\x00world')).toBe('helloworld');
        expect(removeControlChars('\x01\x02\x03test')).toBe('test');
    });

    test('preserves newlines and carriage returns', () => {
        expect(removeControlChars('line1\nline2')).toBe('line1\nline2');
        expect(removeControlChars('line1\r\nline2')).toBe('line1\r\nline2');
    });

    test('removes vertical tab and form feed', () => {
        expect(removeControlChars('hello\x0Bworld')).toBe('helloworld');
        expect(removeControlChars('hello\x0Cworld')).toBe('helloworld');
    });

    test('removes DEL character (0x7F)', () => {
        expect(removeControlChars('hello\x7Fworld')).toBe('helloworld');
    });

    test('returns empty string for non-string input', () => {
        expect(removeControlChars(null)).toBe('');
        expect(removeControlChars(undefined)).toBe('');
        expect(removeControlChars(42)).toBe('');
    });

    test('preserves normal Unicode text', () => {
        expect(removeControlChars('Café résumé')).toBe('Café résumé');
    });
});

describe('isReservedName', () => {
    const reservedNames = ['system', 'admin', 'server', 'bot'];

    test('detects exact reserved names (case-insensitive)', () => {
        expect(isReservedName('system', reservedNames)).toBe(true);
        expect(isReservedName('SYSTEM', reservedNames)).toBe(true);
        expect(isReservedName('System', reservedNames)).toBe(true);
    });

    test('detects reserved names with surrounding whitespace', () => {
        expect(isReservedName('  admin  ', reservedNames)).toBe(true);
    });

    test('rejects non-reserved names', () => {
        expect(isReservedName('player1', reservedNames)).toBe(false);
        expect(isReservedName('systematic', reservedNames)).toBe(false);
    });

    test('returns false for non-string input', () => {
        expect(isReservedName(null, reservedNames)).toBe(false);
        expect(isReservedName(42, reservedNames)).toBe(false);
        expect(isReservedName(undefined, reservedNames)).toBe(false);
    });
});

describe('toEnglishLowerCase', () => {
    test('lowercases ASCII text', () => {
        expect(toEnglishLowerCase('HELLO')).toBe('hello');
        expect(toEnglishLowerCase('Hello World')).toBe('hello world');
    });

    test('handles already-lowercase text', () => {
        expect(toEnglishLowerCase('hello')).toBe('hello');
    });

    test('returns empty string for non-string input', () => {
        expect(toEnglishLowerCase(null)).toBe('');
        expect(toEnglishLowerCase(42)).toBe('');
    });
});

describe('toEnglishUpperCase', () => {
    test('uppercases ASCII text', () => {
        expect(toEnglishUpperCase('hello')).toBe('HELLO');
    });

    test('returns empty string for non-string input', () => {
        expect(toEnglishUpperCase(null)).toBe('');
        expect(toEnglishUpperCase(42)).toBe('');
    });
});

