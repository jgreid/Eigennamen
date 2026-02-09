/**
 * Sanitize Branch Coverage Tests
 */

describe('Sanitize Branch Coverage', () => {
    let sanitizeForLog: any;
    let localeCompare: any;
    let localeIncludes: any;

    beforeEach(() => {
        const mod = require('../utils/sanitize');
        sanitizeForLog = mod.sanitizeForLog;
        localeCompare = mod.localeCompare;
        localeIncludes = mod.localeIncludes;
    });

    describe('sanitizeForLog - array branch', () => {
        it('should recursively sanitize arrays', () => {
            const input = [
                { password: 'secret123', name: 'test' },
                { token: 'abc', value: 42 }
            ];
            const result = sanitizeForLog(input);
            expect(result[0].password).toBe('[REDACTED]');
            expect(result[0].name).toBe('test');
            expect(result[1].token).toBe('[REDACTED]');
        });

        it('should handle nested arrays', () => {
            const input = [[{ secret: 'shhh' }]];
            const result = sanitizeForLog(input);
            expect(result[0][0].secret).toBe('[REDACTED]');
        });

    });

    describe('localeCompare - case sensitive branch', () => {
        it('should compare case-sensitively when caseInsensitive is false', () => {
            const result = localeCompare('A', 'a', { caseInsensitive: false });
            expect(result).not.toBe(0);
        });

        it('should compare case-insensitively by default', () => {
            expect(localeCompare('A', 'a')).toBe(0);
        });

        it('should handle non-string inputs', () => {
            expect(localeCompare(null, 'a')).toBeDefined();
            expect(localeCompare('a', null)).toBeDefined();
        });
    });

    describe('localeIncludes - case sensitive branch', () => {
        it('should be case-sensitive when caseInsensitive is false', () => {
            expect(localeIncludes('Hello World', 'hello', false)).toBe(false);
            expect(localeIncludes('Hello World', 'Hello', false)).toBe(true);
        });

        it('should handle non-string inputs', () => {
            expect(localeIncludes(null, 'test')).toBe(false);
            expect(localeIncludes('test', null)).toBe(false);
        });
    });
});
