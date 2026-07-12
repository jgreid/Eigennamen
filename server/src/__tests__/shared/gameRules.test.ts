/**
 * Unit tests for the shared clue-shape validators (isValidClueWordShape /
 * isValidClueNumberShape) — the single source of truth used by both
 * gameClueSchema (human path, Zod) and gameService.submitClue (bot path,
 * which bypasses Zod entirely). See docs/HARDENING_PLAN.md P1-8.
 */
import {
    isValidClueWordShape,
    isValidClueNumberShape,
    isClueLegalForBoard,
    CLUE_WORD_MAX_LENGTH,
    CLUE_NUMBER_MAX,
} from '../../shared/gameRules';

describe('isClueLegalForBoard — multi-word board entries (compound-word rule)', () => {
    const board = ['ICE CREAM', 'APPLE', 'MOON'];

    it('bans the parts of a multi-word entry and their forms', () => {
        expect(isClueLegalForBoard('ICE', board)).toBe(false); // a part itself
        expect(isClueLegalForBoard('CREAM', board)).toBe(false);
        expect(isClueLegalForBoard('ICED', board)).toBe(false); // contains ICE
        expect(isClueLegalForBoard('CREAMS', board)).toBe(false); // contains CREAM
        expect(isClueLegalForBoard('JUSTICE', board)).toBe(false); // contains ICE (justICE — the live-play junk clue)
    });

    it('keeps genuinely distinct words legal', () => {
        expect(isClueLegalForBoard('FROSTING', board)).toBe(true);
        expect(isClueLegalForBoard('CREME', board)).toBe(true); // distinct word, not a form of CREAM
        expect(isClueLegalForBoard('DESSERT', board)).toBe(true);
    });

    it('leaves single-word board entries under the existing whole-string rule', () => {
        expect(isClueLegalForBoard('APPLES', board)).toBe(false); // contains APPLE
        expect(isClueLegalForBoard('HONEYMOON', board)).toBe(false); // contains MOON
        expect(isClueLegalForBoard('ORCHARD', board)).toBe(true);
    });
});

describe('isValidClueWordShape', () => {
    it('accepts a normal single word', () => {
        expect(isValidClueWordShape('FRUIT')).toEqual({ valid: true });
    });

    it('accepts a word at exactly the max length', () => {
        expect(isValidClueWordShape('A'.repeat(CLUE_WORD_MAX_LENGTH))).toEqual({ valid: true });
    });

    it('rejects an empty word', () => {
        const result = isValidClueWordShape('');
        expect(result.valid).toBe(false);
        expect(result.reason).toMatch(/required/i);
    });

    it('rejects a word over the max length', () => {
        const result = isValidClueWordShape('A'.repeat(CLUE_WORD_MAX_LENGTH + 1));
        expect(result.valid).toBe(false);
        expect(result.reason).toMatch(/too long/i);
    });

    it('rejects a word containing whitespace', () => {
        const result = isValidClueWordShape('TWO WORDS');
        expect(result.valid).toBe(false);
        expect(result.reason).toMatch(/single word/i);
    });

    it('rejects a word containing a tab or newline', () => {
        expect(isValidClueWordShape('A\tB').valid).toBe(false);
        expect(isValidClueWordShape('A\nB').valid).toBe(false);
    });
});

describe('isValidClueNumberShape', () => {
    it('accepts 0 (unlimited guesses convention)', () => {
        expect(isValidClueNumberShape(0)).toEqual({ valid: true });
    });

    it('accepts a number at exactly CLUE_NUMBER_MAX', () => {
        expect(isValidClueNumberShape(CLUE_NUMBER_MAX)).toEqual({ valid: true });
    });

    it('rejects a negative number', () => {
        const result = isValidClueNumberShape(-1);
        expect(result.valid).toBe(false);
        expect(result.reason).toMatch(/at least 0/i);
    });

    it('rejects a number above CLUE_NUMBER_MAX', () => {
        const result = isValidClueNumberShape(CLUE_NUMBER_MAX + 1);
        expect(result.valid).toBe(false);
        expect(result.reason).toMatch(/cannot exceed/i);
    });

    it('rejects a non-integer number', () => {
        const result = isValidClueNumberShape(1.5);
        expect(result.valid).toBe(false);
        expect(result.reason).toMatch(/whole number/i);
    });

    it('rejects NaN and Infinity', () => {
        expect(isValidClueNumberShape(NaN).valid).toBe(false);
        expect(isValidClueNumberShape(Infinity).valid).toBe(false);
    });
});
