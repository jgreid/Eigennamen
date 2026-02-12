/**
 * ReDoS Regression Tests
 *
 * Verifies that all user-facing regex patterns complete within safe time bounds,
 * even with adversarial inputs designed to trigger catastrophic backtracking.
 */

describe('ReDoS regression tests', () => {
    // All regex patterns from schemaHelpers.ts and gameSchemas.ts
    const teamNameRegex = /^[\p{L}\p{N}\s\-]+$/u;
    const roomIdRegex = /^[\p{L}\p{N}\-_]+$/u;
    const nicknameRegex = /^[\p{L}\p{N}\s\-_]+$/u;
    const clueWordRegex = /^[\p{L}]+(?:[\s\-'][\p{L}]+){0,9}$/u;

    const SAFE_TIMEOUT_MS = 50;

    function assertFastExecution(regex: RegExp, input: string, _label: string): void {
        const start = performance.now();
        regex.test(input);
        const elapsed = performance.now() - start;
        expect(elapsed).toBeLessThan(SAFE_TIMEOUT_MS);
    }

    describe('teamNameRegex', () => {
        it('handles long matching input quickly', () => {
            assertFastExecution(teamNameRegex, 'A'.repeat(10000), 'long match');
        });

        it('handles long non-matching input quickly', () => {
            assertFastExecution(teamNameRegex, 'A'.repeat(9999) + '!', 'long non-match');
        });

        it('handles alternating match/non-match characters', () => {
            assertFastExecution(teamNameRegex, 'A-'.repeat(5000), 'alternating');
        });

        it('handles spaces and hyphens mix', () => {
            assertFastExecution(teamNameRegex, ('AB ' + 'CD-').repeat(2000), 'space-hyphen mix');
        });
    });

    describe('roomIdRegex', () => {
        it('handles long matching input quickly', () => {
            assertFastExecution(roomIdRegex, 'a'.repeat(10000), 'long match');
        });

        it('handles long non-matching input quickly', () => {
            assertFastExecution(roomIdRegex, 'a'.repeat(9999) + '@', 'long non-match');
        });

        it('handles underscore-hyphen mix', () => {
            assertFastExecution(roomIdRegex, 'a-b_'.repeat(2500), 'underscore-hyphen mix');
        });
    });

    describe('nicknameRegex', () => {
        it('handles long matching input quickly', () => {
            assertFastExecution(nicknameRegex, 'User'.repeat(2500), 'long match');
        });

        it('handles long non-matching input quickly', () => {
            assertFastExecution(nicknameRegex, 'User'.repeat(2500) + '!', 'long non-match');
        });

        it('handles Unicode characters', () => {
            assertFastExecution(nicknameRegex, 'München'.repeat(1000), 'unicode');
        });
    });

    describe('clueWordRegex', () => {
        it('handles long single-word input quickly', () => {
            assertFastExecution(clueWordRegex, 'a'.repeat(10000), 'long single word');
        });

        it('handles max word parts (10) quickly', () => {
            const input = Array(10).fill('word').join(' ');
            assertFastExecution(clueWordRegex, input, 'max word parts');
        });

        it('handles long non-matching input quickly', () => {
            assertFastExecution(clueWordRegex, 'a'.repeat(9999) + '!', 'long non-match');
        });

        it('handles repeated separator patterns quickly', () => {
            // This pattern could cause backtracking in naive implementations
            assertFastExecution(clueWordRegex, 'a' + ' a'.repeat(9), 'repeated separators');
        });

        it('handles apostrophe-separated words quickly', () => {
            const input = Array(10).fill('don').join("'");
            assertFastExecution(clueWordRegex, input, 'apostrophe separated');
        });

        it('handles hyphen-separated words quickly', () => {
            const input = Array(10).fill('well').join('-');
            assertFastExecution(clueWordRegex, input, 'hyphen separated');
        });

        it('rejects more than 10 word parts', () => {
            const input = Array(11).fill('word').join(' ');
            expect(clueWordRegex.test(input)).toBe(false);
        });
    });

    describe('reconnection token regex', () => {
        const reconnectionTokenRegex = /^[0-9a-f]{64}$/i;

        it('handles long hex-like input quickly', () => {
            assertFastExecution(reconnectionTokenRegex, 'a'.repeat(10000), 'long hex');
        });

        it('handles non-matching input quickly', () => {
            assertFastExecution(reconnectionTokenRegex, 'g'.repeat(64), 'non-hex chars');
        });
    });
});
