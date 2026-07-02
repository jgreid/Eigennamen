/**
 * Association-table semantic backend (the §20 "baked table" path).
 *
 * Looks up the offline-baked ASSOCIATIONS table. Relatedness is GRADED rather
 * than a hard 0/1 so both sides of the clue channel behave more naturally:
 *
 *  - A direct clue→board-word entry (either lookup order) scores 1 — the strong,
 *    intended signal a concept clue carries.
 *  - Otherwise, two words that co-occur in one or more concept groups get a
 *    partial score that grows with the number of shared concepts. This is what
 *    lets a bot clicker make sense of a HUMAN clue that isn't itself a table key
 *    (e.g. clue BEAR → ranks LION/HORSE, which share ANIMAL/MAMMAL/WILD), and
 *    gives the greedy clicker graded — not perfectly deterministic — rankings.
 *  - Anything the table can't relate falls back to lexical (orthographic)
 *    similarity, so out-of-vocabulary / custom-list words still produce a weak
 *    signal rather than nothing.
 *
 * Case signal (house rule, see properAssociations.ts): a mixed-case clue
 * ("Alien") denotes the specific proper-noun reference and reads from the
 * PROPER_ASSOCIATIONS table — related words score full, everything else is
 * dampened to lexical noise, because the reference sense deliberately EXCLUDES
 * the common sense. An all-lowercase clue ("alien") explicitly means the
 * common sense and never reads the proper table. Legacy ALL-CAPS clues carry
 * no signal and take the best of both readings.
 *
 * The table's keys — common concepts plus display-cased proper references —
 * are the spymaster's candidate clue vocabulary.
 */
import type { SemanticBackend } from './backend';
import { lexicalBackend } from './backend';
import { normalizeClueWord } from '../../shared/gameRules';
import { ASSOCIATIONS } from './associations';
import { PROPER_ASSOCIATIONS, PROPER_FAME, DEFAULT_PROPER_FAME, caseSignal } from './properAssociations';

/** Normalized lookup: clue -> set of related board words. */
const TABLE: Map<string, Set<string>> = new Map(
    Object.entries(ASSOCIATIONS).map(([clue, words]) => [
        normalizeClueWord(clue),
        new Set(words.map((w) => normalizeClueWord(w))),
    ])
);

/**
 * Inverted index: board word -> set of concept keys it belongs to. Built from
 * the same table, it lets us measure how strongly two ordinary words relate by
 * how many concept groups they share — the basis for interpreting human clues.
 */
const MEMBERSHIP: Map<string, Set<string>> = new Map();
for (const [concept, words] of TABLE) {
    for (const w of words) {
        let concepts = MEMBERSHIP.get(w);
        if (!concepts) {
            concepts = new Set();
            MEMBERSHIP.set(w, concepts);
        }
        concepts.add(concept);
    }
}

/**
 * Partial score for a given number of shared concept groups. Saturating and
 * always < 1 so a co-membership never outranks a direct clue→word hit:
 * 1 shared → 0.50, 2 → 0.67, 3 → 0.75, 4 → 0.80, … (1 - 1/(n+1)).
 */
function sharedConceptScore(shared: number): number {
    return shared > 0 ? 1 - 1 / (shared + 1) : 0;
}

/** Normalized proper-reference lookup: key → related board words. */
const PROPER_TABLE: Map<string, Set<string>> = new Map(
    Object.entries(PROPER_ASSOCIATIONS).map(([key, words]) => [
        normalizeClueWord(key),
        new Set(words.map((w) => normalizeClueWord(w))),
    ])
);

/** Normalized key → display-case key ("CINDERELLA" → "Cinderella"): the case
 *  the spymaster must EMIT for the clue to carry the proper-noun signal. */
const PROPER_DISPLAY: Map<string, string> = new Map(
    Object.keys(PROPER_ASSOCIATIONS).map((key) => [normalizeClueWord(key), key])
);

