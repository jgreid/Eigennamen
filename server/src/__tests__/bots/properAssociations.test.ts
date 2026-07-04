/**
 * The proper-noun (pop-culture) association table and the case-signal
 * convention: mixed case = the specific reference, lowercase = the common
 * sense, ALL CAPS = no signal (legacy).
 */
import {
    PROPER_ASSOCIATIONS,
    PROPER_RIVALS,
    PROPER_HYPERNYMS,
    PROPER_FAME,
    DEFAULT_PROPER_FAME,
    caseSignal,
    referenceSignal,
} from '../../bots/semantics/properAssociations';
import type { AssociationTarget } from '../../bots/semantics/associationIndex';
import { DEFAULT_WORDS, normalizeClueWord } from '../../shared/gameRules';

/** The board word a target names, whichever entry form it uses. */
const wordOf = (t: AssociationTarget): string => (typeof t === 'string' ? t : t.word);

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

describe('referenceSignal (case matters for each letter)', () => {
    it('upgrades exact canonical all-caps references to the proper signal', () => {
        // Acronyms have no lowercase form to signal with — their canonical
        // case IS the signal.
        expect(referenceSignal('NASA')).toBe('proper');
        expect(referenceSignal('CIA')).toBe('proper');
        expect(referenceSignal('UFO')).toBe('proper');
    });

    it('leaves non-canonical ALL CAPS neutral and lowercase common', () => {
        expect(referenceSignal('ALIEN')).toBe('neutral'); // canonical form is "Alien"
        expect(referenceSignal('CINDERELLA')).toBe('neutral');
        expect(referenceSignal('nasa')).toBe('common'); // explicit lowercase opts out
        expect(referenceSignal('Alien')).toBe('proper');
        expect(referenceSignal("McDonald's")).toBe('proper');
    });

    it('every curated key carries the proper signal when emitted verbatim', () => {
        // The spymaster emits keys in display case — that emission must BE the
        // signal, for title-case, intercap, and acronym keys alike.
        for (const key of Object.keys(PROPER_ASSOCIATIONS)) {
            expect({ key, signal: referenceSignal(key) }).toEqual({ key, signal: 'proper' });
        }
    });
});

describe('PROPER_ASSOCIATIONS integrity', () => {
    const board = new Set(DEFAULT_WORDS.map((w) => normalizeClueWord(w)));

    it('every target is a default board word (the table is useless otherwise)', () => {
        for (const [key, targets] of Object.entries(PROPER_ASSOCIATIONS)) {
            for (const t of targets.map(wordOf)) {
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
            for (const t of targets.map(wordOf)) {
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
            for (const t of targets.map(wordOf)) {
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

    it('weighted targets carry weights in (0, 1]', () => {
        for (const [key, targets] of Object.entries(PROPER_ASSOCIATIONS)) {
            for (const t of targets) {
                if (typeof t === 'string' || t.weight === undefined) continue;
                expect({ key, target: t.word, inRange: t.weight > 0 && t.weight <= 1 }).toEqual({
                    key,
                    target: t.word,
                    inRange: true,
                });
            }
        }
    });
});

describe('PROPER_RIVALS / PROPER_HYPERNYMS integrity (Phase 3)', () => {
    const board = new Set(DEFAULT_WORDS.map((w) => normalizeClueWord(w)));

    it('every rivals/hypernyms key names a curated reference (no dead data)', () => {
        for (const key of [...Object.keys(PROPER_RIVALS), ...Object.keys(PROPER_HYPERNYMS)]) {
            expect({ key, hosted: key in PROPER_ASSOCIATIONS }).toEqual({ key, hosted: true });
        }
    });

    it('rival contents are board words, fame is in (0, 1], and no self-blocked targets', () => {
        for (const [key, rivals] of Object.entries(PROPER_RIVALS)) {
            const K = normalizeClueWord(key);
            for (const rival of rivals) {
                expect(rival.fame).toBeGreaterThan(0);
                expect(rival.fame).toBeLessThanOrEqual(1);
                for (const t of rival.contents.map(wordOf)) {
                    const T = normalizeClueWord(t);
                    expect({ key, rival: rival.referent, target: t, ok: board.has(T) }).toEqual({
                        key,
                        rival: rival.referent,
                        target: t,
                        ok: true,
                    });
                    expect({ key, target: t, selfBlocked: K.includes(T) || T.includes(K) }).toEqual({
                        key,
                        target: t,
                        selfBlocked: false,
                    });
                }
            }
        }
    });

    it('hypernyms are board words, not self-blocked, and disjoint from the contents', () => {
        for (const [key, words] of Object.entries(PROPER_HYPERNYMS)) {
            const K = normalizeClueWord(key);
            const contents = new Set((PROPER_ASSOCIATIONS[key] ?? []).map((t) => normalizeClueWord(wordOf(t))));
            for (const w of words) {
                const W = normalizeClueWord(w);
                expect({ key, hypernym: w, onBoard: board.has(W) }).toEqual({ key, hypernym: w, onBoard: true });
                expect({ key, hypernym: w, selfBlocked: K.includes(W) || W.includes(K) }).toEqual({
                    key,
                    hypernym: w,
                    selfBlocked: false,
                });
                // A word that is already a content edge would only shadow it —
                // the content weight always wins the max.
                expect({ key, hypernym: w, duplicatesContent: contents.has(W) }).toEqual({
                    key,
                    hypernym: w,
                    duplicatesContent: false,
                });
            }
        }
    });
});
