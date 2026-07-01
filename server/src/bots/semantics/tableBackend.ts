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
 * The table's keys are the spymaster's candidate clue vocabulary.
 */
import type { SemanticBackend } from './backend';
import { lexicalBackend } from './backend';
import { normalizeClueWord } from '../../shared/gameRules';
import { ASSOCIATIONS } from './associations';

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

export const tableBackend: SemanticBackend = {
    id: 'table',
    relatedness(a: string, b: string): number {
        const A = normalizeClueWord(a);
        const B = normalizeClueWord(b);
        if (A === B) return 1;
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
    },
    vocabulary(): string[] {
        return [...TABLE.keys()];
    },
};