/** Normalized key → fame (recognizability prior for commonness()). */
const PROPER_FAME_NORM: Map<string, number> = new Map(
    Object.keys(PROPER_ASSOCIATIONS).map((key) => [normalizeClueWord(key), PROPER_FAME[key] ?? DEFAULT_PROPER_FAME])
);

/** A proper-noun reference clue that misses still carries SOME orthographic
 *  noise, but dampened — the reference sense excludes the common sense. */
const PROPER_MISS_DAMP = 0.5;

/** 1 when the pair is a direct proper-reference association, else 0. */
function properDirect(a: string, b: string): number {
    const A = normalizeClueWord(a);
    const B = normalizeClueWord(b);
    return PROPER_TABLE.get(A)?.has(B) || PROPER_TABLE.get(B)?.has(A) ? 1 : 0;
}

/** The common-sense reading: concept table → co-membership → lexical floor. */
function commonRelatedness(a: string, b: string): number {
    const A = normalizeClueWord(a);
    const B = normalizeClueWord(b);
    // Direct clue→board-word entry (the table is keyed by clue word; check
    // both orders so relatedness stays symmetric).
    if (TABLE.get(A)?.has(B) || TABLE.get(B)?.has(A)) return 1;

    // Graded co-membership: how many concept groups both words belong to.
    // Helps the clicker interpret human clues that are board-ish words rather
    // than table keys, and softens otherwise-binary rankings.
    const ca = MEMBERSHIP.get(A);
    const cb = MEMBERSHIP.get(B);
    if (ca && cb) {
        let shared = 0;
        // Iterate the smaller set for a cheaper intersection.
        const [small, large] = ca.size <= cb.size ? [ca, cb] : [cb, ca];
        for (const c of small) if (large.has(c)) shared++;
        if (shared > 0) {
            return Math.max(sharedConceptScore(shared), lexicalBackend.relatedness(a, b));
        }
    }

    return lexicalBackend.relatedness(a, b);
}

export const tableBackend: SemanticBackend = {
    id: 'table',
    relatedness(a: string, b: string): number {
        if (normalizeClueWord(a) === normalizeClueWord(b)) return 1;

        const aSig = caseSignal(a);
        const bSig = caseSignal(b);
        // Mixed case = the house-rule signal for a specific reference. Board
        // words are stored ALL-CAPS, so only a clue word can carry it.
        if (aSig === 'proper' || bSig === 'proper') {
            const reference = aSig === 'proper' ? a : b;
            const other = aSig === 'proper' ? b : a;
            const entry = PROPER_TABLE.get(normalizeClueWord(reference));
            if (entry) {
                // "Alien" means the film, NOT anything foreign: associated words
                // score full, everything else drops to dampened lexical noise.
                if (entry.has(normalizeClueWord(other))) return 1;
                return lexicalBackend.relatedness(a, b) * PROPER_MISS_DAMP;
            }
            // A reference this table doesn't know: read it like any other word
            // (graceful — a human guesser falls back the same way).
            return commonRelatedness(a, b);
        }
        // Explicit lowercase = explicitly the common sense; never the reference.
        if (aSig === 'common' || bSig === 'common') return commonRelatedness(a, b);
        // No signal (legacy ALL-CAPS): the best of both readings.
        return Math.max(commonRelatedness(a, b), properDirect(a, b));
    },
    vocabulary(): string[] {
        // Common concept keys plus display-cased proper references — emitting a
        // reference verbatim ("Cinderella") is itself the case signal.
        return [...TABLE.keys(), ...PROPER_DISPLAY.values()];
    },
    commonness(word: string): number {
        // Fame prior for proper references ("only clue culture references the
        // guessers are going to know"): feeds the spymaster's rarity penalty,
        // scaled by the persona's commonnessBias. An explicit lowercase word is
        // the common sense, never judged as a reference.
        const fame = PROPER_FAME_NORM.get(normalizeClueWord(word));
        if (fame !== undefined && caseSignal(word) !== 'common') return fame;
        return 1;
    },
};
