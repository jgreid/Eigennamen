/**
 * The proper-noun (pop-culture) association table and the case-signal
 * convention: mixed case = the specific reference, lowercase = the common
 * sense, ALL CAPS = no signal (legacy).
 */
import {
    PROPER_ASSOCIATIONS,
    PROPER_FAME,
    DEFAULT_PROPER_FAME,
    caseSignal,
} from '../../bots/semantics/properAssociations';
import { DEFAULT_WORDS, normalizeClueWord } from '../../shared/gameRules';

describe('caseSignal (the house-rule convention)', () => {
    it('reads mixed case as the proper-noun signal', () => {
        expect(caseSignal('Alien')).toBe('proper');
        expect(caseSignal('iPhone')).toBe('proper');
        expect(caseSignal('McQueen')).toBe('proper');
    });

    it('reads all-lowercase as the explicit common sense', () => {
        expect(caseSignal('alien')).toBe('common');
    });

    it('reads ALL CAPS (legacy, board words) as carrying no signal', () => {
        expect(caseSignal('ALIEN')).toBe('neutral');
        expect(caseSignal('UFO')).toBe('neutral');
        expect(caseSignal('42')).toBe('neutral');
    });
});

describe('PROPER_ASSOCIATIONS integrity', () => {
    const board = new Set(DEFAULT_WORDS.map((w) => normalizeClueWord(w)));

    it('every target is a default board word (the table is useless otherwise)', () => {
        for (const [key, targets] of Object.entries(PROPER_ASSOCIATIONS)) {
            for (const t of targets) {
                expect({ key, target: t, onBoard: board.has(normalizeClueWord(t)) }).toEqual({
                    key,
                    target: t,
                    onBoard: true,
                });
            }
        }
    });

    it('a key that is itself a default word never lists itself as a target', () => {
        // "Alien" IS in the 400-word default pool — that's fine: legality is
        // checked against the 25 drawn words, so the clue simply can't fire in
        // the games where ALIEN is dealt. But pointing at itself would only be
        // reachable exactly when illegal.
        for (const [key, targets] of Object.entries(PROPER_ASSOCIATIONS)) {
            const K = normalizeClueWord(key);
            if (!board.has(K)) continue;
            for (const t of targets) {
                expect({ key, target: t, selfTarget: normalizeClueWord(t) === K }).toEqual({
                    key,
                    target: t,
                    selfTarget: false,
                });
            }
        }
    });

    it('no key lists itself-as-substring targets it could never legally point at', () => {
        // If a key contains a board word ("Rocky" ⊃ ROCK), the clue is illegal
        // exactly when that word is on the board — so listing it as a target
        // would make it reachable only when unusable.
        for (const [key, targets] of Object.entries(PROPER_ASSOCIATIONS)) {
            const K = normalizeClueWord(key);
            for (const t of targets) {
                const T = normalizeClueWord(t);
                expect({ key, target: t, selfBlocked: K.includes(T) || T.includes(K) }).toEqual({
                    key,
                    target: t,
                    selfBlocked: false,
                });
            }
        }
    });

    it('fame ratings are in (0, 1] and every override names a real key', () => {
        expect(DEFAULT_PROPER_FAME).toBeGreaterThan(0);
        expect(DEFAULT_PROPER_FAME).toBeLessThanOrEqual(1);
        for (const [key, fame] of Object.entries(PROPER_FAME)) {
            expect(fame).toBeGreaterThan(0);
            expect(fame).toBeLessThanOrEqual(1);
            // Vesuvius-style orphan overrides are dead weight — catch them.
            if (!(key in PROPER_ASSOCIATIONS)) {
                expect({ key, orphanOverride: true }).toEqual({ key, orphanOverride: false });
            }
        }
    });

    it('keys are stored in display case (they must carry the proper signal verbatim)', () => {
        for (const key of Object.keys(PROPER_ASSOCIATIONS)) {
            expect({ key, signal: caseSignal(key) }).toEqual({
                key,
                signal: key === key.toUpperCase() ? 'neutral' : 'proper',
            });
        }
    });
});
