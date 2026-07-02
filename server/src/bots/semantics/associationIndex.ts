/**
 * Shared association-index machinery: build the clue→words and word→concepts
 * lookups from a `Record<concept, words[]>` table, and score the common-sense
 * reading of a word pair against it. Used by the baked table backend and by
 * custom semantic-map overlays (mapBackend) so both grade identically.
 */
import { normalizeClueWord } from '../../shared/gameRules';
import { lexicalBackend } from './backend';

export interface AssociationIndex {
    /** Normalized clue key → set of normalized related words. */
    readonly table: Map<string, Set<string>>;
    /** Inverted: normalized word → set of concept keys it belongs to. */
    readonly membership: Map<string, Set<string>>;
}

export function buildAssociationIndex(associations: Record<string, readonly string[]>): AssociationIndex {
    const table = new Map<string, Set<string>>();
    for (const [clue, words] of Object.entries(associations)) {
        table.set(normalizeClueWord(clue), new Set(words.map((w) => normalizeClueWord(w))));
    }
    const membership = new Map<string, Set<string>>();
    for (const [concept, words] of table) {
        for (const w of words) {
            let concepts = membership.get(w);
            if (!concepts) {
                concepts = new Set();
                membership.set(w, concepts);
            }
            concepts.add(concept);
        }
    }
    return { table, membership };
}

/**
 * Partial score for a given number of shared concept groups. Saturating and
 * always < 1 so a co-membership never outranks a direct clue→word hit:
 * 1 shared → 0.50, 2 → 0.67, 3 → 0.75, 4 → 0.80, … (1 - 1/(n+1)).
 */
function sharedConceptScore(shared: number): number {
    return shared > 0 ? 1 - 1 / (shared + 1) : 0;
}

/**
 * The common-sense reading of a pair against an index:
 *  - 1 for a direct clue→word entry (either lookup order, so relatedness
 *    stays symmetric);
 *  - a graded co-membership score (never below the lexical floor) when both
 *    words share one or more concept groups — this is what lets a clicker
 *    make sense of a human clue that isn't itself a table key;
 *  - null when the index carries NO signal for the pair — the caller decides
 *    the fallback (lexical floor for the baked table, the next backend in the
 *    chain for a custom-map overlay).
 */
export function scoreCommonAssociation(index: AssociationIndex, a: string, b: string): number | null {
    const A = normalizeClueWord(a);
    const B = normalizeClueWord(b);
    if (index.table.get(A)?.has(B) || index.table.get(B)?.has(A)) return 1;

    const ca = index.membership.get(A);
    const cb = index.membership.get(B);
    if (ca && cb) {
        let shared = 0;
        // Iterate the smaller set for a cheaper intersection.
        const [small, large] = ca.size <= cb.size ? [ca, cb] : [cb, ca];
        for (const c of small) if (large.has(c)) shared++;
        if (shared > 0) {
            return Math.max(sharedConceptScore(shared), lexicalBackend.relatedness(a, b));
        }
    }
    return null;
}
